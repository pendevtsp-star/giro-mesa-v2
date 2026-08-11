import { createHmac, timingSafeEqual } from "node:crypto";
import { PRICE_REFERENCE_OCCURRED_AT_SKEW_MS, PRICE_REFERENCE_VALIDITY_MS } from "@giromesa/domain";
import { canonicalJson } from "./canonical-json.js";
import {
  type CommandFingerprintKeyring,
  loadCommandFingerprintKeyring,
} from "./command-fingerprint.js";

type PriceReferenceKind = "product" | "modifier-option";
type PriceReferenceMaterial = Readonly<{
  keyVersion: string;
  kind: PriceReferenceKind;
  entityId: string;
  organizationId: string;
  unitId: string;
  priceCents: number;
  priceRevision: string;
  issuedAt: string;
  expiresAt: string;
}>;

function signature(material: PriceReferenceMaterial, key: Buffer) {
  return createHmac("sha256", key).update(canonicalJson(material)).digest();
}

export function createPriceReference(
  material: Omit<PriceReferenceMaterial, "keyVersion" | "issuedAt" | "expiresAt">,
  keyring: CommandFingerprintKeyring = loadCommandFingerprintKeyring(),
  issuedAt = new Date(),
) {
  const complete = {
    ...material,
    issuedAt: issuedAt.toISOString(),
    expiresAt: new Date(issuedAt.getTime() + PRICE_REFERENCE_VALIDITY_MS).toISOString(),
    keyVersion: keyring.activeVersion,
  };
  const key = keyring.keys.get(complete.keyVersion);
  if (!key) throw new Error("COMMAND_FINGERPRINT_ACTIVE_KEY_UNAVAILABLE");
  return `${Buffer.from(JSON.stringify(complete)).toString("base64url")}.${signature(complete, key).toString("base64url")}`;
}

export function verifyPriceReference(
  token: string,
  expected: {
    kind: PriceReferenceKind;
    entityId: string;
    organizationId: string;
    unitId: string;
    priceRevision: string;
    occurredAt: string | Date;
  },
  keyring: CommandFingerprintKeyring = loadCommandFingerprintKeyring(),
  now = new Date(),
) {
  const [encoded, encodedSignature, extra] = token.split(".");
  if (!encoded || !encodedSignature || extra) throw new Error("PRICE_REFERENCE_INVALID");
  let material: PriceReferenceMaterial;
  try {
    material = JSON.parse(
      Buffer.from(encoded, "base64url").toString("utf8"),
    ) as PriceReferenceMaterial;
  } catch {
    throw new Error("PRICE_REFERENCE_INVALID");
  }
  const key = keyring.keys.get(material.keyVersion);
  if (
    !key ||
    !Number.isSafeInteger(material.priceCents) ||
    material.priceCents < 0 ||
    typeof material.priceRevision !== "string" ||
    typeof material.issuedAt !== "string" ||
    typeof material.expiresAt !== "string"
  )
    throw new Error("PRICE_REFERENCE_INVALID");
  const actual = Buffer.from(encodedSignature, "base64url");
  const expectedSignature = signature(material, key);
  if (actual.length !== expectedSignature.length || !timingSafeEqual(actual, expectedSignature))
    throw new Error("PRICE_REFERENCE_INVALID");
  if (
    material.kind !== expected.kind ||
    material.entityId !== expected.entityId ||
    material.organizationId !== expected.organizationId ||
    material.unitId !== expected.unitId
  )
    throw new Error("PRICE_REFERENCE_SCOPE_MISMATCH");
  if (material.priceRevision !== expected.priceRevision)
    throw new Error("PRICE_REFERENCE_REVISION_MISMATCH");
  const issuedAt = Date.parse(material.issuedAt);
  const expiresAt = Date.parse(material.expiresAt);
  const occurredAt = new Date(expected.occurredAt).getTime();
  if (
    !Number.isFinite(issuedAt) ||
    !Number.isFinite(expiresAt) ||
    !Number.isFinite(occurredAt) ||
    expiresAt - issuedAt !== PRICE_REFERENCE_VALIDITY_MS
  )
    throw new Error("PRICE_REFERENCE_INVALID");
  if (now.getTime() < issuedAt) throw new Error("PRICE_REFERENCE_NOT_YET_VALID");
  if (now.getTime() > expiresAt) throw new Error("PRICE_REFERENCE_EXPIRED");
  if (occurredAt < issuedAt - PRICE_REFERENCE_OCCURRED_AT_SKEW_MS || occurredAt > expiresAt)
    throw new Error("PRICE_REFERENCE_COMMAND_OUTSIDE_VALIDITY");
  return material.priceCents;
}
