import { createHmac, randomBytes, randomUUID } from "node:crypto";
import {
  auditEvents,
  campaignDeliveries,
  commercialPlans,
  couponRedemptions,
  coupons,
  crmAutomationExecutions,
  crmAutomationRules,
  crmQuickReplies,
  customerConsents,
  customerSegments,
  deleteWhatsAppArtifact,
  deliveryCourierAssignments,
  deliveryCourierEvents,
  deliveryCouriers,
  deliveryDispatches,
  deliveryNotifications,
  deliveryOrderStatusHistory,
  deliveryOrders,
  deliveryZones,
  growthCustomers,
  growthIntegrations,
  identities,
  inventoryTransferLines,
  inventoryTransfers,
  loyaltyLedger,
  loyaltyPrograms,
  marketingCampaigns,
  marketingOptOutTokens,
  memberships,
  operationalCommands,
  outboxEvents,
  posPaymentReversals,
  posTabCustomerLinks,
  posTabPayments,
  posTabs,
  publicApiKeys,
  publicMenus,
  readWhatsAppArtifact,
  reservations,
  roleBindings,
  subscriptions,
  trials,
  unitPriceOverrides,
  units,
  waitlistEntries,
  webhookEndpoints,
  webhookPublications,
  whatsappConversations,
  whatsappMessages,
  writeWhatsAppArtifact,
} from "@giromesa/db";
import {
  encryptionKey,
  encryptSecret,
  evolutionCredentialReference,
  hasPermission,
  normalizeWhatsAppPhone,
  type OperationalCapability,
  SYSTEM_ROLES,
  type SystemRole,
} from "@giromesa/domain";
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
  UnauthorizedException,
} from "@nestjs/common";
import {
  and,
  asc,
  count,
  desc,
  eq,
  gt,
  gte,
  ilike,
  inArray,
  isNotNull,
  isNull,
  lt,
  lte,
  ne,
  or,
  type SQL,
  sql,
  sum,
} from "drizzle-orm";
import { DatabaseService } from "../database/database.module.js";
import { ScopeService } from "../organizations/scope.service.js";
import { EvolutionGoClient, EvolutionGoError } from "./evolution-go.js";
import {
  canTransition,
  couponDiscount,
  deliveryCoverageStatus,
  deliveryTransitions,
  hashOpaqueSecret,
  loyaltyEarn,
  marketingOptInAfter,
  payloadFingerprint,
  reservationTransitions,
  transferTransitions,
  waitlistTransitions,
} from "./growth.rules.js";
import type {
  ApiKeyInput,
  CampaignCancelInput,
  CampaignInput,
  ConsentInput,
  CouponInput,
  CouponRedemptionInput,
  CouponUpdateInput,
  CrmAutomationExecutionQueryInput,
  CrmAutomationRuleInput,
  CrmAutomationTestInput,
  CrmQuickReplyInput,
  CustomerArchiveInput,
  CustomerInput,
  CustomerListQueryInput,
  CustomerMergeInput,
  CustomerUpdateInput,
  DeliveryAddressValidationInput,
  DeliveryCourierAssignmentInput,
  DeliveryCourierCreateInput,
  DeliveryCourierPositionInput,
  DeliveryCourierStatusInput,
  DeliveryNotificationInput,
  DeliveryOrderInput,
  DeliveryOrderQueryInput,
  DeliveryTransitionInput,
  DeliveryZoneInput,
  DeliveryZoneUpdateInput,
  DispatchInput,
  DoseClubInput,
  EvolutionConfigurationInput,
  EvolutionWebhookInput,
  LoyaltyEarnInput,
  LoyaltyProgramInput,
  LoyaltyRedeemInput,
  LoyaltyReverseInput,
  PriceOverrideInput,
  PublicCouponValidationInput,
  PublicReservationInput,
  PublicWaitlistInput,
  ReservationInput,
  ReservationListQueryInput,
  ReservationTransitionInput,
  SegmentInput,
  TransferInput,
  TransferTransitionInput,
  WaitlistInput,
  WaitlistListQueryInput,
  WaitlistTransitionInput,
  WebhookEndpointInput,
  WebhookEventInput,
  WhatsAppConversationUpdateInput,
  WhatsAppInboxQueryInput,
  WhatsAppMessageInput,
  WhatsAppMessagesQueryInput,
} from "./growth.schemas.js";

type GrowthTransaction = Parameters<Parameters<DatabaseService["db"]["transaction"]>[0]>[0];

const MANAGERS = ["owner", "manager"] as const;
const FINANCIAL_READERS = ["owner", "manager", "finance"] as const;
const WEBHOOK_SCOPE = "webhooks:publish";
type PublicSubmissionContext = {
  policyVersion: string;
  privacyAccepted: true;
  source: "public_menu";
};

type GrowthEntitlement = "basic_crm" | "advanced_crm" | "loyalty" | "campaigns";

function normalizeCustomerEmail(value: string | null | undefined) {
  return value?.trim().toLowerCase() || null;
}

function normalizeCustomerPhone(value: string | null | undefined) {
  if (!value) return null;
  try {
    return `+${normalizeWhatsAppPhone(value)}`;
  } catch {
    throw new BadRequestException({
      code: "CUSTOMER_PHONE_INVALID",
      message: "Informe o telefone com DDD; números brasileiros serão salvos no padrão +55.",
    });
  }
}

function campaignExperimentVariant(
  campaign: { id: string; holdoutPercentage: number; variantBContent: string | null },
  customerId: string,
): "control" | "a" | "b" {
  const bucket =
    Number.parseInt(
      createHmac("sha256", campaign.id).update(customerId).digest("hex").slice(0, 8),
      16,
    ) % 100;
  if (bucket < campaign.holdoutPercentage) return "control";
  return campaign.variantBContent && (bucket - campaign.holdoutPercentage) % 2 === 1 ? "b" : "a";
}

function isWhatsAppOptOut(value: string) {
  const normalized = value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("pt-BR")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
  return [
    "sair",
    "pare",
    "parar",
    "stop",
    "cancelar",
    "cancelar mensagens",
    "nao quero receber",
    "remover meu numero",
  ].includes(normalized);
}

@Injectable()
export class GrowthService {
  constructor(
    private readonly database: DatabaseService,
    private readonly scope: ScopeService,
  ) {}

  private async requireEntitlement(organizationId: string, entitlement: GrowthEntitlement) {
    const [subscription] = await this.database.db
      .select({ entitlements: commercialPlans.entitlements })
      .from(subscriptions)
      .innerJoin(commercialPlans, eq(commercialPlans.id, subscriptions.commercialPlanId))
      .where(
        and(eq(subscriptions.organizationId, organizationId), ne(subscriptions.state, "canceled")),
      )
      .orderBy(desc(subscriptions.createdAt))
      .limit(1);
    const [trial] = subscription
      ? []
      : await this.database.db
          .select({ entitlements: commercialPlans.entitlements })
          .from(trials)
          .innerJoin(commercialPlans, eq(commercialPlans.id, trials.commercialPlanId))
          .where(
            and(
              eq(trials.organizationId, organizationId),
              lte(trials.startsAt, new Date()),
              gt(trials.endsAt, new Date()),
            ),
          )
          .limit(1);
    const entitlements = subscription?.entitlements ?? trial?.entitlements;
    // ponytail: organizações legadas sem vínculo comercial continuam operando até o backfill.
    if (!entitlements || entitlements.includes("all_growth") || entitlements.includes(entitlement))
      return;
    throw new ForbiddenException({
      code: "COMMERCIAL_ENTITLEMENT_REQUIRED",
      message: "O plano atual não inclui este recurso.",
      entitlement,
    });
  }

  private async assertUniqueCustomerContact(
    organizationId: string,
    input: { email?: string | null; phone?: string | null },
    excludingCustomerId?: string,
  ) {
    const email = normalizeCustomerEmail(input.email);
    const phone = normalizeCustomerPhone(input.phone);
    const phoneDigits = phone?.replace(/\D/g, "") ?? "";
    const localPhoneDigits = phoneDigits.startsWith("55") ? phoneDigits.slice(2) : phoneDigits;
    if (!email && !phone) return;
    const contacts = [
      ...(email ? [eq(growthCustomers.email, email)] : []),
      ...(phone
        ? [
            sql`regexp_replace(coalesce(${growthCustomers.phone}, ''), '[^0-9]', '', 'g') in (${phoneDigits}, ${localPhoneDigits})`,
          ]
        : []),
    ];
    const [duplicate] = await this.database.db
      .select({ id: growthCustomers.id })
      .from(growthCustomers)
      .where(
        and(
          eq(growthCustomers.organizationId, organizationId),
          isNull(growthCustomers.archivedAt),
          excludingCustomerId ? ne(growthCustomers.id, excludingCustomerId) : undefined,
          or(...contacts),
        ),
      )
      .limit(1);
    if (duplicate)
      throw new ConflictException({
        code: "CUSTOMER_CONTACT_ALREADY_EXISTS",
        message: "Já existe um cliente ativo com este e-mail ou telefone.",
        customerId: duplicate.id,
      });
  }

  private async requireUnitCapability(
    identityId: string,
    organizationId: string,
    unitId: string,
    capability: OperationalCapability,
  ) {
    await this.scope.requireUnitAccess(identityId, organizationId, unitId);
    const roles = await this.scope.requireOrganizationRole(
      identityId,
      organizationId,
      SYSTEM_ROLES,
    );
    if (
      !roles.some(
        (binding) =>
          (binding.unitId === null || binding.unitId === unitId) &&
          hasPermission(binding.role as SystemRole, capability),
      )
    ) {
      throw new ForbiddenException({
        code: "GROWTH_CAPABILITY_DENIED",
        message: "Ação de recepção não autorizada nesta unidade.",
        capability,
      });
    }
  }

  private async audit(
    tx: GrowthTransaction,
    input: {
      organizationId: string;
      unitId?: string | null;
      identityId?: string | null;
      action: string;
      entityType: string;
      entityId?: string | null;
      metadata?: Record<string, unknown>;
    },
  ) {
    await tx.insert(auditEvents).values({
      organizationId: input.organizationId,
      unitId: input.unitId ?? null,
      actorIdentityId: input.identityId ?? null,
      action: input.action,
      entityType: input.entityType,
      entityId: input.entityId ?? null,
      metadata: input.metadata ?? {},
    });
  }

  private async outbox(
    tx: GrowthTransaction,
    topic: string,
    aggregateType: string,
    aggregateId: string,
    payload: Record<string, unknown>,
  ) {
    await tx.insert(outboxEvents).values({ topic, aggregateType, aggregateId, payload });
  }

  private async customer(organizationId: string, customerId: string) {
    const [customer] = await this.database.db
      .select()
      .from(growthCustomers)
      .where(
        and(eq(growthCustomers.organizationId, organizationId), eq(growthCustomers.id, customerId)),
      )
      .limit(1);
    if (!customer)
      throw new NotFoundException({
        code: "CUSTOMER_NOT_FOUND",
        message: "Cliente não encontrado.",
      });
    return customer;
  }

  private idempotencyConflict(): never {
    throw new ConflictException({
      code: "IDEMPOTENCY_CONFLICT",
      message: "A chave de idempotência já foi usada com outro conteúdo.",
    });
  }

  private async publicMenuScope(slug: string) {
    const [menu] = await this.database.db
      .select({ organizationId: publicMenus.organizationId, unitId: publicMenus.unitId })
      .from(publicMenus)
      .where(
        and(
          eq(publicMenus.slug, slug),
          eq(publicMenus.active, true),
          isNotNull(publicMenus.publishedAt),
        ),
      )
      .limit(1);
    if (!menu)
      throw new NotFoundException({
        code: "PUBLIC_SERVICE_UNAVAILABLE",
        message: "Serviço público indisponível.",
      });
    return menu;
  }

  async listCustomers(identityId: string, organizationId: string) {
    await this.scope.requireOrganizationRole(identityId, organizationId, MANAGERS);
    await this.requireEntitlement(organizationId, "basic_crm");
    return this.database.db
      .select()
      .from(growthCustomers)
      .where(
        and(eq(growthCustomers.organizationId, organizationId), isNull(growthCustomers.archivedAt)),
      )
      .orderBy(asc(growthCustomers.name));
  }

  async listCustomerPage(
    identityId: string,
    organizationId: string,
    query: CustomerListQueryInput,
  ) {
    await this.scope.requireOrganizationRole(identityId, organizationId, MANAGERS);
    await this.requireEntitlement(organizationId, "basic_crm");
    if (query.unitId) await this.scope.requireUnitAccess(identityId, organizationId, query.unitId);
    const search = query.q?.split("·", 1)[0]?.trim();
    const searchDigits = search?.replace(/\D/g, "");
    const where = and(
      eq(growthCustomers.organizationId, organizationId),
      isNull(growthCustomers.archivedAt),
      query.unitId ? eq(growthCustomers.defaultUnitId, query.unitId) : undefined,
      search
        ? or(
            ilike(growthCustomers.name, `%${search}%`),
            ilike(growthCustomers.email, `%${search}%`),
            searchDigits
              ? sql`regexp_replace(coalesce(${growthCustomers.phone}, ''), '[^0-9]', '', 'g') like ${`%${searchDigits}%`}`
              : undefined,
          )
        : undefined,
    );
    const [items, [total]] = await Promise.all([
      this.database.db
        .select()
        .from(growthCustomers)
        .where(where)
        .orderBy(asc(growthCustomers.name), asc(growthCustomers.id))
        .limit(query.limit)
        .offset(query.offset),
      this.database.db.select({ value: count() }).from(growthCustomers).where(where),
    ]);
    return { items, total: Number(total?.value ?? 0), limit: query.limit, offset: query.offset };
  }

  async customerDetail(identityId: string, organizationId: string, customerId: string) {
    await this.scope.requireOrganizationRole(identityId, organizationId, MANAGERS);
    await this.requireEntitlement(organizationId, "basic_crm");
    const customer = await this.customer(organizationId, customerId);
    const now = new Date();
    const [
      consents,
      loyaltyEntries,
      [program],
      reservationRows,
      waitlistRows,
      deliveryRows,
      campaignRows,
      couponRows,
      whatsappRows,
      tabRows,
      [paymentRow],
      [reversalRow],
      [noShowRow],
      [balanceRow],
      [visitRow],
    ] = await Promise.all([
      this.database.db
        .select()
        .from(customerConsents)
        .where(
          and(
            eq(customerConsents.organizationId, organizationId),
            eq(customerConsents.customerId, customerId),
          ),
        )
        .orderBy(desc(customerConsents.occurredAt))
        .limit(50),
      this.database.db
        .select()
        .from(loyaltyLedger)
        .where(
          and(
            eq(loyaltyLedger.organizationId, organizationId),
            eq(loyaltyLedger.customerId, customerId),
          ),
        )
        .orderBy(desc(loyaltyLedger.createdAt))
        .limit(50),
      this.database.db
        .select()
        .from(loyaltyPrograms)
        .where(
          and(eq(loyaltyPrograms.organizationId, organizationId), eq(loyaltyPrograms.active, true)),
        )
        .limit(1),
      this.database.db
        .select()
        .from(reservations)
        .where(
          and(
            eq(reservations.organizationId, organizationId),
            eq(reservations.customerId, customerId),
          ),
        )
        .orderBy(desc(reservations.scheduledAt))
        .limit(30),
      this.database.db
        .select()
        .from(waitlistEntries)
        .where(
          and(
            eq(waitlistEntries.organizationId, organizationId),
            eq(waitlistEntries.customerId, customerId),
          ),
        )
        .orderBy(desc(waitlistEntries.joinedAt))
        .limit(30),
      this.database.db
        .select()
        .from(deliveryOrders)
        .where(
          and(
            eq(deliveryOrders.organizationId, organizationId),
            eq(deliveryOrders.customerId, customerId),
          ),
        )
        .orderBy(desc(deliveryOrders.createdAt))
        .limit(30),
      this.database.db
        .select({
          campaignId: marketingCampaigns.id,
          name: marketingCampaigns.name,
          channel: marketingCampaigns.channel,
          status: campaignDeliveries.status,
          createdAt: campaignDeliveries.createdAt,
          sentAt: campaignDeliveries.sentAt,
        })
        .from(campaignDeliveries)
        .innerJoin(
          marketingCampaigns,
          and(
            eq(marketingCampaigns.organizationId, campaignDeliveries.organizationId),
            eq(marketingCampaigns.id, campaignDeliveries.campaignId),
          ),
        )
        .where(
          and(
            eq(campaignDeliveries.organizationId, organizationId),
            eq(campaignDeliveries.customerId, customerId),
          ),
        )
        .orderBy(desc(campaignDeliveries.createdAt))
        .limit(30),
      this.database.db
        .select({
          couponId: coupons.id,
          code: coupons.code,
          discountCents: couponRedemptions.discountCents,
          redeemedAt: couponRedemptions.redeemedAt,
        })
        .from(couponRedemptions)
        .innerJoin(
          coupons,
          and(
            eq(coupons.organizationId, couponRedemptions.organizationId),
            eq(coupons.id, couponRedemptions.couponId),
          ),
        )
        .where(
          and(
            eq(couponRedemptions.organizationId, organizationId),
            eq(couponRedemptions.customerId, customerId),
          ),
        )
        .orderBy(desc(couponRedemptions.redeemedAt))
        .limit(30),
      this.database.db
        .select({
          id: whatsappMessages.id,
          direction: whatsappMessages.direction,
          body: whatsappMessages.body,
          status: whatsappMessages.status,
          occurredAt: whatsappMessages.occurredAt,
        })
        .from(whatsappMessages)
        .where(
          and(
            eq(whatsappMessages.organizationId, organizationId),
            eq(whatsappMessages.customerId, customerId),
          ),
        )
        .orderBy(desc(whatsappMessages.occurredAt))
        .limit(50),
      this.database.db
        .select({
          id: posTabs.id,
          unitId: posTabs.unitId,
          status: posTabs.status,
          fulfillmentType: posTabs.fulfillmentType,
          totalCents: posTabs.totalCents,
          createdAt: posTabs.createdAt,
          closedAt: posTabs.closedAt,
        })
        .from(posTabCustomerLinks)
        .innerJoin(
          posTabs,
          and(
            eq(posTabs.organizationId, posTabCustomerLinks.organizationId),
            eq(posTabs.unitId, posTabCustomerLinks.unitId),
            eq(posTabs.id, posTabCustomerLinks.tabId),
          ),
        )
        .where(
          and(
            eq(posTabCustomerLinks.organizationId, organizationId),
            eq(posTabCustomerLinks.customerId, customerId),
          ),
        )
        .orderBy(desc(posTabs.createdAt))
        .limit(50),
      this.database.db
        .select({ value: sum(posTabPayments.amountCents) })
        .from(posTabCustomerLinks)
        .innerJoin(
          posTabPayments,
          and(
            eq(posTabPayments.organizationId, posTabCustomerLinks.organizationId),
            eq(posTabPayments.unitId, posTabCustomerLinks.unitId),
            eq(posTabPayments.tabId, posTabCustomerLinks.tabId),
          ),
        )
        .where(
          and(
            eq(posTabCustomerLinks.organizationId, organizationId),
            eq(posTabCustomerLinks.customerId, customerId),
          ),
        ),
      this.database.db
        .select({ value: sum(posPaymentReversals.amountCents) })
        .from(posTabCustomerLinks)
        .innerJoin(
          posTabPayments,
          and(
            eq(posTabPayments.organizationId, posTabCustomerLinks.organizationId),
            eq(posTabPayments.unitId, posTabCustomerLinks.unitId),
            eq(posTabPayments.tabId, posTabCustomerLinks.tabId),
          ),
        )
        .innerJoin(
          posPaymentReversals,
          and(
            eq(posPaymentReversals.organizationId, posTabPayments.organizationId),
            eq(posPaymentReversals.unitId, posTabPayments.unitId),
            eq(posPaymentReversals.paymentId, posTabPayments.id),
            eq(posPaymentReversals.status, "approved"),
          ),
        )
        .where(
          and(
            eq(posTabCustomerLinks.organizationId, organizationId),
            eq(posTabCustomerLinks.customerId, customerId),
          ),
        ),
      this.database.db.execute<{ value: number }>(sql`
        select (
          (select count(*) from growth_reservations
            where organization_id = ${organizationId} and customer_id = ${customerId} and status = 'no_show') +
          (select count(*) from growth_waitlist_entries
            where organization_id = ${organizationId} and customer_id = ${customerId} and status = 'no_show')
        )::int as value
      `),
      this.database.db
        .select({ value: sum(loyaltyLedger.amount) })
        .from(loyaltyLedger)
        .where(
          and(
            eq(loyaltyLedger.organizationId, organizationId),
            eq(loyaltyLedger.customerId, customerId),
            or(isNull(loyaltyLedger.expiresAt), gt(loyaltyLedger.expiresAt, now)),
          ),
        ),
      this.database.db.execute<{ visits: number; lastVisitAt: Date | string | null }>(sql`
        select count(*)::int as visits, max(tab.closed_at) as "lastVisitAt"
        from growth_pos_tab_customer_links link
        inner join pos_tabs tab
          on tab.organization_id = link.organization_id
          and tab.unit_id = link.unit_id
          and tab.id = link.tab_id
        where link.organization_id = ${organizationId}
          and link.customer_id = ${customerId}
          and tab.status = 'closed'
      `),
    ]);
    const balance = Number(balanceRow?.value ?? 0);
    const visits = Number(visitRow?.visits ?? 0);
    const totalSpendCents = Number(paymentRow?.value ?? 0) - Number(reversalRow?.value ?? 0);
    const timeline = [
      ...tabRows.map((row) => ({
        kind: "service" as const,
        id: row.id,
        at: row.closedAt ?? row.createdAt,
        status: row.status,
        amountCents: row.totalCents,
        label: row.fulfillmentType,
      })),
      ...reservationRows.map((row) => ({
        kind: "reservation" as const,
        id: row.id,
        at: row.scheduledAt,
        status: row.status,
        label: `${row.partySize} pessoa(s)`,
      })),
      ...waitlistRows.map((row) => ({
        kind: "waitlist" as const,
        id: row.id,
        at: row.joinedAt,
        status: row.status,
        label: `${row.partySize} pessoa(s)`,
      })),
      ...deliveryRows.map((row) => ({
        kind: "delivery" as const,
        id: row.id,
        at: row.createdAt,
        status: row.status,
        amountCents: row.totalCents,
        label: row.fulfillment,
      })),
      ...campaignRows.map((row) => ({
        kind: "campaign" as const,
        id: row.campaignId,
        at: row.sentAt ?? row.createdAt,
        status: row.status,
        label: `${row.channel} · ${row.name}`,
      })),
      ...couponRows.map((row) => ({
        kind: "coupon" as const,
        id: row.couponId,
        at: row.redeemedAt,
        status: "redeemed",
        amountCents: row.discountCents,
        label: row.code,
      })),
      ...whatsappRows.map((row) => ({
        kind: "whatsapp" as const,
        id: row.id,
        at: row.occurredAt,
        status: row.status,
        label: `${row.direction === "inbound" ? "Recebida" : "Enviada"} · ${row.body.slice(0, 80) || "mídia"}`,
      })),
      ...loyaltyEntries.map((row) => ({
        kind: "loyalty" as const,
        id: row.id,
        at: row.createdAt,
        status: row.type,
        amount: row.amount,
        label: row.description ?? row.type,
      })),
    ]
      .sort((left, right) => right.at.getTime() - left.at.getTime())
      .slice(0, 100);
    return {
      customer,
      consent: {
        email: customer.emailMarketingOptIn,
        whatsapp: customer.whatsappMarketingOptIn,
        history: consents,
      },
      metrics: {
        visits,
        totalSpendCents,
        averageTicketCents: visits > 0 ? Math.round(totalSpendCents / visits) : 0,
        lastVisitAt: visitRow?.lastVisitAt ? new Date(visitRow.lastVisitAt).toISOString() : null,
        noShows: Number(noShowRow?.value ?? 0),
      },
      loyalty: { program: program ?? null, balance, entries: loyaltyEntries },
      timeline,
    };
  }

  async createCustomer(identityId: string, organizationId: string, input: CustomerInput) {
    await this.scope.requireOrganizationRole(identityId, organizationId, MANAGERS);
    await this.requireEntitlement(organizationId, "basic_crm");
    if (input.defaultUnitId)
      await this.scope.requireUnitAccess(identityId, organizationId, input.defaultUnitId);
    const requestFingerprint = payloadFingerprint(input);
    return this.database.db.transaction(async (tx) => {
      // ponytail: lock por organização; trocar por chave de contato se o cadastro virar gargalo.
      await tx.execute(
        sql`select pg_advisory_xact_lock(hashtext(${`growth-customer-contact:${organizationId}`}))`,
      );
      await this.assertUniqueCustomerContact(organizationId, input);
      const [created] = await tx
        .insert(growthCustomers)
        .values({
          organizationId,
          defaultUnitId: input.defaultUnitId ?? null,
          name: input.name,
          email: normalizeCustomerEmail(input.email),
          phone: normalizeCustomerPhone(input.phone),
          birthDate: input.birthDate ?? null,
          notes: input.notes ?? null,
          tags: input.tags,
          idempotencyKey: `managed:${randomUUID()}`,
          requestFingerprint,
        })
        .returning();
      if (!created) throw new Error("CUSTOMER_INSERT_FAILED");
      await this.audit(tx, {
        organizationId,
        identityId,
        action: "growth.customer.created",
        entityType: "growth_customer",
        entityId: created.id,
      });
      await this.outbox(tx, "growth.customer_created", "growth_customer", created.id, {
        organizationId,
        unitId: created.defaultUnitId,
        customerId: created.id,
      });
      return created;
    });
  }

