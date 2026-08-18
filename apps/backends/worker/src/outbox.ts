import {
  auditEvents,
  campaignDeliveries,
  createDatabase,
  growthCustomers,
  identities,
  marketingCampaigns,
  membershipInvitations,
  organizations,
  outboxEvents,
  posOrders,
  posTabs,
  webhookEndpoints,
  webhookPublications,
} from "@giromesa/db";
import {
  decryptSecret,
  encryptionKey,
  hasPermission,
  type SecretEnvelope,
  SYSTEM_ROLES,
  type SystemRole,
} from "@giromesa/domain";
import { and, eq, sql } from "drizzle-orm";
import {
  deliverEmail,
  EmailDeliveryError,
  emailHtml,
  emailProviderConfiguration,
} from "./email.js";
import {
  consumeOrderSentInventory,
  InventoryConsumptionError,
  reverseCanceledOrderItemInventory,
} from "./inventory.js";
import {
  ORDER_READY_NOTIFICATION_TOPIC,
  OrderReadyDeliveryError,
  parseOrderReadyNotificationRequest,
  planOrderReadyDelivery,
} from "./order-ready.js";
import { processDueReportSchedules } from "./reports.js";
import { deliverWebhook, parseWebhookDeliveryRequest, WebhookDeliveryError } from "./webhook.js";
import { deliverWhatsAppReady } from "./whatsapp.js";

export interface ClaimedOutboxEvent extends Record<string, unknown> {
  id: string;
  topic: string;
  aggregate_type: string;
  aggregate_id: string;
  payload: Record<string, unknown>;
  attempts: number;
}

interface OrderReadyDeliveryResult {
  kind: "order-ready-internal";
  organizationId: string;
  unitId: string;
  orderId: string;
  tabId: string;
  customerProviderReference?: string;
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
  private readonly connection = createDatabase();

  async runOnce(limit = 25) {
    return this.runClaimed(limit);
  }

  async runEvent(eventId: string) {
    if (!UUID.test(eventId)) throw new Error("INVALID_OUTBOX_EVENT_ID");
    return this.runClaimed(1, eventId);
  }

  private async runClaimed(limit: number, eventId?: string) {
    const rows = await this.connection.db.transaction(async (tx) => {
      const result = await tx.execute<ClaimedOutboxEvent>(sql`
        with claimed as (
          select events.id
          from outbox_events as events
          where events.processed_at is null
            and events.available_at <= now()
            and (events.locked_at is null or events.locked_at < now() - interval '5 minutes')
            ${eventId ? sql`and events.id = ${eventId}` : sql``}
          order by events.created_at
          for update skip locked
          limit ${limit}
        )
        update outbox_events as events
        set locked_at = now(), attempts = events.attempts + 1
        from claimed
        where events.id = claimed.id
        returning events.id, events.topic, events.aggregate_type, events.aggregate_id, events.payload, events.attempts
      `);
      return [...result];
    });

    for (const event of rows) await this.process(event);
    return rows.length;
  }

  async runDueReports(limit = 10, now = new Date()) {
    return processDueReportSchedules(this.connection.db, { limit, now });
  }

  async expireAccessWindows() {
    return this.connection.db.transaction(async (tx) => {
      const expiredTrials = await tx.execute<{ id: string }>(sql`
        update organizations as organization
        set billing_state = 'restricted',
            billing_state_changed_at = now(),
            operational_closure_until = now() + interval '12 hours',
            updated_at = now()
        from trials as trial
        where trial.organization_id = organization.id
          and organization.billing_state = 'trial_active'
          and trial.ends_at <= now()
        returning organization.id
      `);
      const expiredGrace = await tx.execute<{ id: string }>(sql`
        update organizations
        set billing_state = 'restricted',
            billing_state_changed_at = now(),
            operational_closure_until = now() + interval '12 hours',
            updated_at = now()
        where billing_state = 'grace'
          and billing_state_changed_at <= now() - interval '7 days'
        returning id
      `);
      const changed = [
        ...[...expiredTrials].map((row) => ({ ...row, reason: "trial_expired" })),
        ...[...expiredGrace].map((row) => ({ ...row, reason: "grace_expired" })),
      ];
      for (const item of changed) {
        await tx.insert(auditEvents).values({
          organizationId: item.id,
          action: `billing.${item.reason}`,
          entityType: "organization",
          entityId: item.id,
        });
        await tx.insert(outboxEvents).values({
          topic: "billing.state_changed",
          aggregateType: "organization",
          aggregateId: item.id,
          payload: { organizationId: item.id, to: "restricted", event: item.reason },
        });
      }
      return changed.length;
    });
  }

  async close() {
    await this.connection.client.end();
  }

