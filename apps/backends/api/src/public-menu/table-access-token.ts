import { createHmac, timingSafeEqual } from "node:crypto";

const slugPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type TableAccessClaims = {
  v: 1;
  slug: string;
  tableId: string;
  tokenVersion: number;
  exp: number;
};

export function tableAccessSecret(environment: NodeJS.ProcessEnv = process.env): string {
  const dedicated = environment.QR_TABLE_TOKEN_SECRET?.trim();
  if (dedicated && dedicated.length >= 32) return dedicated;
  if (environment.NODE_ENV !== "production") {
    const developmentFallback = environment.SESSION_SECRET?.trim();
    if (developmentFallback && developmentFallback.length >= 32) return developmentFallback;
  }
  throw new Error("QR_TABLE_TOKEN_SECRET must contain at least 32 characters");
}

export function createTableAccessToken(
  input: Omit<TableAccessClaims, "v">,
  secret = tableAccessSecret(),
): string {
  const claims: TableAccessClaims = { v: 1, ...input };
  if (!validClaims(claims) || claims.exp <= Math.floor(Date.now() / 1_000)) {
    throw new Error("Invalid table access claims");
  }
  const encoded = Buffer.from(JSON.stringify(claims), "utf8").toString("base64url");
  return `${encoded}.${signature(encoded, secret)}`;
}

export function verifyTableAccessToken(
  token: string,
  expectedSlug: string,
  secret = tableAccessSecret(),
  nowSeconds = Math.floor(Date.now() / 1_000),
): TableAccessClaims | null {
  if (token.length > 1_024) return null;
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
    .update(`giromesa:table-access:v1:${value}`)
    .digest("base64url");
}

function validClaims(value: unknown): value is TableAccessClaims {
  if (typeof value !== "object" || value === null) return false;
  const claims = value as Partial<TableAccessClaims>;
  return (
    claims.v === 1 &&
    typeof claims.slug === "string" &&
    claims.slug.length >= 3 &&
    claims.slug.length <= 100 &&
    slugPattern.test(claims.slug) &&
    typeof claims.tableId === "string" &&
    uuidPattern.test(claims.tableId) &&
    Number.isSafeInteger(claims.tokenVersion) &&
    (claims.tokenVersion ?? -1) >= 0 &&
    Number.isSafeInteger(claims.exp) &&
    (claims.exp ?? 0) > 0
  );
}