  async updateCustomer(
    identityId: string,
    organizationId: string,
    customerId: string,
    input: CustomerUpdateInput,
  ) {
    await this.scope.requireOrganizationRole(identityId, organizationId, MANAGERS);
    await this.requireEntitlement(organizationId, "basic_crm");
    const customer = await this.customer(organizationId, customerId);
    if (customer.archivedAt)
      throw new ConflictException({
        code: "CUSTOMER_ARCHIVED",
        message: "Cliente arquivado não pode ser alterado.",
      });
    if (input.defaultUnitId)
      await this.scope.requireUnitAccess(identityId, organizationId, input.defaultUnitId);
    return this.database.db.transaction(async (tx) => {
      if (input.email !== undefined || input.phone !== undefined) {
        await tx.execute(
          sql`select pg_advisory_xact_lock(hashtext(${`growth-customer-contact:${organizationId}`}))`,
        );
        await this.assertUniqueCustomerContact(
          organizationId,
          {
            email: input.email === undefined ? customer.email : input.email,
            phone: input.phone === undefined ? customer.phone : input.phone,
          },
          customerId,
        );
      }
      const [updated] = await tx
        .update(growthCustomers)
        .set({
          ...(input.defaultUnitId !== undefined ? { defaultUnitId: input.defaultUnitId } : {}),
          ...(input.name !== undefined ? { name: input.name } : {}),
          ...(input.email !== undefined ? { email: normalizeCustomerEmail(input.email) } : {}),
          ...(input.phone !== undefined ? { phone: normalizeCustomerPhone(input.phone) } : {}),
          ...(input.birthDate !== undefined ? { birthDate: input.birthDate } : {}),
          ...(input.notes !== undefined ? { notes: input.notes } : {}),
          ...(input.tags !== undefined ? { tags: input.tags } : {}),
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(growthCustomers.organizationId, organizationId),
            eq(growthCustomers.id, customerId),
            isNull(growthCustomers.archivedAt),
          ),
        )
        .returning();
      if (!updated) throw new ConflictException({ code: "CUSTOMER_UPDATE_CONFLICT" });
      await this.audit(tx, {
        organizationId,
        identityId,
        action: "growth.customer.updated",
        entityType: "growth_customer",
        entityId: customerId,
        metadata: { fields: Object.keys(input).sort() },
      });
      return updated;
    });
  }

  async archiveCustomer(
    identityId: string,
    organizationId: string,
    customerId: string,
    input: CustomerArchiveInput,
  ) {
    await this.scope.requireOrganizationRole(identityId, organizationId, MANAGERS);
    await this.requireEntitlement(organizationId, "basic_crm");
    await this.customer(organizationId, customerId);
    const [openTab] = await this.database.db
      .select({ id: posTabs.id })
      .from(posTabCustomerLinks)
      .innerJoin(
        posTabs,
        and(
          eq(posTabs.organizationId, posTabCustomerLinks.organizationId),
          eq(posTabs.unitId, posTabCustomerLinks.unitId),
          eq(posTabs.id, posTabCustomerLinks.tabId),
        ),
      )
      .where(
        and(
          eq(posTabCustomerLinks.organizationId, organizationId),
          eq(posTabCustomerLinks.customerId, customerId),
          eq(posTabs.status, "open"),
        ),
      )
      .limit(1);
    if (openTab)
      throw new ConflictException({
        code: "CUSTOMER_HAS_OPEN_TAB",
        message: "Encerre a comanda vinculada antes de arquivar o cliente.",
        tabId: openTab.id,
      });
    return this.database.db.transaction(async (tx) => {
      const [archived] = await tx
        .update(growthCustomers)
        .set({
          archivedAt: new Date(),
          marketingOptIn: false,
          emailMarketingOptIn: false,
          whatsappMarketingOptIn: false,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(growthCustomers.organizationId, organizationId),
            eq(growthCustomers.id, customerId),
            isNull(growthCustomers.archivedAt),
          ),
        )
        .returning();
      if (!archived) return { archived: true, duplicate: true };
      await this.audit(tx, {
        organizationId,
        identityId,
        action: "growth.customer.archived",
        entityType: "growth_customer",
        entityId: customerId,
        metadata: { reason: input.reason },
      });
      return { archived: true, duplicate: false, customer: archived };
    });
  }

  async mergeCustomer(
    identityId: string,
    organizationId: string,
    targetCustomerId: string,
    input: CustomerMergeInput,
  ) {
    await this.scope.requireOrganizationRole(identityId, organizationId, MANAGERS);
    await this.requireEntitlement(organizationId, "basic_crm");
    if (targetCustomerId === input.sourceCustomerId)
      throw new BadRequestException({ code: "CUSTOMER_MERGE_SAME_RECORD" });
    return this.database.db.transaction(async (tx) => {
      const rows = await tx
        .select()
        .from(growthCustomers)
        .where(
          and(
            eq(growthCustomers.organizationId, organizationId),
            inArray(growthCustomers.id, [targetCustomerId, input.sourceCustomerId]),
          ),
        )
        .for("update");
      const target = rows.find((row) => row.id === targetCustomerId);
      const source = rows.find((row) => row.id === input.sourceCustomerId);
      if (!target || !source) throw new NotFoundException({ code: "CUSTOMER_NOT_FOUND" });
      if (target.archivedAt || source.archivedAt)
        throw new ConflictException({ code: "CUSTOMER_MERGE_ARCHIVED" });

      await tx.execute(sql`
        delete from growth_campaign_deliveries source
        using growth_campaign_deliveries target
        where source.organization_id = ${organizationId}
          and source.customer_id = ${source.id}
          and target.organization_id = source.organization_id
          and target.campaign_id = source.campaign_id
          and target.customer_id = ${target.id}
      `);
      await tx
        .update(customerConsents)
        .set({ customerId: target.id })
        .where(
          and(
            eq(customerConsents.organizationId, organizationId),
            eq(customerConsents.customerId, source.id),
          ),
        );
      await tx
        .update(marketingOptOutTokens)
        .set({ customerId: target.id })
        .where(
          and(
            eq(marketingOptOutTokens.organizationId, organizationId),
            eq(marketingOptOutTokens.customerId, source.id),
          ),
        );
      await tx
        .update(loyaltyLedger)
        .set({ customerId: target.id })
        .where(
          and(
            eq(loyaltyLedger.organizationId, organizationId),
            eq(loyaltyLedger.customerId, source.id),
          ),
        );
      await tx
        .update(couponRedemptions)
        .set({ customerId: target.id })
        .where(
          and(
            eq(couponRedemptions.organizationId, organizationId),
            eq(couponRedemptions.customerId, source.id),
          ),
        );
      await tx
        .update(campaignDeliveries)
        .set({ customerId: target.id })
        .where(
          and(
            eq(campaignDeliveries.organizationId, organizationId),
            eq(campaignDeliveries.customerId, source.id),
          ),
        );
      await tx
        .update(reservations)
        .set({ customerId: target.id })
        .where(
          and(
            eq(reservations.organizationId, organizationId),
            eq(reservations.customerId, source.id),
          ),
        );
      await tx
        .update(waitlistEntries)
        .set({ customerId: target.id })
        .where(
          and(
            eq(waitlistEntries.organizationId, organizationId),
            eq(waitlistEntries.customerId, source.id),
          ),
        );
      await tx
        .update(deliveryOrders)
        .set({ customerId: target.id })
        .where(
          and(
            eq(deliveryOrders.organizationId, organizationId),
            eq(deliveryOrders.customerId, source.id),
          ),
        );
      await tx
        .update(posTabCustomerLinks)
        .set({ customerId: target.id })
        .where(
          and(
            eq(posTabCustomerLinks.organizationId, organizationId),
            eq(posTabCustomerLinks.customerId, source.id),
          ),
        );
      const now = new Date();
      await tx
        .update(growthCustomers)
        .set({
          email: null,
          phone: null,
          marketingOptIn: false,
          emailMarketingOptIn: false,
          whatsappMarketingOptIn: false,
          archivedAt: now,
          mergedIntoCustomerId: target.id,
          updatedAt: now,
        })
        .where(
          and(
            eq(growthCustomers.organizationId, organizationId),
            eq(growthCustomers.id, source.id),
          ),
        );
      const [merged] = await tx
        .update(growthCustomers)
        .set({
          email: target.email ?? source.email,
          phone: target.phone ?? source.phone,
          birthDate: target.birthDate ?? source.birthDate,
          notes: target.notes ?? source.notes,
          tags: [...new Set([...target.tags, ...source.tags])],
          emailMarketingOptIn: target.emailMarketingOptIn || source.emailMarketingOptIn,
          whatsappMarketingOptIn: target.whatsappMarketingOptIn || source.whatsappMarketingOptIn,
          marketingOptIn:
            target.emailMarketingOptIn ||
            source.emailMarketingOptIn ||
            target.whatsappMarketingOptIn ||
            source.whatsappMarketingOptIn,
          updatedAt: now,
        })
        .where(
          and(
            eq(growthCustomers.organizationId, organizationId),
            eq(growthCustomers.id, target.id),
          ),
        )
        .returning();
      if (!merged) throw new ConflictException({ code: "CUSTOMER_MERGE_CONFLICT" });
      await this.audit(tx, {
        organizationId,
        identityId,
        action: "growth.customer.merged",
        entityType: "growth_customer",
        entityId: target.id,
        metadata: { sourceCustomerId: source.id, reason: input.reason },
      });
      return { customer: merged, mergedCustomerId: source.id };
    });
  }

  async recordConsent(
    identityId: string,
    organizationId: string,
    customerId: string,
    input: ConsentInput,
  ) {
    await this.scope.requireOrganizationRole(identityId, organizationId, MANAGERS);
    await this.requireEntitlement(organizationId, "basic_crm");
    return this.database.db.transaction(async (tx) => {
      const [customer] = await tx
        .select()
        .from(growthCustomers)
        .where(
          and(
            eq(growthCustomers.organizationId, organizationId),
            eq(growthCustomers.id, customerId),
            isNull(growthCustomers.archivedAt),
          ),
        )
        .for("update")
        .limit(1);
      if (!customer)
        throw new NotFoundException({
          code: "CUSTOMER_NOT_FOUND",
          message: "Cliente não encontrado.",
        });
      const [consent] = await tx
        .insert(customerConsents)
        .values({ organizationId, customerId, actorIdentityId: identityId, ...input })
        .returning();
      if (!consent) throw new Error("CONSENT_INSERT_FAILED");
      const emailMarketingOptIn =
        input.channel === "email" || input.channel === "all"
          ? marketingOptInAfter(input.decision)
          : customer.emailMarketingOptIn;
      const whatsappMarketingOptIn =
        input.channel === "whatsapp" || input.channel === "all"
          ? marketingOptInAfter(input.decision)
          : customer.whatsappMarketingOptIn;
      await tx
        .update(growthCustomers)
        .set({
          marketingOptIn: emailMarketingOptIn || whatsappMarketingOptIn,
          emailMarketingOptIn,
          whatsappMarketingOptIn,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(growthCustomers.organizationId, organizationId),
            eq(growthCustomers.id, customerId),
          ),
        );
      await this.audit(tx, {
        organizationId,
        identityId,
        action: `growth.consent.${input.decision}`,
        entityType: "growth_customer",
        entityId: customerId,
        metadata: {
          purpose: input.purpose,
          channel: input.channel,
          policyVersion: input.policyVersion,
        },
      });
      await this.outbox(tx, "growth.consent_changed", "growth_customer", customerId, {
        organizationId,
        unitId: customer.defaultUnitId,
        customerId,
        decision: input.decision,
      });
      return consent;
    });
  }

  async issueOptOutToken(identityId: string, organizationId: string, customerId: string) {
    await this.scope.requireOrganizationRole(identityId, organizationId, MANAGERS);
    await this.requireEntitlement(organizationId, "basic_crm");
    await this.customer(organizationId, customerId);
    const token = randomBytes(32).toString("base64url");
    const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
    await this.database.db.transaction(async (tx) => {
      await tx.insert(marketingOptOutTokens).values({
        organizationId,
        customerId,
        tokenHash: hashOpaqueSecret(token),
        expiresAt,
      });
      await this.audit(tx, {
        organizationId,
        identityId,
        action: "growth.opt_out_token.issued",
        entityType: "growth_customer",
        entityId: customerId,
        metadata: { expiresAt: expiresAt.toISOString() },
      });
    });
    return {
      token,
      expiresAt,
      warning: "O token é exibido uma única vez e não é armazenado em texto claro.",
    };
  }

  async optOut(token: string) {
    const tokenHash = hashOpaqueSecret(token);
    return this.database.db.transaction(async (tx) => {
      const [entry] = await tx
        .select()
        .from(marketingOptOutTokens)
        .where(eq(marketingOptOutTokens.tokenHash, tokenHash))
        .limit(1);
      if (!entry)
        throw new NotFoundException({
          code: "OPT_OUT_TOKEN_NOT_FOUND",
          message: "Token inválido.",
        });
      if (entry.usedAt) return { optedOut: true, alreadyProcessed: true };
      if (entry.expiresAt <= new Date())
        throw new BadRequestException({
          code: "OPT_OUT_TOKEN_EXPIRED",
          message: "Token expirado.",
        });
      const [claimed] = await tx
        .update(marketingOptOutTokens)
        .set({ usedAt: new Date() })
        .where(and(eq(marketingOptOutTokens.id, entry.id), isNull(marketingOptOutTokens.usedAt)))
        .returning();
      if (!claimed) return { optedOut: true, alreadyProcessed: true };
      const [customer] = await tx
        .update(growthCustomers)
        .set({
          marketingOptIn: false,
          emailMarketingOptIn: false,
          whatsappMarketingOptIn: false,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(growthCustomers.organizationId, entry.organizationId),
            eq(growthCustomers.id, entry.customerId),
          ),
        )
        .returning({ defaultUnitId: growthCustomers.defaultUnitId });
      await tx.insert(customerConsents).values({
        organizationId: entry.organizationId,
        customerId: entry.customerId,
        purpose: "marketing",
        decision: "withdrawn",
        channel: "all",
        source: "self_service_opt_out",
        legalBasis: "consent",
        policyVersion: "self-service",
      });
      await this.audit(tx, {
        organizationId: entry.organizationId,
        action: "growth.consent.withdrawn",
        entityType: "growth_customer",
        entityId: entry.customerId,
        metadata: { source: "self_service_opt_out" },
      });
      await this.outbox(tx, "growth.consent_changed", "growth_customer", entry.customerId, {
        organizationId: entry.organizationId,
        unitId: customer?.defaultUnitId ?? null,
        customerId: entry.customerId,
        decision: "withdrawn",
      });
      return { optedOut: true, alreadyProcessed: false };
    });
  }

  async configureLoyaltyProgram(
    identityId: string,
    organizationId: string,
    input: LoyaltyProgramInput,
  ) {
    await this.scope.requireOrganizationRole(identityId, organizationId, MANAGERS);
    await this.requireEntitlement(organizationId, "loyalty");
    return this.database.db.transaction(async (tx) => {
      await tx.execute(
        sql`select pg_advisory_xact_lock(hashtext(${`growth-loyalty:${organizationId}`}))`,
      );
      if (input.active)
        await tx
          .update(loyaltyPrograms)
          .set({ active: false, updatedAt: new Date() })
          .where(
            and(
              eq(loyaltyPrograms.organizationId, organizationId),
              eq(loyaltyPrograms.active, true),
            ),
          );
      const [created] = await tx
        .insert(loyaltyPrograms)
        .values({
          organizationId,
          mode: input.mode,
          rate: String(input.rate),
          minimumOrderCents: input.minimumOrderCents,
          expiresAfterDays: input.expiresAfterDays ?? null,
          active: input.active,
        })
        .returning();
      if (!created) throw new Error("LOYALTY_PROGRAM_INSERT_FAILED");
      await this.audit(tx, {
        organizationId,
        identityId,
        action: "growth.loyalty_program.configured",
        entityType: "growth_loyalty_program",
        entityId: created.id,
        metadata: { mode: created.mode, active: created.active },
      });
      return created;
    });
  }

  async loyaltyProgram(identityId: string, organizationId: string) {
    await this.scope.requireOrganizationRole(identityId, organizationId, MANAGERS);
    await this.requireEntitlement(organizationId, "loyalty");
    const [program] = await this.database.db
      .select()
      .from(loyaltyPrograms)
      .where(eq(loyaltyPrograms.organizationId, organizationId))
      .orderBy(desc(loyaltyPrograms.createdAt))
      .limit(1);
    return program ?? null;
  }

  async loyaltyBalance(identityId: string, organizationId: string, customerId: string) {
    await this.scope.requireOrganizationRole(identityId, organizationId, MANAGERS);
    await this.requireEntitlement(organizationId, "loyalty");
    await this.customer(organizationId, customerId);
    const [row] = await this.database.db
      .select({ balance: sum(loyaltyLedger.amount) })
      .from(loyaltyLedger)
      .where(
        and(
          eq(loyaltyLedger.organizationId, organizationId),
          eq(loyaltyLedger.customerId, customerId),
          or(isNull(loyaltyLedger.expiresAt), gt(loyaltyLedger.expiresAt, new Date())),
        ),
      );
    return { customerId, balance: Number(row?.balance ?? 0) };
  }

  async earnLoyalty(identityId: string, organizationId: string, input: LoyaltyEarnInput) {
    await this.scope.requireUnitAccess(identityId, organizationId, input.unitId);
    await this.requireEntitlement(organizationId, "loyalty");
    await this.customer(organizationId, input.customerId);
    const [program] = await this.database.db
      .select()
      .from(loyaltyPrograms)
      .where(
        and(eq(loyaltyPrograms.organizationId, organizationId), eq(loyaltyPrograms.active, true)),
      )
      .limit(1);
    if (!program)
      throw new ConflictException({
        code: "LOYALTY_PROGRAM_INACTIVE",
        message: "Programa inativo.",
      });
    const [command] = await this.database.db
      .select()
      .from(operationalCommands)
      .where(
        and(
          eq(operationalCommands.id, input.commandId),
          eq(operationalCommands.organizationId, organizationId),
          eq(operationalCommands.unitId, input.unitId),
          eq(operationalCommands.status, "accepted"),
        ),
      )
      .limit(1);
    if (!command || !["order.closed", "payment.completed"].includes(command.type))
      throw new BadRequestException({
        code: "LOYALTY_SOURCE_NOT_VERIFIED",
        message: "O crédito exige um comando operacional aceito de fechamento ou pagamento.",
      });
    const totalCents = command.payload.totalCents;
    const sourceCustomerId = command.payload.customerId;
    if (
      !Number.isSafeInteger(totalCents) ||
      Number(totalCents) < 0 ||
      sourceCustomerId !== input.customerId
    )
      throw new BadRequestException({
        code: "LOYALTY_SOURCE_INVALID",
        message: "O comando não contém cliente e total válidos para o crédito.",
      });
    const amount = loyaltyEarn(
      program.mode,
      Number(program.rate),
      Number(totalCents),
      program.minimumOrderCents,
    );
    if (amount <= 0)
      throw new BadRequestException({
        code: "LOYALTY_ZERO_EARN",
        message: "Pedido não gera saldo.",
      });
    const expiresAt = program.expiresAfterDays
      ? new Date(Date.now() + program.expiresAfterDays * 24 * 60 * 60 * 1000)
      : null;
    const requestFingerprint = payloadFingerprint({ input, programId: program.id, amount });
    const [inserted] = await this.database.db.transaction(async (tx) => {
      const rows = await tx
        .insert(loyaltyLedger)
        .values({
          organizationId,
          unitId: input.unitId,
          programId: program.id,
          customerId: input.customerId,
          sourceRef: input.commandId,
          type: "earn",
          amount,
          description: "Crédito derivado de comando operacional aceito",
          idempotencyKey: input.idempotencyKey,
          requestFingerprint,
          expiresAt,
        })
        .onConflictDoNothing()
        .returning();
      const row = rows[0];
      if (row) {
        await this.audit(tx, {
          organizationId,
          unitId: input.unitId,
          identityId,
          action: "growth.loyalty.earned",
          entityType: "growth_loyalty_entry",
          entityId: row.id,
          metadata: { customerId: input.customerId, amount, commandId: input.commandId },
        });
        await this.outbox(tx, "growth.loyalty_changed", "growth_customer", input.customerId, {
          organizationId,
          unitId: input.unitId,
          customerId: input.customerId,
          entryId: row.id,
          amount,
        });
      }
      return rows;
    });
    if (inserted) return { duplicate: false, entry: inserted };
    const [existing] = await this.database.db
      .select()
      .from(loyaltyLedger)
      .where(
        and(
          eq(loyaltyLedger.organizationId, organizationId),
          eq(loyaltyLedger.idempotencyKey, input.idempotencyKey),
        ),
      )
      .limit(1);
    if (!existing || existing.requestFingerprint !== requestFingerprint)
      return this.idempotencyConflict();
    return { duplicate: true, entry: existing };
  }

  async redeemLoyalty(identityId: string, organizationId: string, input: LoyaltyRedeemInput) {
    await this.scope.requireUnitAccess(identityId, organizationId, input.unitId);
    await this.requireEntitlement(organizationId, "loyalty");
    await this.customer(organizationId, input.customerId);
    const [program] = await this.database.db
      .select()
      .from(loyaltyPrograms)
      .where(
        and(eq(loyaltyPrograms.organizationId, organizationId), eq(loyaltyPrograms.active, true)),
      )
      .limit(1);
    if (!program)
      throw new ConflictException({
        code: "LOYALTY_PROGRAM_INACTIVE",
        message: "Programa inativo.",
      });
    const requestFingerprint = payloadFingerprint({ input, programId: program.id });
    const result = await this.database.db.transaction(async (tx) => {
      await tx.execute(
        sql`select pg_advisory_xact_lock(hashtext(${`growth-balance:${organizationId}:${input.customerId}`}))`,
      );
      const [existing] = await tx
        .select()
        .from(loyaltyLedger)
        .where(
          and(
            eq(loyaltyLedger.organizationId, organizationId),
            eq(loyaltyLedger.idempotencyKey, input.idempotencyKey),
          ),
        )
        .limit(1);
      if (existing) {
        if (existing.requestFingerprint !== requestFingerprint) return this.idempotencyConflict();
        return { duplicate: true, entry: existing };
      }
      const [balanceRow] = await tx
        .select({ balance: sum(loyaltyLedger.amount) })
        .from(loyaltyLedger)
        .where(
          and(
            eq(loyaltyLedger.organizationId, organizationId),
            eq(loyaltyLedger.customerId, input.customerId),
            or(isNull(loyaltyLedger.expiresAt), gt(loyaltyLedger.expiresAt, new Date())),
          ),
        );
      if (Number(balanceRow?.balance ?? 0) < input.amount)
        throw new ConflictException({
          code: "LOYALTY_INSUFFICIENT_BALANCE",
          message: "Saldo insuficiente.",
        });
      const [entry] = await tx
        .insert(loyaltyLedger)
        .values({
          organizationId,
          unitId: input.unitId,
          programId: program.id,
          customerId: input.customerId,
          sourceRef: input.sourceRef ?? null,
          type: "redeem",
          amount: -input.amount,
          description: "Resgate de fidelidade",
          idempotencyKey: input.idempotencyKey,
          requestFingerprint,
        })
        .returning();
      if (!entry) throw new Error("LOYALTY_REDEEM_INSERT_FAILED");
      await this.audit(tx, {
        organizationId,
        unitId: input.unitId,
        identityId,
        action: "growth.loyalty.redeemed",
        entityType: "growth_loyalty_entry",
        entityId: entry.id,
        metadata: { customerId: input.customerId, amount: input.amount },
      });
      await this.outbox(tx, "growth.loyalty_changed", "growth_customer", input.customerId, {
        organizationId,
        unitId: input.unitId,
        customerId: input.customerId,
        entryId: entry.id,
        amount: -input.amount,
      });
      return { duplicate: false, entry };
    });
    return result;
  }

  async reverseLoyalty(
    identityId: string,
    organizationId: string,
    entryId: string,
    input: LoyaltyReverseInput,
  ) {
    await this.scope.requireOrganizationRole(identityId, organizationId, MANAGERS);
    await this.requireEntitlement(organizationId, "loyalty");
    return this.database.db.transaction(async (tx) => {
      const [original] = await tx
        .select()
        .from(loyaltyLedger)
        .where(and(eq(loyaltyLedger.organizationId, organizationId), eq(loyaltyLedger.id, entryId)))
        .limit(1);
      if (!original)
        throw new NotFoundException({
          code: "LOYALTY_ENTRY_NOT_FOUND",
          message: "Lançamento não encontrado.",
        });
      const requestFingerprint = payloadFingerprint({ entryId, input });
      const [existing] = await tx
        .select()
        .from(loyaltyLedger)
        .where(
          and(
            eq(loyaltyLedger.organizationId, organizationId),
            eq(loyaltyLedger.idempotencyKey, input.idempotencyKey),
          ),
        )
        .limit(1);
      if (existing) {
        if (existing.requestFingerprint !== requestFingerprint) return this.idempotencyConflict();
        return { duplicate: true, entry: existing };
      }
      const [reversal] = await tx
        .insert(loyaltyLedger)
        .values({
          organizationId,
          unitId: original.unitId,
          programId: original.programId,
          customerId: original.customerId,
          sourceRef: original.sourceRef,
          type: "reverse",
          amount: -original.amount,
          description: `Estorno de ${original.id}`,
          idempotencyKey: input.idempotencyKey,
          requestFingerprint,
          reversalOfId: original.id,
        })
        .returning();
      if (!reversal) throw new Error("LOYALTY_REVERSE_INSERT_FAILED");
      await this.audit(tx, {
        organizationId,
        unitId: original.unitId,
        identityId,
        action: "growth.loyalty.reversed",
        entityType: "growth_loyalty_entry",
        entityId: reversal.id,
        metadata: { originalEntryId: original.id, amount: reversal.amount },
      });
      if (original.unitId)
        await this.outbox(tx, "growth.loyalty_changed", "growth_customer", original.customerId, {
          organizationId,
          unitId: original.unitId,
          customerId: original.customerId,
          entryId: reversal.id,
          amount: reversal.amount,
        });
      return { duplicate: false, entry: reversal };
    });
  }

