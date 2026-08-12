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

function maskPlatformName(name: string, canReadPii: boolean) {
  if (canReadPii) return name;
  const normalized = name.trim();
  return normalized.length > 0 ? `${normalized[0]}***` : "redacted";
}

function maskPlatformPhone(phone: string, canReadPii: boolean) {
  if (canReadPii) return phone;
  return phone.length > 4 ? `${"*".repeat(phone.length - 4)}${phone.slice(-4)}` : "redacted";
}

export function sanitizePlatformLead(
  input: {
    id: string;
    name: string;
    email: string;
    phone: string;
    businessName: string;
    segment: string | null;
    planSlug: string;
    consentedAt: Date;
    createdAt: Date;
  },
  canReadPii: boolean,
) {
  return {
    id: input.id,
    displayName: maskPlatformName(input.name, canReadPii),
    email: maskPlatformEmail(input.email, canReadPii),
    phone: maskPlatformPhone(input.phone, canReadPii),
    businessName: input.businessName,
    segment: input.segment,
    planSlug: input.planSlug,
    submittedAt: input.createdAt.toISOString(),
    actionAvailability: "unavailable" as const,
    actionReasonCode: "LEAD_WORKFLOW_NOT_AVAILABLE" as const,
  };
}

export function sanitizePlatformSupportRequest(
  input: {
    id: string;
    name: string;
    email: string;
    phone: string;
    message?: string;
    consentedAt: Date;
    createdAt: Date;
  },
  canReadPii: boolean,
) {
  return {
    id: input.id,
    displayName: maskPlatformName(input.name, canReadPii),
    email: maskPlatformEmail(input.email, canReadPii),
    phone: maskPlatformPhone(input.phone, canReadPii),
    submittedAt: input.createdAt.toISOString(),
    actionAvailability: "unavailable" as const,
    actionReasonCode: "SUPPORT_WORKFLOW_NOT_AVAILABLE" as const,
  };
}

type PlatformIncidentStatus = "reported" | "under_review" | "approved" | "rejected" | "closed";

const incidentActions: Record<PlatformIncidentStatus, string[]> = {
  reported: ["incident.review"],
  under_review: ["incident.approve", "incident.reject"],
  approved: ["incident.close"],
  rejected: ["incident.close"],
  closed: [],
};

export function sanitizePlatformIncident(input: {
  id: string;
  organizationId: string;
  unitId: string;
  incidentType: string;
  status: PlatformIncidentStatus;
  neutralSummary: string;
  evidence?: Record<string, unknown>[];
  amountCents: number | null;
  payrollAction?: boolean;
  idempotencyKey?: string;
  requestHash?: string;
  reporterIdentityId: string;
  approverIdentityId: string | null;
  occurredAt: Date;
  updatedAt: Date;
}) {
  return {
    id: input.id,
    organizationId: input.organizationId,
    unitId: input.unitId,
    incidentType: input.incidentType,
    status: input.status,
    neutralSummary: input.neutralSummary,
    amountCents: input.amountCents,
    reporterIdentityId: input.reporterIdentityId,
    approverIdentityId: input.approverIdentityId,
    occurredAt: input.occurredAt.toISOString(),
    updatedAt: input.updatedAt.toISOString(),
    availableActions: incidentActions[input.status],
  };
}

function encodeCursor(offset: number) {
  return Buffer.from(JSON.stringify({ offset }), "utf8").toString("base64url");
}

const platformKeysetIdPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type PlatformKeysetRow = { id: string };

function encodePlatformKeysetCursor(row: PlatformKeysetRow, timestamp: Date) {
  return Buffer.from(
    JSON.stringify({ createdAt: timestamp.toISOString(), id: row.id }),
    "utf8",
  ).toString("base64url");
}

export function parsePlatformKeysetPage(limit: number, cursor: string | undefined) {
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new Error("INVALID_LIMIT");
  if (!cursor) return { limit, cursor: null };
  try {
    const parsed = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8")) as {
      createdAt?: unknown;
      id?: unknown;
    };
    if (
      typeof parsed.createdAt !== "string" ||
      typeof parsed.id !== "string" ||
      !platformKeysetIdPattern.test(parsed.id)
    )
      throw new Error();
    const createdAt = new Date(parsed.createdAt);
    if (!Number.isFinite(createdAt.getTime()) || createdAt.toISOString() !== parsed.createdAt)
      throw new Error();
    return { limit, cursor: { createdAt, id: parsed.id } };
  } catch {
    throw new Error("INVALID_CURSOR");
  }
}

export function finalizePlatformKeysetPage<T extends PlatformKeysetRow, R>(
  rows: T[],
  limit: number,
  project: (row: T) => R,
  timestamp: (row: T) => Date,
) {
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new Error("INVALID_LIMIT");
  const visible = rows.slice(0, limit);
  const last = visible.at(-1);
  return {
    items: visible.map(project),
    nextCursor:
      rows.length > limit && last ? encodePlatformKeysetCursor(last, timestamp(last)) : null,
  };
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
