import {
  auditEvents,
  campaignDeliveries,
  createDatabase,
  currentTenantDatabase,
  type Database,
  type DatabaseConnection,
  growthCustomers,
  identities,
  marketingCampaigns,
  membershipInvitations,
  organizations,
  outboxEvents,
  webhookEndpoints,
  webhookPublications,
  withTenantContext,
  withWorkerContext,
} from "@giromesa/db";
import { decryptSecret, encryptionKey, type SecretEnvelope } from "@giromesa/domain";
import { and, eq, sql } from "drizzle-orm";
import {
  deliverEmail,
  EmailDeliveryError,
  emailHtml,
  emailProviderConfiguration,
} from "./email.js";
import { consumeOrderSentInventory, InventoryConsumptionError } from "./inventory.js";
import { WorkerObservability } from "./observability.js";
import { failPrivacyRequest, processPrivacyRequest } from "./privacy.js";
import { deliverWebhook, parseWebhookDeliveryRequest, WebhookDeliveryError } from "./webhook.js";

export interface ClaimedOutboxEvent extends Record<string, unknown> {
  id: string;
  topic: string;
  aggregate_type: string;
  aggregate_id: string;
  organization_id: string | null;
  unit_id: string | null;
  payload: Record<string, unknown>;
  attempts: number;
}

export function observeOutboxDispatch<T>(
  observability: WorkerObservability,
  event: Pick<ClaimedOutboxEvent, "organization_id" | "topic" | "unit_id">,
  operation: () => Promise<T>,
) {
  const attributes: Record<string, unknown> = { "job.type": event.topic };
  if (event.organization_id) attributes["organization.id"] = event.organization_id;
  if (event.unit_id) attributes["unit.id"] = event.unit_id;
  return observability.runJob("outbox.dispatch", attributes, operation);
}

