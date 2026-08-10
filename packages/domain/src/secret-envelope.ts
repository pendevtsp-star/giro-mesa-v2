import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

export interface SecretEnvelope {
  encryptedSecret: string;
  iv: string;
  authTag: string;
}

export function encryptionKey(value: string | undefined, variableName: string) {
  if (!value) throw new Error(`${variableName} is required`);
  const key = Buffer.from(value, "base64");
  if (key.length !== 32) throw new Error(`${variableName} must be 32 bytes encoded as base64`);
  return key;
}

export function encryptSecret(
  secret: string,
  key: Buffer,
  associatedData?: string,
): SecretEnvelope {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  if (associatedData) cipher.setAAD(Buffer.from(associatedData));
  const encrypted = Buffer.concat([cipher.update(secret, "utf8"), cipher.final()]);
  return {
    encryptedSecret: encrypted.toString("base64url"),
    iv: iv.toString("hex"),
    authTag: cipher.getAuthTag().toString("hex"),
  };
}

export function decryptSecret(value: SecretEnvelope, key: Buffer, associatedData?: string) {
  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(value.iv, "hex"));
  if (associatedData) decipher.setAAD(Buffer.from(associatedData));
  decipher.setAuthTag(Buffer.from(value.authTag, "hex"));
  return Buffer.concat([
    decipher.update(Buffer.from(value.encryptedSecret, "base64url")),
    decipher.final(),
  ]).toString("utf8");
}
