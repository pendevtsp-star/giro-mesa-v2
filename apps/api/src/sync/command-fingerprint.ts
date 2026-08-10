import { createHmac, timingSafeEqual } from "node:crypto";
import type { CommandEnvelope } from "@giromesa/domain";
import { canonicalJson } from "./canonical-json.js";

const keyVersionPattern = /^[A-Za-z0-9._-]{1,32}$/;
const base64UrlPattern = /^[A-Za-z0-9_-]+$/;

export type CommandFingerprint = Readonly<{
  keyVersion: string;
  digest: string;
}>;

export type CommandFingerprintKeyring = Readonly<{
  activeVersion: string;
  keys: ReadonlyMap<string, Buffer>;
}>;

export function loadCommandFingerprintKeyring(
  environment: Record<string, string | undefined> = process.env,
): CommandFingerprintKeyring {
  const activeVersion = environment.COMMAND_FINGERPRINT_ACTIVE_KEY_VERSION;
  const serializedKeys = environment.COMMAND_FINGERPRINT_KEYS;
  if (!activeVersion || !serializedKeys) {
    throw new Error("COMMAND_FINGERPRINT_KEYRING_MISSING");
  }
  if (!keyVersionPattern.test(activeVersion)) {
    throw new Error("COMMAND_FINGERPRINT_KEY_VERSION_INVALID");
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(serializedKeys);
  } catch {
    throw new Error("COMMAND_FINGERPRINT_KEYRING_INVALID");
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("COMMAND_FINGERPRINT_KEYRING_INVALID");
  }

  const keys = new Map<string, Buffer>();
  for (const [version, encodedKey] of Object.entries(parsed as Record<string, unknown>)) {
    if (
      !keyVersionPattern.test(version) ||
      typeof encodedKey !== "string" ||
      !base64UrlPattern.test(encodedKey)
    ) {
      throw new Error("COMMAND_FINGERPRINT_KEY_INVALID");
    }
    const decoded = Buffer.from(encodedKey, "base64url");
    if (decoded.byteLength < 32) throw new Error("COMMAND_FINGERPRINT_KEY_INVALID");
    keys.set(version, decoded);
  }
  if (!keys.has(activeVersion)) throw new Error("COMMAND_FINGERPRINT_ACTIVE_KEY_UNAVAILABLE");
  return Object.freeze({ activeVersion, keys });
}

export function commandFingerprintMaterial(envelope: CommandEnvelope) {
  const { receivedAt: _receivedAt, ...stableEnvelope } = envelope;
  return canonicalJson(stableEnvelope);
}

function digest(envelope: CommandEnvelope, key: Buffer) {
  return createHmac("sha256", key).update(commandFingerprintMaterial(envelope)).digest("hex");
}

export function createCommandFingerprint(
  envelope: CommandEnvelope,
  keyring: CommandFingerprintKeyring,
): CommandFingerprint {
  const key = keyring.keys.get(keyring.activeVersion);
  if (!key) throw new Error("COMMAND_FINGERPRINT_ACTIVE_KEY_UNAVAILABLE");
  return Object.freeze({ keyVersion: keyring.activeVersion, digest: digest(envelope, key) });
}

export function verifyCommandFingerprint(
  envelope: CommandEnvelope,
  stored: CommandFingerprint,
  keyring: CommandFingerprintKeyring,
) {
  const key = keyring.keys.get(stored.keyVersion);
  if (!key) throw new Error("COMMAND_FINGERPRINT_KEY_VERSION_UNAVAILABLE");
  if (!/^[0-9a-f]{64}$/.test(stored.digest)) return false;
  return timingSafeEqual(
    Buffer.from(stored.digest, "hex"),
    Buffer.from(digest(envelope, key), "hex"),
  );
}
