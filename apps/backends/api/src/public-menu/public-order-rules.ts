export type PublicPromotion = {
  id: string;
  discountType: string;
  discountValue: number;
  productIds: string[];
  categoryIds: string[];
  channels: string[];
  daysOfWeek: number[];
  startTime: string | null;
  endTime: string | null;
};

export function localCalendar(at: Date, timezone: string): { weekday: number; minute: number } {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(at);
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((value) => value.type === type)?.value;
  return {
    weekday: ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(part("weekday") ?? ""),
    minute: Number(part("hour")) * 60 + Number(part("minute")),
  };
}

export function localDate(at: Date, timezone: string): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(at);
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((value) => value.type === type)?.value;
  return `${part("year")}-${part("month")}-${part("day")}`;
}

export function bestPromotion(
  promotions: readonly PublicPromotion[],
  productId: string,
  categoryId: string,
  channel: "delivery" | "pickup",
  weekday: number,
  minute: number,
  unitPriceCents: number,
  quantity: number,
): { id: string; discountCents: number } | null {
  let best: { id: string; discountCents: number } | null = null;
  for (const promotion of promotions) {
    if (
      (!promotion.productIds.includes(productId) && !promotion.categoryIds.includes(categoryId)) ||
      !promotion.channels.includes(channel) ||
      !scheduleApplies(promotion, weekday, minute)
    ) {
      continue;
    }
    const perUnit =
      promotion.discountType === "percentage"
        ? Math.floor((unitPriceCents * promotion.discountValue) / 10_000)
        : promotion.discountType === "fixed_price"
          ? Math.max(0, unitPriceCents - promotion.discountValue)
          : 0;
    const discountCents = Math.min(unitPriceCents, perUnit) * quantity;
    if (discountCents > (best?.discountCents ?? 0)) best = { id: promotion.id, discountCents };
  }
  return best;
}

function scheduleApplies(promotion: PublicPromotion, weekday: number, minute: number): boolean {
  const days = promotion.daysOfWeek;
  if (!promotion.startTime && !promotion.endTime)
    return days.length === 0 || days.includes(weekday);
  if (!promotion.startTime || !promotion.endTime) return false;
  const start = timeMinute(promotion.startTime);
  const end = timeMinute(promotion.endTime);
  if (start === null || end === null || start === end) return false;
  const includes = (day: number) => days.length === 0 || days.includes((day + 7) % 7);
  return start < end
    ? includes(weekday) && minute >= start && minute < end
    : (includes(weekday) && minute >= start) || (includes(weekday - 1) && minute < end);
}

function timeMinute(value: string): number | null {
  const match = /^(\d{2}):(\d{2})$/.exec(value);
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  return hour < 24 && minute < 60 ? hour * 60 + minute : null;
}