  private async process(event: ClaimedOutboxEvent) {
    try {
      const result = await this.dispatch(event);
      await this.connection.db.transaction(async (tx) => {
        await tx.execute(
          sql`update outbox_events set processed_at = now(), locked_at = null, last_error = null where id = ${event.id}`,
        );
        if (result?.kind === "order-ready-internal") {
          await tx.insert(auditEvents).values({
            organizationId: result.organizationId,
            action: "pos.order.ready_notification_delivered_internal",
            entityType: "pos_order",
            entityId: result.orderId,
            metadata: {
              unitId: result.unitId,
              tabId: result.tabId,
              channel: "waiter",
              delivery: "internal",
              outboxEventId: event.id,
            },
          });
          if (result.customerProviderReference) {
            await tx.insert(auditEvents).values({
              organizationId: result.organizationId,
              action: "pos.order.ready_notification_provider_accepted",
              entityType: "pos_order",
              entityId: result.orderId,
              metadata: {
                unitId: result.unitId,
                tabId: result.tabId,
                channel: "customer",
                provider: "meta-cloud",
                providerReference: result.customerProviderReference,
                outboxEventId: event.id,
              },
            });
          }
        }
      });
    } catch (error) {
      const message =
        error instanceof Error ? error.message.slice(0, 2_000) : "Unknown worker error";
      if (error instanceof OrderReadyDeliveryError && error.disabled) {
        const organizationId = event.payload.organizationId;
        const scopedOrganizationId =
          typeof organizationId === "string" && UUID.test(organizationId)
            ? organizationId
            : undefined;
        await this.connection.db.transaction(async (tx) => {
          await tx.execute(sql`
            update outbox_events
            set processed_at = now(), locked_at = null, last_error = ${`DISABLED:${error.code}`}
            where id = ${event.id}
          `);
          const deliveredChannels = error.metadata.deliveredChannels;
          if (
            scopedOrganizationId &&
            Array.isArray(deliveredChannels) &&
            deliveredChannels.includes("waiter") &&
            UUID.test(event.aggregate_id)
          ) {
            await tx.insert(auditEvents).values({
              organizationId: scopedOrganizationId,
              action: "pos.order.ready_notification_delivered_internal",
              entityType: "pos_order",
              entityId: event.aggregate_id,
              metadata: {
                unitId: error.metadata.unitId,
                tabId: error.metadata.tabId,
                channel: "waiter",
                delivery: "internal",
                outboxEventId: event.id,
              },
            });
          }
          await tx.insert(auditEvents).values({
            organizationId: scopedOrganizationId,
            action: "outbox.delivery_disabled",
            entityType: "outbox_event",
            entityId: event.id,
            metadata: { topic: event.topic, code: error.code, ...error.metadata },
          });
        });
        return;
      }
      if (
        (error instanceof EmailDeliveryError || error instanceof OrderReadyDeliveryError) &&
        !error.retryable
      ) {
        await this.connection.db.transaction(async (tx) => {
          await tx.execute(sql`
            update outbox_events
            set processed_at = now(), locked_at = null, last_error = ${`DEAD_LETTER:${message}`}
            where id = ${event.id}
          `);
          await tx.insert(auditEvents).values({
            action: "outbox.delivery_dead_lettered",
            entityType: "outbox_event",
            entityId: event.id,
            metadata: { topic: event.topic, code: error.code },
          });
        });
        return;
      }
      const delaySeconds = retryDelaySeconds(event.attempts);
      await this.connection.db.execute(sql`
        update outbox_events
        set locked_at = null, last_error = ${message}, available_at = now() + (${delaySeconds} * interval '1 second')
        where id = ${event.id}
      `);
    }
  }

  private async dispatch(event: ClaimedOutboxEvent) {
    if (event.topic === "pos.order.sent") {
      const result = await consumeOrderSentInventory(this.connection.db, event);
      if (result.retryRequired) {
        throw new InventoryConsumptionError(
          `INVENTORY_ATTENTION_RETRY:${result.issueCodes.join(",")}`,
        );
      }
      return;
    }
    if (event.topic === "pos.item.canceled") {
      await reverseCanceledOrderItemInventory(this.connection.db, event);
      return;
    }
    if (event.topic === "growth.webhook_delivery_requested") {
      await this.deliverWebhookEvent(event);
      return;
    }
    if (event.topic === "auth.password_reset_requested") {
      await this.deliverPasswordReset(event);
      return;
    }
    if (event.topic === "membership.invited") {
      await this.deliverMembershipInvite(event);
      return;
    }
    if (event.topic === "growth.campaign_delivery_requested") {
      await this.deliverCampaignEmail(event);
      return;
    }
    if (event.topic === "management.report_export_email_requested") {
      await this.deliverReportExportEmail(event);
      return;
    }
    if (event.topic === ORDER_READY_NOTIFICATION_TOPIC) {
      return this.deliverOrderReadyNotification(event);
    }
    // Internal domain events are acknowledged here; dedicated consumers are added only with a real use case.
  }

