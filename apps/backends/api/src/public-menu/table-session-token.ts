import { createHmac, timingSafeEqual } from "node:crypto";
import { tableAccessSecret } from "./table-access-token.js";

export const TABLE_SESSION_COOKIE_NAME = "giromesa_table_session";
export const TABLE_SESSION_TTL_SECONDS = 4 * 60 * 60;

const slugPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type TableSessionClaims = {
  v: 1;
  slug: string;
  organizationId: string;
  unitId: string;
  tableId: string;
  tabId?: string;
  tokenVersion: number;
  exp: number;
};

export function createTableSessionToken(
  input: Omit<TableSessionClaims, "v">,
  secret = tableAccessSecret(),
): string {
  const claims: TableSessionClaims = { v: 1, ...input };
  if (!validClaims(claims) || claims.exp <= Math.floor(Date.now() / 1_000)) {
    throw new Error("Invalid table session claims");
  }
  const encoded = Buffer.from(JSON.stringify(claims), "utf8").toString("base64url");
  return `${encoded}.${signature(encoded, secret)}`;
}

export function verifyTableSessionToken(
  token: string,
  expectedSlug: string,
  secret = tableAccessSecret(),
  nowSeconds = Math.floor(Date.now() / 1_000),
): TableSessionClaims | null {
  if (token.length > 2_048) return null;
  const [encoded, suppliedSignature, extra] = token.split(".");
  if (!encoded || !suppliedSignature || extra || !/^[A-Za-z0-9_-]+$/.test(encoded)) return null;
  const expectedSignature = signature(encoded, secret);
  const supplied = Buffer.from(suppliedSignature, "utf8");
  const expected = Buffer.from(expectedSignature, "utf8");
  if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) return null;
  try {
    const claims: unknown = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8"));
    return validClaims(claims) && claims.slug === expectedSlug && claims.exp > nowSeconds
      ? claims
      : null;
  } catch {
    return null;
  }
}

function signature(value: string, secret: string): string {
  return createHmac("sha256", secret)
    .update(`giromesa:table-session:v1:${value}`)
    .digest("base64url");
}

function validClaims(value: unknown): value is TableSessionClaims {
  if (typeof value !== "object" || value === null) return false;
  const claims = value as Partial<TableSessionClaims>;
  return (
    claims.v === 1 &&
    typeof claims.slug === "string" &&
    claims.slug.length >= 3 &&
    claims.slug.length <= 100 &&
    slugPattern.test(claims.slug) &&
    [claims.organizationId, claims.unitId, claims.tableId].every(
      (id) => typeof id === "string" && uuidPattern.test(id),
    ) &&
    (claims.tabId === undefined || uuidPattern.test(claims.tabId)) &&
    Number.isSafeInteger(claims.tokenVersion) &&
    (claims.tokenVersion ?? -1) >= 0 &&
    Number.isSafeInteger(claims.exp) &&
    (claims.exp ?? 0) > 0
  );
}
