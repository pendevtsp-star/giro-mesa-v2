import {
  auditEvents,
  deliveryCouriers,
  deliveryOrders,
  identities,
  managementAccountsPayable,
  managementAccountsReceivable,
  managementCashShifts,
  managementInventoryEvents,
  managementInventoryItems,
  managementInventoryMovements,
  managementOverviewPreferences,
  managementOverviewPriorityStates,
  managementPurchaseOrders,
  managementReceivableLines,
  managementReconciliationEntries,
  managementStockBalances,
  managementTimeEntries,
  posDiningTables,
  posKdsTickets,
  posOperationalShifts,
  posOrders,
  posProductionStations,
  posServiceCalls,
  posTabEvents,
  posTabPayments,
  posTabs,
  reservations,
  units,
  waitlistEntries,
} from "@giromesa/db";
import type { SystemRole } from "@giromesa/domain";
import { BadRequestException, ForbiddenException, Injectable, Logger } from "@nestjs/common";
import { and, desc, eq, gt, gte, inArray, isNull, sql } from "drizzle-orm";
import { DatabaseService } from "../database/database.module.js";
import { ScopeService } from "../organizations/scope.service.js";
import { isApprovalActive } from "../pilot-operations/pilot-rules.js";
import type { OverviewPriorityActionInput, OverviewSourceInput } from "./management.schemas.js";
import { ManagementService } from "./management.service.js";
import {
  defaultOverviewPreferences,
  type OverviewPreferences,
  type OverviewRoute,
  type OverviewSnapshot,
  type OverviewSourceId,
  resolveOverviewProfile,
  shapeManagementOverview,
} from "./management-overview.js";

const roles: readonly SystemRole[] = [
  "owner",
  "manager",
  "waiter",
  "cashier",
  "kds",
  "delivery",
  "inventory",
  "finance",
];

function activityLabel(action: string) {
  const labels: Record<string, string> = {
    "management.overview.priority-claimed": "Prioridade assumida",
    "management.overview.priority-snoozed": "Prioridade adiada",
    "management.overview.priority-resolved": "Prioridade marcada como tratada",
    "management.overview.preferences-updated": "Preferências da Visão Geral atualizadas",
    "management.inventory.event-recorded": "Movimento de estoque registrado",
    "pos.order.sent": "Pedido enviado para produção",
    "pos.payment.recorded": "Pagamento registrado",
  };
  return labels[action] ?? action.replaceAll(/[._-]+/g, " ");
}

function activityRoute(entityType: string): OverviewRoute | undefined {
  if (entityType.includes("overview")) return "dashboard";
  if (entityType.includes("inventory")) return "inventory";
  if (entityType.includes("purchase") || entityType.includes("supplier")) return "purchases";
  if (entityType.includes("cash") || entityType.includes("payment")) return "cash";
  if (entityType.includes("payable") || entityType.includes("receivable")) return "finance";
  if (entityType.includes("delivery")) return "delivery";
  if (entityType.includes("kds") || entityType.includes("order")) return "kds";
  if (entityType.includes("tab") || entityType.includes("table")) return "salon";
  return undefined;
}

@Injectable()
export class ManagementOverviewService {
  private readonly logger = new Logger(ManagementOverviewService.name);

  constructor(
    private readonly database: DatabaseService,
    private readonly scope: ScopeService,
    private readonly management: ManagementService,
  ) {}