  private outboxEncryptionKey() {
    try {
      return encryptionKey(process.env.OUTBOX_ENCRYPTION_KEY, "OUTBOX_ENCRYPTION_KEY");
    } catch {
      throw new EmailDeliveryError("OUTBOX_ENCRYPTION_KEY_INVALID", true);
    }
  }

  private async deliverOrderReadyNotification(
    event: ClaimedOutboxEvent,
  ): Promise<OrderReadyDeliveryResult | undefined> {
    const request = parseOrderReadyNotificationRequest(event);
    const [context] = await this.connection.db
      .select({
        customerPhone: posTabs.customerPhone,
        readyNotificationConsent: posTabs.readyNotificationConsent,
        tabLabel: posTabs.label,
        orderStatus: posOrders.status,
      })
      .from(posOrders)
      .innerJoin(
        posTabs,
        and(
          eq(posTabs.organizationId, posOrders.organizationId),
          eq(posTabs.unitId, posOrders.unitId),
          eq(posTabs.id, posOrders.tabId),
        ),
      )
      .where(
        and(
          eq(posOrders.organizationId, request.organizationId),
          eq(posOrders.unitId, request.unitId),
          eq(posOrders.id, request.orderId),
          eq(posOrders.tabId, request.tabId),
        ),
      )
      .limit(1);
    if (!context) throw new OrderReadyDeliveryError("ORDER_READY_EVENT_CONTEXT_INVALID", false);

    const plan = planOrderReadyDelivery(request, {
      orderStatus: context.orderStatus,
      customerPhone: context.customerPhone,
      readyNotificationConsent: context.readyNotificationConsent,
    });

    if (plan.disabled.length > 0) {
      throw new OrderReadyDeliveryError(
        plan.disabled.length === 1
          ? (plan.disabled.at(0)?.code ?? "ORDER_READY_CHANNELS_DISABLED")
          : "ORDER_READY_CHANNELS_DISABLED",
        false,
        true,
        {
          disabledChannels: plan.disabled,
          deliveredChannels: plan.internalWaiter ? ["waiter"] : [],
          orderId: request.orderId,
          tabId: request.tabId,
          unitId: request.unitId,
        },
      );
    }
    let customerProviderReference: string | undefined;
    if (plan.externalCustomer && context.customerPhone) {
      try {
        customerProviderReference = (
          await deliverWhatsAppReady({
            to: context.customerPhone,
            reference: context.tabLabel ?? request.orderId.slice(0, 8).toUpperCase(),
            idempotencyKey: `order-ready/${event.id}/customer`,
          })
        ).providerReference;
      } catch (error) {
        if (error instanceof OrderReadyDeliveryError) {
          throw new OrderReadyDeliveryError(error.code, error.retryable, error.disabled, {
            deliveredChannels: plan.internalWaiter ? ["waiter"] : [],
            orderId: request.orderId,
            tabId: request.tabId,
            unitId: request.unitId,
          });
        }
        throw error;
      }
    }
    return plan.internalWaiter || customerProviderReference
      ? {
          kind: "order-ready-internal",
          organizationId: request.organizationId,
          unitId: request.unitId,
          orderId: request.orderId,
          tabId: request.tabId,
          customerProviderReference,
        }
      : undefined;
  }

