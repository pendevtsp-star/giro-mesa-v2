import {
  type CancelReservationRequest,
  type CommitReservationRequest,
  DOSECLUB_INTEGRATION_PATH,
  DOSECLUB_OPERATION_STATUSES,
  type DoseClubEligibleMembership,
  type DoseClubEligibleProduct,
  type DoseClubHealth,
  type DoseClubIntegrationClient,
  type DoseClubOfferSummary,
  type DoseClubOperation,
  type DoseClubOperationStatus,
  type ListEligibleMembershipsRequest,
  type ListEligibleMembershipsResponse,
  type ReserveConsumptionRequest,
  type ReverseConsumptionRequest,
} from "./doseclub-contract.js";

const DEFAULT_TIMEOUT_MS = 10_000;
const MAX_RESPONSE_BYTES = 1_048_576;
const EXTERNAL_ID_MAX_LENGTH = 200;
const IDEMPOTENCY_KEY_MIN_LENGTH = 8;
const REASON_MAX_LENGTH = 500;
const NORMALIZABLE_PATHS = new Set(["", "/", "/v1", DOSECLUB_INTEGRATION_PATH]);
const OPERATION_STATUSES = new Set<string>(DOSECLUB_OPERATION_STATUSES);
const ISO_INSTANT_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;

export interface DoseClubHttpClientOptions {
  baseUrl: string;
  clientId: string;
  integrationKey: string;
  timeoutMs?: number;
  environment?: string;
  fetcher?: typeof fetch;
}

export type DoseClubClientErrorCode =
  | "DOSECLUB_CONFIG_INVALID"
  | "DOSECLUB_PAYLOAD_INVALID"
  | "DOSECLUB_TIMEOUT"
  | "DOSECLUB_UNAVAILABLE"
  | "DOSECLUB_HTTP_ERROR"
  | "DOSECLUB_RESPONSE_INVALID";

export class DoseClubClientError extends Error {
  constructor(
    message: string,
    readonly code: DoseClubClientErrorCode,
    readonly status: number | null,
    readonly retryable: boolean,
    readonly responseBody: unknown = null,
  ) {
    super(message);
    this.name = "DoseClubClientError";
  }
}

export function normalizeDoseClubIntegrationBaseUrl(
  input: string,
  environment = process.env.NODE_ENV,
): string {
  let url: URL;
  try {
    url = new URL(input.trim());
  } catch {
    throw configurationError("Dose Club baseUrl must be an absolute URL.");
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw configurationError("Dose Club baseUrl must use HTTP or HTTPS.");
  }
  if (environment === "production" && url.protocol !== "https:") {
    throw configurationError("Dose Club baseUrl must use HTTPS in production.");
  }
  if (url.username || url.password || url.search || url.hash) {
    throw configurationError(
      "Dose Club baseUrl cannot contain credentials, query parameters or fragments.",
    );
  }

  const pathname = url.pathname.replace(/\/+$/, "") || "/";
  if (!NORMALIZABLE_PATHS.has(pathname)) {
    throw configurationError(
      "Dose Club baseUrl must contain only the origin or a recognized API suffix.",
    );
  }

  return `${url.origin}${DOSECLUB_INTEGRATION_PATH}`;
}

export class DoseClubHttpClient implements DoseClubIntegrationClient {
  private readonly integrationBaseUrl: string;
  private readonly clientId: string;
  private readonly integrationKey: string;
  private readonly fetcher: typeof fetch;
  private readonly timeoutMs: number;

  constructor(options: DoseClubHttpClientOptions) {
    this.integrationBaseUrl = normalizeDoseClubIntegrationBaseUrl(
      options.baseUrl,
      options.environment,
    );
    this.clientId = requiredConfiguration(options.clientId, "clientId");
    this.integrationKey = requiredConfiguration(options.integrationKey, "integrationKey");
    this.timeoutMs = normalizeTimeout(options.timeoutMs);
    this.fetcher = options.fetcher ?? fetch;
  }

  health(): Promise<DoseClubHealth> {
    return this.request("/health", { method: "GET" }, parseHealth);
  }

  listEligibleMemberships(
    request: ListEligibleMembershipsRequest,
  ): Promise<ListEligibleMembershipsResponse> {
    const externalCustomerId = externalId(request.externalCustomerId, "externalCustomerId");
    const params = new URLSearchParams({
      externalBranchId: externalId(request.externalBranchId, "externalBranchId"),
    });
    if (request.externalProductId !== undefined) {
      params.set("externalProductId", externalId(request.externalProductId, "externalProductId"));
    }

    return this.request(
      `/customers/${encodeURIComponent(externalCustomerId)}/memberships?${params.toString()}`,
      { method: "GET" },
      parseMembershipsResponse,
    );
  }

