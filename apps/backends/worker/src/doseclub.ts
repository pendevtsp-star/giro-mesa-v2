import { auditEvents, type Database, doseClubRedemptions, growthIntegrations } from "@giromesa/db";
import { doseClubManagedCredential } from "@giromesa/domain";
import { and, eq, inArray } from "drizzle-orm";

const INTEGRATION_PATH = "/v1/integrations/giromesa";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type OperationStatus = "reserved" | "committed" | "canceled" | "expired" | "reversed";

type OperationResponse = {
  operationId: string;
  status: OperationStatus;
  availableDoses: number;
  reservedAt: string;
  expiresAt: string;
  committedAt: string | null;
  canceledAt: string | null;
  expiredAt: string | null;
  reversedAt: string | null;
  updatedAt: string;
};

type OutboxEvent = {
  id: string;
  payload: Record<string, unknown>;
};

export class DoseClubDeliveryError extends Error {
  constructor(
    readonly code: string,
    readonly retryable: boolean,
    message = code,
  ) {
    super(message);
    this.name = "DoseClubDeliveryError";
  }
}

function requiredUuid(payload: Record<string, unknown>, key: string) {
  const value = payload[key];
  if (typeof value !== "string" || !UUID.test(value)) {
    throw new DoseClubDeliveryError("DOSECLUB_EVENT_INVALID", false);
  }
  return value;
}

function optionalReason(payload: Record<string, unknown>) {
  const value = payload.reason;
  return typeof value === "string" && value.trim()
    ? value.trim().slice(0, 500)
    : "Cancelamento autorizado";
}

function parseDate(value: string | null) {
  if (!value) return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.valueOf())) {
    throw new DoseClubDeliveryError("DOSECLUB_RESPONSE_INVALID", false);
  }
  return parsed;
}

function connectionConfig(row: typeof growthIntegrations.$inferSelect) {
  if (process.env.DOSECLUB_PROVIDER_ENABLED !== "true" || row.status !== "active") {
    throw new DoseClubDeliveryError("DOSECLUB_CONNECTION_INACTIVE", false);
  }
  const config = row.config;
  const apiBaseUrl = typeof config.apiBaseUrl === "string" ? config.apiBaseUrl.trim() : "";
  const clientId = typeof config.clientId === "string" ? config.clientId.trim() : "";
  const credentialReference = row.credentialReference?.trim() ?? "";
  let secret = credentialReference ? process.env[credentialReference]?.trim() : "";
  if (credentialReference.startsWith("managed:v1:")) {
    try {
      const managed = doseClubManagedCredential(
        row.id,
        process.env.DOSECLUB_CREDENTIAL_SECRET ?? "",
      );
      secret = managed.reference === credentialReference ? managed.token : "";
    } catch {
      secret = "";
    }
  }
  if (!apiBaseUrl || !clientId || !secret) {
    throw new DoseClubDeliveryError("DOSECLUB_CREDENTIALS_NOT_CONFIGURED", false);
  }
  const url = new URL(apiBaseUrl);
  if (process.env.NODE_ENV === "production" && url.protocol !== "https:") {
    throw new DoseClubDeliveryError("DOSECLUB_HTTPS_REQUIRED", false);
  }
  const normalizedPath = url.pathname.replace(/\/+$/, "");
  if (normalizedPath.endsWith(INTEGRATION_PATH)) {
    url.pathname = normalizedPath.slice(0, -INTEGRATION_PATH.length) || "/";
  }
  url.search = "";
  url.hash = "";
  return {
    baseUrl: `${url.origin}${url.pathname.replace(/\/$/, "")}${INTEGRATION_PATH}`,
    clientId,
    secret,
  };
}

function operationResponse(value: unknown): OperationResponse {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new DoseClubDeliveryError("DOSECLUB_RESPONSE_INVALID", false);
  }
  const row = value as Record<string, unknown>;
  const status = row.status;
  if (
    typeof row.operationId !== "string" ||
    !["reserved", "committed", "canceled", "expired", "reversed"].includes(String(status)) ||
    !Number.isInteger(row.availableDoses) ||
    typeof row.reservedAt !== "string" ||
    typeof row.expiresAt !== "string" ||
    typeof row.updatedAt !== "string"
  ) {
    throw new DoseClubDeliveryError("DOSECLUB_RESPONSE_INVALID", false);
  }
  return row as OperationResponse;
}