  async listCoupons(identityId: string, organizationId: string) {
    await this.scope.requireOrganizationRole(identityId, organizationId, MANAGERS);
    await this.requireEntitlement(organizationId, "campaigns");
    return this.database.db
      .select()
      .from(coupons)
      .where(eq(coupons.organizationId, organizationId));
  }

  async createCoupon(identityId: string, organizationId: string, input: CouponInput) {
    await this.scope.requireOrganizationRole(identityId, organizationId, MANAGERS);
    await this.requireEntitlement(organizationId, "campaigns");
    if (input.unitId) await this.scope.requireUnitAccess(identityId, organizationId, input.unitId);
    for (const unitId of input.unitIds)
      await this.scope.requireUnitAccess(identityId, organizationId, unitId);
    return this.database.db.transaction(async (tx) => {
      const [coupon] = await tx
        .insert(coupons)
        .values({
          organizationId,
          unitId: input.unitId ?? null,
          code: input.code.toUpperCase(),
          type: input.type,
          value: input.value,
          minimumOrderCents: input.minimumOrderCents,
          maximumDiscountCents: input.maximumDiscountCents ?? null,
          validFrom: input.validFrom ?? new Date(),
          validUntil: input.validUntil ?? null,
          channels: input.channels,
          unitIds: input.unitIds,
          perCustomerLimit: input.perCustomerLimit,
          active: input.active,
        })
        .returning();
      if (!coupon) throw new Error("COUPON_INSERT_FAILED");
      await this.audit(tx, {
        organizationId,
        identityId,
        action: "growth.coupon.created",
        entityType: "growth_coupon",
        entityId: coupon.id,
        metadata: { code: coupon.code, type: coupon.type },
      });
      return coupon;
    });
  }

  async updateCoupon(
    identityId: string,
    organizationId: string,
    couponId: string,
    input: CouponUpdateInput,
  ) {
    await this.scope.requireOrganizationRole(identityId, organizationId, MANAGERS);
    await this.requireEntitlement(organizationId, "campaigns");
    const [current] = await this.database.db
      .select()
      .from(coupons)
      .where(and(eq(coupons.organizationId, organizationId), eq(coupons.id, couponId)))
      .limit(1);
    if (!current) throw new NotFoundException({ code: "COUPON_NOT_FOUND" });
    for (const unitId of input.unitIds ?? [])
      await this.scope.requireUnitAccess(identityId, organizationId, unitId);
    const nextType = input.type ?? current.type;
    const nextValue = input.value ?? current.value;
    const nextValidFrom = input.validFrom ?? current.validFrom;
    const nextValidUntil = input.validUntil === undefined ? current.validUntil : input.validUntil;
    if (nextType === "percentage" && nextValue > 10_000)
      throw new BadRequestException({ code: "COUPON_PERCENTAGE_INVALID" });
    if (nextValidUntil && nextValidUntil <= nextValidFrom)
      throw new BadRequestException({ code: "COUPON_INTERVAL_INVALID" });
    return this.database.db.transaction(async (tx) => {
      const [updated] = await tx
        .update(coupons)
        .set({
          ...(input.code !== undefined ? { code: input.code.toUpperCase() } : {}),
          ...(input.type !== undefined ? { type: input.type } : {}),
          ...(input.value !== undefined ? { value: input.value } : {}),
          ...(input.minimumOrderCents !== undefined
            ? { minimumOrderCents: input.minimumOrderCents }
            : {}),
          ...(input.maximumDiscountCents !== undefined
            ? { maximumDiscountCents: input.maximumDiscountCents }
            : {}),
          ...(input.validFrom !== undefined ? { validFrom: input.validFrom } : {}),
          ...(input.validUntil !== undefined ? { validUntil: input.validUntil } : {}),
          ...(input.channels !== undefined ? { channels: input.channels } : {}),
          ...(input.unitIds !== undefined ? { unitIds: input.unitIds } : {}),
          ...(input.perCustomerLimit !== undefined
            ? { perCustomerLimit: input.perCustomerLimit }
            : {}),
          ...(input.active !== undefined ? { active: input.active } : {}),
          updatedAt: new Date(),
        })
        .where(and(eq(coupons.organizationId, organizationId), eq(coupons.id, couponId)))
        .returning();
      if (!updated) throw new ConflictException({ code: "COUPON_UPDATE_CONFLICT" });
      await this.audit(tx, {
        organizationId,
        identityId,
        action: "growth.coupon.updated",
        entityType: "growth_coupon",
        entityId: couponId,
        metadata: { fields: Object.keys(input).sort() },
      });
      return updated;
    });
  }

  async validatePublicCoupon(slug: string, input: PublicCouponValidationInput) {
    const scope = await this.publicMenuScope(slug);
    const [coupon] = await this.database.db
      .select()
      .from(coupons)
      .where(
        and(
          eq(coupons.organizationId, scope.organizationId),
          eq(coupons.code, input.code.toUpperCase()),
          eq(coupons.active, true),
        ),
      )
      .limit(1);
    const now = new Date();
    if (
      !coupon ||
      coupon.validFrom > now ||
      (coupon.validUntil && coupon.validUntil <= now) ||
      (coupon.unitId && coupon.unitId !== scope.unitId) ||
      (coupon.unitIds.length > 0 && !coupon.unitIds.includes(scope.unitId)) ||
      (coupon.channels.length > 0 && !coupon.channels.includes(input.channel))
    )
      return { valid: false as const };
    const discountCents = couponDiscount(coupon, input.orderTotalCents);
    if (discountCents <= 0) return { valid: false as const };
    return { valid: true as const, discountCents };
  }

  async redeemCoupon(identityId: string, organizationId: string, input: CouponRedemptionInput) {
    await this.scope.requireUnitAccess(identityId, organizationId, input.unitId);
    await this.requireEntitlement(organizationId, "campaigns");
    const [tab] = await this.database.db
      .select({ id: posTabs.id, totalCents: posTabs.totalCents })
      .from(posTabs)
      .where(
        and(
          eq(posTabs.organizationId, organizationId),
          eq(posTabs.unitId, input.unitId),
          eq(posTabs.id, input.orderRef),
          eq(posTabs.status, "open"),
        ),
      )
      .limit(1);
    if (!tab)
      throw new BadRequestException({
        code: "COUPON_OPERATIONAL_TAB_NOT_FOUND",
        message: "O cupom exige uma comanda operacional aberta e persistida.",
      });
    const [link] = await this.database.db
      .select({ customerId: posTabCustomerLinks.customerId })
      .from(posTabCustomerLinks)
      .where(
        and(
          eq(posTabCustomerLinks.organizationId, organizationId),
          eq(posTabCustomerLinks.unitId, input.unitId),
          eq(posTabCustomerLinks.tabId, input.orderRef),
        ),
      )
      .limit(1);
    if (input.customerId && link && input.customerId !== link.customerId)
      throw new ConflictException({
        code: "COUPON_CUSTOMER_MISMATCH",
        message: "A comanda está vinculada a outro cliente.",
      });
    const customerId = input.customerId ?? link?.customerId;
    if (customerId) await this.customer(organizationId, customerId);
    const [coupon] = await this.database.db
      .select()
      .from(coupons)
      .where(
        and(
          eq(coupons.organizationId, organizationId),
          eq(coupons.code, input.code.toUpperCase()),
          eq(coupons.active, true),
        ),
      )
      .limit(1);
    const now = new Date();
    if (!coupon || coupon.validFrom > now || (coupon.validUntil && coupon.validUntil <= now))
      throw new BadRequestException({
        code: "COUPON_INVALID",
        message: "Cupom inválido ou expirado.",
      });
    if (coupon.unitId && coupon.unitId !== input.unitId)
      throw new BadRequestException({
        code: "COUPON_UNIT_RESTRICTED",
        message: "Cupom não disponível nesta unidade.",
      });
    if (coupon.unitIds.length > 0 && !coupon.unitIds.includes(input.unitId))
      throw new BadRequestException({
        code: "COUPON_UNIT_RESTRICTED",
        message: "Cupom não disponível nesta unidade.",
      });
    if (coupon.channels.length > 0 && !coupon.channels.includes(input.channel))
      throw new BadRequestException({
        code: "COUPON_CHANNEL_RESTRICTED",
        message: "Canal não permitido.",
      });
    const discountCents = couponDiscount(coupon, tab.totalCents);
    if (discountCents <= 0)
      throw new BadRequestException({
        code: "COUPON_MINIMUM_NOT_MET",
        message: "Pedido abaixo do mínimo.",
      });
    const requestFingerprint = payloadFingerprint({
      input: { ...input, customerId },
      couponId: coupon.id,
      operationalTotalCents: tab.totalCents,
      discountCents,
    });
    const [inserted] = await this.database.db.transaction(async (tx) => {
      if (customerId) {
        await tx.execute(
          sql`select pg_advisory_xact_lock(hashtext(${`growth-coupon:${organizationId}:${coupon.id}:${customerId}`}))`,
        );
        const [usage] = await tx
          .select({ total: count() })
          .from(couponRedemptions)
          .where(
            and(
              eq(couponRedemptions.organizationId, organizationId),
              eq(couponRedemptions.couponId, coupon.id),
              eq(couponRedemptions.customerId, customerId),
              ne(couponRedemptions.idempotencyKey, input.idempotencyKey),
            ),
          );
        if (Number(usage?.total ?? 0) >= coupon.perCustomerLimit)
          throw new BadRequestException({
            code: "COUPON_CUSTOMER_LIMIT",
            message: "Limite do cliente atingido.",
          });
      }
      const rows = await tx
        .insert(couponRedemptions)
        .values({
          organizationId,
          unitId: input.unitId,
          couponId: coupon.id,
          customerId: customerId ?? null,
          orderRef: input.orderRef,
          discountCents,
          idempotencyKey: input.idempotencyKey,
          requestFingerprint,
        })
        .onConflictDoNothing()
        .returning();
      const redemption = rows[0];
      if (redemption) {
        await this.audit(tx, {
          organizationId,
          unitId: input.unitId,
          identityId,
          action: "growth.coupon.redeemed",
          entityType: "growth_coupon_redemption",
          entityId: redemption.id,
          metadata: { couponId: coupon.id, orderRef: input.orderRef, discountCents },
        });
        await this.outbox(tx, "growth.coupon_redeemed", "growth_coupon", coupon.id, {
          organizationId,
          unitId: input.unitId,
          redemptionId: redemption.id,
          orderRef: input.orderRef,
          discountCents,
        });
      }
      return rows;
    });
    if (inserted) return { duplicate: false, redemption: inserted };
    const [existing] = await this.database.db
      .select()
      .from(couponRedemptions)
      .where(
        and(
          eq(couponRedemptions.organizationId, organizationId),
          or(
            eq(couponRedemptions.idempotencyKey, input.idempotencyKey),
            eq(couponRedemptions.orderRef, input.orderRef),
          ),
        ),
      )
      .limit(1);
    if (!existing || existing.requestFingerprint !== requestFingerprint)
      return this.idempotencyConflict();
    return { duplicate: true, redemption: existing };
  }

  async createSegment(identityId: string, organizationId: string, input: SegmentInput) {
    await this.scope.requireOrganizationRole(identityId, organizationId, MANAGERS);
    await this.requireEntitlement(organizationId, "advanced_crm");
    return this.database.db.transaction(async (tx) => {
      const [segment] = await tx
        .insert(customerSegments)
        .values({ organizationId, name: input.name, filters: input.filters, active: input.active })
        .returning();
      if (!segment) throw new Error("SEGMENT_INSERT_FAILED");
      await this.audit(tx, {
        organizationId,
        identityId,
        action: "growth.segment.created",
        entityType: "growth_customer_segment",
        entityId: segment.id,
        metadata: { filters: input.filters },
      });
      return segment;
    });
  }

  async listSegments(identityId: string, organizationId: string) {
    await this.scope.requireOrganizationRole(identityId, organizationId, MANAGERS);
    await this.requireEntitlement(organizationId, "advanced_crm");
    return this.database.db
      .select()
      .from(customerSegments)
      .where(eq(customerSegments.organizationId, organizationId));
  }

  async createCampaign(identityId: string, organizationId: string, input: CampaignInput) {
    await this.scope.requireOrganizationRole(identityId, organizationId, MANAGERS);
    await this.requireEntitlement(organizationId, "campaigns");
    if (input.unitId) await this.scope.requireUnitAccess(identityId, organizationId, input.unitId);
    if (input.segmentId) {
      const [segment] = await this.database.db
        .select({ id: customerSegments.id })
        .from(customerSegments)
        .where(
          and(
            eq(customerSegments.organizationId, organizationId),
            eq(customerSegments.id, input.segmentId),
            eq(customerSegments.active, true),
          ),
        )
        .limit(1);
      if (!segment)
        throw new NotFoundException({
          code: "SEGMENT_NOT_FOUND",
          message: "Segmento não encontrado.",
        });
    }
    return this.database.db.transaction(async (tx) => {
      const [campaign] = await tx
        .insert(marketingCampaigns)
        .values({
          organizationId,
          unitId: input.unitId ?? null,
          segmentId: input.segmentId ?? null,
          name: input.name,
          channel: input.channel,
          subject: input.subject ?? null,
          content: input.content,
          variantBContent: input.variantBContent ?? null,
          attributionWindowDays: input.attributionWindowDays,
          holdoutPercentage: input.holdoutPercentage,
          createdByIdentityId: identityId,
        })
        .returning();
      if (!campaign) throw new Error("CAMPAIGN_INSERT_FAILED");
      await this.audit(tx, {
        organizationId,
        unitId: campaign.unitId,
        identityId,
        action: "growth.campaign.created",
        entityType: "growth_campaign",
        entityId: campaign.id,
        metadata: { channel: campaign.channel, status: campaign.status },
      });
      if (campaign.unitId)
        await this.outbox(tx, "growth.campaign_created", "growth_campaign", campaign.id, {
          organizationId,
          unitId: campaign.unitId,
          campaignId: campaign.id,
          status: campaign.status,
        });
      return campaign;
    });
  }

  async listCampaigns(identityId: string, organizationId: string) {
    await this.scope.requireOrganizationRole(identityId, organizationId, MANAGERS);
    await this.requireEntitlement(organizationId, "campaigns");
    return this.database.db
      .select()
      .from(marketingCampaigns)
      .where(eq(marketingCampaigns.organizationId, organizationId))
      .orderBy(desc(marketingCampaigns.createdAt));
  }

  private async campaignAudience(campaign: typeof marketingCampaigns.$inferSelect) {
    let filter: Record<string, unknown> = { kind: "marketing_opt_in" };
    if (campaign.segmentId) {
      const [segment] = await this.database.db
        .select()
        .from(customerSegments)
        .where(
          and(
            eq(customerSegments.organizationId, campaign.organizationId),
            eq(customerSegments.id, campaign.segmentId),
            eq(customerSegments.active, true),
          ),
        )
        .limit(1);
      if (!segment)
        throw new NotFoundException({
          code: "SEGMENT_NOT_FOUND",
          message: "Segmento não encontrado.",
        });
      filter = segment.filters;
    }
    const kind = typeof filter.kind === "string" ? filter.kind : "marketing_opt_in";
    let behaviorFilter: SQL | undefined;
    if (kind === "birthday_month") {
      behaviorFilter = sql`substring(${growthCustomers.birthDate}, 6, 2)::int = ${Number(filter.month)}`;
    } else if (kind === "inactive_days") {
      const cutoff = new Date(Date.now() - Number(filter.days) * 24 * 60 * 60 * 1000);
      behaviorFilter = sql`not exists (
        select 1 from growth_pos_tab_customer_links links
        inner join pos_tabs tabs
          on tabs.organization_id = links.organization_id
         and tabs.unit_id = links.unit_id
         and tabs.id = links.tab_id
        where links.organization_id = ${campaign.organizationId}
          and links.customer_id = ${growthCustomers.id}
          and tabs.status = 'closed'
          and tabs.closed_at >= ${cutoff}
      )`;
    } else if (kind === "minimum_visits") {
      behaviorFilter = sql`(
        select count(*) from growth_pos_tab_customer_links links
        inner join pos_tabs tabs
          on tabs.organization_id = links.organization_id
         and tabs.unit_id = links.unit_id
         and tabs.id = links.tab_id
        where links.organization_id = ${campaign.organizationId}
          and links.customer_id = ${growthCustomers.id}
          and tabs.status = 'closed'
      ) >= ${Number(filter.visits)}`;
    } else if (kind === "minimum_spend_cents") {
      behaviorFilter = sql`(
        coalesce((
          select sum(payments.amount_cents) from growth_pos_tab_customer_links links
          inner join pos_tab_payments payments
            on payments.organization_id = links.organization_id
           and payments.unit_id = links.unit_id
           and payments.tab_id = links.tab_id
          where links.organization_id = ${campaign.organizationId}
            and links.customer_id = ${growthCustomers.id}
        ), 0) - coalesce((
          select sum(reversals.amount_cents) from growth_pos_tab_customer_links links
          inner join pos_tab_payments payments
            on payments.organization_id = links.organization_id
           and payments.unit_id = links.unit_id
           and payments.tab_id = links.tab_id
          inner join pos_payment_reversals reversals
            on reversals.organization_id = payments.organization_id
           and reversals.unit_id = payments.unit_id
           and reversals.payment_id = payments.id
           and reversals.status = 'approved'
        where links.organization_id = ${campaign.organizationId}
          and links.customer_id = ${growthCustomers.id}
        ), 0)
      ) >= ${Number(filter.amountCents)}`;
    } else if (kind === "no_show_count") {
      behaviorFilter = sql`(
        (select count(*) from growth_reservations reservations
          where reservations.organization_id = ${campaign.organizationId}
            and reservations.customer_id = ${growthCustomers.id}
            and reservations.status = 'no_show') +
        (select count(*) from growth_waitlist_entries waitlist
          where waitlist.organization_id = ${campaign.organizationId}
            and waitlist.customer_id = ${growthCustomers.id}
            and waitlist.status = 'no_show')
      ) >= ${Number(filter.count)}`;
    }
    const where = and(
      eq(growthCustomers.organizationId, campaign.organizationId),
      isNull(growthCustomers.archivedAt),
      campaign.channel === "email"
        ? and(eq(growthCustomers.emailMarketingOptIn, true), isNotNull(growthCustomers.email))
        : and(eq(growthCustomers.whatsappMarketingOptIn, true), isNotNull(growthCustomers.phone)),
      campaign.unitId
        ? or(
            eq(growthCustomers.defaultUnitId, campaign.unitId),
            sql`exists (
              select 1 from growth_pos_tab_customer_links links
              where links.organization_id = ${campaign.organizationId}
                and links.unit_id = ${campaign.unitId}
                and links.customer_id = ${growthCustomers.id}
            )`,
          )
        : undefined,
      behaviorFilter,
    );
    const [recipients, [eligible], [active]] = await Promise.all([
      this.database.db
        .select()
        .from(growthCustomers)
        .where(where)
        .orderBy(asc(growthCustomers.id))
        .limit(501),
      this.database.db.select({ value: count() }).from(growthCustomers).where(where),
      this.database.db
        .select({ value: count() })
        .from(growthCustomers)
        .where(
          and(
            eq(growthCustomers.organizationId, campaign.organizationId),
            isNull(growthCustomers.archivedAt),
          ),
        ),
    ]);
    return {
      filter,
      recipients,
      eligible: Number(eligible?.value ?? 0),
      activeCustomers: Number(active?.value ?? 0),
    };
  }

  private async providerReady(
    channel: "email" | "whatsapp",
    organizationId: string,
    unitId: string | null,
  ) {
    if (channel === "whatsapp") {
      if (process.env.WHATSAPP_PROVIDER_ENABLED !== "true") return false;
      const [integration] = await this.database.db
        .select({ id: growthIntegrations.id })
        .from(growthIntegrations)
        .where(
          and(
            eq(growthIntegrations.organizationId, organizationId),
            unitId ? eq(growthIntegrations.unitId, unitId) : undefined,
            eq(growthIntegrations.provider, "evolution_go"),
            eq(growthIntegrations.status, "ready"),
          ),
        )
        .limit(1);
      return Boolean(integration);
    }
    const prefix = "EMAIL";
    return (
      process.env[`${prefix}_PROVIDER_ENABLED`] === "true" &&
      Boolean(process.env[`${prefix}_PROVIDER_CREDENTIAL_REFERENCE`])
    );
  }