  async overview(
    identityId: string,
    organizationId: string,
    unitId: string,
    onlySource?: OverviewSourceInput,
  ) {
    await this.scope.requireUnitAccess(identityId, organizationId, unitId);
    const bindings = await this.scope.requireOrganizationRole(identityId, organizationId, roles);
    const profileId = resolveOverviewProfile(bindings, unitId);
    if (!profileId)
      throw new ForbiddenException({
        code: "OVERVIEW_ROLE_DENIED",
        message: "Visão geral não disponível para este vínculo.",
      });

    const generatedAt = new Date();
    const unavailableSources: string[] = [];
    const sources: Array<{
      id: OverviewSourceId;
      status: "fresh" | "unavailable";
      checkedAt: string;
    }> = [];
    const preferences = await this.loadPreferences(identityId, organizationId, unitId);
    const wants = (source: OverviewSourceId) => !onlySource || onlySource === source;
    const needsOperations =
      ["owner", "manager", "waiter", "cashier", "kitchen", "delivery"].includes(profileId) &&
      wants("operations");
    const needsInventory =
      ["owner", "manager", "inventory"].includes(profileId) && wants("inventory");
    const needsFinance = ["owner", "manager", "finance"].includes(profileId) && wants("finance");
    const needsCash =
      ["owner", "manager", "cashier", "finance"].includes(profileId) && wants("cash");
    const needsDelivery = ["owner", "manager", "delivery"].includes(profileId) && wants("delivery");
    const needsReservations =
      ["owner", "manager", "waiter", "delivery"].includes(profileId) && wants("reservations");
    const needsMultiunit = profileId === "owner" && wants("multiunit");
    const relevantSources: OverviewSourceId[] = [
      ...(["owner", "manager", "waiter", "cashier", "kitchen", "delivery"].includes(profileId)
        ? (["operationalShift", "operations"] as const)
        : []),
      ...(["owner", "manager", "inventory"].includes(profileId) ? (["inventory"] as const) : []),
      ...(["owner", "manager", "finance"].includes(profileId) ? (["finance"] as const) : []),
      ...(["owner", "manager", "cashier", "finance"].includes(profileId)
        ? (["cash"] as const)
        : []),
      ...(["owner", "manager", "delivery"].includes(profileId) ? (["delivery"] as const) : []),
      ...(["owner", "manager", "waiter", "delivery"].includes(profileId)
        ? (["reservations"] as const)
        : []),
      "activity",
      ...(profileId === "owner" ? (["multiunit"] as const) : []),
    ];
    if (onlySource && !relevantSources.includes(onlySource)) {
      throw new BadRequestException({
        code: "OVERVIEW_SOURCE_NOT_AVAILABLE",
        message: "Esta fonte não faz parte da visão deste perfil.",
      });
    }

    const activeShift =
      ["owner", "manager", "waiter", "cashier", "kitchen", "delivery"].includes(profileId) &&
      (wants("operationalShift") || onlySource === "operations" || onlySource === "inventory")
        ? await this.optional("operationalShift", unavailableSources, sources, () =>
            this.loadActiveShift(organizationId, unitId),
          )
        : null;
    const dayStart = new Date(generatedAt);
    dayStart.setUTCHours(0, 0, 0, 0);
    const periodStart = activeShift?.startsAt ?? dayStart;

    const [operations, inventory, finance, cashShift, delivery, reservationData] =
      await Promise.all([
        needsOperations
          ? this.optional("operations", unavailableSources, sources, () =>
              this.loadOperations(
                identityId,
                organizationId,
                unitId,
                periodStart,
                generatedAt,
                preferences.thresholds.kdsDelayMinutes,
              ),
            )
          : undefined,
        needsInventory
          ? this.optional("inventory", unavailableSources, sources, () =>
              this.loadInventory(
                organizationId,
                unitId,
                periodStart,
                generatedAt,
                preferences.thresholds.stockCoverageDays,
              ),
            )
          : undefined,
        needsFinance
          ? this.optional("finance", unavailableSources, sources, () =>
              this.loadFinance(organizationId, unitId, dayStart),
            )
          : undefined,
        needsCash
          ? this.optional("cash", unavailableSources, sources, () =>
              this.loadCashShift(organizationId, unitId),
            )
          : undefined,
        needsDelivery
          ? this.optional("delivery", unavailableSources, sources, () =>
              this.loadDelivery(
                organizationId,
                unitId,
                generatedAt,
                preferences.thresholds.deliveryRiskMinutes,
              ),
            )
          : undefined,
        needsReservations
          ? this.optional("reservations", unavailableSources, sources, () =>
              this.loadReservations(organizationId, unitId, generatedAt),
            )
          : undefined,
      ]);

    const [activity, multiunit] = await Promise.all([
      wants("activity")
        ? this.optional("activity", unavailableSources, sources, () =>
            this.loadActivity(
              organizationId,
              unitId,
              preferences.lastVisitedAt ?? new Date(generatedAt.getTime() - 24 * 60 * 60_000),
            ),
          )
        : undefined,
      needsMultiunit
        ? this.optional("multiunit", unavailableSources, sources, () =>
            this.loadMultiunit(organizationId, dayStart, generatedAt),
          )
        : undefined,
    ]);

    const snapshot: OverviewSnapshot = {
      activeShift: activeShift ?? null,
      cashShift,
      operations,
      inventory,
      finance,
      delivery,
      reservations: reservationData,
      multiunit,
    };
    const shaped = shapeManagementOverview(
      profileId,
      generatedAt,
      snapshot,
      unavailableSources,
      preferences,
    );
    const scoped = onlySource
      ? {
          ...shaped,
          metrics: shaped.metrics.filter(({ source }) => source === onlySource),
          priorities: shaped.priorities.filter(({ source }) => source === onlySource),
          pulse: shaped.pulse.filter(({ source }) => source === onlySource),
          quickActions: [],
          multiunit: onlySource === "multiunit" ? shaped.multiunit : [],
        }
      : shaped;
    return {
      ...scoped,
      priorities: await this.applyPriorityStates(
        identityId,
        organizationId,
        unitId,
        scoped.priorities,
        generatedAt,
      ),
      sources,
      activity: activity ?? [],
      preferences: {
        alertsEnabled: preferences.alertsEnabled,
        minimumTone: preferences.minimumTone,
        digestMinutes: preferences.digestMinutes,
        thresholds: preferences.thresholds,
      },
      lastVisitedAt: preferences.lastVisitedAt?.toISOString() ?? null,
      partialSource: onlySource ?? null,
    };
  }

  private async optional<T>(
    source: OverviewSourceId,
    unavailableSources: string[],
    sources: Array<{
      id: OverviewSourceId;
      status: "fresh" | "unavailable";
      checkedAt: string;
    }>,
    load: () => Promise<T>,
  ): Promise<T | undefined> {
    try {
      const value = await load();
      sources.push({ id: source, status: "fresh", checkedAt: new Date().toISOString() });
      return value;
    } catch (error) {
      unavailableSources.push(source);
      sources.push({ id: source, status: "unavailable", checkedAt: new Date().toISOString() });
      this.logger.warn(
        `Overview source unavailable: ${source}: ${error instanceof Error ? error.message : String(error)}`,
      );
      return undefined;
    }
  }

  async updatePriority(
    identityId: string,
    organizationId: string,
    unitId: string,
    idempotencyKey: string,
    priorityId: string,
    input: OverviewPriorityActionInput,
  ) {
    if (!/^[a-z0-9-]{1,80}$/.test(priorityId)) {
      throw new BadRequestException({
        code: "INVALID_OVERVIEW_PRIORITY",
        message: "Prioridade inválida.",
      });
    }
    const current = await this.overview(identityId, organizationId, unitId);
    const priority = current.priorities.find(
      (item) => item.id === priorityId && item.occurrenceKey === input.occurrenceKey,
    );
    if (!priority) {
      throw new BadRequestException({
        code: "OVERVIEW_PRIORITY_STALE",
        message: "A prioridade mudou ou já foi tratada. Atualize a Visão Geral.",
      });
    }
    return this.management.updateOverviewPriority(
      identityId,
      organizationId,
      unitId,
      idempotencyKey,
      priorityId,
      input,
    );
  }

