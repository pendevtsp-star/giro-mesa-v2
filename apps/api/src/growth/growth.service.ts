import { createHmac, randomBytes, randomUUID } from "node:crypto";
import {
  auditEvents,
  campaignDeliveries,
  couponRedemptions,
  coupons,
  customerConsents,
  customerSegments,
  deliveryDispatches,
  deliveryOrders,
  deliveryZones,
  growthCustomers,
  growthIntegrations,
  inventoryTransferLines,
  inventoryTransfers,
  loyaltyLedger,
  loyaltyPrograms,
  marketingCampaigns,
  marketingOptOutTokens,
  operationalCommands,
  outboxEvents,
  posTabs,
  publicApiKeys,
  publicMenus,
  reservations,
  unitPriceOverrides,
  units,
  waitlistEntries,
  webhookEndpoints,
  webhookPublications,
} from "@giromesa/db";
import { encryptionKey, encryptSecret } from "@giromesa/domain";
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
  inArray,
  isNotNull,
  isNull,
  ne,
  or,
  sql,
  sum,
} from "drizzle-orm";
import { DatabaseService } from "../database/database.module.js";
import { ScopeService } from "../organizations/scope.service.js";
import {
  canTransition,
  couponDiscount,
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
  CampaignInput,
  ConsentInput,
  CouponInput,
  CouponRedemptionInput,
  CustomerInput,
  DeliveryOrderInput,
  DeliveryTransitionInput,
  DeliveryZoneInput,
  DispatchInput,
  DoseClubInput,
  LoyaltyEarnInput,
  LoyaltyProgramInput,
  LoyaltyRedeemInput,
  LoyaltyReverseInput,
  PriceOverrideInput,
  PublicCouponValidationInput,
  PublicReservationInput,
  PublicWaitlistInput,
  ReservationInput,
  ReservationTransitionInput,
  SegmentInput,
  TransferInput,
  TransferTransitionInput,
  WaitlistInput,
  WaitlistTransitionInput,
  WebhookEndpointInput,
  WebhookEventInput,
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

@Injectable()
export class GrowthService {
  constructor(
    private readonly database: DatabaseService,
    private readonly scope: ScopeService,
  ) {}

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
    return this.database.db
      .select()
      .from(growthCustomers)
      .where(
        and(eq(growthCustomers.organizationId, organizationId), isNull(growthCustomers.archivedAt)),
      )
      .orderBy(asc(growthCustomers.name));
  }

  async createCustomer(identityId: string, organizationId: string, input: CustomerInput) {
    await this.scope.requireOrganizationRole(identityId, organizationId, MANAGERS);
    if (input.defaultUnitId)
      await this.scope.requireUnitAccess(identityId, organizationId, input.defaultUnitId);
    return this.database.db.transaction(async (tx) => {
      const [created] = await tx
        .insert(growthCustomers)
        .values({
          organizationId,
          defaultUnitId: input.defaultUnitId ?? null,
          name: input.name,
          email: input.email?.toLowerCase() ?? null,
          phone: input.phone ?? null,
          birthDate: input.birthDate ?? null,
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

  async recordConsent(
    identityId: string,
    organizationId: string,
    customerId: string,
    input: ConsentInput,
  ) {
    await this.scope.requireOrganizationRole(identityId, organizationId, MANAGERS);
    const customer = await this.customer(organizationId, customerId);
    return this.database.db.transaction(async (tx) => {
      const [consent] = await tx
        .insert(customerConsents)
        .values({ organizationId, customerId, actorIdentityId: identityId, ...input })
        .returning();
      if (!consent) throw new Error("CONSENT_INSERT_FAILED");
      await tx
        .update(growthCustomers)
        .set({ marketingOptIn: marketingOptInAfter(input.decision), updatedAt: new Date() })
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
        .set({ marketingOptIn: false, updatedAt: new Date() })
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

  async loyaltyBalance(identityId: string, organizationId: string, customerId: string) {
    await this.scope.requireOrganizationRole(identityId, organizationId, MANAGERS);
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
    return this.database.db
      .select()
      .from(coupons)
      .where(eq(coupons.organizationId, organizationId));
  }

  async createCoupon(identityId: string, organizationId: string, input: CouponInput) {
    await this.scope.requireOrganizationRole(identityId, organizationId, MANAGERS);
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
    if (input.customerId) await this.customer(organizationId, input.customerId);
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
      input,
      couponId: coupon.id,
      operationalTotalCents: tab.totalCents,
      discountCents,
    });
    const [inserted] = await this.database.db.transaction(async (tx) => {
      if (input.customerId) {
        await tx.execute(
          sql`select pg_advisory_xact_lock(hashtext(${`growth-coupon:${organizationId}:${coupon.id}:${input.customerId}`}))`,
        );
        const [usage] = await tx
          .select({ total: count() })
          .from(couponRedemptions)
          .where(
            and(
              eq(couponRedemptions.organizationId, organizationId),
              eq(couponRedemptions.couponId, coupon.id),
              eq(couponRedemptions.customerId, input.customerId),
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
          customerId: input.customerId ?? null,
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
    return this.database.db
      .select()
      .from(customerSegments)
      .where(eq(customerSegments.organizationId, organizationId));
  }

  async createCampaign(identityId: string, organizationId: string, input: CampaignInput) {
    await this.scope.requireOrganizationRole(identityId, organizationId, MANAGERS);
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
    return this.database.db
      .select()
      .from(marketingCampaigns)
      .where(eq(marketingCampaigns.organizationId, organizationId))
      .orderBy(desc(marketingCampaigns.createdAt));
  }

  private providerReady(channel: "email" | "whatsapp") {
    const prefix = channel === "email" ? "EMAIL" : "WHATSAPP";
    return (
      process.env[`${prefix}_PROVIDER_ENABLED`] === "true" &&
      Boolean(process.env[`${prefix}_PROVIDER_CREDENTIAL_REFERENCE`])
    );
  }

  async queueCampaign(identityId: string, organizationId: string, campaignId: string) {
    await this.scope.requireOrganizationRole(identityId, organizationId, MANAGERS);
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
    if (!this.providerReady(campaign.channel)) {
      await this.database.db.transaction(async (tx) => {
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
          metadata: { code: "PROVIDER_NOT_CONFIGURED", channel: campaign.channel },
        });
        if (campaign.unitId)
          await this.outbox(tx, "growth.campaign_blocked", "growth_campaign", campaign.id, {
            organizationId,
            unitId: campaign.unitId,
            campaignId: campaign.id,
            status: "blocked",
            code: "PROVIDER_NOT_CONFIGURED",
          });
      });
      return { status: "blocked", code: "PROVIDER_NOT_CONFIGURED", queuedRecipients: 0 };
    }
    let filter: Record<string, unknown> = { kind: "marketing_opt_in" };
    if (campaign.segmentId) {
      const [segment] = await this.database.db
        .select()
        .from(customerSegments)
        .where(
          and(
            eq(customerSegments.organizationId, organizationId),
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
    const candidates = await this.database.db
      .select()
      .from(growthCustomers)
      .where(
        and(
          eq(growthCustomers.organizationId, organizationId),
          eq(growthCustomers.marketingOptIn, true),
          isNull(growthCustomers.archivedAt),
        ),
      )
      .orderBy(asc(growthCustomers.id))
      .limit(501);
    if (candidates.length > 500)
      throw new BadRequestException({
        code: "CAMPAIGN_RECIPIENT_LIMIT",
        message: "A campanha excede o limite operacional de 500 destinatários por lote.",
      });
    const month = filter.kind === "birthday_month" ? Number(filter.month) : null;
    const recipients = candidates.filter((customer) => {
      if (campaign.channel === "email" && !customer.email) return false;
      if (campaign.channel === "whatsapp" && !customer.phone) return false;
      if (month && Number(customer.birthDate?.slice(5, 7)) !== month) return false;
      return true;
    });
    const outboxEncryption = encryptionKey(
      process.env.OUTBOX_ENCRYPTION_KEY,
      "OUTBOX_ENCRYPTION_KEY",
    );
    const queuedRecipients = await this.database.db.transaction(async (tx) => {
      let queued = 0;
      for (const customer of recipients) {
        const deliveryIdempotency = `${campaign.id}:${customer.id}`;
        const [delivery] = await tx
          .insert(campaignDeliveries)
          .values({
            organizationId,
            campaignId: campaign.id,
            customerId: customer.id,
            idempotencyKey: deliveryIdempotency,
          })
          .onConflictDoNothing()
          .returning();
        if (!delivery) continue;
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
        metadata: { queuedRecipients: queued, channel: campaign.channel },
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
          },
        );
      return queued;
    });
    return {
      status: queuedRecipients === 0 ? "sent" : "queued",
      duplicate: false,
      queuedRecipients,
    };
  }

  async listReservations(identityId: string, organizationId: string, unitId: string) {
    await this.scope.requireUnitAccess(identityId, organizationId, unitId);
    return this.database.db
      .select()
      .from(reservations)
      .where(and(eq(reservations.organizationId, organizationId), eq(reservations.unitId, unitId)))
      .orderBy(asc(reservations.scheduledAt));
  }

  async createReservation(identityId: string, organizationId: string, input: ReservationInput) {
    await this.scope.requireUnitAccess(identityId, organizationId, input.unitId);
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
    await this.scope.requireUnitAccess(identityId, organizationId, current.unitId);
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

  async listWaitlist(identityId: string, organizationId: string, unitId: string) {
    await this.scope.requireUnitAccess(identityId, organizationId, unitId);
    return this.database.db
      .select()
      .from(waitlistEntries)
      .where(
        and(eq(waitlistEntries.organizationId, organizationId), eq(waitlistEntries.unitId, unitId)),
      )
      .orderBy(asc(waitlistEntries.joinedAt));
  }

  async createWaitlistEntry(identityId: string, organizationId: string, input: WaitlistInput) {
    await this.scope.requireUnitAccess(identityId, organizationId, input.unitId);
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
    await this.scope.requireUnitAccess(identityId, organizationId, current.unitId);
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

  async listDeliveryZones(identityId: string, organizationId: string, unitId: string) {
    await this.scope.requireUnitAccess(identityId, organizationId, unitId);
    return this.database.db
      .select()
      .from(deliveryZones)
      .where(
        and(eq(deliveryZones.organizationId, organizationId), eq(deliveryZones.unitId, unitId)),
      );
  }

  async createDeliveryOrder(identityId: string, organizationId: string, input: DeliveryOrderInput) {
    await this.scope.requireUnitAccess(identityId, organizationId, input.unitId);
    if (input.customerId) await this.customer(organizationId, input.customerId);
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
    let deliveryFeeCents = 0;
    let zoneId: string | null = null;
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
    } else if (input.zoneId || input.address) {
      throw new BadRequestException({
        code: "PICKUP_DELIVERY_FIELDS_FORBIDDEN",
        message: "Retirada não aceita zona ou endereço de entrega.",
      });
    }
    const totalCents = tab.totalCents + deliveryFeeCents;
    const requestFingerprint = payloadFingerprint({
      input,
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
          customerId: input.customerId ?? null,
          zoneId,
          orderRef: input.orderRef,
          fulfillment: input.fulfillment,
          subtotalCents: tab.totalCents,
          deliveryFeeCents,
          totalCents,
          address: input.address ?? null,
          scheduledFor: input.scheduledFor ?? null,
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
    return this.database.db.transaction(async (tx) => {
      const [dispatch] = await tx
        .insert(deliveryDispatches)
        .values({
          organizationId,
          unitId: order.unitId,
          deliveryOrderId: order.id,
          courierReference: input.courierReference,
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
      await this.audit(tx, {
        organizationId,
        unitId: order.unitId,
        identityId,
        action: "growth.delivery.dispatched",
        entityType: "growth_delivery_dispatch",
        entityId: dispatch.id,
        metadata: { orderId: order.id, courierReference: input.courierReference },
      });
      await this.outbox(tx, "growth.delivery_dispatched", "growth_delivery_order", order.id, {
        organizationId,
        unitId: order.unitId,
        orderId: order.id,
        dispatchId: dispatch.id,
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
}
