import type {
  ApiError,
  ApiOperations,
  LoginInput,
  OnboardingResponsePayload,
  OnboardingSelectionResponsePayload,
  OperationalCommandInput,
  ProvisioningStatusResponsePayload,
  TrialActivationResponsePayload,
} from "../../../packages/contracts/src/index";
import {
  onboardingResponseSchema,
  onboardingSelectionResponseSchema,
  provisioningStatusResponseSchema,
  trialActivationResponseSchema,
} from "../../../packages/contracts/src/index";

export type CreateOrganizationInput =
  ApiOperations["OrganizationsController_create[1]"]["requestBody"]["content"]["application/json"];
export type OnboardingUpdateInput =
  ApiOperations["OnboardingController_update[1]"]["requestBody"]["content"]["application/json"];
export type OnboardingSelectionInput =
  ApiOperations["OnboardingController_select[1]"]["requestBody"]["content"]["application/json"];
export type TrialActivationInput =
  ApiOperations["OnboardingController_activate[1]"]["requestBody"]["content"]["application/json"];
export type OnboardingSelectionResponse = OnboardingSelectionResponsePayload;
export type TrialActivationResponse = TrialActivationResponsePayload;
export type ProvisioningStatus = ProvisioningStatusResponsePayload;
export type ProvisioningSummary = OnboardingResponsePayload["provisioning"] extends infer Summary
  ? Exclude<Summary, null>
  : never;
export type ProvisioningState = ProvisioningSummary["state"];
export type OnboardingResponse = OnboardingResponsePayload;
export type ChecklistItem = keyof OnboardingResponse["items"];
export type OnboardingChecklistEvidence = OnboardingResponse["items"][ChecklistItem];
export type ChecklistStatus = OnboardingChecklistEvidence["status"];
export type ChecklistSource = OnboardingChecklistEvidence["source"];

export interface CreatedOrganizationResponse {
  organization: {
    id: string;
    legalName: string;
    tradeName: string;
    document: string;
    billingState: string;
  };
  unit: { id: string; organizationId: string; name: string; timezone: string; active: boolean };
}

export interface OnboardingErrorDetails {
  provisioningRunId?: string;
  missingItems?: string[];
  fieldErrors?: Record<string, string[]>;
  formErrors?: string[];
}

export interface ApiHealth {
  status: "ok";
  database: "up";
  integrations: Record<string, string>;
}

export type LoginResponse =
  | {
      mfaRequired: true;
      challengeToken: string;
      expiresAt?: string;
    }
  | {
      mfaRequired?: false;
      identity?: { id: string; email: string; displayName: string };
    };

export type MfaChallengeProof =
  | { challengeToken: string; code: string }
  | { challengeToken: string; recoveryCode: string };

export interface CommandResponse {
  duplicate: boolean;
  command: { id: string; type: string; occurredAt: string };
}

export class ApiClientError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string,
    readonly retryable: boolean,
    readonly details?: OnboardingErrorDetails,
  ) {
    super(message);
    this.name = "ApiClientError";
  }
}

const baseUrl = (import.meta.env.VITE_API_URL ?? "http://localhost:3200").replace(/\/$/, "");

export function resolveSecurityUrl(
  rawSiteUrl = import.meta.env.VITE_SITE_URL ?? "http://localhost:3100",
): string | null {
  try {
    const url = new URL(rawSiteUrl);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    url.pathname = `${url.pathname.replace(/\/$/, "")}/seguranca`;
    url.search = "";
    url.hash = "";
    return url.toString();
  } catch {
    return null;
  }
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const controller = new AbortController();
  const externalSignal = init.signal;
  let timedOut = false;
  const relayAbort = () => controller.abort();
  if (externalSignal?.aborted) controller.abort();
  else externalSignal?.addEventListener("abort", relayAbort, { once: true });
  const timeout = globalThis.setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, 8_000);
  try {
    const response = await fetch(`${baseUrl}${path}`, {
      ...init,
      credentials: "include",
      signal: controller.signal,
      headers: {
        accept: "application/json",
        ...(init.body ? { "content-type": "application/json" } : {}),
        ...init.headers,
      },
    });
    if (!response.ok) {
      const body = await safeJson<ApiError>(response);
      throw new ApiClientError(
        body?.message ?? `Falha na API (${response.status})`,
        response.status,
        body?.code ?? "API_REQUEST_FAILED",
        response.status >= 500 || response.status === 429,
        safeErrorDetails(body?.details),
      );
    }
    if (response.status === 204) return undefined as T;
    return (await response.json()) as T;
  } catch (error) {
    if (error instanceof ApiClientError) throw error;
    if (
      error instanceof DOMException &&
      error.name === "AbortError" &&
      externalSignal?.aborted &&
      !timedOut
    ) {
      throw error;
    }
    throw new ApiClientError(
      timedOut ? "A API demorou mais que o esperado." : "Não foi possível alcançar a API.",
      0,
      timedOut ? "API_TIMEOUT" : "API_UNREACHABLE",
      true,
    );
  } finally {
    globalThis.clearTimeout(timeout);
    externalSignal?.removeEventListener("abort", relayAbort);
  }
}