  private async loadPreferences(identityId: string, organizationId: string, unitId: string) {
    const [stored] = await this.database.db
      .select({
        alertsEnabled: managementOverviewPreferences.alertsEnabled,
        minimumTone: managementOverviewPreferences.minimumTone,
        digestMinutes: managementOverviewPreferences.digestMinutes,
        thresholds: managementOverviewPreferences.thresholds,
        lastVisitedAt: managementOverviewPreferences.lastVisitedAt,
      })
      .from(managementOverviewPreferences)
      .where(
        and(
          eq(managementOverviewPreferences.identityId, identityId),
          eq(managementOverviewPreferences.organizationId, organizationId),
          eq(managementOverviewPreferences.unitId, unitId),
        ),
      )
      .limit(1);
    return {
      alertsEnabled: stored?.alertsEnabled ?? defaultOverviewPreferences.alertsEnabled,
      minimumTone: stored?.minimumTone ?? defaultOverviewPreferences.minimumTone,
      digestMinutes: stored?.digestMinutes ?? defaultOverviewPreferences.digestMinutes,
      thresholds: { ...defaultOverviewPreferences.thresholds, ...(stored?.thresholds ?? {}) },
      lastVisitedAt: stored?.lastVisitedAt ?? null,
    } satisfies OverviewPreferences & { lastVisitedAt: Date | null };
  }

  private async applyPriorityStates<T extends { id: string; occurrenceKey: string }>(
    identityId: string,
    organizationId: string,
    unitId: string,
    priorities: T[],
    now: Date,
  ) {
    if (priorities.length === 0) return [];
    const rows = await this.database.db
      .select({
        priorityId: managementOverviewPriorityStates.priorityId,
        occurrenceKey: managementOverviewPriorityStates.occurrenceKey,
        status: managementOverviewPriorityStates.status,
        assignedToIdentityId: managementOverviewPriorityStates.assignedToIdentityId,
        assignedToName: identities.displayName,
        snoozedUntil: managementOverviewPriorityStates.snoozedUntil,
      })
      .from(managementOverviewPriorityStates)
      .leftJoin(
        identities,
        eq(identities.id, managementOverviewPriorityStates.assignedToIdentityId),
      )
      .where(
        and(
          eq(managementOverviewPriorityStates.organizationId, organizationId),
          eq(managementOverviewPriorityStates.unitId, unitId),
          inArray(
            managementOverviewPriorityStates.priorityId,
            priorities.map(({ id }) => id),
          ),
        ),
      );
    const states = new Map(rows.map((row) => [`${row.priorityId}:${row.occurrenceKey}`, row]));
    return priorities.flatMap((priority) => {
      const state = states.get(`${priority.id}:${priority.occurrenceKey}`);
      if (state?.status === "resolved") return [];
      if (state?.status === "snoozed" && state.snoozedUntil && state.snoozedUntil > now) return [];
      return [
        {
          ...priority,
          status: state?.status === "claimed" ? ("claimed" as const) : ("open" as const),
          assignedTo:
            state?.status === "claimed" && state.assignedToIdentityId
              ? {
                  id: state.assignedToIdentityId,
                  name: state.assignedToName ?? "Pessoa da equipe",
                  isMe: state.assignedToIdentityId === identityId,
                }
              : null,
        },
      ];
    });
  }

  private async loadActivity(organizationId: string, unitId: string, since: Date) {
    const rows = await this.database.db
      .select({
        id: auditEvents.id,
        action: auditEvents.action,
        entityType: auditEvents.entityType,
        occurredAt: auditEvents.occurredAt,
        actorName: identities.displayName,
      })
      .from(auditEvents)
      .leftJoin(identities, eq(identities.id, auditEvents.actorIdentityId))
      .where(
        and(
          eq(auditEvents.organizationId, organizationId),
          eq(auditEvents.unitId, unitId),
          gt(auditEvents.occurredAt, since),
        ),
      )
      .orderBy(desc(auditEvents.occurredAt))
      .limit(12);
    return rows.map((row) => ({
      id: row.id,
      label: activityLabel(row.action),
      detail: row.actorName ? `Por ${row.actorName}` : "Atualização automática",
      occurredAt: row.occurredAt.toISOString(),
      route: activityRoute(row.entityType),
    }));
  }

