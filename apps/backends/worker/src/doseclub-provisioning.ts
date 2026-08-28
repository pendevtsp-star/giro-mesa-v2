import {
  auditEvents,
  commercialPlans,
  type GiroMesaDatabase,
  growthIntegrations,
  identities,
  memberships,
  organizations,
  roleBindings,
  subscriptions,
  trials,
  units,
} from "@giromesa/db";
import { doseClubManagedCredential, includesDoseClubEntitlement } from "@giromesa/domain";
import { and, eq, inArray } from "drizzle-orm";
import type { ClaimedOutboxEvent } from "./outbox.js";

type Database = GiroMesaDatabase["db"];

export class DoseClubProvisioningError extends Error {
  constructor(
    readonly code: string,
    readonly retryable: boolean,
  ) {
    super(code);
    this.name = "DoseClubProvisioningError";
  }
}

export { includesDoseClubEntitlement } from "@giromesa/domain";

export function doseClubAccessReference(event: ClaimedOutboxEvent) {
  const organizationId = requiredUuid(event.payload.organizationId, "organizationId");
  const key = event.aggregate_type === "subscription" ? "subscriptionId" : "trialId";
  if (event.aggregate_type !== "subscription" && event.aggregate_type !== "trial") {
    throw new DoseClubProvisioningError("DOSECLUB_PROVISIONING_EVENT_INVALID", false);
  }
  const accessId = requiredUuid(event.payload[key], key);
  if (event.aggregate_id !== accessId) {
    throw new DoseClubProvisioningError("DOSECLUB_PROVISIONING_EVENT_INVALID", false);
  }
  return { organizationId, accessId, kind: event.aggregate_type } as const;
}

export async function reconcileDoseClubAccess(db: Database, event: ClaimedOutboxEvent) {
  const { organizationId, accessId, kind } = doseClubAccessReference(event);

  const eventSourceEligible =
    kind === "subscription"
      ? await subscriptionIsEligible(db, organizationId, accessId)
      : await trialIsEligible(db, organizationId, accessId);
  const enabled = eventSourceEligible || (await organizationHasDoseClubAccess(db, organizationId));
  const existing = await db
    .select()
    .from(growthIntegrations)
    .where(
      and(
        eq(growthIntegrations.organizationId, organizationId),
        eq(growthIntegrations.provider, "doseclub"),
      ),
    );
  const managed = existing.filter((row) => row.credentialReference?.startsWith("managed:v1:"));
  if (!enabled && managed.length === 0) return;

  const [organization] = await db
    .select()
    .from(organizations)
    .where(eq(organizations.id, organizationId))
    .limit(1);
  const unitRows = await db
    .select()
    .from(units)
    .where(
      and(eq(units.organizationId, organizationId), ...(enabled ? [eq(units.active, true)] : [])),
    );
  const [owner] = enabled
    ? await db
        .select({ id: identities.id, email: identities.email, name: identities.displayName })
        .from(memberships)
        .innerJoin(identities, eq(identities.id, memberships.identityId))
        .innerJoin(roleBindings, eq(roleBindings.membershipId, memberships.id))
        .where(
          and(
            eq(memberships.organizationId, organizationId),
            eq(memberships.status, "active"),
            eq(roleBindings.role, "owner"),
          ),
        )
        .limit(1)
    : [];
  if (!organization || (enabled && (!owner || unitRows.length === 0))) {
    throw new DoseClubProvisioningError("DOSECLUB_PROVISIONING_CONTEXT_INCOMPLETE", false);
  }

  if (
    enabled &&
    hasDoseClubManualConflict(
      existing,
      unitRows.map((unit) => unit.id),
    )
  ) {
    throw new DoseClubProvisioningError("DOSECLUB_MANUAL_CONNECTION_CONFLICT", false);
  }

  const settings = configuration();
  const integrationRows = [];
  for (const unit of unitRows) {
    const current = existing.find((row) => row.unitId === unit.id);
    if (!enabled) {
      if (current?.credentialReference?.startsWith("managed:v1:")) {
        integrationRows.push({ row: current, unit });
      }
      continue;
    }
    const [row] = await db
      .insert(growthIntegrations)
      .values({
        organizationId,
        unitId: unit.id,
        provider: "doseclub",
        status: enabled ? "pending" : "disabled",
        config: { provisioningStatus: enabled ? "provisioning" : "revoking" },
      })
      .onConflictDoUpdate({
        target: [
          growthIntegrations.organizationId,
          growthIntegrations.unitId,
          growthIntegrations.provider,
        ],
        set: { status: enabled ? "pending" : "disabled", updatedAt: new Date() },
      })
      .returning();
    if (!row) throw new DoseClubProvisioningError("DOSECLUB_INTEGRATION_NOT_CREATED", true);
    integrationRows.push({ row, unit });
  }
  if (integrationRows.length === 0) {
    throw new DoseClubProvisioningError("DOSECLUB_PROVISIONING_CONTEXT_INCOMPLETE", false);
  }

  const credentials = integrationRows.map(({ row, unit }) => ({
    id: unit.id,
    name: unit.name,
    clientId: `giromesa:${organizationId}:${unit.id}`,
    integrationKey: doseClubManagedCredential(row.id, settings.credentialSecret).token,
  }));
  const response = await requestJson(settings.provisioningUrl, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-giromesa-provisioning-key": settings.provisioningKey,
    },
    body: JSON.stringify({
      enabled,
      organizationId,
      organizationName: organization.tradeName,
      document: organization.document,
      giroMesaApiBaseUrl: settings.giroMesaApiBaseUrl,
      ...(owner ? { owner } : {}),
      units: credentials,
    }),
  });
  const provisioned = provisioningResponse(response, enabled);
  if (!enabled) {
    await db
      .update(growthIntegrations)
      .set({ status: "disabled", config: { provisioningStatus: "revoked" }, updatedAt: new Date() })
      .where(
        inArray(
          growthIntegrations.id,
          integrationRows.map(({ row }) => row.id),
        ),
      );
    return;
  }

  for (const { row, unit } of integrationRows) {
    const connection = provisioned.connections.find((item) => item.externalUnitId === unit.id);
    if (!connection)
      throw new DoseClubProvisioningError("DOSECLUB_PROVISIONING_RESPONSE_INVALID", false);
    const credential = doseClubManagedCredential(row.id, settings.credentialSecret);
    const health = await requestJson(
      `${settings.doseClubBaseUrl}/v1/integrations/giromesa/health`,
      {
        headers: {
          "x-giromesa-client-id": `giromesa:${organizationId}:${unit.id}`,
          "x-giromesa-integration-key": credential.token,
        },
      },
    );
    if (
      !isRecord(health) ||
      health.status !== "ok" ||
      health.tenantId !== provisioned.tenantId ||
      health.integrationAccountId !== connection.integrationAccountId
    ) {
      throw new DoseClubProvisioningError("DOSECLUB_HEALTH_MISMATCH", false);
    }
    await db
      .update(growthIntegrations)
      .set({
        status: "active",
        credentialReference: credential.reference,
        config: {
          apiBaseUrl: settings.doseClubBaseUrl,
          clientId: `giromesa:${organizationId}:${unit.id}`,
          tenantId: provisioned.tenantId,
          integrationAccountId: connection.integrationAccountId,
          provisioningStatus: provisioned.status,
          healthCheckedAt: new Date().toISOString(),
        },
        updatedAt: new Date(),
      })
      .where(eq(growthIntegrations.id, row.id));
  }
  await db.insert(auditEvents).values({
    organizationId,
    action: "doseclub.integration.automatically_provisioned",
    entityType: kind,
    entityId: accessId,
    metadata: {
      tenantId: provisioned.tenantId,
      units: unitRows.map((unit) => unit.id),
      status: provisioned.status,
    },
  });
}

