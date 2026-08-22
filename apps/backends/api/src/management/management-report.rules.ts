import { BadRequestException } from "@nestjs/common";
import type { ReportScheduleCreateInput } from "./management-report.schemas.js";

const DAY_MS = 86_400_000;

export function reportPageOffset(cursor?: string) {
  if (!cursor) return 0;
  try {
    const parsed = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8")) as {
      offset?: unknown;
    };
    if (
      !Number.isInteger(parsed.offset) ||
      Number(parsed.offset) < 0 ||
      Number(parsed.offset) > 100_000
    )
      throw new Error("invalid");
    return Number(parsed.offset);
  } catch {
    throw new BadRequestException({ code: "REPORT_CURSOR_INVALID", message: "Cursor inválido." });
  }
}

export function reportNextCursor(offset: number, returned: number, hasMore: boolean) {
  return hasMore
    ? Buffer.from(JSON.stringify({ offset: offset + returned }), "utf8").toString("base64url")
    : null;
}

export function csvCell(value: unknown) {
  let text = value === null || value === undefined ? "" : String(value);
  if (/^[=+\-@]/.test(text)) text = `'${text}`;
  return `"${text.replaceAll('"', '""')}"`;
}

export function reportCsv(rows: readonly Record<string, unknown>[]) {
  const columns = [...new Set(rows.flatMap((row) => Object.keys(row)))];
  return `\uFEFF${[
    columns.map(csvCell).join(";"),
    ...rows.map((row) => columns.map((column) => csvCell(row[column])).join(";")),
  ].join("\r\n")}`;
}

export function proratedBudgetTarget(month: string, targetCents: number, from: string, to: string) {
  const monthStart = Date.parse(`${month}-01T00:00:00.000Z`);
  const [year, monthNumber] = month.split("-").map(Number);
  const monthDays = new Date(Date.UTC(year ?? 0, monthNumber ?? 1, 0)).getUTCDate();
  const monthEnd = monthStart + (monthDays - 1) * DAY_MS;
  const overlapStart = Math.max(monthStart, Date.parse(`${from}T00:00:00.000Z`));
  const overlapEnd = Math.min(monthEnd, Date.parse(`${to}T00:00:00.000Z`));
  if (overlapStart > overlapEnd) return 0;
  const overlapDays = Math.round((overlapEnd - overlapStart) / DAY_MS) + 1;
  return Math.round((targetCents * overlapDays) / monthDays);
}

export function reportBudgetCoverage(
  months: readonly string[],
  entries: readonly { month: string; metric: string }[],
  requiredMetrics: readonly string[],
) {
  if (entries.length === 0) return "unavailable" as const;
  const configured = new Set(entries.map((entry) => `${entry.month.slice(0, 7)}:${entry.metric}`));
  return months.every((month) =>
    requiredMetrics.every((metric) => configured.has(`${month}:${metric}`)),
  )
    ? ("complete" as const)
    : ("partial" as const);
}

