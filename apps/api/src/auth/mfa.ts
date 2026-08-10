import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { decryptSecret, encryptionKey, encryptSecret, type SecretEnvelope } from "@giromesa/domain";

const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

export type EncryptedMfaSecret = SecretEnvelope;

export function mfaKey(value = process.env.MFA_ENCRYPTION_KEY) {
  return encryptionKey(value, "MFA_ENCRYPTION_KEY");
}

export function generateMfaSecret() {
  return encodeBase32(randomBytes(20));
}

export function encryptMfaSecret(secret: string, key: Buffer): EncryptedMfaSecret {
  return encryptSecret(secret, key);
}

export function decryptMfaSecret(value: EncryptedMfaSecret, key: Buffer) {
  return decryptSecret(value, key);
}

export function verifyTotp(secret: string, code: string, now = Date.now()) {
  return verifiedTotpCounter(secret, code, now) !== null;
}

export function verifiedTotpCounter(secret: string, code: string, now = Date.now()) {
  if (!/^\d{6}$/.test(code)) return null;
  const candidate = Buffer.from(code);
  const currentCounter = Math.floor(now / 30_000);
  for (const offset of [-1, 0, 1]) {
    const counter = currentCounter + offset;
    if (counter < 0) continue;
    const expected = Buffer.from(totp(secret, counter));
    if (candidate.length === expected.length && timingSafeEqual(candidate, expected))
      return counter;
  }
  return null;
}

export function generateRecoveryCodes(count = 10) {
  return Array.from({ length: count }, () => randomBytes(12).toString("base64url"));
}

export function inheritedMfaAttempts(recentAttempts: number | undefined) {
  const attempts = recentAttempts ?? 0;
  return attempts < 5 ? attempts : null;
}

export function recoveryCodeHash(code: string, key: Buffer) {
  return createHmac("sha256", key).update(code.trim()).digest("hex");
}

export function totpReplayHash(identityId: string, counter: number, key: Buffer) {
  return createHmac("sha256", key)
    .update("totp-replay\0")
    .update(identityId)
    .update("\0")
    .update(String(counter))
    .digest("hex");
}

export function recoveryCodeMatches(code: string, hashes: string[], key: Buffer) {
  const candidate = Buffer.from(recoveryCodeHash(code, key), "hex");
  const index = hashes.findIndex((hash) => {
    const expected = Buffer.from(hash, "hex");
    return candidate.length === expected.length && timingSafeEqual(candidate, expected);
  });
  return index;
}

export function otpauthUri(secret: string, email: string) {
  const issuer = "GiroMesa";
  return `otpauth://totp/${encodeURIComponent(`${issuer}:${email}`)}?secret=${secret}&issuer=${issuer}&algorithm=SHA1&digits=6&period=30`;
}

function totp(secret: string, counter: number) {
  const message = Buffer.alloc(8);
  message.writeBigUInt64BE(BigInt(counter));
  const digest = createHmac("sha1", decodeBase32(secret)).update(message).digest();
  const offset = (digest.at(-1) ?? 0) & 0x0f;
  const binary = (digest.readUInt32BE(offset) & 0x7fffffff) % 1_000_000;
  return binary.toString().padStart(6, "0");
}

function encodeBase32(input: Buffer) {
  let bits = 0;
  let value = 0;
  let output = "";
  for (const byte of input) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      output += alphabet[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) output += alphabet[(value << (5 - bits)) & 31];
  return output;
}

function decodeBase32(input: string) {
  let bits = 0;
  let value = 0;
  const bytes: number[] = [];
  for (const character of input.replace(/=+$/, "").toUpperCase()) {
    const index = alphabet.indexOf(character);
    if (index < 0) throw new Error("Invalid base32 secret");
    value = (value << 5) | index;
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(bytes);
}