  private async loadMultiunit(organizationId: string, dayStart: Date, now: Date) {
    const [unitRows, salesRows, marginRows, kdsRows, deliveryRows] = await Promise.all([
      this.database.db
        .select({ id: units.id, name: units.name })
        .from(units)
        .where(and(eq(units.organizationId, organizationId), eq(units.active, true))),
      this.database.db
        .select({
          unitId: posTabs.unitId,
          salesCents:
            sql<number>`coalesce(sum(${posTabs.totalCents}) filter (where ${posTabs.status} = 'closed' and ${posTabs.closedAt} >= ${dayStart}), 0)`.mapWith(
              Number,
            ),
        })
        .from(posTabs)
        .where(eq(posTabs.organizationId, organizationId))
        .groupBy(posTabs.unitId),
      this.database.db
        .select({
          unitId: managementReceivableLines.unitId,
          revenueCents:
            sql<number>`coalesce(sum(${managementReceivableLines.revenueCents}), 0)`.mapWith(
              Number,
            ),
          costCents: sql<number>`coalesce(sum(${managementReceivableLines.costCents}), 0)`.mapWith(
            Number,
          ),
          missingCosts:
            sql<number>`count(*) filter (where ${managementReceivableLines.costCents} is null)`.mapWith(
              Number,
            ),
        })
        .from(managementReceivableLines)
        .innerJoin(
          managementAccountsReceivable,
          eq(managementReceivableLines.receivableId, managementAccountsReceivable.id),
        )
        .where(
          and(
            eq(managementReceivableLines.organizationId, organizationId),
            eq(managementAccountsReceivable.competenceDate, dayStart.toISOString().slice(0, 10)),
          ),
        )
        .groupBy(managementReceivableLines.unitId),
      this.database.db
        .select({
          unitId: posKdsTickets.unitId,
          alerts:
            sql<number>`count(*) filter (where ${posKdsTickets.status} in ('pending', 'preparing') and coalesce(${posKdsTickets.dueAt}, ${posKdsTickets.createdAt} + interval '15 minutes') < ${now})`.mapWith(
              Number,
            ),
        })
        .from(posKdsTickets)
        .where(eq(posKdsTickets.organizationId, organizationId))
        .groupBy(posKdsTickets.unitId),
      this.database.db
        .select({
          unitId: deliveryOrders.unitId,
          alerts:
            sql<number>`count(*) filter (where ${deliveryOrders.status} in ('placed', 'confirmed', 'preparing', 'ready', 'dispatched') and ${deliveryOrders.promisedAt} < ${now})`.mapWith(
              Number,
            ),
        })
        .from(deliveryOrders)
        .where(eq(deliveryOrders.organizationId, organizationId))
        .groupBy(deliveryOrders.unitId),
    ]);
    const salesByUnit = new Map(salesRows.map((row) => [row.unitId, row.salesCents]));
    const marginByUnit = new Map(
      marginRows.map((row) => [
        row.unitId,
        row.missingCosts ? null : row.revenueCents - row.costCents,
      ]),
    );
    const kdsByUnit = new Map(kdsRows.map((row) => [row.unitId, row.alerts]));
    const deliveryByUnit = new Map(deliveryRows.map((row) => [row.unitId, row.alerts]));
    return unitRows
      .map((unit) => {
        const alerts = (kdsByUnit.get(unit.id) ?? 0) + (deliveryByUnit.get(unit.id) ?? 0);
        return {
          unitId: unit.id,
          name: unit.name,
          salesCents: salesByUnit.get(unit.id) ?? 0,
          marginCents: marginByUnit.get(unit.id) ?? null,
          alerts,
          tone:
            alerts > 2 ? ("danger" as const) : alerts ? ("warning" as const) : ("success" as const),
        };
      })
      .sort((left, right) => right.alerts - left.alerts || right.salesCents - left.salesCents)
      .slice(0, 5);
  }

  private async loadActiveShift(organizationId: string, unitId: string) {
    const [shift] = await this.database.db
      .select({ label: posOperationalShifts.label, startsAt: posOperationalShifts.startsAt })
      .from(posOperationalShifts)
      .where(
        and(
          eq(posOperationalShifts.organizationId, organizationId),
          eq(posOperationalShifts.unitId, unitId),
          eq(posOperationalShifts.status, "active"),
        ),
      )
      .limit(1);
    return shift ?? null;
  }

  private async loadCashShift(organizationId: string, unitId: string) {
    const [openRows, closedRows] = await Promise.all([
      this.database.db
        .select({ startsAt: managementCashShifts.openedAt })
        .from(managementCashShifts)
        .where(
          and(
            eq(managementCashShifts.organizationId, organizationId),
            eq(managementCashShifts.unitId, unitId),
            eq(managementCashShifts.status, "open"),
          ),
        )
        .limit(1),
      this.database.db
        .select({ differenceCents: managementCashShifts.differenceCents })
        .from(managementCashShifts)
        .where(
          and(
            eq(managementCashShifts.organizationId, organizationId),
            eq(managementCashShifts.unitId, unitId),
            inArray(managementCashShifts.status, ["closed", "reviewed"]),
          ),
        )
        .orderBy(desc(managementCashShifts.closedAt))
        .limit(1),
    ]);
    const shift = openRows[0];
    return shift ? { ...shift, lastDifferenceCents: closedRows[0]?.differenceCents ?? null } : null;
  }

