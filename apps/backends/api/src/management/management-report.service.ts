import { randomUUID } from "node:crypto";
import {
  auditEvents,
  buildReportArtifact,
  type Database,
  identities,
  managementAccountsPayable,
  managementAccountsReceivable,
  managementIdempotency,
  managementPayablePayments,
  managementReceivableLines,
  managementReceivablePayments,
  managementReportAlerts,
  managementReportBudgets,
  managementReportCostBackfills,
  managementReportCostSnapshots,
  managementReportExports,
  managementReportSchedules,
  managementReportViews,
  organizations,
  outboxEvents,
  posCatalogCategories,
  posOrderItems,
  posOrders,
  posPaymentReversals,
  posProducts,
  posTabPayments,
  posTabs,
  reservations,
  units,
} from "@giromesa/db";
import { hasPermission, SYSTEM_ROLES, type SystemRole } from "@giromesa/domain";
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from "@nestjs/common";
import { and, desc, eq, gte, inArray, isNotNull, isNull, lte, ne, or, sql } from "drizzle-orm";
import { DatabaseService } from "../database/database.module.js";
import { MetricsService, reportEmailDeliveryConfigured } from "../health/health.module.js";
import { ScopeService } from "../organizations/scope.service.js";
import { managementReplay, managementRequestHash } from "./management.rules.js";
import { ManagementService } from "./management.service.js";
import {
  buildReportForecast,
  nextReportRun,
  proratedBudgetTarget,
  reportBudgetCoverage,
  reportNextCursor,
  reportPageOffset,
} from "./management-report.rules.js";
import type {
  ReportAlertActionInput,
  ReportAlertEvaluateInput,
  ReportAlertListQuery,
  ReportBudgetInput,
  ReportCostBackfillInput,
  ReportCostPreviewInput,
  ReportDrillDownQuery,
  ReportExportInput,
  ReportExportListQuery,
  ReportMetric,
  ReportReconciliationClosureInput,
  ReportScheduleCreateInput,
  ReportScheduleUpdateInput,
  ReportViewCreateInput,
  ReportViewUpdateInput,
} from "./management-report.schemas.js";

type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];
type JsonResponse = Record<string, unknown>;
type PermissionSet = {
  viewCosts: boolean;
  drillDown: boolean;
  export: boolean;
  manageBudget: boolean;
  manageSchedules: boolean;
  manageViews: boolean;
  manageAlerts: boolean;
  backfillCosts: boolean;
  multiunit: boolean;
};

const metricTargetKeys: Record<ReportMetric, string> = {
  pos_revenue: "posRevenueCents",
  cash_inflows: "cashInflowsCents",
  cash_outflows: "cashOutflowsCents",
  competence_revenue: "competenceRevenueCents",
  competence_expenses: "competenceExpensesCents",
  average_ticket: "averageTicketCents",
  gross_margin: "grossMarginCents",
  inventory_loss: "inventoryLossCents",
  canceled_value: "canceledValueCents",
};

@Injectable()
export class ManagementReportService {
  private readonly logger = new Logger(ManagementReportService.name);

  constructor(
    private readonly database: DatabaseService,
    private readonly scope: ScopeService,
    private readonly management: ManagementService,
    private readonly metrics: MetricsService,
  ) {}

  private async permissions(identityId: string, organizationId: string, unitId: string) {
    await this.scope.requireUnitAccess(identityId, organizationId, unitId);
    const rows = await this.scope.requireOrganizationRole(identityId, organizationId, SYSTEM_ROLES);
    const roles = rows
      .filter((row) => row.unitId === null || row.unitId === unitId)
      .map((row) => row.role as SystemRole);
    const allowed = (permission: string) => roles.some((role) => hasPermission(role, permission));
    if (!allowed("reports:read"))
      throw new ForbiddenException({
        code: "REPORT_PERMISSION_DENIED",
        message: "Relatórios não autorizados nesta unidade.",
      });
    return {
      viewCosts: allowed("reports:costs:read"),
      drillDown: allowed("reports:drilldown"),
      export: allowed("reports:export"),
      manageBudget: allowed("reports:budget:manage"),
      manageSchedules: allowed("reports:schedule:manage"),
      manageViews: allowed("reports:views:manage"),
      manageAlerts: allowed("reports:alerts:manage"),
      backfillCosts: allowed("reports:costs:backfill"),
      multiunit: roles.includes("owner"),
    } satisfies PermissionSet;
  }

  private assertPermission(allowed: boolean) {
    if (!allowed)
      throw new ForbiddenException({
        code: "REPORT_PERMISSION_DENIED",
        message: "Ação de relatório não autorizada nesta unidade.",
      });
  }

  private async measured<T>(operation: string, work: () => Promise<T>) {
    const startedAt = process.hrtime.bigint();
    try {
      const result = await work();
      const duration = this.metrics.observeReportOperation(operation, "success", startedAt);
      if (duration >= 2)
        this.logger.warn(
          `Slow management report operation operation=${operation} seconds=${duration.toFixed(3)}`,
        );
      return result;
    } catch (error) {
      this.metrics.observeReportOperation(operation, "failure", startedAt);
      throw error;
    }
  }