async function requestOperation(
  connection: ReturnType<typeof connectionConfig>,
  input: {
    path: string;
    method?: "GET" | "POST";
    idempotencyKey?: string;
    body?: Record<string, unknown>;
  },
) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10_000);
  let response: Response;
  try {
    response = await fetch(`${connection.baseUrl}${input.path}`, {
      headers: {
        ...(input.body ? { "content-type": "application/json" } : {}),
        ...(input.idempotencyKey ? { "idempotency-key": input.idempotencyKey } : {}),
        "x-giromesa-client-id": connection.clientId,
        "x-giromesa-integration-key": connection.secret,
      },
      method: input.method ?? "POST",
      ...(input.body ? { body: JSON.stringify(input.body) } : {}),
      signal: controller.signal,
    });
  } catch (error) {
    const code =
      error instanceof Error && error.name === "AbortError"
        ? "DOSECLUB_TIMEOUT"
        : "DOSECLUB_UNREACHABLE";
    throw new DoseClubDeliveryError(code, true);
  } finally {
    clearTimeout(timeout);
  }
  if (!response.ok) {
    const retryable = response.status === 408 || response.status === 429 || response.status >= 500;
    throw new DoseClubDeliveryError(`DOSECLUB_HTTP_${response.status}`, retryable);
  }
  return operationResponse(await response.json());
}

async function integration(
  database: Database,
  organizationId: string,
  unitId: string,
  integrationId: string,
) {
  const [row] = await database
    .select()
    .from(growthIntegrations)
    .where(
      and(
        eq(growthIntegrations.id, integrationId),
        eq(growthIntegrations.organizationId, organizationId),
        eq(growthIntegrations.provider, "doseclub"),
      ),
    )
    .limit(1);
  if (!row || (row.unitId !== null && row.unitId !== unitId)) {
    throw new DoseClubDeliveryError("DOSECLUB_CONNECTION_NOT_FOUND", false);
  }
  return connectionConfig(row);
}

async function recordFailure(
  database: Database,
  redemptionId: string,
  error: DoseClubDeliveryError,
) {
  await database
    .update(doseClubRedemptions)
    .set({
      lastErrorCode: error.code,
      lastErrorMessage: error.message.slice(0, 500),
      updatedAt: new Date(),
    })
    .where(eq(doseClubRedemptions.id, redemptionId));
}

function operationUpdate(operation: OperationResponse) {
  return {
    operationId: operation.operationId,
    status: operation.status,
    availableDoses: operation.availableDoses,
    reservedAt: parseDate(operation.reservedAt),
    expiresAt: parseDate(operation.expiresAt),
    committedAt: parseDate(operation.committedAt),
    canceledAt: parseDate(operation.canceledAt),
    expiredAt: parseDate(operation.expiredAt),
    reversedAt: parseDate(operation.reversedAt),
    lastErrorCode: null,
    lastErrorMessage: null,
    updatedAt: new Date(operation.updatedAt),
  };
}