async function subscriptionIsEligible(
  db: Database,
  organizationId: string,
  subscriptionId: string,
) {
  const [subscription] = await db
    .select({ state: subscriptions.state, entitlements: commercialPlans.entitlements })
    .from(subscriptions)
    .innerJoin(commercialPlans, eq(commercialPlans.id, subscriptions.commercialPlanId))
    .where(
      and(eq(subscriptions.id, subscriptionId), eq(subscriptions.organizationId, organizationId)),
    )
    .limit(1);
  if (!subscription) throw new DoseClubProvisioningError("DOSECLUB_SUBSCRIPTION_NOT_FOUND", false);
  return subscription.state === "active" && includesDoseClubEntitlement(subscription.entitlements);
}

async function trialIsEligible(db: Database, organizationId: string, trialId: string) {
  const [trial] = await db
    .select({
      billingState: organizations.billingState,
      startsAt: trials.startsAt,
      endsAt: trials.endsAt,
      entitlements: commercialPlans.entitlements,
    })
    .from(trials)
    .innerJoin(organizations, eq(organizations.id, trials.organizationId))
    .innerJoin(commercialPlans, eq(commercialPlans.id, trials.commercialPlanId))
    .where(and(eq(trials.id, trialId), eq(trials.organizationId, organizationId)))
    .limit(1);
  if (!trial) throw new DoseClubProvisioningError("DOSECLUB_TRIAL_NOT_FOUND", false);
  return isActiveDoseClubTrial(trial);
}

async function organizationHasDoseClubAccess(db: Database, organizationId: string) {
  const [subscriptionRows, trialRows] = await Promise.all([
    db
      .select({ entitlements: commercialPlans.entitlements })
      .from(subscriptions)
      .innerJoin(commercialPlans, eq(commercialPlans.id, subscriptions.commercialPlanId))
      .where(
        and(eq(subscriptions.organizationId, organizationId), eq(subscriptions.state, "active")),
      ),
    db
      .select({
        billingState: organizations.billingState,
        startsAt: trials.startsAt,
        endsAt: trials.endsAt,
        entitlements: commercialPlans.entitlements,
      })
      .from(trials)
      .innerJoin(organizations, eq(organizations.id, trials.organizationId))
      .innerJoin(commercialPlans, eq(commercialPlans.id, trials.commercialPlanId))
      .where(eq(trials.organizationId, organizationId)),
  ]);
  return hasEffectiveDoseClubAccess([
    ...subscriptionRows.map((row) => includesDoseClubEntitlement(row.entitlements)),
    ...trialRows.map((trial) => isActiveDoseClubTrial(trial)),
  ]);
}

