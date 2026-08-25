import { createHash, createHmac, timingSafeEqual } from "node:crypto";

const E164_DIGITS = /^\d{10,15}$/;

export function normalizeWhatsAppPhone(value: string): string {
  let digits = value.replace(/\D/g, "");
  if ((digits.length === 10 || digits.length === 11) && !digits.startsWith("55"))
    digits = `55${digits}`;
  if (!E164_DIGITS.test(digits)) throw new Error("WHATSAPP_PHONE_INVALID");
  return digits;
}

export function evolutionInstanceToken(integrationId: string, secret: string): string {
  if (secret.trim().length < 32) throw new Error("WHATSAPP_EVOLUTION_TOKEN_SECRET_INVALID");
  return createHmac("sha256", secret)
    .update(`giromesa:evolution-go:${integrationId}`)
    .digest("hex");
}

export function evolutionCredentialReference(token: string): string {
  return `sha256:${createHash("sha256").update(token).digest("hex")}`;
}

export function safeSecretEqual(left: string, right: string): boolean {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}