  private async deliverPasswordReset(event: ClaimedOutboxEvent) {
    if (
      event.aggregate_type !== "identity" ||
      event.aggregate_id !== requiredUuid(event.payload, "identityId")
    ) {
      throw new EmailDeliveryError("EMAIL_EVENT_CONTEXT_INVALID", false);
    }
    activeExpiry(event.payload);
    const [identity] = await this.connection.db
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

  private async deliverMembershipInvite(event: ClaimedOutboxEvent) {
    if (event.aggregate_type !== "membership_invitation" || !UUID.test(event.aggregate_id)) {
      throw new EmailDeliveryError("EMAIL_EVENT_CONTEXT_INVALID", false);
    }
    activeExpiry(event.payload);
    const [invitation] = await this.connection.db
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
    const [row] = await this.connection.db
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
      await this.connection.db
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
    await this.connection.db
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
      await this.connection.db
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
        await this.connection.db
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

  async deliverReportExportEmail(event: ClaimedOutboxEvent) {
    if (
      event.aggregate_type !== "management_report_export" ||
      event.aggregate_id !== requiredUuid(event.payload, "exportId")
    ) {
      throw new EmailDeliveryError("REPORT_EMAIL_EVENT_CONTEXT_INVALID", false);
    }
    const organizationId = requiredUuid(event.payload, "organizationId");
    const unitId = requiredUuid(event.payload, "unitId");
    const recipientIdentityId = requiredUuid(event.payload, "recipientIdentityId");
    const [report] = await this.connection.db.execute<{
      id: string;
      email: string;
      display_name: string;
      schedule_name: string;
      expires_at: Date | string;
      include_costs: boolean;
    }>(sql`
      select exports.id,
             identities.email,
             identities.display_name,
             schedules.name as schedule_name,
             exports.expires_at,
             coalesce((exports.query ->> 'includeCosts')::boolean, false) as include_costs
      from management_report_exports as exports
      inner join management_report_schedules as schedules
        on schedules.organization_id = exports.organization_id
       and schedules.unit_id = exports.unit_id
       and schedules.id = exports.schedule_id
      inner join identities on identities.id = ${recipientIdentityId}
      where exports.organization_id = ${organizationId}
        and exports.unit_id = ${unitId}
        and exports.id = ${event.aggregate_id}
        and exports.status = 'ready'
        and exports.format = 'csv'
        and schedules.delivery = 'email'
        and schedules.recipient_identity_id = ${recipientIdentityId}
      limit 1
    `);
    if (!report) throw new EmailDeliveryError("REPORT_EXPORT_NOT_AVAILABLE", false);
    if (new Date(report.expires_at) <= new Date()) {
      throw new EmailDeliveryError("REPORT_EXPORT_EXPIRED", false);
    }
    const roles = await this.connection.db.execute<{ role: string }>(sql`
      select bindings.role::text as role
      from memberships
      inner join role_bindings as bindings on bindings.membership_id = memberships.id
      where memberships.identity_id = ${recipientIdentityId}
        and memberships.organization_id = ${organizationId}
        and memberships.status = 'active'
        and (bindings.unit_id is null or bindings.unit_id = ${unitId})
    `);
    const authorized = roles.some(
      ({ role }) =>
        SYSTEM_ROLES.includes(role as SystemRole) &&
        hasPermission(role as SystemRole, "reports:export"),
    );
    if (!authorized) {
      throw new EmailDeliveryError("REPORT_RECIPIENT_NOT_AUTHORIZED", false);
    }
    const costsAuthorized = roles.some(
      ({ role }) =>
        SYSTEM_ROLES.includes(role as SystemRole) &&
        hasPermission(role as SystemRole, "reports:costs:read"),
    );
    if (report.include_costs && !costsAuthorized) {
      throw new EmailDeliveryError("REPORT_RECIPIENT_COSTS_NOT_AUTHORIZED", false);
    }
    const configuration = emailProviderConfiguration();
    const actionUrl = `${configuration.apiUrl}/v1/organizations/${organizationId}/units/${unitId}/management/reports/exports/${report.id}/content`;
    await deliverEmail(
      {
        to: report.email,
        subject: `Relatório GiroMesa — ${report.schedule_name}`,
        html: emailHtml({
          title: "Relatório gerencial disponível",
          greeting: `Olá, ${report.display_name}.`,
          body: `O relatório agendado “${report.schedule_name}” foi concluído e está disponível em CSV.`,
          actionLabel: "Abrir relatório",
          actionUrl,
          footer: "O acesso exige autenticação e a permissão de exportar relatórios nesta unidade.",
        }),
        text: `Olá, ${report.display_name}.\n\nO relatório agendado “${report.schedule_name}” está disponível em CSV.\n\n${actionUrl}\n\nO acesso exige autenticação e permissão nesta unidade.`,
        idempotencyKey: `report-export/${report.id}`,
        tags: [{ name: "message_type", value: "report_export" }],
      },
      { configuration },
    );
  }

  private async failCampaignDelivery(deliveryId: string, campaignId: string, code: string) {
    await this.connection.db
      .update(campaignDeliveries)
      .set({ status: "failed", errorCode: code, updatedAt: new Date() })
      .where(eq(campaignDeliveries.id, deliveryId));
    await this.finalizeCampaign(campaignId);
  }

  private async finalizeCampaign(campaignId: string) {
    const [summary] = await this.connection.db
      .select({
        failed: sql<number>`count(*) filter (where ${campaignDeliveries.status} = 'failed')`,
        pending: sql<number>`count(*) filter (where ${campaignDeliveries.status} = 'pending')`,
      })
      .from(campaignDeliveries)
      .where(eq(campaignDeliveries.campaignId, campaignId));
    if (!summary || Number(summary.pending) > 0) return;
    const failed = Number(summary.failed) > 0;
    await this.connection.db
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
    const [publication] = await this.connection.db
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
    const [endpoint] = await this.connection.db
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