export function hasEffectiveDoseClubAccess(sources: boolean[]) {
  return sources.some(Boolean);
}

export function isActiveDoseClubTrial(
  trial: {
    billingState: string;
    startsAt: Date;
    endsAt: Date;
    entitlements: unknown;
  },
  now = new Date(),
) {
  return (
    trial.billingState === "trial_active" &&
    trial.startsAt <= now &&
    trial.endsAt > now &&
    includesDoseClubEntitlement(trial.entitlements)
  );
}

export function hasDoseClubManualConflict(
  connections: Array<{ unitId: string | null; credentialReference: string | null }>,
  activeUnitIds: string[],
) {
  return connections.some(
    (row) =>
      Boolean(row.credentialReference) &&
      !row.credentialReference?.startsWith("managed:v1:") &&
      (row.unitId === null || activeUnitIds.includes(row.unitId)),
  );
}

function configuration() {
  const provisioningKey = process.env.DOSECLUB_PROVISIONING_KEY?.trim();
  const credentialSecret = process.env.DOSECLUB_CREDENTIAL_SECRET?.trim();
  const giroMesaApiBaseUrl = process.env.GIROMESA_API_BASE_URL?.trim();
  const configuredDoseClubUrl = process.env.DOSECLUB_API_BASE_URL?.trim();
  if (
    process.env.DOSECLUB_PROVIDER_ENABLED !== "true" ||
    !provisioningKey ||
    provisioningKey.length < 32 ||
    !credentialSecret ||
    credentialSecret.length < 32 ||
    !giroMesaApiBaseUrl ||
    !configuredDoseClubUrl
  ) {
    throw new DoseClubProvisioningError("DOSECLUB_PROVISIONING_NOT_CONFIGURED", false);
  }
  const doseClubUrl = safeBaseUrl(configuredDoseClubUrl);
  const giroMesaUrl = safeBaseUrl(giroMesaApiBaseUrl);
  return {
    provisioningKey,
    credentialSecret,
    doseClubBaseUrl: doseClubUrl,
    provisioningUrl: `${doseClubUrl}/v1/internal/integrations/giromesa/provision`,
    giroMesaApiBaseUrl: giroMesaUrl,
  };
}

async function requestJson(url: string, init: RequestInit): Promise<unknown> {
  let response: Response;
  try {
    response = await fetch(url, { ...init, signal: AbortSignal.timeout(10_000) });
  } catch {
    throw new DoseClubProvisioningError("DOSECLUB_PROVISIONING_UNAVAILABLE", true);
  }
  const text = await response.text();
  let body: unknown = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = null;
  }
  if (!response.ok) {
    throw new DoseClubProvisioningError(
      response.status === 401 || response.status === 403
        ? "DOSECLUB_PROVISIONING_UNAUTHORIZED"
        : "DOSECLUB_PROVISIONING_REJECTED",
      response.status >= 500 || response.status === 429,
    );
  }
  return body;
}

function provisioningResponse(value: unknown, enabled: boolean) {
  if (!isRecord(value))
    throw new DoseClubProvisioningError("DOSECLUB_PROVISIONING_RESPONSE_INVALID", false);
  if (!enabled && value.status === "disabled")
    return { tenantId: value.tenantId, status: "disabled", connections: [] };
  if (
    typeof value.tenantId !== "string" ||
    value.status !== "waiting_product_mappings" ||
    !Array.isArray(value.connections) ||
    !value.connections.every(
      (item) =>
        isRecord(item) &&
        typeof item.externalUnitId === "string" &&
        typeof item.integrationAccountId === "string",
    )
  ) {
    throw new DoseClubProvisioningError("DOSECLUB_PROVISIONING_RESPONSE_INVALID", false);
  }
  return {
    tenantId: value.tenantId,
    status: value.status,
    connections: value.connections as Array<{
      externalUnitId: string;
      integrationAccountId: string;
    }>,
  };
}

function safeBaseUrl(value: string) {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new DoseClubProvisioningError("DOSECLUB_PROVISIONING_URL_INVALID", false);
  }
  if (
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    !["http:", "https:"].includes(url.protocol)
  ) {
    throw new DoseClubProvisioningError("DOSECLUB_PROVISIONING_URL_INVALID", false);
  }
  if (process.env.NODE_ENV === "production" && url.protocol !== "https:") {
    throw new DoseClubProvisioningError("DOSECLUB_PROVISIONING_HTTPS_REQUIRED", false);
  }
  return `${url.origin}${url.pathname.replace(/\/+$/, "")}`;
}

function requiredUuid(value: unknown, key: string) {
  if (typeof value !== "string" || !/^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(value)) {
    throw new DoseClubProvisioningError(
      `DOSECLUB_PROVISIONING_${key.toUpperCase()}_INVALID`,
      false,
    );
  }
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
