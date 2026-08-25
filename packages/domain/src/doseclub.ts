import { createHash, createHmac } from "node:crypto";

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
