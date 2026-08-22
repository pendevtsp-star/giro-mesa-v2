export type BusinessHoursPeriod = {
  start: string;
  end: string;
  endsNextDay: boolean;
};

export type BusinessHoursRule =
  | { mode: "closed" }
  | { mode: "open24h" }
  | { mode: "periods"; periods: BusinessHoursPeriod[] };

export type BusinessHours = {
  weekly: Array<BusinessHoursRule & { weekday: number }>;
  exceptions: Array<BusinessHoursRule & { date: string }>;
};

export type BusinessOpenState = {
  open: boolean;
  nextChangeAt: string | null;
};

const weekdayByName: Record<string, number> = {
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
  Sun: 7,
};

function localParts(at: Date, formatter: Intl.DateTimeFormat) {
  const parts = Object.fromEntries(
    formatter
      .formatToParts(at)
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, part.value]),
  );
  const weekday = parts.weekday ? weekdayByName[parts.weekday] : undefined;
  if (!weekday) throw new RangeError("Could not resolve local weekday");
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    weekday,
    minute: Number(parts.hour) * 60 + Number(parts.minute),
  };
}

function previousDate(date: string) {
  const previous = new Date(`${date}T00:00:00.000Z`);
  previous.setUTCDate(previous.getUTCDate() - 1);
  return previous.toISOString().slice(0, 10);
}

function weekdayForDate(date: string) {
  const weekday = new Date(`${date}T00:00:00.000Z`).getUTCDay();
  return weekday === 0 ? 7 : weekday;
}

function minutes(time: string) {
  return Number(time.slice(0, 2)) * 60 + Number(time.slice(3));
}

function ruleForDate(schedule: BusinessHours, date: string, weekday: number) {
  return (
    schedule.exceptions.find((exception) => exception.date === date) ??
    schedule.weekly.find((day) => day.weekday === weekday) ?? { mode: "closed" as const }
  );
}

function ruleIsOpen(rule: BusinessHoursRule, minute: number) {
  if (rule.mode === "open24h") return true;
  if (rule.mode === "closed") return false;
  return rule.periods.some((period) => {
    const start = minutes(period.start);
    const end = minutes(period.end);
    return period.endsNextDay ? minute >= start : minute >= start && minute < end;
  });
}

function previousRuleIsOpen(rule: BusinessHoursRule, minute: number) {
  return (
    rule.mode === "periods" &&
    rule.periods.some((period) => period.endsNextDay && minute < minutes(period.end))
  );
}

function isOpenAt(schedule: BusinessHours, at: Date, formatter: Intl.DateTimeFormat) {
  const local = localParts(at, formatter);
  const currentException = schedule.exceptions.find((exception) => exception.date === local.date);
  const currentRule = currentException ?? ruleForDate(schedule, local.date, local.weekday);
  if (ruleIsOpen(currentRule, local.minute)) return true;
  if (currentException) return false;

  const priorDate = previousDate(local.date);
  return previousRuleIsOpen(
    ruleForDate(schedule, priorDate, weekdayForDate(priorDate)),
    local.minute,
  );
}

export function getBusinessOpenState(
  schedule: BusinessHours,
  timezone: string,
  at: Date = new Date(),
): BusinessOpenState {
  if (Number.isNaN(at.valueOf())) throw new RangeError("Invalid date");
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });
  const open = isOpenAt(schedule, at, formatter);
  const minuteMs = 60_000;
  const firstCandidate = Math.floor(at.valueOf() / minuteMs) * minuteMs + minuteMs;

  // ponytail: bounded minute scan keeps DST correct; derive zoned boundaries if this enters a hot path.
  for (let offset = 0; offset <= 8 * 24 * 60; offset += 1) {
    const candidate = new Date(firstCandidate + offset * minuteMs);
    if (isOpenAt(schedule, candidate, formatter) !== open) {
      return { open, nextChangeAt: candidate.toISOString() };
    }
  }
  return { open, nextChangeAt: null };
}