  reserveConsumption(request: ReserveConsumptionRequest): Promise<DoseClubOperation> {
    const idempotencyKey = normalizeIdempotencyKey(request.idempotencyKey);
    const payload: ReserveConsumptionRequest = {
      externalCustomerId: externalId(request.externalCustomerId, "externalCustomerId"),
      externalBranchId: externalId(request.externalBranchId, "externalBranchId"),
      externalProductId: externalId(request.externalProductId, "externalProductId"),
      externalClubId: externalId(request.externalClubId, "externalClubId"),
      externalCommandId: externalId(request.externalCommandId, "externalCommandId"),
      externalCommandItemId: externalId(request.externalCommandItemId, "externalCommandItemId"),
      doses: integerInRange(request.doses, "doses", 1, 500),
      idempotencyKey,
      ...(request.reason === undefined ? {} : { reason: optionalReason(request.reason, "reason") }),
    };

    return this.mutate("/consumption-reservations", idempotencyKey, payload);
  }

  commitReservation(request: CommitReservationRequest): Promise<DoseClubOperation> {
    const operationId = externalId(request.operationId, "operationId");
    const idempotencyKey = normalizeIdempotencyKey(request.idempotencyKey);
    const body =
      request.externalStockMovementId === undefined
        ? undefined
        : {
            externalStockMovementId: externalId(
              request.externalStockMovementId,
              "externalStockMovementId",
            ),
          };

    return this.mutate(
      `/consumption-reservations/${encodeURIComponent(operationId)}/commit`,
      idempotencyKey,
      body,
    );
  }

  cancelReservation(request: CancelReservationRequest): Promise<DoseClubOperation> {
    const operationId = externalId(request.operationId, "operationId");
    const idempotencyKey = normalizeIdempotencyKey(request.idempotencyKey);
    const body =
      request.reason === undefined
        ? undefined
        : { reason: optionalReason(request.reason, "reason") };

    return this.mutate(
      `/consumption-reservations/${encodeURIComponent(operationId)}/cancel`,
      idempotencyKey,
      body,
    );
  }

  reverseConsumption(request: ReverseConsumptionRequest): Promise<DoseClubOperation> {
    const idempotencyKey = normalizeIdempotencyKey(request.idempotencyKey);
    const payload: ReverseConsumptionRequest = {
      operationId: externalId(request.operationId, "operationId"),
      externalReversalId: externalId(request.externalReversalId, "externalReversalId"),
      idempotencyKey,
      reason: requiredReason(request.reason, "reason"),
    };

    return this.mutate("/consumption-reversals", idempotencyKey, payload);
  }

  getOperation(operationId: string): Promise<DoseClubOperation> {
    const normalizedOperationId = externalId(operationId, "operationId");
    return this.request(
      `/operations/${encodeURIComponent(normalizedOperationId)}`,
      { method: "GET" },
      parseOperation,
    );
  }

  private mutate(
    path: string,
    idempotencyKey: string,
    body: object | undefined,
  ): Promise<DoseClubOperation> {
    return this.request(
      path,
      {
        method: "POST",
        headers: { "idempotency-key": idempotencyKey },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      },
      parseOperation,
    );
  }

  private async request<T>(
    path: string,
    init: RequestInit,
    parse: (value: unknown) => T,
  ): Promise<T> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await this.fetcher(`${this.integrationBaseUrl}${path}`, {
        ...init,
        signal: controller.signal,
        headers: {
          accept: "application/json",
          "x-giromesa-client-id": this.clientId,
          "x-giromesa-integration-key": this.integrationKey,
          ...(init.body === undefined ? {} : { "content-type": "application/json" }),
          ...init.headers,
        },
      });

      if (!response.ok) {
        const responseBody = await readErrorResponse(response);
        throw new DoseClubClientError(
          `Dose Club request failed with HTTP ${response.status}.`,
          "DOSECLUB_HTTP_ERROR",
          response.status,
          isRetryableStatus(response.status),
          responseBody,
        );
      }

      return parse(await readSuccessResponse(response));
    } catch (error) {
      if (error instanceof DoseClubClientError) {
        throw error;
      }
      if (controller.signal.aborted) {
        throw new DoseClubClientError(
          "Dose Club request timed out.",
          "DOSECLUB_TIMEOUT",
          null,
          true,
        );
      }
      throw new DoseClubClientError(
        "Dose Club is unavailable.",
        "DOSECLUB_UNAVAILABLE",
        null,
        true,
      );
    } finally {
      clearTimeout(timeout);
    }
  }
}

function configurationError(message: string): DoseClubClientError {
  return new DoseClubClientError(message, "DOSECLUB_CONFIG_INVALID", null, false);
}

function payloadError(message: string): DoseClubClientError {
  return new DoseClubClientError(message, "DOSECLUB_PAYLOAD_INVALID", null, false);
}

