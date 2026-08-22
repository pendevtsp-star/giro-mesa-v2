import { createHash, randomUUID } from "node:crypto";
import {
  auditEvents,
  type Database,
  identities,
  managementIdempotency,
  managementOperationalLosses,
  managementPartnershipPlans,
  managementPartnershipTiers,
  managementPeople,
  managementSettlementSettings,
  managementWaiterSettlementLines,
  managementWaiterSettlementSources,
  managementWaiterSettlements,
  outboxEvents,
  posOperationalShifts,
  posPaymentAttempts,
  posPaymentReversals,
  posTabPayments,
  posTabs,
} from "@giromesa/db";
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { and, desc, eq, inArray, lte, sql } from "drizzle-orm";
import { DatabaseService } from "../database/database.module.js";
import { ScopeService } from "../organizations/scope.service.js";
import {
  allocateCents,
  defaultSettlementConfig,
  partnershipRewardCents,
  settlementPayableCents,
  teamServiceShareCents,
  validatePartnershipTiers,
} from "./management-settlements.rules.js";
import {
  type OperationalLossDecisionInput,
  type OperationalLossInput,
  type PartnershipPlanInput,
  type SettlementConfigInput,
  type SettlementPeriodInput,
  type SettlementTransitionInput,
} from "./management-settlements.schemas.js";

type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];
type JsonObject = Record<string, unknown>;
type SettlementRole = "owner" | "manager" | "finance" | "cashier";

type AggregationOrderRow = {
  tabId: string;
  sourceUnitId: string;
  responsibleIdentityId: string | null;
  orderId: string | null;
  orderIdentityId: string | null;
  grossCents: number | string;
  discountCents: number | string;
  canceledCents: number | string;
  tabServiceChargeCents: number | string;
  tabTipCents: number | string;
  tabTotalCents: number | string;
  paidCents: number | string;
  operationalLossCents: number | string;
  refundCents: number | string;
};

type PreviewSource = {
  key: string;
  sourceUnitId: string;
  tabId: string;
  orderId: string | null;
  identityId: string | null;
  grossSalesCents: number;
  discountCents: number;
  canceledCents: number;
  receivedCents: number;
  serviceChargeCents: number;
  tipCents: number;
  operationalLossCents: number;
  refundCents: number;
  orderCount: number;
};

type PreviewLine = {
  personId: string | null;
  personIdentityId: string;
  personName: string;
  roleLabel: string;
  eligibleForPayment: boolean;
  tabCount: number;
  orderCount: number;
  grossSalesCents: number;
  discountCents: number;
  canceledCents: number;
  receivedCents: number;
  serviceChargeCents: number;
  tipCents: number;
  serviceShareCents: number;
  partnershipBaseCents: number;
  partnershipCents: number;
  operationalLossCents: number;
  payableCents: number;
};

type Preview = {
  id: null;
  periodFrom: string;
  periodTo: string;
  operationalShiftId: string | null;
  status: "preview";
  configuration: SettlementConfigInput;
  partnershipPlanId: string | null;
  unassignedGrossCents: number;
  operationalLossCents: number;
  createdAt: null;
  lines: PreviewLine[];
  sources: PreviewSource[];
};

function cents(value: number | string | null | undefined) {
  return Number(value ?? 0);
}