  private async loadOperations(
    identityId: string,
    organizationId: string,
    unitId: string,
    periodStart: Date,
    now: Date,
    kdsDelayMinutes: number,
  ): Promise<NonNullable<OverviewSnapshot["operations"]>> {
    const scope = and(eq(posTabs.organizationId, organizationId), eq(posTabs.unitId, unitId));
    const periodDuration = Math.max(60 * 60_000, now.getTime() - periodStart.getTime());
    const previousStart = new Date(periodStart.getTime() - periodDuration);
    const [
      tabsRows,
      tableRows,
      callRows,
      kdsRows,
      readyRows,
      paymentRows,
      peopleRows,
      approvalEvents,
      stationRows,
    ] = await Promise.all([
      this.database.db
        .select({
          salesCents:
            sql<number>`coalesce(sum(${posTabs.totalCents}) filter (where ${posTabs.status} = 'closed' and ${posTabs.closedAt} >= ${periodStart}), 0)`.mapWith(
              Number,
            ),
          closedTabs:
            sql<number>`count(*) filter (where ${posTabs.status} = 'closed' and ${posTabs.closedAt} >= ${periodStart})`.mapWith(
              Number,
            ),
          openTabs: sql<number>`count(*) filter (where ${posTabs.status} = 'open')`.mapWith(Number),
          myOpenTabs:
            sql<number>`count(*) filter (where ${posTabs.status} = 'open' and (${posTabs.responsibleIdentityId} = ${identityId} or (${posTabs.responsibleIdentityId} is null and ${posTabs.openedByIdentityId} = ${identityId})))`.mapWith(
              Number,
            ),
          openValueCents:
            sql<number>`coalesce(sum(${posTabs.totalCents}) filter (where ${posTabs.status} = 'open'), 0)`.mapWith(
              Number,
            ),
          previousSalesCents:
            sql<number>`coalesce(sum(${posTabs.totalCents}) filter (where ${posTabs.status} = 'closed' and ${posTabs.closedAt} >= ${previousStart} and ${posTabs.closedAt} < ${periodStart}), 0)`.mapWith(
              Number,
            ),
          previousClosedTabs:
            sql<number>`count(*) filter (where ${posTabs.status} = 'closed' and ${posTabs.closedAt} >= ${previousStart} and ${posTabs.closedAt} < ${periodStart})`.mapWith(
              Number,
            ),
        })
        .from(posTabs)
        .where(scope),
      this.database.db
        .select({
          tables: sql<number>`count(*) filter (where ${posDiningTables.active} = true)`.mapWith(
            Number,
          ),
          occupiedTables:
            sql<number>`count(*) filter (where ${posDiningTables.active} = true and ${posDiningTables.status} = 'occupied')`.mapWith(
              Number,
            ),
          turnoverTables:
            sql<number>`count(*) filter (where ${posDiningTables.active} = true and ${posDiningTables.status} in ('needs_cleaning', 'cleaning'))`.mapWith(
              Number,
            ),
        })
        .from(posDiningTables)
        .where(
          and(
            eq(posDiningTables.organizationId, organizationId),
            eq(posDiningTables.unitId, unitId),
          ),
        ),
      this.database.db
        .select({
          openCalls:
            sql<number>`count(*) filter (where ${posServiceCalls.status} <> 'resolved')`.mapWith(
              Number,
            ),
          overdueCalls:
            sql<number>`count(*) filter (where ${posServiceCalls.status} <> 'resolved' and ${posServiceCalls.createdAt} + (${posServiceCalls.slaMinutes} * interval '1 minute') < now())`.mapWith(
              Number,
            ),
        })
        .from(posServiceCalls)
        .where(
          and(
            eq(posServiceCalls.organizationId, organizationId),
            eq(posServiceCalls.unitId, unitId),
          ),
        ),
      this.database.db
        .select({
          pending: sql<number>`count(*) filter (where ${posKdsTickets.status} = 'pending')`.mapWith(
            Number,
          ),
          preparing:
            sql<number>`count(*) filter (where ${posKdsTickets.status} = 'preparing')`.mapWith(
              Number,
            ),
          ready: sql<number>`count(*) filter (where ${posKdsTickets.status} = 'ready')`.mapWith(
            Number,
          ),
          delayed:
            sql<number>`count(*) filter (where ${posKdsTickets.status} in ('pending', 'preparing') and coalesce(${posKdsTickets.dueAt}, ${posKdsTickets.createdAt} + (${kdsDelayMinutes} * interval '1 minute')) < ${now})`.mapWith(
              Number,
            ),
        })
        .from(posKdsTickets)
        .where(
          and(eq(posKdsTickets.organizationId, organizationId), eq(posKdsTickets.unitId, unitId)),
        ),
      this.database.db
        .select({ count: sql<number>`count(distinct ${posKdsTickets.id})`.mapWith(Number) })
        .from(posKdsTickets)
        .innerJoin(posOrders, eq(posKdsTickets.orderId, posOrders.id))
        .innerJoin(posTabs, eq(posOrders.tabId, posTabs.id))
        .where(
          and(
            eq(posKdsTickets.organizationId, organizationId),
            eq(posKdsTickets.unitId, unitId),
            eq(posKdsTickets.status, "ready"),
            sql`(${posTabs.responsibleIdentityId} = ${identityId} or (${posTabs.responsibleIdentityId} is null and ${posTabs.openedByIdentityId} = ${identityId}))`,
          ),
        ),
      this.database.db
        .select({
          receivedCents:
            sql<number>`coalesce(sum(${posTabPayments.amountCents}) filter (where ${posTabPayments.createdAt} >= ${periodStart}), 0)`.mapWith(
              Number,
            ),
          previousReceivedCents:
            sql<number>`coalesce(sum(${posTabPayments.amountCents}) filter (where ${posTabPayments.createdAt} >= ${previousStart} and ${posTabPayments.createdAt} < ${periodStart}), 0)`.mapWith(
              Number,
            ),
        })
        .from(posTabPayments)
        .where(
          and(
            eq(posTabPayments.organizationId, organizationId),
            eq(posTabPayments.unitId, unitId),
            gte(posTabPayments.createdAt, previousStart),
          ),
        ),
      this.database.db
        .select({ count: sql<number>`count(*)`.mapWith(Number) })
        .from(managementTimeEntries)
        .where(
          and(
            eq(managementTimeEntries.organizationId, organizationId),
            eq(managementTimeEntries.unitId, unitId),
            isNull(managementTimeEntries.clockedOutAt),
          ),
        ),
      this.database.db
        .select({
          type: posTabEvents.type,
          payload: posTabEvents.payload,
          createdAt: posTabEvents.createdAt,
        })
        .from(posTabEvents)
        .where(
          and(
            eq(posTabEvents.organizationId, organizationId),
            eq(posTabEvents.unitId, unitId),
            inArray(posTabEvents.type, [
              "approval.requested",
              "approval.approved",
              "approval.rejected",
            ]),
          ),
        )
        .orderBy(desc(posTabEvents.createdAt))
        .limit(500),
      this.database.db
        .select({
          label: posProductionStations.name,
          count: sql<number>`count(*)`.mapWith(Number),
        })
        .from(posKdsTickets)
        .innerJoin(posProductionStations, eq(posProductionStations.id, posKdsTickets.stationId))
        .where(
          and(
            eq(posKdsTickets.organizationId, organizationId),
            eq(posKdsTickets.unitId, unitId),
            inArray(posKdsTickets.status, ["pending", "preparing"]),
          ),
        )
        .groupBy(posProductionStations.id, posProductionStations.name)
        .orderBy(desc(sql`count(*)`))
        .limit(1),
    ]);
    const tabs = tabsRows[0];
    const tables = tableRows[0];
    const calls = callRows[0];
    const kds = kdsRows[0];
    const decidedApprovals = new Set(
      approvalEvents
        .filter(({ type }) => type !== "approval.requested")
        .map(({ payload }) => String(payload.requestId ?? "")),
    );
    return {
      salesCents: tabs?.salesCents ?? 0,
      closedTabs: tabs?.closedTabs ?? 0,
      openTabs: tabs?.openTabs ?? 0,
      myOpenTabs: tabs?.myOpenTabs ?? 0,
      openValueCents: tabs?.openValueCents ?? 0,
      receivedCents: paymentRows[0]?.receivedCents ?? 0,
      tables: tables?.tables ?? 0,
      occupiedTables: tables?.occupiedTables ?? 0,
      turnoverTables: tables?.turnoverTables ?? 0,
      openCalls: calls?.openCalls ?? 0,
      overdueCalls: calls?.overdueCalls ?? 0,
      kdsPending: kds?.pending ?? 0,
      kdsPreparing: kds?.preparing ?? 0,
      kdsReady: kds?.ready ?? 0,
      kdsDelayed: kds?.delayed ?? 0,
      readyForMe: readyRows[0]?.count ?? 0,
      activePeople: peopleRows[0]?.count ?? 0,
      pendingApprovals: approvalEvents.filter(
        ({ type, payload, createdAt }) =>
          type === "approval.requested" &&
          !decidedApprovals.has(String(payload.requestId ?? "")) &&
          isApprovalActive(createdAt),
      ).length,
      previousSalesCents: tabs?.previousSalesCents ?? 0,
      previousClosedTabs: tabs?.previousClosedTabs ?? 0,
      previousReceivedCents: paymentRows[0]?.previousReceivedCents ?? 0,
      busiestStationLabel: stationRows[0]?.label ?? null,
      busiestStationQueue: stationRows[0]?.count ?? 0,
    };
  }