function invalidResponse(message: string): DoseClubClientError {
  return new DoseClubClientError(message, "DOSECLUB_RESPONSE_INVALID", null, false);
}

function requiredConfiguration(value: string, field: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw configurationError(`Dose Club ${field} is required.`);
  }
  return value.trim();
}

function normalizeTimeout(value: number | undefined): number {
  const timeoutMs = value ?? DEFAULT_TIMEOUT_MS;
  if (!Number.isInteger(timeoutMs) || timeoutMs <= 0) {
    throw configurationError("Dose Club timeoutMs must be a positive integer.");
  }
  return timeoutMs;
}

function externalId(value: string, field: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw payloadError(`Dose Club ${field} is required.`);
  }
  const normalized = value.trim();
  if (normalized.length > EXTERNAL_ID_MAX_LENGTH) {
    throw payloadError(`Dose Club ${field} exceeds ${EXTERNAL_ID_MAX_LENGTH} characters.`);
  }
  return normalized;
}

function normalizeIdempotencyKey(value: string): string {
  const normalized = externalId(value, "idempotencyKey");
  if (normalized.length < IDEMPOTENCY_KEY_MIN_LENGTH) {
    throw payloadError(
      `Dose Club idempotencyKey must contain at least ${IDEMPOTENCY_KEY_MIN_LENGTH} characters.`,
    );
  }
  return normalized;
}

function optionalReason(value: string, field: string): string {
  if (typeof value !== "string") {
    throw payloadError(`Dose Club ${field} must be a string.`);
  }
  const normalized = value.trim();
  if (normalized.length > REASON_MAX_LENGTH) {
    throw payloadError(`Dose Club ${field} exceeds ${REASON_MAX_LENGTH} characters.`);
  }
  return normalized;
}

function requiredReason(value: string, field: string): string {
  const normalized = optionalReason(value, field);
  if (!normalized) {
    throw payloadError(`Dose Club ${field} is required.`);
  }
  return normalized;
}

function integerInRange(value: number, field: string, minimum: number, maximum: number): number {
  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    throw payloadError(`Dose Club ${field} must be an integer from ${minimum} to ${maximum}.`);
  }
  return value;
}

function isRetryableStatus(status: number): boolean {
  return status === 408 || status === 429 || (status >= 500 && status <= 599);
}

async function readSuccessResponse(response: Response): Promise<unknown> {
  const declaredSize = Number(response.headers.get("content-length"));
  if (Number.isFinite(declaredSize) && declaredSize > MAX_RESPONSE_BYTES) {
    throw invalidResponse("Dose Club response exceeds the maximum supported size.");
  }

  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.byteLength > MAX_RESPONSE_BYTES) {
    throw invalidResponse("Dose Club response exceeds the maximum supported size.");
  }
  if (bytes.byteLength === 0) {
    throw invalidResponse("Dose Club returned an empty successful response.");
  }

  try {
    return JSON.parse(new TextDecoder().decode(bytes)) as unknown;
  } catch {
    throw invalidResponse("Dose Club returned invalid JSON.");
  }
}

async function readErrorResponse(response: Response): Promise<unknown> {
  try {
    const declaredSize = Number(response.headers.get("content-length"));
    if (Number.isFinite(declaredSize) && declaredSize > MAX_RESPONSE_BYTES) {
      return { message: "Dose Club error response exceeds the maximum supported size." };
    }

    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.byteLength === 0) {
      return null;
    }
    if (bytes.byteLength > MAX_RESPONSE_BYTES) {
      return { message: "Dose Club error response exceeds the maximum supported size." };
    }

    const text = new TextDecoder().decode(bytes);
    try {
      return JSON.parse(text) as unknown;
    } catch {
      return { message: text.slice(0, 500) };
    }
  } catch {
    return { message: "Dose Club error response could not be read." };
  }
}

function parseHealth(value: unknown): DoseClubHealth {
  const response = responseRecord(value);
  if (response.status !== "ok") {
    throw invalidResponse("Dose Club health status must be ok.");
  }
  return {
    status: "ok",
    tenantId: responseString(response, "tenantId"),
    integrationAccountId: responseString(response, "integrationAccountId"),
  };
}

function parseMembershipsResponse(value: unknown): ListEligibleMembershipsResponse {
  const response = responseRecord(value);
  if (!Array.isArray(response.memberships)) {
    throw invalidResponse("Dose Club memberships must be an array.");
  }
  return { memberships: response.memberships.map(parseMembership) };
}

