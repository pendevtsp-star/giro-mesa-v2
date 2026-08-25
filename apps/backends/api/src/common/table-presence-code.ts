import { createHmac, timingSafeEqual } from "node:crypto";

export function tablePresenceDate(now: Date, timezone: string) {
  return new Intl.DateTimeFormat("en-CA", {
    day: "2-digit",
    month: "2-digit",
    timeZone: timezone,
    year: "numeric",
  }).format(now);
}

export function tablePresenceCode(
  secret: string,
  organizationId: string,
  unitId: string,
  timezone: string,
  now = new Date(),
) {
  const digest = createHmac("sha256", secret)
    .update(`table-presence:${organizationId}:${unitId}:${tablePresenceDate(now, timezone)}`)
    .digest();
  return (digest.readUInt32BE(0) % 1_000_000).toString().padStart(6, "0");
}

export function verifyTablePresenceCode(expected: string, candidate: string | undefined) {
  if (!candidate || !/^\d{6}$/.test(candidate)) return false;
  return timingSafeEqual(Buffer.from(expected), Buffer.from(candidate));
}
