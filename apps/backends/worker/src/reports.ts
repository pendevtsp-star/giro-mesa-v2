import { createHash } from "node:crypto";
import {
  auditEvents,
  buildReportArtifact,
  type Database,
  managementReportExports,
  outboxEvents,
  parseReportCsv,
} from "@giromesa/db";
import { hasPermission, SYSTEM_ROLES, type SystemRole } from "@giromesa/domain";
import { sql } from "drizzle-orm";

const REPORT_EXPORT_RETENTION_DAYS = 30;

type ReportFrequency = "weekly" | "monthly";
type ReportRange = "previous_week" | "previous_month";
type ReportFamily =
  | "overview"
  | "sales"
  | "exceptions"
  | "inventory"
  | "purchasing"
  | "operations"
  | "profitability"
  | "multiunit"
  | "quality"
  | "labor"
  | "reconciliation"
  | "forecast";

interface DueReportSchedule extends Record<string, unknown> {
  id: string;
  organization_id: string;
  unit_id: string;
  frequency: ReportFrequency;
  weekday: number | null;
  day_of_month: number | null;
  local_time: string;
  range: ReportRange;
  comparison_mode: string;
  family: ReportFamily;
  format: "csv" | "pdf" | "xlsx";
  delivery: "in_app" | "email";
  recipient_identity_id: string | null;
  scheduled_for: Date | string;
  timezone: string;
}

export interface ReportAggregateRow extends Record<string, unknown> {
  date: string;
  channel: string;
  quantity: number | string;
  subtotal_cents: number | string;
  discount_cents: number | string;
  service_charge_cents: number | string;
  tip_cents: number | string;
  revenue_cents: number | string;
}

export interface ReportBreakdownRow extends Record<string, unknown> {
  key: string;
  label: string;
  quantity: number | string;
  revenue_cents: number | string;
}

export interface ScheduledReportData {
  sales: ReportAggregateRow[];
  cashFlow: { inflowsCents: number; outflowsCents: number; netCents: number };
  incomeStatement: {
    revenueCents: number;
    cmvCents: number | null;
    grossMarginCents: number | null;
    operatingExpensesCents: number;
    operatingResultCents: number | null;
    costCoverage: "unavailable" | "partial" | "complete";
  };
  breakdowns: {
    products: ReportBreakdownRow[];
    categories: ReportBreakdownRow[];
    channels: ReportBreakdownRow[];
    paymentMethods: ReportBreakdownRow[];
  };
  familyRows?: Array<ReportBreakdownRow & { section: ReportFamily }>;
}