  private async record(
    tx: Transaction,
    actorIdentityId: string,
    organizationId: string,
    unitId: string,
    action: string,
    entityType: string,
    entityId: string,
    metadata: Record<string, unknown>,
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

  private async idempotent<T extends JsonResponse>(
    actorIdentityId: string,
    organizationId: string,
    unitId: string,
    key: string,
    operation: string,
    payload: unknown,
    work: (tx: Transaction) => Promise<T>,
  ) {
    const normalizedKey = key?.trim();
    if (!normalizedKey || normalizedKey.length < 8 || normalizedKey.length > 160)
      throw new BadRequestException({
        code: "IDEMPOTENCY_KEY_REQUIRED",
        message: "Envie Idempotency-Key com 8 a 160 caracteres.",
      });
    const payloadHash = managementRequestHash(operation, payload);
    return this.database.db.transaction(async (tx) => {
      await tx.execute(
        sql`select pg_advisory_xact_lock(hashtext(${`management:${organizationId}:${unitId}:${operation}:${normalizedKey}`}))`,
      );
      const [existing] = await tx
        .select()
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
      const replay = managementReplay<T>(existing, payloadHash);
      if (replay) return replay;
      const response = await work(tx);
      const stored = JSON.parse(JSON.stringify(response)) as T;
      await tx.insert(managementIdempotency).values({
        organizationId,
        unitId,
        actorIdentityId,
        operation,
        idempotencyKey: normalizedKey,
        payloadHash,
        response: stored,
      });
      return { ...stored, idempotentReplay: false };
    });
  }

  private capabilities(permissions: PermissionSet) {
    return { ...permissions, emailDeliveryConfigured: reportEmailDeliveryConfigured() };
  }

  private async periodBudget(organizationId: string, unitId: string, from: string, to: string) {
    const fromMonth = `${from.slice(0, 7)}-01`;
    const toMonth = `${to.slice(0, 7)}-01`;
    const rows = await this.database.db
      .select()
      .from(managementReportBudgets)
      .where(
        and(
          eq(managementReportBudgets.organizationId, organizationId),
          eq(managementReportBudgets.unitId, unitId),
          gte(managementReportBudgets.month, fromMonth),
          lte(managementReportBudgets.month, toMonth),
        ),
      );
    if (rows.length === 0) return null;
    const targets: Record<string, number | null> = {
      posRevenueCents: null,
      cashInflowsCents: null,
      cashOutflowsCents: null,
      competenceRevenueCents: null,
      competenceExpensesCents: null,
      averageTicketCents: null,
      grossMarginCents: null,
      inventoryLossCents: null,
      canceledValueCents: null,
    };
    for (const row of rows) {
      const key = metricTargetKeys[row.metric as ReportMetric];
      if (!key) continue;
      targets[key] =
        (targets[key] ?? 0) +
        proratedBudgetTarget(row.month.slice(0, 7), row.targetCents, from, to);
    }
    const coveredMonths: string[] = [];
    const cursor = new Date(`${fromMonth}T00:00:00.000Z`);
    const end = new Date(`${toMonth}T00:00:00.000Z`);
    while (cursor <= end) {
      coveredMonths.push(cursor.toISOString().slice(0, 7));
      cursor.setUTCMonth(cursor.getUTCMonth() + 1);
    }
    return {
      coverage: reportBudgetCoverage(coveredMonths, rows, Object.keys(metricTargetKeys)),
      basis: "calendar_month_prorated_by_days",
      targets,
    };
  }

  private async operationalIntelligence(
    organizationId: string,
    unitId: string,
    query: { from: string; to: string; family?: ReportExportInput["family"] },
    report: Awaited<ReturnType<ManagementService["reports"]>>,
    viewCosts: boolean,
  ) {
    type LaborRow = {
      roleLabel: string;
      people: number;
      workedMinutes: number;
      scheduledMinutes: number;
      overtimeMinutes: number;
      scheduledDays: number;
      missingRates: number;
      coveredCostCents: number;
    };
    type FiscalRow = {
      documentCount: number;
      authorizedCount: number;
      rejectedCount: number;
      canceledCount: number;
      authorizedCents: number;
      taxCents: number;
    };
    type ReconciliationRow = {
      matchedCount: number;
      unmatchedCount: number;
      divergentCount: number;
      resolvedCount: number;
      unmatchedCents: number;
      divergentCents: number;
    };
    type ReservationForecastRow = {
      date: string;
      reservations: number;
      guests: number;
    };
    const includeLabor = !query.family || query.family === "overview" || query.family === "labor";
    const includeReconciliation =
      !query.family || query.family === "overview" || query.family === "reconciliation";
    const closureEntityId = `${unitId}:${query.from}:${query.to}`;
    const includeForecast =
      !query.family || query.family === "overview" || query.family === "forecast";
    const [laborRows, fiscalRows, reconciliationRows, closureRows, reservationRows] =
      await Promise.all([
        includeLabor
          ? this.database.db.execute<LaborRow>(sql`
        with breaks as (
          select time_entry_id,
                 coalesce(sum(extract(epoch from (ended_at - started_at)) / 60.0), 0) as minutes
          from management_time_entry_breaks
          where organization_id = ${organizationId}::uuid and unit_id = ${unitId}::uuid
            and ended_at is not null
          group by time_entry_id
        ), actual_rows as (
          select people.id as person_id, people.role_label,
                 timezone(${report.timezone}, entries.clocked_in_at)::date as work_date,
                 greatest(0, extract(epoch from (entries.clocked_out_at - entries.clocked_in_at)) / 60.0 - coalesce(breaks.minutes, 0)) as worked_minutes,
                 people.hourly_rate_cents
          from management_time_entries entries
          inner join management_people people
            on people.organization_id = entries.organization_id and people.unit_id = entries.unit_id and people.id = entries.person_id
          left join breaks on breaks.time_entry_id = entries.id
          where entries.organization_id = ${organizationId}::uuid and entries.unit_id = ${unitId}::uuid
            and entries.clocked_out_at is not null
            and timezone(${report.timezone}, entries.clocked_in_at)::date between ${query.from}::date and ${query.to}::date
        ), actual as (
          select person_id, role_label, work_date, sum(worked_minutes) as worked_minutes, hourly_rate_cents
          from actual_rows group by person_id, role_label, work_date, hourly_rate_cents
        ), scheduled_rows as (
          select people.id as person_id, people.role_label,
                 timezone(${report.timezone}, schedules.starts_at)::date as work_date,
                 greatest(0, extract(epoch from (schedules.ends_at - schedules.starts_at)) / 60.0 - schedules.break_minutes) as scheduled_minutes
          from management_schedules schedules
          inner join management_people people
            on people.organization_id = schedules.organization_id and people.unit_id = schedules.unit_id and people.id = schedules.person_id
          where schedules.organization_id = ${organizationId}::uuid and schedules.unit_id = ${unitId}::uuid
            and schedules.canceled_at is null
            and timezone(${report.timezone}, schedules.starts_at)::date between ${query.from}::date and ${query.to}::date
        ), scheduled as (
          select person_id, role_label, work_date, sum(scheduled_minutes) as scheduled_minutes
          from scheduled_rows group by person_id, role_label, work_date
        ), combined as (
          select coalesce(actual.person_id, scheduled.person_id) as person_id,
                 coalesce(actual.role_label, scheduled.role_label) as role_label,
                 actual.worked_minutes, scheduled.scheduled_minutes, actual.hourly_rate_cents
          from actual full join scheduled
            on scheduled.person_id = actual.person_id and scheduled.work_date = actual.work_date
        )
        select role_label as "roleLabel", count(distinct person_id)::int as people,
               coalesce(round(sum(worked_minutes)), 0)::int as "workedMinutes",
               coalesce(round(sum(scheduled_minutes)), 0)::int as "scheduledMinutes",
               coalesce(round(sum(greatest(worked_minutes - scheduled_minutes, 0)) filter (where scheduled_minutes is not null)), 0)::int as "overtimeMinutes",
               count(*) filter (where scheduled_minutes is not null)::int as "scheduledDays",
               count(*) filter (where worked_minutes > 0 and hourly_rate_cents is null)::int as "missingRates",
               coalesce(round(sum(worked_minutes * hourly_rate_cents / 60.0) filter (where hourly_rate_cents is not null)), 0)::int as "coveredCostCents"
        from combined group by role_label order by "workedMinutes" desc, role_label
      `)
          : Promise.resolve([] as LaborRow[]),
        includeReconciliation
          ? this.database.db.execute<FiscalRow>(sql`
        select count(*)::int as "documentCount",
               count(*) filter (where status = 'authorized')::int as "authorizedCount",
               count(*) filter (where status = 'rejected')::int as "rejectedCount",
               count(*) filter (where status = 'canceled')::int as "canceledCount",
               coalesce(sum(total_cents) filter (where status = 'authorized'), 0)::int as "authorizedCents",
               coalesce(sum(tax_cents) filter (where status = 'authorized'), 0)::int as "taxCents"
        from fiscal_documents
        where organization_id = ${organizationId}::uuid and unit_id = ${unitId}::uuid
          and timezone(${report.timezone}, issued_at)::date between ${query.from}::date and ${query.to}::date
      `)
          : Promise.resolve([] as FiscalRow[]),
        includeReconciliation
          ? this.database.db.execute<ReconciliationRow>(sql`
        select count(*) filter (where entries.status = 'matched')::int as "matchedCount",
               count(*) filter (where entries.status = 'unmatched')::int as "unmatchedCount",
               count(*) filter (where entries.status = 'divergent')::int as "divergentCount",
               count(*) filter (where entries.status = 'resolved')::int as "resolvedCount",
               coalesce(sum(entries.net_cents) filter (where entries.status = 'unmatched'), 0)::int as "unmatchedCents",
               coalesce(sum(entries.net_cents) filter (where entries.status = 'divergent'), 0)::int as "divergentCents"
        from management_reconciliation_entries entries
        inner join management_reconciliation_imports imports
          on imports.organization_id = entries.organization_id and imports.unit_id = entries.unit_id and imports.id = entries.import_id
        where entries.organization_id = ${organizationId}::uuid and entries.unit_id = ${unitId}::uuid
          and timezone(${report.timezone}, imports.imported_at)::date between ${query.from}::date and ${query.to}::date
      `)
          : Promise.resolve([] as ReconciliationRow[]),
        includeReconciliation
          ? this.database.db
              .select({
                action: auditEvents.action,
                actorIdentityId: auditEvents.actorIdentityId,
                metadata: auditEvents.metadata,
                occurredAt: auditEvents.occurredAt,
              })
              .from(auditEvents)
              .where(
                and(
                  eq(auditEvents.organizationId, organizationId),
                  eq(auditEvents.unitId, unitId),
                  eq(auditEvents.entityType, "management_report_reconciliation_closure"),
                  eq(auditEvents.entityId, closureEntityId),
                ),
              )
              .orderBy(desc(auditEvents.occurredAt))
              .limit(1)
          : Promise.resolve([]),
        includeForecast
          ? this.database.db
              .select({
                date: sql<string>`timezone(${report.timezone}, ${reservations.scheduledAt})::date`.mapWith(
                  String,
                ),
                reservations: sql<number>`count(*)::int`.mapWith(Number),
                guests: sql<number>`coalesce(sum(${reservations.partySize}), 0)::int`.mapWith(
                  Number,
                ),
              })
              .from(reservations)
              .where(
                and(
                  eq(reservations.organizationId, organizationId),
                  eq(reservations.unitId, unitId),
                  ne(reservations.status, "canceled"),
                  sql`timezone(${report.timezone}, ${reservations.scheduledAt})::date > ${query.to}::date`,
                  sql`timezone(${report.timezone}, ${reservations.scheduledAt})::date <= ${query.to}::date + 7`,
                ),
              )
              // ponytail: positional grouping avoids PostgreSQL treating repeated timezone
              // parameters as different expressions; replace only if the projection changes.
              .groupBy(sql.raw("1"))
              .orderBy(sql.raw("1"))
          : Promise.resolve([] as ReservationForecastRow[]),
      ]);
    const laborRoles = laborRows.map((row) => ({
      roleLabel: row.roleLabel,
      people: Number(row.people),
      workedMinutes: Number(row.workedMinutes),
      scheduledMinutes: Number(row.scheduledMinutes),
      overtimeMinutes: Number(row.overtimeMinutes),
      laborCostCents:
        viewCosts && Number(row.missingRates) === 0 ? Number(row.coveredCostCents) : null,
      costCoverage:
        Number(row.workedMinutes) === 0
          ? ("unavailable" as const)
          : Number(row.missingRates) === 0
            ? ("complete" as const)
            : ("partial" as const),
    }));
    const workedMinutes = laborRoles.reduce((sum, row) => sum + row.workedMinutes, 0);
    const missingLaborCosts = laborRoles.some((row) => row.costCoverage === "partial");
    const laborCostCents =
      viewCosts && !missingLaborCosts
        ? laborRoles.reduce((sum, row) => sum + (row.laborCostCents ?? 0), 0)
        : null;
    const fiscal = fiscalRows[0] ?? {
      documentCount: 0,
      authorizedCount: 0,
      rejectedCount: 0,
      canceledCount: 0,
      authorizedCents: 0,
      taxCents: 0,
    };
    const external = reconciliationRows[0] ?? {
      matchedCount: 0,
      unmatchedCount: 0,
      divergentCount: 0,
      resolvedCount: 0,
      unmatchedCents: 0,
      divergentCents: 0,
    };
    const closureEvent = closureRows[0];
    const closureMetadata = closureEvent?.metadata ?? {};
    const closureChecklist =
      closureMetadata.checklist && typeof closureMetadata.checklist === "object"
        ? (closureMetadata.checklist as Record<string, unknown>)
        : {};
    const closure = {
      status: closureEvent?.action.endsWith(".closed") ? ("closed" as const) : ("open" as const),
      closedAt: closureEvent?.action.endsWith(".closed")
        ? closureEvent.occurredAt.toISOString()
        : null,
      closedByIdentityId: closureEvent?.action.endsWith(".closed")
        ? closureEvent.actorIdentityId
        : null,
      note: typeof closureMetadata.note === "string" ? closureMetadata.note : "",
      evidence: Array.isArray(closureMetadata.evidence)
        ? closureMetadata.evidence.filter((value): value is string => typeof value === "string")
        : [],
      checklist: {
        payments: closureChecklist.payments === true,
        fiscal: closureChecklist.fiscal === true,
        external: closureChecklist.external === true,
      },
    };
    const posRevenueCents = report.reportFamilies.sales.netRevenueCents;
    const paymentCents = report.breakdowns.paymentMethods.reduce(
      (sum, row) => sum + row.revenueCents,
      0,
    );
    const forecast = buildReportForecast({
      dailySeries: report.dailySeries,
      cashFlow: report.cashFlow,
      inventory: report.reportFamilies.inventory.analysis,
      futureDemand: reservationRows.map((row) => ({
        date: row.date,
        reservations: Number(row.reservations),
        guests: Number(row.guests),
        demandFloorCents:
          report.reportFamilies.sales.averageSpendPerGuestCents === null
            ? 0
            : Number(row.guests) * report.reportFamilies.sales.averageSpendPerGuestCents,
      })),
    });
    return {
      labor: {
        coverage: workedMinutes > 0 ? ("complete" as const) : ("unavailable" as const),
        costCoverage: !viewCosts
          ? ("unavailable" as const)
          : missingLaborCosts
            ? ("partial" as const)
            : workedMinutes > 0
              ? ("complete" as const)
              : ("unavailable" as const),
        scheduleCoverage: laborRows.some((row) => Number(row.scheduledDays) > 0)
          ? ("complete" as const)
          : ("unavailable" as const),
        people: laborRoles.reduce((sum, row) => sum + row.people, 0),
        workedMinutes,
        scheduledMinutes: laborRoles.reduce((sum, row) => sum + row.scheduledMinutes, 0),
        overtimeMinutes: laborRows.some((row) => Number(row.scheduledDays) > 0)
          ? laborRoles.reduce((sum, row) => sum + row.overtimeMinutes, 0)
          : null,
        laborCostCents,
        laborCostPercent:
          laborCostCents !== null && posRevenueCents > 0
            ? Number(((laborCostCents / posRevenueCents) * 100).toFixed(2))
            : null,
        salesPerLaborHourCents:
          workedMinutes > 0 ? Math.round((posRevenueCents * 60) / workedMinutes) : null,
        roles: laborRoles,
      },
      reconciliation: {
        coverage:
          posRevenueCents === 0 && Number(fiscal.documentCount) === 0
            ? ("unavailable" as const)
            : Number(fiscal.authorizedCents) === posRevenueCents && paymentCents === posRevenueCents
              ? ("complete" as const)
              : ("partial" as const),
        posRevenueCents,
        paymentCents,
        paymentDifferenceCents: paymentCents - posRevenueCents,
        fiscalAuthorizedCents: Number(fiscal.authorizedCents),
        fiscalDifferenceCents: Number(fiscal.authorizedCents) - posRevenueCents,
        taxCents: Number(fiscal.taxCents),
        documents: {
          total: Number(fiscal.documentCount),
          authorized: Number(fiscal.authorizedCount),
          rejected: Number(fiscal.rejectedCount),
          canceled: Number(fiscal.canceledCount),
        },
        external: {
          matched: Number(external.matchedCount),
          unmatched: Number(external.unmatchedCount),
          divergent: Number(external.divergentCount),
          resolved: Number(external.resolvedCount),
          unmatchedCents: Number(external.unmatchedCents),
          divergentCents: Number(external.divergentCents),
        },
        closure,
      },
      forecast,
    };
  }

  async reports(
    identityId: string,
    organizationId: string,
    unitId: string,
    query: Omit<ReportExportInput, "family" | "format"> & {
      family?: ReportExportInput["family"];
      minimumComparableOperatingDays?: number;
    },
  ) {
    return this.measured("read", async () => {
      const permissions = await this.permissions(identityId, organizationId, unitId);
      const includeBudget = !query.family || query.family === "overview";
      const [report, budget] = await Promise.all([
        this.management.reports(identityId, organizationId, unitId, query),
        includeBudget
          ? this.periodBudget(organizationId, unitId, query.from, query.to)
          : Promise.resolve(null),
      ]);
      const intelligence = await this.operationalIntelligence(
        organizationId,
        unitId,
        query,
        report,
        permissions.viewCosts,
      );
      const incomeStatement = permissions.viewCosts
        ? report.incomeStatement
        : {
            ...report.incomeStatement,
            cmvCents: null,
            grossMarginCents: null,
            operatingExpensesCents: null,
            operatingResultCents: null,
            costCoverage: {
              ...report.incomeStatement.costCoverage,
              cmvCents: null,
              grossMarginCents: null,
            },
          };
      const reportFamilies = permissions.viewCosts
        ? report.reportFamilies
        : {
            ...report.reportFamilies,
            inventory: {
              ...report.reportFamilies.inventory,
              lossValueCents: null,
              currentInventoryValueCents: null,
              analysis: report.reportFamilies.inventory.analysis.map((row) => ({
                ...row,
                consumedValueCents: null,
                abcClass: null,
              })),
              comparison: {
                lossQuantity: report.reportFamilies.inventory.comparison.lossQuantity,
              },
            },
            purchasing: {
              ...report.reportFamilies.purchasing,
              orderedCents: null,
              receivedCents: null,
              suppliers: report.reportFamilies.purchasing.suppliers.map((supplier) => ({
                ...supplier,
                orderedCents: null,
                receivedCents: null,
              })),
              supplierPerformance: report.reportFamilies.purchasing.supplierPerformance.map(
                (supplier) => ({ ...supplier, priceVariancePercent: null }),
              ),
              comparison: {},
            },
            profitability: {
              ...report.reportFamilies.profitability,
              coverage: "unavailable" as const,
              grossMarginPercent: null,
              productProfitabilityCoverage: "unavailable" as const,
              products: report.reportFamilies.profitability.products.map((product) => ({
                ...product,
                costCents: null,
                grossMarginCents: null,
                grossMarginPercent: null,
              })),
              comparison: {},
            },
          };
      const actuals: Record<string, number | null> = {
        posRevenueCents: reportFamilies.sales.netRevenueCents,
        cashInflowsCents: report.cashFlow.inflowsCents,
        cashOutflowsCents: report.cashFlow.outflowsCents,
        competenceRevenueCents: report.incomeStatement.revenueCents,
        competenceExpensesCents: permissions.viewCosts
          ? report.incomeStatement.operatingExpensesCents
          : null,
        averageTicketCents: reportFamilies.sales.averageTicketCents,
        grossMarginCents: permissions.viewCosts ? report.incomeStatement.grossMarginCents : null,
        inventoryLossCents: permissions.viewCosts
          ? (reportFamilies.inventory.lossValueCents ?? null)
          : null,
        canceledValueCents: reportFamilies.exceptions.canceledValueCents,
      };
      const upperBoundTargets = new Set([
        "cashOutflowsCents",
        "competenceExpensesCents",
        "inventoryLossCents",
        "canceledValueCents",
      ]);
      const budgetWithAlerts = budget
        ? {
            ...budget,
            alerts: Object.entries(budget.targets).flatMap(([key, target]) => {
              const actual = actuals[key];
              if (target === null || actual === null || actual === undefined) return [];
              const upperBound = upperBoundTargets.has(key);
              const onTrack = upperBound ? actual <= target : actual >= target;
              return [
                {
                  key,
                  actualCents: actual,
                  targetCents: target,
                  differenceCents: actual - target,
                  status: onTrack ? ("on_track" as const) : ("attention" as const),
                  direction: upperBound ? ("maximum" as const) : ("minimum" as const),
                },
              ];
            }),
          }
        : null;
      return {
        ...report,
        incomeStatement,
        reportFamilies: { ...reportFamilies, ...intelligence },
        meta: {
          ...report.meta,
          queryFamily: query.family ?? "overview",
          coverage: {
            ...report.meta.coverage,
            budget: budgetWithAlerts?.coverage ?? "unavailable",
            labor: intelligence.labor.coverage,
            reconciliation: intelligence.reconciliation.coverage,
            forecast: intelligence.forecast.available ? "complete" : "unavailable",
          },
          indicators: {
            revenue: {
              coverage: report.meta.coverage.sales,
              dataThrough: report.meta.dataThrough,
              sources: ["pos_tabs", "pos_tab_payments"],
            },
            cashFlow: {
              coverage: report.meta.coverage.cashFlow,
              dataThrough: report.meta.dataThrough,
              sources: ["management_receivable_payments", "management_payable_payments"],
            },
            profitability: {
              coverage: report.meta.coverage.costs,
              dataThrough: report.meta.dataThrough,
              sources: ["management_receivable_lines", "pos_order_items"],
            },
            inventory: {
              coverage: reportFamilies.inventory.coverage,
              dataThrough: report.meta.dataThrough,
              sources: ["management_inventory_events", "management_stock_balances"],
            },
            labor: {
              coverage: intelligence.labor.coverage,
              dataThrough: report.meta.dataThrough,
              sources: ["management_time_entries", "management_schedules"],
            },
            reconciliation: {
              coverage: intelligence.reconciliation.coverage,
              dataThrough: report.meta.dataThrough,
              sources: ["fiscal_documents", "management_reconciliation_entries"],
            },
            forecast: {
              coverage: intelligence.forecast.available ? "complete" : "unavailable",
              dataThrough: report.meta.dataThrough,
              sources: ["pos_tabs", "management_inventory_events"],
            },
            budget: {
              coverage: budgetWithAlerts?.coverage ?? "unavailable",
              dataThrough: report.meta.dataThrough,
              sources: ["management_report_budgets"],
            },
          },
        },
        budget: budgetWithAlerts,
        capabilities: this.capabilities(permissions),
      };
    });
  }

  async budgets(identityId: string, organizationId: string, unitId: string) {
    const permissions = await this.permissions(identityId, organizationId, unitId);
    this.assertPermission(permissions.manageBudget);
    const rows = await this.database.db
      .select({
        month: managementReportBudgets.month,
        metric: managementReportBudgets.metric,
        targetCents: managementReportBudgets.targetCents,
        version: managementReportBudgets.version,
        updatedAt: managementReportBudgets.updatedAt,
      })
      .from(managementReportBudgets)
      .where(
        and(
          eq(managementReportBudgets.organizationId, organizationId),
          eq(managementReportBudgets.unitId, unitId),
        ),
      )
      .orderBy(desc(managementReportBudgets.month), managementReportBudgets.metric)
      .limit(120);
    const months = new Map<string, typeof rows>();
    for (const row of rows) {
      const items = months.get(row.month) ?? [];
      items.push(row);
      months.set(row.month, items);
    }
    return {
      months: [...months.entries()].map(([month, items]) => ({ month: month.slice(0, 7), items })),
    };
  }

  async putBudget(
    identityId: string,
    organizationId: string,
    unitId: string,
    month: string,
    idempotencyKey: string,
    input: ReportBudgetInput,
  ) {
    const permissions = await this.permissions(identityId, organizationId, unitId);
    this.assertPermission(permissions.manageBudget);
    const monthDate = `${month}-01`;
    return this.idempotent(
      identityId,
      organizationId,
      unitId,
      idempotencyKey,
      "report-budget-put",
      { month, ...input },
      async (tx) => {
        const [existing] = await tx
          .select()
          .from(managementReportBudgets)
          .where(
            and(
              eq(managementReportBudgets.organizationId, organizationId),
              eq(managementReportBudgets.unitId, unitId),
              eq(managementReportBudgets.month, monthDate),
              eq(managementReportBudgets.metric, input.metric),
            ),
          )
          .limit(1);
        if (existing && input.version !== existing.version)
          throw new ConflictException({ code: "REPORT_BUDGET_VERSION_CONFLICT" });
        if (!existing && input.version !== undefined)
          throw new ConflictException({ code: "REPORT_BUDGET_VERSION_CONFLICT" });
        const [budget] = existing
          ? await tx
              .update(managementReportBudgets)
              .set({
                targetCents: input.targetCents,
                version: existing.version + 1,
                updatedByIdentityId: identityId,
                updatedAt: new Date(),
              })
              .where(
                and(
                  eq(managementReportBudgets.id, existing.id),
                  eq(managementReportBudgets.version, input.version as number),
                ),
              )
              .returning()
          : await tx
              .insert(managementReportBudgets)
              .values({
                organizationId,
                unitId,
                month: monthDate,
                metric: input.metric,
                targetCents: input.targetCents,
                createdByIdentityId: identityId,
                updatedByIdentityId: identityId,
              })
              .returning();
        if (!budget) throw new ConflictException({ code: "REPORT_BUDGET_VERSION_CONFLICT" });
        await this.record(
          tx,
          identityId,
          organizationId,
          unitId,
          "management.report_budget.upserted",
          "management_report_budget",
          budget.id,
          {
            month: monthDate,
            metric: input.metric,
            targetCents: input.targetCents,
            version: budget.version,
          },
        );
        return {
          month: budget.month,
          metric: budget.metric,
          targetCents: budget.targetCents,
          version: budget.version,
          updatedAt: budget.updatedAt,
        };
      },
    );
  }

  async budgetMonth(identityId: string, organizationId: string, unitId: string, month: string) {
    const permissions = await this.permissions(identityId, organizationId, unitId);
    this.assertPermission(permissions.manageBudget);
    const rows = await this.database.db
      .select({
        month: managementReportBudgets.month,
        metric: managementReportBudgets.metric,
        targetCents: managementReportBudgets.targetCents,
        version: managementReportBudgets.version,
        updatedAt: managementReportBudgets.updatedAt,
      })
      .from(managementReportBudgets)
      .where(
        and(
          eq(managementReportBudgets.organizationId, organizationId),
          eq(managementReportBudgets.unitId, unitId),
          eq(managementReportBudgets.month, `${month}-01`),
        ),
      )
      .orderBy(managementReportBudgets.metric);
    return { month, budgets: rows };
  }

  async drillDown(
    identityId: string,
    organizationId: string,
    unitId: string,
    query: ReportDrillDownQuery,
  ) {
    return this.measured("drilldown", async () => {
      const permissions = await this.permissions(identityId, organizationId, unitId);
      this.assertPermission(permissions.drillDown);
      if (query.dimension === "metric" && ["cmv", "competence_expenses"].includes(query.key))
        this.assertPermission(permissions.viewCosts);
      if (
        query.dimension === "purchase" ||
        (query.dimension === "inventory" && query.key === "loss")
      )
        this.assertPermission(permissions.viewCosts);
      const [unit] = await this.database.db
        .select({ timezone: units.timezone })
        .from(units)
        .where(and(eq(units.organizationId, organizationId), eq(units.id, unitId)))
        .limit(1);
      if (!unit) throw new NotFoundException({ code: "UNIT_NOT_FOUND" });
      const offset = reportPageOffset(query.cursor);
      const [rows, totals] = await Promise.all([
        this.drillRows(organizationId, unitId, unit.timezone, query, offset),
        this.drillTotals(organizationId, unitId, unit.timezone, query),
      ]);
      const hasMore = rows.length > query.limit;
      const pageRows = rows.slice(0, query.limit);
      return {
        timezone: unit.timezone,
        period: { from: query.from, to: query.to },
        dimension: query.dimension,
        key: query.key,
        totals,
        rows: pageRows,
        page: { nextCursor: reportNextCursor(offset, pageRows.length, hasMore) },
      };
    });
  }

  private async drillRows(
    organizationId: string,
    unitId: string,
    timezone: string,
    query: ReportDrillDownQuery,
    offset: number,
  ): Promise<JsonResponse[]> {
    const limit = query.limit + 1;
    const closedDate = sql<string>`timezone(${timezone}, ${posTabs.closedAt})::date`;
    if (query.dimension === "product" || query.dimension === "category") {
      const productRows = await this.database.db
        .select({
          id: posOrderItems.id,
          occurredAt: posTabs.closedAt,
          localDate: closedDate.mapWith(String),
          productId: posProducts.id,
          categoryId: posCatalogCategories.id,
          label: posProducts.name,
          amountCents: posOrderItems.netCents,
          quantity: posOrderItems.quantity,
        })
        .from(posOrderItems)
        .innerJoin(
          posOrders,
          and(
            eq(posOrders.organizationId, organizationId),
            eq(posOrders.unitId, unitId),
            eq(posOrders.id, posOrderItems.orderId),
          ),
        )
        .innerJoin(
          posTabs,
          and(
            eq(posTabs.organizationId, organizationId),
            eq(posTabs.unitId, unitId),
            eq(posTabs.id, posOrders.tabId),
          ),
        )
        .innerJoin(
          posProducts,
          and(
            eq(posProducts.organizationId, organizationId),
            eq(posProducts.id, posOrderItems.productId),
          ),
        )
        .innerJoin(
          posCatalogCategories,
          and(
            eq(posCatalogCategories.organizationId, organizationId),
            eq(posCatalogCategories.id, posProducts.categoryId),
          ),
        )
        .where(
          and(
            eq(posOrderItems.organizationId, organizationId),
            eq(posOrderItems.unitId, unitId),
            eq(posTabs.status, "closed"),
            ne(posOrderItems.status, "canceled"),
            gte(closedDate, query.from),
            lte(closedDate, query.to),
            query.dimension === "product"
              ? eq(posProducts.id, query.key)
              : eq(posCatalogCategories.id, query.key),
          ),
        )
        .orderBy(desc(posTabs.closedAt), desc(posOrderItems.id))
        .limit(limit)
        .offset(offset);
      return productRows.map((row) => ({
        referenceId: row.id,
        occurredAt: row.occurredAt?.toISOString() ?? null,
        localDate: row.localDate,
        referenceType: "order_item",
        label: row.label,
        amountCents: row.amountCents,
        quantity: row.quantity,
      }));
    }
    if (query.dimension === "channel") {
      const rows = await this.database.db
        .select({
          id: posTabs.id,
          occurredAt: posTabs.closedAt,
          localDate: closedDate.mapWith(String),
          amountCents: posTabs.totalCents,
        })
        .from(posTabs)
        .where(
          and(
            eq(posTabs.organizationId, organizationId),
            eq(posTabs.unitId, unitId),
            eq(posTabs.status, "closed"),
            eq(posTabs.fulfillmentType, query.key as "dine_in"),
            gte(closedDate, query.from),
            lte(closedDate, query.to),
          ),
        )
        .orderBy(desc(posTabs.closedAt), desc(posTabs.id))
        .limit(limit)
        .offset(offset);
      return rows.map((row) => ({
        referenceId: row.id,
        occurredAt: row.occurredAt?.toISOString() ?? null,
        localDate: row.localDate,
        referenceType: "tab",
        label: query.key,
        amountCents: row.amountCents,
        quantity: 1,
      }));
    }
    if (query.dimension === "payment_method") {
      const rows = await this.database.db.execute<{
        id: string;
        occurredAt: Date | string;
        localDate: string;
        amountCents: number;
        referenceType: "payment" | "payment_reversal";
      }>(sql`
        select payments.id,
               tabs.closed_at as "occurredAt",
               timezone(${timezone}, tabs.closed_at)::date::text as "localDate",
               payments.amount_cents::int as "amountCents",
               'payment'::text as "referenceType"
          from pos_tab_payments payments
          join pos_tabs tabs
            on tabs.organization_id=payments.organization_id
           and tabs.unit_id=payments.unit_id
           and tabs.id=payments.tab_id
         where payments.organization_id=${organizationId}::uuid
           and payments.unit_id=${unitId}::uuid
           and payments.method=${query.key}
           and tabs.status='closed'
           and timezone(${timezone},tabs.closed_at)::date between ${query.from}::date and ${query.to}::date
        union all
        select reversals.id,
               reversals.resolved_at as "occurredAt",
               timezone(${timezone}, reversals.resolved_at)::date::text as "localDate",
               (-reversals.amount_cents)::int as "amountCents",
               'payment_reversal'::text as "referenceType"
          from pos_payment_reversals reversals
          join pos_tab_payments payments
            on payments.organization_id=reversals.organization_id
           and payments.unit_id=reversals.unit_id
           and payments.id=reversals.payment_id
         where reversals.organization_id=${organizationId}::uuid
           and reversals.unit_id=${unitId}::uuid
           and reversals.status='approved'
           and payments.method=${query.key}
           and timezone(${timezone},reversals.resolved_at)::date between ${query.from}::date and ${query.to}::date
         order by "occurredAt" desc, id desc
         limit ${limit} offset ${offset}
      `);
      return rows.map((row) => ({
        referenceId: row.id,
        occurredAt:
          row.occurredAt instanceof Date
            ? row.occurredAt.toISOString()
            : new Date(row.occurredAt).toISOString(),
        localDate: row.localDate,
        referenceType: row.referenceType,
        label: query.key,
        amountCents: row.amountCents,
        quantity: 1,
      }));
    }
    if (["exception", "inventory", "purchase", "operation"].includes(query.dimension))
      return this.operationalDrillRows(organizationId, unitId, timezone, query, offset);
    return this.metricRows(organizationId, unitId, timezone, query, offset);
  }

  private async operationalDrillRows(
    organizationId: string,
    unitId: string,
    timezone: string,
    query: ReportDrillDownQuery,
    offset: number,
  ): Promise<JsonResponse[]> {
    type DetailRow = {
      referenceId: string;
      occurredAt: Date | string | null;
      localDate: string;
      referenceType: string;
      label: string;
      amountCents: number | string | null;
      quantity: number | string;
    };
    const limit = query.limit + 1;
    let rows: DetailRow[];
    if (query.dimension === "exception") {
      rows = await this.database.db.execute<DetailRow>(sql`
        select items.id::text as "referenceId", tabs.closed_at as "occurredAt",
               timezone(${timezone}, tabs.closed_at)::date::text as "localDate",
               'order_item'::text as "referenceType", items.product_name as label,
               items.net_cents as "amountCents", items.quantity::int as quantity
        from pos_order_items items
        inner join pos_orders orders on orders.organization_id = items.organization_id and orders.unit_id = items.unit_id and orders.id = items.order_id
        inner join pos_tabs tabs on tabs.organization_id = orders.organization_id and tabs.unit_id = orders.unit_id and tabs.id = orders.tab_id
        where items.organization_id = ${organizationId}::uuid and items.unit_id = ${unitId}::uuid and tabs.status = 'closed'
          and (${query.key} = 'canceled_items' and items.status = 'canceled' or ${query.key} = 'discounted_items' and items.status <> 'canceled' and items.discount_cents > 0)
          and timezone(${timezone}, tabs.closed_at)::date between ${query.from}::date and ${query.to}::date
        order by tabs.closed_at desc, items.id desc limit ${limit} offset ${offset}
      `);
    } else if (query.dimension === "inventory" && query.key === "loss") {
      rows = await this.database.db.execute<DetailRow>(sql`
        select lines.id::text as "referenceId", events.occurred_at as "occurredAt",
               timezone(${timezone}, events.occurred_at)::date::text as "localDate",
               'inventory_loss'::text as "referenceType", items.name as label,
               case when movements.unit_cost_cents is null then null else round(abs(lines.quantity_delta::numeric) * movements.unit_cost_cents)::int end as "amountCents",
               abs(lines.quantity_delta::numeric)::double precision as quantity
        from management_inventory_events events
        inner join management_inventory_event_lines lines on lines.organization_id = events.organization_id and lines.unit_id = events.unit_id and lines.event_id = events.id
        inner join management_inventory_items items on items.organization_id = lines.organization_id and items.unit_id = lines.unit_id and items.id = lines.inventory_item_id
        left join management_inventory_movements movements on movements.organization_id = lines.organization_id and movements.unit_id = lines.unit_id and movements.source_type = 'inventory_event_line' and movements.source_id = lines.id and movements.type = 'loss'
        where events.organization_id = ${organizationId}::uuid and events.unit_id = ${unitId}::uuid and events.type = 'loss'
          and timezone(${timezone}, events.occurred_at)::date between ${query.from}::date and ${query.to}::date
        order by events.occurred_at desc, lines.id desc limit ${limit} offset ${offset}
      `);
    } else if (query.dimension === "inventory") {
      rows = await this.database.db.execute<DetailRow>(sql`
        select items.id::text as "referenceId", null::timestamptz as "occurredAt", ${query.to}::text as "localDate",
               'inventory_balance'::text as "referenceType", items.name as label,
               case when count(*) filter (where balances.quantity::numeric > 0 and balances.average_cost_cents is null) = 0
                    then round(coalesce(sum(balances.quantity::numeric * balances.average_cost_cents), 0))::int end as "amountCents",
               coalesce(sum(balances.quantity::numeric), 0)::double precision as quantity
        from management_inventory_items items
        left join management_stock_balances balances on balances.organization_id = items.organization_id and balances.unit_id = items.unit_id and balances.inventory_item_id = items.id
        where items.organization_id = ${organizationId}::uuid and items.unit_id = ${unitId}::uuid and items.active = true
        group by items.id, items.name
        having (${query.key} = 'stockout' and coalesce(sum(balances.quantity::numeric), 0) <= 0)
            or (${query.key} = 'low_stock' and coalesce(sum(balances.quantity::numeric), 0) > 0 and coalesce(sum(balances.quantity::numeric), 0) <= items.minimum_quantity::numeric)
        order by items.name, items.id limit ${limit} offset ${offset}
      `);
    } else if (query.dimension === "purchase" && query.key === "receipts") {
      rows = await this.database.db.execute<DetailRow>(sql`
        select receipts.id::text as "referenceId", receipts.received_at as "occurredAt",
               timezone(${timezone}, receipts.received_at)::date::text as "localDate",
               'purchase_receipt'::text as "referenceType", suppliers.name as label,
               receipts.total_cents as "amountCents", 1::int as quantity
        from management_purchase_receipts receipts
        inner join management_suppliers suppliers on suppliers.organization_id = receipts.organization_id and suppliers.unit_id = receipts.unit_id and suppliers.id = receipts.supplier_id
        where receipts.organization_id = ${organizationId}::uuid and receipts.unit_id = ${unitId}::uuid and receipts.status = 'posted'
          and timezone(${timezone}, receipts.received_at)::date between ${query.from}::date and ${query.to}::date
        order by receipts.received_at desc, receipts.id desc limit ${limit} offset ${offset}
      `);
    } else if (query.dimension === "purchase") {
      rows = await this.database.db.execute<DetailRow>(sql`
        select orders.id::text as "referenceId", orders.created_at as "occurredAt",
               timezone(${timezone}, orders.created_at)::date::text as "localDate",
               'purchase_order'::text as "referenceType", suppliers.name as label,
               orders.total_cents as "amountCents", 1::int as quantity
        from management_purchase_orders orders
        inner join management_suppliers suppliers on suppliers.organization_id = orders.organization_id and suppliers.unit_id = orders.unit_id and suppliers.id = orders.supplier_id
        where orders.organization_id = ${organizationId}::uuid and orders.unit_id = ${unitId}::uuid
          and (${query.key} = 'orders' or orders.supplier_id::text = ${query.key})
          and timezone(${timezone}, orders.created_at)::date between ${query.from}::date and ${query.to}::date
        order by orders.created_at desc, orders.id desc limit ${limit} offset ${offset}
      `);
    } else {
      rows = await this.database.db.execute<DetailRow>(sql`
        select tabs.id::text as "referenceId", tabs.closed_at as "occurredAt",
               timezone(${timezone}, tabs.closed_at)::date::text as "localDate",
               'tab'::text as "referenceType", coalesce(tabs.label, tabs.id::text) as label,
               tabs.total_cents as "amountCents", 1::int as quantity
        from pos_tabs tabs
        where tabs.organization_id = ${organizationId}::uuid and tabs.unit_id = ${unitId}::uuid and tabs.status = 'closed'
          and (${query.key} = 'closed_tabs' or ${query.key} = 'table_turnovers' and tabs.fulfillment_type = 'dine_in' and tabs.table_id is not null)
          and timezone(${timezone}, tabs.closed_at)::date between ${query.from}::date and ${query.to}::date
        order by tabs.closed_at desc, tabs.id desc limit ${limit} offset ${offset}
      `);
    }
    return rows.map((row) => ({
      ...row,
      amountCents: row.amountCents === null ? 0 : Number(row.amountCents),
      quantity: Number(row.quantity),
      occurredAt:
        row.occurredAt instanceof Date
          ? row.occurredAt.toISOString()
          : row.occurredAt === null
            ? null
            : String(row.occurredAt),
    }));
  }

  private async operationalDrillTotals(
    organizationId: string,
    unitId: string,
    timezone: string,
    query: ReportDrillDownQuery,
  ) {
    type TotalRow = { amountCents: number | string; quantity: number | string };
    let rows: TotalRow[];
    if (query.dimension === "exception") {
      rows = await this.database.db.execute<TotalRow>(sql`
        select coalesce(sum(items.net_cents), 0)::bigint as "amountCents",
               coalesce(sum(items.quantity), 0)::int as quantity
        from pos_order_items items
        inner join pos_orders orders on orders.organization_id = items.organization_id and orders.unit_id = items.unit_id and orders.id = items.order_id
        inner join pos_tabs tabs on tabs.organization_id = orders.organization_id and tabs.unit_id = orders.unit_id and tabs.id = orders.tab_id
        where items.organization_id = ${organizationId}::uuid and items.unit_id = ${unitId}::uuid and tabs.status = 'closed'
          and (${query.key} = 'canceled_items' and items.status = 'canceled' or ${query.key} = 'discounted_items' and items.status <> 'canceled' and items.discount_cents > 0)
          and timezone(${timezone}, tabs.closed_at)::date between ${query.from}::date and ${query.to}::date
      `);
    } else if (query.dimension === "inventory" && query.key === "loss") {
      rows = await this.database.db.execute<TotalRow>(sql`
        select coalesce(round(sum(abs(quantity_delta::numeric) * unit_cost_cents)), 0)::bigint as "amountCents",
               coalesce(sum(abs(quantity_delta::numeric)), 0)::double precision as quantity
        from management_inventory_movements
        where organization_id = ${organizationId}::uuid and unit_id = ${unitId}::uuid and type = 'loss'
          and timezone(${timezone}, occurred_at)::date between ${query.from}::date and ${query.to}::date
      `);
    } else if (query.dimension === "inventory") {
      rows = await this.database.db.execute<TotalRow>(sql`
        with balances as (
          select items.id, items.minimum_quantity, coalesce(sum(stock.quantity::numeric), 0) as quantity,
                 case when count(*) filter (where stock.quantity::numeric > 0 and stock.average_cost_cents is null) = 0
                      then round(coalesce(sum(stock.quantity::numeric * stock.average_cost_cents), 0)) else 0 end as value_cents
          from management_inventory_items items
          left join management_stock_balances stock on stock.organization_id = items.organization_id and stock.unit_id = items.unit_id and stock.inventory_item_id = items.id
          where items.organization_id = ${organizationId}::uuid and items.unit_id = ${unitId}::uuid and items.active = true
          group by items.id, items.minimum_quantity
        )
        select coalesce(sum(value_cents), 0)::bigint as "amountCents", count(*)::int as quantity
        from balances where (${query.key} = 'stockout' and quantity <= 0)
          or (${query.key} = 'low_stock' and quantity > 0 and quantity <= minimum_quantity::numeric)
      `);
    } else if (query.dimension === "purchase" && query.key === "receipts") {
      rows = await this.database.db.execute<TotalRow>(sql`
        select coalesce(sum(total_cents), 0)::bigint as "amountCents", count(*)::int as quantity
        from management_purchase_receipts
        where organization_id = ${organizationId}::uuid and unit_id = ${unitId}::uuid and status = 'posted'
          and timezone(${timezone}, received_at)::date between ${query.from}::date and ${query.to}::date
      `);
    } else if (query.dimension === "purchase") {
      rows = await this.database.db.execute<TotalRow>(sql`
        select coalesce(sum(total_cents), 0)::bigint as "amountCents", count(*)::int as quantity
        from management_purchase_orders
        where organization_id = ${organizationId}::uuid and unit_id = ${unitId}::uuid
          and (${query.key} = 'orders' or supplier_id::text = ${query.key})
          and timezone(${timezone}, created_at)::date between ${query.from}::date and ${query.to}::date
      `);
    } else {
      rows = await this.database.db.execute<TotalRow>(sql`
        select coalesce(sum(total_cents), 0)::bigint as "amountCents", count(*)::int as quantity
        from pos_tabs
        where organization_id = ${organizationId}::uuid and unit_id = ${unitId}::uuid and status = 'closed'
          and (${query.key} = 'closed_tabs' or ${query.key} = 'table_turnovers' and fulfillment_type = 'dine_in' and table_id is not null)
          and timezone(${timezone}, closed_at)::date between ${query.from}::date and ${query.to}::date
      `);
    }
    const row = rows[0];
    return {
      amountCents: Number(row?.amountCents ?? 0),
      quantity: Number(row?.quantity ?? 0),
    };
  }

  private async metricRows(
    organizationId: string,
    unitId: string,
    timezone: string,
    query: ReportDrillDownQuery,
    offset: number,
  ): Promise<JsonResponse[]> {
    const limit = query.limit + 1;
    if (query.key === "cash_inflows") {
      const localDate = sql<string>`timezone(${timezone}, ${managementReceivablePayments.receivedAt})::date`;
      const rows = await this.database.db
        .select({
          id: managementReceivablePayments.id,
          occurredAt: managementReceivablePayments.receivedAt,
          localDate: localDate.mapWith(String),
          amountCents: managementReceivablePayments.amountCents,
        })
        .from(managementReceivablePayments)
        .where(
          and(
            eq(managementReceivablePayments.organizationId, organizationId),
            eq(managementReceivablePayments.unitId, unitId),
            gte(localDate, query.from),
            lte(localDate, query.to),
          ),
        )
        .orderBy(
          desc(managementReceivablePayments.receivedAt),
          desc(managementReceivablePayments.id),
        )
        .limit(limit)
        .offset(offset);
      return rows.map((row) => ({
        referenceId: row.id,
        localDate: row.localDate,
        amountCents: row.amountCents,
        occurredAt: row.occurredAt.toISOString(),
        referenceType: "receivable_payment",
        label: "Entrada realizada",
        quantity: 1,
      }));
    }
    if (query.key === "cash_outflows") {
      const localDate = sql<string>`timezone(${timezone}, ${managementPayablePayments.paidAt})::date`;
      const rows = await this.database.db
        .select({
          id: managementPayablePayments.id,
          occurredAt: managementPayablePayments.paidAt,
          localDate: localDate.mapWith(String),
          amountCents: managementPayablePayments.amountCents,
        })
        .from(managementPayablePayments)
        .where(
          and(
            eq(managementPayablePayments.organizationId, organizationId),
            eq(managementPayablePayments.unitId, unitId),
            gte(localDate, query.from),
            lte(localDate, query.to),
          ),
        )
        .orderBy(desc(managementPayablePayments.paidAt), desc(managementPayablePayments.id))
        .limit(limit)
        .offset(offset);
      return rows.map((row) => ({
        referenceId: row.id,
        localDate: row.localDate,
        amountCents: row.amountCents,
        occurredAt: row.occurredAt.toISOString(),
        referenceType: "payable_payment",
        label: "Saída realizada",
        quantity: 1,
      }));
    }
    if (query.key === "competence_revenue") {
      const rows = await this.database.db
        .select({
          id: managementAccountsReceivable.id,
          localDate: managementAccountsReceivable.competenceDate,
          amountCents: managementAccountsReceivable.amountCents,
        })
        .from(managementAccountsReceivable)
        .where(
          and(
            eq(managementAccountsReceivable.organizationId, organizationId),
            eq(managementAccountsReceivable.unitId, unitId),
            gte(managementAccountsReceivable.competenceDate, query.from),
            lte(managementAccountsReceivable.competenceDate, query.to),
          ),
        )
        .orderBy(
          desc(managementAccountsReceivable.competenceDate),
          desc(managementAccountsReceivable.id),
        )
        .limit(limit)
        .offset(offset);
      return rows.map((row) => ({
        referenceId: row.id,
        localDate: row.localDate,
        amountCents: row.amountCents,
        occurredAt: null,
        referenceType: "receivable",
        label: "Receita por competência",
        quantity: 1,
      }));
    }
    if (query.key === "competence_expenses") {
      const rows = await this.database.db
        .select({
          id: managementAccountsPayable.id,
          localDate: managementAccountsPayable.competenceDate,
          amountCents: managementAccountsPayable.amountCents,
        })
        .from(managementAccountsPayable)
        .where(
          and(
            eq(managementAccountsPayable.organizationId, organizationId),
            eq(managementAccountsPayable.unitId, unitId),
            isNull(managementAccountsPayable.purchaseReceiptId),
            gte(managementAccountsPayable.competenceDate, query.from),
            lte(managementAccountsPayable.competenceDate, query.to),
          ),
        )
        .orderBy(desc(managementAccountsPayable.competenceDate), desc(managementAccountsPayable.id))
        .limit(limit)
        .offset(offset);
      return rows.map((row) => ({
        referenceId: row.id,
        localDate: row.localDate,
        amountCents: row.amountCents,
        occurredAt: null,
        referenceType: "payable",
        label: "Despesa por competência",
        quantity: 1,
      }));
    }
    if (query.key === "cmv") {
      const rows = await this.database.db
        .select({
          id: managementReceivableLines.id,
          localDate: managementAccountsReceivable.competenceDate,
          amountCents: managementReceivableLines.costCents,
        })
        .from(managementReceivableLines)
        .innerJoin(
          managementAccountsReceivable,
          and(
            eq(managementAccountsReceivable.organizationId, organizationId),
            eq(managementAccountsReceivable.unitId, unitId),
            eq(managementAccountsReceivable.id, managementReceivableLines.receivableId),
          ),
        )
        .where(
          and(
            eq(managementReceivableLines.organizationId, organizationId),
            eq(managementReceivableLines.unitId, unitId),
            isNotNull(managementReceivableLines.costCents),
            gte(managementAccountsReceivable.competenceDate, query.from),
            lte(managementAccountsReceivable.competenceDate, query.to),
          ),
        )
        .orderBy(
          desc(managementAccountsReceivable.competenceDate),
          desc(managementReceivableLines.id),
        )
        .limit(limit)
        .offset(offset);
      return rows.map((row) => ({
        referenceId: row.id,
        localDate: row.localDate,
        amountCents: row.amountCents,
        occurredAt: null,
        referenceType: "receivable_line",
        label: "CMV",
        quantity: 1,
      }));
    }
    const closedDate = sql<string>`timezone(${timezone}, ${posTabs.closedAt})::date`;
    const rows = await this.database.db
      .select({
        id: posTabs.id,
        occurredAt: posTabs.closedAt,
        localDate: closedDate.mapWith(String),
        amountCents: posTabs.totalCents,
      })
      .from(posTabs)
      .where(
        and(
          eq(posTabs.organizationId, organizationId),
          eq(posTabs.unitId, unitId),
          eq(posTabs.status, "closed"),
          gte(closedDate, query.from),
          lte(closedDate, query.to),
        ),
      )
      .orderBy(desc(posTabs.closedAt), desc(posTabs.id))
      .limit(limit)
      .offset(offset);
    return rows.map((row) => ({
      referenceId: row.id,
      localDate: row.localDate,
      amountCents: row.amountCents,
      occurredAt: row.occurredAt?.toISOString() ?? null,
      referenceType: "tab",
      label: "Venda POS",
      quantity: 1,
    }));
  }

  private async drillTotals(
    organizationId: string,
    unitId: string,
    timezone: string,
    query: ReportDrillDownQuery,
  ) {
    if (["exception", "inventory", "purchase", "operation"].includes(query.dimension))
      return this.operationalDrillTotals(organizationId, unitId, timezone, query);
    const total = (row?: { amountCents: number; quantity: number }) => ({
      amountCents: row?.amountCents ?? 0,
      quantity: row?.quantity ?? 0,
    });
    const closedDate = sql<string>`timezone(${timezone}, ${posTabs.closedAt})::date`;
    if (query.dimension === "product" || query.dimension === "category") {
      const [row] = await this.database.db
        .select({
          amountCents: sql<number>`coalesce(sum(${posOrderItems.netCents}), 0)`.mapWith(Number),
          quantity: sql<number>`coalesce(sum(${posOrderItems.quantity}), 0)::int`.mapWith(Number),
        })
        .from(posOrderItems)
        .innerJoin(
          posOrders,
          and(
            eq(posOrders.organizationId, organizationId),
            eq(posOrders.unitId, unitId),
            eq(posOrders.id, posOrderItems.orderId),
          ),
        )
        .innerJoin(
          posTabs,
          and(
            eq(posTabs.organizationId, organizationId),
            eq(posTabs.unitId, unitId),
            eq(posTabs.id, posOrders.tabId),
          ),
        )
        .innerJoin(
          posProducts,
          and(
            eq(posProducts.organizationId, organizationId),
            eq(posProducts.id, posOrderItems.productId),
          ),
        )
        .where(
          and(
            eq(posOrderItems.organizationId, organizationId),
            eq(posOrderItems.unitId, unitId),
            eq(posTabs.status, "closed"),
            ne(posOrderItems.status, "canceled"),
            gte(closedDate, query.from),
            lte(closedDate, query.to),
            query.dimension === "product"
              ? eq(posProducts.id, query.key)
              : eq(posProducts.categoryId, query.key),
          ),
        );
      return total(row);
    }
    if (query.dimension === "channel") {
      const [row] = await this.database.db
        .select({
          amountCents: sql<number>`coalesce(sum(${posTabs.totalCents}), 0)`.mapWith(Number),
          quantity: sql<number>`count(*)::int`.mapWith(Number),
        })
        .from(posTabs)
        .where(
          and(
            eq(posTabs.organizationId, organizationId),
            eq(posTabs.unitId, unitId),
            eq(posTabs.status, "closed"),
            eq(posTabs.fulfillmentType, query.key as "dine_in"),
            gte(closedDate, query.from),
            lte(closedDate, query.to),
          ),
        );
      return total(row);
    }
    if (query.dimension === "payment_method") {
      const reversalDate = sql<string>`timezone(${timezone}, ${posPaymentReversals.resolvedAt})::date`;
      const [[paymentRow], [reversalRow]] = await Promise.all([
        this.database.db
          .select({
            amountCents: sql<number>`coalesce(sum(${posTabPayments.amountCents}), 0)`.mapWith(
              Number,
            ),
            quantity: sql<number>`count(*)::int`.mapWith(Number),
          })
          .from(posTabPayments)
          .innerJoin(
            posTabs,
            and(
              eq(posTabs.organizationId, organizationId),
              eq(posTabs.unitId, unitId),
              eq(posTabs.id, posTabPayments.tabId),
            ),
          )
          .where(
            and(
              eq(posTabPayments.organizationId, organizationId),
              eq(posTabPayments.unitId, unitId),
              eq(posTabs.status, "closed"),
              eq(posTabPayments.method, query.key as "cash"),
              gte(closedDate, query.from),
              lte(closedDate, query.to),
            ),
          ),
        this.database.db
          .select({
            amountCents: sql<number>`coalesce(sum(${posPaymentReversals.amountCents}), 0)`.mapWith(
              Number,
            ),
            quantity: sql<number>`count(*)::int`.mapWith(Number),
          })
          .from(posPaymentReversals)
          .innerJoin(
            posTabPayments,
            and(
              eq(posTabPayments.organizationId, posPaymentReversals.organizationId),
              eq(posTabPayments.unitId, posPaymentReversals.unitId),
              eq(posTabPayments.id, posPaymentReversals.paymentId),
            ),
          )
          .where(
            and(
              eq(posPaymentReversals.organizationId, organizationId),
              eq(posPaymentReversals.unitId, unitId),
              eq(posPaymentReversals.status, "approved"),
              eq(posTabPayments.method, query.key as "cash"),
              gte(reversalDate, query.from),
              lte(reversalDate, query.to),
            ),
          ),
      ]);
      return {
        amountCents: (paymentRow?.amountCents ?? 0) - (reversalRow?.amountCents ?? 0),
        quantity: (paymentRow?.quantity ?? 0) + (reversalRow?.quantity ?? 0),
      };
    }
    if (query.key === "cash_inflows" || query.key === "cash_outflows") {
      const table =
        query.key === "cash_inflows" ? managementReceivablePayments : managementPayablePayments;
      const occurredAt =
        query.key === "cash_inflows"
          ? managementReceivablePayments.receivedAt
          : managementPayablePayments.paidAt;
      const localDate = sql<string>`timezone(${timezone}, ${occurredAt})::date`;
      const [row] = await this.database.db
        .select({
          amountCents: sql<number>`coalesce(sum(${table.amountCents}), 0)`.mapWith(Number),
          quantity: sql<number>`count(*)::int`.mapWith(Number),
        })
        .from(table)
        .where(
          and(
            eq(table.organizationId, organizationId),
            eq(table.unitId, unitId),
            gte(localDate, query.from),
            lte(localDate, query.to),
          ),
        );
      return total(row);
    }
    if (query.key === "competence_revenue" || query.key === "competence_expenses") {
      const table =
        query.key === "competence_revenue"
          ? managementAccountsReceivable
          : managementAccountsPayable;
      const filters = [
        eq(table.organizationId, organizationId),
        eq(table.unitId, unitId),
        gte(table.competenceDate, query.from),
        lte(table.competenceDate, query.to),
      ];
      if (query.key === "competence_expenses")
        filters.push(isNull(managementAccountsPayable.purchaseReceiptId));
      const [row] = await this.database.db
        .select({
          amountCents: sql<number>`coalesce(sum(${table.amountCents}), 0)`.mapWith(Number),
          quantity: sql<number>`count(*)::int`.mapWith(Number),
        })
        .from(table)
        .where(and(...filters));
      return total(row);
    }
    if (query.key === "cmv") {
      const [row] = await this.database.db
        .select({
          amountCents:
            sql<number>`coalesce(sum(${managementReceivableLines.costCents}), 0)`.mapWith(Number),
          quantity: sql<number>`count(*)::int`.mapWith(Number),
        })
        .from(managementReceivableLines)
        .innerJoin(
          managementAccountsReceivable,
          and(
            eq(managementAccountsReceivable.organizationId, organizationId),
            eq(managementAccountsReceivable.unitId, unitId),
            eq(managementAccountsReceivable.id, managementReceivableLines.receivableId),
          ),
        )
        .where(
          and(
            eq(managementReceivableLines.organizationId, organizationId),
            eq(managementReceivableLines.unitId, unitId),
            isNotNull(managementReceivableLines.costCents),
            gte(managementAccountsReceivable.competenceDate, query.from),
            lte(managementAccountsReceivable.competenceDate, query.to),
          ),
        );
      return total(row);
    }
    const [row] = await this.database.db
      .select({
        amountCents: sql<number>`coalesce(sum(${posTabs.totalCents}), 0)`.mapWith(Number),
        quantity: sql<number>`count(*)::int`.mapWith(Number),
      })
      .from(posTabs)
      .where(
        and(
          eq(posTabs.organizationId, organizationId),
          eq(posTabs.unitId, unitId),
          eq(posTabs.status, "closed"),
          gte(closedDate, query.from),
          lte(closedDate, query.to),
        ),
      );
    return total(row);
  }

  async createExport(
    identityId: string,
    organizationId: string,
    unitId: string,
    idempotencyKey: string,
    query: ReportExportInput,
  ) {
    return this.measured("export", async () => {
      const permissions = await this.permissions(identityId, organizationId, unitId);
      this.assertPermission(permissions.export);
      if (query.family === "multiunit") this.assertPermission(permissions.multiunit);
      const normalizedKey = idempotencyKey?.trim();
      if (!normalizedKey || normalizedKey.length < 8 || normalizedKey.length > 160)
        throw new BadRequestException({ code: "IDEMPOTENCY_KEY_REQUIRED" });
      return this.database.db.transaction(async (tx) => {
        await tx.execute(
          sql`select pg_advisory_xact_lock(hashtext(${`management:${organizationId}:${unitId}:report-export:${normalizedKey}`}))`,
        );
        const [existing] = await tx
          .select()
          .from(managementReportExports)
          .where(
            and(
              eq(managementReportExports.organizationId, organizationId),
              eq(managementReportExports.unitId, unitId),
              eq(managementReportExports.idempotencyKey, normalizedKey),
            ),
          )
          .limit(1);
        if (existing) {
          if (
            managementRequestHash("report-export", existing.query) !==
            managementRequestHash("report-export", query)
          )
            throw new ConflictException({ code: "IDEMPOTENCY_PAYLOAD_MISMATCH" });
          return this.exportDto(existing, true);
        }
        const report = await this.reports(identityId, organizationId, unitId, query);
        const rows = this.exportRows(report, query.family);
        const [organization] = await tx
          .select({ organizationName: organizations.tradeName, unitName: units.name })
          .from(organizations)
          .innerJoin(units, and(eq(units.organizationId, organizations.id), eq(units.id, unitId)))
          .where(eq(organizations.id, organizationId))
          .limit(1);
        const [requester] = await tx
          .select({ displayName: identities.displayName })
          .from(identities)
          .where(eq(identities.id, identityId))
          .limit(1);
        const id = randomUUID();
        const now = new Date();
        const artifact = buildReportArtifact(
          query.format,
          rows,
          `Relatório GiroMesa ${query.from} a ${query.to}`,
          {
            subtitle: "Exportação auditada",
            organizationName: organization?.organizationName,
            unitName: organization?.unitName,
            period: report.period,
            timezone: report.timezone,
            generatedAt: report.meta.generatedAt,
            generatedBy: requester?.displayName,
            reference: id,
            classification: "Confidencial — uso interno",
            family: query.family,
            filters: {
              comparação: query.comparisonMode,
              custos_incluídos: report.capabilities.viewCosts,
            },
            warnings:
              report.incomeStatement.costCoverage.coverage === "complete"
                ? []
                : [
                    "A cobertura de custos está incompleta; margens e resultados não devem ser interpretados como definitivos.",
                  ],
          },
        );
        const expiresAt = new Date(now.getTime() + 30 * 86_400_000);
        const [created] = await tx
          .insert(managementReportExports)
          .values({
            id,
            organizationId,
            unitId,
            idempotencyKey: normalizedKey,
            query,
            content: artifact.content,
            contentEncoding: artifact.contentEncoding,
            mimeType: artifact.mimeType,
            status: "ready",
            format: query.format,
            sha256: artifact.sha256,
            rowCount: rows.length,
            requestedByIdentityId: identityId,
            completedAt: now,
            expiresAt,
          })
          .returning();
        if (!created) throw new ConflictException({ code: "REPORT_EXPORT_WRITE_FAILED" });
        await this.record(
          tx,
          identityId,
          organizationId,
          unitId,
          "management.report_export.ready",
          "management_report_export",
          id,
          { format: query.format, sha256: artifact.sha256, rowCount: rows.length },
        );
        return this.exportDto(created, false);
      });
    });
  }

  private exportRows(
    report: Awaited<ReturnType<ManagementReportService["reports"]>>,
    family: ReportExportInput["family"] = "overview",
  ) {
    const rows: Record<string, unknown>[] = [
      {
        section: "metadata",
        key: "period",
        label: "Período",
        value: `${report.period.from}/${report.period.to}`,
      },
      {
        section: "metadata",
        key: "timezone",
        label: "Timezone",
        value: report.timezone,
      },
      {
        section: "metadata",
        key: "generated_at",
        label: "Gerado em",
        value: report.meta.generatedAt,
      },
      {
        section: "metadata",
        key: "data_through",
        label: "Dados até",
        value: report.meta.dataThrough,
      },
      ...Object.entries(report.meta.coverage).map(([key, value]) => ({
        section: "coverage",
        key,
        label: key,
        value,
      })),
      {
        section: "cashFlow",
        key: "cash_inflows",
        label: "Entradas",
        amountCents: report.cashFlow.inflowsCents,
        quantity: "",
      },
      {
        section: "cashFlow",
        key: "net",
        label: "Saldo",
        amountCents: report.cashFlow.netCents,
        quantity: "",
      },
      {
        section: "cashFlow",
        key: "cash_outflows",
        label: "Saídas",
        amountCents: report.cashFlow.outflowsCents,
        quantity: "",
      },
      {
        section: "incomeStatement",
        key: "competence_revenue",
        label: "Receita",
        amountCents: report.incomeStatement.revenueCents,
        quantity: "",
      },
    ];
    if (report.incomeStatement.cmvCents !== null)
      rows.push({
        section: "incomeStatement",
        key: "cmv",
        label: "CMV",
        amountCents: report.incomeStatement.cmvCents,
        quantity: "",
      });
    if (report.incomeStatement.grossMarginCents !== null)
      rows.push({
        section: "incomeStatement",
        key: "gross_margin",
        label: "Margem bruta",
        amountCents: report.incomeStatement.grossMarginCents,
        quantity: "",
      });
    if (report.incomeStatement.operatingExpensesCents !== null)
      rows.push({
        section: "incomeStatement",
        key: "competence_expenses",
        label: "Despesas operacionais",
        amountCents: report.incomeStatement.operatingExpensesCents,
        quantity: "",
      });
    if (report.incomeStatement.operatingResultCents !== null)
      rows.push({
        section: "incomeStatement",
        key: "operating_result",
        label: "Resultado operacional",
        amountCents: report.incomeStatement.operatingResultCents,
        quantity: "",
      });
    const families = report.reportFamilies;
    rows.push(
      {
        section: "sales",
        key: "closed_tabs",
        label: "Contas fechadas",
        value: "",
        quantity: families.sales.closedTabs,
      },
      {
        section: "sales",
        key: "average_ticket",
        label: "Ticket médio",
        amountCents: families.sales.averageTicketCents,
        quantity: "",
      },
      {
        section: "exceptions",
        key: "canceled_items",
        label: "Itens cancelados",
        value: "",
        quantity: families.exceptions.canceledItems,
      },
      {
        section: "exceptions",
        key: "canceled_value",
        label: "Valor cancelado",
        amountCents: families.exceptions.canceledValueCents,
        quantity: "",
      },
      {
        section: "inventory",
        key: "loss_events",
        label: "Eventos de perda",
        value: families.inventory.lossQuantity,
        quantity: families.inventory.lossEvents,
      },
      {
        section: "inventory",
        key: "stockouts",
        label: "Itens em ruptura",
        value: "",
        quantity: families.inventory.stockoutItems,
      },
      {
        section: "purchasing",
        key: "orders",
        label: "Pedidos criados",
        amountCents: families.purchasing.orderedCents,
        quantity: families.purchasing.orderCount,
      },
      {
        section: "purchasing",
        key: "receipts",
        label: "Recebimentos",
        amountCents: families.purchasing.receivedCents,
        quantity: families.purchasing.receiptCount,
      },
      {
        section: "operations",
        key: "table_turnovers",
        label: "Giros de mesa",
        value: "",
        quantity: families.operations.tableTurnovers,
      },
      {
        section: "operations",
        key: "average_service_minutes",
        label: "Tempo médio de atendimento (min)",
        value: families.operations.averageServiceMinutes,
        quantity: "",
      },
      {
        section: "profitability",
        key: "gross_margin_percent",
        label: "Margem bruta (%)",
        value: families.profitability.grossMarginPercent,
        quantity: "",
      },
      {
        section: "labor",
        key: "worked_minutes",
        label: "Minutos trabalhados",
        value: families.labor.workedMinutes,
        amountCents: families.labor.laborCostCents,
        quantity: families.labor.people,
      },
      {
        section: "reconciliation",
        key: "fiscal_difference",
        label: "Diferença fiscal",
        amountCents: families.reconciliation.fiscalDifferenceCents,
        quantity: families.reconciliation.documents.total,
      },
      {
        section: "reconciliation",
        key: "payment_difference",
        label: "Diferença de pagamentos",
        amountCents: families.reconciliation.paymentDifferenceCents,
        quantity: families.reconciliation.external.unmatched,
      },
      {
        section: "forecast",
        key: "revenue_forecast",
        label: `Previsão de receita em ${families.forecast.horizonDays} dias`,
        amountCents: families.forecast.revenue.forecastCents,
        value: families.forecast.confidence,
        quantity: families.forecast.sampleDays,
      },
    );
    for (const reason of families.exceptions.cancellationReasons)
      rows.push({
        section: "cancellationReasons",
        key: reason.label,
        label: reason.label,
        amountCents: reason.amountCents,
        quantity: reason.quantity,
      });
    for (const supplier of families.purchasing.suppliers)
      rows.push({
        section: "suppliers",
        key: supplier.key,
        label: supplier.label,
        amountCents: supplier.orderedCents,
        quantity: supplier.orderCount,
      });
    for (const [section, breakdown] of Object.entries(report.breakdowns))
      for (const row of breakdown)
        rows.push({
          section,
          key: row.key,
          label: row.label,
          amountCents: row.revenueCents,
          quantity: row.quantity,
        });
    for (const row of families.sales.hourly)
      rows.push({
        section: "sales",
        key: `hour_${row.hour}`,
        label: `${String(row.hour).padStart(2, "0")}:00`,
        amountCents: row.revenueCents,
        quantity: row.closedTabs,
      });
    for (const row of families.inventory.analysis)
      rows.push({
        section: "inventory",
        key: row.key,
        label: row.label,
        amountCents: row.consumedValueCents,
        quantity: row.consumedQuantity,
        value: row.abcClass ?? "",
      });
    for (const row of families.purchasing.supplierPerformance)
      rows.push({
        section: "purchasing",
        key: row.key,
        label: row.label,
        quantity: row.receiptCount,
        value: row.onTimeRatePercent,
      });
    for (const row of families.operations.shifts)
      rows.push({
        section: "operations",
        key: row.key,
        label: row.label,
        amountCents: row.revenueCents,
        quantity: row.closedTabs,
        value: row.averageServiceMinutes,
      });
    for (const row of families.profitability.products)
      rows.push({
        section: "profitability",
        key: row.key,
        label: row.label,
        amountCents: row.grossMarginCents,
        quantity: row.quantity,
        value: row.grossMarginPercent,
      });
    for (const row of families.multiunit.units)
      rows.push({
        section: "multiunit",
        key: row.key,
        label: row.label,
        amountCents: row.revenueCents,
        quantity: row.closedTabs,
        value: row.changePercent,
      });
    for (const issue of families.quality.issues)
      rows.push({
        section: "quality",
        key: issue.key,
        label: issue.label,
        quantity: issue.count,
        value: issue.severity,
      });
    for (const role of families.labor.roles)
      rows.push({
        section: "labor",
        key: role.roleLabel,
        label: role.roleLabel,
        amountCents: role.laborCostCents,
        quantity: role.people,
        value: role.workedMinutes,
      });
    for (const item of families.forecast.purchases)
      rows.push({
        section: "forecast",
        key: item.key,
        label: item.label,
        quantity: item.suggestedQuantity,
        value: item.dailyDemand,
      });
    if (family === "overview") return rows;
    const sectionAliases: Record<ReportExportInput["family"], Set<string>> = {
      overview: new Set(),
      sales: new Set(["sales", "products", "categories", "channels", "paymentMethods"]),
      exceptions: new Set(["exceptions", "cancellationReasons"]),
      inventory: new Set(["inventory"]),
      purchasing: new Set(["purchasing", "suppliers"]),
      operations: new Set(["operations"]),
      profitability: new Set(["profitability", "incomeStatement"]),
      multiunit: new Set(["multiunit"]),
      quality: new Set(["quality", "coverage"]),
      labor: new Set(["labor"]),
      reconciliation: new Set(["reconciliation"]),
      forecast: new Set(["forecast"]),
    };
    return rows.filter(
      (row) =>
        row.section === "metadata" ||
        row.section === "coverage" ||
        sectionAliases[family].has(String(row.section)),
    );
  }

  private exportFilename(row: typeof managementReportExports.$inferSelect) {
    const query = row.query as Partial<ReportExportInput>;
    return `relatorio-${String(query.from ?? "periodo")}-${String(query.to ?? "exportado")}.${row.format}`;
  }

  private exportDto(row: typeof managementReportExports.$inferSelect, idempotentReplay = false) {
    return {
      id: row.id,
      status: row.status,
      format: row.format,
      filename: this.exportFilename(row),
      sha256: row.sha256,
      rowCount: row.rowCount,
      requestedAt: row.requestedAt,
      completedAt: row.completedAt,
      expiresAt: row.expiresAt,
      idempotentReplay,
    };
  }

  async exports(
    identityId: string,
    organizationId: string,
    unitId: string,
    query: ReportExportListQuery,
  ) {
    const permissions = await this.permissions(identityId, organizationId, unitId);
    this.assertPermission(permissions.export);
    const offset = reportPageOffset(query.cursor);
    const rows = await this.database.db
      .select()
      .from(managementReportExports)
      .where(
        and(
          eq(managementReportExports.organizationId, organizationId),
          eq(managementReportExports.unitId, unitId),
        ),
      )
      .orderBy(desc(managementReportExports.requestedAt), desc(managementReportExports.id))
      .limit(query.limit + 1)
      .offset(offset);
    const pageRows = rows.slice(0, query.limit);
    return {
      exports: pageRows.map((row) => this.exportDto(row)),
      page: { nextCursor: reportNextCursor(offset, pageRows.length, rows.length > query.limit) },
    };
  }

  async exportContent(
    identityId: string,
    organizationId: string,
    unitId: string,
    exportId: string,
  ) {
    const permissions = await this.permissions(identityId, organizationId, unitId);
    this.assertPermission(permissions.export);
    const [row] = await this.database.db
      .select()
      .from(managementReportExports)
      .where(
        and(
          eq(managementReportExports.organizationId, organizationId),
          eq(managementReportExports.unitId, unitId),
          eq(managementReportExports.id, exportId),
        ),
      )
      .limit(1);
    if (!row || row.expiresAt < new Date())
      throw new NotFoundException({ code: "REPORT_EXPORT_NOT_FOUND" });
    if (row.status !== "ready" || !row.content || !row.sha256)
      throw new ConflictException({ code: "REPORT_EXPORT_NOT_READY" });
    await this.database.db.insert(auditEvents).values({
      organizationId,
      unitId,
      actorIdentityId: identityId,
      action: "management.report_export.downloaded",
      entityType: "management_report_export",
      entityId: exportId,
      metadata: { sha256: row.sha256 },
    });
    return {
      filename: this.exportFilename(row),
      content: row.content,
      contentEncoding: row.contentEncoding,
      mimeType: row.mimeType,
      sha256: row.sha256,
    };
  }

  private viewDto(row: typeof managementReportViews.$inferSelect) {
    return {
      id: row.id,
      name: row.name,
      visibility: row.visibility,
      query: row.query,
      isDefault: row.query.isDefault === true,
      sortOrder: Number.isInteger(row.query.sortOrder) ? Number(row.query.sortOrder) : 0,
      ownerIdentityId: row.ownerIdentityId,
      version: row.version,
      updatedAt: row.updatedAt,
    };
  }

  async views(identityId: string, organizationId: string, unitId: string) {
    await this.permissions(identityId, organizationId, unitId);
    const rows = await this.database.db
      .select()
      .from(managementReportViews)
      .where(
        and(
          eq(managementReportViews.organizationId, organizationId),
          or(
            eq(managementReportViews.visibility, "organization"),
            and(
              eq(managementReportViews.unitId, unitId),
              or(
                eq(managementReportViews.visibility, "unit"),
                eq(managementReportViews.ownerIdentityId, identityId),
              ),
            ),
          ),
        ),
      )
      .orderBy(desc(managementReportViews.updatedAt));
    return {
      views: rows
        .map((row) => this.viewDto(row))
        .sort(
          (left, right) => left.sortOrder - right.sortOrder || left.name.localeCompare(right.name),
        ),
    };
  }

  async createView(
    identityId: string,
    organizationId: string,
    unitId: string,
    idempotencyKey: string,
    input: ReportViewCreateInput,
  ) {
    const permissions = await this.permissions(identityId, organizationId, unitId);
    if (input.visibility !== "private") this.assertPermission(permissions.manageViews);
    return this.idempotent(
      identityId,
      organizationId,
      unitId,
      idempotencyKey,
      "report-view-create",
      input,
      async (tx) => {
        const id = randomUUID();
        if (input.isDefault) {
          await tx
            .update(managementReportViews)
            .set({
              query: sql`jsonb_set(${managementReportViews.query}, '{isDefault}', 'false'::jsonb, true)`,
              updatedAt: new Date(),
            })
            .where(
              and(
                eq(managementReportViews.organizationId, organizationId),
                eq(managementReportViews.unitId, unitId),
                eq(managementReportViews.ownerIdentityId, identityId),
              ),
            );
        }
        const [row] = await tx
          .insert(managementReportViews)
          .values({
            id,
            organizationId,
            unitId,
            ownerIdentityId: identityId,
            name: input.name,
            visibility: input.visibility,
            query: {
              ...input.query,
              isDefault: input.isDefault ?? false,
              sortOrder: input.sortOrder ?? 0,
            },
          })
          .returning();
        if (!row) throw new ConflictException({ code: "REPORT_VIEW_WRITE_FAILED" });
        await this.record(
          tx,
          identityId,
          organizationId,
          unitId,
          "management.report_view.created",
          "management_report_view",
          id,
          {
            visibility: row.visibility,
            family: row.query.family,
            isDefault: row.query.isDefault === true,
            sortOrder: row.query.sortOrder ?? 0,
          },
        );
        return this.viewDto(row);
      },
    );
  }

  async updateView(
    identityId: string,
    organizationId: string,
    unitId: string,
    viewId: string,
    idempotencyKey: string,
    input: ReportViewUpdateInput,
  ) {
    const permissions = await this.permissions(identityId, organizationId, unitId);
    if (input.visibility !== "private") this.assertPermission(permissions.manageViews);
    return this.idempotent(
      identityId,
      organizationId,
      unitId,
      idempotencyKey,
      "report-view-update",
      { viewId, ...input },
      async (tx) => {
        const [existing] = await tx
          .select()
          .from(managementReportViews)
          .where(
            and(
              eq(managementReportViews.organizationId, organizationId),
              eq(managementReportViews.id, viewId),
            ),
          )
          .limit(1);
        if (!existing) throw new NotFoundException({ code: "REPORT_VIEW_NOT_FOUND" });
        if (existing.ownerIdentityId !== identityId) this.assertPermission(permissions.manageViews);
        if (existing.version !== input.version)
          throw new ConflictException({ code: "REPORT_VIEW_VERSION_CONFLICT" });
        if (input.isDefault) {
          await tx
            .update(managementReportViews)
            .set({
              query: sql`jsonb_set(${managementReportViews.query}, '{isDefault}', 'false'::jsonb, true)`,
              updatedAt: new Date(),
            })
            .where(
              and(
                eq(managementReportViews.organizationId, organizationId),
                eq(managementReportViews.unitId, unitId),
                eq(managementReportViews.ownerIdentityId, existing.ownerIdentityId),
                ne(managementReportViews.id, viewId),
              ),
            );
        }
        const [row] = await tx
          .update(managementReportViews)
          .set({
            name: input.name,
            visibility: input.visibility,
            query: {
              ...input.query,
              isDefault: input.isDefault ?? existing.query.isDefault ?? false,
              sortOrder: input.sortOrder ?? existing.query.sortOrder ?? 0,
            },
            version: input.version + 1,
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(managementReportViews.id, viewId),
              eq(managementReportViews.version, input.version),
            ),
          )
          .returning();
        if (!row) throw new ConflictException({ code: "REPORT_VIEW_VERSION_CONFLICT" });
        await this.record(
          tx,
          identityId,
          organizationId,
          unitId,
          "management.report_view.updated",
          "management_report_view",
          viewId,
          {
            visibility: row.visibility,
            version: row.version,
            isDefault: row.query.isDefault === true,
            sortOrder: row.query.sortOrder ?? 0,
          },
        );
        return this.viewDto(row);
      },
    );
  }

  async deleteView(
    identityId: string,
    organizationId: string,
    unitId: string,
    viewId: string,
    version: number,
    idempotencyKey: string,
  ) {
    const permissions = await this.permissions(identityId, organizationId, unitId);
    return this.idempotent(
      identityId,
      organizationId,
      unitId,
      idempotencyKey,
      "report-view-delete",
      { viewId, version },
      async (tx) => {
        const [existing] = await tx
          .select()
          .from(managementReportViews)
          .where(
            and(
              eq(managementReportViews.organizationId, organizationId),
              eq(managementReportViews.id, viewId),
            ),
          )
          .limit(1);
        if (!existing) throw new NotFoundException({ code: "REPORT_VIEW_NOT_FOUND" });
        if (existing.ownerIdentityId !== identityId) this.assertPermission(permissions.manageViews);
        if (existing.version !== version)
          throw new ConflictException({ code: "REPORT_VIEW_VERSION_CONFLICT" });
        const deleted = await tx
          .delete(managementReportViews)
          .where(
            and(eq(managementReportViews.id, viewId), eq(managementReportViews.version, version)),
          )
          .returning({ id: managementReportViews.id });
        if (deleted.length !== 1)
          throw new ConflictException({ code: "REPORT_VIEW_VERSION_CONFLICT" });
        await this.record(
          tx,
          identityId,
          organizationId,
          unitId,
          "management.report_view.deleted",
          "management_report_view",
          viewId,
          { version },
        );
        return { id: viewId, deleted: true };
      },
    );
  }

  private alertDto(row: typeof managementReportAlerts.$inferSelect) {
    return {
      id: row.id,
      kind: row.kind,
      title: row.title,
      detail: row.detail,
      severity: row.severity,
      status: row.status,
      actualCents: row.actualCents,
      targetCents: row.targetCents,
      source: row.source,
      assignedToIdentityId: row.assignedToIdentityId,
      dueAt: row.dueAt,
      resolvedAt: row.resolvedAt,
      version: row.version,
      updatedAt: row.updatedAt,
    };
  }

  async alerts(
    identityId: string,
    organizationId: string,
    unitId: string,
    query: ReportAlertListQuery,
  ) {
    await this.permissions(identityId, organizationId, unitId);
    const rows = await this.database.db
      .select()
      .from(managementReportAlerts)
      .where(
        and(
          eq(managementReportAlerts.organizationId, organizationId),
          eq(managementReportAlerts.unitId, unitId),
          query.status ? eq(managementReportAlerts.status, query.status) : undefined,
        ),
      )
      .orderBy(managementReportAlerts.dueAt, desc(managementReportAlerts.updatedAt))
      .limit(200);
    const historyRows = rows.length
      ? await this.database.db
          .select({
            action: auditEvents.action,
            actorIdentityId: auditEvents.actorIdentityId,
            entityId: auditEvents.entityId,
            metadata: auditEvents.metadata,
            occurredAt: auditEvents.occurredAt,
          })
          .from(auditEvents)
          .where(
            and(
              eq(auditEvents.organizationId, organizationId),
              eq(auditEvents.unitId, unitId),
              eq(auditEvents.entityType, "management_report_alert"),
              inArray(
                auditEvents.entityId,
                rows.map((row) => row.id),
              ),
            ),
          )
          .orderBy(desc(auditEvents.occurredAt))
      : [];
    return {
      alerts: rows.map((row) => ({
        ...this.alertDto(row),
        history: historyRows
          .filter((event) => event.entityId === row.id)
          .map((event) => ({
            action: event.action,
            actorIdentityId: event.actorIdentityId,
            occurredAt: event.occurredAt,
            status: typeof event.metadata.status === "string" ? event.metadata.status : null,
            comment: typeof event.metadata.comment === "string" ? event.metadata.comment : null,
          })),
      })),
    };
  }

  async evaluateAlerts(
    identityId: string,
    organizationId: string,
    unitId: string,
    idempotencyKey: string,
    input: ReportAlertEvaluateInput,
  ) {
    const permissions = await this.permissions(identityId, organizationId, unitId);
    this.assertPermission(permissions.manageAlerts);
    const report = await this.reports(identityId, organizationId, unitId, input);
    const candidates = [
      ...(report.budget?.alerts ?? [])
        .filter((alert) => alert.status === "attention")
        .map((alert) => ({
          kind: `budget:${alert.key}`,
          title: "Meta fora do esperado",
          detail: `O indicador ${alert.key} está fora da meta definida para o período.`,
          severity: "warning" as const,
          actualCents: alert.actualCents,
          targetCents: alert.targetCents,
          source: { family: "overview", route: "reports" },
        })),
      ...report.reportFamilies.quality.issues.map((issue) => ({
        kind: `quality:${issue.key}`,
        title: issue.label,
        detail: `${issue.count} ocorrência(s) exigem revisão.`,
        severity: issue.severity,
        actualCents: null,
        targetCents: null,
        source: { family: "quality", route: "reports" },
      })),
      ...(report.reportFamilies.reconciliation.fiscalDifferenceCents === 0
        ? []
        : [
            {
              kind: "reconciliation:fiscal",
              title: "Divergência entre vendas e documentos fiscais",
              detail: "Revise documentos autorizados, rejeitados e cancelados do período.",
              severity: "critical" as const,
              actualCents: report.reportFamilies.reconciliation.fiscalAuthorizedCents,
              targetCents: report.reportFamilies.reconciliation.posRevenueCents,
              source: {
                family: "reconciliation",
                dimension: "reconciliation",
                key: "fiscal",
                route: "reports",
              },
            },
          ]),
      ...(report.reportFamilies.reconciliation.paymentDifferenceCents === 0
        ? []
        : [
            {
              kind: "reconciliation:payments",
              title: "Divergência entre vendas e pagamentos",
              detail: "Revise os pagamentos vinculados às contas fechadas.",
              severity: "critical" as const,
              actualCents: report.reportFamilies.reconciliation.paymentCents,
              targetCents: report.reportFamilies.reconciliation.posRevenueCents,
              source: {
                family: "reconciliation",
                dimension: "reconciliation",
                key: "payments",
                route: "reports",
              },
            },
          ]),
      ...(report.reportFamilies.labor.overtimeMinutes &&
      report.reportFamilies.labor.overtimeMinutes > 0
        ? [
            {
              kind: "labor:overtime",
              title: "Horas extras no período",
              detail: `${report.reportFamilies.labor.overtimeMinutes} minuto(s) acima das escalas registradas.`,
              severity: "warning" as const,
              actualCents: null,
              targetCents: null,
              source: {
                family: "labor",
                dimension: "labor",
                key: "overtime",
                route: "reports",
              },
            },
          ]
        : []),
    ];
    return this.idempotent(
      identityId,
      organizationId,
      unitId,
      idempotencyKey,
      "report-alert-evaluate",
      input,
      async (tx) => {
        const dueAt = new Date(Date.now() + input.dueInDays * 86_400_000);
        let created = 0;
        for (const candidate of candidates) {
          const occurrenceKey = `${candidate.kind}:${input.from}:${input.to}`;
          const inserted = await tx
            .insert(managementReportAlerts)
            .values({
              organizationId,
              unitId,
              occurrenceKey,
              ...candidate,
              source: { period: { from: input.from, to: input.to }, ...candidate.source },
              dueAt,
              updatedByIdentityId: identityId,
            })
            .onConflictDoNothing()
            .returning({ id: managementReportAlerts.id });
          created += inserted.length;
          if (inserted[0]) {
            await this.record(
              tx,
              identityId,
              organizationId,
              unitId,
              "management.report_alert.created",
              "management_report_alert",
              inserted[0].id,
              { status: "open", kind: candidate.kind },
            );
          }
        }
        const evaluationId = randomUUID();
        await this.record(
          tx,
          identityId,
          organizationId,
          unitId,
          "management.report_alerts.evaluated",
          "management_report_alert_evaluation",
          evaluationId,
          { period: { from: input.from, to: input.to }, candidates: candidates.length, created },
        );
        return { id: evaluationId, candidates: candidates.length, created };
      },
    );
  }

  async updateAlert(
    identityId: string,
    organizationId: string,
    unitId: string,
    alertId: string,
    idempotencyKey: string,
    input: ReportAlertActionInput,
  ) {
    const permissions = await this.permissions(identityId, organizationId, unitId);
    this.assertPermission(permissions.manageAlerts);
    return this.idempotent(
      identityId,
      organizationId,
      unitId,
      idempotencyKey,
      "report-alert-update",
      { alertId, ...input },
      async (tx) => {
        const now = new Date();
        const [row] = await tx
          .update(managementReportAlerts)
          .set({
            status: input.status,
            assignedToIdentityId:
              input.assignedToIdentityId === undefined
                ? input.status === "claimed"
                  ? identityId
                  : undefined
                : input.assignedToIdentityId,
            dueAt:
              input.dueAt === undefined ? undefined : input.dueAt ? new Date(input.dueAt) : null,
            resolvedAt: input.status === "resolved" ? now : null,
            resolvedByIdentityId: input.status === "resolved" ? identityId : null,
            updatedByIdentityId: identityId,
            version: input.version + 1,
            updatedAt: now,
          })
          .where(
            and(
              eq(managementReportAlerts.organizationId, organizationId),
              eq(managementReportAlerts.unitId, unitId),
              eq(managementReportAlerts.id, alertId),
              eq(managementReportAlerts.version, input.version),
            ),
          )
          .returning();
        if (!row) throw new ConflictException({ code: "REPORT_ALERT_VERSION_CONFLICT" });
        await this.record(
          tx,
          identityId,
          organizationId,
          unitId,
          "management.report_alert.updated",
          "management_report_alert",
          alertId,
          {
            status: row.status,
            assignedToIdentityId: row.assignedToIdentityId,
            dueAt: row.dueAt,
            comment: input.comment,
          },
        );
        return this.alertDto(row);
      },
    );
  }

  async closeReconciliation(
    identityId: string,
    organizationId: string,
    unitId: string,
    idempotencyKey: string,
    input: ReportReconciliationClosureInput,
  ) {
    const permissions = await this.permissions(identityId, organizationId, unitId);
    this.assertPermission(permissions.manageAlerts);
    if (input.status === "closed" && !Object.values(input.checklist).every(Boolean)) {
      throw new BadRequestException({
        code: "REPORT_RECONCILIATION_CHECKLIST_INCOMPLETE",
        message: "Conclua a revisÃ£o fiscal, de pagamentos e da conciliaÃ§Ã£o externa.",
      });
    }
    const entityId = `${unitId}:${input.from}:${input.to}`;
    return this.idempotent(
      identityId,
      organizationId,
      unitId,
      idempotencyKey,
      "report-reconciliation-closure",
      input,
      async (tx) => {
        const action =
          input.status === "closed"
            ? "management.report_reconciliation.closed"
            : "management.report_reconciliation.reopened";
        await this.record(
          tx,
          identityId,
          organizationId,
          unitId,
          action,
          "management_report_reconciliation_closure",
          entityId,
          {
            period: { from: input.from, to: input.to },
            checklist: input.checklist,
            note: input.note,
            evidence: input.evidence,
          },
        );
        return {
          status: input.status,
          closedAt: input.status === "closed" ? new Date().toISOString() : null,
          closedByIdentityId: input.status === "closed" ? identityId : null,
          checklist: input.checklist,
          note: input.note,
          evidence: input.evidence,
        };
      },
    );
  }

  private costBackfillCandidatesQuery(
    organizationId: string,
    unitId: string,
    timezone: string,
    input: Pick<ReportCostPreviewInput, "from" | "to">,
  ) {
    return sql`
      select items.id, items.quantity, prices.cost_cents as "catalogCostCents"
      from pos_order_items items
      inner join pos_orders orders on orders.organization_id = items.organization_id and orders.unit_id = items.unit_id and orders.id = items.order_id
      inner join pos_tabs tabs on tabs.organization_id = orders.organization_id and tabs.unit_id = orders.unit_id and tabs.id = orders.tab_id
      left join pos_product_prices prices on prices.organization_id = items.organization_id and prices.unit_id = items.unit_id and prices.product_id = items.product_id
      where items.organization_id = ${organizationId}::uuid and items.unit_id = ${unitId}::uuid
        and items.status <> 'canceled' and items.cost_cents is null and tabs.status = 'closed'
        and timezone(${timezone}, tabs.closed_at)::date between ${input.from}::date and ${input.to}::date
      order by items.id
    `;
  }

  async previewCosts(
    identityId: string,
    organizationId: string,
    unitId: string,
    input: ReportCostPreviewInput,
  ) {
    const permissions = await this.permissions(identityId, organizationId, unitId);
    this.assertPermission(permissions.viewCosts && permissions.backfillCosts);
    const [unit] = await this.database.db
      .select({ timezone: units.timezone })
      .from(units)
      .where(and(eq(units.organizationId, organizationId), eq(units.id, unitId)))
      .limit(1);
    if (!unit) throw new NotFoundException({ code: "UNIT_NOT_FOUND" });
    const candidates = await this.database.db.execute<{
      id: string;
      quantity: number;
      catalogCostCents: number | null;
    }>(this.costBackfillCandidatesQuery(organizationId, unitId, unit.timezone, input));
    let estimatedCount = 0;
    let estimatedTotalCents = 0;
    for (const candidate of candidates) {
      const estimated =
        candidate.catalogCostCents === null
          ? null
          : Number(candidate.catalogCostCents) * Number(candidate.quantity);
      if (
        estimated === null ||
        !Number.isSafeInteger(estimated) ||
        estimated < 0 ||
        estimated > 2_147_483_647
      )
        continue;
      estimatedCount += 1;
      estimatedTotalCents += estimated;
    }
    const candidateCount = candidates.length;
    return {
      candidateCount,
      estimatedCount,
      unavailableCount: candidateCount - estimatedCount,
      estimatedTotalCents,
      coverageBefore: candidateCount > 0 ? 0 : 100,
      coverageAfter:
        candidateCount === 0 ? 100 : Number(((estimatedCount / candidateCount) * 100).toFixed(1)),
      source: "catalog_current_cost" as const,
    };
  }

  async backfillCosts(
    identityId: string,
    organizationId: string,
    unitId: string,
    idempotencyKey: string,
    input: ReportCostBackfillInput,
  ) {
    const permissions = await this.permissions(identityId, organizationId, unitId);
    this.assertPermission(permissions.viewCosts && permissions.backfillCosts);
    return this.idempotent(
      identityId,
      organizationId,
      unitId,
      idempotencyKey,
      "report-cost-backfill",
      input,
      async (tx) => {
        const [unit] = await tx
          .select({ timezone: units.timezone })
          .from(units)
          .where(and(eq(units.organizationId, organizationId), eq(units.id, unitId)))
          .limit(1);
        if (!unit) throw new NotFoundException({ code: "UNIT_NOT_FOUND" });
        const candidates = await tx.execute<{
          id: string;
          quantity: number;
          catalogCostCents: number | null;
        }>(this.costBackfillCandidatesQuery(organizationId, unitId, unit.timezone, input));
        const [run] = await tx
          .insert(managementReportCostBackfills)
          .values({
            organizationId,
            unitId,
            from: input.from,
            to: input.to,
            allowEstimated: input.allowEstimated,
            requestedByIdentityId: identityId,
          })
          .returning();
        if (!run) throw new ConflictException({ code: "REPORT_COST_BACKFILL_WRITE_FAILED" });
        let estimatedCount = 0;
        let unavailableCount = 0;
        for (const candidate of candidates) {
          const estimated =
            candidate.catalogCostCents === null
              ? null
              : Number(candidate.catalogCostCents) * Number(candidate.quantity);
          if (
            !input.allowEstimated ||
            estimated === null ||
            !Number.isSafeInteger(estimated) ||
            estimated < 0 ||
            estimated > 2_147_483_647
          ) {
            unavailableCount += 1;
            continue;
          }
          const updated = await tx.execute<{ id: string }>(sql`
            update pos_order_items set cost_cents = ${estimated}, updated_at = now()
            where organization_id = ${organizationId}::uuid and unit_id = ${unitId}::uuid
              and id = ${candidate.id}::uuid and cost_cents is null returning id
          `);
          if (updated.length !== 1) continue;
          await tx.insert(managementReportCostSnapshots).values({
            organizationId,
            unitId,
            orderItemId: candidate.id,
            backfillId: run.id,
            costCents: estimated,
            source: "catalog_cost_estimate",
            confidence: "estimated",
            recordedByIdentityId: identityId,
          });
          estimatedCount += 1;
        }
        unavailableCount += candidates.length - estimatedCount - unavailableCount;
        await tx
          .update(managementReportCostBackfills)
          .set({ estimatedCount, unavailableCount, completedAt: new Date() })
          .where(eq(managementReportCostBackfills.id, run.id));
        await this.record(
          tx,
          identityId,
          organizationId,
          unitId,
          "management.report_cost_backfill.completed",
          "management_report_cost_backfill",
          run.id,
          {
            period: { from: input.from, to: input.to },
            allowEstimated: input.allowEstimated,
            exactCount: 0,
            estimatedCount,
            unavailableCount,
          },
        );
        return {
          id: run.id,
          exactCount: 0,
          estimatedCount,
          unavailableCount,
          confidence: estimatedCount > 0 ? ("estimated" as const) : ("unavailable" as const),
        };
      },
    );
  }

  private scheduleDto(row: typeof managementReportSchedules.$inferSelect) {
    return {
      id: row.id,
      name: row.name,
      frequency: row.frequency,
      weekday: row.weekday,
      dayOfMonth: row.dayOfMonth,
      localTime: row.localTime.slice(0, 5),
      range: row.range,
      comparisonMode: row.comparisonMode,
      family: row.family,
      format: row.format,
      delivery: row.delivery,
      enabled: row.enabled,
      nextRunAt: row.nextRunAt,
      lastRunAt: row.lastRunAt,
      version: row.version,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }

  async schedules(identityId: string, organizationId: string, unitId: string) {
    const permissions = await this.permissions(identityId, organizationId, unitId);
    this.assertPermission(permissions.manageSchedules);
    const rows = await this.database.db
      .select()
      .from(managementReportSchedules)
      .where(
        and(
          eq(managementReportSchedules.organizationId, organizationId),
          eq(managementReportSchedules.unitId, unitId),
        ),
      )
      .orderBy(desc(managementReportSchedules.createdAt));
    return {
      schedules: rows.map((row) => this.scheduleDto(row)),
      emailDeliveryConfigured: reportEmailDeliveryConfigured(),
    };
  }

  private validateDelivery(input: { delivery: "in_app" | "email"; enabled: boolean }) {
    if (input.enabled && input.delivery === "email" && !reportEmailDeliveryConfigured())
      throw new ConflictException({
        code: "REPORT_EMAIL_DELIVERY_NOT_CONFIGURED",
        message: "A entrega por e-mail não está configurada e homologada.",
      });
  }

  private async unitTimezone(organizationId: string, unitId: string) {
    const [unit] = await this.database.db
      .select({ timezone: units.timezone })
      .from(units)
      .where(and(eq(units.organizationId, organizationId), eq(units.id, unitId)))
      .limit(1);
    if (!unit) throw new NotFoundException({ code: "UNIT_NOT_FOUND" });
    return unit.timezone;
  }

  async createSchedule(
    identityId: string,
    organizationId: string,
    unitId: string,
    idempotencyKey: string,
    input: ReportScheduleCreateInput,
  ) {
    const permissions = await this.permissions(identityId, organizationId, unitId);
    this.assertPermission(permissions.manageSchedules);
    if (input.family === "multiunit") this.assertPermission(permissions.multiunit);
    this.validateDelivery(input);
    const timezone = await this.unitTimezone(organizationId, unitId);
    return this.idempotent(
      identityId,
      organizationId,
      unitId,
      idempotencyKey,
      "report-schedule-create",
      input,
      async (tx) => {
        const id = randomUUID();
        const [row] = await tx
          .insert(managementReportSchedules)
          .values({
            id,
            organizationId,
            unitId,
            ...input,
            weekday: input.frequency === "weekly" ? input.weekday : null,
            dayOfMonth: input.frequency === "monthly" ? input.dayOfMonth : null,
            recipientIdentityId: identityId,
            nextRunAt: nextReportRun(input, timezone),
            createdByIdentityId: identityId,
            updatedByIdentityId: identityId,
          })
          .returning();
        if (!row) throw new ConflictException({ code: "REPORT_SCHEDULE_WRITE_FAILED" });
        await this.record(
          tx,
          identityId,
          organizationId,
          unitId,
          "management.report_schedule.created",
          "management_report_schedule",
          id,
          {
            frequency: input.frequency,
            format: input.format,
            delivery: input.delivery,
            enabled: input.enabled,
          },
        );
        return this.scheduleDto(row);
      },
    );
  }

  async updateSchedule(
    identityId: string,
    organizationId: string,
    unitId: string,
    scheduleId: string,
    idempotencyKey: string,
    input: ReportScheduleUpdateInput,
  ) {
    const permissions = await this.permissions(identityId, organizationId, unitId);
    this.assertPermission(permissions.manageSchedules);
    this.validateDelivery(input);
    const timezone = await this.unitTimezone(organizationId, unitId);
    return this.idempotent(
      identityId,
      organizationId,
      unitId,
      idempotencyKey,
      "report-schedule-update",
      { scheduleId, ...input },
      async (tx) => {
        const [existing] = await tx
          .select()
          .from(managementReportSchedules)
          .where(
            and(
              eq(managementReportSchedules.organizationId, organizationId),
              eq(managementReportSchedules.unitId, unitId),
              eq(managementReportSchedules.id, scheduleId),
            ),
          )
          .limit(1);
        if (!existing) throw new NotFoundException({ code: "REPORT_SCHEDULE_NOT_FOUND" });
        if (existing.version !== input.version)
          throw new ConflictException({ code: "REPORT_SCHEDULE_VERSION_CONFLICT" });
        const [row] = await tx
          .update(managementReportSchedules)
          .set({
            ...input,
            weekday: input.frequency === "weekly" ? input.weekday : null,
            dayOfMonth: input.frequency === "monthly" ? input.dayOfMonth : null,
            recipientIdentityId: existing.recipientIdentityId ?? identityId,
            nextRunAt: nextReportRun(input, timezone),
            version: existing.version + 1,
            updatedByIdentityId: identityId,
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(managementReportSchedules.id, scheduleId),
              eq(managementReportSchedules.version, input.version),
            ),
          )
          .returning();
        if (!row) throw new ConflictException({ code: "REPORT_SCHEDULE_VERSION_CONFLICT" });
        await this.record(
          tx,
          identityId,
          organizationId,
          unitId,
          "management.report_schedule.updated",
          "management_report_schedule",
          scheduleId,
          {
            frequency: input.frequency,
            format: input.format,
            delivery: input.delivery,
            enabled: input.enabled,
            version: row.version,
          },
        );
        return this.scheduleDto(row);
      },
    );
  }

  async deleteSchedule(
    identityId: string,
    organizationId: string,
    unitId: string,
    scheduleId: string,
    version: number | undefined,
    idempotencyKey: string,
  ) {
    const permissions = await this.permissions(identityId, organizationId, unitId);
    this.assertPermission(permissions.manageSchedules);
    return this.idempotent(
      identityId,
      organizationId,
      unitId,
      idempotencyKey,
      "report-schedule-delete",
      { scheduleId, version },
      async (tx) => {
        const [existing] = await tx
          .select({ version: managementReportSchedules.version })
          .from(managementReportSchedules)
          .where(
            and(
              eq(managementReportSchedules.organizationId, organizationId),
              eq(managementReportSchedules.unitId, unitId),
              eq(managementReportSchedules.id, scheduleId),
            ),
          )
          .limit(1);
        if (!existing) throw new NotFoundException({ code: "REPORT_SCHEDULE_NOT_FOUND" });
        if (version !== undefined && version !== existing.version)
          throw new ConflictException({ code: "REPORT_SCHEDULE_VERSION_CONFLICT" });
        const expectedVersion = version ?? existing.version;
        const [row] = await tx
          .update(managementReportSchedules)
          .set({
            enabled: false,
            version: expectedVersion + 1,
            updatedByIdentityId: identityId,
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(managementReportSchedules.organizationId, organizationId),
              eq(managementReportSchedules.unitId, unitId),
              eq(managementReportSchedules.id, scheduleId),
              eq(managementReportSchedules.version, expectedVersion),
            ),
          )
          .returning();
        if (!row) throw new ConflictException({ code: "REPORT_SCHEDULE_VERSION_CONFLICT" });
        await this.record(
          tx,
          identityId,
          organizationId,
          unitId,
          "management.report_schedule.deleted",
          "management_report_schedule",
          scheduleId,
          { version: expectedVersion },
        );
        return { id: scheduleId, deleted: true };
      },
    );
  }
}