function parseMembership(value: unknown): DoseClubEligibleMembership {
  const membership = responseRecord(value);
  if (membership.status !== "active") {
    throw invalidResponse("Dose Club membership status must be active.");
  }
  if (!Array.isArray(membership.eligibleProducts)) {
    throw invalidResponse("Dose Club eligibleProducts must be an array.");
  }

  return {
    externalClubId: responseString(membership, "externalClubId"),
    status: "active",
    offer: parseOffer(membership.offer),
    remainingDoses: responseNonNegativeInteger(membership, "remainingDoses"),
    reservedDoses: responseNonNegativeInteger(membership, "reservedDoses"),
    availableDoses: responseNonNegativeInteger(membership, "availableDoses"),
    doseMl: responsePositiveInteger(membership, "doseMl"),
    eligibleProducts: membership.eligibleProducts.map(parseEligibleProduct),
  };
}

function parseOffer(value: unknown): DoseClubOfferSummary {
  const offer = responseRecord(value);
  if (offer.type !== "individual" && offer.type !== "combo_pool") {
    throw invalidResponse("Dose Club offer type is invalid.");
  }
  return {
    externalOfferId: responseString(offer, "externalOfferId"),
    name: responseString(offer, "name"),
    type: offer.type,
  };
}

function parseEligibleProduct(value: unknown): DoseClubEligibleProduct {
  const product = responseRecord(value);
  return {
    externalProductId: responseString(product, "externalProductId"),
    name: responseString(product, "name"),
    brand: responseNullableString(product, "brand"),
  };
}

function parseOperation(value: unknown): DoseClubOperation {
  const operation = responseRecord(value);
  if (typeof operation.status !== "string" || !OPERATION_STATUSES.has(operation.status)) {
    throw invalidResponse("Dose Club operation status is invalid.");
  }

  return {
    operationId: responseString(operation, "operationId"),
    status: operation.status as DoseClubOperationStatus,
    externalCommandId: responseString(operation, "externalCommandId"),
    externalCommandItemId: responseString(operation, "externalCommandItemId"),
    externalClubId: responseString(operation, "externalClubId"),
    externalBranchId: responseString(operation, "externalBranchId"),
    externalProductId: responseString(operation, "externalProductId"),
    doses: responseIntegerInRange(operation, "doses", 1, 500),
    availableDoses: responseNonNegativeInteger(operation, "availableDoses"),
    reservedAt: responseIsoInstant(operation, "reservedAt"),
    expiresAt: responseIsoInstant(operation, "expiresAt"),
    committedAt: responseNullableIsoInstant(operation, "committedAt"),
    canceledAt: responseNullableIsoInstant(operation, "canceledAt"),
    expiredAt: responseNullableIsoInstant(operation, "expiredAt"),
    reversedAt: responseNullableIsoInstant(operation, "reversedAt"),
    updatedAt: responseIsoInstant(operation, "updatedAt"),
  };
}

function responseRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw invalidResponse("Dose Club response must be an object.");
  }
  return value as Record<string, unknown>;
}

function responseString(record: Record<string, unknown>, field: string): string {
  const value = record[field];
  if (typeof value !== "string" || !value.trim()) {
    throw invalidResponse(`Dose Club response ${field} must be a non-empty string.`);
  }
  return value;
}

function responseNullableString(record: Record<string, unknown>, field: string): string | null {
  const value = record[field];
  if (value === null) {
    return null;
  }
  if (typeof value !== "string" || !value.trim()) {
    throw invalidResponse(`Dose Club response ${field} must be a string or null.`);
  }
  return value;
}

function responseNonNegativeInteger(record: Record<string, unknown>, field: string): number {
  const value = record[field];
  if (!Number.isInteger(value) || Number(value) < 0) {
    throw invalidResponse(`Dose Club response ${field} must be a non-negative integer.`);
  }
  return Number(value);
}

function responsePositiveInteger(record: Record<string, unknown>, field: string): number {
  const value = responseNonNegativeInteger(record, field);
  if (value === 0) {
    throw invalidResponse(`Dose Club response ${field} must be a positive integer.`);
  }
  return value;
}

function responseIntegerInRange(
  record: Record<string, unknown>,
  field: string,
  minimum: number,
  maximum: number,
): number {
  const value = record[field];
  if (!Number.isInteger(value) || Number(value) < minimum || Number(value) > maximum) {
    throw invalidResponse(
      `Dose Club response ${field} must be an integer from ${minimum} to ${maximum}.`,
    );
  }
  return Number(value);
}

function responseIsoInstant(record: Record<string, unknown>, field: string): string {
  const value = responseString(record, field);
  if (!ISO_INSTANT_PATTERN.test(value) || Number.isNaN(Date.parse(value))) {
    throw invalidResponse(`Dose Club response ${field} must be an ISO timestamp.`);
  }
  return value;
}

function responseNullableIsoInstant(record: Record<string, unknown>, field: string): string | null {
  if (record[field] === null) {
    return null;
  }
  return responseIsoInstant(record, field);
}
