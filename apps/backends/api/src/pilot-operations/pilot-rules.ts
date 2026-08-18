import { createHash } from "node:crypto";
import { BadRequestException, ConflictException } from "@nestjs/common";

export type KdsState = "pending" | "preparing" | "ready" | "done" | "canceled";
export type KdsServiceMode = "full_service" | "quick_service" | "bar" | "hybrid";
export type KdsCourse = "anytime" | "starter" | "main" | "dessert";
export type PrintJobState = "queued" | "printing" | "printed" | "failed";
export type AvailabilitySchedule = {
  windows: { dayOfWeek: number; start: string; end: string }[];
};

export const MAX_STORED_CENTS = 2_147_483_647;

const KDS_TRANSITIONS: Record<KdsState, readonly KdsState[]> = {
  pending: ["preparing"],
  preparing: ["ready"],
  ready: [],
  done: [],
  canceled: [],
};

const PRINT_JOB_TRANSITIONS: Record<PrintJobState, readonly PrintJobState[]> = {
  queued: ["printing", "failed"],
  printing: ["printed", "failed"],
  printed: [],
  failed: [],
};

export const APPROVAL_TTL_MS = 10 * 60 * 1_000;

export function approvalExpiresAt(requestedAt: Date) {
  return new Date(requestedAt.getTime() + APPROVAL_TTL_MS);
}

export function isApprovalActive(requestedAt: Date, now = new Date()) {
  return approvalExpiresAt(requestedAt).getTime() > now.getTime();
}

export function assertKdsTransition(from: KdsState, to: KdsState) {
  if (!KDS_TRANSITIONS[from].includes(to)) {
    throw new ConflictException({
      code: "INVALID_KDS_TRANSITION",
      message: `Transição de KDS inválida: ${from} -> ${to}.`,
    });
  }
}

export function kdsPartialState(quantity: number, readyQuantity: number) {
  if (
    !Number.isSafeInteger(quantity) ||
    !Number.isSafeInteger(readyQuantity) ||
    quantity <= 0 ||
    readyQuantity < 0 ||
    readyQuantity > quantity
  ) {
    throw new BadRequestException({ code: "INVALID_KDS_QUANTITY" });
  }
  return readyQuantity === quantity ? ("ready" as const) : ("preparing" as const);
}

export function initialKdsCourseDispatch(serviceMode: KdsServiceMode, course: KdsCourse) {
  const held =
    (serviceMode === "full_service" || serviceMode === "hybrid") &&
    (course === "main" || course === "dessert");
  return { held, fired: !held };
}

export function assertKdsOrderHandoff(
  target: "expedition" | "served",
  tickets: readonly {
    status: KdsState;
    handedOffAt: Date | null;
    servedAt: Date | null;
  }[],
) {
  if (tickets.length === 0) throw new ConflictException({ code: "KDS_ORDER_EMPTY" });
  if (tickets.some((ticket) => ticket.servedAt)) {
    throw new ConflictException({ code: "KDS_ORDER_ALREADY_SERVED" });
  }
  if (target === "expedition") {
    if (
      tickets.every(
        (ticket) => ticket.status === "done" && ticket.handedOffAt !== null && !ticket.servedAt,
      )
    ) {
      throw new ConflictException({ code: "KDS_ORDER_ALREADY_AT_EXPEDITION" });
    }
    if (tickets.some((ticket) => ticket.status !== "ready")) {
      throw new ConflictException({ code: "KDS_ORDER_NOT_READY" });
    }
    return;
  }
  if (
    tickets.some(
      (ticket) => ticket.status !== "done" || ticket.handedOffAt === null || ticket.servedAt,
    )
  ) {
    throw new ConflictException({ code: "KDS_ORDER_NOT_AT_EXPEDITION" });
  }
}

export function shouldAlertKdsCancellation(statuses: readonly string[]) {
  return statuses.some((status) => status === "canceled");
}

export type KdsAttentionNoteId = "allergy" | "notes";

export function normalizeKdsAttentionText(value: string | null | undefined) {
  return value?.trim().replace(/\r\n?/g, "\n") ?? "";
}

export function kdsAttentionRevision(noteId: KdsAttentionNoteId, value: string) {
  return createHash("sha256")
    .update(`${noteId}\0${normalizeKdsAttentionText(value)}`, "utf8")
    .digest("hex");
}