  private async loadInventory(
    organizationId: string,
    unitId: string,
    periodStart: Date,
    now: Date,
    coverageDays: number,
  ): Promise<NonNullable<OverviewSnapshot["inventory"]>> {
    const periodDuration = Math.max(60 * 60_000, now.getTime() - periodStart.getTime());
    const previousStart = new Date(periodStart.getTime() - periodDuration);
    const consumptionStart = new Date(now.getTime() - 30 * 24 * 60 * 60_000);
    const [balances, purchaseRows, eventRows, consumptionRows] = await Promise.all([
      this.database.db
        .select({
          itemId: managementInventoryItems.id,
          minimum: managementInventoryItems.minimumQuantity,
          reorder: managementInventoryItems.reorderQuantity,
          leadTimeDays: managementInventoryItems.leadTimeDays,
          quantity: sql<number>`coalesce(sum(${managementStockBalances.quantity}), 0)`.mapWith(
            Number,
          ),
        })
        .from(managementInventoryItems)
        .leftJoin(
          managementStockBalances,
          and(
            eq(managementStockBalances.organizationId, managementInventoryItems.organizationId),
            eq(managementStockBalances.unitId, managementInventoryItems.unitId),
            eq(managementStockBalances.inventoryItemId, managementInventoryItems.id),
          ),
        )
        .where(
          and(
            eq(managementInventoryItems.organizationId, organizationId),
            eq(managementInventoryItems.unitId, unitId),
            eq(managementInventoryItems.active, true),
          ),
        )
        .groupBy(managementInventoryItems.id),
      this.database.db
        .select({
          count:
            sql<number>`count(*) filter (where ${managementPurchaseOrders.status} in ('approved', 'partially_received'))`.mapWith(
              Number,
            ),
          delayed:
            sql<number>`count(*) filter (where ${managementPurchaseOrders.status} in ('approved', 'partially_received') and ${managementPurchaseOrders.expectedAt} < ${now})`.mapWith(
              Number,
            ),
        })
        .from(managementPurchaseOrders)
        .where(
          and(
            eq(managementPurchaseOrders.organizationId, organizationId),
            eq(managementPurchaseOrders.unitId, unitId),
          ),
        ),
      this.database.db
        .select({
          count:
            sql<number>`count(*) filter (where ${managementInventoryEvents.createdAt} >= ${periodStart})`.mapWith(
              Number,
            ),
          previous:
            sql<number>`count(*) filter (where ${managementInventoryEvents.createdAt} >= ${previousStart} and ${managementInventoryEvents.createdAt} < ${periodStart})`.mapWith(
              Number,
            ),
        })
        .from(managementInventoryEvents)
        .where(
          and(
            eq(managementInventoryEvents.organizationId, organizationId),
            eq(managementInventoryEvents.unitId, unitId),
            gte(managementInventoryEvents.createdAt, previousStart),
          ),
        ),
      this.database.db
        .select({
          itemId: managementInventoryMovements.inventoryItemId,
          consumed:
            sql<number>`coalesce(abs(sum(${managementInventoryMovements.quantityDelta}) filter (where ${managementInventoryMovements.quantityDelta} < 0)), 0)`.mapWith(
              Number,
            ),
        })
        .from(managementInventoryMovements)
        .where(
          and(
            eq(managementInventoryMovements.organizationId, organizationId),
            eq(managementInventoryMovements.unitId, unitId),
            gte(managementInventoryMovements.occurredAt, consumptionStart),
          ),
        )
        .groupBy(managementInventoryMovements.inventoryItemId),
    ]);
    const consumption = new Map(consumptionRows.map((row) => [row.itemId, row.consumed / 30]));
    return {
      outOfStock: balances.filter(({ quantity }) => quantity <= 0).length,
      belowMinimum: balances.filter(
        ({ minimum, quantity }) => quantity > 0 && quantity < Number(minimum),
      ).length,
      awaitingReceipt: purchaseRows[0]?.count ?? 0,
      eventsToday: eventRows[0]?.count ?? 0,
      previousEvents: eventRows[0]?.previous ?? 0,
      coverageRisk: balances.filter((item) => {
        const daily = consumption.get(item.itemId) ?? 0;
        return daily > 0 && item.quantity / daily <= Math.max(coverageDays, item.leadTimeDays);
      }).length,
      suggestedPurchases: balances.filter(
        ({ minimum, quantity, reorder }) => quantity <= Number(minimum) && Number(reorder) > 0,
      ).length,
      supplierDelays: purchaseRows[0]?.delayed ?? 0,
    };
  }