export function buildReportForecast(input: {
  dailySeries: readonly {
    date?: string;
    revenueCents: number;
    previousRevenueCents: number | null;
  }[];
  cashFlow: { inflowsCents: number; outflowsCents: number };
  inventory: readonly {
    key: string;
    label: string;
    consumedQuantity: number;
    currentQuantity: number;
  }[];
  futureDemand?: readonly {
    date: string;
    reservations: number;
    guests: number;
    demandFloorCents: number;
  }[];
  horizonDays?: number;
}) {
  const minimumSampleDays = 14;
  const horizonDays = Math.min(Math.max(input.horizonDays ?? 7, 1), 90);
  const observedSeries = input.dailySeries.filter((row) => row.revenueCents > 0);
  const sampleDays = observedSeries.length;
  const available = sampleDays >= minimumSampleDays;
  const average = sampleDays
    ? observedSeries.reduce((sum, row) => sum + row.revenueCents, 0) / sampleDays
    : 0;
  const variance = sampleDays
    ? observedSeries.reduce((sum, row) => sum + (row.revenueCents - average) ** 2, 0) / sampleDays
    : 0;
  const deviation = Math.sqrt(variance);
  const dated = observedSeries.filter(
    (row): row is typeof row & { date: string } =>
      typeof row.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(row.date),
  );
  const weekdayRevenue = new Map<number, number[]>();
  for (const row of dated) {
    const weekday = new Date(`${row.date}T00:00:00.000Z`).getUTCDay();
    weekdayRevenue.set(weekday, [...(weekdayRevenue.get(weekday) ?? []), row.revenueCents]);
  }
  const weekdayAverage = (weekday: number) => {
    const values = weekdayRevenue.get(weekday) ?? [];
    return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : average;
  };
  const observedErrors = dated.flatMap((row) => {
    if (row.revenueCents <= 0) return [];
    const weekday = new Date(`${row.date}T00:00:00.000Z`).getUTCDay();
    const values = weekdayRevenue.get(weekday) ?? [];
    if (values.length < 2) return [];
    const expected =
      (values.reduce((sum, value) => sum + value, 0) - row.revenueCents) / (values.length - 1);
    return [Math.abs(row.revenueCents - expected) / row.revenueCents];
  });
  const comparable = observedSeries.filter(
    (row) => row.previousRevenueCents !== null && row.previousRevenueCents > 0,
  );
  const errorSamples = observedErrors.length
    ? observedErrors
    : comparable.map(
        (row) =>
          Math.abs(row.revenueCents - (row.previousRevenueCents as number)) /
          (row.previousRevenueCents as number),
      );
  const errorPercent = errorSamples.length
    ? Number(
        ((errorSamples.reduce((sum, value) => sum + value, 0) / errorSamples.length) * 100).toFixed(
          1,
        ),
      )
    : null;
  const confidence =
    sampleDays >= 56 && errorPercent !== null && errorPercent <= 20
      ? ("high" as const)
      : available && (errorPercent === null || errorPercent <= 35)
        ? ("medium" as const)
        : ("low" as const);
  const lastDate = dated
    .map((row) => row.date)
    .sort()
    .at(-1);
  const projectedRevenue = Array.from({ length: horizonDays }, (_, index) => {
    if (!lastDate || !available) return { date: null, baseCents: average, forecastCents: average };
    const date = new Date(`${lastDate}T00:00:00.000Z`);
    date.setUTCDate(date.getUTCDate() + index + 1);
    const dateKey = date.toISOString().slice(0, 10);
    const baseCents = weekdayAverage(date.getUTCDay());
    const demandFloorCents =
      input.futureDemand?.find((entry) => entry.date === dateKey)?.demandFloorCents ?? 0;
    return { date: dateKey, baseCents, forecastCents: Math.max(baseCents, demandFloorCents) };
  });
  const total = Math.round(projectedRevenue.reduce((sum, value) => sum + value.forecastCents, 0));
  const interval = Math.round(1.28 * deviation * Math.sqrt(horizonDays));
  const dailyInflows = sampleDays ? input.cashFlow.inflowsCents / sampleDays : 0;
  const dailyOutflows = sampleDays ? input.cashFlow.outflowsCents / sampleDays : 0;
  return {
    method: "weekday_seasonality_v2" as const,
    available,
    minimumSampleDays,
    horizonDays,
    sampleDays,
    confidence,
    errorPercent,
    revenue: {
      dailyAverageCents: Math.round(average),
      forecastCents: total,
      lowerBoundCents: Math.max(0, total - interval),
      upperBoundCents: total + interval,
    },
    cash: {
      inflowsCents: Math.round(dailyInflows * horizonDays),
      outflowsCents: Math.round(dailyOutflows * horizonDays),
      netCents: Math.round((dailyInflows - dailyOutflows) * horizonDays),
    },
    calendarSignals: (input.futureDemand ?? []).map((entry) => {
      const projection = projectedRevenue.find((row) => row.date === entry.date);
      return {
        ...entry,
        applied: Boolean(projection && entry.demandFloorCents > projection.baseCents),
      };
    }),
    purchases: (available ? input.inventory : [])
      .map((item) => {
        const dailyDemand = sampleDays > 0 ? item.consumedQuantity / sampleDays : 0;
        return {
          key: item.key,
          label: item.label,
          suggestedQuantity: Number(
            Math.max(0, dailyDemand * horizonDays - item.currentQuantity).toFixed(3),
          ),
          dailyDemand: Number(dailyDemand.toFixed(3)),
        };
      })
      .filter((item) => item.suggestedQuantity > 0)
      .sort((left, right) => right.suggestedQuantity - left.suggestedQuantity)
      .slice(0, 20),
  };
}

function zonedParts(date: Date, timezone: string) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const get = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value;
  return {
    year: Number(get("year")),
    month: Number(get("month")),
    day: Number(get("day")),
    hour: Number(get("hour")),
    minute: Number(get("minute")),
    weekday: ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(get("weekday") ?? ""),
  };
}

function localMinute(date: Date, timezone: string) {
  const part = zonedParts(date, timezone);
  return Date.UTC(part.year, part.month - 1, part.day, part.hour, part.minute);
}

export function nextReportRun(
  schedule: Pick<ReportScheduleCreateInput, "frequency" | "weekday" | "dayOfMonth" | "localTime">,
  timezone: string,
  now = new Date(),
) {
  const [targetHour, targetMinute] = schedule.localTime.split(":").map(Number);
  const localNow = zonedParts(now, timezone);
  const firstLocalDay = Date.UTC(localNow.year, localNow.month - 1, localNow.day);
  for (let offset = 0; offset <= 400; offset += 1) {
    const localDay = new Date(firstLocalDay + offset * DAY_MS);
    const year = localDay.getUTCFullYear();
    const month = localDay.getUTCMonth() + 1;
    const day = localDay.getUTCDate();
    const weekday = localDay.getUTCDay();
    const matchingDay =
      schedule.frequency === "weekly" ? weekday === schedule.weekday : day === schedule.dayOfMonth;
    if (!matchingDay) continue;
    const desiredLocalMinute = Date.UTC(year, month - 1, day, targetHour ?? 0, targetMinute ?? 0);
    let candidateMs = desiredLocalMinute;
    for (let adjustment = 0; adjustment < 4; adjustment += 1) {
      const observedLocalMinute = localMinute(new Date(candidateMs), timezone);
      const delta = desiredLocalMinute - observedLocalMinute;
      if (delta === 0) break;
      candidateMs += delta;
    }
    const candidate = new Date(candidateMs);
    const final = zonedParts(candidate, timezone);
    if (
      candidate > now &&
      final.year === year &&
      final.month === month &&
      final.day === day &&
      final.hour === targetHour &&
      final.minute === targetMinute
    )
      return candidate;
  }
  throw new BadRequestException({
    code: "REPORT_SCHEDULE_TIME_INVALID",
    message: "Não foi possível calcular a próxima execução no timezone da unidade.",
  });
}