interface LocalDateTime {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

const dateKey = (year: number, month: number, day: number) =>
  `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;

function localParts(value: Date, timezone: string): LocalDateTime {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(value);
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((item) => item.type === type)?.value);
  return {
    year: part("year"),
    month: part("month"),
    day: part("day"),
    hour: part("hour"),
    minute: part("minute"),
    second: part("second"),
  };
}

function zonedDateTimeToUtc(local: LocalDateTime, timezone: string) {
  const intended = Date.UTC(
    local.year,
    local.month - 1,
    local.day,
    local.hour,
    local.minute,
    local.second,
  );
  let candidate = new Date(intended);
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const represented = localParts(candidate, timezone);
    const representedUtc = Date.UTC(
      represented.year,
      represented.month - 1,
      represented.day,
      represented.hour,
      represented.minute,
      represented.second,
    );
    candidate = new Date(candidate.getTime() + intended - representedUtc);
  }
  return candidate;
}

function localTimeParts(value: string) {
  const match = /^(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(value);
  if (!match) throw new Error("REPORT_SCHEDULE_LOCAL_TIME_INVALID");
  return { hour: Number(match[1]), minute: Number(match[2]), second: Number(match[3] ?? 0) };
}

function shiftedLocalDate(year: number, month: number, day: number, days: number) {
  const shifted = new Date(Date.UTC(year, month - 1, day + days));
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate(),
  };
}

export function nextReportRun(
  schedule: {
    frequency: ReportFrequency;
    weekday: number | null;
    dayOfMonth: number | null;
    localTime: string;
  },
  scheduledFor: Date,
  timezone: string,
) {
  const current = localParts(scheduledFor, timezone);
  const clock = localTimeParts(schedule.localTime);
  if (schedule.frequency === "weekly") {
    if (schedule.weekday === null || schedule.weekday < 0 || schedule.weekday > 6) {
      throw new Error("REPORT_SCHEDULE_WEEKDAY_INVALID");
    }
    const currentWeekday = new Date(
      Date.UTC(current.year, current.month - 1, current.day),
    ).getUTCDay();
    const days = (schedule.weekday - currentWeekday + 7) % 7 || 7;
    return zonedDateTimeToUtc(
      { ...shiftedLocalDate(current.year, current.month, current.day, days), ...clock },
      timezone,
    );
  }
  if (schedule.dayOfMonth === null || schedule.dayOfMonth < 1 || schedule.dayOfMonth > 28) {
    throw new Error("REPORT_SCHEDULE_DAY_OF_MONTH_INVALID");
  }
  const nextMonth = new Date(Date.UTC(current.year, current.month, 1));
  const year = nextMonth.getUTCFullYear();
  const month = nextMonth.getUTCMonth() + 1;
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return zonedDateTimeToUtc(
    { year, month, day: Math.min(schedule.dayOfMonth, lastDay), ...clock },
    timezone,
  );
}

export function scheduledReportRange(range: ReportRange, scheduledFor: Date, timezone: string) {
  const current = localParts(scheduledFor, timezone);
  if (range === "previous_month") {
    const previousMonth = new Date(Date.UTC(current.year, current.month - 2, 1));
    const year = previousMonth.getUTCFullYear();
    const month = previousMonth.getUTCMonth() + 1;
    return {
      from: dateKey(year, month, 1),
      to: dateKey(year, month, new Date(Date.UTC(year, month, 0)).getUTCDate()),
    };
  }
  const weekday = new Date(Date.UTC(current.year, current.month - 1, current.day)).getUTCDay();
  const daysSinceMonday = (weekday + 6) % 7;
  const previousSunday = shiftedLocalDate(
    current.year,
    current.month,
    current.day,
    -(daysSinceMonday + 1),
  );
  const previousMonday = shiftedLocalDate(
    previousSunday.year,
    previousSunday.month,
    previousSunday.day,
    -6,
  );
  return {
    from: dateKey(previousMonday.year, previousMonday.month, previousMonday.day),
    to: dateKey(previousSunday.year, previousSunday.month, previousSunday.day),
  };
}

export function reportCsvCell(value: string | number | null) {
  if (value === null) return "";
  const text = String(value);
  const safe = /^[\t\r ]*[=+\-@]/.test(text) ? `'${text}` : text;
  return /[;"\r\n]/.test(safe) ? `"${safe.replaceAll('"', '""')}"` : safe;
}

export function buildScheduledReportCsv(
  query: {
    from: string;
    to: string;
    timezone: string;
    includeCosts: boolean;
    family?: ReportFamily;
  },
  report: ScheduledReportData,
) {
  const output: Array<Array<string | number | null>> = [
    [
      "seção",
      "data",
      "chave",
      "rótulo",
      "quantidade",
      "subtotal_centavos",
      "desconto_centavos",
      "serviço_centavos",
      "gorjeta_centavos",
      "receita_centavos",
      "valor_centavos",
      "cobertura",
    ],
    [
      "metadados",
      null,
      "período_inicial",
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      query.from,
      null,
    ],
    ["metadados", null, "período_final", null, null, null, null, null, null, null, query.to, null],
    ["metadados", null, "timezone", null, null, null, null, null, null, null, query.timezone, null],
    [
      "metadados",
      null,
      "familia",
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      query.family ?? "overview",
      null,
    ],
    [
      "metadados",
      null,
      "custos_incluídos",
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      query.includeCosts ? "sim" : "não",
      null,
    ],
    ...report.sales.map((row) => [
      "vendas_diárias",
      row.date,
      row.channel,
      row.channel,
      Number(row.quantity),
      Number(row.subtotal_cents),
      Number(row.discount_cents),
      Number(row.service_charge_cents),
      Number(row.tip_cents),
      Number(row.revenue_cents),
      null,
      null,
    ]),
    [
      "fluxo_caixa",
      null,
      "entradas",
      "Entradas realizadas",
      null,
      null,
      null,
      null,
      null,
      null,
      report.cashFlow.inflowsCents,
      "complete",
    ],
    ...(query.includeCosts
      ? [
          [
            "fluxo_caixa",
            null,
            "saídas",
            "Saídas realizadas",
            null,
            null,
            null,
            null,
            null,
            null,
            report.cashFlow.outflowsCents,
            "complete",
          ],
          [
            "fluxo_caixa",
            null,
            "saldo",
            "Saldo realizado",
            null,
            null,
            null,
            null,
            null,
            null,
            report.cashFlow.netCents,
            "complete",
          ],
        ]
      : []),
    [
      "dre",
      null,
      "receita",
      "Receita por competência",
      null,
      null,
      null,
      null,
      null,
      null,
      report.incomeStatement.revenueCents,
      null,
    ],
    ...(query.includeCosts
      ? [
          [
            "dre",
            null,
            "cmv",
            "CMV",
            null,
            null,
            null,
            null,
            null,
            null,
            report.incomeStatement.cmvCents,
            report.incomeStatement.costCoverage,
          ],
          [
            "dre",
            null,
            "margem_bruta",
            "Margem bruta",
            null,
            null,
            null,
            null,
            null,
            null,
            report.incomeStatement.grossMarginCents,
            report.incomeStatement.costCoverage,
          ],
          [
            "dre",
            null,
            "despesas_operacionais",
            "Despesas operacionais",
            null,
            null,
            null,
            null,
            null,
            null,
            report.incomeStatement.operatingExpensesCents,
            null,
          ],
          [
            "dre",
            null,
            "resultado_operacional",
            "Resultado operacional",
            null,
            null,
            null,
            null,
            null,
            null,
            report.incomeStatement.operatingResultCents,
            report.incomeStatement.costCoverage,
          ],
        ]
      : []),
    ...Object.entries(report.breakdowns).flatMap(([section, rows]) =>
      rows.map((row) => [
        `detalhamento_${section}`,
        null,
        row.key,
        row.label,
        Number(row.quantity),
        null,
        null,
        null,
        null,
        Number(row.revenue_cents),
        null,
        null,
      ]),
    ),
    ...(report.familyRows ?? [])
      .filter(
        (row) =>
          query.includeCosts || !["inventory", "profitability", "labor"].includes(row.section),
      )
      .map((row) => [
        `familia_${row.section}`,
        null,
        row.key,
        row.label,
        Number(row.quantity),
        null,
        null,
        null,
        null,
        Number(row.revenue_cents),
        null,
        null,
      ]),
  ];
  const family = query.family ?? "overview";
  const sections: Record<ReportFamily, Set<string>> = {
    overview: new Set(),
    sales: new Set([
      "vendas_diÃ¡rias",
      "detalhamento_products",
      "detalhamento_categories",
      "detalhamento_channels",
      "detalhamento_paymentMethods",
    ]),
    exceptions: new Set(["familia_exceptions"]),
    inventory: new Set(["familia_inventory"]),
    purchasing: new Set(["familia_purchasing"]),
    operations: new Set(["familia_operations"]),
    profitability: new Set(["dre", "familia_profitability"]),
    multiunit: new Set(["familia_multiunit"]),
    quality: new Set(["familia_quality"]),
    labor: new Set(["familia_labor"]),
    reconciliation: new Set(["familia_reconciliation"]),
    forecast: new Set(["familia_forecast"]),
  };
  const selected =
    family === "overview"
      ? output
      : output.filter((row) => row[0] === "metadados" || sections[family].has(String(row[0])));
  return `\uFEFF${selected.map((row) => row.map(reportCsvCell).join(";")).join("\r\n")}`;
}

export const reportContentSha256 = (content: string) =>
  createHash("sha256").update(content, "utf8").digest("hex");

export async function processDueReportSchedules(
  database: Database,
  options: { now?: Date; limit?: number } = {},
) {
  const now = options.now ?? new Date();
  const nowIso = now.toISOString();
  const limit = Math.min(Math.max(options.limit ?? 10, 1), 100);
  return database.transaction(async (tx) => {
    const due = await tx.execute<DueReportSchedule>(sql`
      select schedules.id,
             schedules.organization_id,
             schedules.unit_id,
             schedules.frequency,
             schedules.weekday,
             schedules.day_of_month,
             schedules.local_time::text,
             schedules.range,
             schedules.comparison_mode,
             schedules.family,
             schedules.format,
             schedules.delivery,
             schedules.recipient_identity_id,
             schedules.next_run_at as scheduled_for,
             units.timezone
      from management_report_schedules as schedules
      inner join units
        on units.organization_id = schedules.organization_id
       and units.id = schedules.unit_id
      where schedules.enabled = true
        and schedules.next_run_at <= ${nowIso}::timestamptz
      order by schedules.next_run_at, schedules.id
      for update of schedules skip locked
      limit ${limit}
    `);
    let created = 0;
    for (const schedule of due) {
      const scheduledFor = new Date(schedule.scheduled_for);
      const period = scheduledReportRange(schedule.range, scheduledFor, schedule.timezone);
      const recipientRoles = schedule.recipient_identity_id
        ? await tx.execute<{ role: string }>(sql`
            select bindings.role::text as role
            from memberships
            inner join role_bindings as bindings on bindings.membership_id = memberships.id
            where memberships.identity_id = ${schedule.recipient_identity_id}
              and memberships.organization_id = ${schedule.organization_id}
              and memberships.status = 'active'
              and (bindings.unit_id is null or bindings.unit_id = ${schedule.unit_id})
          `)
        : [];
      const recipientHas = (permission: "reports:export" | "reports:costs:read") =>
        recipientRoles.some(
          ({ role }) =>
            SYSTEM_ROLES.includes(role as SystemRole) &&
            hasPermission(role as SystemRole, permission),
        );
      const canEmail = schedule.delivery === "email" && recipientHas("reports:export");
      const includeCosts = recipientHas("reports:costs:read");
      const [aggregate, cashRows, incomeRows, products, categories, paymentMethods, familyRows] =
        await Promise.all([
          tx.execute<ReportAggregateRow>(sql`
        select timezone(${schedule.timezone}, closed_at)::date::text as date,
               fulfillment_type::text as channel,
               count(*)::int as quantity,
               coalesce(sum(subtotal_cents), 0)::bigint as subtotal_cents,
               coalesce(sum(discount_cents), 0)::bigint as discount_cents,
               coalesce(sum(service_charge_cents), 0)::bigint as service_charge_cents,
               coalesce(sum(tip_cents), 0)::bigint as tip_cents,
               coalesce(sum(total_cents), 0)::bigint as revenue_cents
        from pos_tabs
        where organization_id = ${schedule.organization_id}
          and unit_id = ${schedule.unit_id}
          and status = 'closed'
          and timezone(${schedule.timezone}, closed_at)::date >= ${period.from}::date
          and timezone(${schedule.timezone}, closed_at)::date <= ${period.to}::date
        group by 1, fulfillment_type
        order by 1, fulfillment_type
      `),
          tx.execute<Record<string, number | string>>(sql`
            select
              (select coalesce(sum(amount_cents), 0)::bigint
                 from management_receivable_payments
                where organization_id = ${schedule.organization_id}
                  and unit_id = ${schedule.unit_id}
                  and timezone(${schedule.timezone}, received_at)::date between ${period.from}::date and ${period.to}::date) as inflows_cents,
              (select coalesce(sum(amount_cents), 0)::bigint
                 from management_payable_payments
                where organization_id = ${schedule.organization_id}
                  and unit_id = ${schedule.unit_id}
                  and timezone(${schedule.timezone}, paid_at)::date between ${period.from}::date and ${period.to}::date) as outflows_cents
          `),
          tx.execute<Record<string, number | string>>(sql`
            with selected_receivables as (
              select id, organization_id, unit_id, amount_cents
              from management_accounts_receivable
              where organization_id = ${schedule.organization_id}
                and unit_id = ${schedule.unit_id}
                and competence_date between ${period.from}::date and ${period.to}::date
            ), line_totals as (
              select count(lines.id)::int as cost_line_count,
                     count(lines.id) filter (where lines.cost_cents is null)::int as missing_cost_lines,
                     coalesce(sum(lines.revenue_cents), 0)::bigint as line_revenue_cents,
                     coalesce(sum(lines.cost_cents), 0)::bigint as cmv_cents
              from selected_receivables as receivables
              inner join management_receivable_lines as lines
                on lines.organization_id = receivables.organization_id
               and lines.unit_id = receivables.unit_id
               and lines.receivable_id = receivables.id
            )
            select
              (select coalesce(sum(amount_cents), 0)::bigint from selected_receivables) as revenue_cents,
              (select coalesce(sum(payables.amount_cents), 0)::bigint
                 from management_accounts_payable as payables
                where payables.organization_id = ${schedule.organization_id}
                  and payables.unit_id = ${schedule.unit_id}
                  and payables.purchase_receipt_id is null
                  and payables.competence_date between ${period.from}::date and ${period.to}::date) as expenses_cents,
              line_totals.cost_line_count,
              line_totals.missing_cost_lines,
              line_totals.line_revenue_cents,
              line_totals.cmv_cents
            from line_totals
          `),
          tx.execute<ReportBreakdownRow>(sql`
            select products.id::text as key, products.name as label,
                   coalesce(sum(items.quantity), 0)::int as quantity,
                   coalesce(sum(items.net_cents), 0)::bigint as revenue_cents
            from pos_order_items as items
            inner join pos_orders as orders
              on orders.organization_id = items.organization_id and orders.unit_id = items.unit_id and orders.id = items.order_id
            inner join pos_tabs as tabs
              on tabs.organization_id = orders.organization_id and tabs.unit_id = orders.unit_id and tabs.id = orders.tab_id
            inner join pos_products as products
              on products.organization_id = items.organization_id and products.id = items.product_id
            where items.organization_id = ${schedule.organization_id} and items.unit_id = ${schedule.unit_id}
              and tabs.status = 'closed' and items.status <> 'canceled'
              and timezone(${schedule.timezone}, tabs.closed_at)::date between ${period.from}::date and ${period.to}::date
            group by products.id, products.name order by sum(items.net_cents) desc, products.name
          `),
          tx.execute<ReportBreakdownRow>(sql`
            select categories.id::text as key, categories.name as label,
                   coalesce(sum(items.quantity), 0)::int as quantity,
                   coalesce(sum(items.net_cents), 0)::bigint as revenue_cents
            from pos_order_items as items
            inner join pos_orders as orders
              on orders.organization_id = items.organization_id and orders.unit_id = items.unit_id and orders.id = items.order_id
            inner join pos_tabs as tabs
              on tabs.organization_id = orders.organization_id and tabs.unit_id = orders.unit_id and tabs.id = orders.tab_id
            inner join pos_products as products
              on products.organization_id = items.organization_id and products.id = items.product_id
            inner join pos_catalog_categories as categories
              on categories.organization_id = products.organization_id and categories.id = products.category_id
            where items.organization_id = ${schedule.organization_id} and items.unit_id = ${schedule.unit_id}
              and tabs.status = 'closed' and items.status <> 'canceled'
              and timezone(${schedule.timezone}, tabs.closed_at)::date between ${period.from}::date and ${period.to}::date
            group by categories.id, categories.name order by sum(items.net_cents) desc, categories.name
          `),
          tx.execute<ReportBreakdownRow>(sql`
            select payments.method::text as key, payments.method::text as label,
                   count(*)::int as quantity, coalesce(sum(payments.amount_cents), 0)::bigint as revenue_cents
            from pos_tab_payments as payments
            inner join pos_tabs as tabs
              on tabs.organization_id = payments.organization_id and tabs.unit_id = payments.unit_id and tabs.id = payments.tab_id
            where payments.organization_id = ${schedule.organization_id} and payments.unit_id = ${schedule.unit_id}
              and tabs.status = 'closed'
              and timezone(${schedule.timezone}, tabs.closed_at)::date between ${period.from}::date and ${period.to}::date
            group by payments.method order by payments.method
          `),
          tx.execute<ReportBreakdownRow & { section: ReportFamily }>(sql`
            select 'exceptions'::text as section, 'canceled_items'::text as key,
                   'Itens cancelados'::text as label,
                   coalesce(sum(items.quantity) filter (where items.status = 'canceled'), 0)::int as quantity,
                   coalesce(sum(items.net_cents) filter (where items.status = 'canceled'), 0)::bigint as revenue_cents
            from pos_order_items items
            inner join pos_orders orders on orders.organization_id = items.organization_id and orders.unit_id = items.unit_id and orders.id = items.order_id
            inner join pos_tabs tabs on tabs.organization_id = orders.organization_id and tabs.unit_id = orders.unit_id and tabs.id = orders.tab_id
            where items.organization_id = ${schedule.organization_id} and items.unit_id = ${schedule.unit_id} and tabs.status = 'closed'
              and timezone(${schedule.timezone}, tabs.closed_at)::date between ${period.from}::date and ${period.to}::date
            union all
            select 'inventory', 'losses', 'Perdas de estoque', count(*)::int,
                   coalesce(round(sum(abs(quantity_delta::numeric) * unit_cost_cents)), 0)::bigint
            from management_inventory_movements where organization_id = ${schedule.organization_id} and unit_id = ${schedule.unit_id} and type = 'loss'
              and timezone(${schedule.timezone}, occurred_at)::date between ${period.from}::date and ${period.to}::date
            union all
            select 'purchasing', 'orders', 'Pedidos de compra', count(*)::int, coalesce(sum(total_cents), 0)::bigint
            from management_purchase_orders where organization_id = ${schedule.organization_id} and unit_id = ${schedule.unit_id}
              and timezone(${schedule.timezone}, created_at)::date between ${period.from}::date and ${period.to}::date
            union all
            select 'operations', 'closed_tabs', 'Contas fechadas', count(*)::int, coalesce(sum(total_cents), 0)::bigint
            from pos_tabs where organization_id = ${schedule.organization_id} and unit_id = ${schedule.unit_id} and status = 'closed'
              and timezone(${schedule.timezone}, closed_at)::date between ${period.from}::date and ${period.to}::date
            union all
            select 'profitability', products.id::text, products.name, coalesce(sum(items.quantity), 0)::int,
                   case when count(*) filter (where items.cost_cents is null) = 0 then coalesce(sum(items.net_cents - items.cost_cents), 0)::bigint else 0 end
            from pos_order_items items
            inner join pos_orders orders on orders.organization_id = items.organization_id and orders.unit_id = items.unit_id and orders.id = items.order_id
            inner join pos_tabs tabs on tabs.organization_id = orders.organization_id and tabs.unit_id = orders.unit_id and tabs.id = orders.tab_id
            inner join pos_products products on products.organization_id = items.organization_id and products.id = items.product_id
            where items.organization_id = ${schedule.organization_id} and items.unit_id = ${schedule.unit_id} and tabs.status = 'closed' and items.status <> 'canceled'
              and timezone(${schedule.timezone}, tabs.closed_at)::date between ${period.from}::date and ${period.to}::date
            group by products.id, products.name
            union all
            select 'labor', 'worked_minutes', 'Minutos trabalhados',
                   coalesce(round(sum(extract(epoch from (entries.clocked_out_at - entries.clocked_in_at)) / 60.0)), 0)::int,
                   coalesce(round(sum(extract(epoch from (entries.clocked_out_at - entries.clocked_in_at)) / 60.0 * people.hourly_rate_cents / 60.0)), 0)::bigint
            from management_time_entries entries
            inner join management_people people on people.organization_id = entries.organization_id and people.unit_id = entries.unit_id and people.id = entries.person_id
            where entries.organization_id = ${schedule.organization_id} and entries.unit_id = ${schedule.unit_id} and entries.clocked_out_at is not null
              and timezone(${schedule.timezone}, entries.clocked_in_at)::date between ${period.from}::date and ${period.to}::date
            union all
            select 'reconciliation', 'fiscal_authorized', 'Documentos fiscais autorizados',
                   count(*) filter (where status = 'authorized')::int,
                   coalesce(sum(total_cents) filter (where status = 'authorized'), 0)::bigint
            from fiscal_documents
            where organization_id = ${schedule.organization_id} and unit_id = ${schedule.unit_id}
              and timezone(${schedule.timezone}, issued_at)::date between ${period.from}::date and ${period.to}::date
            union all
            select 'quality', 'sold_items_without_cost', 'Itens vendidos sem custo histÃ³rico', count(*)::int, 0::bigint
            from pos_order_items items
            inner join pos_orders orders on orders.organization_id = items.organization_id and orders.unit_id = items.unit_id and orders.id = items.order_id
            inner join pos_tabs tabs on tabs.organization_id = orders.organization_id and tabs.unit_id = orders.unit_id and tabs.id = orders.tab_id
            where items.organization_id = ${schedule.organization_id} and items.unit_id = ${schedule.unit_id} and tabs.status = 'closed' and items.status <> 'canceled' and items.cost_cents is null
              and timezone(${schedule.timezone}, tabs.closed_at)::date between ${period.from}::date and ${period.to}::date
          `),
        ]);
      if (schedule.family === "multiunit" && recipientRoles.some(({ role }) => role === "owner")) {
        familyRows.push(
          ...(await tx.execute<ReportBreakdownRow & { section: ReportFamily }>(sql`
            select 'multiunit'::text as section, units.id::text as key, units.name as label,
                   count(tabs.id)::int as quantity,
                   coalesce(sum(tabs.total_cents), 0)::bigint as revenue_cents
            from units
            left join pos_tabs tabs on tabs.organization_id = units.organization_id and tabs.unit_id = units.id and tabs.status = 'closed'
              and timezone(units.timezone, tabs.closed_at)::date between ${period.from}::date and ${period.to}::date
            where units.organization_id = ${schedule.organization_id} and units.active = true
            group by units.id, units.name order by revenue_cents desc, units.name
          `)),
        );
      }
      const cash = cashRows[0] ?? { inflows_cents: 0, outflows_cents: 0 };
      const income = incomeRows[0] ?? {
        revenue_cents: 0,
        expenses_cents: 0,
        cost_line_count: 0,
        missing_cost_lines: 0,
        line_revenue_cents: 0,
        cmv_cents: 0,
      };
      const revenueCents = Number(income.revenue_cents);
      const costLineCount = Number(income.cost_line_count);
      const missingCostLines = Number(income.missing_cost_lines);
      const costCoverage =
        costLineCount === 0 || missingCostLines === costLineCount
          ? "unavailable"
          : missingCostLines > 0
            ? "partial"
            : "complete";
      const cmvCents =
        costCoverage === "complete" && Number(income.line_revenue_cents) === revenueCents
          ? Number(income.cmv_cents)
          : null;
      const expensesCents = Number(income.expenses_cents);
      const grossMarginCents = cmvCents === null ? null : revenueCents - cmvCents;
      const channels = [...aggregate]
        .reduce<Map<string, ReportBreakdownRow>>((byChannel, row) => {
          const existing = byChannel.get(row.channel) ?? {
            key: row.channel,
            label: row.channel,
            quantity: 0,
            revenue_cents: 0,
          };
          existing.quantity = Number(existing.quantity) + Number(row.quantity);
          existing.revenue_cents = Number(existing.revenue_cents) + Number(row.revenue_cents);
          byChannel.set(row.channel, existing);
          return byChannel;
        }, new Map())
        .values();
      if (schedule.family === "forecast") {
        const sampleDays = new Set(aggregate.map((row) => row.date)).size;
        const revenue = aggregate.reduce((sum, row) => sum + Number(row.revenue_cents), 0);
        familyRows.push({
          section: "forecast",
          key: "revenue_7_days",
          label: "Previsão de receita em 7 dias",
          quantity: sampleDays,
          revenue_cents: sampleDays > 0 ? Math.round((revenue / sampleDays) * 7) : 0,
        });
      }
      const report: ScheduledReportData = {
        sales: [...aggregate],
        cashFlow: {
          inflowsCents: Number(cash.inflows_cents),
          outflowsCents: Number(cash.outflows_cents),
          netCents: Number(cash.inflows_cents) - Number(cash.outflows_cents),
        },
        incomeStatement: {
          revenueCents,
          cmvCents,
          grossMarginCents,
          operatingExpensesCents: expensesCents,
          operatingResultCents: grossMarginCents === null ? null : grossMarginCents - expensesCents,
          costCoverage,
        },
        breakdowns: {
          products: [...products],
          categories: [...categories],
          channels: [...channels],
          paymentMethods: [...paymentMethods],
        },
        familyRows: [...familyRows],
      };
      const query = {
        ...period,
        timezone: schedule.timezone,
        range: schedule.range,
        comparisonMode: schedule.comparison_mode,
        family: schedule.family,
        format: schedule.format,
        includeCosts,
      };
      const csvContent = buildScheduledReportCsv(query, report);
      const rows = parseReportCsv(csvContent);
      const artifact =
        schedule.format === "csv"
          ? {
              content: csvContent,
              contentEncoding: "utf8" as const,
              mimeType: "text/csv; charset=utf-8",
              sha256: reportContentSha256(csvContent),
            }
          : buildReportArtifact(
              schedule.format,
              rows,
              `Relatório GiroMesa ${period.from} a ${period.to}`,
            );
      const rowCount = rows.length;
      const idempotencyKey = `report-schedule:${schedule.id}:${scheduledFor.toISOString()}`;
      const [reportExport] = await tx
        .insert(managementReportExports)
        .values({
          organizationId: schedule.organization_id,
          unitId: schedule.unit_id,
          scheduleId: schedule.id,
          idempotencyKey,
          query,
          content: artifact.content,
          contentEncoding: artifact.contentEncoding,
          mimeType: artifact.mimeType,
          status: "ready",
          format: schedule.format,
          sha256: artifact.sha256,
          rowCount,
          scheduledFor,
          completedAt: now,
          expiresAt: new Date(now.getTime() + REPORT_EXPORT_RETENTION_DAYS * 86_400_000),
        })
        .onConflictDoNothing()
        .returning({ id: managementReportExports.id });

      const nextRunAt = nextReportRun(
        {
          frequency: schedule.frequency,
          weekday: schedule.weekday,
          dayOfMonth: schedule.day_of_month,
          localTime: schedule.local_time,
        },
        scheduledFor,
        schedule.timezone,
      );
      const scheduledForIso = scheduledFor.toISOString();
      const nextRunAtIso = nextRunAt.toISOString();
      await tx.execute(sql`
        update management_report_schedules
        set last_run_at = ${scheduledForIso}::timestamptz,
            next_run_at = ${nextRunAtIso}::timestamptz,
            version = version + 1,
            updated_at = ${nowIso}::timestamptz
        where organization_id = ${schedule.organization_id}
          and unit_id = ${schedule.unit_id}
          and id = ${schedule.id}
      `);
      if (!reportExport) continue;
      created += 1;
      await tx.insert(auditEvents).values({
        organizationId: schedule.organization_id,
        unitId: schedule.unit_id,
        action: "management.report_export.created",
        entityType: "management_report_export",
        entityId: reportExport.id,
        metadata: {
          scheduleId: schedule.id,
          scheduledFor: scheduledFor.toISOString(),
          format: schedule.format,
          sha256: artifact.sha256,
          rowCount,
        },
      });
      if (canEmail && schedule.recipient_identity_id) {
        await tx.insert(outboxEvents).values({
          topic: "management.report_export_email_requested",
          aggregateType: "management_report_export",
          aggregateId: reportExport.id,
          payload: {
            organizationId: schedule.organization_id,
            unitId: schedule.unit_id,
            exportId: reportExport.id,
            recipientIdentityId: schedule.recipient_identity_id,
          },
        });
      }
    }
    return created;
  });
}