  private async loadFinance(
    organizationId: string,
    unitId: string,
    dayStart: Date,
  ): Promise<NonNullable<OverviewSnapshot["finance"]>> {
    const today = dayStart.toISOString().slice(0, 10);
    const sevenDays = new Date(dayStart.getTime() + 7 * 24 * 60 * 60_000)
      .toISOString()
      .slice(0, 10);
    const [payableRows, receivableRows, reconciliationRows, marginRows] = await Promise.all([
      this.database.db
        .select({
          overdue:
            sql<number>`count(*) filter (where ${managementAccountsPayable.status} in ('open', 'partially_paid') and ${managementAccountsPayable.dueDate} < ${today})`.mapWith(
              Number,
            ),
          overdueCents:
            sql<number>`coalesce(sum(${managementAccountsPayable.amountCents} - ${managementAccountsPayable.paidCents}) filter (where ${managementAccountsPayable.status} in ('open', 'partially_paid') and ${managementAccountsPayable.dueDate} < ${today}), 0)`.mapWith(
              Number,
            ),
          balanceCents:
            sql<number>`coalesce(sum(${managementAccountsPayable.amountCents} - ${managementAccountsPayable.paidCents}) filter (where ${managementAccountsPayable.status} in ('open', 'partially_paid')), 0)`.mapWith(
              Number,
            ),
          dueSoon:
            sql<number>`count(*) filter (where ${managementAccountsPayable.status} in ('open', 'partially_paid') and ${managementAccountsPayable.dueDate} >= ${today} and ${managementAccountsPayable.dueDate} <= ${sevenDays})`.mapWith(
              Number,
            ),
          dueSoonCents:
            sql<number>`coalesce(sum(${managementAccountsPayable.amountCents} - ${managementAccountsPayable.paidCents}) filter (where ${managementAccountsPayable.status} in ('open', 'partially_paid') and ${managementAccountsPayable.dueDate} >= ${today} and ${managementAccountsPayable.dueDate} <= ${sevenDays}), 0)`.mapWith(
              Number,
            ),
        })
        .from(managementAccountsPayable)
        .where(
          and(
            eq(managementAccountsPayable.organizationId, organizationId),
            eq(managementAccountsPayable.unitId, unitId),
          ),
        ),
      this.database.db
        .select({
          overdue:
            sql<number>`count(*) filter (where ${managementAccountsReceivable.status} in ('open', 'partially_received') and ${managementAccountsReceivable.dueDate} < ${today})`.mapWith(
              Number,
            ),
          overdueCents:
            sql<number>`coalesce(sum(${managementAccountsReceivable.amountCents} - ${managementAccountsReceivable.receivedCents}) filter (where ${managementAccountsReceivable.status} in ('open', 'partially_received') and ${managementAccountsReceivable.dueDate} < ${today}), 0)`.mapWith(
              Number,
            ),
          balanceCents:
            sql<number>`coalesce(sum(${managementAccountsReceivable.amountCents} - ${managementAccountsReceivable.receivedCents}) filter (where ${managementAccountsReceivable.status} in ('open', 'partially_received')), 0)`.mapWith(
              Number,
            ),
          todayCents:
            sql<number>`coalesce(sum(${managementAccountsReceivable.amountCents}) filter (where ${managementAccountsReceivable.competenceDate} = ${today}), 0)`.mapWith(
              Number,
            ),
          dueSoon:
            sql<number>`count(*) filter (where ${managementAccountsReceivable.status} in ('open', 'partially_received') and ${managementAccountsReceivable.dueDate} >= ${today} and ${managementAccountsReceivable.dueDate} <= ${sevenDays})`.mapWith(
              Number,
            ),
          dueSoonCents:
            sql<number>`coalesce(sum(${managementAccountsReceivable.amountCents} - ${managementAccountsReceivable.receivedCents}) filter (where ${managementAccountsReceivable.status} in ('open', 'partially_received') and ${managementAccountsReceivable.dueDate} >= ${today} and ${managementAccountsReceivable.dueDate} <= ${sevenDays}), 0)`.mapWith(
              Number,
            ),
        })
        .from(managementAccountsReceivable)
        .where(
          and(
            eq(managementAccountsReceivable.organizationId, organizationId),
            eq(managementAccountsReceivable.unitId, unitId),
          ),
        ),
      this.database.db
        .select({ count: sql<number>`count(*)`.mapWith(Number) })
        .from(managementReconciliationEntries)
        .where(
          and(
            eq(managementReconciliationEntries.organizationId, organizationId),
            eq(managementReconciliationEntries.unitId, unitId),
            inArray(managementReconciliationEntries.status, ["unmatched", "divergent"]),
          ),
        ),
      this.database.db
        .select({
          revenueCents:
            sql<number>`coalesce(sum(${managementReceivableLines.revenueCents}), 0)`.mapWith(
              Number,
            ),
          costCents: sql<number>`coalesce(sum(${managementReceivableLines.costCents}), 0)`.mapWith(
            Number,
          ),
          missingCosts:
            sql<number>`count(*) filter (where ${managementReceivableLines.costCents} is null)`.mapWith(
              Number,
            ),
        })
        .from(managementReceivableLines)
        .innerJoin(
          managementAccountsReceivable,
          eq(managementReceivableLines.receivableId, managementAccountsReceivable.id),
        )
        .where(
          and(
            eq(managementReceivableLines.organizationId, organizationId),
            eq(managementReceivableLines.unitId, unitId),
            eq(managementAccountsReceivable.competenceDate, today),
          ),
        ),
    ]);
    const payable = payableRows[0];
    const receivable = receivableRows[0];
    const margin = marginRows[0];
    const grossMarginCents =
      margin && margin.missingCosts === 0 && margin.revenueCents === (receivable?.todayCents ?? 0)
        ? margin.revenueCents - margin.costCents
        : null;
    return {
      overduePayables: payable?.overdue ?? 0,
      overduePayablesCents: payable?.overdueCents ?? 0,
      overdueReceivables: receivable?.overdue ?? 0,
      overdueReceivablesCents: receivable?.overdueCents ?? 0,
      projectedBalanceCents: (receivable?.balanceCents ?? 0) - (payable?.balanceCents ?? 0),
      unresolvedReconciliations: reconciliationRows[0]?.count ?? 0,
      grossMarginCents,
      payablesDueSoon: payable?.dueSoon ?? 0,
      payablesDueSoonCents: payable?.dueSoonCents ?? 0,
      receivablesDueSoon: receivable?.dueSoon ?? 0,
      receivablesDueSoonCents: receivable?.dueSoonCents ?? 0,
    };
  }

