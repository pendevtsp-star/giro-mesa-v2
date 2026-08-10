import { createHash } from "node:crypto";
import { BadRequestException, ConflictException } from "@nestjs/common";

export type KdsState = "pending" | "preparing" | "ready" | "done" | "canceled";
export type AvailabilitySchedule = {
  windows: { dayOfWeek: number; start: string; end: string }[];
};

const KDS_TRANSITIONS: Record<KdsState, readonly KdsState[]> = {
  pending: ["preparing", "canceled"],
  preparing: ["ready", "canceled"],
  ready: ["done", "canceled"],
  done: [],
  canceled: [],
};

export function assertKdsTransition(from: KdsState, to: KdsState) {
  if (!KDS_TRANSITIONS[from].includes(to)) {
    throw new ConflictException({
      code: "INVALID_KDS_TRANSITION",
      message: `Transição de KDS inválida: ${from} -> ${to}.`,
    });
  }
}

function minuteOfDay(value: string) {
  const [hour = "0", minute = "0"] = value.split(":");
  return Number(hour) * 60 + Number(minute);
}

export function isWithinAvailability(
  schedule: AvailabilitySchedule | null | undefined,
  at: Date,
  timezone: string,
) {
  if (!schedule) return true;
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(at);
  const weekdays = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const weekday = weekdays.indexOf(parts.find((part) => part.type === "weekday")?.value ?? "");
  const hour = Number(parts.find((part) => part.type === "hour")?.value);
  const minute = Number(parts.find((part) => part.type === "minute")?.value);
  const currentMinute = hour * 60 + minute;
  return schedule.windows.some((window) => {
    const start = minuteOfDay(window.start);
    const end = minuteOfDay(window.end);
    if (start < end) {
      return weekday === window.dayOfWeek && currentMinute >= start && currentMinute < end;
    }
    return (
      (weekday === window.dayOfWeek && currentMinute >= start) ||
      (weekday === (window.dayOfWeek + 1) % 7 && currentMinute < end)
    );
  });
}

export function itemAmounts(
  quantity: number,
  unitPriceCents: number,
  modifierPerUnitCents: number,
  discountCents = 0,
) {
  const grossCents = quantity * (unitPriceCents + modifierPerUnitCents);
  if (
    ![quantity, unitPriceCents, modifierPerUnitCents, discountCents].every(Number.isSafeInteger)
  ) {
    throw new BadRequestException({ code: "INVALID_MONEY", message: "Valor monetário inválido." });
  }
  if (quantity <= 0 || unitPriceCents < 0 || modifierPerUnitCents < 0) {
    throw new BadRequestException({
      code: "INVALID_ITEM_AMOUNT",
      message: "Valores do item inválidos.",
    });
  }
  if (discountCents < 0 || discountCents > grossCents) {
    throw new BadRequestException({ code: "INVALID_DISCOUNT", message: "Desconto inválido." });
  }
  return { grossCents, discountCents, netCents: grossCents - discountCents };
}

export function tabTotals(
  items: readonly { grossCents: number; discountCents: number; canceled?: boolean }[],
  serviceChargeBasisPoints: number,
  tipCents: number,
) {
  if (
    !Number.isSafeInteger(serviceChargeBasisPoints) ||
    serviceChargeBasisPoints < 0 ||
    serviceChargeBasisPoints > 10_000
  ) {
    throw new BadRequestException({
      code: "INVALID_SERVICE_CHARGE",
      message: "Taxa de serviço inválida.",
    });
  }
  if (!Number.isSafeInteger(tipCents) || tipCents < 0) {
    throw new BadRequestException({ code: "INVALID_TIP", message: "Gorjeta inválida." });
  }
  const active = items.filter((item) => !item.canceled);
  const subtotalCents = active.reduce((sum, item) => sum + item.grossCents, 0);
  const discountCents = active.reduce((sum, item) => sum + item.discountCents, 0);
  const netBeforeCharges = subtotalCents - discountCents;
  const serviceChargeCents = Math.floor((netBeforeCharges * serviceChargeBasisPoints) / 10_000);
  const totalCents = netBeforeCharges + serviceChargeCents + tipCents;
  if (![subtotalCents, discountCents, serviceChargeCents, totalCents].every(Number.isSafeInteger)) {
    throw new BadRequestException({
      code: "MONEY_OVERFLOW",
      message: "Total excede o limite seguro.",
    });
  }
  return { subtotalCents, discountCents, serviceChargeCents, tipCents, totalCents };
}

export function assertTenantScope(
  expected: { organizationId: string; unitId: string },
  actual: { organizationId: string; unitId: string } | undefined,
) {
  if (
    !actual ||
    actual.organizationId !== expected.organizationId ||
    actual.unitId !== expected.unitId
  ) {
    throw new ConflictException({
      code: "SCOPE_MISMATCH",
      message: "Recurso fora do escopo operacional.",
    });
  }
  return actual;
}

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, entry]) => [key, stableValue(entry)]),
    );
  }
  return value;
}

export function requestHash(operation: string, value: unknown) {
  return createHash("sha256")
    .update(JSON.stringify({ operation, value: stableValue(value) }))
    .digest("hex");
}

export function replayResult<T extends Record<string, unknown>>(
  existing:
    | { operation: string; requestHash: string; response: Record<string, unknown> }
    | undefined,
  operation: string,
  hash: string,
) {
  if (!existing) return undefined;
  if (existing.operation !== operation || existing.requestHash !== hash) {
    throw new ConflictException({
      code: "IDEMPOTENCY_KEY_REUSED",
      message: "A chave de idempotência já foi usada com outro comando.",
    });
  }
  return { ...(existing.response as T), idempotentReplay: true };
}
