export type PlatformResource =
  | "leads"
  | "tenant"
  | "plan"
  | "entitlements"
  | "users"
  | "onboarding"
  | "billing"
  | "support"
  | "integrations"
  | "incidents"
  | "audit";

export interface PlatformProjectionPage<T = Record<string, unknown>> {
  resource: PlatformResource;
  availability: "available" | "unavailable";
  reasonCode?: string;
  items: T[];
  nextCursor: string | null;
}

export function unavailablePlatformProjection(
  resource: PlatformResource,
  reasonCode: string,
): PlatformProjectionPage {
  return { resource, availability: "unavailable", reasonCode, items: [], nextCursor: null };
}

export function maskPlatformEmail(email: string, canReadPii: boolean) {
  if (canReadPii) return email;
  const separator = email.lastIndexOf("@");
  if (separator < 1) return "redacted";
  return `${email[0]}***${email.slice(separator)}`;
}

function encodeCursor(offset: number) {
  return Buffer.from(JSON.stringify({ offset }), "utf8").toString("base64url");
}

function decodeCursor(cursor: string | undefined) {
  if (!cursor) return 0;
  try {
    const parsed = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8")) as {
      offset?: unknown;
    };
    if (!Number.isInteger(parsed.offset) || (parsed.offset as number) < 0) throw new Error();
    return parsed.offset as number;
  } catch {
    throw new Error("INVALID_CURSOR");
  }
}

export function paginatePlatformItems<T>(items: T[], limit: number, cursor: string | undefined) {
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new Error("INVALID_LIMIT");
  const offset = decodeCursor(cursor);
  const page = items.slice(offset, offset + limit);
  return {
    items: page,
    nextCursor: offset + page.length < items.length ? encodeCursor(offset + page.length) : null,
  };
}

export function sanitizePlatformIntegration(input: {
  id: string;
  unitId: string | null;
  provider: string;
  status: string;
  credentialReference?: string | null;
  config?: Record<string, unknown>;
  updatedAt: Date;
}) {
  return {
    id: input.id,
    unitId: input.unitId,
    provider: input.provider,
    status: input.status,
    updatedAt: input.updatedAt.toISOString(),
  };
}

export function sanitizePlatformAuditItem(input: {
  id: string;
  action: string;
  entityType: string;
  entityId: string | null;
  metadata?: Record<string, unknown>;
  occurredAt: Date;
}) {
  return {
    id: input.id,
    action: input.action,
    entityType: input.entityType,
    entityId: input.entityId,
    occurredAt: input.occurredAt.toISOString(),
  };
}
