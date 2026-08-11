import { createHash, randomUUID } from "node:crypto";
import type {
  ActivateTrialInput,
  OnboardingSelectionInput,
  UpdateOnboardingInput,
} from "@giromesa/contracts";
import {
  auditEvents,
  commercialCatalogVersions,
  commercialPlans,
  type Database,
  memberships,
  onboardingChecklistItems,
  onboardingRecords,
  organizations,
  outboxEvents,
  posDiningTables,
  posProductPrices,
  posProducts,
  provisioningRuns,
  provisioningSteps,
  publicMenus,
  roleBindings,
  subscriptionEntitlements,
  subscriptions,
  type TenantTransaction,
  trials,
  units,
} from "@giromesa/db";
import {
  activationReadiness,
  assertProvisioningTransition,
  CHECKLIST_ITEMS,
  type ChecklistEvidence,
  type ChecklistItem,
  type ProvisioningCheckpoint,
  type ProvisioningState,
  provisioningResumeState,
  trialWindow,
} from "@giromesa/domain";
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from "@nestjs/common";
import { and, desc, eq, inArray, isNotNull, isNull, ne, sql } from "drizzle-orm";
import { DatabaseService } from "../database/database.module.js";
import { ScopeService } from "../organizations/scope.service.js";

const LEASE_MILLISECONDS = 30_000;
const WAIT_FOR_CONCURRENT_RUN_MILLISECONDS = 3_000;
const SYSTEM_ITEMS = new Set<ChecklistItem>([
  "business",
  "unit",
  "plan",
  "catalog",
  "tables",
  "team",
  "qr",
  "cashier",
]);
const ATTESTED_ITEMS = new Set<ChecklistItem>([
  "fiscalChoice",
  "production",
  "training",
  "rehearsal",
]);
const WAIVABLE_ITEMS = new Set<ChecklistItem>(["fiscalChoice", "qr"]);

type PlanSnapshot = {
  id: string;
  slug: string;
  catalogVersionId: string;
  catalogVersion: number;
  monthlyPriceCents: number;
  annualPriceCents: number;
  includedUnits: number;
  entitlements: string[];
};

type ProvisioningRun = typeof provisioningRuns.$inferSelect;
type OnboardingRecord = typeof onboardingRecords.$inferSelect;
type DatabaseExecutor = Database | TenantTransaction;