function csvCell(value: unknown) {
  const text = String(value ?? "");
  return /[",\n\r]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

@Injectable()
export class ManagementSettlementsService {
  constructor(
    private readonly database: DatabaseService,
    private readonly scope: ScopeService,
  ) {}

  private async requireRole(
    identityId: string,
    organizationId: string,
    unitId: string,
    allowed: readonly SettlementRole[],
  ) {
    const access = await this.scope.requireUnitAccess(identityId, organizationId, unitId);
    if (!allowed.includes(access.role as SettlementRole)) {
      throw new ForbiddenException({ code: "WAITER_SETTLEMENT_ACCESS_DENIED" });
    }
    return access.role as SettlementRole;
  }

  private async record(
    tx: Transaction,
    actorIdentityId: string,
    organizationId: string,
    unitId: string,
    action: string,
    entityType: string,
    entityId: string,
    metadata: JsonObject,
  ) {
    await tx.insert(auditEvents).values({
      organizationId,
      unitId,
      actorIdentityId,
      action,
      entityType,
      entityId,
      metadata,
    });
    await tx.insert(outboxEvents).values({
      topic: action,
      aggregateType: entityType,
      aggregateId: entityId,
      payload: { organizationId, unitId, actorIdentityId, ...metadata },
    });
  }

  private async idempotent<T extends JsonObject>(
    actorIdentityId: string,
    organizationId: string,
    unitId: string,
    key: string | undefined,
    operation: string,
    payload: unknown,
    work: (tx: Transaction) => Promise<T>,
  ) {
    const normalizedKey = key?.trim();
    if (!normalizedKey || normalizedKey.length < 8 || normalizedKey.length > 160) {
      throw new BadRequestException({ code: "IDEMPOTENCY_KEY_REQUIRED" });
    }
    const payloadHash = createHash("sha256")
      .update(`${operation}:${JSON.stringify(payload)}`)
      .digest("hex");
    return this.database.db.transaction(async (tx) => {
      await tx.execute(
        sql`select pg_advisory_xact_lock(hashtext(${`waiter-settlement:${organizationId}:${unitId}:${operation}:${normalizedKey}`}))`,
      );
      const [existing] = await tx
        .select({
          payloadHash: managementIdempotency.payloadHash,
          response: managementIdempotency.response,
        })
        .from(managementIdempotency)
        .where(
          and(
            eq(managementIdempotency.organizationId, organizationId),
            eq(managementIdempotency.unitId, unitId),
            eq(managementIdempotency.operation, operation),
            eq(managementIdempotency.idempotencyKey, normalizedKey),
          ),
        )
        .limit(1);
      if (existing) {
        if (existing.payloadHash !== payloadHash) {
          throw new ConflictException({ code: "IDEMPOTENCY_PAYLOAD_MISMATCH" });
        }
        return { ...(existing.response as T), idempotentReplay: true };
      }
      const response = await work(tx);
      await tx.insert(managementIdempotency).values({
        organizationId,
        unitId,
        actorIdentityId,
        operation,
        idempotencyKey: normalizedKey,
        payloadHash,
        response: JSON.parse(JSON.stringify(response)) as T,
      });
      return { ...response, idempotentReplay: false };
    });
  }

  private async configuration(tx: Transaction, organizationId: string, unitId: string) {
    const [settings] = await tx
      .select({ configuration: managementSettlementSettings.configuration })
      .from(managementSettlementSettings)
      .where(
        and(
          eq(managementSettlementSettings.organizationId, organizationId),
          eq(managementSettlementSettings.unitId, unitId),
        ),
      )
      .limit(1);
    return (settings?.configuration ?? defaultSettlementConfig) as SettlementConfigInput;
  }

  private async activePlan(
    tx: Transaction,
    organizationId: string,
    unitId: string,
    onDate?: string,
  ) {
    const conditions = [
      eq(managementPartnershipPlans.organizationId, organizationId),
      eq(managementPartnershipPlans.unitId, unitId),
      eq(managementPartnershipPlans.active, true),
    ];
    if (onDate) conditions.push(lte(managementPartnershipPlans.effectiveFrom, onDate));
    const [plan] = await tx
      .select()
      .from(managementPartnershipPlans)
      .where(and(...conditions))
      .orderBy(desc(managementPartnershipPlans.effectiveFrom))
      .limit(1);
    if (!plan) return null;
    const tiers = await tx
      .select({
        minimumCents: managementPartnershipTiers.minimumCents,
        maximumCents: managementPartnershipTiers.maximumCents,
        rewardType: managementPartnershipTiers.rewardType,
        rewardValue: managementPartnershipTiers.rewardValue,
      })
      .from(managementPartnershipTiers)
      .where(
        and(
          eq(managementPartnershipTiers.organizationId, organizationId),
          eq(managementPartnershipTiers.unitId, unitId),
          eq(managementPartnershipTiers.planId, plan.id),
        ),
      )
      .orderBy(managementPartnershipTiers.position);
    return { ...plan, tiers };
  }

  private capabilities(role: SettlementRole) {
    return {
      canRead: true,
      canConfigure: role === "owner" || role === "manager",
      canRecordLoss: role === "owner" || role === "manager" || role === "cashier",
      canReviewLoss: role === "owner" || role === "manager",
      canGenerate: role === "owner" || role === "manager" || role === "finance",
      canApprove: role === "owner" || role === "manager",
      canPay: role === "owner" || role === "finance",
      canCancel: role === "owner" || role === "manager",
      canExport: true,
    };
  }

  async overview(identityId: string, organizationId: string, unitId: string) {
    const role = await this.requireRole(identityId, organizationId, unitId, [
      "owner",
      "manager",
      "finance",
      "cashier",
    ]);
    return this.database.db.transaction(async (tx) => {
      const [configuration, partnershipPlan, operationalShifts, losses, settlements, lines] =
        await Promise.all([
          this.configuration(tx, organizationId, unitId),
          this.activePlan(tx, organizationId, unitId),
          tx
            .select({
              id: posOperationalShifts.id,
              label: posOperationalShifts.label,
              status: posOperationalShifts.status,
              startsAt: posOperationalShifts.startsAt,
              closedAt: posOperationalShifts.closedAt,
            })
            .from(posOperationalShifts)
            .where(
              and(
                eq(posOperationalShifts.organizationId, organizationId),
                eq(posOperationalShifts.unitId, unitId),
              ),
            )
            .orderBy(desc(posOperationalShifts.startsAt))
            .limit(100),
          tx.execute<{
            id: string;
            tabId: string;
            tabLabel: string | null;
            type: "unpaid_tab" | "refund" | "chargeback" | "other";
            reason: string;
            amountCents: number;
            serviceChargeCents: number;
            status: "pending" | "approved" | "rejected" | "reversed";
            responsibleName: string | null;
            createdAt: Date;
          }>(sql`
          select losses.id, losses.tab_id as "tabId",
                 coalesce(tabs.label, tabs.display_number::text) as "tabLabel",
                 losses.type, losses.reason, losses.amount_cents as "amountCents",
                 losses.service_charge_cents as "serviceChargeCents", losses.status,
                 responsible.display_name as "responsibleName", losses.created_at as "createdAt"
            from management_operational_losses losses
            join pos_tabs tabs on tabs.organization_id=losses.organization_id and tabs.unit_id=losses.unit_id and tabs.id=losses.tab_id
            left join identities responsible on responsible.id=losses.responsible_identity_id
           where losses.organization_id=${organizationId}::uuid and losses.unit_id=${unitId}::uuid
           order by losses.created_at desc limit 100
        `),
          tx
            .select()
            .from(managementWaiterSettlements)
            .where(
              and(
                eq(managementWaiterSettlements.organizationId, organizationId),
                eq(managementWaiterSettlements.unitId, unitId),
              ),
            )
            .orderBy(desc(managementWaiterSettlements.periodTo))
            .limit(30),
          tx
            .select()
            .from(managementWaiterSettlementLines)
            .where(
              and(
                eq(managementWaiterSettlementLines.organizationId, organizationId),
                eq(managementWaiterSettlementLines.unitId, unitId),
              ),
            ),
        ]);
      const linesBySettlement = new Map<string, typeof lines>();
      for (const line of lines) {
        const list = linesBySettlement.get(line.settlementId) ?? [];
        list.push(line);
        linesBySettlement.set(line.settlementId, list);
      }
      return {
        configuration,
        partnershipPlan,
        operationalShifts,
        operationalLosses: losses,
        settlements: settlements.map((settlement) => ({
          ...settlement,
          periodFrom: settlement.periodFrom,
          periodTo: settlement.periodTo,
          lines: linesBySettlement.get(settlement.id) ?? [],
        })),
        capabilities: this.capabilities(role),
      };
    });
  }

  async lossCandidates(identityId: string, organizationId: string, unitId: string, query: string) {
    await this.requireRole(identityId, organizationId, unitId, ["owner", "manager", "cashier"]);
    const normalized = query.trim().slice(0, 120);
    const candidates = await this.database.db.execute<{
      tabId: string;
      label: string;
      responsibleName: string | null;
      totalCents: number;
      remainingCents: number;
    }>(sql`
      with payments as (
        select tab_id, coalesce(sum(amount_cents),0)::int paid_cents
          from pos_tab_payments where organization_id=${organizationId}::uuid and unit_id=${unitId}::uuid group by tab_id
      ), reversals as (
        select payments.tab_id, coalesce(sum(reversals.amount_cents),0)::int reversed_cents
          from pos_payment_reversals reversals
          join pos_tab_payments payments
            on payments.organization_id=reversals.organization_id
           and payments.unit_id=reversals.unit_id
           and payments.id=reversals.payment_id
         where reversals.organization_id=${organizationId}::uuid
           and reversals.unit_id=${unitId}::uuid
           and reversals.status='approved'
         group by payments.tab_id
      ), losses as (
        select tab_id, coalesce(sum(amount_cents),0)::int loss_cents
          from management_operational_losses
         where organization_id=${organizationId}::uuid and unit_id=${unitId}::uuid and status='approved' and type='unpaid_tab'
         group by tab_id
      )
      select tabs.id as "tabId", coalesce(tabs.label, tabs.display_number::text, tabs.id::text) as label,
             responsible.display_name as "responsibleName", tabs.total_cents as "totalCents",
             greatest(tabs.total_cents-greatest(coalesce(payments.paid_cents,0)-coalesce(reversals.reversed_cents,0),0)-coalesce(losses.loss_cents,0),0)::int as "remainingCents"
        from pos_tabs tabs
        left join payments on payments.tab_id=tabs.id
        left join reversals on reversals.tab_id=tabs.id
        left join losses on losses.tab_id=tabs.id
        left join identities responsible on responsible.id=tabs.responsible_identity_id
       where tabs.organization_id=${organizationId}::uuid and tabs.unit_id=${unitId}::uuid and tabs.status='open'
         and (${normalized}='' or coalesce(tabs.label,'') ilike ${`%${normalized}%`} or coalesce(tabs.display_number::text,'') ilike ${`%${normalized}%`} or coalesce(responsible.display_name,'') ilike ${`%${normalized}%`})
         and tabs.total_cents > greatest(coalesce(payments.paid_cents,0)-coalesce(reversals.reversed_cents,0),0)+coalesce(losses.loss_cents,0)
       order by tabs.updated_at desc limit 30
    `);
    return { candidates };
  }

  private async effectivePaidCents(
    tx: Transaction,
    organizationId: string,
    unitId: string,
    tabId: string,
  ) {
    const [row] = await tx
      .select({
        paidCents: sql<number>`greatest(
          coalesce(sum(${posTabPayments.amountCents}), 0) -
          coalesce(sum(${posPaymentReversals.amountCents}) filter (where ${posPaymentReversals.status} = 'approved'), 0),
          0
        )::int`.mapWith(Number),
      })
      .from(posTabPayments)
      .leftJoin(
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
          eq(posTabPayments.organizationId, organizationId),
          eq(posTabPayments.unitId, unitId),
          eq(posTabPayments.tabId, tabId),
        ),
      );
    return cents(row?.paidCents);
  }

  async updateSettings(
    identityId: string,
    organizationId: string,
    unitId: string,
    idempotencyKey: string,
    input: SettlementConfigInput,
  ) {
    await this.requireRole(identityId, organizationId, unitId, ["owner", "manager"]);
    return this.idempotent(
      identityId,
      organizationId,
      unitId,
      idempotencyKey,
      "settlement.settings",
      input,
      async (tx) => {
        const [settings] = await tx
          .insert(managementSettlementSettings)
          .values({ organizationId, unitId, configuration: input, updatedByIdentityId: identityId })
          .onConflictDoUpdate({
            target: [
              managementSettlementSettings.organizationId,
              managementSettlementSettings.unitId,
            ],
            set: { configuration: input, updatedByIdentityId: identityId, updatedAt: new Date() },
          })
          .returning();
        if (!settings) throw new ConflictException({ code: "SETTLEMENT_SETTINGS_WRITE_FAILED" });
        await this.record(
          tx,
          identityId,
          organizationId,
          unitId,
          "management.waiter-settlement.settings.updated",
          "waiter_settlement_settings",
          settings.id,
          { configuration: input },
        );
        return { configuration: input };
      },
    );
  }

  async updatePartnershipPlan(
    identityId: string,
    organizationId: string,
    unitId: string,
    idempotencyKey: string,
    input: PartnershipPlanInput,
  ) {
    await this.requireRole(identityId, organizationId, unitId, ["owner", "manager"]);
    validatePartnershipTiers(input.tiers);
    return this.idempotent(
      identityId,
      organizationId,
      unitId,
      idempotencyKey,
      "settlement.partnership-plan",
      input,
      async (tx) => {
        const [existing] = await tx
          .select({ id: managementPartnershipPlans.id })
          .from(managementPartnershipPlans)
          .where(
            and(
              eq(managementPartnershipPlans.organizationId, organizationId),
              eq(managementPartnershipPlans.unitId, unitId),
              eq(managementPartnershipPlans.effectiveFrom, input.effectiveFrom),
            ),
          )
          .limit(1);
        const planId = existing?.id ?? randomUUID();
        if (existing) {
          await tx
            .update(managementPartnershipPlans)
            .set({ name: input.name, active: true, updatedAt: new Date() })
            .where(eq(managementPartnershipPlans.id, planId));
          await tx
            .delete(managementPartnershipTiers)
            .where(eq(managementPartnershipTiers.planId, planId));
        } else {
          await tx.insert(managementPartnershipPlans).values({
            id: planId,
            organizationId,
            unitId,
            name: input.name,
            effectiveFrom: input.effectiveFrom,
            createdByIdentityId: identityId,
          });
        }
        if (input.tiers.length > 0) {
          await tx.insert(managementPartnershipTiers).values(
            input.tiers.map((tier, position) => ({
              id: randomUUID(),
              organizationId,
              unitId,
              planId,
              position,
              ...tier,
            })),
          );
        }
        await this.record(
          tx,
          identityId,
          organizationId,
          unitId,
          "management.waiter-settlement.partnership-plan.updated",
          "partnership_plan",
          planId,
          { effectiveFrom: input.effectiveFrom, tierCount: input.tiers.length },
        );
        return { id: planId, ...input, active: true };
      },
    );
  }

  async createOperationalLoss(
    identityId: string,
    organizationId: string,
    unitId: string,
    idempotencyKey: string,
    input: OperationalLossInput,
  ) {
    await this.requireRole(identityId, organizationId, unitId, ["owner", "manager", "cashier"]);
    return this.idempotent(
      identityId,
      organizationId,
      unitId,
      idempotencyKey,
      "settlement.operational-loss",
      input,
      async (tx) => {
        await tx.execute(
          sql`select pg_advisory_xact_lock(hashtext(${`pos-payment:${organizationId}:${unitId}:${input.tabId}`}))`,
        );
        await tx.execute(
          sql`select id from pos_tabs where organization_id=${organizationId}::uuid and unit_id=${unitId}::uuid and id=${input.tabId}::uuid for update`,
        );
        const [tab] = await tx
          .select()
          .from(posTabs)
          .where(
            and(
              eq(posTabs.organizationId, organizationId),
              eq(posTabs.unitId, unitId),
              eq(posTabs.id, input.tabId),
            ),
          )
          .limit(1);
        if (!tab) throw new NotFoundException({ code: "TAB_NOT_FOUND" });
        const paidCents = await this.effectivePaidCents(tx, organizationId, unitId, input.tabId);
        const [loss] = await tx
          .select({
            lossCents: sql<number>`coalesce(sum(${managementOperationalLosses.amountCents}) filter (where ${managementOperationalLosses.status}='approved' and ${managementOperationalLosses.type}='unpaid_tab'),0)::int`,
          })
          .from(managementOperationalLosses)
          .where(
            and(
              eq(managementOperationalLosses.organizationId, organizationId),
              eq(managementOperationalLosses.unitId, unitId),
              eq(managementOperationalLosses.tabId, input.tabId),
            ),
          );
        const [reservation] = await tx
          .select({
            reservedCents: sql<number>`coalesce(sum(${posPaymentAttempts.amountCents}) filter (where ${posPaymentAttempts.status} in ('processing', 'unknown') or (${posPaymentAttempts.status} = 'created' and ${posPaymentAttempts.expiresAt} > now())), 0)::int`,
          })
          .from(posPaymentAttempts)
          .where(
            and(
              eq(posPaymentAttempts.organizationId, organizationId),
              eq(posPaymentAttempts.unitId, unitId),
              eq(posPaymentAttempts.tabId, input.tabId),
            ),
          );
        const remainingCents = Math.max(
          0,
          tab.totalCents - paidCents - cents(loss?.lossCents) - cents(reservation?.reservedCents),
        );
        if (input.type === "unpaid_tab" && tab.status !== "open")
          throw new ConflictException({ code: "LOSS_REQUIRES_OPEN_TAB" });
        const amountCents = input.amountCents ?? (input.type === "unpaid_tab" ? remainingCents : 0);
        if (amountCents <= 0 || (input.type === "unpaid_tab" && amountCents > remainingCents)) {
          throw new ConflictException({ code: "INVALID_OPERATIONAL_LOSS_AMOUNT", remainingCents });
        }
        const id = randomUUID();
        const [created] = await tx
          .insert(managementOperationalLosses)
          .values({
            id,
            organizationId,
            unitId,
            tabId: input.tabId,
            operationalShiftId: tab.operationalShiftId,
            responsibleIdentityId: tab.responsibleIdentityId,
            type: input.type,
            reason: input.reason,
            amountCents,
            serviceChargeCents:
              input.type === "unpaid_tab" ? Math.min(tab.serviceChargeCents, amountCents) : 0,
            requestedByIdentityId: identityId,
            idempotencyKey: idempotencyKey.trim(),
          })
          .returning();
        if (!created) throw new ConflictException({ code: "OPERATIONAL_LOSS_WRITE_FAILED" });
        await this.record(
          tx,
          identityId,
          organizationId,
          unitId,
          "management.operational-loss.created",
          "operational_loss",
          id,
          { tabId: input.tabId, type: input.type, amountCents },
        );
        return created;
      },
    );
  }

  async decideOperationalLoss(
    identityId: string,
    organizationId: string,
    unitId: string,
    lossId: string,
    idempotencyKey: string,
    input: OperationalLossDecisionInput,
  ) {
    await this.requireRole(identityId, organizationId, unitId, ["owner", "manager"]);
    return this.idempotent(
      identityId,
      organizationId,
      unitId,
      idempotencyKey,
      "settlement.operational-loss.decision",
      { lossId, ...input },
      async (tx) => {
        const [lossHint] = await tx
          .select({
            tabId: managementOperationalLosses.tabId,
            type: managementOperationalLosses.type,
          })
          .from(managementOperationalLosses)
          .where(
            and(
              eq(managementOperationalLosses.organizationId, organizationId),
              eq(managementOperationalLosses.unitId, unitId),
              eq(managementOperationalLosses.id, lossId),
            ),
          )
          .limit(1);
        if (!lossHint) throw new NotFoundException({ code: "OPERATIONAL_LOSS_NOT_FOUND" });
        if (lossHint.type === "unpaid_tab") {
          await tx.execute(
            sql`select pg_advisory_xact_lock(hashtext(${`pos-payment:${organizationId}:${unitId}:${lossHint.tabId}`}))`,
          );
        }
        await tx.execute(
          sql`select id from management_operational_losses where organization_id=${organizationId}::uuid and unit_id=${unitId}::uuid and id=${lossId}::uuid for update`,
        );
        const [loss] = await tx
          .select()
          .from(managementOperationalLosses)
          .where(
            and(
              eq(managementOperationalLosses.organizationId, organizationId),
              eq(managementOperationalLosses.unitId, unitId),
              eq(managementOperationalLosses.id, lossId),
            ),
          )
          .limit(1);
        if (!loss) throw new NotFoundException({ code: "OPERATIONAL_LOSS_NOT_FOUND" });
        if (input.action === "reverse" ? loss.status !== "approved" : loss.status !== "pending") {
          throw new ConflictException({
            code: "INVALID_OPERATIONAL_LOSS_TRANSITION",
            status: loss.status,
          });
        }
        if (input.action === "approve" && loss.type === "unpaid_tab") {
          await tx.execute(
            sql`select id from pos_tabs where organization_id=${organizationId}::uuid and unit_id=${unitId}::uuid and id=${loss.tabId}::uuid for update`,
          );
          const [tab] = await tx
            .select({ totalCents: posTabs.totalCents, status: posTabs.status })
            .from(posTabs)
            .where(
              and(
                eq(posTabs.organizationId, organizationId),
                eq(posTabs.unitId, unitId),
                eq(posTabs.id, loss.tabId),
              ),
            )
            .limit(1);
          const paidCents = await this.effectivePaidCents(tx, organizationId, unitId, loss.tabId);
          const [approved] = await tx
            .select({
              lossCents: sql<number>`coalesce(sum(${managementOperationalLosses.amountCents}) filter (where ${managementOperationalLosses.status}='approved' and ${managementOperationalLosses.type}='unpaid_tab'),0)::int`,
            })
            .from(managementOperationalLosses)
            .where(
              and(
                eq(managementOperationalLosses.organizationId, organizationId),
                eq(managementOperationalLosses.unitId, unitId),
                eq(managementOperationalLosses.tabId, loss.tabId),
              ),
            );
          const [reservation] = await tx
            .select({
              reservedCents: sql<number>`coalesce(sum(${posPaymentAttempts.amountCents}) filter (where ${posPaymentAttempts.status} in ('processing', 'unknown') or (${posPaymentAttempts.status} = 'created' and ${posPaymentAttempts.expiresAt} > now())), 0)::int`,
            })
            .from(posPaymentAttempts)
            .where(
              and(
                eq(posPaymentAttempts.organizationId, organizationId),
                eq(posPaymentAttempts.unitId, unitId),
                eq(posPaymentAttempts.tabId, loss.tabId),
              ),
            );
          const remaining =
            (tab?.totalCents ?? 0) -
            paidCents -
            cents(approved?.lossCents) -
            cents(reservation?.reservedCents);
          if (tab?.status !== "open" || loss.amountCents > remaining)
            throw new ConflictException({
              code: "OPERATIONAL_LOSS_EXCEEDS_REMAINING",
              remainingCents: Math.max(0, remaining),
            });
        }
        if (input.action === "reverse" && loss.type === "unpaid_tab") {
          const [[tab], paidCents, [approved]] = await Promise.all([
            tx
              .select({ totalCents: posTabs.totalCents, status: posTabs.status })
              .from(posTabs)
              .where(
                and(
                  eq(posTabs.organizationId, organizationId),
                  eq(posTabs.unitId, unitId),
                  eq(posTabs.id, loss.tabId),
                ),
              )
              .limit(1),
            this.effectivePaidCents(tx, organizationId, unitId, loss.tabId),
            tx
              .select({
                lossCents: sql<number>`coalesce(sum(${managementOperationalLosses.amountCents}) filter (where ${managementOperationalLosses.status}='approved' and ${managementOperationalLosses.type}='unpaid_tab'),0)::int`,
              })
              .from(managementOperationalLosses)
              .where(
                and(
                  eq(managementOperationalLosses.organizationId, organizationId),
                  eq(managementOperationalLosses.unitId, unitId),
                  eq(managementOperationalLosses.tabId, loss.tabId),
                ),
              ),
          ]);
          if (!tab) throw new NotFoundException({ code: "TAB_NOT_FOUND" });
          const coverageAfterReversal = paidCents + cents(approved?.lossCents) - loss.amountCents;
          if (tab.status !== "open" && coverageAfterReversal < tab.totalCents) {
            throw new ConflictException({
              code: "OPERATIONAL_LOSS_REVERSE_WOULD_UNCOVER_CLOSED_TAB",
              coverageAfterReversalCents: Math.max(0, coverageAfterReversal),
              totalCents: tab.totalCents,
            });
          }
        }
        const now = new Date();
        const nextStatus =
          input.action === "approve"
            ? ("approved" as const)
            : input.action === "reject"
              ? ("rejected" as const)
              : ("reversed" as const);
        const lifecycle =
          input.action === "reverse"
            ? {
                status: nextStatus,
                reversedAt: now,
                reversedByIdentityId: identityId,
                reversalNote: input.note,
              }
            : {
                status: nextStatus,
                reviewedAt: now,
                reviewedByIdentityId: identityId,
                reviewNote: input.note,
              };
        const [updated] = await tx
          .update(managementOperationalLosses)
          .set({ ...lifecycle, updatedAt: now })
          .where(eq(managementOperationalLosses.id, lossId))
          .returning();
        if (!updated) throw new NotFoundException({ code: "OPERATIONAL_LOSS_NOT_FOUND" });
        await this.record(
          tx,
          identityId,
          organizationId,
          unitId,
          `management.operational-loss.${nextStatus}`,
          "operational_loss",
          lossId,
          { previousStatus: loss.status, note: input.note },
        );
        return updated;
      },
    );
  }

  private async buildPreview(
    tx: Transaction,
    organizationId: string,
    unitId: string,
    period: SettlementPeriodInput,
  ): Promise<Preview> {
    const configuration = await this.configuration(tx, organizationId, unitId);
    if (configuration.aggregateAcrossUnits && period.operationalShiftId) {
      throw new BadRequestException({ code: "MULTIUNIT_SHIFT_NOT_SUPPORTED" });
    }
    if (period.operationalShiftId) {
      const [shift] = await tx
        .select({ id: posOperationalShifts.id })
        .from(posOperationalShifts)
        .where(
          and(
            eq(posOperationalShifts.organizationId, organizationId),
            eq(posOperationalShifts.unitId, unitId),
            eq(posOperationalShifts.id, period.operationalShiftId),
          ),
        )
        .limit(1);
      if (!shift) throw new NotFoundException({ code: "OPERATIONAL_SHIFT_NOT_FOUND" });
    }
    const plan = await this.activePlan(tx, organizationId, unitId, period.to);
    const unitFilter = configuration.aggregateAcrossUnits
      ? sql``
      : sql`and tabs.unit_id=${unitId}::uuid`;
    const shiftFilter = period.operationalShiftId
      ? sql`and tabs.operational_shift_id=${period.operationalShiftId}::uuid`
      : sql``;
    const eligibility =
      configuration.eligibleTabs === "fully_paid"
        ? sql`and greatest(coalesce(payments.paid_cents,0)-coalesce(reversals.reversed_cents,0),0) >= tabs.total_cents`
        : sql``;
    const orderRows = await tx.execute<AggregationOrderRow>(sql`
      with payments as (
        select organization_id, unit_id, tab_id, coalesce(sum(amount_cents),0)::int paid_cents
          from pos_tab_payments where organization_id=${organizationId}::uuid group by organization_id,unit_id,tab_id
      ), reversals as (
        select reversals.organization_id, reversals.unit_id, payments.tab_id,
               coalesce(sum(reversals.amount_cents),0)::int reversed_cents
          from pos_payment_reversals reversals
          join pos_tab_payments payments
            on payments.organization_id=reversals.organization_id
           and payments.unit_id=reversals.unit_id
           and payments.id=reversals.payment_id
          join units source_unit
            on source_unit.organization_id=reversals.organization_id
           and source_unit.id=reversals.unit_id
         where reversals.organization_id=${organizationId}::uuid
           and reversals.status='approved'
           and timezone(source_unit.timezone,reversals.resolved_at)::date between ${period.from}::date and ${period.to}::date
         group by reversals.organization_id,reversals.unit_id,payments.tab_id
      ), losses as (
        select organization_id, unit_id, tab_id,
               coalesce(sum(amount_cents),0)::int loss_cents,
               coalesce(sum(amount_cents) filter (where type in ('refund','chargeback')),0)::int refund_cents
          from management_operational_losses
         where organization_id=${organizationId}::uuid and status='approved'
         group by organization_id,unit_id,tab_id
      )
      select tabs.id as "tabId", tabs.unit_id as "sourceUnitId", tabs.responsible_identity_id as "responsibleIdentityId",
             orders.id as "orderId", orders.created_by_identity_id as "orderIdentityId",
             coalesce(sum(items.gross_cents) filter (where items.status <> 'canceled'),0)::int as "grossCents",
             coalesce(sum(items.discount_cents) filter (where items.status <> 'canceled'),0)::int as "discountCents",
             coalesce(sum(items.gross_cents) filter (where items.status = 'canceled'),0)::int as "canceledCents",
             tabs.service_charge_cents as "tabServiceChargeCents", tabs.tip_cents as "tabTipCents",
             tabs.total_cents as "tabTotalCents",
             greatest(coalesce(payments.paid_cents,0)-coalesce(reversals.reversed_cents,0),0)::int as "paidCents",
             coalesce(losses.loss_cents,0)::int as "operationalLossCents", coalesce(losses.refund_cents,0)::int as "refundCents"
        from pos_tabs tabs
        join units source_unit on source_unit.organization_id=tabs.organization_id and source_unit.id=tabs.unit_id
        left join pos_orders orders on orders.organization_id=tabs.organization_id and orders.unit_id=tabs.unit_id and orders.tab_id=tabs.id
        left join pos_order_items items on items.organization_id=orders.organization_id and items.unit_id=orders.unit_id and items.order_id=orders.id
        left join payments on payments.organization_id=tabs.organization_id and payments.unit_id=tabs.unit_id and payments.tab_id=tabs.id
        left join reversals on reversals.organization_id=tabs.organization_id and reversals.unit_id=tabs.unit_id and reversals.tab_id=tabs.id
        left join losses on losses.organization_id=tabs.organization_id and losses.unit_id=tabs.unit_id and losses.tab_id=tabs.id
       where tabs.organization_id=${organizationId}::uuid and tabs.status='closed'
         and timezone(source_unit.timezone,tabs.closed_at)::date between ${period.from}::date and ${period.to}::date
         ${unitFilter} ${shiftFilter} ${eligibility}
       group by tabs.id,tabs.unit_id,tabs.responsible_identity_id,orders.id,orders.created_by_identity_id,
                tabs.service_charge_cents,tabs.tip_cents,tabs.total_cents,payments.paid_cents,reversals.reversed_cents,losses.loss_cents,losses.refund_cents
       order by tabs.id,orders.id
    `);
    const byTab = new Map<string, AggregationOrderRow[]>();
    for (const row of orderRows) {
      const list = byTab.get(row.tabId) ?? [];
      list.push(row);
      byTab.set(row.tabId, list);
    }
    const sources: PreviewSource[] = [];
    for (const [tabId, rows] of byTab) {
      const useFinal =
        configuration.transferMode === "move_to_final" ||
        configuration.attributionMode === "final_responsible";
      const raw = useFinal
        ? [
            {
              key: `${rows[0]?.sourceUnitId}:${tabId}:tab:${rows[0]?.responsibleIdentityId ?? "unassigned"}`,
              sourceUnitId: rows[0]?.sourceUnitId as string,
              tabId,
              orderId: null,
              identityId: rows[0]?.responsibleIdentityId ?? null,
              grossSalesCents: rows.reduce((sum, row) => sum + cents(row.grossCents), 0),
              discountCents: rows.reduce((sum, row) => sum + cents(row.discountCents), 0),
              canceledCents: rows.reduce((sum, row) => sum + cents(row.canceledCents), 0),
              orderCount: rows.filter((row) => row.orderId).length,
            },
          ]
        : rows
            .filter((row) => row.orderId)
            .map((row) => ({
              key: `${row.sourceUnitId}:${tabId}:${row.orderId}:${row.orderIdentityId ?? "unassigned"}`,
              sourceUnitId: row.sourceUnitId,
              tabId,
              orderId: row.orderId,
              identityId: row.orderIdentityId,
              grossSalesCents: cents(row.grossCents),
              discountCents: cents(row.discountCents),
              canceledCents: cents(row.canceledCents),
              orderCount: 1,
            }));
      if (raw.length === 0) continue;
      const weights = raw.map((source) => ({
        key: source.key,
        weight: Math.max(0, source.grossSalesCents - source.discountCents),
      }));
      const serviceWeights = raw.map((source) => ({
        key: source.key,
        weight:
          configuration.serviceBase === "gross"
            ? source.grossSalesCents
            : Math.max(0, source.grossSalesCents - source.discountCents),
      }));
      const first = rows[0] as AggregationOrderRow;
      const received = allocateCents(cents(first.paidCents), weights);
      const service = allocateCents(cents(first.tabServiceChargeCents), serviceWeights);
      const tips = allocateCents(cents(first.tabTipCents), weights);
      const losses = allocateCents(cents(first.operationalLossCents), weights);
      const refunds = allocateCents(cents(first.refundCents), weights);
      sources.push(
        ...raw.map((source) => ({
          ...source,
          receivedCents: received.get(source.key) ?? 0,
          serviceChargeCents: service.get(source.key) ?? 0,
          tipCents: tips.get(source.key) ?? 0,
          operationalLossCents: losses.get(source.key) ?? 0,
          refundCents: refunds.get(source.key) ?? 0,
        })),
      );
    }
    const identityIds = [
      ...new Set(sources.flatMap((source) => (source.identityId ? [source.identityId] : []))),
    ];
    const [identityRows, peopleRows] =
      identityIds.length === 0
        ? [[], []]
        : await Promise.all([
            tx
              .select({ id: identities.id, displayName: identities.displayName })
              .from(identities)
              .where(inArray(identities.id, identityIds)),
            tx
              .select()
              .from(managementPeople)
              .where(
                and(
                  eq(managementPeople.organizationId, organizationId),
                  inArray(managementPeople.identityId, identityIds),
                ),
              ),
          ]);
    const identityName = new Map(
      identityRows.map((identity) => [identity.id, identity.displayName]),
    );
    const personByIdentity = new Map<string, (typeof peopleRows)[number]>();
    for (const person of peopleRows) {
      if (!person.identityId) continue;
      const current = personByIdentity.get(person.identityId);
      if (!current || person.unitId === unitId || (!current.active && person.active))
        personByIdentity.set(person.identityId, person);
    }
    const lineMap = new Map<string, PreviewLine & { tabIds: Set<string>; refundCents: number }>();
    let unassignedGrossCents = 0;
    for (const source of sources) {
      if (!source.identityId) {
        unassignedGrossCents += source.grossSalesCents;
        continue;
      }
      const person = personByIdentity.get(source.identityId);
      const line = lineMap.get(source.identityId) ?? {
        personId: person?.id ?? null,
        personIdentityId: source.identityId,
        personName: person?.name ?? identityName.get(source.identityId) ?? "Pessoa sem cadastro",
        roleLabel: person?.roleLabel ?? "Sem cadastro em Pessoas",
        eligibleForPayment: Boolean(person?.active),
        tabCount: 0,
        orderCount: 0,
        grossSalesCents: 0,
        discountCents: 0,
        canceledCents: 0,
        receivedCents: 0,
        serviceChargeCents: 0,
        tipCents: 0,
        serviceShareCents: 0,
        partnershipBaseCents: 0,
        partnershipCents: 0,
        operationalLossCents: 0,
        payableCents: 0,
        tabIds: new Set<string>(),
        refundCents: 0,
      };
      line.tabIds.add(source.tabId);
      line.orderCount += source.orderCount;
      line.grossSalesCents += source.grossSalesCents;
      line.discountCents += source.discountCents;
      line.canceledCents += source.canceledCents;
      line.receivedCents += source.receivedCents;
      line.serviceChargeCents += source.serviceChargeCents;
      line.tipCents += source.tipCents;
      line.operationalLossCents += source.operationalLossCents;
      line.refundCents += source.refundCents;
      lineMap.set(source.identityId, line);
    }
    const internalLines = [...lineMap.values()];
    const eligibleLines = internalLines.filter((line) => line.eligibleForPayment);
    const servicePool = teamServiceShareCents(
      internalLines.reduce((sum, line) => sum + line.serviceChargeCents, 0),
      configuration.serviceTeamShareBasisPoints,
    );
    const serviceShares = allocateCents(
      servicePool,
      eligibleLines.map((line) => ({
        key: line.personIdentityId,
        weight: configuration.serviceDistribution === "equal_pool" ? 1 : line.serviceChargeCents,
      })),
    );
    for (const line of internalLines) {
      line.tabCount = line.tabIds.size;
      line.serviceShareCents = line.eligibleForPayment
        ? (serviceShares.get(line.personIdentityId) ?? 0)
        : 0;
      const discount = configuration.discountTreatment === "deduct" ? line.discountCents : 0;
      const canceled = configuration.cancellationTreatment === "deduct" ? line.canceledCents : 0;
      const salesNet = Math.max(0, line.grossSalesCents - discount - canceled);
      const rawBase =
        configuration.partnershipBase === "gross"
          ? line.grossSalesCents
          : configuration.partnershipBase === "net"
            ? salesNet + line.serviceChargeCents
            : configuration.partnershipBase === "received"
              ? line.receivedCents
              : salesNet;
      line.partnershipBaseCents = Math.max(
        0,
        rawBase - (configuration.refundTreatment === "deduct" ? line.refundCents : 0),
      );
      line.partnershipCents =
        line.eligibleForPayment && plan
          ? partnershipRewardCents(
              line.partnershipBaseCents,
              plan.tiers,
              configuration.tierApplication,
            )
          : 0;
      line.payableCents = line.eligibleForPayment
        ? settlementPayableCents(line.serviceShareCents, line.partnershipCents)
        : 0;
    }
    const lines = internalLines
      .map(({ tabIds: _tabIds, refundCents: _refundCents, ...line }) => line)
      .sort((left, right) => left.personName.localeCompare(right.personName));
    return {
      id: null,
      periodFrom: period.from,
      periodTo: period.to,
      operationalShiftId: period.operationalShiftId ?? null,
      status: "preview",
      configuration,
      partnershipPlanId: plan?.id ?? null,
      unassignedGrossCents,
      operationalLossCents: sources.reduce((sum, source) => sum + source.operationalLossCents, 0),
      createdAt: null,
      lines,
      sources,
    };
  }

  async preview(
    identityId: string,
    organizationId: string,
    unitId: string,
    period: SettlementPeriodInput,
  ) {
    const role = await this.requireRole(identityId, organizationId, unitId, [
      "owner",
      "manager",
      "finance",
    ]);
    const result = await this.database.db.transaction((tx) =>
      this.buildPreview(tx, organizationId, unitId, period),
    );
    if (result.configuration.aggregateAcrossUnits && role !== "owner")
      throw new ForbiddenException({ code: "MULTIUNIT_SETTLEMENT_OWNER_REQUIRED" });
    return result;
  }

  async createSettlement(
    identityId: string,
    organizationId: string,
    unitId: string,
    idempotencyKey: string,
    period: SettlementPeriodInput,
  ) {
    const role = await this.requireRole(identityId, organizationId, unitId, [
      "owner",
      "manager",
      "finance",
    ]);
    return this.idempotent(
      identityId,
      organizationId,
      unitId,
      idempotencyKey,
      "settlement.create",
      period,
      async (tx) => {
        const preview = await this.buildPreview(tx, organizationId, unitId, period);
        if (preview.configuration.aggregateAcrossUnits && role !== "owner")
          throw new ForbiddenException({ code: "MULTIUNIT_SETTLEMENT_OWNER_REQUIRED" });
        const scopeKey = preview.configuration.aggregateAcrossUnits ? "organization" : unitId;
        const aggregationKey = period.operationalShiftId
          ? `${scopeKey}:${period.operationalShiftId}`
          : scopeKey;
        const [duplicate] = await tx
          .select({ id: managementWaiterSettlements.id })
          .from(managementWaiterSettlements)
          .where(
            and(
              eq(managementWaiterSettlements.organizationId, organizationId),
              eq(managementWaiterSettlements.aggregationKey, aggregationKey),
              eq(managementWaiterSettlements.periodFrom, period.from),
              eq(managementWaiterSettlements.periodTo, period.to),
            ),
          )
          .limit(1);
        if (duplicate)
          throw new ConflictException({
            code: "WAITER_SETTLEMENT_PERIOD_ALREADY_CLOSED",
            settlementId: duplicate.id,
          });
        const settlementId = randomUUID();
        const lineIds = new Map(preview.lines.map((line) => [line.personIdentityId, randomUUID()]));
        await tx.insert(managementWaiterSettlements).values({
          id: settlementId,
          organizationId,
          unitId,
          aggregationKey,
          periodFrom: period.from,
          periodTo: period.to,
          operationalShiftId: period.operationalShiftId,
          configurationSnapshot: preview.configuration,
          partnershipPlanId: preview.partnershipPlanId,
          unassignedGrossCents: preview.unassignedGrossCents,
          operationalLossCents: preview.operationalLossCents,
          createdByIdentityId: identityId,
          idempotencyKey: idempotencyKey.trim(),
        });
        if (preview.lines.length > 0) {
          await tx.insert(managementWaiterSettlementLines).values(
            preview.lines.map((line) => ({
              id: lineIds.get(line.personIdentityId) as string,
              organizationId,
              unitId,
              settlementId,
              ...line,
            })),
          );
        }
        const attributableSources = preview.sources.filter(
          (source) => source.identityId && lineIds.has(source.identityId),
        );
        if (attributableSources.length > 0) {
          await tx.insert(managementWaiterSettlementSources).values(
            attributableSources.map(
              ({
                key,
                identityId,
                refundCents: _refundCents,
                orderCount: _orderCount,
                ...source
              }) => ({
                id: randomUUID(),
                organizationId,
                unitId,
                settlementId,
                settlementLineId: lineIds.get(identityId as string) as string,
                sourceKey: key,
                ...source,
              }),
            ),
          );
        }
        await this.record(
          tx,
          identityId,
          organizationId,
          unitId,
          "management.waiter-settlement.closed",
          "waiter_settlement",
          settlementId,
          { periodFrom: period.from, periodTo: period.to, lineCount: preview.lines.length },
        );
        return {
          ...preview,
          id: settlementId,
          status: "closed",
          createdAt: new Date().toISOString(),
          sources: undefined,
        };
      },
    );
  }

  async transition(
    identityId: string,
    organizationId: string,
    unitId: string,
    settlementId: string,
    idempotencyKey: string,
    input: SettlementTransitionInput,
  ) {
    const allowed: readonly SettlementRole[] =
      input.action === "pay" ? ["owner", "finance"] : ["owner", "manager"];
    await this.requireRole(identityId, organizationId, unitId, allowed);
    return this.idempotent(
      identityId,
      organizationId,
      unitId,
      idempotencyKey,
      "settlement.transition",
      { settlementId, ...input },
      async (tx) => {
        await tx.execute(
          sql`select id from management_waiter_settlements where organization_id=${organizationId}::uuid and unit_id=${unitId}::uuid and id=${settlementId}::uuid for update`,
        );
        const [current] = await tx
          .select()
          .from(managementWaiterSettlements)
          .where(
            and(
              eq(managementWaiterSettlements.organizationId, organizationId),
              eq(managementWaiterSettlements.unitId, unitId),
              eq(managementWaiterSettlements.id, settlementId),
            ),
          )
          .limit(1);
        if (!current) throw new NotFoundException({ code: "WAITER_SETTLEMENT_NOT_FOUND" });
        const valid =
          (input.action === "approve" && current.status === "closed") ||
          (input.action === "pay" && current.status === "approved") ||
          (input.action === "cancel" && ["closed", "approved"].includes(current.status));
        if (!valid)
          throw new ConflictException({
            code: "INVALID_WAITER_SETTLEMENT_TRANSITION",
            status: current.status,
          });
        const now = new Date();
        const values =
          input.action === "approve"
            ? {
                status: "approved" as const,
                approvedAt: now,
                approvedByIdentityId: identityId,
                approvalNote: input.note,
              }
            : input.action === "pay"
              ? {
                  status: "paid" as const,
                  paidAt: now,
                  paidByIdentityId: identityId,
                  paymentNote: input.note,
                }
              : {
                  status: "canceled" as const,
                  aggregationKey: `canceled:${settlementId}`,
                  canceledAt: now,
                  canceledByIdentityId: identityId,
                  cancellationNote: input.note,
                };
        const [updated] = await tx
          .update(managementWaiterSettlements)
          .set({ ...values, updatedAt: now })
          .where(eq(managementWaiterSettlements.id, settlementId))
          .returning();
        if (!updated) throw new NotFoundException({ code: "WAITER_SETTLEMENT_NOT_FOUND" });
        await this.record(
          tx,
          identityId,
          organizationId,
          unitId,
          `management.waiter-settlement.${values.status}`,
          "waiter_settlement",
          settlementId,
          { previousStatus: current.status, note: input.note },
        );
        return updated;
      },
    );
  }

  async exportCsv(
    identityId: string,
    organizationId: string,
    unitId: string,
    settlementId: string,
  ) {
    await this.requireRole(identityId, organizationId, unitId, [
      "owner",
      "manager",
      "finance",
      "cashier",
    ]);
    const [settlement] = await this.database.db
      .select()
      .from(managementWaiterSettlements)
      .where(
        and(
          eq(managementWaiterSettlements.organizationId, organizationId),
          eq(managementWaiterSettlements.unitId, unitId),
          eq(managementWaiterSettlements.id, settlementId),
        ),
      )
      .limit(1);
    if (!settlement) throw new NotFoundException({ code: "WAITER_SETTLEMENT_NOT_FOUND" });
    const lines = await this.database.db
      .select()
      .from(managementWaiterSettlementLines)
      .where(
        and(
          eq(managementWaiterSettlementLines.organizationId, organizationId),
          eq(managementWaiterSettlementLines.unitId, unitId),
          eq(managementWaiterSettlementLines.settlementId, settlementId),
        ),
      )
      .orderBy(managementWaiterSettlementLines.personName);
    const columns = [
      "Pessoa",
      "Função",
      "Comandas",
      "Pedidos",
      "Venda bruta",
      "Descontos",
      "Cancelamentos",
      "Recebido",
      "Serviço",
      "Gorjetas",
      "Rateio do serviço",
      "Base partnership",
      "Partnership",
      "Perdas operacionais",
      "A pagar",
      "Status",
    ];
    const rows = lines.map((line) => [
      line.personName,
      line.roleLabel,
      line.tabCount,
      line.orderCount,
      line.grossSalesCents,
      line.discountCents,
      line.canceledCents,
      line.receivedCents,
      line.serviceChargeCents,
      line.tipCents,
      line.serviceShareCents,
      line.partnershipBaseCents,
      line.partnershipCents,
      line.operationalLossCents,
      line.payableCents,
      settlement.status,
    ]);
    const content = `\ufeff${[columns, ...rows].map((row) => row.map(csvCell).join(";")).join("\r\n")}`;
    return {
      filename: `fechamento-garcons-${settlement.periodFrom}-${settlement.periodTo}.csv`,
      content,
      sha256: createHash("sha256").update(content).digest("hex"),
    };
  }
}
