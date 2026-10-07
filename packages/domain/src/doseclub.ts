import { createHash, createHmac } from "node:crypto";

const DOSECLUB_ENTITLEMENTS = new Set(["doseclub", "doseclub.subscription", "bundle"]);
export const DOSECLUB_MANUAL_CREDENTIAL_REFERENCE = "DOSECLUB_INTEGRATION_KEY";
const MANAGED_CREDENTIAL_REFERENCE = /^managed:v1:[a-f0-9]{64}$/;

export function trustedDoseClubBaseUrl(
  credentialReference: string,
  storedBaseUrl: string,
  configuredBaseUrl: string | undefined,
): string {
  if (
    credentialReference !== DOSECLUB_MANUAL_CREDENTIAL_REFERENCE &&
    !MANAGED_CREDENTIAL_REFERENCE.test(credentialReference)
  ) {
    throw new Error("DOSECLUB_CREDENTIAL_REFERENCE_INVALID");
  }
  if (!configuredBaseUrl?.trim()) throw new Error("DOSECLUB_API_BASE_URL_REQUIRED");
  let stored: URL;
  let configured: URL;
  try {
    stored = new URL(storedBaseUrl);
    configured = new URL(configuredBaseUrl.trim());
  } catch {
    throw new Error("DOSECLUB_API_BASE_URL_INVALID");
  }
  if (stored.origin !== configured.origin) throw new Error("DOSECLUB_API_ORIGIN_MISMATCH");
  return configuredBaseUrl.trim();
}

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