export async function commitOrderDoseClubRedemptions(database: Database, event: OutboxEvent) {
  const organizationId = requiredUuid(event.payload, "organizationId");
  const unitId = requiredUuid(event.payload, "unitId");
  const orderId = requiredUuid(event.payload, "orderId");
  const rows = await database
    .select()
    .from(doseClubRedemptions)
    .where(
      and(
        eq(doseClubRedemptions.organizationId, organizationId),
        eq(doseClubRedemptions.unitId, unitId),
        eq(doseClubRedemptions.orderId, orderId),
        inArray(doseClubRedemptions.status, ["reserved", "commit_pending", "committed"]),
      ),
    );
  for (const row of rows) {
    if (row.status === "committed") continue;
    if (!row.operationId) {
      throw new DoseClubDeliveryError("DOSECLUB_RESERVATION_MISSING", false);
    }
    try {
      const connection = await integration(database, organizationId, unitId, row.integrationId);
      const operation = await requestOperation(connection, {
        path: `/consumption-reservations/${encodeURIComponent(row.operationId)}/commit`,
        idempotencyKey: `gm:${organizationId}:${unitId}:${row.orderItemId}:commit`,
      });
      if (operation.status !== "committed") {
        throw new DoseClubDeliveryError(`DOSECLUB_COMMIT_${operation.status.toUpperCase()}`, false);
      }
      await database.transaction(async (tx) => {
        await tx
          .update(doseClubRedemptions)
          .set({ ...operationUpdate(operation), version: row.version + 1 })
          .where(
            and(eq(doseClubRedemptions.id, row.id), eq(doseClubRedemptions.version, row.version)),
          );
        await tx.insert(auditEvents).values({
          organizationId,
          unitId,
          action: "doseclub.redemption.committed",
          entityType: "pos_order_item",
          entityId: row.orderItemId,
          metadata: { orderId, operationId: operation.operationId, doses: row.doses },
        });
      });
    } catch (error) {
      const deliveryError =
        error instanceof DoseClubDeliveryError
          ? error
          : new DoseClubDeliveryError("DOSECLUB_COMMIT_FAILED", true);
      await recordFailure(database, row.id, deliveryError);
      throw deliveryError;
    }
  }
}

export async function reverseCanceledDoseClubRedemption(database: Database, event: OutboxEvent) {
  const organizationId = requiredUuid(event.payload, "organizationId");
  const unitId = requiredUuid(event.payload, "unitId");
  const itemId = requiredUuid(event.payload, "itemId");
  const [row] = await database
    .select()
    .from(doseClubRedemptions)
    .where(
      and(
        eq(doseClubRedemptions.organizationId, organizationId),
        eq(doseClubRedemptions.unitId, unitId),
        eq(doseClubRedemptions.orderItemId, itemId),
      ),
    )
    .limit(1);
  if (!row || ["canceled", "expired", "reversed"].includes(row.status)) return;
  if (!row.operationId) {
    await database
      .update(doseClubRedemptions)
      .set({ status: "canceled", canceledAt: new Date(), updatedAt: new Date() })
      .where(eq(doseClubRedemptions.id, row.id));
    return;
  }
  try {
    const connection = await integration(database, organizationId, unitId, row.integrationId);
    let operation = await requestOperation(connection, {
      method: "GET",
      path: `/operations/${encodeURIComponent(row.operationId)}`,
    });
    if (operation.status === "reserved") {
      operation = await requestOperation(connection, {
        path: `/consumption-reservations/${encodeURIComponent(row.operationId)}/cancel`,
        idempotencyKey: `gm:${organizationId}:${unitId}:${itemId}:cancel`,
        body: { reason: optionalReason(event.payload) },
      });
    } else if (operation.status === "committed") {
      operation = await requestOperation(connection, {
        path: "/consumption-reversals",
        idempotencyKey: `gm:${organizationId}:${unitId}:${itemId}:reverse`,
        body: {
          operationId: row.operationId,
          externalReversalId: event.id,
          idempotencyKey: `gm:${organizationId}:${unitId}:${itemId}:reverse`,
          reason: optionalReason(event.payload),
        },
      });
    }
    if (!["canceled", "expired", "reversed"].includes(operation.status)) {
      throw new DoseClubDeliveryError(`DOSECLUB_REVERSE_${operation.status.toUpperCase()}`, false);
    }
    await database.transaction(async (tx) => {
      await tx
        .update(doseClubRedemptions)
        .set({ ...operationUpdate(operation), version: row.version + 1 })
        .where(eq(doseClubRedemptions.id, row.id));
      await tx.insert(auditEvents).values({
        organizationId,
        unitId,
        action:
          operation.status === "reversed"
            ? "doseclub.redemption.reversed"
            : "doseclub.redemption.canceled",
        entityType: "pos_order_item",
        entityId: row.orderItemId,
        metadata: {
          operationId: operation.operationId,
          doses: row.doses,
          reason: optionalReason(event.payload),
        },
      });
    });
  } catch (error) {
    const deliveryError =
      error instanceof DoseClubDeliveryError
        ? error
        : new DoseClubDeliveryError("DOSECLUB_REVERSE_FAILED", true);
    await recordFailure(database, row.id, deliveryError);
    throw deliveryError;
  }
}