function safeErrorDetails(value: unknown): OnboardingErrorDetails | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const candidate = value as Record<string, unknown>;
  const details: OnboardingErrorDetails = {};
  if (typeof candidate.provisioningRunId === "string") {
    details.provisioningRunId = candidate.provisioningRunId;
  }
  if (Array.isArray(candidate.missingItems)) {
    details.missingItems = candidate.missingItems
      .filter((item): item is string => typeof item === "string" && item.length <= 80)
      .slice(0, 12);
  }
  if (candidate.fieldErrors && typeof candidate.fieldErrors === "object") {
    details.fieldErrors = Object.fromEntries(
      Object.entries(candidate.fieldErrors as Record<string, unknown>)
        .slice(0, 20)
        .flatMap(([key, messages]) =>
          key.length <= 120 && Array.isArray(messages)
            ? [
                [
                  key,
                  messages
                    .filter((message): message is string => typeof message === "string")
                    .slice(0, 5)
                    .map((message) => message.slice(0, 240)),
                ],
              ]
            : [],
        ),
    );
  }
  if (Array.isArray(candidate.formErrors)) {
    details.formErrors = candidate.formErrors
      .filter((message): message is string => typeof message === "string")
      .slice(0, 10)
      .map((message) => message.slice(0, 240));
  }
  return Object.keys(details).length > 0 ? details : undefined;
}

function parseApiPayload<T>(
  schema: { safeParse: (value: unknown) => { success: true; data: T } | { success: false } },
  value: unknown,
  label: string,
): T {
  const result = schema.safeParse(value);
  if (result.success) return result.data;
  throw new ApiClientError(
    `A API retornou ${label} em formato inválido.`,
    502,
    "INVALID_API_RESPONSE",
    false,
  );
}

async function safeJson<T>(response: Response): Promise<T | null> {
  try {
    return (await response.json()) as T;
  } catch (error) {
    if ((error instanceof DOMException || error instanceof Error) && error.name === "AbortError") {
      throw error;
    }
    return null;
  }
}

function parseLoginResponse(value: unknown): LoginResponse {
  if (typeof value !== "object" || value === null) {
    throw new ApiClientError("Resposta de login inválida.", 502, "INVALID_LOGIN_RESPONSE", false);
  }
  const candidate = value as Record<string, unknown>;
  if (candidate.mfaRequired === true) {
    if (typeof candidate.challengeToken !== "string" || candidate.challengeToken.length < 32) {
      throw new ApiClientError("Desafio MFA inválido.", 502, "INVALID_MFA_CHALLENGE", false);
    }
    return {
      mfaRequired: true,
      challengeToken: candidate.challengeToken,
      expiresAt: typeof candidate.expiresAt === "string" ? candidate.expiresAt : undefined,
    };
  }
  return { mfaRequired: false };
}

function managementPath(organizationId: string, unitId: string, resource: string): string {
  return `/v1/organizations/${encodeURIComponent(organizationId)}/units/${encodeURIComponent(unitId)}/management/${resource}`;
}

function pilotPath(organizationId: string, unitId: string, resource: string): string {
  return `/v1/organizations/${encodeURIComponent(organizationId)}/units/${encodeURIComponent(unitId)}/pilot/${resource}`;
}

function salonPath(organizationId: string, unitId: string, resource: string): string {
  return `/v1/organizations/${encodeURIComponent(organizationId)}/units/${encodeURIComponent(unitId)}/salon/${resource}`;
}

function growthPath(organizationId: string, resource: string): string {
  return `/v1/organizations/${encodeURIComponent(organizationId)}/growth/${resource}`;
}

