import { createHmac, timingSafeEqual } from "node:crypto";
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
}>;

function signature(material: PriceReferenceMaterial, key: Buffer) {
  return createHmac("sha256", key).update(canonicalJson(material)).digest();
}

export function createPriceReference(
  material: Omit<PriceReferenceMaterial, "keyVersion">,
  keyring: CommandFingerprintKeyring = loadCommandFingerprintKeyring(),
) {
  const complete = { ...material, keyVersion: keyring.activeVersion };
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
  },
  keyring: CommandFingerprintKeyring = loadCommandFingerprintKeyring(),
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
  if (!key || !Number.isSafeInteger(material.priceCents) || material.priceCents < 0)
    throw new Error("PRICE_REFERENCE_INVALID");
  if (
    material.kind !== expected.kind ||
    material.entityId !== expected.entityId ||
    material.organizationId !== expected.organizationId ||
    material.unitId !== expected.unitId
  )
    throw new Error("PRICE_REFERENCE_SCOPE_MISMATCH");
  const actual = Buffer.from(encodedSignature, "base64url");
  const expectedSignature = signature(material, key);
  if (actual.length !== expectedSignature.length || !timingSafeEqual(actual, expectedSignature))
    throw new Error("PRICE_REFERENCE_INVALID");
  return material.priceCents;
}