export function summarizeKdsDurations(values: readonly number[]) {
  const sorted = values
    .filter((value) => Number.isFinite(value) && value >= 0)
    .sort((a, b) => a - b);
  if (sorted.length === 0) {
    return { average: 0, median: 0, p90: 0, sampleSize: 0 };
  }
  const middle = Math.floor(sorted.length / 2);
  const median =
    sorted.length % 2 === 0
      ? ((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2
      : (sorted[middle] ?? 0);
  const average = sorted.reduce((sum, value) => sum + value, 0) / sorted.length;
  const p90 = sorted[Math.max(0, Math.ceil(sorted.length * 0.9) - 1)] ?? 0;
  const round = (value: number) => Math.round(value * 10) / 10;
  return {
    average: round(average),
    median: round(median),
    p90: round(p90),
    sampleSize: sorted.length,
  };
}

export type KdsAvailabilityProjectionInput = {
  available: boolean;
  dailyStock: number | null;
  soldToday: number;
  stockDate: string | null;
  resetAt: Date | null;
  reason: string | null;
};

export function projectKdsAvailability(
  input: KdsAvailabilityProjectionInput,
  localDate: string,
  now = new Date(),
) {
  const resetElapsed = input.resetAt !== null && input.resetAt.getTime() <= now.getTime();
  const soldToday = input.stockDate === localDate ? input.soldToday : 0;
  const remainingQuantity =
    input.dailyStock === null ? null : Math.max(0, input.dailyStock - soldToday);
  const manuallyAvailable = resetElapsed ? true : input.available;
  const available = manuallyAvailable && (remainingQuantity === null || remainingQuantity > 0);
  const status = !available
    ? ("unavailable" as const)
    : remainingQuantity === null
      ? ("available" as const)
      : ("limited" as const);
  return {
    available,
    status,
    soldToday,
    remainingQuantity,
    reason: resetElapsed ? null : input.reason,
    resetAt: resetElapsed ? null : input.resetAt,
    resetElapsed,
  };
}

export function kdsCapacityRecommendation(input: {
  activeAssignments: number;
  blockedAssignments: number;
  queuedQuantity: number;
  preparingQuantity: number;
  sampleSize: number;
  p50PrepMinutes: number | null;
  p90PrepMinutes: number | null;
  estimatedUnitsPerHour: number | null;
}) {
  const workload = input.queuedQuantity + input.preparingQuantity;
  const queueDelayMinutes =
    input.estimatedUnitsPerHour && input.estimatedUnitsPerHour > 0
      ? Math.round((workload / input.estimatedUnitsPerHour) * 60)
      : null;
  const reasons: Array<"queue_depth" | "blocked_items" | "slow_history" | "insufficient_history"> =
    [];
  if (input.sampleSize < 5) reasons.push("insufficient_history");
  if (input.blockedAssignments > 0) reasons.push("blocked_items");
  if (workload >= 5 || input.activeAssignments >= 8) reasons.push("queue_depth");
  if ((input.p90PrepMinutes ?? 0) >= 30) reasons.push("slow_history");

  const overloaded =
    input.blockedAssignments >= 3 ||
    input.activeAssignments >= 20 ||
    workload >= 20 ||
    (queueDelayMinutes !== null && queueDelayMinutes >= Math.max(30, input.p90PrepMinutes ?? 0));
  const strained =
    !overloaded &&
    (input.blockedAssignments > 0 ||
      input.activeAssignments >= 8 ||
      workload >= 5 ||
      (queueDelayMinutes !== null && queueDelayMinutes >= 15));
  const state = overloaded
    ? ("overloaded" as const)
    : strained
      ? ("strained" as const)
      : ("normal" as const);
  const suggestedDelayMinutes =
    state === "normal"
      ? null
      : Math.max(5, Math.ceil((queueDelayMinutes ?? input.p90PrepMinutes ?? 5) / 5) * 5);
  return { state, suggestedDelayMinutes, reasons };
}

export function assertPrintJobTransition(from: PrintJobState, to: PrintJobState) {
  if (!PRINT_JOB_TRANSITIONS[from].includes(to)) {
    throw new ConflictException({
      code: "INVALID_PRINT_JOB_TRANSITION",
      message: `Transição de impressão inválida: ${from} -> ${to}.`,
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
  const netCents = grossCents - discountCents;
  if (
    ![grossCents, discountCents, netCents].every(
      (value) => Number.isSafeInteger(value) && value >= 0 && value <= MAX_STORED_CENTS,
    )
  ) {
    throw new BadRequestException({
      code: "MONEY_OVERFLOW",
      message: "Total excede o limite monetário persistido.",
    });
  }
  return { grossCents, discountCents, netCents };
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
  if (!Number.isSafeInteger(tipCents) || tipCents < 0 || tipCents > MAX_STORED_CENTS) {
    throw new BadRequestException({ code: "INVALID_TIP", message: "Gorjeta inválida." });
  }
  const active = items.filter((item) => !item.canceled);
  const subtotalCents = active.reduce((sum, item) => sum + item.grossCents, 0);
  const discountCents = active.reduce((sum, item) => sum + item.discountCents, 0);
  const netBeforeCharges = subtotalCents - discountCents;
  const serviceChargeCents = Math.floor((netBeforeCharges * serviceChargeBasisPoints) / 10_000);
  const totalCents = netBeforeCharges + serviceChargeCents + tipCents;
  if (
    ![subtotalCents, discountCents, serviceChargeCents, totalCents].every(
      (value) => Number.isSafeInteger(value) && value >= 0 && value <= MAX_STORED_CENTS,
    )
  ) {
    throw new BadRequestException({
      code: "MONEY_OVERFLOW",
      message: "Total excede o limite monetário persistido.",
    });
  }
  return { subtotalCents, discountCents, serviceChargeCents, tipCents, totalCents };
}

export function assertTabCanClose(totalCents: number, paidCents: number) {
  if (paidCents < totalCents) {
    throw new ConflictException({
      code: "TAB_BALANCE_REMAINING",
      message: "Ainda existe saldo em aberto nesta conta.",
      remainingCents: totalCents - paidCents,
    });
  }
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
    | {
        actorIdentityId?: string;
        operation: string;
        requestHash: string;
        response: Record<string, unknown>;
      }
    | undefined,
  operation: string,
  hash: string,
  actorIdentityId?: string,
) {
  if (!existing) return undefined;
  if (
    (actorIdentityId !== undefined && existing.actorIdentityId !== actorIdentityId) ||
    existing.operation !== operation ||
    existing.requestHash !== hash
  ) {
    throw new ConflictException({
      code: "IDEMPOTENCY_KEY_REUSED",
      message: "A chave de idempotência já foi usada com outro comando.",
    });
  }
  return { ...(existing.response as T), idempotentReplay: true };
}
