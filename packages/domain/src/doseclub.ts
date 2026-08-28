import { createHash, createHmac } from "node:crypto";

const DOSECLUB_ENTITLEMENTS = new Set(["doseclub", "doseclub.subscription", "bundle"]);

export function includesDoseClubEntitlement(value: unknown): boolean {
  return (
    Array.isArray(value) &&
    value.some((item) => typeof item === "string" && DOSECLUB_ENTITLEMENTS.has(item))
  );
}

export function doseClubManagedCredential(integrationId: string, masterSecret: string) {
  if (!integrationId.trim()) throw new Error("DOSECLUB_INTEGRATION_ID_INVALID");
  if (masterSecret.trim().length < 32) throw new Error("DOSECLUB_CREDENTIAL_SECRET_INVALID");
  const token = createHmac("sha256", masterSecret)
    .update(`giromesa:doseclub:${integrationId}`)
    .digest("base64url");
  return {
    token,
    reference: `managed:v1:${createHash("sha256").update(token).digest("hex")}`,
  };
}