class ProvisioningError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly disposition: "recoverable" | "terminal" | "transient",
    readonly details?: Record<string, unknown>,
  ) {
    super(message);
  }
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>).sort(([left], [right]) =>
      left.localeCompare(right),
    );
    return `{${entries.map(([key, entry]) => `${JSON.stringify(key)}:${stableJson(entry)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function fingerprint(value: unknown) {
  return createHash("sha256").update(stableJson(value)).digest("hex");
}

function deterministicUuid(seed: string) {
  const bytes = createHash("sha256").update(seed).digest().subarray(0, 16);
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x50;
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function planSnapshot(row: {
  id: string;
  slug: string;
  catalogVersionId: string;
  catalogVersion: number;
  monthlyPriceCents: number;
  annualPriceCents: number;
  includedUnits: number;
  entitlements: string[];
}): PlanSnapshot {
  return { ...row, entitlements: [...row.entitlements].sort() };
}

function publicPlan(snapshot: PlanSnapshot) {
  return {
    id: snapshot.id,
    slug: snapshot.slug,
    catalogVersion: snapshot.catalogVersion,
    monthlyPriceCents: snapshot.monthlyPriceCents,
    annualPriceCents: snapshot.annualPriceCents,
    includedUnits: snapshot.includedUnits,
    entitlements: snapshot.entitlements,
  };
}

function iso(value: Date | string | null | undefined) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function sanitizedSystemEvidence(item: ChecklistItem, evidence: Record<string, unknown>) {
  switch (item) {
    case "unit":
      return {
        selectedUnitId:
          typeof evidence.selectedUnitId === "string" ? evidence.selectedUnitId : null,
        selectedUnitActive: evidence.selectedUnitActive === true,
      };
    case "team":
      return {
        activeMembersObserved:
          typeof evidence.activeMembersObserved === "number"
            ? Math.max(0, Math.min(10_000, Math.trunc(evidence.activeMembersObserved)))
            : 0,
      };
    case "qr":
      return {
        menuPublished: evidence.menuPublished === true,
        tablesConfigured: evidence.tablesConfigured === true,
        capabilitiesConfigured: evidence.capabilitiesConfigured === true,
        serverTestPassed: evidence.serverTestPassed === true,
      };
    case "production": {
      const requestedMode = evidence.requestedMode ?? evidence.mode;
      const boundedIds = (value: unknown) =>
        Array.isArray(value)
          ? value
              .filter((entry): entry is string => typeof entry === "string")
              .slice(0, 24)
          : [];
      return {
        configured: evidence.configured === true,
        serverTestPassed: evidence.serverTestPassed === true,
        requestedMode: ["off", "kds", "print", "both"].includes(String(requestedMode))
          ? String(requestedMode)
          : null,
        kdsStationIds: boundedIds(evidence.kdsStationIds),
        printerProfileIds: boundedIds(evidence.printerProfileIds),
        configurationReference:
          typeof evidence.configurationReference === "string"
            ? evidence.configurationReference.slice(0, 120)
            : null,
      };
    }
    case "plan":
      return {
        catalogVersion:
          typeof evidence.catalogVersion === "number"
            ? Math.max(0, Math.trunc(evidence.catalogVersion))
            : null,
        slug: ["operacao", "crescimento", "rede"].includes(String(evidence.slug))
          ? String(evidence.slug)
          : null,
      };
    default:
      return {};
  }
}

function checklistAuditState(
  item: ChecklistItem,
  value: {
    status: string;
    source: string;
    evidenceReference?: string | null;
    evidence?: Record<string, unknown> | null;
    actorIdentityId?: string | null;
    verifiedAt?: Date | null;
    waiverReason?: string | null;
  },
) {
  return {
    status: value.status,
    source: value.source,
    evidenceReference: value.evidenceReference ?? null,
    evidence: sanitizedSystemEvidence(item, value.evidence ?? {}),
    actorIdentityId: value.actorIdentityId ?? null,
    verifiedAt: iso(value.verifiedAt),
    waiverReason: value.waiverReason ?? null,
  };
}

function selectionAuditSnapshot(record: OnboardingRecord) {
  if (!record.selectedUnitId || !record.selectedPlanId || !record.selectedAt) return null;
  const snapshot = record.selectedPlanSnapshot ?? {};
  const entitlements = Array.isArray(snapshot.entitlements)
    ? snapshot.entitlements.filter(
        (value): value is string => typeof value === "string" && value.length <= 120,
      )
    : [];
  return {
    selectedUnitId: record.selectedUnitId,
    plan: {
      id: record.selectedPlanId,
      slug: ["operacao", "crescimento", "rede"].includes(String(snapshot.slug))
        ? String(snapshot.slug)
        : "unavailable",
      catalogVersion: record.selectedCatalogVersion,
      monthlyPriceCents:
        typeof snapshot.monthlyPriceCents === "number" ? snapshot.monthlyPriceCents : null,
      annualPriceCents:
        typeof snapshot.annualPriceCents === "number" ? snapshot.annualPriceCents : null,
      includedUnits: typeof snapshot.includedUnits === "number" ? snapshot.includedUnits : null,
      entitlements,
    },
    revision: record.selectionRevision,
    selectedAt: iso(record.selectedAt),
    updatedAt: iso(record.updatedAt),
  };
}

function sanitizedChecklistRequest(input: UpdateOnboardingInput) {
  const checklist = Object.fromEntries(
    Object.entries(input.checklist ?? {}).map(([item, value]) => [item, value === true]),
  );
  const items = Object.fromEntries(
    Object.entries(input.items ?? {}).flatMap(([item, value]) => {
      if (!value) return [];
      const evidence = ("evidence" in value ? value.evidence : undefined) ?? {};
      const safeEvidence =
        item === "fiscalChoice"
          ? { choice: "choice" in evidence ? evidence.choice : undefined }
          : item === "production"
            ? { mode: "mode" in evidence ? evidence.mode : undefined }
            : item === "training" || item === "rehearsal"
              ? { completed: "completed" in evidence ? evidence.completed === true : undefined }
              : item === "qr"
                ? { reason: "reason" in evidence ? evidence.reason : undefined }
                : "note" in evidence
                  ? { note: evidence.note }
                  : {};
      return [
        [
          item,
          {
            status: value.status,
            evidenceReference:
              "evidenceReference" in value ? (value.evidenceReference ?? null) : null,
            evidence: safeEvidence,
            waiverReason: "waiverReason" in value ? value.waiverReason : null,
          },
        ],
      ];
    }),
  );
  return { checklist, items };
}

function isPostgresCode(error: unknown, ...codes: string[]) {
  const candidate = error as { code?: string; cause?: { code?: string } };
  return codes.includes(candidate.cause?.code ?? candidate.code ?? "");
}

function sanitizedFailure(error: unknown) {
  if (error instanceof ProvisioningError) return error;
  if (isPostgresCode(error, "40001", "40P01", "55P03", "57014", "08006", "08003")) {
    return new ProvisioningError(
      "PROVISIONING_TRANSIENT_FAILURE",
      "O provisionamento foi preservado e pode ser retomado.",
      "transient",
    );
  }
  return new ProvisioningError(
    "PROVISIONING_TRANSIENT_FAILURE",
    "O provisionamento foi preservado e pode ser retomado.",
    "transient",
  );
}

function frozenSelectedPlan(record: OnboardingRecord): PlanSnapshot | null {
  const snapshot = record.selectedPlanSnapshot;
  if (
    !record.selectedPlanId ||
    record.selectedCatalogVersion === null ||
    !record.selectedPlanFingerprint ||
    !snapshot ||
    snapshot.id !== record.selectedPlanId ||
    snapshot.catalogVersion !== record.selectedCatalogVersion ||
    typeof snapshot.slug !== "string" ||
    typeof snapshot.catalogVersionId !== "string" ||
    typeof snapshot.monthlyPriceCents !== "number" ||
    typeof snapshot.annualPriceCents !== "number" ||
    typeof snapshot.includedUnits !== "number" ||
    !Array.isArray(snapshot.entitlements) ||
    !snapshot.entitlements.every((entry) => typeof entry === "string") ||
    fingerprint(snapshot) !== record.selectedPlanFingerprint
  ) {
    return null;
  }
  return snapshot as PlanSnapshot;
}

@Injectable()
export class OnboardingService {
  constructor(
    private readonly database: DatabaseService,
    private readonly scope: ScopeService,
  ) {}

  private durable<T>(
    identityId: string,
    organizationId: string,
    work: (tx: TenantTransaction) => Promise<T>,
  ) {
    return this.database.withTenantContext(
      { source: "http", organizationId, actorIdentityId: identityId },
      (tx) => work(tx),
    );
  }

  private async organizationLock(tx: TenantTransaction, organizationId: string) {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${organizationId}, 7107))`);
  }

  private async ensureChecklistRows(tx: DatabaseExecutor, organizationId: string) {
    await tx
      .insert(onboardingChecklistItems)
      .values(
        CHECKLIST_ITEMS.map((item) => ({
          organizationId,
          item,
          status: "pending" as const,
          source: "system" as const,
        })),
      )
      .onConflictDoNothing();
  }

  private async setSystemEvidence(
    tx: DatabaseExecutor,
    organizationId: string,
    item: ChecklistItem,
    verified: boolean,
    evidenceReference: string,
    evidence: Record<string, unknown> = {},
    reason = "system_readiness_refresh",
  ) {
    const [existing] = await tx
      .select()
      .from(onboardingChecklistItems)
      .where(
        and(
          eq(onboardingChecklistItems.organizationId, organizationId),
          eq(onboardingChecklistItems.item, item),
        ),
      )
      .limit(1);
    if (existing?.status === "not_applicable" && existing.source === "authorized_waiver") return;
    const now = new Date();
    const next = {
      status: verified ? ("verified" as const) : ("blocked" as const),
      source: "system" as const,
      evidenceReference,
      evidence: sanitizedSystemEvidence(item, evidence),
      actorIdentityId: null,
      waiverReason: null,
      verifiedAt: verified ? now : null,
    };
    const before = checklistAuditState(
      item,
      existing ?? {
        status: "pending",
        source: "system",
        evidenceReference: null,
        evidence: {},
        actorIdentityId: null,
        verifiedAt: null,
        waiverReason: null,
      },
    );
    const comparableAfter = checklistAuditState(item, {
      ...next,
      verifiedAt: verified ? (existing?.verifiedAt ?? now) : null,
    });
    if (stableJson(before) === stableJson(comparableAfter)) return;
    await tx
      .update(onboardingChecklistItems)
      .set({
        ...next,
        updatedAt: now,
      })
      .where(
        and(
          eq(onboardingChecklistItems.organizationId, organizationId),
          eq(onboardingChecklistItems.item, item),
        ),
      );
    const after = checklistAuditState(item, next);
    await tx.insert(auditEvents).values({
      organizationId,
      actorIdentityId: null,
      action: "onboarding.system_evidence_changed",
      entityType: "onboarding_checklist_item",
      entityId: `${organizationId}:${item}`,
      occurredAt: now,
      metadata: {
        item,
        before,
        after,
        reason,
        source: "system",
        evidence: after.evidence,
        actorIdentityId: null,
        occurredAt: now.toISOString(),
      },
    });
  }

  private async revalidateSystemChecklist(
    tx: DatabaseExecutor,
    organizationId: string,
    selectedUnitId: string | null,
    pinnedPlan?: PlanSnapshot,
    reason = "system_readiness_refresh",
  ) {
    await this.ensureChecklistRows(tx, organizationId);
    if (selectedUnitId) {
      await tx.execute(sql`select set_config('app.current_unit_id', ${selectedUnitId}, true)`);
    }
    const [business, selectedUnits] = await Promise.all([
      tx
        .select({ id: organizations.id })
        .from(organizations)
        .where(eq(organizations.id, organizationId))
        .limit(1),
      tx
        .select({ id: units.id })
        .from(units)
        .where(
          and(
            eq(units.organizationId, organizationId),
            selectedUnitId ? eq(units.id, selectedUnitId) : sql`false`,
            eq(units.active, true),
          ),
        )
        .limit(1),
    ]);
    const [catalog, tables, team, qr, cashier] = await Promise.all([
      tx
        .select({ id: posProducts.id })
        .from(posProducts)
        .innerJoin(
          posProductPrices,
          and(
            eq(posProductPrices.organizationId, posProducts.organizationId),
            eq(posProductPrices.productId, posProducts.id),
          ),
        )
        .where(
          and(
            eq(posProducts.organizationId, organizationId),
            selectedUnitId ? eq(posProductPrices.unitId, selectedUnitId) : sql`false`,
            eq(posProducts.active, true),
          ),
        )
        .limit(1),
      tx
        .select({ id: posDiningTables.id })
        .from(posDiningTables)
        .where(
          and(
            eq(posDiningTables.organizationId, organizationId),
            selectedUnitId ? eq(posDiningTables.unitId, selectedUnitId) : sql`false`,
            eq(posDiningTables.active, true),
          ),
        )
        .limit(1),
      tx
        .selectDistinct({ id: memberships.identityId })
        .from(memberships)
        .innerJoin(roleBindings, eq(roleBindings.membershipId, memberships.id))
        .where(
          and(
            eq(memberships.organizationId, organizationId),
            eq(memberships.status, "active"),
            selectedUnitId
              ? sql`(${roleBindings.unitId} is null or ${roleBindings.unitId} = ${selectedUnitId}::uuid)`
              : sql`false`,
          ),
        )
        .limit(2),
      tx
        .select({ id: publicMenus.id })
        .from(publicMenus)
        .where(
          and(
            eq(publicMenus.organizationId, organizationId),
            selectedUnitId ? eq(publicMenus.unitId, selectedUnitId) : sql`false`,
            eq(publicMenus.active, true),
            isNotNull(publicMenus.publishedAt),
          ),
        )
        .limit(1),
      tx
        .select({ id: memberships.id })
        .from(memberships)
        .innerJoin(roleBindings, eq(roleBindings.membershipId, memberships.id))
        .where(
          and(
            eq(memberships.organizationId, organizationId),
            eq(memberships.status, "active"),
            eq(roleBindings.role, "cashier"),
            selectedUnitId
              ? sql`(${roleBindings.unitId} is null or ${roleBindings.unitId} = ${selectedUnitId}::uuid)`
              : sql`false`,
          ),
        )
        .limit(1),
    ]);

    await this.setSystemEvidence(
      tx,
      organizationId,
      "business",
      business.length === 1,
      `organization:${organizationId}`,
      {},
      reason,
    );
    await this.setSystemEvidence(
      tx,
      organizationId,
      "unit",
      selectedUnits.length === 1,
      selectedUnitId ? `unit:${selectedUnitId}` : `organization:${organizationId}:unit-selection`,
      {
        selectedUnitId,
        selectedUnitActive: selectedUnits.length === 1,
      },
      reason,
    );
    await this.setSystemEvidence(
      tx,
      organizationId,
      "catalog",
      catalog.length > 0,
      selectedUnitId ? `unit:${selectedUnitId}:catalog` : `organization:${organizationId}:catalog`,
      {},
      reason,
    );
    await this.setSystemEvidence(
      tx,
      organizationId,
      "tables",
      tables.length > 0,
      selectedUnitId ? `unit:${selectedUnitId}:tables` : `organization:${organizationId}:tables`,
      {},
      reason,
    );
    await this.setSystemEvidence(
      tx,
      organizationId,
      "team",
      team.length >= 2,
      selectedUnitId ? `unit:${selectedUnitId}:team` : `organization:${organizationId}:team`,
      {
        activeMembersObserved: team.length,
      },
      reason,
    );
    await this.setSystemEvidence(
      tx,
      organizationId,
      "qr",
      false,
      selectedUnitId ? `unit:${selectedUnitId}:qr-readiness` : `organization:${organizationId}:qr`,
      {
        menuPublished: qr.length > 0,
        tablesConfigured: tables.length > 0,
        capabilitiesConfigured: false,
        serverTestPassed: false,
      },
      reason,
    );
    await this.setSystemEvidence(
      tx,
      organizationId,
      "cashier",
      cashier.length > 0,
      selectedUnitId ? `unit:${selectedUnitId}:cashier` : `organization:${organizationId}:cashier`,
      {},
      reason,
    );
    const [production] = await tx
      .select({
        status: onboardingChecklistItems.status,
        source: onboardingChecklistItems.source,
        evidence: onboardingChecklistItems.evidence,
      })
      .from(onboardingChecklistItems)
      .where(
        and(
          eq(onboardingChecklistItems.organizationId, organizationId),
          eq(onboardingChecklistItems.item, "production"),
        ),
      )
      .limit(1);
    if (
      production?.status === "verified" &&
      !(production.source === "actor_attestation" && production.evidence.mode === "off")
    ) {
      await this.setSystemEvidence(
        tx,
        organizationId,
        "production",
        false,
        selectedUnitId
          ? `unit:${selectedUnitId}:production-readiness`
          : `organization:${organizationId}:production-readiness`,
        {
          configured: false,
          serverTestPassed: false,
          requestedMode: production.evidence.mode ?? null,
        },
        reason,
      );
    }
    if (pinnedPlan) {
      await this.setSystemEvidence(
        tx,
        organizationId,
        "plan",
        true,
        `commercial-plan:${pinnedPlan.id}`,
        {
          catalogVersion: pinnedPlan.catalogVersion,
          slug: pinnedPlan.slug,
        },
        reason,
      );
    } else {
      await this.setSystemEvidence(
        tx,
        organizationId,
        "plan",
        false,
        `organization:${organizationId}:plan-selection`,
        {},
        reason,
      );
    }
  }

  private async checklist(tx: DatabaseExecutor, organizationId: string) {
    const rows = await tx
      .select()
      .from(onboardingChecklistItems)
      .where(eq(onboardingChecklistItems.organizationId, organizationId));
    return Object.fromEntries(
      rows.map((row) => [
        row.item,
        {
          status: row.status,
          source: row.source,
          evidenceReference: row.evidenceReference,
          evidence: row.evidence,
          actorIdentityId: row.actorIdentityId,
          verifiedAt: row.verifiedAt,
          waiverReason: row.waiverReason,
        } satisfies ChecklistEvidence,
      ]),
    ) as Partial<Record<ChecklistItem, ChecklistEvidence>>;
  }

  private provisioningProjection(run: ProvisioningRun | undefined) {
    if (!run) return null;
    return {
      id: run.id,
      state: run.state,
      checkpoint: run.checkpoint,
      attempts: run.attempts,
      lastErrorCode: run.lastErrorCode,
      nextRetryAt: run.nextRetryAt,
      completedAt: run.completedAt,
      failedAt: run.failedAt,
      createdAt: run.createdAt,
      updatedAt: run.updatedAt,
    };
  }

  private selectionProjection(record: OnboardingRecord, plan: PlanSnapshot | null) {
    if (!record.selectedUnitId || !plan || !record.selectedAt) return null;
    return {
      selectedUnitId: record.selectedUnitId,
      plan: publicPlan(plan),
      revision: record.selectionRevision,
      selectedAt: record.selectedAt,
      updatedAt: record.updatedAt,
    };
  }

  private onboardingProjection(
    record: OnboardingRecord,
    checklist: Partial<Record<ChecklistItem, ChecklistEvidence>>,
    plan: PlanSnapshot | null,
    provisioning?: ProvisioningRun,
  ) {
    const readiness = record.activatedAt
      ? { ready: true, missingItems: [] as ChecklistItem[] }
      : activationReadiness(checklist);
    return {
      organizationId: record.organizationId,
      activatedAt: record.activatedAt,
      items: checklist,
      ...readiness,
      selection: this.selectionProjection(record, plan),
      provisioning: this.provisioningProjection(provisioning),
    };
  }

  private async requireMutationRoleInTransaction(
    tx: TenantTransaction,
    identityId: string,
    organizationId: string,
    allowed: readonly ("owner" | "manager")[],
  ) {
    const bindings = await tx
      .select({ role: roleBindings.role })
      .from(memberships)
      .innerJoin(roleBindings, eq(roleBindings.membershipId, memberships.id))
      .where(
        and(
          eq(memberships.identityId, identityId),
          eq(memberships.organizationId, organizationId),
          eq(memberships.status, "active"),
          inArray(roleBindings.role, [...allowed]),
        ),
      );
    if (bindings.length === 0) {
      throw new ForbiddenException({
        code: "ONBOARDING_ROLE_CHANGED",
        message: "A autorização para alterar o onboarding não está mais ativa.",
      });
    }
    return bindings;
  }

  async get(identityId: string, organizationId: string) {
    await this.scope.requireOrganizationRole(identityId, organizationId, ["owner", "manager"]);
    return this.durable(identityId, organizationId, async (tx) => {
      await this.organizationLock(tx, organizationId);
      await this.requireMutationRoleInTransaction(tx, identityId, organizationId, [
        "owner",
        "manager",
      ]);
      const [record] = await tx
        .select()
        .from(onboardingRecords)
        .where(eq(onboardingRecords.organizationId, organizationId))
        .limit(1);
      if (!record) {
        throw new NotFoundException({
          code: "ONBOARDING_NOT_FOUND",
          message: "Onboarding não encontrado.",
        });
      }
      const selectedPlan = record.activatedAt
        ? frozenSelectedPlan(record)
        : await this.exactSelectedPlan(tx, record);
      if (!record.activatedAt) {
        await this.revalidateSystemChecklist(
          tx,
          organizationId,
          record.selectedUnitId,
          selectedPlan ?? undefined,
          "onboarding_get_refresh",
        );
      }
      const checklist = await this.checklist(tx, organizationId);
      const [provisioning] = await tx
        .select()
        .from(provisioningRuns)
        .where(eq(provisioningRuns.organizationId, organizationId))
        .orderBy(desc(provisioningRuns.createdAt))
        .limit(1);
      return this.onboardingProjection(record, checklist, selectedPlan, provisioning);
    });
  }

  async select(identityId: string, organizationId: string, input: OnboardingSelectionInput) {
    await this.scope.requireOrganizationRole(identityId, organizationId, ["owner"]);
    return this.durable(identityId, organizationId, async (tx) => {
      await this.organizationLock(tx, organizationId);
      if (!(await this.lockOwnerAuthorization(tx, identityId, organizationId))) {
        throw new ForbiddenException({
          code: "ONBOARDING_ROLE_CHANGED",
          message: "A autorização para alterar o onboarding não está mais ativa.",
        });
      }
      const [record] = await tx
        .select()
        .from(onboardingRecords)
        .where(eq(onboardingRecords.organizationId, organizationId))
        .limit(1);
      if (!record) {
        throw new NotFoundException({
          code: "ONBOARDING_NOT_FOUND",
          message: "Onboarding não encontrado.",
        });
      }
      if (record.activatedAt) {
        throw new ConflictException({
          code: "ONBOARDING_ALREADY_ACTIVATED",
          message: "O onboarding já foi ativado.",
        });
      }
      const [live] = await tx
        .select({ id: provisioningRuns.id })
        .from(provisioningRuns)
        .where(
          and(
            eq(provisioningRuns.organizationId, organizationId),
            ne(provisioningRuns.state, "terminal_failed"),
            ne(provisioningRuns.state, "compensated"),
          ),
        )
        .limit(1);
      if (live) {
        throw new ConflictException({
          code: "PROVISIONING_IN_PROGRESS",
          message: "A seleção não pode mudar durante o provisionamento.",
        });
      }
      const [selectedUnit] = await tx
        .select({ id: units.id })
        .from(units)
        .where(
          and(
            eq(units.organizationId, organizationId),
            eq(units.id, input.selectedUnitId),
            eq(units.active, true),
          ),
        )
        .limit(1);
      if (!selectedUnit) {
        throw new BadRequestException({
          code: "INVALID_ONBOARDING_UNIT",
          message: "Selecione uma unidade ativa desta organização.",
        });
      }
      const plan = await this.publishedPlan(tx, input.planSlug);
      if (!plan) {
        throw new BadRequestException({
          code: "PLAN_NOT_AVAILABLE",
          message: "O plano selecionado não está publicado.",
        });
      }
      const beforePlan = await this.exactSelectedPlan(tx, record);
      const sameSelection =
        record.selectedUnitId === input.selectedUnitId &&
        record.selectedPlanId === plan.id &&
        record.selectedPlanFingerprint === fingerprint(plan);
      if (sameSelection) return this.selectionProjection(record, beforePlan);
      if (record.selectedPlanId && !input.reselect) {
        throw new ConflictException({
          code: "ONBOARDING_RESELECT_REQUIRED",
          message: "Confirme explicitamente a troca do plano ou da unidade.",
        });
      }
      const now = new Date();
      const before = selectionAuditSnapshot(record);
      const [updated] = await tx
        .update(onboardingRecords)
        .set({
          selectedUnitId: input.selectedUnitId,
          selectedPlanId: plan.id,
          selectedCatalogVersion: plan.catalogVersion,
          selectedPlanSnapshot: plan,
          selectedPlanFingerprint: fingerprint(plan),
          selectedByIdentityId: identityId,
          selectedAt: now,
          selectionRevision: record.selectionRevision + 1,
          updatedAt: now,
        })
        .where(eq(onboardingRecords.organizationId, organizationId))
        .returning();
      if (!updated) throw new Error("Onboarding selection was not stored");
      await this.revalidateSystemChecklist(
        tx,
        organizationId,
        input.selectedUnitId,
        plan,
        "onboarding_selection_refresh",
      );
      const after = this.selectionProjection(updated, plan);
      await tx.insert(auditEvents).values({
        organizationId,
        unitId: input.selectedUnitId,
        actorIdentityId: identityId,
        action: before ? "onboarding.selection_reselected" : "onboarding.selection_selected",
        entityType: "onboarding_selection",
        entityId: organizationId,
        occurredAt: now,
        metadata: {
          before,
          after,
          reason: before ? "explicit_reselection" : "initial_selection",
          source: "owner_selection",
          evidence: {
            unit: `unit:${input.selectedUnitId}`,
            plan: `commercial-plan:${plan.id}:catalog:${plan.catalogVersion}`,
          },
          actorIdentityId: identityId,
          occurredAt: now.toISOString(),
        },
      });
      return after;
    });
  }

  async update(identityId: string, organizationId: string, input: UpdateOnboardingInput) {
    await this.scope.requireOrganizationRole(identityId, organizationId, ["owner", "manager"]);
    return this.durable(identityId, organizationId, async (tx) => {
      await this.organizationLock(tx, organizationId);
      const roles = await this.requireMutationRoleInTransaction(tx, identityId, organizationId, [
        "owner",
        "manager",
      ]);
      const [record] = await tx
        .select()
        .from(onboardingRecords)
        .where(eq(onboardingRecords.organizationId, organizationId))
        .limit(1);
      if (!record) {
        throw new NotFoundException({
          code: "ONBOARDING_NOT_FOUND",
          message: "Onboarding não encontrado.",
        });
      }
      if (record.activatedAt) {
        throw new ConflictException({
          code: "ONBOARDING_ALREADY_ACTIVATED",
          message: "O onboarding já foi ativado.",
        });
      }
      const [activeRun] = await tx
        .select({ id: provisioningRuns.id })
        .from(provisioningRuns)
        .where(
          and(
            eq(provisioningRuns.organizationId, organizationId),
            inArray(provisioningRuns.state, [
              "requested",
              "validating",
              "provisioning",
              "activating",
              "publishing",
              "completed",
            ]),
          ),
        )
        .limit(1);
      if (activeRun) {
        throw new ConflictException({
          code: "PROVISIONING_IN_PROGRESS",
          message: "O checklist não pode mudar durante a ativação.",
          details: { provisioningRunId: activeRun.id },
        });
      }
      await this.ensureChecklistRows(tx, organizationId);
      const beforeChecklist = await this.checklist(tx, organizationId);
      const now = new Date();
      const legacy = input.checklist ?? {};
      for (const [item, value] of Object.entries(legacy)) {
        await tx
          .update(onboardingChecklistItems)
          .set({
            status: value ? "in_progress" : "pending",
            source: "legacy_import",
            evidenceReference: null,
            evidence: { legacyValue: value },
            actorIdentityId: identityId,
            verifiedAt: null,
            waiverReason: null,
            updatedAt: now,
          })
          .where(
            and(
              eq(onboardingChecklistItems.organizationId, organizationId),
              eq(onboardingChecklistItems.item, item),
            ),
          );
      }

      const isOwner = roles.some((role) => role.role === "owner");
      for (const [rawItem, requested] of Object.entries(input.items ?? {})) {
        const item = rawItem as ChecklistItem;
        if (!requested) continue;
        if (requested.status === "pending" && !SYSTEM_ITEMS.has(item)) {
          await tx
            .update(onboardingChecklistItems)
            .set({
              status: "pending",
              source: "actor_attestation",
              evidenceReference: null,
              evidence: {},
              actorIdentityId: null,
              verifiedAt: null,
              waiverReason: null,
              updatedAt: now,
            })
            .where(
              and(
                eq(onboardingChecklistItems.organizationId, organizationId),
                eq(onboardingChecklistItems.item, item),
              ),
            );
          continue;
        }
        if (requested.status === "not_applicable") {
          if (!isOwner || !WAIVABLE_ITEMS.has(item) || !requested.waiverReason) {
            throw new BadRequestException({
              code: "INVALID_ONBOARDING_WAIVER",
              message: "A dispensa exige item permitido, justificativa e papel de proprietário.",
            });
          }
          await tx
            .update(onboardingChecklistItems)
            .set({
              status: "not_applicable",
              source: "authorized_waiver",
              evidenceReference:
                requested.evidenceReference ?? `waiver:${item}:${now.toISOString()}`,
              evidence: requested.evidence ?? {},
              waiverReason: requested.waiverReason,
              actorIdentityId: identityId,
              verifiedAt: now,
              updatedAt: now,
            })
            .where(
              and(
                eq(onboardingChecklistItems.organizationId, organizationId),
                eq(onboardingChecklistItems.item, item),
              ),
            );
          continue;
        }
        if (ATTESTED_ITEMS.has(item) && requested.status === "verified") {
          const evidence = (requested.evidence ?? {}) as Record<string, unknown>;
          if (item === "production" && ["kds", "print", "both"].includes(String(evidence.mode))) {
            throw new BadRequestException({
              code: "PRODUCTION_READINESS_NOT_VERIFIED",
              message:
                "KDS e impressão só podem ser ativados após configuração e teste comprovados pelo servidor.",
            });
          }
          const valid =
            (item === "fiscalChoice" &&
              ["disabled", "focus", "external"].includes(String(evidence.choice))) ||
            (item === "production" && evidence.mode === "off") ||
            ((item === "training" || item === "rehearsal") && evidence.completed === true);
          if (!valid || !requested.evidenceReference) {
            throw new BadRequestException({
              code: "INVALID_ONBOARDING_EVIDENCE",
              message: `Evidência estruturada inválida para ${item}.`,
            });
          }
          await tx
            .update(onboardingChecklistItems)
            .set({
              status: "verified",
              source: "actor_attestation",
              evidence,
              evidenceReference: requested.evidenceReference,
              actorIdentityId: identityId,
              verifiedAt: now,
              waiverReason: null,
              updatedAt: now,
            })
            .where(
              and(
                eq(onboardingChecklistItems.organizationId, organizationId),
                eq(onboardingChecklistItems.item, item),
              ),
            );
        } else if (!SYSTEM_ITEMS.has(item)) {
          const progressEvidence =
            "evidence" in requested ? (requested.evidence ?? {}) : {};
          const progressReference =
            "evidenceReference" in requested ? (requested.evidenceReference ?? null) : null;
          await tx
            .update(onboardingChecklistItems)
            .set({
              status: requested.status === "blocked" ? "blocked" : "in_progress",
              source: "actor_attestation",
              evidenceReference: progressReference,
              evidence: progressEvidence,
              actorIdentityId: identityId,
              verifiedAt: null,
              waiverReason: null,
              updatedAt: now,
            })
            .where(
              and(
                eq(onboardingChecklistItems.organizationId, organizationId),
                eq(onboardingChecklistItems.item, item),
              ),
            );
        }
      }

      const [updatedRecord] = await tx
        .update(onboardingRecords)
        .set({ checklist: { ...record.checklist, ...legacy }, updatedAt: now })
        .where(
          and(
            eq(onboardingRecords.organizationId, organizationId),
            isNull(onboardingRecords.activatedAt),
          ),
        )
        .returning();
      if (!updatedRecord) {
        throw new ConflictException({
          code: "ONBOARDING_ALREADY_ACTIVATED",
          message: "O onboarding já foi ativado.",
        });
      }
      const refreshedPlan = await this.exactSelectedPlan(tx, updatedRecord);
      await this.revalidateSystemChecklist(
        tx,
        organizationId,
        updatedRecord.selectedUnitId,
        refreshedPlan ?? undefined,
        "onboarding_patch_refresh",
      );
      const checklist = await this.checklist(tx, organizationId);
      await tx.insert(auditEvents).values({
        organizationId,
        actorIdentityId: identityId,
        action: "onboarding.updated",
        entityType: "onboarding",
        entityId: organizationId,
        occurredAt: now,
        metadata: {
          before: beforeChecklist,
          after: checklist,
          reason: "onboarding_checklist_update",
          source: "owner_or_manager_input",
          evidence: { requested: sanitizedChecklistRequest(input) },
          actorIdentityId: identityId,
          occurredAt: now.toISOString(),
        },
      });
      return this.onboardingProjection(updatedRecord, checklist, refreshedPlan);
    });
  }

  private async publishedPlan(tx: TenantTransaction, slug: string): Promise<PlanSnapshot | null> {
    const [plan] = await tx
      .select({
        id: commercialPlans.id,
        slug: commercialPlans.slug,
        catalogVersionId: commercialPlans.catalogVersionId,
        catalogVersion: commercialCatalogVersions.version,
        monthlyPriceCents: commercialPlans.monthlyPriceCents,
        annualPriceCents: commercialPlans.annualPriceCents,
        includedUnits: commercialPlans.includedUnits,
        entitlements: commercialPlans.entitlements,
      })
      .from(commercialPlans)
      .innerJoin(
        commercialCatalogVersions,
        eq(commercialCatalogVersions.id, commercialPlans.catalogVersionId),
      )
      .where(and(eq(commercialPlans.slug, slug), eq(commercialCatalogVersions.status, "published")))
      .orderBy(desc(commercialCatalogVersions.version))
      .limit(1);
    return plan ? planSnapshot(plan) : null;
  }

  private async exactPlan(
    tx: DatabaseExecutor,
    pin: {
      planId: string | null;
      catalogVersion: number | null;
      snapshot: Record<string, unknown> | null;
      fingerprint: string | null;
    },
  ) {
    if (!pin.planId || !pin.snapshot || !pin.fingerprint || pin.catalogVersion === null)
      return null;
    const [plan] = await tx
      .select({
        id: commercialPlans.id,
        slug: commercialPlans.slug,
        catalogVersionId: commercialPlans.catalogVersionId,
        catalogVersion: commercialCatalogVersions.version,
        monthlyPriceCents: commercialPlans.monthlyPriceCents,
        annualPriceCents: commercialPlans.annualPriceCents,
        includedUnits: commercialPlans.includedUnits,
        entitlements: commercialPlans.entitlements,
      })
      .from(commercialPlans)
      .innerJoin(
        commercialCatalogVersions,
        eq(commercialCatalogVersions.id, commercialPlans.catalogVersionId),
      )
      .where(
        and(
          eq(commercialPlans.id, pin.planId),
          eq(commercialCatalogVersions.status, "published"),
          eq(commercialCatalogVersions.version, pin.catalogVersion),
        ),
      )
      .limit(1);
    if (!plan) return null;
    const snapshot = planSnapshot(plan);
    if (fingerprint(snapshot) !== pin.fingerprint || fingerprint(pin.snapshot) !== pin.fingerprint)
      return null;
    return snapshot;
  }

  private exactPinnedPlan(tx: DatabaseExecutor, run: ProvisioningRun) {
    return this.exactPlan(tx, {
      planId: run.pinnedPlanId,
      catalogVersion: run.pinnedCatalogVersion,
      snapshot: run.planSnapshot,
      fingerprint: run.planFingerprint,
    });
  }

  private exactSelectedPlan(tx: DatabaseExecutor, record: OnboardingRecord) {
    return this.exactPlan(tx, {
      planId: record.selectedPlanId,
      catalogVersion: record.selectedCatalogVersion,
      snapshot: record.selectedPlanSnapshot,
      fingerprint: record.selectedPlanFingerprint,
    });
  }

  private async requireOwnerInTransaction(
    tx: TenantTransaction,
    identityId: string,
    organizationId: string,
  ) {
    if (!(await this.lockOwnerAuthorization(tx, identityId, organizationId))) {
      throw new ProvisioningError(
        "PROVISIONING_OWNER_CHANGED",
        "O proprietário que iniciou a ativação não possui mais autorização.",
        "terminal",
      );
    }
  }

  private async lockOwnerAuthorization(
    tx: TenantTransaction,
    identityId: string,
    organizationId: string,
  ) {
    // The SECURITY DEFINER boundary holds UPDATE row locks without granting
    // the application role mutation rights on identity authorization tables.
    // It validates both tenant and actor session settings, locks memberships
    // then role bindings in UUID order, and revalidates owner after waiting.
    const [result] = await tx.execute<{ authorized: boolean }>(sql`
      select public.giromesa_lock_onboarding_owner(
        ${organizationId}::uuid,
        ${identityId}::uuid
      ) as authorized
    `);
    return result?.authorized === true;
  }

  private async initializeRun(
    identityId: string,
    organizationId: string,
    idempotencyKey: string,
    input: ActivateTrialInput,
  ) {
    const requestFingerprint = fingerprint({ planSlug: input.planSlug ?? null });
    return this.durable(identityId, organizationId, async (tx) => {
      await this.organizationLock(tx, organizationId);
      await this.requireOwnerInTransaction(tx, identityId, organizationId);
      const [sameKey] = await tx
        .select()
        .from(provisioningRuns)
        .where(
          and(
            eq(provisioningRuns.organizationId, organizationId),
            eq(provisioningRuns.idempotencyKey, idempotencyKey),
          ),
        )
        .limit(1);
      if (sameKey) {
        if (sameKey.requestFingerprint !== requestFingerprint) {
          throw new ConflictException({
            code: "IDEMPOTENCY_INPUT_MISMATCH",
            message: "A chave de idempotência já foi usada com outro plano.",
          });
        }
        return sameKey;
      }
      const [selection] = await tx
        .select()
        .from(onboardingRecords)
        .where(eq(onboardingRecords.organizationId, organizationId))
        .limit(1);
      if (!selection?.selectedUnitId) {
        throw new BadRequestException({
          code: "ONBOARDING_SELECTION_REQUIRED",
          message: "Selecione e confirme a unidade e o plano antes de iniciar a ativação.",
        });
      }
      const selectedPlan = await this.exactSelectedPlan(tx, selection);
      if (!selectedPlan) {
        throw new ConflictException({
          code: "PLAN_DRIFT",
          message: "A seleção comercial mudou; faça uma nova seleção explícita.",
        });
      }
      if (input.planSlug && input.planSlug !== selectedPlan.slug) {
        throw new ConflictException({
          code: "ONBOARDING_PLAN_MISMATCH",
          message: "O plano do cliente legado não corresponde à seleção confirmada.",
        });
      }
      const [live] = await tx
        .select()
        .from(provisioningRuns)
        .where(
          and(
            eq(provisioningRuns.organizationId, organizationId),
            ne(provisioningRuns.state, "terminal_failed"),
            ne(provisioningRuns.state, "compensated"),
          ),
        )
        .limit(1);
      if (live) {
        throw new ConflictException({
          code:
            live.state === "completed"
              ? "ONBOARDING_ALREADY_ACTIVATED"
              : "PROVISIONING_IN_PROGRESS",
          message:
            live.state === "completed"
              ? "O teste já foi ativado por outra solicitação."
              : "Outra ativação já está em andamento para esta organização.",
          details: { provisioningRunId: live.id },
        });
      }
      const [created] = await tx
        .insert(provisioningRuns)
        .values({
          organizationId,
          idempotencyKey,
          requestFingerprint,
          planSlug: selectedPlan.slug,
          selectedUnitId: selection.selectedUnitId,
          pinnedPlanId: selectedPlan.id,
          pinnedCatalogVersion: selectedPlan.catalogVersion,
          planSnapshot: selectedPlan,
          planFingerprint: fingerprint(selectedPlan),
        })
        .returning();
      if (!created) throw new Error("Provisioning run was not created");
      return created;
    });
  }

  private async claimRun(identityId: string, organizationId: string, runId: string) {
    const leaseOwner = randomUUID();
    return this.durable(identityId, organizationId, async (tx) => {
      await this.organizationLock(tx, organizationId);
      const [run] = await tx
        .select()
        .from(provisioningRuns)
        .where(
          and(eq(provisioningRuns.id, runId), eq(provisioningRuns.organizationId, organizationId)),
        )
        .limit(1);
      if (!run) throw new NotFoundException();
      if (
        run.state === "completed" ||
        run.state === "compensated" ||
        run.state === "terminal_failed"
      ) {
        return { run, leaseOwner: null };
      }
      if (run.leaseOwner && run.leaseExpiresAt && run.leaseExpiresAt > new Date()) {
        return { run, leaseOwner: null };
      }
      const resumedState = provisioningResumeState(
        run.state as ProvisioningState,
        run.checkpoint as ProvisioningCheckpoint,
      );
      if (resumedState !== run.state) {
        assertProvisioningTransition(run.state as ProvisioningState, resumedState);
      }
      const [claimed] = await tx
        .update(provisioningRuns)
        .set({
          state: resumedState,
          attempts: run.attempts + 1,
          leaseOwner,
          leaseExpiresAt: new Date(Date.now() + LEASE_MILLISECONDS),
          leaseVersion: run.leaseVersion + 1,
          lastErrorCode: null,
          lastErrorMessage: null,
          nextRetryAt: null,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(provisioningRuns.id, run.id),
            eq(provisioningRuns.organizationId, organizationId),
            eq(provisioningRuns.leaseVersion, run.leaseVersion),
          ),
        )
        .returning();
      if (!claimed) return { run, leaseOwner: null };
      return { run: claimed, leaseOwner };
    });
  }

  private async waitForConcurrentRun(identityId: string, organizationId: string, runId: string) {
    const deadline = Date.now() + WAIT_FOR_CONCURRENT_RUN_MILLISECONDS;
    while (Date.now() < deadline) {
      const run = await this.durable(identityId, organizationId, async (tx) => {
        const [row] = await tx
          .select()
          .from(provisioningRuns)
          .where(
            and(
              eq(provisioningRuns.id, runId),
              eq(provisioningRuns.organizationId, organizationId),
            ),
          )
          .limit(1);
        return row;
      });
      if (run?.state === "completed" && run.response) return run.response;
      if (run && ["compensated", "terminal_failed", "retryable_failed"].includes(run.state)) {
        return null;
      }
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    return null;
  }

  private async recordStep(
    tx: TenantTransaction,
    run: ProvisioningRun,
    step: string,
    status: "in_progress" | "completed" | "failed" | "compensated",
    values: Partial<typeof provisioningSteps.$inferInsert> = {},
  ) {
    const now = new Date();
    await tx
      .insert(provisioningSteps)
      .values({
        organizationId: run.organizationId,
        provisioningRunId: run.id,
        step,
        status,
        attempts: 1,
        startedAt: now,
        completedAt: status === "completed" ? now : null,
        compensatedAt: status === "compensated" ? now : null,
        ...values,
      })
      .onConflictDoUpdate({
        target: [
          provisioningSteps.organizationId,
          provisioningSteps.provisioningRunId,
          provisioningSteps.step,
        ],
        set: {
          status,
          attempts: sql`${provisioningSteps.attempts} + 1`,
          startedAt: now,
          completedAt: status === "completed" ? now : null,
          compensatedAt: status === "compensated" ? now : null,
          updatedAt: now,
          ...values,
        },
      });
  }

  private async validate(
    identityId: string,
    organizationId: string,
    current: ProvisioningRun,
    leaseOwner: string,
  ) {
    return this.durable(identityId, organizationId, async (tx) => {
      await this.organizationLock(tx, organizationId);
      const [run] = await tx
        .select()
        .from(provisioningRuns)
        .where(
          and(
            eq(provisioningRuns.id, current.id),
            eq(provisioningRuns.organizationId, organizationId),
            eq(provisioningRuns.leaseOwner, leaseOwner),
          ),
        )
        .limit(1);
      if (!run)
        throw new ProvisioningError(
          "PROVISIONING_LEASE_LOST",
          "A ativação será retomada.",
          "transient",
        );
      await this.requireOwnerInTransaction(tx, identityId, organizationId);
      const [organization] = await tx
        .select({ state: organizations.billingState })
        .from(organizations)
        .where(eq(organizations.id, organizationId))
        .limit(1);
      if (!organization)
        throw new ProvisioningError(
          "ORGANIZATION_NOT_FOUND",
          "Organização não encontrada.",
          "terminal",
        );
      if (organization.state !== "onboarding") {
        throw new ProvisioningError(
          "INVALID_ACTIVATION_STATE",
          "A organização não pode ser ativada neste estado.",
          "terminal",
        );
      }
      if (!run.selectedUnitId || !run.pinnedPlanId || !run.planSnapshot || !run.planFingerprint) {
        throw new ProvisioningError(
          "PROVISIONING_CHECKPOINT_INVALID",
          "A seleção deve existir antes do início do provisionamento.",
          "terminal",
        );
      }
      const pinned = await this.exactPinnedPlan(tx, run);
      if (!pinned) {
        throw new ProvisioningError(
          "PLAN_DRIFT",
          "A versão selecionada do plano mudou ou deixou de estar publicada.",
          "terminal",
        );
      }
      await this.revalidateSystemChecklist(
        tx,
        organizationId,
        run.selectedUnitId,
        pinned,
        "provisioning_validation_refresh",
      );
      const checklist = await this.checklist(tx, organizationId);
      const readiness = activationReadiness(checklist);
      if (!readiness.ready) {
        throw new ProvisioningError(
          "ONBOARDING_INCOMPLETE",
          "Finalize o checklist verificado antes de ativar o teste.",
          "recoverable",
          { missingItems: readiness.missingItems },
        );
      }
      let validationState = run.state as ProvisioningState;
      if (validationState === "requested") {
        assertProvisioningTransition(validationState, "validating");
        validationState = "validating";
      }
      assertProvisioningTransition(validationState, "provisioning");
      await this.recordStep(tx, run, "validation", "completed", {
        checkpoint: { checklistItems: CHECKLIST_ITEMS, planFingerprint: fingerprint(pinned) },
      });
      const [updated] = await tx
        .update(provisioningRuns)
        .set({
          state: "provisioning",
          checkpoint: "validated",
          updatedAt: new Date(),
        })
        .where(and(eq(provisioningRuns.id, run.id), eq(provisioningRuns.leaseOwner, leaseOwner)))
        .returning();
      if (!updated) throw new Error("Provisioning validation checkpoint was not stored");
      return updated;
    });
  }

  private async provisionInternal(
    identityId: string,
    organizationId: string,
    current: ProvisioningRun,
    leaseOwner: string,
  ) {
    return this.durable(identityId, organizationId, async (tx) => {
      await this.organizationLock(tx, organizationId);
      const [run] = await tx
        .select()
        .from(provisioningRuns)
        .where(
          and(
            eq(provisioningRuns.id, current.id),
            eq(provisioningRuns.organizationId, organizationId),
            eq(provisioningRuns.leaseOwner, leaseOwner),
          ),
        )
        .limit(1);
      if (
        !run?.pinnedPlanId ||
        !run.planSnapshot ||
        !run.planFingerprint ||
        run.pinnedCatalogVersion === null
      ) {
        throw new ProvisioningError(
          "PROVISIONING_CHECKPOINT_INVALID",
          "A ativação será retomada.",
          "transient",
        );
      }
      const snapshot = run.planSnapshot as PlanSnapshot;
      const subscriptionId = deterministicUuid(`${run.id}:subscription`);
      // Keep this insert column-explicit: the application role intentionally
      // cannot write provider-owned billing identifiers.
      await tx.execute(sql`
        INSERT INTO subscriptions (
          id,
          organization_id,
          commercial_plan_id,
          provisioning_run_id,
          plan_snapshot,
          cycle,
          state
        ) VALUES (
          ${subscriptionId}::uuid,
          ${organizationId}::uuid,
          ${run.pinnedPlanId}::uuid,
          ${run.id}::uuid,
          ${JSON.stringify(snapshot)}::jsonb,
          'monthly',
          'onboarding'
        )
        ON CONFLICT DO NOTHING
      `);
      for (const entitlement of snapshot.entitlements) {
        await tx
          .insert(subscriptionEntitlements)
          .values({
            organizationId,
            subscriptionId,
            entitlement,
            state: "provisional",
            provisioningRunId: run.id,
            sourcePlanSnapshot: snapshot,
          })
          .onConflictDoNothing();
      }
      assertProvisioningTransition(run.state as ProvisioningState, "activating");
      await this.recordStep(tx, run, "internal_provisioning", "completed", {
        resourceId: subscriptionId,
        checkpoint: { subscriptionId, entitlementCount: snapshot.entitlements.length },
      });
      const [updated] = await tx
        .update(provisioningRuns)
        .set({ state: "activating", checkpoint: "internal_provisioned", updatedAt: new Date() })
        .where(and(eq(provisioningRuns.id, run.id), eq(provisioningRuns.leaseOwner, leaseOwner)))
        .returning();
      if (!updated) throw new Error("Internal provisioning checkpoint was not stored");
      return updated;
    });
  }

  private async commitActivation(
    identityId: string,
    organizationId: string,
    current: ProvisioningRun,
    leaseOwner: string,
  ) {
    return this.durable(identityId, organizationId, async (tx) => {
      await this.organizationLock(tx, organizationId);
      const [run] = await tx
        .select()
        .from(provisioningRuns)
        .where(
          and(
            eq(provisioningRuns.id, current.id),
            eq(provisioningRuns.organizationId, organizationId),
            eq(provisioningRuns.leaseOwner, leaseOwner),
          ),
        )
        .limit(1);
      if (
        !run?.pinnedPlanId ||
        !run.planSnapshot ||
        !run.planFingerprint ||
        run.pinnedCatalogVersion === null
      ) {
        throw new ProvisioningError(
          "PROVISIONING_CHECKPOINT_INVALID",
          "A ativação será retomada.",
          "transient",
        );
      }
      await this.requireOwnerInTransaction(tx, identityId, organizationId);
      const pinned = await this.exactPinnedPlan(tx, run);
      if (!pinned) {
        throw new ProvisioningError(
          "PLAN_DRIFT",
          "A versão selecionada do plano mudou ou deixou de estar publicada.",
          "terminal",
        );
      }
      if (!run.selectedUnitId) {
        throw new ProvisioningError(
          "PROVISIONING_CHECKPOINT_INVALID",
          "A unidade selecionada não está disponível.",
          "terminal",
        );
      }
      const [onboarding] = await tx
        .select()
        .from(onboardingRecords)
        .where(eq(onboardingRecords.organizationId, organizationId))
        .limit(1);
      if (!onboarding || onboarding.activatedAt) {
        throw new ProvisioningError(
          "ONBOARDING_ALREADY_ACTIVATED",
          "O onboarding já foi ativado ou não está mais disponível.",
          "terminal",
        );
      }
      if (
        onboarding.selectedUnitId !== run.selectedUnitId ||
        onboarding.selectedPlanId !== run.pinnedPlanId ||
        onboarding.selectedCatalogVersion !== run.pinnedCatalogVersion ||
        onboarding.selectedPlanFingerprint !== run.planFingerprint
      ) {
        throw new ProvisioningError(
          "ONBOARDING_SELECTION_DRIFT",
          "A seleção mudou depois do início da ativação.",
          "terminal",
        );
      }
      await this.revalidateSystemChecklist(
        tx,
        organizationId,
        run.selectedUnitId,
        pinned,
        "provisioning_final_revalidation",
      );
      const checklist = await this.checklist(tx, organizationId);
      const readiness = activationReadiness(checklist);
      if (!readiness.ready) {
        throw new ProvisioningError(
          "ONBOARDING_REVALIDATION_FAILED",
          "O checklist mudou antes do commit final.",
          "recoverable",
          { missingItems: readiness.missingItems },
        );
      }
      const [organization] = await tx
        .select({ state: organizations.billingState })
        .from(organizations)
        .where(eq(organizations.id, organizationId))
        .limit(1);
      if (organization?.state !== "onboarding") {
        throw new ProvisioningError(
          "INVALID_ACTIVATION_STATE",
          "A organização não pode ser ativada neste estado.",
          "terminal",
        );
      }
      const now = new Date();
      const pinnedCatalogVersion = run.pinnedCatalogVersion;
      const planFingerprint = run.planFingerprint;
      const window = trialWindow(now);
      const trialId = deterministicUuid(`${run.id}:trial`);
      const subscriptionId = deterministicUuid(`${run.id}:subscription`);
      const outboxEventId = deterministicUuid(`${run.id}:trial-activated-outbox`);
      await tx.insert(trials).values({
        id: trialId,
        organizationId,
        commercialPlanId: run.pinnedPlanId,
        provisioningRunId: run.id,
        ...window,
        activatedByIdentityId: identityId,
      });
      const [subscription] = await tx
        .update(subscriptions)
        .set({ state: "trial_active", currentPeriodEndsAt: window.endsAt, updatedAt: now })
        .where(
          and(
            eq(subscriptions.id, subscriptionId),
            eq(subscriptions.organizationId, organizationId),
            eq(subscriptions.provisioningRunId, run.id),
            eq(subscriptions.state, "onboarding"),
          ),
        )
        .returning({ id: subscriptions.id });
      if (!subscription) throw new Error("Provisioned subscription was not activated");
      await tx
        .update(subscriptionEntitlements)
        .set({ state: "active", activatedAt: now, updatedAt: now })
        .where(
          and(
            eq(subscriptionEntitlements.organizationId, organizationId),
            eq(subscriptionEntitlements.subscriptionId, subscriptionId),
            eq(subscriptionEntitlements.provisioningRunId, run.id),
            eq(subscriptionEntitlements.state, "provisional"),
          ),
        );
      const [activatedOrganization] = await tx
        .update(organizations)
        .set({ billingState: "trial_active", billingStateChangedAt: now, updatedAt: now })
        .where(
          and(eq(organizations.id, organizationId), eq(organizations.billingState, "onboarding")),
        )
        .returning({ id: organizations.id });
      if (!activatedOrganization) throw new Error("Organization activation CAS failed");
      const [activatedOnboarding] = await tx
        .update(onboardingRecords)
        .set({ activatedAt: now, activatedByIdentityId: identityId, updatedAt: now })
        .where(
          and(
            eq(onboardingRecords.organizationId, organizationId),
            isNull(onboardingRecords.activatedAt),
            eq(onboardingRecords.selectedUnitId, run.selectedUnitId),
            eq(onboardingRecords.selectedPlanId, run.pinnedPlanId),
            eq(onboardingRecords.selectedCatalogVersion, pinnedCatalogVersion),
            eq(onboardingRecords.selectedPlanFingerprint, planFingerprint),
          ),
        )
        .returning({ organizationId: onboardingRecords.organizationId });
      if (!activatedOnboarding) throw new Error("Onboarding activation CAS failed");
      await tx.insert(auditEvents).values({
        organizationId,
        actorIdentityId: identityId,
        action: "trial.activated",
        entityType: "trial",
        entityId: trialId,
        provisioningRunId: run.id,
        metadata: {
          planSlug: pinned.slug,
          planCatalogVersion: pinned.catalogVersion,
          startsAt: window.startsAt.toISOString(),
          endsAt: window.endsAt.toISOString(),
        },
      });
      await tx.insert(outboxEvents).values({
        id: outboxEventId,
        organizationId,
        topic: "trial.activated",
        aggregateType: "trial",
        aggregateId: trialId,
        provisioningRunId: run.id,
        payload: {
          organizationId,
          trialId,
          subscriptionId,
          planSlug: pinned.slug,
          startsAt: window.startsAt.toISOString(),
          endsAt: window.endsAt.toISOString(),
        },
      });
      assertProvisioningTransition(run.state as ProvisioningState, "publishing");
      await this.recordStep(tx, run, "activation", "completed", {
        resourceId: trialId,
        checkpoint: { trialId, subscriptionId, outboxEventId },
      });
      const response = {
        id: trialId,
        organizationId,
        commercialPlanId: run.pinnedPlanId,
        provisioningRunId: run.id,
        subscriptionId,
        startsAt: window.startsAt.toISOString(),
        endsAt: window.endsAt.toISOString(),
        state: "publishing",
        entitlements: pinned.entitlements,
      };
      const [updated] = await tx
        .update(provisioningRuns)
        .set({
          state: "publishing",
          checkpoint: "activation_committed",
          response,
          updatedAt: now,
        })
        .where(and(eq(provisioningRuns.id, run.id), eq(provisioningRuns.leaseOwner, leaseOwner)))
        .returning();
      if (!updated) throw new Error("Activation checkpoint was not stored");
      return updated;
    });
  }

  private async publish(
    identityId: string,
    organizationId: string,
    current: ProvisioningRun,
    leaseOwner: string,
  ) {
    return this.durable(identityId, organizationId, async (tx) => {
      await this.organizationLock(tx, organizationId);
      const [run] = await tx
        .select()
        .from(provisioningRuns)
        .where(
          and(
            eq(provisioningRuns.id, current.id),
            eq(provisioningRuns.organizationId, organizationId),
            eq(provisioningRuns.leaseOwner, leaseOwner),
          ),
        )
        .limit(1);
      if (!run?.response)
        throw new ProvisioningError(
          "PROVISIONING_CHECKPOINT_INVALID",
          "A ativação será retomada.",
          "transient",
        );
      const [activation] = await tx
        .select({ checkpoint: provisioningSteps.checkpoint })
        .from(provisioningSteps)
        .where(
          and(
            eq(provisioningSteps.organizationId, organizationId),
            eq(provisioningSteps.provisioningRunId, run.id),
            eq(provisioningSteps.step, "activation"),
            eq(provisioningSteps.status, "completed"),
          ),
        )
        .limit(1);
      if (!activation || typeof activation.checkpoint.outboxEventId !== "string") {
        throw new ProvisioningError(
          "PROVISIONING_PUBLICATION_MISSING",
          "A publicação será retomada.",
          "transient",
        );
      }
      assertProvisioningTransition(run.state as ProvisioningState, "completed");
      await this.recordStep(tx, run, "publication", "completed", {
        checkpoint: { outboxEventId: activation.checkpoint.outboxEventId },
      });
      const completedAt = new Date();
      const response = { ...run.response, state: "completed" };
      const [updated] = await tx
        .update(provisioningRuns)
        .set({
          state: "completed",
          checkpoint: "published",
          response,
          completedAt,
          leaseOwner: null,
          leaseExpiresAt: null,
          updatedAt: completedAt,
        })
        .where(and(eq(provisioningRuns.id, run.id), eq(provisioningRuns.leaseOwner, leaseOwner)))
        .returning();
      if (!updated) throw new Error("Provisioning completion was not stored");
      return updated;
    });
  }

  private async failRun(
    identityId: string,
    organizationId: string,
    run: ProvisioningRun,
    leaseOwner: string,
    failure: ProvisioningError,
  ) {
    return this.durable(identityId, organizationId, async (tx) => {
      await this.organizationLock(tx, organizationId);
      const [current] = await tx
        .select()
        .from(provisioningRuns)
        .where(
          and(
            eq(provisioningRuns.id, run.id),
            eq(provisioningRuns.organizationId, organizationId),
            eq(provisioningRuns.leaseOwner, leaseOwner),
          ),
        )
        .limit(1);
      if (!current || current.state === "completed") return current;
      const hasProvisionalResources = [
        "internal_provisioned",
        "activation_committed",
        "published",
      ].includes(current.checkpoint);
      if (failure.disposition === "terminal" && hasProvisionalResources) {
        if (current.state !== "compensating") {
          assertProvisioningTransition(current.state as ProvisioningState, "compensating");
        }
        const now = new Date();
        await tx
          .update(subscriptions)
          .set({ state: "canceled", updatedAt: now })
          .where(
            and(
              eq(subscriptions.organizationId, organizationId),
              eq(subscriptions.provisioningRunId, current.id),
              ne(subscriptions.state, "trial_active"),
            ),
          );
        await tx
          .update(subscriptionEntitlements)
          .set({ state: "revoked", revokedAt: now, updatedAt: now })
          .where(
            and(
              eq(subscriptionEntitlements.organizationId, organizationId),
              eq(subscriptionEntitlements.provisioningRunId, current.id),
              ne(subscriptionEntitlements.state, "active"),
            ),
          );
        await this.recordStep(tx, current, "compensation", "compensated", {
          checkpoint: { reasonCode: failure.code },
        });
        const [compensated] = await tx
          .update(provisioningRuns)
          .set({
            state: "compensated",
            checkpoint: "compensated",
            lastErrorCode: failure.code,
            lastErrorMessage: failure.message,
            failedAt: now,
            leaseOwner: null,
            leaseExpiresAt: null,
            updatedAt: now,
          })
          .where(eq(provisioningRuns.id, current.id))
          .returning();
        return compensated;
      }
      const targetState =
        failure.disposition === "terminal" ? "terminal_failed" : "retryable_failed";
      if (targetState !== current.state) {
        assertProvisioningTransition(current.state as ProvisioningState, targetState);
      }
      const now = new Date();
      const [failed] = await tx
        .update(provisioningRuns)
        .set({
          state: targetState,
          lastErrorCode: failure.code,
          lastErrorMessage: failure.message,
          nextRetryAt: failure.disposition === "transient" ? new Date(now.getTime() + 1_000) : null,
          failedAt: failure.disposition === "terminal" ? now : null,
          leaseOwner: null,
          leaseExpiresAt: null,
          updatedAt: now,
        })
        .where(eq(provisioningRuns.id, current.id))
        .returning();
      return failed;
    });
  }

  private throwFailure(failure: ProvisioningError): never {
    const body = { code: failure.code, message: failure.message, details: failure.details };
    if (
      failure.code === "ONBOARDING_INCOMPLETE" ||
      failure.code === "ONBOARDING_REVALIDATION_FAILED"
    ) {
      throw new BadRequestException(body);
    }
    if (failure.disposition === "terminal") throw new ConflictException(body);
    throw new ServiceUnavailableException(body);
  }

  async activate(
    identityId: string,
    organizationId: string,
    idempotencyKey: string,
    input: ActivateTrialInput,
  ) {
    await this.scope.requireOrganizationRole(identityId, organizationId, ["owner"]);
    let run = await this.initializeRun(identityId, organizationId, idempotencyKey, input);
    if (run.state === "completed" && run.response) return run.response;
    if (run.state === "compensated" || run.state === "terminal_failed") {
      throw new ConflictException({
        code: run.lastErrorCode ?? "PROVISIONING_TERMINAL_FAILURE",
        message: run.lastErrorMessage ?? "A ativação terminou sem aplicar efeitos.",
        details: { provisioningRunId: run.id },
      });
    }
    const claim = await this.claimRun(identityId, organizationId, run.id);
    run = claim.run;
    if (!claim.leaseOwner) {
      const response = await this.waitForConcurrentRun(identityId, organizationId, run.id);
      if (response) return response;
      throw new ConflictException({
        code: "PROVISIONING_IN_PROGRESS",
        message: "A ativação está em andamento ou aguarda retomada.",
        details: { provisioningRunId: run.id },
      });
    }
    const leaseOwner = claim.leaseOwner;
    try {
      while (true) {
        switch (run.state) {
          case "requested":
          case "validating":
            run = await this.validate(identityId, organizationId, run, leaseOwner);
            break;
          case "provisioning":
            run = await this.provisionInternal(identityId, organizationId, run, leaseOwner);
            break;
          case "activating":
            run = await this.commitActivation(identityId, organizationId, run, leaseOwner);
            break;
          case "publishing":
            run = await this.publish(identityId, organizationId, run, leaseOwner);
            break;
          case "completed":
            if (!run.response) throw new Error("Completed provisioning has no response");
            return run.response;
          default:
            throw new ProvisioningError(
              "PROVISIONING_STATE_INVALID",
              "O estado da ativação exige revisão.",
              "terminal",
            );
        }
      }
    } catch (error) {
      const failure = sanitizedFailure(error);
      await this.failRun(identityId, organizationId, run, leaseOwner, failure);
      this.throwFailure(failure);
    }
  }

  async provisioningStatus(identityId: string, organizationId: string, runId: string) {
    await this.scope.requireOrganizationRole(identityId, organizationId, ["owner", "manager"]);
    const [run] = await this.database.db
      .select()
      .from(provisioningRuns)
      .where(
        and(eq(provisioningRuns.id, runId), eq(provisioningRuns.organizationId, organizationId)),
      )
      .limit(1);
    if (!run) throw new NotFoundException();
    const steps = await this.database.db
      .select({
        step: provisioningSteps.step,
        status: provisioningSteps.status,
        attempts: provisioningSteps.attempts,
        startedAt: provisioningSteps.startedAt,
        completedAt: provisioningSteps.completedAt,
        compensatedAt: provisioningSteps.compensatedAt,
        createdAt: provisioningSteps.createdAt,
        updatedAt: provisioningSteps.updatedAt,
      })
      .from(provisioningSteps)
      .where(
        and(
          eq(provisioningSteps.organizationId, organizationId),
          eq(provisioningSteps.provisioningRunId, runId),
        ),
      );
    return { ...this.provisioningProjection(run), steps };
  }
}