  private async loadDelivery(
    organizationId: string,
    unitId: string,
    now: Date,
    riskMinutes: number,
  ): Promise<NonNullable<OverviewSnapshot["delivery"]>> {
    const riskEnd = new Date(now.getTime() + riskMinutes * 60_000);
    const dayStart = new Date(now);
    dayStart.setUTCHours(0, 0, 0, 0);
    const [orderRows, courierRows] = await Promise.all([
      this.database.db
        .select({
          active:
            sql<number>`count(*) filter (where ${deliveryOrders.status} in ('placed', 'confirmed', 'preparing', 'ready', 'dispatched'))`.mapWith(
              Number,
            ),
          preparing:
            sql<number>`count(*) filter (where ${deliveryOrders.status} in ('confirmed', 'preparing'))`.mapWith(
              Number,
            ),
          ready: sql<number>`count(*) filter (where ${deliveryOrders.status} = 'ready')`.mapWith(
            Number,
          ),
          delayed:
            sql<number>`count(*) filter (where ${deliveryOrders.status} in ('placed', 'confirmed', 'preparing', 'ready', 'dispatched') and ${deliveryOrders.promisedAt} is not null and ${deliveryOrders.promisedAt} < ${now})`.mapWith(
              Number,
            ),
          atRisk:
            sql<number>`count(*) filter (where ${deliveryOrders.status} in ('placed', 'confirmed', 'preparing', 'ready', 'dispatched') and ${deliveryOrders.promisedAt} >= ${now} and ${deliveryOrders.promisedAt} <= ${riskEnd})`.mapWith(
              Number,
            ),
          canceledToday:
            sql<number>`count(*) filter (where ${deliveryOrders.status} = 'canceled' and ${deliveryOrders.updatedAt} >= ${dayStart})`.mapWith(
              Number,
            ),
        })
        .from(deliveryOrders)
        .where(
          and(eq(deliveryOrders.organizationId, organizationId), eq(deliveryOrders.unitId, unitId)),
        ),
      this.database.db
        .select({
          total: sql<number>`count(*) filter (where ${deliveryCouriers.active} = true)`.mapWith(
            Number,
          ),
          busy: sql<number>`count(*) filter (where ${deliveryCouriers.active} = true and ${deliveryCouriers.status} in ('assigned', 'delivering'))`.mapWith(
            Number,
          ),
        })
        .from(deliveryCouriers)
        .where(
          and(
            eq(deliveryCouriers.organizationId, organizationId),
            eq(deliveryCouriers.unitId, unitId),
          ),
        ),
    ]);
    const row = orderRows[0];
    return {
      active: row?.active ?? 0,
      preparing: row?.preparing ?? 0,
      ready: row?.ready ?? 0,
      delayed: row?.delayed ?? 0,
      atRisk: row?.atRisk ?? 0,
      busyCouriers: courierRows[0]?.busy ?? 0,
      totalCouriers: courierRows[0]?.total ?? 0,
      canceledToday: row?.canceledToday ?? 0,
    };
  }

  private async loadReservations(
    organizationId: string,
    unitId: string,
    now: Date,
  ): Promise<NonNullable<OverviewSnapshot["reservations"]>> {
    const upcomingEnd = new Date(now.getTime() + 2 * 60 * 60 * 1_000);
    const [reservationRows, waitlistRows] = await Promise.all([
      this.database.db
        .select({
          upcoming:
            sql<number>`count(*) filter (where ${reservations.status} in ('booked', 'confirmed') and ${reservations.scheduledAt} >= ${now} and ${reservations.scheduledAt} <= ${upcomingEnd})`.mapWith(
              Number,
            ),
          overdue:
            sql<number>`count(*) filter (where ${reservations.status} in ('booked', 'confirmed') and ${reservations.scheduledAt} < ${now})`.mapWith(
              Number,
            ),
        })
        .from(reservations)
        .where(
          and(eq(reservations.organizationId, organizationId), eq(reservations.unitId, unitId)),
        ),
      this.database.db
        .select({ count: sql<number>`count(*)`.mapWith(Number) })
        .from(waitlistEntries)
        .where(
          and(
            eq(waitlistEntries.organizationId, organizationId),
            eq(waitlistEntries.unitId, unitId),
            inArray(waitlistEntries.status, ["waiting", "notified"]),
          ),
        ),
    ]);
    return {
      upcoming: reservationRows[0]?.upcoming ?? 0,
      overdue: reservationRows[0]?.overdue ?? 0,
      waitlist: waitlistRows[0]?.count ?? 0,
    };
  }
}
