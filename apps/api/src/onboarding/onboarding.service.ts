import { createHash, randomUUID } from "node:crypto";
import type { ActivateTrialInput, UpdateOnboardingInput } from "@giromesa/contracts";
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
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from "@nestjs/common";
import { and, desc, eq, isNotNull, isNull, ne, sql } from "drizzle-orm";
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
  ) {
    const [existing] = await tx
      .select({ status: onboardingChecklistItems.status, source: onboardingChecklistItems.source })
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
    await tx
      .update(onboardingChecklistItems)
      .set({
        status: verified ? "verified" : "blocked",
        source: "system",
        evidenceReference,
        evidence,
        actorIdentityId: null,
        waiverReason: null,
        verifiedAt: verified ? now : null,
        updatedAt: now,
      })
      .where(
        and(
          eq(onboardingChecklistItems.organizationId, organizationId),
          eq(onboardingChecklistItems.item, item),
        ),
      );
  }

  private async revalidateSystemChecklist(
    tx: DatabaseExecutor,
    organizationId: string,
    pinnedPlan?: PlanSnapshot,
  ) {
    await this.ensureChecklistRows(tx, organizationId);
    const [business, activeUnits] = await Promise.all([
      tx
        .select({ id: organizations.id })
        .from(organizations)
        .where(eq(organizations.id, organizationId))
        .limit(1),
      tx
        .select({ id: units.id })
        .from(units)
        .where(and(eq(units.organizationId, organizationId), eq(units.active, true)))
        .limit(2),
    ]);
    const readinessUnitId = activeUnits[0]?.id;
    if (readinessUnitId) {
      await tx.execute(sql`select set_config('app.current_unit_id', ${readinessUnitId}, true)`);
    }
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
        .where(and(eq(posProducts.organizationId, organizationId), eq(posProducts.active, true)))
        .limit(1),
      tx
        .select({ id: posDiningTables.id })
        .from(posDiningTables)
        .where(
          and(eq(posDiningTables.organizationId, organizationId), eq(posDiningTables.active, true)),
        )
        .limit(1),
      tx
        .select({ id: memberships.identityId })
        .from(memberships)
        .where(
          and(eq(memberships.organizationId, organizationId), eq(memberships.status, "active")),
        )
        .limit(2),
      tx
        .select({ id: publicMenus.id })
        .from(publicMenus)
        .where(
          and(
            eq(publicMenus.organizationId, organizationId),
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
    );
    await this.setSystemEvidence(
      tx,
      organizationId,
      "unit",
      activeUnits.length > 0,
      `organization:${organizationId}:units`,
      {
        activeUnits: activeUnits.length,
      },
    );
    await this.setSystemEvidence(
      tx,
      organizationId,
      "catalog",
      catalog.length > 0,
      `organization:${organizationId}:catalog`,
    );
    await this.setSystemEvidence(
      tx,
      organizationId,
      "tables",
      tables.length > 0,
      `organization:${organizationId}:tables`,
    );
    await this.setSystemEvidence(
      tx,
      organizationId,
      "team",
      team.length >= 2,
      `organization:${organizationId}:team`,
      {
        activeMembersObserved: team.length,
      },
    );
    await this.setSystemEvidence(
      tx,
      organizationId,
      "qr",
      qr.length > 0,
      `organization:${organizationId}:qr`,
    );
    await this.setSystemEvidence(
      tx,
      organizationId,
      "cashier",
      cashier.length > 0,
      `organization:${organizationId}:cashier`,
    );
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

  async get(identityId: string, organizationId: string) {
    await this.scope.requireOrganizationRole(identityId, organizationId, ["owner", "manager"]);
    const [record] = await this.database.db
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
    await this.ensureChecklistRows(this.database.db, organizationId);
    await this.revalidateSystemChecklist(this.database.db, organizationId);
    const checklist = await this.checklist(this.database.db, organizationId);
    const readiness = activationReadiness(checklist);
    const [provisioning] = await this.database.db
      .select()
      .from(provisioningRuns)
      .where(eq(provisioningRuns.organizationId, organizationId))
      .orderBy(desc(provisioningRuns.createdAt))
      .limit(1);
    return { ...record, items: checklist, ...readiness, provisioning: provisioning ?? null };
  }

  async update(identityId: string, organizationId: string, input: UpdateOnboardingInput) {
    const roles = await this.scope.requireOrganizationRole(identityId, organizationId, [
      "owner",
      "manager",
    ]);
    const [record] = await this.database.db
      .select()
      .from(onboardingRecords)
      .where(eq(onboardingRecords.organizationId, organizationId))
      .limit(1);
    if (!record) throw new NotFoundException();
    if (record.activatedAt) {
      throw new ConflictException({
        code: "ONBOARDING_ALREADY_ACTIVATED",
        message: "O onboarding já foi ativado.",
      });
    }
    await this.ensureChecklistRows(this.database.db, organizationId);
    const now = new Date();
    const legacy = input.checklist ?? {};
    for (const [item, value] of Object.entries(legacy)) {
      await this.database.db
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
      if (requested.status === "not_applicable") {
        if (!isOwner || !WAIVABLE_ITEMS.has(item) || !requested.waiverReason) {
          throw new BadRequestException({
            code: "INVALID_ONBOARDING_WAIVER",
            message: "A dispensa exige item permitido, justificativa e papel de proprietário.",
          });
        }
        await this.database.db
          .update(onboardingChecklistItems)
          .set({
            status: "not_applicable",
            source: "authorized_waiver",
            evidenceReference: requested.evidenceReference ?? `waiver:${item}:${now.toISOString()}`,
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
        const evidence = requested.evidence ?? {};
        const valid =
          (item === "fiscalChoice" &&
            ["disabled", "focus", "external"].includes(String(evidence.choice))) ||
          (item === "production" &&
            ["kds", "print", "both", "off"].includes(String(evidence.mode))) ||
          ((item === "training" || item === "rehearsal") && evidence.completed === true);
        if (!valid || !requested.evidenceReference) {
          throw new BadRequestException({
            code: "INVALID_ONBOARDING_EVIDENCE",
            message: `Evidência estruturada inválida para ${item}.`,
          });
        }
        await this.database.db
          .update(onboardingChecklistItems)
          .set({
            status: "verified",
            source: "actor_attestation",
            evidenceReference: requested.evidenceReference,
            evidence,
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
        await this.database.db
          .update(onboardingChecklistItems)
          .set({
            status: requested.status === "blocked" ? "blocked" : "in_progress",
            source: "actor_attestation",
            evidenceReference: requested.evidenceReference ?? null,
            evidence: requested.evidence ?? {},
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

    await this.database.db
      .update(onboardingRecords)
      .set({ checklist: { ...record.checklist, ...legacy }, updatedAt: now })
      .where(eq(onboardingRecords.organizationId, organizationId));
    await this.revalidateSystemChecklist(this.database.db, organizationId);
    const checklist = await this.checklist(this.database.db, organizationId);
    await this.database.db.insert(auditEvents).values({
      organizationId,
      actorIdentityId: identityId,
      action: "onboarding.updated",
      entityType: "onboarding",
      entityId: organizationId,
      metadata: {
        changedItems: [...Object.keys(legacy), ...Object.keys(input.items ?? {})],
      },
    });
    return {
      ...record,
      checklist: { ...record.checklist, ...legacy },
      items: checklist,
      ...activationReadiness(checklist),
    };
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

  private async exactPinnedPlan(tx: TenantTransaction, run: ProvisioningRun) {
    if (!run.pinnedPlanId || !run.planSnapshot || !run.planFingerprint) return null;
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
          eq(commercialPlans.id, run.pinnedPlanId),
          eq(commercialCatalogVersions.status, "published"),
        ),
      )
      .limit(1);
    if (!plan) return null;
    const snapshot = planSnapshot(plan);
    if (fingerprint(snapshot) !== run.planFingerprint) return null;
    return snapshot;
  }

  private async requireOwnerInTransaction(
    tx: TenantTransaction,
    identityId: string,
    organizationId: string,
  ) {
    const [owner] = await tx
      .select({ id: memberships.id })
      .from(memberships)
      .innerJoin(roleBindings, eq(roleBindings.membershipId, memberships.id))
      .where(
        and(
          eq(memberships.identityId, identityId),
          eq(memberships.organizationId, organizationId),
          eq(memberships.status, "active"),
          eq(roleBindings.role, "owner"),
        ),
      )
      .limit(1);
    if (!owner) {
      throw new ProvisioningError(
        "PROVISIONING_OWNER_CHANGED",
        "O proprietário que iniciou a ativação não possui mais autorização.",
        "terminal",
      );
    }
  }

  private async initializeRun(
    identityId: string,
    organizationId: string,
    idempotencyKey: string,
    input: ActivateTrialInput,
  ) {
    const requestFingerprint = fingerprint({ planSlug: input.planSlug });
    return this.durable(identityId, organizationId, async (tx) => {
      await this.organizationLock(tx, organizationId);
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
          planSlug: input.planSlug,
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
      const pinned = run.pinnedPlanId
        ? await this.exactPinnedPlan(tx, run)
        : await this.publishedPlan(tx, run.planSlug);
      if (!pinned) {
        throw new ProvisioningError(
          run.pinnedPlanId ? "PLAN_DRIFT" : "PLAN_NOT_AVAILABLE",
          run.pinnedPlanId
            ? "A versão selecionada do plano mudou ou deixou de estar publicada."
            : "Plano selecionado indisponível.",
          "terminal",
        );
      }
      await this.revalidateSystemChecklist(tx, organizationId, pinned);
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
          pinnedPlanId: pinned.id,
          pinnedCatalogVersion: pinned.catalogVersion,
          planSnapshot: pinned,
          planFingerprint: fingerprint(pinned),
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
      if (!run?.pinnedPlanId || !run.planSnapshot) {
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
      if (!run?.pinnedPlanId || !run.planSnapshot) {
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
      await this.revalidateSystemChecklist(tx, organizationId, pinned);
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
      .select()
      .from(provisioningSteps)
      .where(
        and(
          eq(provisioningSteps.organizationId, organizationId),
          eq(provisioningSteps.provisioningRunId, runId),
        ),
      );
    return { ...run, steps };
  }
}