  async queueCampaign(identityId: string, organizationId: string, campaignId: string) {
    await this.scope.requireOrganizationRole(identityId, organizationId, MANAGERS);
    await this.requireEntitlement(organizationId, "campaigns");
    const [campaign] = await this.database.db
      .select()
      .from(marketingCampaigns)
      .where(
        and(
          eq(marketingCampaigns.organizationId, organizationId),
          eq(marketingCampaigns.id, campaignId),
        ),
      )
      .limit(1);
    if (!campaign)
      throw new NotFoundException({
        code: "CAMPAIGN_NOT_FOUND",
        message: "Campanha não encontrada.",
      });
    if (["queued", "sending", "sent"].includes(campaign.status))
      return { status: campaign.status, duplicate: true, queuedRecipients: 0 };
    if (campaign.status === "canceled")
      throw new ConflictException({
        code: "CAMPAIGN_CANCELED",
        message: "Campanha cancelada não pode ser enfileirada.",
      });
    if (!(await this.providerReady(campaign.channel, organizationId, campaign.unitId))) {
      const providerCode =
        campaign.channel === "whatsapp" ? "EVOLUTION_NOT_LOGGED_IN" : "PROVIDER_NOT_CONFIGURED";
      const blocked = await this.database.db.transaction(async (tx) => {
        await tx.execute(
          sql`select pg_advisory_xact_lock(hashtext(${`growth-campaign:${organizationId}:${campaignId}`}))`,
        );
        const [current] = await tx
          .select({ status: marketingCampaigns.status })
          .from(marketingCampaigns)
          .where(
            and(
              eq(marketingCampaigns.organizationId, organizationId),
              eq(marketingCampaigns.id, campaignId),
            ),
          )
          .for("update")
          .limit(1);
        if (!current) throw new NotFoundException({ code: "CAMPAIGN_NOT_FOUND" });
        if (current.status === "canceled")
          throw new ConflictException({ code: "CAMPAIGN_CANCELED" });
        if (current.status === "blocked") return false;
        if (["queued", "sending", "sent"].includes(current.status)) return false;
        await tx
          .update(marketingCampaigns)
          .set({ status: "blocked", updatedAt: new Date() })
          .where(
            and(
              eq(marketingCampaigns.organizationId, organizationId),
              eq(marketingCampaigns.id, campaignId),
            ),
          );
        await this.audit(tx, {
          organizationId,
          unitId: campaign.unitId,
          identityId,
          action: "growth.campaign.blocked",
          entityType: "growth_campaign",
          entityId: campaign.id,
          metadata: { code: providerCode, channel: campaign.channel },
        });
        if (campaign.unitId)
          await this.outbox(tx, "growth.campaign_blocked", "growth_campaign", campaign.id, {
            organizationId,
            unitId: campaign.unitId,
            campaignId: campaign.id,
            status: "blocked",
            code: providerCode,
          });
        return true;
      });
      return {
        status: "blocked",
        code: providerCode,
        duplicate: !blocked,
        queuedRecipients: 0,
      };
    }
    const audience = await this.campaignAudience(campaign);
    if (audience.eligible > 500)
      throw new BadRequestException({
        code: "CAMPAIGN_RECIPIENT_LIMIT",
        message: "A campanha excede o limite operacional de 500 destinatários por lote.",
      });
    const recipients = audience.recipients;
    const outboxEncryption = recipients.length
      ? encryptionKey(process.env.OUTBOX_ENCRYPTION_KEY, "OUTBOX_ENCRYPTION_KEY")
      : null;
    const queueResult = await this.database.db.transaction(async (tx) => {
      await tx.execute(
        sql`select pg_advisory_xact_lock(hashtext(${`growth-campaign:${organizationId}:${campaignId}`}))`,
      );
      const [current] = await tx
        .select({ status: marketingCampaigns.status })
        .from(marketingCampaigns)
        .where(
          and(
            eq(marketingCampaigns.organizationId, organizationId),
            eq(marketingCampaigns.id, campaignId),
          ),
        )
        .for("update")
        .limit(1);
      if (!current) throw new NotFoundException({ code: "CAMPAIGN_NOT_FOUND" });
      if (["queued", "sending", "sent"].includes(current.status))
        return { status: current.status, duplicate: true, queuedRecipients: 0 };
      if (current.status === "canceled") throw new ConflictException({ code: "CAMPAIGN_CANCELED" });
      let queued = 0;
      let heldOut = 0;
      for (const customer of recipients) {
        if (!outboxEncryption) throw new Error("CAMPAIGN_ENCRYPTION_KEY_UNAVAILABLE");
        const deliveryIdempotency = `${campaign.id}:${customer.id}`;
        const experimentVariant = campaignExperimentVariant(campaign, customer.id);
        const [delivery] = await tx
          .insert(campaignDeliveries)
          .values({
            organizationId,
            campaignId: campaign.id,
            customerId: customer.id,
            idempotencyKey: deliveryIdempotency,
            experimentVariant,
            status: experimentVariant === "control" ? "holdout" : "pending",
          })
          .onConflictDoNothing()
          .returning();
        if (!delivery) continue;
        if (experimentVariant === "control") {
          heldOut += 1;
          continue;
        }
        queued += 1;
        const optOutToken = randomBytes(32).toString("base64url");
        const optOutExpiresAt = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000);
        await tx.insert(marketingOptOutTokens).values({
          organizationId,
          customerId: customer.id,
          tokenHash: hashOpaqueSecret(optOutToken),
          expiresAt: optOutExpiresAt,
        });
        await this.outbox(
          tx,
          "growth.campaign_delivery_requested",
          "growth_campaign_delivery",
          delivery.id,
          {
            organizationId,
            unitId: campaign.unitId ?? customer.defaultUnitId,
            campaignId: campaign.id,
            deliveryId: delivery.id,
            customerId: customer.id,
            channel: campaign.channel,
            optOutTokenEnvelope: encryptSecret(
              optOutToken,
              outboxEncryption,
              `campaign-delivery:${delivery.id}`,
            ),
          },
        );
      }
      const completedAt = queued === 0 ? new Date() : null;
      const resultingStatus = completedAt ? "sent" : "queued";
      await tx
        .update(marketingCampaigns)
        .set({
          status: resultingStatus,
          queuedAt: new Date(),
          sentAt: completedAt,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(marketingCampaigns.organizationId, organizationId),
            eq(marketingCampaigns.id, campaign.id),
          ),
        );
      await this.audit(tx, {
        organizationId,
        unitId: campaign.unitId,
        identityId,
        action: "growth.campaign.queued",
        entityType: "growth_campaign",
        entityId: campaign.id,
        metadata: {
          queuedRecipients: queued,
          heldOutRecipients: heldOut,
          channel: campaign.channel,
        },
      });
      if (campaign.unitId)
        await this.outbox(
          tx,
          completedAt ? "growth.campaign_sent" : "growth.campaign_queued",
          "growth_campaign",
          campaign.id,
          {
            organizationId,
            unitId: campaign.unitId,
            campaignId: campaign.id,
            status: resultingStatus,
            queuedRecipients: queued,
            heldOutRecipients: heldOut,
          },
        );
      return {
        status: resultingStatus,
        duplicate: false,
        queuedRecipients: queued,
        heldOutRecipients: heldOut,
      };
    });
    return queueResult;
  }

  async previewCampaign(identityId: string, organizationId: string, campaignId: string) {
    await this.scope.requireOrganizationRole(identityId, organizationId, MANAGERS);
    await this.requireEntitlement(organizationId, "campaigns");
    const [campaign] = await this.database.db
      .select()
      .from(marketingCampaigns)
      .where(
        and(
          eq(marketingCampaigns.organizationId, organizationId),
          eq(marketingCampaigns.id, campaignId),
        ),
      )
      .limit(1);
    if (!campaign) throw new NotFoundException({ code: "CAMPAIGN_NOT_FOUND" });
    const audience = await this.campaignAudience(campaign);
    const providerReady = await this.providerReady(
      campaign.channel,
      organizationId,
      campaign.unitId,
    );
    return {
      campaignId,
      channel: campaign.channel,
      filter: audience.filter,
      activeCustomers: audience.activeCustomers,
      eligibleRecipients: audience.eligible,
      excludedRecipients: Math.max(0, audience.activeCustomers - audience.eligible),
      recipientLimit: 500,
      exceedsRecipientLimit: audience.eligible > 500,
      provider: {
        ready: providerReady,
        unavailableCode: providerReady
          ? null
          : campaign.channel === "whatsapp"
            ? "EVOLUTION_NOT_LOGGED_IN"
            : "PROVIDER_NOT_CONFIGURED",
      },
    };
  }

  async campaignDeliverySummary(identityId: string, organizationId: string, campaignId: string) {
    await this.scope.requireOrganizationRole(identityId, organizationId, MANAGERS);
    await this.requireEntitlement(organizationId, "campaigns");
    const [campaign] = await this.database.db
      .select()
      .from(marketingCampaigns)
      .where(
        and(
          eq(marketingCampaigns.organizationId, organizationId),
          eq(marketingCampaigns.id, campaignId),
        ),
      )
      .limit(1);
    if (!campaign) throw new NotFoundException({ code: "CAMPAIGN_NOT_FOUND" });
    const [counts, deliveries, [attribution], experiments] = await Promise.all([
      this.database.db
        .select({ status: campaignDeliveries.status, total: count() })
        .from(campaignDeliveries)
        .where(
          and(
            eq(campaignDeliveries.organizationId, organizationId),
            eq(campaignDeliveries.campaignId, campaignId),
          ),
        )
        .groupBy(campaignDeliveries.status),
      this.database.db
        .select({
          id: campaignDeliveries.id,
          customerId: campaignDeliveries.customerId,
          customerName: growthCustomers.name,
          status: campaignDeliveries.status,
          experimentVariant: campaignDeliveries.experimentVariant,
          errorCode: campaignDeliveries.errorCode,
          sentAt: campaignDeliveries.sentAt,
          deliveredAt: campaignDeliveries.deliveredAt,
          readAt: campaignDeliveries.readAt,
          repliedAt: campaignDeliveries.repliedAt,
          attributedOrderRef: campaignDeliveries.attributedOrderRef,
          attributedCouponRedemptionId: campaignDeliveries.attributedCouponRedemptionId,
          attributedRevenueCents: campaignDeliveries.attributedRevenueCents,
          createdAt: campaignDeliveries.createdAt,
        })
        .from(campaignDeliveries)
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
            eq(campaignDeliveries.campaignId, campaignId),
          ),
        )
        .orderBy(desc(campaignDeliveries.createdAt))
        .limit(100),
      this.database.db.execute<{
        delivered: number;
        read: number;
        replied: number;
        orders: number;
        coupons: number;
        revenueCents: number;
      }>(sql`
        select count(delivered_at)::int as delivered,
               count(read_at)::int as read,
               count(replied_at)::int as replied,
               count(attributed_order_ref)::int as orders,
               count(attributed_coupon_redemption_id)::int as coupons,
               coalesce(sum(attributed_revenue_cents), 0)::int as "revenueCents"
        from growth_campaign_deliveries
        where organization_id = ${organizationId}
          and campaign_id = ${campaignId}
      `),
      this.database.db.execute<{
        variant: string;
        recipients: number;
        delivered: number;
        read: number;
        replied: number;
        orders: number;
        revenueCents: number;
      }>(sql`
        select experiment_variant as variant,
               count(*)::int as recipients,
               count(delivered_at)::int as delivered,
               count(read_at)::int as read,
               count(replied_at)::int as replied,
               count(attributed_order_ref)::int as orders,
               coalesce(sum(attributed_revenue_cents), 0)::int as "revenueCents"
        from growth_campaign_deliveries
        where organization_id = ${organizationId}
          and campaign_id = ${campaignId}
        group by experiment_variant
        order by experiment_variant
      `),
    ]);
    return {
      campaign,
      counts: Object.fromEntries(counts.map((row) => [row.status, Number(row.total)])),
      attribution: attribution ?? {
        delivered: 0,
        read: 0,
        replied: 0,
        orders: 0,
        coupons: 0,
        revenueCents: 0,
      },
      experiments,
      deliveries,
    };
  }

  async cancelCampaign(
    identityId: string,
    organizationId: string,
    campaignId: string,
    input: CampaignCancelInput,
  ) {
    await this.scope.requireOrganizationRole(identityId, organizationId, MANAGERS);
    await this.requireEntitlement(organizationId, "campaigns");
    return this.database.db.transaction(async (tx) => {
      const [campaign] = await tx
        .select()
        .from(marketingCampaigns)
        .where(
          and(
            eq(marketingCampaigns.organizationId, organizationId),
            eq(marketingCampaigns.id, campaignId),
          ),
        )
        .for("update")
        .limit(1);
      if (!campaign) throw new NotFoundException({ code: "CAMPAIGN_NOT_FOUND" });
      if (campaign.status === "canceled") return { duplicate: true, campaign };
      if (["sending", "sent"].includes(campaign.status))
        throw new ConflictException({
          code: "CAMPAIGN_ALREADY_DELIVERING",
          message: "A campanha já iniciou entregas e não pode ser cancelada com segurança.",
        });
      const [canceled] = await tx
        .update(marketingCampaigns)
        .set({ status: "canceled", updatedAt: new Date() })
        .where(
          and(
            eq(marketingCampaigns.organizationId, organizationId),
            eq(marketingCampaigns.id, campaignId),
          ),
        )
        .returning();
      await tx
        .update(campaignDeliveries)
        .set({ status: "skipped", errorCode: "CAMPAIGN_CANCELED", updatedAt: new Date() })
        .where(
          and(
            eq(campaignDeliveries.organizationId, organizationId),
            eq(campaignDeliveries.campaignId, campaignId),
            inArray(campaignDeliveries.status, ["pending", "blocked"]),
          ),
        );
      await this.audit(tx, {
        organizationId,
        unitId: campaign.unitId,
        identityId,
        action: "growth.campaign.canceled",
        entityType: "growth_campaign",
        entityId: campaignId,
        metadata: { reason: input.reason },
      });
      return { duplicate: false, campaign: canceled };
    });
  }

  async listReservations(
    identityId: string,
    organizationId: string,
    unitId: string,
    query: ReservationListQueryInput = { scope: "all", limit: 100, offset: 0 },
  ) {
    await this.requireUnitCapability(
      identityId,
      organizationId,
      unitId,
      "operations:reception:manage",
    );
    const filters = [
      eq(reservations.organizationId, organizationId),
      eq(reservations.unitId, unitId),
    ];
    if (query.scope === "active") {
      filters.push(inArray(reservations.status, ["booked", "confirmed", "seated"]));
    } else if (query.scope === "history") {
      filters.push(inArray(reservations.status, ["completed", "canceled", "no_show"]));
    }
    if (query.from) filters.push(gte(reservations.scheduledAt, query.from));
    if (query.to) filters.push(lte(reservations.scheduledAt, query.to));
    return this.database.db
      .select()
      .from(reservations)
      .where(and(...filters))
      .orderBy(
        query.scope === "history" ? desc(reservations.scheduledAt) : asc(reservations.scheduledAt),
      )
      .limit(query.limit)
      .offset(query.offset);
  }

  async createReservation(identityId: string, organizationId: string, input: ReservationInput) {
    await this.requireUnitCapability(
      identityId,
      organizationId,
      input.unitId,
      "operations:reception:manage",
    );
    if (input.customerId) await this.customer(organizationId, input.customerId);
    return this.persistReservation(identityId, organizationId, input);
  }

  async createPublicReservation(
    slug: string,
    idempotencyKey: string,
    input: PublicReservationInput,
  ) {
    const scope = await this.publicMenuScope(slug);
    await this.persistReservation(
      null,
      scope.organizationId,
      {
        unitId: scope.unitId,
        customerId: null,
        guestName: input.guestName,
        guestPhone: input.guestPhone,
        partySize: input.partySize,
        scheduledAt: input.scheduledAt,
        durationMinutes: 120,
        notes: input.notes ?? null,
        idempotencyKey,
      },
      {
        source: "public_menu",
        privacyAccepted: input.privacyAccepted,
        policyVersion: input.policyVersion,
      },
    );
    return { accepted: true as const };
  }

  private async persistReservation(
    identityId: string | null,
    organizationId: string,
    input: ReservationInput,
    publicContext?: PublicSubmissionContext,
  ) {
    const requestFingerprint = payloadFingerprint(publicContext ? { input, publicContext } : input);
    const [created] = await this.database.db.transaction(async (tx) => {
      const rows = await tx
        .insert(reservations)
        .values({
          organizationId,
          unitId: input.unitId,
          customerId: input.customerId ?? null,
          guestName: input.guestName,
          guestPhone: input.guestPhone ?? null,
          partySize: input.partySize,
          scheduledAt: input.scheduledAt,
          durationMinutes: input.durationMinutes,
          notes: input.notes ?? null,
          idempotencyKey: input.idempotencyKey,
          requestFingerprint,
        })
        .onConflictDoNothing()
        .returning();
      const row = rows[0];
      if (row) {
        await this.audit(tx, {
          organizationId,
          unitId: input.unitId,
          identityId,
          action: "growth.reservation.created",
          entityType: "growth_reservation",
          entityId: row.id,
          metadata: {
            partySize: row.partySize,
            scheduledAt: row.scheduledAt.toISOString(),
            ...(publicContext ?? {}),
          },
        });
        await this.outbox(tx, "growth.reservation_created", "growth_reservation", row.id, {
          organizationId,
          unitId: input.unitId,
          reservationId: row.id,
        });
      }
      return rows;
    });
    if (created) return { duplicate: false, reservation: created };
    const [existing] = await this.database.db
      .select()
      .from(reservations)
      .where(
        and(
          eq(reservations.organizationId, organizationId),
          eq(reservations.idempotencyKey, input.idempotencyKey),
        ),
      )
      .limit(1);
    if (!existing || existing.requestFingerprint !== requestFingerprint)
      return this.idempotencyConflict();
    return { duplicate: true, reservation: existing };
  }

  async transitionReservation(
    identityId: string,
    organizationId: string,
    reservationId: string,
    input: ReservationTransitionInput,
  ) {
    const [current] = await this.database.db
      .select()
      .from(reservations)
      .where(
        and(eq(reservations.organizationId, organizationId), eq(reservations.id, reservationId)),
      )
      .limit(1);
    if (!current)
      throw new NotFoundException({
        code: "RESERVATION_NOT_FOUND",
        message: "Reserva não encontrada.",
      });
    await this.requireUnitCapability(
      identityId,
      organizationId,
      current.unitId,
      "operations:reception:manage",
    );
    if (!canTransition(reservationTransitions, current.status, input.status))
      throw new ConflictException({
        code: "INVALID_RESERVATION_TRANSITION",
        message: "Transição inválida.",
      });
    return this.database.db.transaction(async (tx) => {
      const [updated] = await tx
        .update(reservations)
        .set({ status: input.status, updatedAt: new Date() })
        .where(
          and(
            eq(reservations.organizationId, organizationId),
            eq(reservations.id, reservationId),
            eq(reservations.status, current.status),
          ),
        )
        .returning();
      if (!updated)
        throw new ConflictException({
          code: "STALE_RESERVATION",
          message: "Reserva alterada por outro usuário.",
        });
      await this.audit(tx, {
        organizationId,
        unitId: current.unitId,
        identityId,
        action: "growth.reservation.transitioned",
        entityType: "growth_reservation",
        entityId: reservationId,
        metadata: { from: current.status, to: input.status },
      });
      await this.outbox(tx, "growth.reservation_changed", "growth_reservation", reservationId, {
        organizationId,
        unitId: current.unitId,
        from: current.status,
        to: input.status,
      });
      return updated;
    });
  }

  async listWaitlist(
    identityId: string,
    organizationId: string,
    unitId: string,
    query: WaitlistListQueryInput = { scope: "all", limit: 100, offset: 0 },
  ) {
    await this.requireUnitCapability(
      identityId,
      organizationId,
      unitId,
      "operations:reception:manage",
    );
    const filters = [
      eq(waitlistEntries.organizationId, organizationId),
      eq(waitlistEntries.unitId, unitId),
    ];
    if (query.scope === "active") {
      filters.push(inArray(waitlistEntries.status, ["waiting", "notified"]));
    } else if (query.scope === "history") {
      filters.push(inArray(waitlistEntries.status, ["seated", "left", "canceled", "no_show"]));
    }
    return this.database.db
      .select()
      .from(waitlistEntries)
      .where(and(...filters))
      .orderBy(
        query.scope === "history" ? desc(waitlistEntries.joinedAt) : asc(waitlistEntries.joinedAt),
      )
      .limit(query.limit)
      .offset(query.offset);
  }

  async createWaitlistEntry(identityId: string, organizationId: string, input: WaitlistInput) {
    await this.requireUnitCapability(
      identityId,
      organizationId,
      input.unitId,
      "operations:reception:manage",
    );
    if (input.customerId) await this.customer(organizationId, input.customerId);
    return this.persistWaitlistEntry(identityId, organizationId, input);
  }

  async createPublicWaitlistEntry(
    slug: string,
    idempotencyKey: string,
    input: PublicWaitlistInput,
  ) {
    const scope = await this.publicMenuScope(slug);
    await this.persistWaitlistEntry(
      null,
      scope.organizationId,
      {
        unitId: scope.unitId,
        customerId: null,
        guestName: input.guestName,
        guestPhone: input.guestPhone,
        partySize: input.partySize,
        quotedWaitMinutes: null,
        idempotencyKey,
      },
      {
        source: "public_menu",
        privacyAccepted: input.privacyAccepted,
        policyVersion: input.policyVersion,
      },
    );
    return { accepted: true as const };
  }

  private async persistWaitlistEntry(
    identityId: string | null,
    organizationId: string,
    input: WaitlistInput,
    publicContext?: PublicSubmissionContext,
  ) {
    const requestFingerprint = payloadFingerprint(publicContext ? { input, publicContext } : input);
    const [created] = await this.database.db.transaction(async (tx) => {
      const rows = await tx
        .insert(waitlistEntries)
        .values({
          organizationId,
          unitId: input.unitId,
          customerId: input.customerId ?? null,
          guestName: input.guestName,
          guestPhone: input.guestPhone ?? null,
          partySize: input.partySize,
          quotedWaitMinutes: input.quotedWaitMinutes ?? null,
          idempotencyKey: input.idempotencyKey,
          requestFingerprint,
        })
        .onConflictDoNothing()
        .returning();
      const row = rows[0];
      if (row) {
        await this.audit(tx, {
          organizationId,
          unitId: input.unitId,
          identityId,
          action: "growth.waitlist.joined",
          entityType: "growth_waitlist_entry",
          entityId: row.id,
          metadata: { partySize: row.partySize, ...(publicContext ?? {}) },
        });
        await this.outbox(tx, "growth.waitlist_changed", "growth_waitlist_entry", row.id, {
          organizationId,
          unitId: input.unitId,
          status: row.status,
        });
      }
      return rows;
    });
    if (created) return { duplicate: false, entry: created };
    const [existing] = await this.database.db
      .select()
      .from(waitlistEntries)
      .where(
        and(
          eq(waitlistEntries.organizationId, organizationId),
          eq(waitlistEntries.idempotencyKey, input.idempotencyKey),
        ),
      )
      .limit(1);
    if (!existing || existing.requestFingerprint !== requestFingerprint)
      return this.idempotencyConflict();
    return { duplicate: true, entry: existing };
  }

  async transitionWaitlist(
    identityId: string,
    organizationId: string,
    entryId: string,
    input: WaitlistTransitionInput,
  ) {
    const [current] = await this.database.db
      .select()
      .from(waitlistEntries)
      .where(
        and(eq(waitlistEntries.organizationId, organizationId), eq(waitlistEntries.id, entryId)),
      )
      .limit(1);
    if (!current)
      throw new NotFoundException({
        code: "WAITLIST_ENTRY_NOT_FOUND",
        message: "Entrada não encontrada.",
      });
    await this.requireUnitCapability(
      identityId,
      organizationId,
      current.unitId,
      "operations:reception:manage",
    );
    if (!canTransition(waitlistTransitions, current.status, input.status))
      throw new ConflictException({
        code: "INVALID_WAITLIST_TRANSITION",
        message: "Transição inválida.",
      });
    return this.database.db.transaction(async (tx) => {
      const [updated] = await tx
        .update(waitlistEntries)
        .set({ status: input.status, updatedAt: new Date() })
        .where(
          and(
            eq(waitlistEntries.organizationId, organizationId),
            eq(waitlistEntries.id, entryId),
            eq(waitlistEntries.status, current.status),
          ),
        )
        .returning();
      if (!updated)
        throw new ConflictException({
          code: "STALE_WAITLIST",
          message: "Fila alterada por outro usuário.",
        });
      await this.audit(tx, {
        organizationId,
        unitId: current.unitId,
        identityId,
        action: "growth.waitlist.transitioned",
        entityType: "growth_waitlist_entry",
        entityId: entryId,
        metadata: { from: current.status, to: input.status },
      });
      await this.outbox(tx, "growth.waitlist_changed", "growth_waitlist_entry", entryId, {
        organizationId,
        unitId: current.unitId,
        from: current.status,
        to: input.status,
      });
      return updated;
    });
  }

  async createDeliveryZone(identityId: string, organizationId: string, input: DeliveryZoneInput) {
    await this.scope.requireOrganizationRole(identityId, organizationId, MANAGERS);
    await this.scope.requireUnitAccess(identityId, organizationId, input.unitId);
    return this.database.db.transaction(async (tx) => {
      const [zone] = await tx
        .insert(deliveryZones)
        .values({ organizationId, ...input })
        .returning();
      if (!zone) throw new Error("DELIVERY_ZONE_INSERT_FAILED");
      await this.audit(tx, {
        organizationId,
        unitId: input.unitId,
        identityId,
        action: "growth.delivery_zone.created",
        entityType: "growth_delivery_zone",
        entityId: zone.id,
        metadata: { name: zone.name, feeCents: zone.feeCents, active: zone.active },
      });
      await this.outbox(tx, "growth.delivery_zone_created", "growth_delivery_zone", zone.id, {
        organizationId,
        unitId: input.unitId,
        zoneId: zone.id,
      });
      return zone;
    });
  }

  async updateDeliveryZone(
    identityId: string,
    organizationId: string,
    zoneId: string,
    input: DeliveryZoneUpdateInput,
  ) {
    await this.scope.requireOrganizationRole(identityId, organizationId, MANAGERS);
    const [current] = await this.database.db
      .select()
      .from(deliveryZones)
      .where(and(eq(deliveryZones.organizationId, organizationId), eq(deliveryZones.id, zoneId)))
      .limit(1);
    if (!current)
      throw new NotFoundException({
        code: "DELIVERY_ZONE_NOT_FOUND",
        message: "Zona de entrega não encontrada.",
      });
    await this.scope.requireUnitAccess(identityId, organizationId, current.unitId);

    return this.database.db.transaction(async (tx) => {
      const [locked] = await tx
        .select({ id: deliveryZones.id })
        .from(deliveryZones)
        .where(
          and(
            eq(deliveryZones.organizationId, organizationId),
            eq(deliveryZones.unitId, current.unitId),
            eq(deliveryZones.id, zoneId),
          ),
        )
        .for("update")
        .limit(1);
      if (!locked)
        throw new NotFoundException({
          code: "DELIVERY_ZONE_NOT_FOUND",
          message: "Zona de entrega não encontrada.",
        });
      const [updated] = await tx
        .update(deliveryZones)
        .set({ ...input, updatedAt: sql`clock_timestamp()` })
        .where(
          and(
            eq(deliveryZones.organizationId, organizationId),
            eq(deliveryZones.unitId, current.unitId),
            eq(deliveryZones.id, zoneId),
          ),
        )
        .returning();
      if (!updated) throw new Error("DELIVERY_ZONE_UPDATE_FAILED");
      const changedFields = Object.keys(input);
      await this.audit(tx, {
        organizationId,
        unitId: current.unitId,
        identityId,
        action: "growth.delivery_zone.updated",
        entityType: "growth_delivery_zone",
        entityId: zoneId,
        metadata: { changedFields, active: updated.active },
      });
      await this.outbox(tx, "growth.delivery_zone_changed", "growth_delivery_zone", zoneId, {
        organizationId,
        unitId: current.unitId,
        zoneId,
        changedFields,
        active: updated.active,
      });
      return updated;
    });
  }

  async validateDeliveryAddress(
    identityId: string,
    organizationId: string,
    zoneId: string,
    input: DeliveryAddressValidationInput,
  ) {
    const [zone] = await this.database.db
      .select()
      .from(deliveryZones)
      .where(and(eq(deliveryZones.organizationId, organizationId), eq(deliveryZones.id, zoneId)))
      .limit(1);
    if (!zone)
      throw new NotFoundException({
        code: "DELIVERY_ZONE_NOT_FOUND",
        message: "Zona de entrega não encontrada.",
      });
    await this.scope.requireUnitAccess(identityId, organizationId, zone.unitId);
    const validationStatus = deliveryCoverageStatus(zone.geometry, input);
    return { covered: validationStatus === "covered", validationStatus };
  }

  async listDeliveryCouriers(identityId: string, organizationId: string, unitId: string) {
    await this.scope.requireUnitAccess(identityId, organizationId, unitId);
    const couriers = await this.database.db
      .select()
      .from(deliveryCouriers)
      .where(
        and(
          eq(deliveryCouriers.organizationId, organizationId),
          eq(deliveryCouriers.unitId, unitId),
          eq(deliveryCouriers.active, true),
        ),
      )
      .orderBy(asc(deliveryCouriers.name));
    return couriers.map((courier) => this.deliveryCourierResponse(courier));
  }

  async createDeliveryCourier(
    identityId: string,
    organizationId: string,
    input: DeliveryCourierCreateInput,
  ) {
    await this.scope.requireOrganizationRole(identityId, organizationId, MANAGERS);
    await this.scope.requireUnitAccess(identityId, organizationId, input.unitId);
    const requestFingerprint = payloadFingerprint(input);
    const [created] = await this.database.db.transaction(async (tx) => {
      const rows = await tx
        .insert(deliveryCouriers)
        .values({
          organizationId,
          unitId: input.unitId,
          reference: input.reference,
          name: input.name,
          phone: input.phone ?? null,
          idempotencyKey: input.idempotencyKey,
          requestFingerprint,
        })
        .onConflictDoNothing()
        .returning();
      const courier = rows[0];
      if (courier) {
        await this.audit(tx, {
          organizationId,
          unitId: input.unitId,
          identityId,
          action: "growth.delivery_courier.created",
          entityType: "growth_delivery_courier",
          entityId: courier.id,
          metadata: { reference: courier.reference },
        });
        await this.outbox(
          tx,
          "growth.delivery_courier_created",
          "growth_delivery_courier",
          courier.id,
          {
            organizationId,
            unitId: input.unitId,
            courierId: courier.id,
          },
        );
      }
      return rows;
    });
    if (created) return { duplicate: false, courier: this.deliveryCourierResponse(created) };
    const [existing] = await this.database.db
      .select()
      .from(deliveryCouriers)
      .where(
        and(
          eq(deliveryCouriers.organizationId, organizationId),
          eq(deliveryCouriers.idempotencyKey, input.idempotencyKey),
        ),
      )
      .limit(1);
    if (!existing)
      throw new ConflictException({
        code: "DELIVERY_COURIER_REFERENCE_EXISTS",
        message: "Referência de entregador já cadastrada.",
      });
    if (existing.requestFingerprint !== requestFingerprint) return this.idempotencyConflict();
    return { duplicate: true, courier: this.deliveryCourierResponse(existing) };
  }

  private deliveryCourierResponse(courier: typeof deliveryCouriers.$inferSelect) {
    const {
      idempotencyKey: _idempotencyKey,
      requestFingerprint: _requestFingerprint,
      ...response
    } = courier;
    return response;
  }

  private async deliveryCourier(organizationId: string, courierId: string) {
    const [courier] = await this.database.db
      .select()
      .from(deliveryCouriers)
      .where(
        and(
          eq(deliveryCouriers.organizationId, organizationId),
          eq(deliveryCouriers.id, courierId),
        ),
      )
      .limit(1);
    if (!courier)
      throw new NotFoundException({
        code: "DELIVERY_COURIER_NOT_FOUND",
        message: "Entregador não encontrado.",
      });
    return courier;
  }

  private async knownCourierEvent(
    organizationId: string,
    idempotencyKey: string,
    requestFingerprint: string,
  ) {
    const [known] = await this.database.db
      .select()
      .from(deliveryCourierEvents)
      .where(
        and(
          eq(deliveryCourierEvents.organizationId, organizationId),
          eq(deliveryCourierEvents.idempotencyKey, idempotencyKey),
        ),
      )
      .limit(1);
    if (known && known.requestFingerprint !== requestFingerprint) return this.idempotencyConflict();
    return known;
  }

  async updateDeliveryCourierStatus(
    identityId: string,
    organizationId: string,
    courierId: string,
    input: DeliveryCourierStatusInput,
  ) {
    await this.scope.requireOrganizationRole(identityId, organizationId, MANAGERS);
    const courier = await this.deliveryCourier(organizationId, courierId);
    await this.scope.requireUnitAccess(identityId, organizationId, courier.unitId);
    const requestFingerprint = payloadFingerprint({ courierId, input });
    const known = await this.knownCourierEvent(
      organizationId,
      input.idempotencyKey,
      requestFingerprint,
    );
    if (known) return { duplicate: true, courier: this.deliveryCourierResponse(courier) };
    if (courier.status === "assigned" || courier.status === "delivering")
      throw new ConflictException({
        code: "DELIVERY_COURIER_BUSY",
        message: "Entregador em rota.",
      });
    return this.database.db.transaction(async (tx) => {
      const [updated] = await tx
        .update(deliveryCouriers)
        .set({ status: input.status, updatedAt: new Date() })
        .where(
          and(
            eq(deliveryCouriers.organizationId, organizationId),
            eq(deliveryCouriers.id, courierId),
            eq(deliveryCouriers.status, courier.status),
          ),
        )
        .returning();
      if (!updated) throw new ConflictException({ code: "STALE_DELIVERY_COURIER" });
      await tx.insert(deliveryCourierEvents).values({
        organizationId,
        unitId: courier.unitId,
        courierId,
        eventType: "status",
        status: input.status,
        actorIdentityId: identityId,
        idempotencyKey: input.idempotencyKey,
        requestFingerprint,
      });
      await this.audit(tx, {
        organizationId,
        unitId: courier.unitId,
        identityId,
        action: "growth.delivery_courier.status_changed",
        entityType: "growth_delivery_courier",
        entityId: courierId,
        metadata: { from: courier.status, to: input.status },
      });
      await this.outbox(
        tx,
        "growth.delivery_courier_status_changed",
        "growth_delivery_courier",
        courierId,
        {
          organizationId,
          unitId: courier.unitId,
          courierId,
          status: input.status,
        },
      );
      return { duplicate: false, courier: this.deliveryCourierResponse(updated) };
    });
  }

  async updateDeliveryCourierPosition(
    identityId: string,
    organizationId: string,
    courierId: string,
    input: DeliveryCourierPositionInput,
  ) {
    await this.scope.requireOrganizationRole(identityId, organizationId, MANAGERS);
    const courier = await this.deliveryCourier(organizationId, courierId);
    await this.scope.requireUnitAccess(identityId, organizationId, courier.unitId);
    const requestFingerprint = payloadFingerprint({ courierId, input });
    const known = await this.knownCourierEvent(
      organizationId,
      input.idempotencyKey,
      requestFingerprint,
    );
    if (known) return { duplicate: true, courier: this.deliveryCourierResponse(courier) };
    const recordedAt = input.recordedAt ? new Date(input.recordedAt) : new Date();
    if (recordedAt.getTime() > Date.now() + 5 * 60_000)
      throw new BadRequestException({
        code: "DELIVERY_COURIER_POSITION_IN_FUTURE",
        message: "Horário da posição não pode estar mais de cinco minutos no futuro.",
      });
    return this.database.db.transaction(async (tx) => {
      await tx.insert(deliveryCourierEvents).values({
        organizationId,
        unitId: courier.unitId,
        courierId,
        eventType: "position",
        latitude: input.latitude,
        longitude: input.longitude,
        actorIdentityId: identityId,
        idempotencyKey: input.idempotencyKey,
        requestFingerprint,
        occurredAt: recordedAt,
      });
      const [updated] = await tx
        .update(deliveryCouriers)
        .set({
          lastLatitude: input.latitude,
          lastLongitude: input.longitude,
          lastPositionAt: recordedAt,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(deliveryCouriers.organizationId, organizationId),
            eq(deliveryCouriers.id, courierId),
            or(
              isNull(deliveryCouriers.lastPositionAt),
              lte(deliveryCouriers.lastPositionAt, recordedAt),
            ),
          ),
        )
        .returning();
      const current =
        updated ??
        (
          await tx
            .select()
            .from(deliveryCouriers)
            .where(
              and(
                eq(deliveryCouriers.organizationId, organizationId),
                eq(deliveryCouriers.id, courierId),
              ),
            )
            .limit(1)
        )[0];
      if (!current) throw new Error("DELIVERY_COURIER_POSITION_UPDATE_FAILED");
      await this.audit(tx, {
        organizationId,
        unitId: courier.unitId,
        identityId,
        action: "growth.delivery_courier.position_changed",
        entityType: "growth_delivery_courier",
        entityId: courierId,
      });
      await this.outbox(
        tx,
        "growth.delivery_courier_position_changed",
        "growth_delivery_courier",
        courierId,
        {
          organizationId,
          unitId: courier.unitId,
          courierId,
          latitude: input.latitude,
          longitude: input.longitude,
          recordedAt: recordedAt.toISOString(),
        },
      );
      return { duplicate: false, courier: this.deliveryCourierResponse(current) };
    });
  }

  async listDeliveryZones(identityId: string, organizationId: string, unitId: string) {
    await this.scope.requireUnitAccess(identityId, organizationId, unitId);
    return this.database.db
      .select()
      .from(deliveryZones)
      .where(
        and(eq(deliveryZones.organizationId, organizationId), eq(deliveryZones.unitId, unitId)),
      );
  }

  async listDeliveryOrders(
    identityId: string,
    organizationId: string,
    unitId: string,
    input: DeliveryOrderQueryInput,
  ) {
    await this.scope.requireUnitAccess(identityId, organizationId, unitId);
    const rows = await this.database.db
      .select({
        order: deliveryOrders,
        zoneName: deliveryZones.name,
        courierReference: sql<
          string | null
        >`coalesce(${deliveryCouriers.reference}, ${deliveryDispatches.courierReference})`,
        courierStatus: deliveryCouriers.status,
        lastLatitude: deliveryCouriers.lastLatitude,
        lastLongitude: deliveryCouriers.lastLongitude,
        lastPositionAt: deliveryCouriers.lastPositionAt,
      })
      .from(deliveryOrders)
      .leftJoin(
        deliveryZones,
        and(
          eq(deliveryZones.organizationId, deliveryOrders.organizationId),
          eq(deliveryZones.id, deliveryOrders.zoneId),
        ),
      )
      .leftJoin(
        deliveryCouriers,
        and(
          eq(deliveryCouriers.organizationId, deliveryOrders.organizationId),
          eq(deliveryCouriers.id, deliveryOrders.courierId),
        ),
      )
      .leftJoin(
        deliveryDispatches,
        and(
          eq(deliveryDispatches.organizationId, deliveryOrders.organizationId),
          eq(deliveryDispatches.deliveryOrderId, deliveryOrders.id),
        ),
      )
      .where(
        and(
          eq(deliveryOrders.organizationId, organizationId),
          eq(deliveryOrders.unitId, unitId),
          input.status ? eq(deliveryOrders.status, input.status) : undefined,
          input.updatedSince ? gt(deliveryOrders.updatedAt, input.updatedSince) : undefined,
          input.scheduled === undefined
            ? undefined
            : input.scheduled
              ? isNotNull(deliveryOrders.scheduledFor)
              : isNull(deliveryOrders.scheduledFor),
          input.query
            ? or(
                ilike(deliveryOrders.publicProtocol, `%${input.query}%`),
                ilike(deliveryOrders.customerName, `%${input.query}%`),
                ilike(deliveryOrders.customerPhone, `%${input.query}%`),
              )
            : undefined,
          input.sla === undefined
            ? undefined
            : input.sla === "unset"
              ? isNull(deliveryOrders.promisedAt)
              : and(
                  isNotNull(deliveryOrders.promisedAt),
                  ne(deliveryOrders.status, "completed"),
                  ne(deliveryOrders.status, "canceled"),
                  input.sla === "overdue"
                    ? lt(deliveryOrders.promisedAt, sql`clock_timestamp()`)
                    : gte(deliveryOrders.promisedAt, sql`clock_timestamp()`),
                ),
        ),
      )
      .orderBy(
        sql`case ${deliveryOrders.status}
          when 'placed' then 0
          when 'confirmed' then 1
          when 'preparing' then 2
          when 'ready' then 3
          when 'dispatched' then 4
          when 'draft' then 5
          when 'completed' then 6
          else 7
        end`,
        asc(sql`case
          when ${deliveryOrders.status} not in ('completed', 'canceled')
          then coalesce(${deliveryOrders.scheduledFor}, ${deliveryOrders.createdAt})
        end`),
        desc(deliveryOrders.updatedAt),
      )
      .limit(input.limit);
    const orderIds = rows.map(({ order }) => order.id);
    const history = orderIds.length
      ? await this.database.db
          .select()
          .from(deliveryOrderStatusHistory)
          .where(
            and(
              eq(deliveryOrderStatusHistory.organizationId, organizationId),
              inArray(deliveryOrderStatusHistory.deliveryOrderId, orderIds),
            ),
          )
          .orderBy(asc(deliveryOrderStatusHistory.occurredAt), asc(deliveryOrderStatusHistory.id))
      : [];
    const notifications = orderIds.length
      ? await this.database.db
          .select({
            id: deliveryNotifications.id,
            deliveryOrderId: deliveryNotifications.deliveryOrderId,
            audience: deliveryNotifications.audience,
            type: deliveryNotifications.type,
            status: deliveryNotifications.status,
            createdAt: deliveryNotifications.createdAt,
          })
          .from(deliveryNotifications)
          .where(
            and(
              eq(deliveryNotifications.organizationId, organizationId),
              inArray(deliveryNotifications.deliveryOrderId, orderIds),
            ),
          )
          .orderBy(asc(deliveryNotifications.createdAt), asc(deliveryNotifications.id))
      : [];
    return rows.map(
      ({
        order,
        zoneName,
        courierReference,
        courierStatus,
        lastLatitude,
        lastLongitude,
        lastPositionAt,
      }) => ({
        ...order,
        zoneName,
        courierReference,
        courierStatus,
        lastPosition:
          lastLatitude === null || lastLongitude === null || !lastPositionAt
            ? null
            : { latitude: lastLatitude, longitude: lastLongitude, at: lastPositionAt },
        history: history.filter((entry) => entry.deliveryOrderId === order.id),
        notifications: notifications
          .filter((notification) => notification.deliveryOrderId === order.id)
          .map(({ deliveryOrderId: _deliveryOrderId, ...notification }) => notification),
      }),
    );
  }

  async createDeliveryOrder(identityId: string, organizationId: string, input: DeliveryOrderInput) {
    await this.scope.requireUnitAccess(identityId, organizationId, input.unitId);
    const [tab] = await this.database.db
      .select({ id: posTabs.id, totalCents: posTabs.totalCents })
      .from(posTabs)
      .where(
        and(
          eq(posTabs.organizationId, organizationId),
          eq(posTabs.unitId, input.unitId),
          eq(posTabs.id, input.orderRef),
          eq(posTabs.status, "open"),
        ),
      )
      .limit(1);
    if (!tab)
      throw new BadRequestException({
        code: "DELIVERY_OPERATIONAL_TAB_NOT_FOUND",
        message: "Entrega ou retirada exige uma comanda operacional aberta e persistida.",
      });
    const [link] = await this.database.db
      .select({ customerId: posTabCustomerLinks.customerId })
      .from(posTabCustomerLinks)
      .where(
        and(
          eq(posTabCustomerLinks.organizationId, organizationId),
          eq(posTabCustomerLinks.unitId, input.unitId),
          eq(posTabCustomerLinks.tabId, input.orderRef),
        ),
      )
      .limit(1);
    if (input.customerId && link && input.customerId !== link.customerId)
      throw new ConflictException({
        code: "DELIVERY_CUSTOMER_MISMATCH",
        message: "A comanda está vinculada a outro cliente.",
      });
    const customerId = input.customerId ?? link?.customerId;
    if (customerId) await this.customer(organizationId, customerId);
    let deliveryFeeCents = 0;
    let zoneId: string | null = null;
    let addressValidationStatus: "covered" | "unchecked" | "unavailable" = "unchecked";
    let promisedAt =
      input.promisedAt !== undefined ? input.promisedAt : (input.scheduledFor ?? null);
    if (input.fulfillment === "delivery") {
      if (!input.zoneId || !input.address)
        throw new BadRequestException({
          code: "DELIVERY_ZONE_ADDRESS_REQUIRED",
          message: "Zona e endereço são obrigatórios para entrega.",
        });
      const [zone] = await this.database.db
        .select()
        .from(deliveryZones)
        .where(
          and(
            eq(deliveryZones.organizationId, organizationId),
            eq(deliveryZones.unitId, input.unitId),
            eq(deliveryZones.id, input.zoneId),
            eq(deliveryZones.active, true),
          ),
        )
        .limit(1);
      if (!zone)
        throw new BadRequestException({ code: "DELIVERY_ZONE_INVALID", message: "Zona inválida." });
      if (tab.totalCents < zone.minimumOrderCents)
        throw new BadRequestException({
          code: "DELIVERY_MINIMUM_NOT_MET",
          message: "Pedido abaixo do mínimo.",
        });
      deliveryFeeCents = zone.feeCents;
      zoneId = zone.id;
      const coverage = deliveryCoverageStatus(zone.geometry, input.address);
      if (coverage === "outside")
        throw new BadRequestException({
          code: "DELIVERY_ADDRESS_OUTSIDE_ZONE",
          message: "Endereço fora da zona de entrega.",
        });
      addressValidationStatus = coverage;
      if (input.promisedAt === undefined && !input.scheduledFor) {
        promisedAt = new Date(Date.now() + zone.estimatedDeliveryMinutes * 60_000);
      }
    } else if (input.zoneId || input.address) {
      throw new BadRequestException({
        code: "PICKUP_DELIVERY_FIELDS_FORBIDDEN",
        message: "Retirada não aceita zona ou endereço de entrega.",
      });
    }
    const totalCents = tab.totalCents + deliveryFeeCents;
    const requestFingerprint = payloadFingerprint({
      input: { ...input, customerId },
      zoneId,
      operationalSubtotalCents: tab.totalCents,
      deliveryFeeCents,
      totalCents,
    });
    const [created] = await this.database.db.transaction(async (tx) => {
      const rows = await tx
        .insert(deliveryOrders)
        .values({
          organizationId,
          unitId: input.unitId,
          customerId: customerId ?? null,
          zoneId,
          orderRef: input.orderRef,
          fulfillment: input.fulfillment,
          subtotalCents: tab.totalCents,
          deliveryFeeCents,
          totalCents,
          address: input.address ? { ...input.address } : null,
          addressValidationStatus,
          scheduledFor: input.scheduledFor ?? null,
          promisedAt,
          idempotencyKey: input.idempotencyKey,
          requestFingerprint,
        })
        .onConflictDoNothing()
        .returning();
      const row = rows[0];
      if (row) {
        await tx.insert(deliveryOrderStatusHistory).values({
          organizationId,
          unitId: input.unitId,
          deliveryOrderId: row.id,
          toStatus: row.status,
          actorIdentityId: identityId,
          metadata: { source: "internal_create" },
        });
        await this.audit(tx, {
          organizationId,
          unitId: input.unitId,
          identityId,
          action: "growth.delivery_order.created",
          entityType: "growth_delivery_order",
          entityId: row.id,
          metadata: { fulfillment: row.fulfillment, orderRef: row.orderRef, totalCents },
        });
        await this.outbox(tx, "growth.delivery_order_created", "growth_delivery_order", row.id, {
          organizationId,
          unitId: input.unitId,
          deliveryOrderId: row.id,
          fulfillment: row.fulfillment,
        });
      }
      return rows;
    });
    if (created) return { duplicate: false, order: created };
    const [existing] = await this.database.db
      .select()
      .from(deliveryOrders)
      .where(
        and(
          eq(deliveryOrders.organizationId, organizationId),
          or(
            eq(deliveryOrders.idempotencyKey, input.idempotencyKey),
            eq(deliveryOrders.orderRef, input.orderRef),
          ),
        ),
      )
      .limit(1);
    if (!existing || existing.requestFingerprint !== requestFingerprint)
      return this.idempotencyConflict();
    return { duplicate: true, order: existing };
  }

  async assignDeliveryCourier(
    identityId: string,
    organizationId: string,
    orderId: string,
    input: DeliveryCourierAssignmentInput,
  ) {
    const [order] = await this.database.db
      .select()
      .from(deliveryOrders)
      .where(and(eq(deliveryOrders.organizationId, organizationId), eq(deliveryOrders.id, orderId)))
      .limit(1);
    if (!order)
      throw new NotFoundException({
        code: "DELIVERY_ORDER_NOT_FOUND",
        message: "Pedido não encontrado.",
      });
    await this.scope.requireUnitAccess(identityId, organizationId, order.unitId);
    const courier = await this.deliveryCourier(organizationId, input.courierId);
    if (courier.unitId !== order.unitId || !courier.active)
      throw new BadRequestException({
        code: "DELIVERY_COURIER_INVALID",
        message: "Entregador indisponível para esta unidade.",
      });
    if (order.fulfillment !== "delivery" || ["completed", "canceled"].includes(order.status))
      throw new ConflictException({
        code: "DELIVERY_ORDER_NOT_ASSIGNABLE",
        message: "Pedido não aceita atribuição de entregador.",
      });
    const requestFingerprint = payloadFingerprint({ orderId, input });
    const [known] = await this.database.db
      .select()
      .from(deliveryCourierAssignments)
      .where(
        and(
          eq(deliveryCourierAssignments.organizationId, organizationId),
          eq(deliveryCourierAssignments.idempotencyKey, input.idempotencyKey),
        ),
      )
      .limit(1);
    if (known) {
      if (known.requestFingerprint !== requestFingerprint) return this.idempotencyConflict();
      return { duplicate: true, assignment: known, order };
    }
    return this.database.db.transaction(async (tx) => {
      const [lockedOrder] = await tx
        .select()
        .from(deliveryOrders)
        .where(
          and(eq(deliveryOrders.organizationId, organizationId), eq(deliveryOrders.id, orderId)),
        )
        .for("update")
        .limit(1);
      const [lockedCourier] = await tx
        .select()
        .from(deliveryCouriers)
        .where(
          and(
            eq(deliveryCouriers.organizationId, organizationId),
            eq(deliveryCouriers.id, input.courierId),
          ),
        )
        .for("update")
        .limit(1);
      if (!lockedOrder || !lockedCourier)
        throw new ConflictException({ code: "STALE_DELIVERY_ASSIGNMENT" });
      if (
        lockedOrder.fulfillment !== "delivery" ||
        lockedOrder.status === "completed" ||
        lockedOrder.status === "canceled" ||
        lockedCourier.unitId !== lockedOrder.unitId ||
        !lockedCourier.active
      )
        throw new ConflictException({
          code: "STALE_DELIVERY_ASSIGNMENT",
          message: "Pedido ou entregador mudou durante a atribuição.",
        });
      if (lockedCourier.status !== "available")
        throw new ConflictException({
          code: "DELIVERY_COURIER_BUSY",
          message: "Entregador indisponível.",
        });
      if (lockedOrder.courierId && lockedOrder.courierId !== input.courierId) {
        await tx
          .update(deliveryCouriers)
          .set({ status: "available", updatedAt: new Date() })
          .where(
            and(
              eq(deliveryCouriers.organizationId, organizationId),
              eq(deliveryCouriers.id, lockedOrder.courierId),
              eq(deliveryCouriers.status, "assigned"),
            ),
          );
      }
      const [assignment] = await tx
        .insert(deliveryCourierAssignments)
        .values({
          organizationId,
          unitId: order.unitId,
          deliveryOrderId: orderId,
          courierId: input.courierId,
          assignedByIdentityId: identityId,
          idempotencyKey: input.idempotencyKey,
          requestFingerprint,
        })
        .returning();
      if (!assignment) throw new Error("DELIVERY_ASSIGNMENT_INSERT_FAILED");
      const assignedAt = assignment.assignedAt;
      const [updatedOrder] = await tx
        .update(deliveryOrders)
        .set({ courierId: input.courierId, courierAssignedAt: assignedAt, updatedAt: new Date() })
        .where(
          and(eq(deliveryOrders.organizationId, organizationId), eq(deliveryOrders.id, orderId)),
        )
        .returning();
      await tx
        .update(deliveryCouriers)
        .set({ status: "assigned", updatedAt: new Date() })
        .where(
          and(
            eq(deliveryCouriers.organizationId, organizationId),
            eq(deliveryCouriers.id, input.courierId),
          ),
        );
      await this.audit(tx, {
        organizationId,
        unitId: order.unitId,
        identityId,
        action: "growth.delivery_courier.assigned",
        entityType: "growth_delivery_order",
        entityId: orderId,
        metadata: { courierId: input.courierId },
      });
      await this.outbox(tx, "growth.delivery_courier_assigned", "growth_delivery_order", orderId, {
        organizationId,
        unitId: order.unitId,
        orderId,
        courierId: input.courierId,
        courierReference: lockedCourier.reference,
      });
      return { duplicate: false, assignment, order: updatedOrder };
    });
  }

  async requestDeliveryNotification(
    identityId: string,
    organizationId: string,
    orderId: string,
    input: DeliveryNotificationInput,
  ) {
    const [order] = await this.database.db
      .select()
      .from(deliveryOrders)
      .where(and(eq(deliveryOrders.organizationId, organizationId), eq(deliveryOrders.id, orderId)))
      .limit(1);
    if (!order)
      throw new NotFoundException({
        code: "DELIVERY_ORDER_NOT_FOUND",
        message: "Pedido não encontrado.",
      });
    await this.scope.requireUnitAccess(identityId, organizationId, order.unitId);
    const requestFingerprint = payloadFingerprint({ orderId, input });
    const [created] = await this.database.db.transaction(async (tx) => {
      const rows = await tx
        .insert(deliveryNotifications)
        .values({
          organizationId,
          unitId: order.unitId,
          deliveryOrderId: orderId,
          audience: input.audience,
          type: input.type,
          requestedByIdentityId: identityId,
          idempotencyKey: input.idempotencyKey,
          requestFingerprint,
        })
        .onConflictDoNothing()
        .returning();
      const notification = rows[0];
      if (notification) {
        await this.audit(tx, {
          organizationId,
          unitId: order.unitId,
          identityId,
          action: "growth.delivery_notification.requested",
          entityType: "growth_delivery_notification",
          entityId: notification.id,
          metadata: {
            orderId,
            audience: input.audience,
            type: input.type,
            externalProvider: false,
          },
        });
        await this.outbox(
          tx,
          "growth.delivery_notification_requested",
          "growth_delivery_notification",
          notification.id,
          {
            organizationId,
            unitId: order.unitId,
            orderId,
            notificationId: notification.id,
            audience: input.audience,
            notificationType: input.type,
            status: "pending_provider",
            providerAvailable: false,
          },
        );
      }
      return rows;
    });
    if (created) return { duplicate: false, notification: created };
    const [existing] = await this.database.db
      .select()
      .from(deliveryNotifications)
      .where(
        and(
          eq(deliveryNotifications.organizationId, organizationId),
          eq(deliveryNotifications.idempotencyKey, input.idempotencyKey),
        ),
      )
      .limit(1);
    if (!existing || existing.requestFingerprint !== requestFingerprint)
      return this.idempotencyConflict();
    return { duplicate: true, notification: existing };
  }

  async transitionDelivery(
    identityId: string,
    organizationId: string,
    orderId: string,
    input: DeliveryTransitionInput,
  ) {
    const [current] = await this.database.db
      .select()
      .from(deliveryOrders)
      .where(and(eq(deliveryOrders.organizationId, organizationId), eq(deliveryOrders.id, orderId)))
      .limit(1);
    if (!current)
      throw new NotFoundException({
        code: "DELIVERY_ORDER_NOT_FOUND",
        message: "Pedido não encontrado.",
      });
    await this.scope.requireUnitAccess(identityId, organizationId, current.unitId);
    if (input.status === "dispatched")
      throw new ConflictException({
        code: "DELIVERY_DISPATCH_ENDPOINT_REQUIRED",
        message: "Use o endpoint de despacho para iniciar a entrega.",
      });
    if (!canTransition(deliveryTransitions, current.status, input.status))
      throw new ConflictException({
        code: "INVALID_DELIVERY_TRANSITION",
        message: "Transição inválida.",
      });
    return this.database.db.transaction(async (tx) => {
      const [updated] = await tx
        .update(deliveryOrders)
        .set({ status: input.status, updatedAt: new Date() })
        .where(
          and(
            eq(deliveryOrders.organizationId, organizationId),
            eq(deliveryOrders.id, orderId),
            eq(deliveryOrders.status, current.status),
          ),
        )
        .returning();
      if (!updated)
        throw new ConflictException({
          code: "STALE_DELIVERY_ORDER",
          message: "Pedido alterado por outro usuário.",
        });
      await tx.insert(deliveryOrderStatusHistory).values({
        organizationId,
        unitId: current.unitId,
        deliveryOrderId: orderId,
        fromStatus: current.status,
        toStatus: input.status,
        actorIdentityId: identityId,
        metadata: { source: "manual_transition" },
      });
      if (current.courierId && (input.status === "completed" || input.status === "canceled")) {
        await tx
          .update(deliveryCouriers)
          .set({ status: "available", updatedAt: new Date() })
          .where(
            and(
              eq(deliveryCouriers.organizationId, organizationId),
              eq(deliveryCouriers.id, current.courierId),
              inArray(deliveryCouriers.status, ["assigned", "delivering"]),
            ),
          );
      }
      await this.audit(tx, {
        organizationId,
        unitId: current.unitId,
        identityId,
        action: "growth.delivery_order.transitioned",
        entityType: "growth_delivery_order",
        entityId: orderId,
        metadata: { from: current.status, to: input.status },
      });
      await this.outbox(tx, "growth.delivery_order_changed", "growth_delivery_order", orderId, {
        organizationId,
        unitId: current.unitId,
        from: current.status,
        to: input.status,
      });
      return updated;
    });
  }

  async dispatchDelivery(
    identityId: string,
    organizationId: string,
    orderId: string,
    input: DispatchInput,
  ) {
    const [order] = await this.database.db
      .select()
      .from(deliveryOrders)
      .where(and(eq(deliveryOrders.organizationId, organizationId), eq(deliveryOrders.id, orderId)))
      .limit(1);
    if (!order)
      throw new NotFoundException({
        code: "DELIVERY_ORDER_NOT_FOUND",
        message: "Pedido não encontrado.",
      });
    await this.scope.requireUnitAccess(identityId, organizationId, order.unitId);
    const requestFingerprint = payloadFingerprint({ orderId, input });
    const [known] = await this.database.db
      .select()
      .from(deliveryDispatches)
      .where(
        and(
          eq(deliveryDispatches.organizationId, organizationId),
          eq(deliveryDispatches.idempotencyKey, input.idempotencyKey),
        ),
      )
      .limit(1);
    if (known) {
      if (known.requestFingerprint !== requestFingerprint) return this.idempotencyConflict();
      return { duplicate: true, dispatch: known };
    }
    if (order.fulfillment !== "delivery" || order.status !== "ready")
      throw new ConflictException({
        code: "DELIVERY_NOT_READY",
        message: "Entrega não está pronta para despacho.",
      });
    const assignedCourier = order.courierId
      ? await this.deliveryCourier(organizationId, order.courierId)
      : null;
    const courierReference = assignedCourier?.reference ?? input.courierReference;
    return this.database.db.transaction(async (tx) => {
      const [dispatch] = await tx
        .insert(deliveryDispatches)
        .values({
          organizationId,
          unitId: order.unitId,
          deliveryOrderId: order.id,
          courierReference,
          idempotencyKey: input.idempotencyKey,
          requestFingerprint,
        })
        .returning();
      if (!dispatch) throw new Error("DISPATCH_INSERT_FAILED");
      const [updated] = await tx
        .update(deliveryOrders)
        .set({ status: "dispatched", updatedAt: new Date() })
        .where(
          and(
            eq(deliveryOrders.organizationId, organizationId),
            eq(deliveryOrders.id, order.id),
            eq(deliveryOrders.status, "ready"),
          ),
        )
        .returning();
      if (!updated)
        throw new ConflictException({
          code: "STALE_DELIVERY_ORDER",
          message: "Pedido alterado por outro usuário.",
        });
      await tx.insert(deliveryOrderStatusHistory).values({
        organizationId,
        unitId: order.unitId,
        deliveryOrderId: order.id,
        fromStatus: "ready",
        toStatus: "dispatched",
        actorIdentityId: identityId,
        metadata: { source: "dispatch", dispatchId: dispatch.id },
      });
      if (order.courierId) {
        const [courier] = await tx
          .update(deliveryCouriers)
          .set({ status: "delivering", updatedAt: new Date() })
          .where(
            and(
              eq(deliveryCouriers.organizationId, organizationId),
              eq(deliveryCouriers.id, order.courierId),
              eq(deliveryCouriers.status, "assigned"),
            ),
          )
          .returning({ id: deliveryCouriers.id });
        if (!courier)
          throw new ConflictException({
            code: "DELIVERY_COURIER_NOT_ASSIGNED",
            message: "Entregador atribuído não está disponível para despacho.",
          });
      }
      await this.audit(tx, {
        organizationId,
        unitId: order.unitId,
        identityId,
        action: "growth.delivery.dispatched",
        entityType: "growth_delivery_dispatch",
        entityId: dispatch.id,
        metadata: { orderId: order.id, courierReference },
      });
      await this.outbox(tx, "growth.delivery_dispatched", "growth_delivery_order", order.id, {
        organizationId,
        unitId: order.unitId,
        orderId: order.id,
        dispatchId: dispatch.id,
        courierId: order.courierId,
      });
      return { duplicate: false, dispatch };
    });
  }

  async upsertPriceOverride(identityId: string, organizationId: string, input: PriceOverrideInput) {
    await this.scope.requireOrganizationRole(identityId, organizationId, MANAGERS);
    await this.scope.requireUnitAccess(identityId, organizationId, input.unitId);
    return this.database.db.transaction(async (tx) => {
      const [override] = await tx
        .insert(unitPriceOverrides)
        .values({ organizationId, ...input })
        .onConflictDoUpdate({
          target: [unitPriceOverrides.unitId, unitPriceOverrides.productRef],
          set: { priceCents: input.priceCents, active: input.active, updatedAt: new Date() },
        })
        .returning();
      if (!override) throw new Error("PRICE_OVERRIDE_UPSERT_FAILED");
      await this.audit(tx, {
        organizationId,
        unitId: input.unitId,
        identityId,
        action: "growth.price_override.upserted",
        entityType: "growth_price_override",
        entityId: override.id,
        metadata: {
          productRef: input.productRef,
          priceCents: input.priceCents,
          active: input.active,
        },
      });
      await this.outbox(tx, "growth.price_override_changed", "growth_price_override", override.id, {
        organizationId,
        unitId: input.unitId,
        productRef: input.productRef,
      });
      return override;
    });
  }

  async createTransfer(identityId: string, organizationId: string, input: TransferInput) {
    await this.scope.requireOrganizationRole(identityId, organizationId, MANAGERS);
    await this.scope.requireUnitAccess(identityId, organizationId, input.originUnitId);
    await this.scope.requireUnitAccess(identityId, organizationId, input.destinationUnitId);
    if (input.originUnitId === input.destinationUnitId)
      throw new BadRequestException({
        code: "TRANSFER_SAME_UNIT",
        message: "As unidades devem ser diferentes.",
      });
    const requestFingerprint = payloadFingerprint(input);
    const [created] = await this.database.db.transaction(async (tx) => {
      const rows = await tx
        .insert(inventoryTransfers)
        .values({
          organizationId,
          originUnitId: input.originUnitId,
          destinationUnitId: input.destinationUnitId,
          notes: input.notes ?? null,
          idempotencyKey: input.idempotencyKey,
          requestFingerprint,
        })
        .onConflictDoNothing()
        .returning();
      const transfer = rows[0];
      if (!transfer) return rows;
      await tx.insert(inventoryTransferLines).values(
        input.lines.map((line) => ({
          organizationId,
          transferId: transfer.id,
          inventoryItemRef: line.inventoryItemRef,
          quantity: String(line.quantity),
        })),
      );
      await this.audit(tx, {
        organizationId,
        identityId,
        action: "growth.inventory_transfer.created",
        entityType: "growth_inventory_transfer",
        entityId: transfer.id,
        metadata: {
          originUnitId: input.originUnitId,
          destinationUnitId: input.destinationUnitId,
          lineCount: input.lines.length,
        },
      });
      for (const unitId of [input.originUnitId, input.destinationUnitId])
        await this.outbox(
          tx,
          "growth.inventory_transfer_created",
          "growth_inventory_transfer",
          transfer.id,
          {
            organizationId,
            unitId,
            transferId: transfer.id,
            originUnitId: input.originUnitId,
            destinationUnitId: input.destinationUnitId,
          },
        );
      return rows;
    });
    if (created) return { duplicate: false, transfer: created };
    const [existing] = await this.database.db
      .select()
      .from(inventoryTransfers)
      .where(
        and(
          eq(inventoryTransfers.organizationId, organizationId),
          eq(inventoryTransfers.idempotencyKey, input.idempotencyKey),
        ),
      )
      .limit(1);
    if (!existing || existing.requestFingerprint !== requestFingerprint)
      return this.idempotencyConflict();
    return { duplicate: true, transfer: existing };
  }

  async transitionTransfer(
    identityId: string,
    organizationId: string,
    transferId: string,
    input: TransferTransitionInput,
  ) {
    await this.scope.requireOrganizationRole(identityId, organizationId, MANAGERS);
    const [current] = await this.database.db
      .select()
      .from(inventoryTransfers)
      .where(
        and(
          eq(inventoryTransfers.organizationId, organizationId),
          eq(inventoryTransfers.id, transferId),
        ),
      )
      .limit(1);
    if (!current)
      throw new NotFoundException({
        code: "TRANSFER_NOT_FOUND",
        message: "Transferência não encontrada.",
      });
    await this.scope.requireUnitAccess(identityId, organizationId, current.originUnitId);
    await this.scope.requireUnitAccess(identityId, organizationId, current.destinationUnitId);
    if (!canTransition(transferTransitions, current.status, input.status))
      throw new ConflictException({
        code: "INVALID_TRANSFER_TRANSITION",
        message: "Transição inválida.",
      });
    return this.database.db.transaction(async (tx) => {
      const now = new Date();
      const [updated] = await tx
        .update(inventoryTransfers)
        .set({
          status: input.status,
          sentAt: input.status === "in_transit" ? now : current.sentAt,
          receivedAt: input.status === "received" ? now : current.receivedAt,
          updatedAt: now,
        })
        .where(
          and(
            eq(inventoryTransfers.organizationId, organizationId),
            eq(inventoryTransfers.id, transferId),
            eq(inventoryTransfers.status, current.status),
          ),
        )
        .returning();
      if (!updated)
        throw new ConflictException({
          code: "STALE_TRANSFER",
          message: "Transferência alterada por outro usuário.",
        });
      await this.audit(tx, {
        organizationId,
        identityId,
        action: "growth.inventory_transfer.transitioned",
        entityType: "growth_inventory_transfer",
        entityId: transferId,
        metadata: { from: current.status, to: input.status },
      });
      for (const unitId of [current.originUnitId, current.destinationUnitId])
        await this.outbox(
          tx,
          "growth.inventory_transfer_changed",
          "growth_inventory_transfer",
          transferId,
          {
            organizationId,
            unitId,
            originUnitId: current.originUnitId,
            destinationUnitId: current.destinationUnitId,
            from: current.status,
            to: input.status,
          },
        );
      return updated;
    });
  }

  async consolidatedSummary(identityId: string, organizationId: string) {
    await this.scope.requireOrganizationRole(identityId, organizationId, FINANCIAL_READERS);
    const organizationUnits = await this.database.db
      .select({ id: units.id, name: units.name })
      .from(units)
      .where(and(eq(units.organizationId, organizationId), eq(units.active, true)))
      .orderBy(asc(units.name));
    const [deliveryRows, reservationRows, waitlistRows, transferRows] = await Promise.all([
      this.database.db
        .select({
          unitId: deliveryOrders.unitId,
          completedDeliveryGrossCents: sum(deliveryOrders.totalCents),
        })
        .from(deliveryOrders)
        .where(
          and(
            eq(deliveryOrders.organizationId, organizationId),
            eq(deliveryOrders.status, "completed"),
          ),
        )
        .groupBy(deliveryOrders.unitId),
      this.database.db
        .select({ unitId: reservations.unitId, activeReservations: count() })
        .from(reservations)
        .where(
          and(
            eq(reservations.organizationId, organizationId),
            inArray(reservations.status, ["booked", "confirmed", "seated"]),
          ),
        )
        .groupBy(reservations.unitId),
      this.database.db
        .select({ unitId: waitlistEntries.unitId, activeWaitlist: count() })
        .from(waitlistEntries)
        .where(
          and(
            eq(waitlistEntries.organizationId, organizationId),
            inArray(waitlistEntries.status, ["waiting", "notified"]),
          ),
        )
        .groupBy(waitlistEntries.unitId),
      this.database.db
        .select({ status: inventoryTransfers.status, total: count() })
        .from(inventoryTransfers)
        .where(eq(inventoryTransfers.organizationId, organizationId))
        .groupBy(inventoryTransfers.status),
    ]);
    return {
      organizationId,
      generatedAt: new Date(),
      units: organizationUnits.map((unit) => ({
        ...unit,
        completedDeliveryGrossCents: Number(
          deliveryRows.find((row) => row.unitId === unit.id)?.completedDeliveryGrossCents ?? 0,
        ),
        activeReservations: Number(
          reservationRows.find((row) => row.unitId === unit.id)?.activeReservations ?? 0,
        ),
        activeWaitlist: Number(
          waitlistRows.find((row) => row.unitId === unit.id)?.activeWaitlist ?? 0,
        ),
      })),
      transfersByStatus: Object.fromEntries(
        transferRows.map((row) => [row.status, Number(row.total)]),
      ),
      disclaimer:
        "Resumo operacional baseado apenas em registros persistidos; não substitui conciliação financeira.",
    };
  }

  async createApiKey(identityId: string, organizationId: string, input: ApiKeyInput) {
    await this.scope.requireOrganizationRole(identityId, organizationId, ["owner"]);
    const rawKey = `gm_live_${randomBytes(32).toString("base64url")}`;
    const [created] = await this.database.db.transaction(async (tx) => {
      const rows = await tx
        .insert(publicApiKeys)
        .values({
          organizationId,
          name: input.name,
          keyPrefix: rawKey.slice(0, 12),
          keyHash: hashOpaqueSecret(rawKey),
          keyLastFour: rawKey.slice(-4),
          scopes: [...new Set(input.scopes)],
          createdByIdentityId: identityId,
          expiresAt: input.expiresAt ?? null,
        })
        .returning({
          id: publicApiKeys.id,
          organizationId: publicApiKeys.organizationId,
          name: publicApiKeys.name,
          keyPrefix: publicApiKeys.keyPrefix,
          keyLastFour: publicApiKeys.keyLastFour,
          scopes: publicApiKeys.scopes,
          expiresAt: publicApiKeys.expiresAt,
          createdAt: publicApiKeys.createdAt,
        });
      const row = rows[0];
      if (row)
        await this.audit(tx, {
          organizationId,
          identityId,
          action: "growth.public_api_key.created",
          entityType: "growth_public_api_key",
          entityId: row.id,
          metadata: { name: row.name, scopes: row.scopes, keyPrefix: row.keyPrefix },
        });
      return rows;
    });
    if (!created) throw new Error("API_KEY_INSERT_FAILED");
    return {
      ...created,
      key: rawKey,
      warning: "A chave é exibida uma única vez e não é armazenada em texto claro.",
    };
  }

  async listApiKeys(identityId: string, organizationId: string) {
    await this.scope.requireOrganizationRole(identityId, organizationId, ["owner"]);
    return this.database.db
      .select({
        id: publicApiKeys.id,
        name: publicApiKeys.name,
        keyPrefix: publicApiKeys.keyPrefix,
        keyLastFour: publicApiKeys.keyLastFour,
        scopes: publicApiKeys.scopes,
        expiresAt: publicApiKeys.expiresAt,
        revokedAt: publicApiKeys.revokedAt,
        lastUsedAt: publicApiKeys.lastUsedAt,
        createdAt: publicApiKeys.createdAt,
      })
      .from(publicApiKeys)
      .where(eq(publicApiKeys.organizationId, organizationId));
  }

  async revokeApiKey(identityId: string, organizationId: string, keyId: string) {
    await this.scope.requireOrganizationRole(identityId, organizationId, ["owner"]);
    return this.database.db.transaction(async (tx) => {
      const [revoked] = await tx
        .update(publicApiKeys)
        .set({ revokedAt: new Date() })
        .where(and(eq(publicApiKeys.organizationId, organizationId), eq(publicApiKeys.id, keyId)))
        .returning({ id: publicApiKeys.id, revokedAt: publicApiKeys.revokedAt });
      if (!revoked)
        throw new NotFoundException({
          code: "API_KEY_NOT_FOUND",
          message: "Chave não encontrada.",
        });
      await this.audit(tx, {
        organizationId,
        identityId,
        action: "growth.public_api_key.revoked",
        entityType: "growth_public_api_key",
        entityId: keyId,
      });
      return revoked;
    });
  }

  private async authenticateApiKey(rawKey: string, requiredScope: string) {
    const keyHash = hashOpaqueSecret(rawKey);
    const [key] = await this.database.db
      .select()
      .from(publicApiKeys)
      .where(and(eq(publicApiKeys.keyHash, keyHash), isNull(publicApiKeys.revokedAt)))
      .limit(1);
    if (!key || (key.expiresAt && key.expiresAt <= new Date()))
      throw new UnauthorizedException({ code: "API_KEY_INVALID", message: "Chave inválida." });
    if (!key.scopes.includes(requiredScope))
      throw new ForbiddenException({
        code: "API_KEY_SCOPE_DENIED",
        message: "Escopo não autorizado.",
      });
    await this.database.db
      .update(publicApiKeys)
      .set({ lastUsedAt: new Date() })
      .where(eq(publicApiKeys.id, key.id));
    return key;
  }

  private masterWebhookKey() {
    const key = process.env.WEBHOOK_SIGNING_MASTER_KEY;
    if (!key || key.length < 32)
      throw new ServiceUnavailableException({
        code: "WEBHOOK_SIGNING_NOT_CONFIGURED",
        message: "Assinatura de webhooks não configurada.",
      });
    return key;
  }

  private webhookSecret(organizationId: string, endpointId: string, version: number) {
    return createHmac("sha256", this.masterWebhookKey())
      .update(`${organizationId}:${endpointId}:v${version}`)
      .digest("base64url");
  }

  signWebhookPayload(organizationId: string, endpointId: string, version: number, body: string) {
    const secret = this.webhookSecret(organizationId, endpointId, version);
    return `sha256=${createHmac("sha256", secret).update(body).digest("hex")}`;
  }

  async createWebhookEndpoint(
    identityId: string,
    organizationId: string,
    input: WebhookEndpointInput,
  ) {
    await this.scope.requireOrganizationRole(identityId, organizationId, ["owner"]);
    this.masterWebhookKey();
    const id = randomUUID();
    const [endpoint] = await this.database.db.transaction(async (tx) => {
      const rows = await tx
        .insert(webhookEndpoints)
        .values({
          id,
          organizationId,
          url: input.url,
          eventTypes: [...new Set(input.eventTypes)],
          createdByIdentityId: identityId,
        })
        .returning();
      const row = rows[0];
      if (row)
        await this.audit(tx, {
          organizationId,
          identityId,
          action: "growth.webhook_endpoint.created",
          entityType: "growth_webhook_endpoint",
          entityId: row.id,
          metadata: {
            url: row.url,
            eventTypes: row.eventTypes,
            signingKeyVersion: row.signingKeyVersion,
          },
        });
      return rows;
    });
    if (!endpoint) throw new Error("WEBHOOK_ENDPOINT_INSERT_FAILED");
    return {
      endpoint,
      signingSecret: this.webhookSecret(organizationId, endpoint.id, endpoint.signingKeyVersion),
      warning: "O segredo derivado é exibido uma única vez e não é armazenado em texto claro.",
    };
  }

  async listWebhookEndpoints(identityId: string, organizationId: string) {
    await this.scope.requireOrganizationRole(identityId, organizationId, ["owner"]);
    return this.database.db
      .select()
      .from(webhookEndpoints)
      .where(eq(webhookEndpoints.organizationId, organizationId));
  }

  async publishWebhook(rawKey: string, input: WebhookEventInput) {
    const key = await this.authenticateApiKey(rawKey, WEBHOOK_SCOPE);
    const requestFingerprint = payloadFingerprint(input);
    return this.database.db.transaction(async (tx) => {
      const [existing] = await tx
        .select()
        .from(webhookPublications)
        .where(
          and(
            eq(webhookPublications.organizationId, key.organizationId),
            eq(webhookPublications.idempotencyKey, input.idempotencyKey),
          ),
        )
        .limit(1);
      if (existing) {
        const existingFingerprint = payloadFingerprint({
          eventType: existing.eventType,
          aggregateType: existing.aggregateType,
          aggregateId: existing.aggregateId,
          payload: existing.payload,
          idempotencyKey: existing.idempotencyKey,
        });
        if (existingFingerprint !== requestFingerprint) return this.idempotencyConflict();
        return { duplicate: true, publication: existing, queuedEndpoints: 0 };
      }
      const [publication] = await tx
        .insert(webhookPublications)
        .values({ organizationId: key.organizationId, ...input })
        .returning();
      if (!publication) throw new Error("WEBHOOK_PUBLICATION_INSERT_FAILED");
      const endpoints = await tx
        .select()
        .from(webhookEndpoints)
        .where(
          and(
            eq(webhookEndpoints.organizationId, key.organizationId),
            eq(webhookEndpoints.active, true),
          ),
        );
      const subscribed = endpoints.filter((endpoint) =>
        endpoint.eventTypes.includes(input.eventType),
      );
      for (const endpoint of subscribed)
        await this.outbox(
          tx,
          "growth.webhook_delivery_requested",
          "growth_webhook_publication",
          publication.id,
          {
            organizationId: key.organizationId,
            publicationId: publication.id,
            endpointId: endpoint.id,
            eventType: publication.eventType,
            signingKeyVersion: endpoint.signingKeyVersion,
          },
        );
      await this.audit(tx, {
        organizationId: key.organizationId,
        action: "growth.webhook_publication.queued",
        entityType: "growth_webhook_publication",
        entityId: publication.id,
        metadata: {
          eventType: publication.eventType,
          queuedEndpoints: subscribed.length,
          apiKeyId: key.id,
        },
      });
      return { duplicate: false, publication, queuedEndpoints: subscribed.length };
    });
  }

  async getDoseClub(identityId: string, organizationId: string) {
    await this.scope.requireOrganizationRole(identityId, organizationId, MANAGERS);
    const rows = await this.database.db
      .select()
      .from(growthIntegrations)
      .where(
        and(
          eq(growthIntegrations.organizationId, organizationId),
          eq(growthIntegrations.provider, "doseclub"),
        ),
      );
    if (rows.length === 0)
      return { provider: "doseclub", status: "disabled", reason: "CREDENTIALS_NOT_CONFIGURED" };
    return rows;
  }

  async configureDoseClub(identityId: string, organizationId: string, input: DoseClubInput) {
    await this.scope.requireOrganizationRole(identityId, organizationId, ["owner"]);
    if (input.unitId) await this.scope.requireUnitAccess(identityId, organizationId, input.unitId);
    if (process.env.DOSECLUB_PROVIDER_ENABLED !== "true")
      throw new ServiceUnavailableException({
        code: "DOSECLUB_DISABLED",
        message: "Integração DoseClub permanece desabilitada até a configuração do provedor.",
      });
    return this.database.db.transaction(async (tx) => {
      const conditions = [
        eq(growthIntegrations.organizationId, organizationId),
        eq(growthIntegrations.provider, "doseclub"),
        input.unitId
          ? eq(growthIntegrations.unitId, input.unitId)
          : isNull(growthIntegrations.unitId),
      ];
      const [existing] = await tx
        .select()
        .from(growthIntegrations)
        .where(and(...conditions))
        .limit(1);
      const [integration] = existing
        ? await tx
            .update(growthIntegrations)
            .set({
              status: "pending",
              credentialReference: input.credentialReference,
              config: input.config,
              updatedAt: new Date(),
            })
            .where(
              and(
                eq(growthIntegrations.organizationId, organizationId),
                eq(growthIntegrations.id, existing.id),
              ),
            )
            .returning()
        : await tx
            .insert(growthIntegrations)
            .values({
              organizationId,
              unitId: input.unitId ?? null,
              provider: "doseclub",
              status: "pending",
              credentialReference: input.credentialReference,
              config: input.config,
            })
            .returning();
      if (!integration) throw new Error("DOSECLUB_CONFIG_INSERT_FAILED");
      await this.audit(tx, {
        organizationId,
        unitId: input.unitId,
        identityId,
        action: "growth.integration.doseclub_configuration_requested",
        entityType: "growth_integration",
        entityId: integration.id,
        metadata: { status: "pending", credentialReference: input.credentialReference },
      });
      await this.outbox(
        tx,
        "growth.integration_configuration_requested",
        "growth_integration",
        integration.id,
        {
          organizationId,
          unitId: input.unitId ?? null,
          integrationId: integration.id,
          provider: "doseclub",
          credentialReference: input.credentialReference,
        },
      );
      return {
        ...integration,
        status: "pending",
        warning: "Pendente de validação pelo provedor; nenhuma conexão externa foi alegada.",
      };
    });
  }

  private async evolutionIntegration(organizationId: string, unitId: string) {
    const [integration] = await this.database.db
      .select()
      .from(growthIntegrations)
      .where(
        and(
          eq(growthIntegrations.organizationId, organizationId),
          eq(growthIntegrations.unitId, unitId),
          eq(growthIntegrations.provider, "evolution_go"),
        ),
      )
      .limit(1);
    if (!integration)
      throw new NotFoundException({
        code: "EVOLUTION_INTEGRATION_NOT_FOUND",
        message: "Configure a Evolution Go para esta unidade.",
      });
    return integration;
  }

  private evolutionView(integration: typeof growthIntegrations.$inferSelect) {
    return {
      id: integration.id,
      organizationId: integration.organizationId,
      unitId: integration.unitId,
      provider: integration.provider,
      status: integration.status,
      config: integration.config,
      configured: Boolean(integration.credentialReference),
      updatedAt: integration.updatedAt,
    };
  }

  async getEvolutionIntegration(identityId: string, organizationId: string, unitId: string) {
    await this.scope.requireOrganizationRole(identityId, organizationId, MANAGERS);
    await this.scope.requireUnitAccess(identityId, organizationId, unitId);
    try {
      return this.evolutionView(await this.evolutionIntegration(organizationId, unitId));
    } catch (error) {
      if (error instanceof NotFoundException)
        return {
          provider: "evolution_go",
          unitId,
          status: "disabled",
          configured: false,
          config: {},
        };
      throw error;
    }
  }

  async configureEvolution(
    identityId: string,
    organizationId: string,
    input: EvolutionConfigurationInput,
  ) {
    await this.scope.requireOrganizationRole(identityId, organizationId, ["owner"]);
    await this.scope.requireUnitAccess(identityId, organizationId, input.unitId);
    if (process.env.WHATSAPP_PROVIDER_ENABLED !== "true")
      throw new ServiceUnavailableException({
        code: "EVOLUTION_PROVIDER_DISABLED",
        message: "A Evolution Go está desabilitada no ambiente.",
      });
    const integration = await this.database.db.transaction(async (tx) => {
      const [existing] = await tx
        .select()
        .from(growthIntegrations)
        .where(
          and(
            eq(growthIntegrations.organizationId, organizationId),
            eq(growthIntegrations.unitId, input.unitId),
            eq(growthIntegrations.provider, "evolution_go"),
          ),
        )
        .limit(1);
      const config = {
        quietHoursStart: input.quietHoursStart,
        quietHoursEnd: input.quietHoursEnd,
        maxMessagesPer30Days: input.maxMessagesPer30Days,
      };
      const [row] = existing
        ? await tx
            .update(growthIntegrations)
            .set({
              status: input.enabled ? "connecting" : "disabled",
              config,
              updatedAt: new Date(),
            })
            .where(eq(growthIntegrations.id, existing.id))
            .returning()
        : await tx
            .insert(growthIntegrations)
            .values({
              organizationId,
              unitId: input.unitId,
              provider: "evolution_go",
              status: input.enabled ? "connecting" : "disabled",
              config,
            })
            .returning();
      if (!row) throw new Error("EVOLUTION_INTEGRATION_INSERT_FAILED");
      const client = new EvolutionGoClient(row.id, input.unitId);
      const [secured] = await tx
        .update(growthIntegrations)
        .set({ credentialReference: client.credentialReference, updatedAt: new Date() })
        .where(eq(growthIntegrations.id, row.id))
        .returning();
      await this.audit(tx, {
        organizationId,
        unitId: input.unitId,
        identityId,
        action: "growth.integration.evolution_go.configured",
        entityType: "growth_integration",
        entityId: row.id,
        metadata: { enabled: input.enabled },
      });
      if (!secured) throw new Error("EVOLUTION_INTEGRATION_SECURE_REFERENCE_FAILED");
      return secured;
    });
    if (!input.enabled) return this.evolutionView(integration);
    const client = new EvolutionGoClient(integration.id, input.unitId);
    try {
      try {
        await client.status();
      } catch (error) {
        if (!(error instanceof EvolutionGoError) || error.code !== "EVOLUTION_HTTP_401")
          throw error;
        await client.create();
      }
      await client.connect();
      const status = await client.status();
      const [updated] = await this.database.db
        .update(growthIntegrations)
        .set({
          status: status.state,
          config: {
            ...integration.config,
            connectedNumber: status.connectedNumber,
            lastStatusAt: new Date().toISOString(),
          },
          updatedAt: new Date(),
        })
        .where(eq(growthIntegrations.id, integration.id))
        .returning();
      return this.evolutionView(updated ?? integration);
    } catch (error) {
      const code =
        error instanceof EvolutionGoError ? error.code : "EVOLUTION_CONFIGURATION_FAILED";
      await this.database.db
        .update(growthIntegrations)
        .set({
          status: "error",
          config: { ...integration.config, lastErrorCode: code },
          updatedAt: new Date(),
        })
        .where(eq(growthIntegrations.id, integration.id));
      throw new ServiceUnavailableException({
        code,
        message: "A Evolution Go não concluiu a configuração.",
      });
    }
  }

  async evolutionStatus(identityId: string, organizationId: string, unitId: string) {
    await this.scope.requireOrganizationRole(identityId, organizationId, MANAGERS);
    await this.scope.requireUnitAccess(identityId, organizationId, unitId);
    const integration = await this.evolutionIntegration(organizationId, unitId);
    const client = new EvolutionGoClient(integration.id, unitId);
    try {
      const status = await client.status();
      const [updated] = await this.database.db
        .update(growthIntegrations)
        .set({
          status: status.state,
          config: {
            ...integration.config,
            connectedNumber: status.connectedNumber,
            lastStatusAt: new Date().toISOString(),
            lastErrorCode: null,
          },
          updatedAt: new Date(),
        })
        .where(eq(growthIntegrations.id, integration.id))
        .returning();
      return { ...this.evolutionView(updated ?? integration), ...status };
    } catch (error) {
      const code = error instanceof EvolutionGoError ? error.code : "EVOLUTION_STATUS_FAILED";
      await this.database.db
        .update(growthIntegrations)
        .set({
          status: "error",
          config: { ...integration.config, lastErrorCode: code },
          updatedAt: new Date(),
        })
        .where(eq(growthIntegrations.id, integration.id));
      throw new ServiceUnavailableException({
        code,
        message: "Não foi possível consultar a Evolution Go.",
      });
    }
  }

  async evolutionQr(identityId: string, organizationId: string, unitId: string) {
    await this.scope.requireOrganizationRole(identityId, organizationId, ["owner"]);
    await this.scope.requireUnitAccess(identityId, organizationId, unitId);
    const integration = await this.evolutionIntegration(organizationId, unitId);
    try {
      return await new EvolutionGoClient(integration.id, unitId).qr();
    } catch (error) {
      const code = error instanceof EvolutionGoError ? error.code : "EVOLUTION_QR_FAILED";
      throw new ServiceUnavailableException({ code, message: "Não foi possível obter o QR Code." });
    }
  }

  async evolutionConnectionAction(
    identityId: string,
    organizationId: string,
    unitId: string,
    action: "reconnect" | "logout",
  ) {
    await this.scope.requireOrganizationRole(identityId, organizationId, ["owner"]);
    await this.scope.requireUnitAccess(identityId, organizationId, unitId);
    const integration = await this.evolutionIntegration(organizationId, unitId);
    const client = new EvolutionGoClient(integration.id, unitId);
    try {
      if (action === "logout") await client.logout();
      else await client.reconnect();
      const status =
        action === "logout"
          ? { state: "disconnected" as const, ready: false, connectedNumber: null }
          : await client.status();
      await this.database.db.transaction(async (tx) => {
        await tx
          .update(growthIntegrations)
          .set({
            status: status.state,
            config: { ...integration.config, connectedNumber: status.connectedNumber },
            updatedAt: new Date(),
          })
          .where(eq(growthIntegrations.id, integration.id));
        await this.audit(tx, {
          organizationId,
          unitId,
          identityId,
          action: `growth.integration.evolution_go.${action}`,
          entityType: "growth_integration",
          entityId: integration.id,
        });
      });
      return status;
    } catch (error) {
      const code = error instanceof EvolutionGoError ? error.code : "EVOLUTION_ACTION_FAILED";
      throw new ServiceUnavailableException({
        code,
        message: "A Evolution Go não concluiu a ação.",
      });
    }
  }

  async listWhatsAppInbox(
    identityId: string,
    organizationId: string,
    input: WhatsAppInboxQueryInput,
  ) {
    await this.scope.requireOrganizationRole(identityId, organizationId, MANAGERS);
    await this.scope.requireUnitAccess(identityId, organizationId, input.unitId);
    const position = sql<Date>`coalesce(${whatsappConversations.lastMessageAt}, ${whatsappConversations.createdAt})`;
    const cursor = input.cursorAt
      ? or(
          lt(position, input.cursorAt),
          and(eq(position, input.cursorAt), lt(whatsappConversations.id, input.cursorId ?? "")),
        )
      : undefined;
    const assigned =
      input.assignedTo === "me"
        ? eq(whatsappConversations.assignedIdentityId, identityId)
        : input.assignedTo === "unassigned"
          ? isNull(whatsappConversations.assignedIdentityId)
          : undefined;
    const pattern = input.search
      ? `%${input.search.replaceAll("%", "\\%").replaceAll("_", "\\_")}%`
      : null;
    const rows = await this.database.db
      .select({
        id: whatsappConversations.id,
        customerId: whatsappConversations.customerId,
        customerName: growthCustomers.name,
        phone: whatsappConversations.phone,
        assignedIdentityId: whatsappConversations.assignedIdentityId,
        assignedIdentityName: identities.displayName,
        status: whatsappConversations.status,
        priority: whatsappConversations.priority,
        unreadCount: whatsappConversations.unreadCount,
        slaDueAt: whatsappConversations.slaDueAt,
        firstResponseAt: whatsappConversations.firstResponseAt,
        closedAt: whatsappConversations.closedAt,
        lastMessageAt: whatsappConversations.lastMessageAt,
        lastInboundAt: whatsappConversations.lastInboundAt,
        lastOutboundAt: whatsappConversations.lastOutboundAt,
        createdAt: whatsappConversations.createdAt,
        updatedAt: whatsappConversations.updatedAt,
      })
      .from(whatsappConversations)
      .leftJoin(
        growthCustomers,
        and(
          eq(growthCustomers.organizationId, whatsappConversations.organizationId),
          eq(growthCustomers.id, whatsappConversations.customerId),
        ),
      )
      .leftJoin(identities, eq(identities.id, whatsappConversations.assignedIdentityId))
      .where(
        and(
          eq(whatsappConversations.organizationId, organizationId),
          eq(whatsappConversations.unitId, input.unitId),
          input.status ? eq(whatsappConversations.status, input.status) : undefined,
          input.priority ? eq(whatsappConversations.priority, input.priority) : undefined,
          assigned,
          pattern
            ? or(ilike(growthCustomers.name, pattern), ilike(whatsappConversations.phone, pattern))
            : undefined,
          cursor,
        ),
      )
      .orderBy(desc(position), desc(whatsappConversations.id))
      .limit(input.limit + 1);
    const hasMore = rows.length > input.limit;
    const items = rows.slice(0, input.limit);
    const tail = items.at(-1);
    return {
      items,
      nextCursor:
        hasMore && tail
          ? { at: (tail.lastMessageAt ?? tail.createdAt).toISOString(), id: tail.id }
          : null,
    };
  }

  async listWhatsAppMessages(
    identityId: string,
    organizationId: string,
    conversationId: string,
    input: WhatsAppMessagesQueryInput,
  ) {
    await this.scope.requireOrganizationRole(identityId, organizationId, MANAGERS);
    const [conversation] = await this.database.db
      .select()
      .from(whatsappConversations)
      .where(
        and(
          eq(whatsappConversations.organizationId, organizationId),
          eq(whatsappConversations.id, conversationId),
        ),
      )
      .limit(1);
    if (!conversation) throw new NotFoundException({ code: "WHATSAPP_CONVERSATION_NOT_FOUND" });
    await this.scope.requireUnitAccess(identityId, organizationId, conversation.unitId);
    const cursor = input.beforeAt
      ? or(
          lt(whatsappMessages.occurredAt, input.beforeAt),
          and(
            eq(whatsappMessages.occurredAt, input.beforeAt),
            lt(whatsappMessages.id, input.beforeId ?? ""),
          ),
        )
      : undefined;
    const rows = await this.database.db
      .select()
      .from(whatsappMessages)
      .where(
        and(
          eq(whatsappMessages.organizationId, organizationId),
          eq(whatsappMessages.unitId, conversation.unitId),
          eq(whatsappMessages.conversationId, conversation.id),
          cursor,
        ),
      )
      .orderBy(desc(whatsappMessages.occurredAt), desc(whatsappMessages.id))
      .limit(input.limit + 1);
    const hasMore = rows.length > input.limit;
    const page = rows.slice(0, input.limit);
    const tail = page.at(-1);
    return {
      items: page.reverse(),
      nextCursor: hasMore && tail ? { at: tail.occurredAt.toISOString(), id: tail.id } : null,
    };
  }

  async listWhatsAppAssignees(identityId: string, organizationId: string, unitId: string) {
    await this.scope.requireOrganizationRole(identityId, organizationId, MANAGERS);
    await this.scope.requireUnitAccess(identityId, organizationId, unitId);
    return this.database.db
      .selectDistinct({ id: identities.id, name: identities.displayName })
      .from(identities)
      .innerJoin(memberships, eq(memberships.identityId, identities.id))
      .innerJoin(roleBindings, eq(roleBindings.membershipId, memberships.id))
      .where(
        and(
          eq(memberships.organizationId, organizationId),
          eq(memberships.status, "active"),
          isNull(identities.disabledAt),
          or(isNull(roleBindings.unitId), eq(roleBindings.unitId, unitId)),
          inArray(roleBindings.role, [...MANAGERS]),
        ),
      )
      .orderBy(asc(identities.displayName));
  }

  async updateWhatsAppConversation(
    identityId: string,
    organizationId: string,
    conversationId: string,
    input: WhatsAppConversationUpdateInput,
  ) {
    await this.scope.requireOrganizationRole(identityId, organizationId, MANAGERS);
    const [current] = await this.database.db
      .select()
      .from(whatsappConversations)
      .where(
        and(
          eq(whatsappConversations.organizationId, organizationId),
          eq(whatsappConversations.id, conversationId),
        ),
      )
      .limit(1);
    if (!current) throw new NotFoundException({ code: "WHATSAPP_CONVERSATION_NOT_FOUND" });
    await this.scope.requireUnitAccess(identityId, organizationId, current.unitId);
    if (input.assignedIdentityId) {
      const assignees = await this.listWhatsAppAssignees(
        identityId,
        organizationId,
        current.unitId,
      );
      if (!assignees.some((assignee) => assignee.id === input.assignedIdentityId))
        throw new BadRequestException({ code: "WHATSAPP_ASSIGNEE_INVALID" });
    }
    const now = new Date();
    return this.database.db.transaction(async (tx) => {
      const [updated] = await tx
        .update(whatsappConversations)
        .set({
          status: input.status,
          priority: input.priority,
          assignedIdentityId: input.assignedIdentityId,
          slaDueAt:
            input.slaMinutes === undefined
              ? undefined
              : input.slaMinutes === null
                ? null
                : new Date(now.getTime() + input.slaMinutes * 60_000),
          closedAt:
            input.status === "closed" ? (current.closedAt ?? now) : input.status ? null : undefined,
          updatedAt: now,
        })
        .where(
          and(
            eq(whatsappConversations.id, current.id),
            eq(whatsappConversations.updatedAt, input.expectedUpdatedAt),
          ),
        )
        .returning();
      if (!updated) throw new ConflictException({ code: "WHATSAPP_CONVERSATION_STALE" });
      await this.audit(tx, {
        organizationId,
        unitId: current.unitId,
        identityId,
        action: "growth.whatsapp_conversation.updated",
        entityType: "growth_whatsapp_conversation",
        entityId: current.id,
        metadata: {
          status: updated.status,
          priority: updated.priority,
          assignedIdentityId: updated.assignedIdentityId,
        },
      });
      await this.outbox(
        tx,
        "growth.whatsapp_conversation_updated",
        "growth_whatsapp_conversation",
        current.id,
        { organizationId, unitId: current.unitId, conversationId: current.id },
      );
      return updated;
    });
  }

  async whatsAppMessageMedia(
    identityId: string,
    organizationId: string,
    conversationId: string,
    messageId: string,
  ) {
    await this.scope.requireOrganizationRole(identityId, organizationId, MANAGERS);
    const [message] = await this.database.db
      .select()
      .from(whatsappMessages)
      .where(
        and(
          eq(whatsappMessages.organizationId, organizationId),
          eq(whatsappMessages.conversationId, conversationId),
          eq(whatsappMessages.id, messageId),
        ),
      )
      .limit(1);
    if (!message?.mediaStorageKey || !message.mediaMimeType)
      throw new NotFoundException({ code: "WHATSAPP_MEDIA_NOT_FOUND" });
    await this.scope.requireUnitAccess(identityId, organizationId, message.unitId);
    const content = await readWhatsAppArtifact(
      process.env.MEDIA_ROOT,
      message.mediaStorageKey,
    ).catch(() => null);
    if (!content) throw new NotFoundException({ code: "WHATSAPP_MEDIA_NOT_FOUND" });
    return {
      fileName: message.mediaFileName ?? `midia-${message.id}`,
      mimeType: message.mediaMimeType,
      content: content.toString("base64"),
      contentEncoding: "base64" as const,
      sha256: message.mediaSha256,
    };
  }

  async markWhatsAppConversationRead(
    identityId: string,
    organizationId: string,
    conversationId: string,
  ) {
    await this.scope.requireOrganizationRole(identityId, organizationId, MANAGERS);
    const [conversation] = await this.database.db
      .select()
      .from(whatsappConversations)
      .where(
        and(
          eq(whatsappConversations.organizationId, organizationId),
          eq(whatsappConversations.id, conversationId),
        ),
      )
      .limit(1);
    if (!conversation) throw new NotFoundException({ code: "WHATSAPP_CONVERSATION_NOT_FOUND" });
    await this.scope.requireUnitAccess(identityId, organizationId, conversation.unitId);
    const [updated] = await this.database.db
      .update(whatsappConversations)
      .set({ unreadCount: 0, updatedAt: new Date() })
      .where(eq(whatsappConversations.id, conversation.id))
      .returning();
    return updated;
  }

  async sendWhatsAppMessage(
    identityId: string,
    organizationId: string,
    input: WhatsAppMessageInput,
  ) {
    await this.scope.requireOrganizationRole(identityId, organizationId, MANAGERS);
    await this.scope.requireUnitAccess(identityId, organizationId, input.unitId);
    const integration = await this.evolutionIntegration(organizationId, input.unitId);
    if (integration.status !== "ready")
      throw new ServiceUnavailableException({
        code: "EVOLUTION_NOT_LOGGED_IN",
        message: "Leia o QR Code antes de enviar.",
      });
    const [existing] = await this.database.db
      .select()
      .from(whatsappMessages)
      .where(
        and(
          eq(whatsappMessages.organizationId, organizationId),
          eq(whatsappMessages.unitId, input.unitId),
          eq(whatsappMessages.idempotencyKey, input.idempotencyKey),
        ),
      )
      .limit(1);
    if (existing) return { duplicate: true, message: existing };
    const messageId = randomUUID();
    const mediaContent = input.media ? Buffer.from(input.media.base64, "base64") : null;
    let artifact: { storageKey: string; sha256: string; bytes: number } | undefined;
    try {
      if (input.media)
        artifact = await writeWhatsAppArtifact({
          root: process.env.MEDIA_ROOT,
          organizationId,
          unitId: input.unitId,
          messageId,
          mimeType: input.media.mimeType,
          content: mediaContent ?? Buffer.alloc(0),
        });
    } catch (error) {
      const code = error instanceof Error ? error.message : "WHATSAPP_MEDIA_INVALID";
      throw new BadRequestException({ code });
    }
    try {
      const result = await this.database.db.transaction(async (tx) => {
        let conversation = input.conversationId
          ? (
              await tx
                .select()
                .from(whatsappConversations)
                .where(
                  and(
                    eq(whatsappConversations.organizationId, organizationId),
                    eq(whatsappConversations.unitId, input.unitId),
                    eq(whatsappConversations.id, input.conversationId),
                  ),
                )
                .limit(1)
            )[0]
          : undefined;
        let customer = input.customerId
          ? (
              await tx
                .select()
                .from(growthCustomers)
                .where(
                  and(
                    eq(growthCustomers.organizationId, organizationId),
                    eq(growthCustomers.id, input.customerId),
                    isNull(growthCustomers.archivedAt),
                  ),
                )
                .limit(1)
            )[0]
          : undefined;
        if (conversation?.customerId && !customer)
          customer = (
            await tx
              .select()
              .from(growthCustomers)
              .where(eq(growthCustomers.id, conversation.customerId))
              .limit(1)
          )[0];
        let phone = conversation?.phone;
        if (!phone) {
          try {
            phone = normalizeWhatsAppPhone(input.phone ?? customer?.phone ?? "");
          } catch {
            throw new BadRequestException({
              code: "CUSTOMER_PHONE_INVALID",
              message: "Informe o telefone com DDD.",
            });
          }
        }
        if (!conversation) {
          [conversation] = await tx
            .insert(whatsappConversations)
            .values({ organizationId, unitId: input.unitId, customerId: customer?.id, phone })
            .onConflictDoUpdate({
              target: [
                whatsappConversations.organizationId,
                whatsappConversations.unitId,
                whatsappConversations.phone,
              ],
              set: { customerId: customer?.id, status: "open", updatedAt: new Date() },
            })
            .returning();
        }
        if (!conversation) throw new Error("WHATSAPP_CONVERSATION_UPSERT_FAILED");
        const [message] = await tx
          .insert(whatsappMessages)
          .values({
            id: messageId,
            organizationId,
            unitId: input.unitId,
            conversationId: conversation.id,
            customerId: customer?.id ?? conversation.customerId,
            direction: "outbound",
            contentKind: input.media
              ? input.media.mimeType.startsWith("image/")
                ? "image"
                : input.media.mimeType.startsWith("audio/")
                  ? "audio"
                  : input.media.mimeType.startsWith("video/")
                    ? "video"
                    : "document"
              : "text",
            body: input.body,
            mediaStorageKey: artifact?.storageKey,
            mediaMimeType: input.media?.mimeType,
            mediaFileName: input.media?.fileName,
            mediaSizeBytes: artifact?.bytes,
            mediaSha256: artifact?.sha256,
            status: "queued",
            idempotencyKey: input.idempotencyKey,
          })
          .onConflictDoNothing()
          .returning();
        if (!message) {
          const [duplicate] = await tx
            .select()
            .from(whatsappMessages)
            .where(
              and(
                eq(whatsappMessages.organizationId, organizationId),
                eq(whatsappMessages.unitId, input.unitId),
                eq(whatsappMessages.idempotencyKey, input.idempotencyKey),
              ),
            )
            .limit(1);
          return { duplicate: true, message: duplicate };
        }
        await tx
          .update(whatsappConversations)
          .set({
            assignedIdentityId: conversation.assignedIdentityId ?? identityId,
            firstResponseAt:
              conversation.lastInboundAt && !conversation.firstResponseAt
                ? new Date()
                : conversation.firstResponseAt,
            lastMessageAt: new Date(),
            lastOutboundAt: new Date(),
            updatedAt: new Date(),
          })
          .where(eq(whatsappConversations.id, conversation.id));
        await this.outbox(
          tx,
          "growth.whatsapp_message_requested",
          "growth_whatsapp_message",
          message.id,
          {
            organizationId,
            unitId: input.unitId,
            messageId: message.id,
            integrationId: integration.id,
          },
        );
        await this.audit(tx, {
          organizationId,
          unitId: input.unitId,
          identityId,
          action: "growth.whatsapp_message.queued",
          entityType: "growth_whatsapp_message",
          entityId: message.id,
          metadata: { conversationId: conversation.id, contentKind: message.contentKind },
        });
        return { duplicate: false, message };
      });
      if (result.duplicate && artifact)
        await deleteWhatsAppArtifact(process.env.MEDIA_ROOT, artifact.storageKey);
      return result;
    } catch (error) {
      if (artifact) await deleteWhatsAppArtifact(process.env.MEDIA_ROOT, artifact.storageKey);
      throw error;
    }
  }

  async listCrmAutomations(identityId: string, organizationId: string, unitId: string) {
    await this.scope.requireOrganizationRole(identityId, organizationId, MANAGERS);
    await this.scope.requireUnitAccess(identityId, organizationId, unitId);
    return this.database.db
      .select()
      .from(crmAutomationRules)
      .where(
        and(
          eq(crmAutomationRules.organizationId, organizationId),
          eq(crmAutomationRules.unitId, unitId),
        ),
      )
      .orderBy(asc(crmAutomationRules.trigger));
  }

  async upsertCrmAutomation(
    identityId: string,
    organizationId: string,
    input: CrmAutomationRuleInput,
  ) {
    await this.scope.requireOrganizationRole(identityId, organizationId, MANAGERS);
    await this.scope.requireUnitAccess(identityId, organizationId, input.unitId);
    const [rule] = await this.database.db
      .insert(crmAutomationRules)
      .values({ organizationId, ...input })
      .onConflictDoUpdate({
        target: [
          crmAutomationRules.organizationId,
          crmAutomationRules.unitId,
          crmAutomationRules.trigger,
        ],
        set: {
          enabled: input.enabled,
          delayMinutes: input.delayMinutes,
          inactiveDays: input.inactiveDays ?? null,
          messageTemplate: input.messageTemplate,
          updatedAt: new Date(),
        },
      })
      .returning();
    if (!rule) throw new Error("CRM_AUTOMATION_UPSERT_FAILED");
    await this.database.db.insert(auditEvents).values({
      organizationId,
      unitId: input.unitId,
      actorIdentityId: identityId,
      action: "growth.crm_automation.configured",
      entityType: "growth_crm_automation_rule",
      entityId: rule.id,
      metadata: { trigger: input.trigger, enabled: input.enabled },
    });
    return rule;
  }

  async listCrmAutomationExecutions(
    identityId: string,
    organizationId: string,
    input: CrmAutomationExecutionQueryInput,
  ) {
    await this.scope.requireOrganizationRole(identityId, organizationId, MANAGERS);
    await this.scope.requireUnitAccess(identityId, organizationId, input.unitId);
    const cursor = input.cursorAt
      ? or(
          lt(crmAutomationExecutions.createdAt, input.cursorAt),
          and(
            eq(crmAutomationExecutions.createdAt, input.cursorAt),
            lt(crmAutomationExecutions.id, input.cursorId ?? ""),
          ),
        )
      : undefined;
    const [rows, counts] = await Promise.all([
      this.database.db
        .select({
          id: crmAutomationExecutions.id,
          trigger: crmAutomationRules.trigger,
          customerId: crmAutomationExecutions.customerId,
          customerName: growthCustomers.name,
          messageId: crmAutomationExecutions.messageId,
          status: crmAutomationExecutions.status,
          reason: crmAutomationExecutions.reason,
          scheduledFor: crmAutomationExecutions.scheduledFor,
          executedAt: crmAutomationExecutions.executedAt,
          retryCount: crmAutomationExecutions.retryCount,
          lastRetryAt: crmAutomationExecutions.lastRetryAt,
          createdAt: crmAutomationExecutions.createdAt,
        })
        .from(crmAutomationExecutions)
        .innerJoin(
          crmAutomationRules,
          and(
            eq(crmAutomationRules.organizationId, crmAutomationExecutions.organizationId),
            eq(crmAutomationRules.unitId, crmAutomationExecutions.unitId),
            eq(crmAutomationRules.id, crmAutomationExecutions.ruleId),
          ),
        )
        .innerJoin(
          growthCustomers,
          and(
            eq(growthCustomers.organizationId, crmAutomationExecutions.organizationId),
            eq(growthCustomers.id, crmAutomationExecutions.customerId),
          ),
        )
        .where(
          and(
            eq(crmAutomationExecutions.organizationId, organizationId),
            eq(crmAutomationExecutions.unitId, input.unitId),
            input.status ? eq(crmAutomationExecutions.status, input.status) : undefined,
            cursor,
          ),
        )
        .orderBy(desc(crmAutomationExecutions.createdAt), desc(crmAutomationExecutions.id))
        .limit(input.limit + 1),
      this.database.db
        .select({ status: crmAutomationExecutions.status, total: count() })
        .from(crmAutomationExecutions)
        .where(
          and(
            eq(crmAutomationExecutions.organizationId, organizationId),
            eq(crmAutomationExecutions.unitId, input.unitId),
          ),
        )
        .groupBy(crmAutomationExecutions.status),
    ]);
    const hasMore = rows.length > input.limit;
    const items = rows.slice(0, input.limit);
    const tail = items.at(-1);
    return {
      items,
      summary: Object.fromEntries(counts.map((row) => [row.status, Number(row.total)])),
      nextCursor: hasMore && tail ? { at: tail.createdAt.toISOString(), id: tail.id } : null,
    };
  }

  async retryCrmAutomationExecution(
    identityId: string,
    organizationId: string,
    executionId: string,
  ) {
    await this.scope.requireOrganizationRole(identityId, organizationId, MANAGERS);
    const [execution] = await this.database.db
      .select({
        execution: crmAutomationExecutions,
        rule: crmAutomationRules,
        customer: growthCustomers,
      })
      .from(crmAutomationExecutions)
      .innerJoin(crmAutomationRules, eq(crmAutomationRules.id, crmAutomationExecutions.ruleId))
      .innerJoin(growthCustomers, eq(growthCustomers.id, crmAutomationExecutions.customerId))
      .where(
        and(
          eq(crmAutomationExecutions.organizationId, organizationId),
          eq(crmAutomationExecutions.id, executionId),
        ),
      )
      .limit(1);
    if (!execution) throw new NotFoundException({ code: "CRM_AUTOMATION_EXECUTION_NOT_FOUND" });
    await this.scope.requireUnitAccess(identityId, organizationId, execution.execution.unitId);
    if (execution.execution.status !== "failed")
      throw new ConflictException({ code: "CRM_AUTOMATION_EXECUTION_NOT_RETRYABLE" });
    if (!execution.customer.whatsappMarketingOptIn || !execution.customer.phone)
      throw new ConflictException({ code: "WHATSAPP_OPT_OUT_ACTIVE" });
    const integration = await this.evolutionIntegration(organizationId, execution.execution.unitId);
    if (integration.status !== "ready")
      throw new ServiceUnavailableException({ code: "EVOLUTION_NOT_LOGGED_IN" });
    const phone = normalizeWhatsAppPhone(execution.customer.phone);
    return this.database.db.transaction(async (tx) => {
      const [conversation] = await tx
        .insert(whatsappConversations)
        .values({
          organizationId,
          unitId: execution.execution.unitId,
          customerId: execution.customer.id,
          phone,
        })
        .onConflictDoUpdate({
          target: [
            whatsappConversations.organizationId,
            whatsappConversations.unitId,
            whatsappConversations.phone,
          ],
          set: { customerId: execution.customer.id, status: "open", updatedAt: new Date() },
        })
        .returning();
      if (!conversation) throw new Error("WHATSAPP_CONVERSATION_UPSERT_FAILED");
      const retryCount = execution.execution.retryCount + 1;
      const [message] = await tx
        .insert(whatsappMessages)
        .values({
          organizationId,
          unitId: execution.execution.unitId,
          conversationId: conversation.id,
          customerId: execution.customer.id,
          direction: "outbound",
          body: execution.rule.messageTemplate.replaceAll("{nome}", execution.customer.name),
          status: "queued",
          idempotencyKey: `automation-retry:${execution.execution.id}:${retryCount}`,
        })
        .returning();
      if (!message) throw new Error("WHATSAPP_AUTOMATION_RETRY_INSERT_FAILED");
      const now = new Date();
      await tx
        .update(crmAutomationExecutions)
        .set({
          messageId: message.id,
          status: "queued",
          reason: null,
          executedAt: null,
          retryCount,
          lastRetryAt: now,
          updatedAt: now,
        })
        .where(eq(crmAutomationExecutions.id, execution.execution.id));
      await this.outbox(
        tx,
        "growth.whatsapp_message_requested",
        "growth_whatsapp_message",
        message.id,
        {
          organizationId,
          unitId: execution.execution.unitId,
          messageId: message.id,
          integrationId: integration.id,
        },
      );
      await this.audit(tx, {
        organizationId,
        unitId: execution.execution.unitId,
        identityId,
        action: "growth.crm_automation.retried",
        entityType: "growth_crm_automation_execution",
        entityId: execution.execution.id,
        metadata: { retryCount, messageId: message.id },
      });
      return { executionId: execution.execution.id, messageId: message.id, retryCount };
    });
  }

  async testCrmAutomation(
    identityId: string,
    organizationId: string,
    ruleId: string,
    input: CrmAutomationTestInput,
  ) {
    const [rule] = await this.database.db
      .select()
      .from(crmAutomationRules)
      .where(
        and(
          eq(crmAutomationRules.organizationId, organizationId),
          eq(crmAutomationRules.unitId, input.unitId),
          eq(crmAutomationRules.id, ruleId),
        ),
      )
      .limit(1);
    if (!rule) throw new NotFoundException({ code: "CRM_AUTOMATION_RULE_NOT_FOUND" });
    return this.sendWhatsAppMessage(identityId, organizationId, {
      unitId: input.unitId,
      phone: input.phone,
      body: `[TESTE] ${rule.messageTemplate.replaceAll("{nome}", "Cliente")}`,
      idempotencyKey: `automation-test:${rule.id}:${randomUUID()}`,
    });
  }

  async listCrmQuickReplies(identityId: string, organizationId: string, unitId: string) {
    await this.scope.requireOrganizationRole(identityId, organizationId, MANAGERS);
    await this.scope.requireUnitAccess(identityId, organizationId, unitId);
    return this.database.db
      .select()
      .from(crmQuickReplies)
      .where(
        and(eq(crmQuickReplies.organizationId, organizationId), eq(crmQuickReplies.unitId, unitId)),
      )
      .orderBy(desc(crmQuickReplies.active), asc(crmQuickReplies.title));
  }

  async upsertCrmQuickReply(identityId: string, organizationId: string, input: CrmQuickReplyInput) {
    await this.scope.requireOrganizationRole(identityId, organizationId, MANAGERS);
    await this.scope.requireUnitAccess(identityId, organizationId, input.unitId);
    const [reply] = input.id
      ? await this.database.db
          .update(crmQuickReplies)
          .set({
            title: input.title,
            body: input.body,
            active: input.active,
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(crmQuickReplies.organizationId, organizationId),
              eq(crmQuickReplies.unitId, input.unitId),
              eq(crmQuickReplies.id, input.id),
            ),
          )
          .returning()
      : await this.database.db
          .insert(crmQuickReplies)
          .values({ organizationId, createdByIdentityId: identityId, ...input })
          .returning();
    if (!reply) throw new NotFoundException({ code: "CRM_QUICK_REPLY_NOT_FOUND" });
    await this.database.db.insert(auditEvents).values({
      organizationId,
      unitId: input.unitId,
      actorIdentityId: identityId,
      action: "growth.crm_quick_reply.saved",
      entityType: "growth_crm_quick_reply",
      entityId: reply.id,
      metadata: { active: reply.active },
    });
    return reply;
  }

  async deleteCrmQuickReply(identityId: string, organizationId: string, replyId: string) {
    await this.scope.requireOrganizationRole(identityId, organizationId, MANAGERS);
    const [reply] = await this.database.db
      .select()
      .from(crmQuickReplies)
      .where(
        and(eq(crmQuickReplies.organizationId, organizationId), eq(crmQuickReplies.id, replyId)),
      )
      .limit(1);
    if (!reply) return { deleted: true, duplicate: true };
    await this.scope.requireUnitAccess(identityId, organizationId, reply.unitId);
    await this.database.db.delete(crmQuickReplies).where(eq(crmQuickReplies.id, reply.id));
    await this.database.db.insert(auditEvents).values({
      organizationId,
      unitId: reply.unitId,
      actorIdentityId: identityId,
      action: "growth.crm_quick_reply.deleted",
      entityType: "growth_crm_quick_reply",
      entityId: reply.id,
    });
    return { deleted: true, duplicate: false };
  }

  async handleEvolutionWebhook(input: EvolutionWebhookInput) {
    if (process.env.WHATSAPP_PROVIDER_ENABLED !== "true")
      throw new ServiceUnavailableException({ code: "EVOLUTION_PROVIDER_DISABLED" });
    const credentialReference = evolutionCredentialReference(input.instanceToken);
    const [integration] = await this.database.db
      .select()
      .from(growthIntegrations)
      .where(
        and(
          eq(growthIntegrations.provider, "evolution_go"),
          eq(growthIntegrations.credentialReference, credentialReference),
        ),
      )
      .limit(1);
    if (!integration?.unitId)
      throw new UnauthorizedException({ code: "EVOLUTION_WEBHOOK_TOKEN_INVALID" });
    const unitId = integration.unitId;
    const data = input.data;
    const event = input.event.toLowerCase();
    if (event === "receipt") {
      const ids = data.MessageIDs ?? data.messageIds;
      const status = input.state?.toLowerCase();
      if (!Array.isArray(ids) || !["delivered", "read"].includes(status ?? ""))
        throw new BadRequestException({ code: "EVOLUTION_WEBHOOK_INVALID" });
      let updated = 0;
      for (const value of ids) {
        if (typeof value !== "string" || !value) continue;
        const [message] = await this.database.db
          .select()
          .from(whatsappMessages)
          .where(
            and(
              eq(whatsappMessages.organizationId, integration.organizationId),
              eq(whatsappMessages.unitId, integration.unitId),
              eq(whatsappMessages.providerReference, value),
            ),
          )
          .limit(1);
        if (!message) continue;
        const isRead = status === "read";
        const now = new Date();
        await this.database.db.transaction(async (tx) => {
          await tx
            .update(whatsappMessages)
            .set({
              status: isRead ? "read" : message.status === "read" ? "read" : "delivered",
              deliveredAt: message.deliveredAt ?? now,
              readAt: isRead ? (message.readAt ?? now) : message.readAt,
              updatedAt: now,
            })
            .where(eq(whatsappMessages.id, message.id));
          if (message.campaignDeliveryId)
            await tx
              .update(campaignDeliveries)
              .set({
                deliveredAt: message.deliveredAt ?? now,
                readAt: isRead ? now : undefined,
                updatedAt: now,
              })
              .where(eq(campaignDeliveries.id, message.campaignDeliveryId));
          await this.outbox(
            tx,
            "growth.whatsapp_message_status_updated",
            "growth_whatsapp_message",
            message.id,
            {
              organizationId: integration.organizationId,
              unitId,
              conversationId: message.conversationId,
              status: isRead ? "read" : "delivered",
            },
          );
        });
        updated += 1;
      }
      return { ok: true, updated };
    }
    if (event !== "message")
      throw new BadRequestException({ code: "EVOLUTION_WEBHOOK_EVENT_UNSUPPORTED" });
    const info =
      data.Info && typeof data.Info === "object"
        ? (data.Info as Record<string, unknown>)
        : data.info && typeof data.info === "object"
          ? (data.info as Record<string, unknown>)
          : {};
    const rawMessage =
      data.Message && typeof data.Message === "object"
        ? (data.Message as Record<string, unknown>)
        : data.message && typeof data.message === "object"
          ? (data.message as Record<string, unknown>)
          : {};
    const fromMe = Boolean(info.IsFromMe ?? info.isFromMe);
    const jid = String(info[fromMe ? "Chat" : "Sender"] ?? info.sender ?? info.chat ?? "");
    const providerReference = String(info.ID ?? info.id ?? "").trim();
    if (!providerReference)
      throw new BadRequestException({ code: "EVOLUTION_MESSAGE_ID_REQUIRED" });
    let phone: string;
    try {
      phone = normalizeWhatsAppPhone(jid.split("@", 1)[0] ?? "");
    } catch {
      throw new BadRequestException({ code: "EVOLUTION_MESSAGE_PHONE_INVALID" });
    }
    const extended =
      (rawMessage.extendedTextMessage ?? rawMessage.ExtendedTextMessage) &&
      typeof (rawMessage.extendedTextMessage ?? rawMessage.ExtendedTextMessage) === "object"
        ? ((rawMessage.extendedTextMessage ?? rawMessage.ExtendedTextMessage) as Record<
            string,
            unknown
          >)
        : {};
    const rawImage = rawMessage.imageMessage ?? rawMessage.ImageMessage;
    const image =
      rawImage && typeof rawImage === "object" ? (rawImage as Record<string, unknown>) : null;
    const rawAudio = rawMessage.audioMessage ?? rawMessage.AudioMessage;
    const audio =
      rawAudio && typeof rawAudio === "object" ? (rawAudio as Record<string, unknown>) : null;
    const rawVideo = rawMessage.videoMessage ?? rawMessage.VideoMessage;
    const video =
      rawVideo && typeof rawVideo === "object" ? (rawVideo as Record<string, unknown>) : null;
    const rawDocument = rawMessage.documentMessage ?? rawMessage.DocumentMessage;
    const document =
      rawDocument && typeof rawDocument === "object"
        ? (rawDocument as Record<string, unknown>)
        : null;
    const body = String(
      rawMessage.conversation ??
        rawMessage.Conversation ??
        extended.text ??
        image?.caption ??
        video?.caption ??
        document?.caption ??
        "",
    ).slice(0, 4096);
    const contentKind = audio
      ? "audio"
      : image
        ? "image"
        : video
          ? "video"
          : document
            ? "document"
            : "text";
    if (contentKind === "text" && !body)
      throw new BadRequestException({ code: "EVOLUTION_MESSAGE_BODY_REQUIRED" });
    const rawMedia = audio ?? image ?? video ?? document;
    const messageId = randomUUID();
    let mediaArtifact: { storageKey: string; sha256: string; bytes: number } | undefined;
    let mediaMimeType: string | undefined;
    let mediaFileName: string | undefined;
    let mediaErrorCode: string | undefined;
    if (rawMedia) {
      try {
        const encoded = await new EvolutionGoClient(integration.id, unitId).downloadMedia(
          rawMessage,
        );
        const match = encoded.match(/^data:([^;,]+);base64,(.+)$/s);
        mediaMimeType = String(rawMedia.mimetype ?? rawMedia.mimeType ?? match?.[1] ?? "");
        mediaFileName = String(
          rawMedia.fileName ?? rawMedia.filename ?? `midia-${providerReference}`,
        ).slice(0, 180);
        mediaArtifact = await writeWhatsAppArtifact({
          root: process.env.MEDIA_ROOT,
          organizationId: integration.organizationId,
          unitId,
          messageId,
          mimeType: mediaMimeType,
          content: Buffer.from(match?.[2] ?? encoded, "base64"),
        });
      } catch (error) {
        mediaErrorCode =
          error instanceof EvolutionGoError
            ? error.code
            : error instanceof Error
              ? error.message.slice(0, 80)
              : "WHATSAPP_MEDIA_DOWNLOAD_FAILED";
      }
    }
    const rawTimestamp = info.Timestamp ?? info.timestamp;
    const occurredAt =
      typeof rawTimestamp === "number"
        ? new Date(rawTimestamp * 1000)
        : new Date(typeof rawTimestamp === "string" ? rawTimestamp : Date.now());
    try {
      return await this.database.db.transaction(async (tx) => {
        await tx.execute(
          sql`select pg_advisory_xact_lock(hashtext(${`evolution:${integration.id}:${providerReference}`}))`,
        );
        const [existing] = await tx
          .select({ id: whatsappMessages.id })
          .from(whatsappMessages)
          .where(
            and(
              eq(whatsappMessages.organizationId, integration.organizationId),
              eq(whatsappMessages.unitId, unitId),
              eq(whatsappMessages.providerReference, providerReference),
            ),
          )
          .limit(1);
        if (existing) {
          if (mediaArtifact)
            await deleteWhatsAppArtifact(process.env.MEDIA_ROOT, mediaArtifact.storageKey);
          return { ok: true, duplicate: true, messageId: existing.id };
        }
        const localPhone = phone.startsWith("55") ? phone.slice(2) : phone;
        const [customer] = await tx
          .select()
          .from(growthCustomers)
          .where(
            and(
              eq(growthCustomers.organizationId, integration.organizationId),
              isNull(growthCustomers.archivedAt),
              sql`regexp_replace(coalesce(${growthCustomers.phone}, ''), '[^0-9]', '', 'g') in (${phone}, ${localPhone})`,
            ),
          )
          .limit(1);
        const [conversation] = await tx
          .insert(whatsappConversations)
          .values({
            organizationId: integration.organizationId,
            unitId,
            customerId: customer?.id,
            phone,
          })
          .onConflictDoUpdate({
            target: [
              whatsappConversations.organizationId,
              whatsappConversations.unitId,
              whatsappConversations.phone,
            ],
            set: {
              customerId: customer?.id,
              status: fromMe ? undefined : "open",
              slaDueAt: fromMe ? undefined : new Date(Date.now() + 15 * 60_000),
              firstResponseAt: fromMe ? new Date() : null,
              closedAt: fromMe ? undefined : null,
              updatedAt: new Date(),
            },
          })
          .returning();
        if (!conversation) throw new Error("WHATSAPP_CONVERSATION_UPSERT_FAILED");
        const [message] = await tx
          .insert(whatsappMessages)
          .values({
            id: messageId,
            organizationId: integration.organizationId,
            unitId,
            conversationId: conversation.id,
            customerId: customer?.id,
            direction: fromMe ? "outbound" : "inbound",
            contentKind,
            body,
            mediaStorageKey: mediaArtifact?.storageKey,
            mediaMimeType,
            mediaFileName,
            mediaSizeBytes: mediaArtifact?.bytes,
            mediaSha256: mediaArtifact?.sha256,
            mediaErrorCode,
            status: fromMe ? "sent" : "received",
            providerReference,
            idempotencyKey: `provider:${providerReference}`,
            occurredAt: Number.isNaN(occurredAt.valueOf()) ? new Date() : occurredAt,
            sentAt: fromMe ? new Date() : null,
          })
          .returning();
        if (!message) throw new Error("WHATSAPP_MESSAGE_INSERT_FAILED");
        const now = new Date();
        await tx
          .update(whatsappConversations)
          .set({
            unreadCount: fromMe
              ? conversation.unreadCount
              : sql`${whatsappConversations.unreadCount} + 1`,
            lastMessageAt: message.occurredAt,
            lastInboundAt: fromMe ? conversation.lastInboundAt : message.occurredAt,
            lastOutboundAt: fromMe ? message.occurredAt : conversation.lastOutboundAt,
            slaDueAt: fromMe ? conversation.slaDueAt : new Date(Date.now() + 15 * 60_000),
            firstResponseAt: fromMe ? (conversation.firstResponseAt ?? now) : null,
            updatedAt: now,
          })
          .where(eq(whatsappConversations.id, conversation.id));
        if (!fromMe && customer) {
          if (isWhatsAppOptOut(body)) {
            await tx
              .update(growthCustomers)
              .set({
                whatsappMarketingOptIn: false,
                marketingOptIn: customer.emailMarketingOptIn,
                updatedAt: now,
              })
              .where(eq(growthCustomers.id, customer.id));
            await tx.insert(customerConsents).values({
              organizationId: integration.organizationId,
              customerId: customer.id,
              purpose: "marketing",
              decision: "withdrawn",
              channel: "whatsapp",
              source: "whatsapp_keyword",
              legalBasis: "consent",
              policyVersion: "whatsapp-opt-out-v1",
            });
          }
          const [delivery] = await tx.execute<{ id: string }>(sql`
          select deliveries.id
          from growth_campaign_deliveries deliveries
          inner join growth_marketing_campaigns campaigns
            on campaigns.organization_id = deliveries.organization_id
           and campaigns.id = deliveries.campaign_id
          where deliveries.organization_id = ${integration.organizationId}
            and deliveries.customer_id = ${customer.id}
            and deliveries.sent_at is not null
            and deliveries.sent_at + (campaigns.attribution_window_days * interval '1 day') >= now()
          order by deliveries.sent_at desc
          limit 1
        `);
          if (delivery)
            await tx
              .update(campaignDeliveries)
              .set({ repliedAt: now, updatedAt: now })
              .where(eq(campaignDeliveries.id, delivery.id));
        }
        await this.outbox(
          tx,
          fromMe ? "growth.whatsapp_message_sent" : "growth.whatsapp_message_received",
          "growth_whatsapp_message",
          message.id,
          {
            organizationId: integration.organizationId,
            unitId,
            conversationId: conversation.id,
            messageId: message.id,
            contentKind,
          },
        );
        return { ok: true, duplicate: false, messageId: message.id };
      });
    } catch (error) {
      if (mediaArtifact)
        await deleteWhatsAppArtifact(process.env.MEDIA_ROOT, mediaArtifact.storageKey).catch(
          () => undefined,
        );
      throw error;
    }
  }
}