export function retryDelaySeconds(attempts: number) {
  return Math.min(3_600, 2 ** Math.min(Math.max(attempts, 0), 10));
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requiredString(payload: Record<string, unknown>, key: string) {
  const value = payload[key];
  if (typeof value !== "string" || value.length === 0) {
    throw new EmailDeliveryError("EMAIL_EVENT_INVALID", false);
  }
  return value;
}

function requiredUuid(payload: Record<string, unknown>, key: string) {
  const value = requiredString(payload, key);
  if (!UUID.test(value)) throw new EmailDeliveryError("EMAIL_EVENT_INVALID", false);
  return value;
}

function requiredEnvelope(payload: Record<string, unknown>, key: string): SecretEnvelope {
  const value = payload[key];
  if (
    !isRecord(value) ||
    typeof value.encryptedSecret !== "string" ||
    typeof value.iv !== "string" ||
    typeof value.authTag !== "string"
  ) {
    throw new EmailDeliveryError("EMAIL_EVENT_INVALID", false);
  }
  return {
    encryptedSecret: value.encryptedSecret,
    iv: value.iv,
    authTag: value.authTag,
  };
}

function activeExpiry(payload: Record<string, unknown>) {
  const expiresAt = new Date(requiredString(payload, "expiresAt"));
  if (Number.isNaN(expiresAt.valueOf())) {
    throw new EmailDeliveryError("EMAIL_EVENT_INVALID", false);
  }
  if (expiresAt <= new Date()) throw new EmailDeliveryError("EMAIL_LINK_EXPIRED", false);
}

export class OutboxWorker {
  private readonly connection: DatabaseConnection;

  constructor(
    connection: DatabaseConnection = createDatabase(),
    private readonly observability = new WorkerObservability(),
  ) {
    this.connection = connection;
  }

  private get db() {
    return currentTenantDatabase() ?? this.connection.db;
  }

  async runOnce(limit = 25) {
    const rows = await withWorkerContext(this.connection, async (tx) => {
      const result = await tx.execute<ClaimedOutboxEvent>(sql`
        with claimed as (
          select id
          from outbox_events
          where processed_at is null
            and available_at <= now()
            and (locked_at is null or locked_at < now() - interval '5 minutes')
          order by created_at
          for update skip locked
          limit ${limit}
        )
        update outbox_events as events
        set locked_at = now(), attempts = events.attempts + 1
        from claimed
        where events.id = claimed.id
        returning events.id, events.organization_id, events.unit_id, events.topic,
          events.aggregate_type, events.aggregate_id, events.payload, events.attempts
      `);
      return [...result];
    });

    for (const event of rows) await this.process(event);
    return rows.length;
  }

  async expireAccessWindows() {
    const candidates = await withWorkerContext(this.connection, async (tx) => {
      const rows = await tx.execute<{ id: string; reason: string }>(sql`
        select organization.id,
          case when organization.billing_state = 'trial_active'
            then 'trial_expired' else 'grace_expired' end as reason
        from organizations as organization
        left join trials as trial on trial.organization_id = organization.id
        where (
          organization.billing_state = 'trial_active'
          and trial.ends_at <= now()
        ) or (
          organization.billing_state = 'grace'
          and organization.billing_state_changed_at <= now() - interval '7 days'
        )
      `);
      return [...rows];
    });
    let changed = 0;
    for (const item of candidates) {
      changed += await withTenantContext(
        this.connection,
        { source: "job", organizationId: item.id },
        async (tx) => {
          const updated = await tx.execute<{ id: string }>(sql`
            update organizations
            set billing_state = 'restricted',
                billing_state_changed_at = now(),
                operational_closure_until = now() + interval '12 hours',
                updated_at = now()
            where id = ${item.id} and billing_state in ('trial_active', 'grace')
            returning id
          `);
          if ([...updated].length === 0) return 0;
          await tx.insert(auditEvents).values({
            organizationId: item.id,
            action: `billing.${item.reason}`,
            entityType: "organization",
            entityId: item.id,
          });
          await tx.insert(outboxEvents).values({
            organizationId: item.id,
            topic: "billing.state_changed",
            aggregateType: "organization",
            aggregateId: item.id,
            payload: { organizationId: item.id, to: "restricted", event: item.reason },
          });
          return 1;
        },
      );
    }
    return changed;
  }

  async close() {
    await this.connection.client.end();
  }

  private async process(event: ClaimedOutboxEvent) {
    try {
      let deferredError: InventoryConsumptionError | null = null;
      if (event.topic === "privacy.request.processing") {
        deferredError =
          (await withWorkerContext(this.connection, () =>
            observeOutboxDispatch(this.observability, event, () => this.dispatch(event)),
          )) ?? null;
      } else if (event.organization_id) {
        deferredError =
          (await withTenantContext(
            this.connection,
            {
              source: "job",
              organizationId: event.organization_id,
              unitId: event.unit_id,
            },
            () => observeOutboxDispatch(this.observability, event, () => this.dispatch(event)),
          )) ?? null;
      } else {
        deferredError =
          (await withWorkerContext(this.connection, () =>
            observeOutboxDispatch(this.observability, event, () => this.dispatch(event)),
          )) ?? null;
      }
      if (deferredError) throw deferredError;
      await withWorkerContext(this.connection, (tx) =>
        tx.execute(
          sql`update outbox_events set processed_at = now(), locked_at = null, last_error = null where id = ${event.id}`,
        ),
      );
    } catch (error) {
      if (event.topic === "privacy.request.processing") {
        await withWorkerContext(this.connection, (tx) =>
          failPrivacyRequest(tx as unknown as Database, event),
        );
        await withWorkerContext(this.connection, (tx) =>
          tx.execute(sql`
            update outbox_events
            set processed_at = now(), locked_at = null,
                last_error = 'DEAD_LETTER:PRIVACY_PROCESSING_FAILED'
            where id = ${event.id}
          `),
        );
        return;
      }
      const message =
        error instanceof Error ? error.message.slice(0, 2_000) : "Unknown worker error";
      if (error instanceof EmailDeliveryError && !error.retryable) {
        await withWorkerContext(this.connection, async (tx) => {
          await tx.execute(sql`
            update outbox_events
            set processed_at = now(), locked_at = null, last_error = ${`DEAD_LETTER:${message}`}
            where id = ${event.id}
          `);
        });
        return;
      }
      const delaySeconds = retryDelaySeconds(event.attempts);
      await withWorkerContext(this.connection, (tx) =>
        tx.execute(sql`
          update outbox_events
          set locked_at = null, last_error = ${message}, available_at = now() + (${delaySeconds} * interval '1 second')
          where id = ${event.id}
        `),
      );
    }
  }

  private async dispatch(event: ClaimedOutboxEvent) {
    if (event.topic === "privacy.request.processing") {
      await processPrivacyRequest(this.db as Database, event);
      return;
    }
    if (event.topic === "pos.order.sent") {
      const result = await consumeOrderSentInventory(this.db as Database, event);
      if (result.retryRequired) {
        return new InventoryConsumptionError(
          `INVENTORY_ATTENTION_RETRY:${result.issueCodes.join(",")}`,
        );
      }
      return null;
    }
    if (event.topic === "growth.webhook_delivery_requested") {
      await this.deliverWebhookEvent(event);
      return null;
    }
    if (event.topic === "auth.password_reset_requested") {
      await this.deliverPasswordReset(event);
      return null;
    }
    if (event.topic === "auth.email_verification_requested") {
      await this.deliverEmailVerification(event);
      return null;
    }
    if (event.topic === "membership.invited") {
      await this.deliverMembershipInvite(event);
      return null;
    }
    if (event.topic === "growth.campaign_delivery_requested") {
      await this.deliverCampaignEmail(event);
      return null;
    }
    // Internal domain events are acknowledged here; dedicated consumers are added only with a real use case.
    return null;
  }

  private outboxEncryptionKey() {
    try {
      return encryptionKey(process.env.OUTBOX_ENCRYPTION_KEY, "OUTBOX_ENCRYPTION_KEY");
    } catch {
      throw new EmailDeliveryError("OUTBOX_ENCRYPTION_KEY_INVALID", true);
    }
  }

  private async deliverPasswordReset(event: ClaimedOutboxEvent) {
    if (
      event.aggregate_type !== "identity" ||
      event.aggregate_id !== requiredUuid(event.payload, "identityId")
    ) {
      throw new EmailDeliveryError("EMAIL_EVENT_CONTEXT_INVALID", false);
    }
    activeExpiry(event.payload);
    const [identity] = await this.db
      .select({ displayName: identities.displayName, email: identities.email })
      .from(identities)
      .where(eq(identities.id, event.aggregate_id))
      .limit(1);
    if (!identity) throw new EmailDeliveryError("EMAIL_RECIPIENT_NOT_FOUND", false);
    let token: string;
    try {
      token = decryptSecret(
        requiredEnvelope(event.payload, "resetTokenEnvelope"),
        this.outboxEncryptionKey(),
        `identity:${event.aggregate_id}`,
      );
    } catch (error) {
      if (error instanceof EmailDeliveryError) throw error;
      throw new EmailDeliveryError("EMAIL_SECRET_DECRYPTION_FAILED", false);
    }
    const configuration = emailProviderConfiguration();
    const actionUrl = `${configuration.appUrl}/recuperar-senha?token=${encodeURIComponent(token)}`;
    await deliverEmail(
      {
        to: identity.email,
        subject: "Redefina sua senha do GiroMesa",
        html: emailHtml({
          title: "Redefinição de senha",
          greeting: `Olá, ${identity.displayName}.`,
          body: "Recebemos uma solicitação para redefinir sua senha. O link expira em 30 minutos.",
          actionLabel: "Criar nova senha",
          actionUrl,
          footer:
            "Se você não fez esta solicitação, ignore esta mensagem. Sua senha atual continuará válida.",
        }),
        text: `Olá, ${identity.displayName}.\n\nUse o link abaixo para redefinir sua senha do GiroMesa. Ele expira em 30 minutos.\n\n${actionUrl}\n\nSe você não fez esta solicitação, ignore esta mensagem.`,
        idempotencyKey: `password-reset/${event.id}`,
        tags: [{ name: "message_type", value: "password_reset" }],
      },
      { configuration },
    );
  }

  private async deliverEmailVerification(event: ClaimedOutboxEvent) {
    if (
      event.aggregate_type !== "identity" ||
      event.aggregate_id !== requiredUuid(event.payload, "identityId")
    ) {
      throw new EmailDeliveryError("EMAIL_EVENT_CONTEXT_INVALID", false);
    }
    activeExpiry(event.payload);
    const [identity] = await this.db
      .select({
        displayName: identities.displayName,
        email: identities.email,
        emailVerifiedAt: identities.emailVerifiedAt,
      })
      .from(identities)
      .where(eq(identities.id, event.aggregate_id))
      .limit(1);
    if (!identity) throw new EmailDeliveryError("EMAIL_RECIPIENT_NOT_FOUND", false);
    if (identity.emailVerifiedAt) return;
    let token: string;
    try {
      token = decryptSecret(
        requiredEnvelope(event.payload, "verificationTokenEnvelope"),
        this.outboxEncryptionKey(),
        `email-verification:${event.aggregate_id}:${event.id}`,
      );
    } catch (error) {
      if (error instanceof EmailDeliveryError) throw error;
      throw new EmailDeliveryError("EMAIL_SECRET_DECRYPTION_FAILED", false);
    }
    const configuration = emailProviderConfiguration();
    const actionUrl = `${configuration.appUrl}/verificar-email#token=${encodeURIComponent(token)}`;
    await deliverEmail(
      {
        to: identity.email,
        subject: "Confirme seu e-mail no GiroMesa",
        html: emailHtml({
          title: "Confirme seu e-mail",
          greeting: `Olá, ${identity.displayName}.`,
          body: "Confirme seu endereço para proteger a conta e continuar a configuração do GiroMesa. O link expira em 24 horas.",
          actionLabel: "Verificar e-mail",
          actionUrl,
          footer:
            "Se você não criou esta conta, ignore esta mensagem. O link funciona uma única vez.",
        }),
        text: `Olá, ${identity.displayName}.\n\nConfirme seu e-mail para continuar a configuração do GiroMesa. O link expira em 24 horas e funciona uma única vez.\n\n${actionUrl}\n\nSe você não criou esta conta, ignore esta mensagem.`,
        idempotencyKey: `email-verification/${event.id}`,
        tags: [{ name: "message_type", value: "email_verification" }],
      },
      { configuration },
    );
  }

  private async deliverMembershipInvite(event: ClaimedOutboxEvent) {
    if (event.aggregate_type !== "membership_invitation" || !UUID.test(event.aggregate_id)) {
      throw new EmailDeliveryError("EMAIL_EVENT_CONTEXT_INVALID", false);
    }
    activeExpiry(event.payload);
    const [invitation] = await this.db
      .select({
        acceptedAt: membershipInvitations.acceptedAt,
        email: membershipInvitations.email,
        expiresAt: membershipInvitations.expiresAt,
        organizationName: organizations.tradeName,
        role: membershipInvitations.role,
      })
      .from(membershipInvitations)
      .innerJoin(organizations, eq(organizations.id, membershipInvitations.organizationId))
      .where(eq(membershipInvitations.id, event.aggregate_id))
      .limit(1);
    if (!invitation || invitation.acceptedAt || invitation.expiresAt <= new Date()) {
      throw new EmailDeliveryError("MEMBERSHIP_INVITATION_INACTIVE", false);
    }
    let token: string;
    try {
      token = decryptSecret(
        requiredEnvelope(event.payload, "invitationTokenEnvelope"),
        this.outboxEncryptionKey(),
        `membership-invitation:${event.aggregate_id}`,
      );
    } catch (error) {
      if (error instanceof EmailDeliveryError) throw error;
      throw new EmailDeliveryError("EMAIL_SECRET_DECRYPTION_FAILED", false);
    }
    const configuration = emailProviderConfiguration();
    const actionUrl = `${configuration.appUrl}/aceitar-convite?token=${encodeURIComponent(token)}`;
    const role = invitation.role === "owner" ? "proprietário" : invitation.role;
    await deliverEmail(
      {
        to: invitation.email,
        subject: `Convite para acessar ${invitation.organizationName} no GiroMesa`,
        html: emailHtml({
          title: "Você recebeu um convite",
          greeting: "Olá!",
          body: `${invitation.organizationName} convidou você para acessar o GiroMesa com o perfil ${role}. O convite expira em 7 dias.`,
          actionLabel: "Aceitar convite",
          actionUrl,
          footer:
            "O convite funciona somente para este e-mail. Se você não reconhece a empresa, ignore a mensagem.",
        }),
        text: `${invitation.organizationName} convidou você para acessar o GiroMesa com o perfil ${role}.\n\nAceite o convite: ${actionUrl}\n\nO convite expira em 7 dias e funciona somente para este e-mail.`,
        idempotencyKey: `membership-invite/${event.id}`,
        tags: [{ name: "message_type", value: "membership_invite" }],
      },
      { configuration },
    );
  }

  private async deliverCampaignEmail(event: ClaimedOutboxEvent) {
    if (
      event.aggregate_type !== "growth_campaign_delivery" ||
      event.aggregate_id !== requiredUuid(event.payload, "deliveryId")
    ) {
      throw new EmailDeliveryError("EMAIL_EVENT_CONTEXT_INVALID", false);
    }
    const organizationId = requiredUuid(event.payload, "organizationId");
    const campaignId = requiredUuid(event.payload, "campaignId");
    const customerId = requiredUuid(event.payload, "customerId");
    const requestedChannel = requiredString(event.payload, "channel");
    const [row] = await this.db
      .select({
        campaignChannel: marketingCampaigns.channel,
        campaignContent: marketingCampaigns.content,
        campaignName: marketingCampaigns.name,
        campaignSubject: marketingCampaigns.subject,
        customerArchivedAt: growthCustomers.archivedAt,
        customerEmail: growthCustomers.email,
        customerName: growthCustomers.name,
        customerOptIn: growthCustomers.marketingOptIn,
        deliveryId: campaignDeliveries.id,
        deliveryIdempotencyKey: campaignDeliveries.idempotencyKey,
        deliveryStatus: campaignDeliveries.status,
      })
      .from(campaignDeliveries)
      .innerJoin(
        marketingCampaigns,
        and(
          eq(marketingCampaigns.organizationId, campaignDeliveries.organizationId),
          eq(marketingCampaigns.id, campaignDeliveries.campaignId),
        ),
      )
      .innerJoin(
        growthCustomers,
        and(
          eq(growthCustomers.organizationId, campaignDeliveries.organizationId),
          eq(growthCustomers.id, campaignDeliveries.customerId),
        ),
      )
      .where(
        and(
          eq(campaignDeliveries.organizationId, organizationId),
          eq(campaignDeliveries.id, event.aggregate_id),
          eq(campaignDeliveries.campaignId, campaignId),
          eq(campaignDeliveries.customerId, customerId),
        ),
      )
      .limit(1);
    if (!row) throw new EmailDeliveryError("CAMPAIGN_DELIVERY_NOT_FOUND", false);
    if (row.campaignChannel !== requestedChannel) {
      await this.failCampaignDelivery(row.deliveryId, campaignId, "EMAIL_EVENT_CONTEXT_INVALID");
      throw new EmailDeliveryError("EMAIL_EVENT_CONTEXT_INVALID", false);
    }
    if (["sent", "skipped", "failed", "blocked"].includes(row.deliveryStatus)) return;
    if (requestedChannel !== "email") {
      await this.failCampaignDelivery(row.deliveryId, campaignId, "CAMPAIGN_CHANNEL_UNSUPPORTED");
      throw new EmailDeliveryError("CAMPAIGN_CHANNEL_UNSUPPORTED", false);
    }
    if (!row.customerOptIn || row.customerArchivedAt || !row.customerEmail) {
      await this.db
        .update(campaignDeliveries)
        .set({
          status: "skipped",
          errorCode: "CONSENT_OR_ADDRESS_UNAVAILABLE",
          updatedAt: new Date(),
        })
        .where(eq(campaignDeliveries.id, row.deliveryId));
      await this.finalizeCampaign(campaignId);
      return;
    }
    let optOutToken: string;
    try {
      optOutToken = decryptSecret(
        requiredEnvelope(event.payload, "optOutTokenEnvelope"),
        this.outboxEncryptionKey(),
        `campaign-delivery:${row.deliveryId}`,
      );
    } catch (error) {
      const deliveryError =
        error instanceof EmailDeliveryError
          ? error
          : new EmailDeliveryError("EMAIL_SECRET_DECRYPTION_FAILED", false);
      if (!deliveryError.retryable) {
        await this.failCampaignDelivery(row.deliveryId, campaignId, deliveryError.code);
      }
      throw deliveryError;
    }
    const configuration = emailProviderConfiguration();
    const optOutUrl = `${configuration.appUrl}/cancelar-comunicacoes?token=${encodeURIComponent(optOutToken)}`;
    await this.db
      .update(marketingCampaigns)
      .set({ status: "sending", updatedAt: new Date() })
      .where(and(eq(marketingCampaigns.id, campaignId), eq(marketingCampaigns.status, "queued")));
    try {
      const delivery = await deliverEmail(
        {
          to: row.customerEmail,
          subject: row.campaignSubject ?? row.campaignName,
          html: emailHtml({
            title: row.campaignName,
            greeting: `Olá, ${row.customerName}.`,
            body: row.campaignContent,
            actionLabel: "Gerenciar comunicações",
            actionUrl: optOutUrl,
            footer:
              "Você recebeu esta mensagem porque autorizou comunicações de marketing. Use o link acima para cancelar a qualquer momento.",
          }),
          text: `Olá, ${row.customerName}.\n\n${row.campaignContent}\n\nCancelar comunicações: ${optOutUrl}`,
          idempotencyKey: `campaign/${row.deliveryIdempotencyKey}`,
          headers: { "List-Unsubscribe": `<${optOutUrl}>` },
          tags: [
            { name: "message_type", value: "marketing_campaign" },
            { name: "campaign_id", value: campaignId },
          ],
        },
        { configuration },
      );
      await this.db
        .update(campaignDeliveries)
        .set({
          status: "sent",
          providerReference: delivery.providerReference,
          errorCode: null,
          sentAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(campaignDeliveries.id, row.deliveryId));
      await this.finalizeCampaign(campaignId);
    } catch (error) {
      if (error instanceof EmailDeliveryError) {
        await this.db
          .update(campaignDeliveries)
          .set({
            status: error.retryable ? "pending" : "failed",
            errorCode: error.code.slice(0, 80),
            updatedAt: new Date(),
          })
          .where(eq(campaignDeliveries.id, row.deliveryId));
        if (!error.retryable) await this.finalizeCampaign(campaignId);
      }
      throw error;
    }
  }

  private async failCampaignDelivery(deliveryId: string, campaignId: string, code: string) {
    await this.db
      .update(campaignDeliveries)
      .set({ status: "failed", errorCode: code, updatedAt: new Date() })
      .where(eq(campaignDeliveries.id, deliveryId));
    await this.finalizeCampaign(campaignId);
  }

  private async finalizeCampaign(campaignId: string) {
    const [summary] = await this.db
      .select({
        failed: sql<number>`count(*) filter (where ${campaignDeliveries.status} = 'failed')`,
        pending: sql<number>`count(*) filter (where ${campaignDeliveries.status} = 'pending')`,
      })
      .from(campaignDeliveries)
      .where(eq(campaignDeliveries.campaignId, campaignId));
    if (!summary || Number(summary.pending) > 0) return;
    const failed = Number(summary.failed) > 0;
    await this.db
      .update(marketingCampaigns)
      .set({
        status: failed ? "failed" : "sent",
        sentAt: failed ? null : new Date(),
        updatedAt: new Date(),
      })
      .where(eq(marketingCampaigns.id, campaignId));
  }

  private async deliverWebhookEvent(event: ClaimedOutboxEvent) {
    const request = parseWebhookDeliveryRequest(event.payload);
    if (
      event.aggregate_type !== "growth_webhook_publication" ||
      event.aggregate_id !== request.publicationId
    ) {
      throw new WebhookDeliveryError("WEBHOOK_DELIVERY_CONTEXT_INVALID");
    }
    const [publication] = await this.db
      .select({
        aggregateId: webhookPublications.aggregateId,
        aggregateType: webhookPublications.aggregateType,
        createdAt: webhookPublications.createdAt,
        eventType: webhookPublications.eventType,
        id: webhookPublications.id,
        organizationId: webhookPublications.organizationId,
        payload: webhookPublications.payload,
      })
      .from(webhookPublications)
      .where(
        and(
          eq(webhookPublications.organizationId, request.organizationId),
          eq(webhookPublications.id, request.publicationId),
        ),
      )
      .limit(1);
    const [endpoint] = await this.db
      .select({
        active: webhookEndpoints.active,
        eventTypes: webhookEndpoints.eventTypes,
        id: webhookEndpoints.id,
        organizationId: webhookEndpoints.organizationId,
        signingKeyVersion: webhookEndpoints.signingKeyVersion,
        url: webhookEndpoints.url,
      })
      .from(webhookEndpoints)
      .where(
        and(
          eq(webhookEndpoints.organizationId, request.organizationId),
          eq(webhookEndpoints.id, request.endpointId),
        ),
      )
      .limit(1);
    if (
      !publication ||
      !endpoint ||
      publication.organizationId !== request.organizationId ||
      endpoint.organizationId !== request.organizationId ||
      publication.eventType !== request.eventType ||
      endpoint.signingKeyVersion !== request.signingKeyVersion ||
      !endpoint.active ||
      !endpoint.eventTypes.includes(publication.eventType)
    ) {
      throw new WebhookDeliveryError("WEBHOOK_DELIVERY_CONTEXT_INVALID");
    }
    await deliverWebhook({
      ...request,
      endpointUrl: endpoint.url,
      publication: {
        aggregateId: publication.aggregateId,
        aggregateType: publication.aggregateType,
        createdAt: publication.createdAt,
        payload: publication.payload,
      },
    });
  }
}