function onboardingPath(organizationId: string, resource = ""): string {
  const suffix = resource ? `/${resource}` : "";
  return `/v1/organizations/${encodeURIComponent(organizationId)}/onboarding${suffix}`;
}

async function idempotentRequest<T>(
  path: string,
  method: "POST" | "PUT",
  body?: unknown,
  idempotencyKey: string = crypto.randomUUID(),
): Promise<T> {
  return request<T>(path, {
    method,
    headers: { "idempotency-key": idempotencyKey },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

async function managementCommand<T>(
  organizationId: string,
  unitId: string,
  resource: string,
  body?: unknown,
  idempotencyKey: string = crypto.randomUUID(),
): Promise<T> {
  return idempotentRequest<T>(
    managementPath(organizationId, unitId, resource),
    "POST",
    body,
    idempotencyKey,
  );
}

export const api = {
  baseUrl,
  health: () => request<ApiHealth>("/health"),
  login: async (input: LoginInput) =>
    parseLoginResponse(
      await request<unknown>("/v1/auth/login", { method: "POST", body: JSON.stringify(input) }),
    ),
  verifyMfaChallenge: (proof: MfaChallengeProof) =>
    request<unknown>("/v1/auth/mfa/challenge/verify", {
      method: "POST",
      body: JSON.stringify(proof),
    }),
  requestPasswordReset: (email: string) =>
    request<{ accepted: true }>("/v1/auth/password-reset/request", {
      method: "POST",
      body: JSON.stringify({ email }),
    }),
  logout: () => request<void>("/v1/auth/logout", { method: "POST" }),
  me: () => request<unknown>("/v1/auth/me"),
  organizations: () => request<unknown[]>("/v1/organizations"),
  createOrganization: (body: CreateOrganizationInput) =>
    request<CreatedOrganizationResponse>("/v1/organizations", {
      method: "POST",
      body: JSON.stringify(body),
    }),
  onboarding: {
    get: async (organizationId: string, signal?: AbortSignal) =>
      parseApiPayload(
        onboardingResponseSchema,
        await request<unknown>(onboardingPath(organizationId), { signal }),
        "o onboarding",
      ),
    update: async (organizationId: string, body: OnboardingUpdateInput) =>
      parseApiPayload(
        onboardingResponseSchema,
        await request<unknown>(onboardingPath(organizationId), {
          method: "PATCH",
          body: JSON.stringify(body),
        }),
        "o onboarding atualizado",
      ),
    select: async (organizationId: string, body: OnboardingSelectionInput) =>
      parseApiPayload(
        onboardingSelectionResponseSchema,
        await request<unknown>(onboardingPath(organizationId, "selection"), {
          method: "PUT",
          body: JSON.stringify(body),
        }),
        "a seleção do onboarding",
      ),
    activate: (organizationId: string, body: TrialActivationInput, idempotencyKey: string) =>
      request<unknown>(onboardingPath(organizationId, "activate"), {
        method: "POST",
        headers: { "idempotency-key": idempotencyKey },
        body: JSON.stringify(body),
      }).then((value) =>
        parseApiPayload(trialActivationResponseSchema, value, "a ativação do trial"),
      ),
    provisioning: async (organizationId: string, runId: string, signal?: AbortSignal) =>
      parseApiPayload(
        provisioningStatusResponseSchema,
        await request<unknown>(
          onboardingPath(organizationId, `provisioning/${encodeURIComponent(runId)}`),
          { signal },
        ),
        "o status do provisionamento",
      ),
  },
  platform: {
    overview: () => request<unknown>("/v1/platform/overview"),
  },
  management: {
    inventory: (organizationId: string, unitId: string) =>
      request<unknown>(managementPath(organizationId, unitId, "inventory")),
    recipes: (organizationId: string, unitId: string) =>
      request<unknown>(managementPath(organizationId, unitId, "inventory/recipes")),
    configureRecipe: (
      organizationId: string,
      unitId: string,
      body: {
        productId: string;
        components: Array<{
          inventoryItemId: string;
          locationId: string;
          quantityMilli: number;
          lossBasisPoints: number;
        }>;
      },
      idempotencyKey?: string,
    ) =>
      managementCommand<unknown>(organizationId, unitId, "inventory/recipes", body, idempotencyKey),
    purchases: (organizationId: string, unitId: string) =>
      request<unknown>(managementPath(organizationId, unitId, "purchases")),
    finance: (organizationId: string, unitId: string) =>
      request<unknown>(managementPath(organizationId, unitId, "finance")),
    cashShifts: (organizationId: string, unitId: string) =>
      request<unknown>(managementPath(organizationId, unitId, "cash-shifts")),
    people: (organizationId: string, unitId: string) =>
      request<unknown>(managementPath(organizationId, unitId, "people")),
    approvePurchase: (
      organizationId: string,
      unitId: string,
      purchaseOrderId: string,
      idempotencyKey?: string,
    ) =>
      managementCommand<unknown>(
        organizationId,
        unitId,
        `purchases/${encodeURIComponent(purchaseOrderId)}/approve`,
        undefined,
        idempotencyKey,
      ),
    openCashShift: (
      organizationId: string,
      unitId: string,
      openingCents: number,
      idempotencyKey?: string,
    ) =>
      managementCommand<unknown>(
        organizationId,
        unitId,
        "cash-shifts",
        { openingCents },
        idempotencyKey,
      ),
    clockOut: (
      organizationId: string,
      unitId: string,
      timeEntryId: string,
      clockedOutAt: string,
      idempotencyKey?: string,
    ) =>
      managementCommand<unknown>(
        organizationId,
        unitId,
        `people/time-entries/${encodeURIComponent(timeEntryId)}/clock-out`,
        { clockedOutAt },
        idempotencyKey,
      ),
  },
  pilot: {
    catalog: (organizationId: string, unitId: string) =>
      request<unknown>(pilotPath(organizationId, unitId, "catalog")),
    floor: (organizationId: string, unitId: string) =>
      request<unknown>(pilotPath(organizationId, unitId, "floor")),
    tabs: (organizationId: string, unitId: string) =>
      request<unknown>(pilotPath(organizationId, unitId, "tabs")),
    tab: (organizationId: string, unitId: string, tabId: string) =>
      request<unknown>(pilotPath(organizationId, unitId, `tabs/${encodeURIComponent(tabId)}`)),
    kds: (organizationId: string, unitId: string) =>
      request<unknown>(pilotPath(organizationId, unitId, "kds")),
    openTab: (
      organizationId: string,
      unitId: string,
      body: { tableId?: string; label?: string; guestCount: number },
      idempotencyKey?: string,
    ) =>
      idempotentRequest<unknown>(
        pilotPath(organizationId, unitId, "tabs/open"),
        "POST",
        body,
        idempotencyKey,
      ),
    createOrder: (
      organizationId: string,
      unitId: string,
      tabId: string,
      body: {
        items: Array<{
          productId: string;
          quantity: number;
          modifierOptionIds: string[];
          notes?: string;
        }>;
      },
      idempotencyKey?: string,
    ) =>
      idempotentRequest<unknown>(
        pilotPath(organizationId, unitId, `tabs/${encodeURIComponent(tabId)}/orders`),
        "POST",
        body,
        idempotencyKey,
      ),
    sendOrder: (organizationId: string, unitId: string, orderId: string, idempotencyKey?: string) =>
      idempotentRequest<unknown>(
        pilotPath(organizationId, unitId, `orders/${encodeURIComponent(orderId)}/send`),
        "POST",
        undefined,
        idempotencyKey,
      ),
    transferTab: (
      organizationId: string,
      unitId: string,
      tabId: string,
      body: { tableId: string; reason: string },
      idempotencyKey?: string,
    ) =>
      idempotentRequest<unknown>(
        pilotPath(organizationId, unitId, `tabs/${encodeURIComponent(tabId)}/transfer`),
        "POST",
        body,
        idempotencyKey,
      ),
    mergeTabs: (
      organizationId: string,
      unitId: string,
      body: { targetTabId: string; sourceTabIds: string[] },
      idempotencyKey?: string,
    ) =>
      idempotentRequest<unknown>(
        pilotPath(organizationId, unitId, "tabs/merge"),
        "POST",
        body,
        idempotencyKey,
      ),
    splitTab: (
      organizationId: string,
      unitId: string,
      tabId: string,
      body: {
        tableId?: string;
        label?: string;
        items: Array<{ orderItemId: string; quantity: number }>;
      },
      idempotencyKey?: string,
    ) =>
      idempotentRequest<unknown>(
        pilotPath(organizationId, unitId, `tabs/${encodeURIComponent(tabId)}/split`),
        "POST",
        body,
        idempotencyKey,
      ),
    serviceCharge: (
      organizationId: string,
      unitId: string,
      tabId: string,
      basisPoints: number,
      idempotencyKey?: string,
    ) =>
      idempotentRequest<unknown>(
        pilotPath(organizationId, unitId, `tabs/${encodeURIComponent(tabId)}/service-charge`),
        "PUT",
        { basisPoints },
        idempotencyKey,
      ),
    tip: (
      organizationId: string,
      unitId: string,
      tabId: string,
      tipCents: number,
      idempotencyKey?: string,
    ) =>
      idempotentRequest<unknown>(
        pilotPath(organizationId, unitId, `tabs/${encodeURIComponent(tabId)}/tip`),
        "PUT",
        { tipCents },
        idempotencyKey,
      ),
    discountItem: (
      organizationId: string,
      unitId: string,
      itemId: string,
      body: {
        discountCents: number;
        approval: { approverMembershipId: string; pin: string; reason: string };
      },
      idempotencyKey?: string,
    ) =>
      idempotentRequest<unknown>(
        pilotPath(organizationId, unitId, `items/${encodeURIComponent(itemId)}/discount`),
        "POST",
        body,
        idempotencyKey,
      ),
    cancelItem: (
      organizationId: string,
      unitId: string,
      itemId: string,
      approval: { approverMembershipId: string; pin: string; reason: string },
      idempotencyKey?: string,
    ) =>
      idempotentRequest<unknown>(
        pilotPath(organizationId, unitId, `items/${encodeURIComponent(itemId)}/cancel`),
        "POST",
        { approval },
        idempotencyKey,
      ),
    transitionKds: (
      organizationId: string,
      unitId: string,
      ticketId: string,
      state: "preparing" | "ready" | "done" | "canceled",
      idempotencyKey?: string,
    ) =>
      idempotentRequest<unknown>(
        pilotPath(organizationId, unitId, `kds/${encodeURIComponent(ticketId)}/state`),
        "POST",
        { state },
        idempotencyKey,
      ),
  },
  salon: {
    map: (organizationId: string, unitId: string, roomId: string) =>
      request<unknown>(
        salonPath(organizationId, unitId, `rooms/${encodeURIComponent(roomId)}/map`),
      ),
  },
  growth: {
    customers: (organizationId: string) =>
      request<unknown>(growthPath(organizationId, "customers")),
    loyaltyBalance: (organizationId: string, customerId: string) =>
      request<unknown>(
        growthPath(organizationId, `loyalty/customers/${encodeURIComponent(customerId)}/balance`),
      ),
    campaigns: (organizationId: string) =>
      request<unknown>(growthPath(organizationId, "campaigns")),
    reservations: (organizationId: string, unitId: string) =>
      request<unknown>(
        growthPath(organizationId, `units/${encodeURIComponent(unitId)}/reservations`),
      ),
    waitlist: (organizationId: string, unitId: string) =>
      request<unknown>(growthPath(organizationId, `units/${encodeURIComponent(unitId)}/waitlist`)),
    deliveryZones: (organizationId: string, unitId: string) =>
      request<unknown>(
        growthPath(organizationId, `units/${encodeURIComponent(unitId)}/delivery-zones`),
      ),
    multiunitSummary: (organizationId: string) =>
      request<unknown>(growthPath(organizationId, "multiunit/summary")),
    transitionReservation: (
      organizationId: string,
      reservationId: string,
      status: "confirmed" | "seated" | "completed" | "canceled" | "no_show",
    ) =>
      request<unknown>(
        growthPath(organizationId, `reservations/${encodeURIComponent(reservationId)}/status`),
        { method: "PATCH", body: JSON.stringify({ status }) },
      ),
    transitionWaitlist: (
      organizationId: string,
      entryId: string,
      status: "notified" | "seated" | "left" | "canceled" | "no_show",
    ) =>
      request<unknown>(
        growthPath(organizationId, `waitlist/${encodeURIComponent(entryId)}/status`),
        { method: "PATCH", body: JSON.stringify({ status }) },
      ),
  },
  command: (organizationId: string, unitId: string, command: OperationalCommandInput) =>
    request<CommandResponse>(
      `/v1/organizations/${encodeURIComponent(organizationId)}/units/${encodeURIComponent(unitId)}/commands`,
      { method: "POST", body: JSON.stringify(command) },
    ),
};
