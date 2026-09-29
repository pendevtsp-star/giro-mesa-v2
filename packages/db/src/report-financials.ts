import { type SQL, sql } from "drizzle-orm";
import type { Database } from "./index.js";

export type ReportFinancialMetric =
  | "cash_inflows"
  | "cash_outflows"
  | "competence_revenue"
  | "competence_expenses";

export interface ReportFinancialScope {
  organizationId: string;
  unitId: string;
  timezone: string;
  from: string;
  to: string;
}

/**
 * POS and manually entered finance records are independent persisted events.
 * cash_entries mirrors both and must never be added again. source_order_id is
 * an optional reference, not proof of a duplicated sale (deposits also use it).
 * A manually duplicated sale cannot be reconciled without an explicit link.
 */
export function reportFinancialRowsQuery(
  scope: ReportFinancialScope,
  metric: ReportFinancialMetric,
): SQL {
  const { organizationId: org, unitId: unit, timezone: zone } = scope;
  let events: SQL;
  if (metric === "cash_inflows") {
    events = sql`
      select id, 'pos_payment'::text as reference_type, created_at as occurred_at,
        timezone(${zone}, created_at)::date as local_date, amount_cents,
        'Recebimento PDV'::text as label
      from pos_tab_payments where organization_id=${org}::uuid and unit_id=${unit}::uuid
      union all
      select id, 'pos_payment_reversal', resolved_at, timezone(${zone}, resolved_at)::date,
        -amount_cents, 'Estorno PDV'
      from pos_payment_reversals where organization_id=${org}::uuid and unit_id=${unit}::uuid
        and status='approved'
      union all
      select id, 'receivable_payment', received_at, timezone(${zone}, received_at)::date,
        amount_cents, 'Entrada realizada'
      from management_receivable_payments where organization_id=${org}::uuid and unit_id=${unit}::uuid
      union all
      select id, 'receivable_payment_reversal', reversed_at, timezone(${zone}, reversed_at)::date,
        -amount_cents, 'Estorno de entrada'
      from management_receivable_payments where organization_id=${org}::uuid and unit_id=${unit}::uuid
        and status='reversed'`;
  } else if (metric === "cash_outflows") {
    events = sql`
      select id, 'payable_payment'::text as reference_type, paid_at as occurred_at,
        timezone(${zone}, paid_at)::date as local_date, amount_cents, 'Saída realizada'::text as label
      from management_payable_payments where organization_id=${org}::uuid and unit_id=${unit}::uuid
      union all
      select id, 'payable_payment_reversal', reversed_at, timezone(${zone}, reversed_at)::date,
        -amount_cents, 'Estorno de saída'
      from management_payable_payments where organization_id=${org}::uuid and unit_id=${unit}::uuid
        and status='reversed'`;
  } else if (metric === "competence_revenue") {
    events = sql`
      select id, 'pos_tab'::text as reference_type, closed_at as occurred_at,
        timezone(${zone}, closed_at)::date as local_date, total_cents as amount_cents,
        'Venda PDV finalizada'::text as label
      from pos_tabs where organization_id=${org}::uuid and unit_id=${unit}::uuid and status='closed'
      union all
      select id, 'receivable', null::timestamptz, competence_date, amount_cents, 'Receita por competência'
      from management_accounts_receivable where organization_id=${org}::uuid and unit_id=${unit}::uuid
        and status<>'canceled'`;
  } else {
    events = sql`
      select id, 'payable'::text as reference_type, null::timestamptz as occurred_at,
        competence_date as local_date, amount_cents, 'Despesa por competência'::text as label
      from management_accounts_payable where organization_id=${org}::uuid and unit_id=${unit}::uuid
        and purchase_receipt_id is null and status<>'canceled'`;
  }
  return sql`select id as "referenceId", reference_type as "referenceType",
    occurred_at as "occurredAt", local_date::text as "localDate",
    amount_cents as "amountCents", label, 1::int as quantity
    from (${events}) financial_events
    where local_date between ${scope.from}::date and ${scope.to}::date`;
}

export async function reportFinancialTotals(
  database: Pick<Database, "execute">,
  scope: ReportFinancialScope,
) {
  const metrics = [
    "cash_inflows",
    "cash_outflows",
    "competence_revenue",
    "competence_expenses",
  ] as const;
  const totals = await Promise.all(
    metrics.map(async (metric) => {
      const [row] = await database.execute<{
        amount: number | string;
        quantity: number;
        dataThrough: string | null;
      }>(sql`
      select coalesce(sum("amountCents"), 0)::bigint as amount, count(*)::int as quantity, max("localDate") as "dataThrough"
      from (${reportFinancialRowsQuery(scope, metric)}) events`);
      return {
        amountCents: Number(row?.amount ?? 0),
        quantity: Number(row?.quantity ?? 0),
        dataThrough: row?.dataThrough ?? null,
      };
    }),
  );
  return Object.fromEntries(metrics.map((metric, index) => [metric, totals[index]])) as Record<
    ReportFinancialMetric,
    { amountCents: number; quantity: number; dataThrough: string | null }
  >;
}

/** One cost coverage row per recognized sale/document, using persisted item costs. */
export function reportRevenueCostRowsQuery(scope: ReportFinancialScope): SQL {
  const { organizationId: org, unitId: unit, timezone: zone, from, to } = scope;
  return sql`
    select tabs.id as "referenceId", 'pos_tab'::text as "referenceType",
      timezone(${zone}, tabs.closed_at)::date::text as "localDate",
      tabs.total_cents as "revenueCents",
      case when count(items.id)>0 and count(items.id) filter (where items.cost_cents is null)=0
        then sum(items.cost_cents)::bigint end as "costCents",
      count(items.id)::int as "sourceCostLineCount"
    from pos_tabs tabs
    left join pos_orders orders on orders.organization_id=tabs.organization_id
      and orders.unit_id=tabs.unit_id and orders.tab_id=tabs.id
    left join pos_order_items items on items.organization_id=orders.organization_id
      and items.unit_id=orders.unit_id and items.order_id=orders.id and items.status<>'canceled'
    where tabs.organization_id=${org}::uuid and tabs.unit_id=${unit}::uuid and tabs.status='closed'
      and timezone(${zone}, tabs.closed_at)::date between ${from}::date and ${to}::date
    group by tabs.id
    union all
    select ar.id, 'receivable', ar.competence_date::text, ar.amount_cents,
      case when count(lines.id)>0 and count(*) filter (where lines.cost_cents is null)=0
        and sum(lines.revenue_cents)=ar.amount_cents then sum(lines.cost_cents)::bigint end,
      count(lines.id)::int
    from management_accounts_receivable ar
    left join management_receivable_lines lines on lines.organization_id=ar.organization_id
      and lines.unit_id=ar.unit_id and lines.receivable_id=ar.id
    where ar.organization_id=${org}::uuid and ar.unit_id=${unit}::uuid and ar.status<>'canceled'
      and ar.competence_date between ${from}::date and ${to}::date
    group by ar.id`;
}

export async function reportRevenueCostRows(
  database: Pick<Database, "execute">,
  scope: ReportFinancialScope,
) {
  const rows = await database.execute<{
    referenceId: string;
    referenceType: string;
    localDate: string;
    revenueCents: number;
    costCents: number | string | null;
    sourceCostLineCount: number;
  }>(reportRevenueCostRowsQuery(scope));
  return rows.map((row) => ({
    ...row,
    revenueCents: Number(row.revenueCents),
    costCents: row.costCents === null ? null : Number(row.costCents),
  }));
}
