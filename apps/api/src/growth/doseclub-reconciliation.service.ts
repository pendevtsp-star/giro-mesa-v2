import { createHash } from "node:crypto";
import {
  auditEvents,
  doseClubProductMappings,
  doseClubReconciliationFindings,
  doseClubReconciliationRuns,
  growthIntegrations,
  managementInventoryItems,
  managementStockLocations,
  posProducts,
} from "@giromesa/db";
import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { and, desc, eq, sql } from "drizzle-orm";
import { DatabaseService } from "../database/database.module.js";
import { ScopeService } from "../organizations/scope.service.js";
import type {
  DoseClubFindingRecheckInput,
  DoseClubMappingCreateInput,
  DoseClubMappingUpdateInput,
  DoseClubRetryRunInput,
} from "./growth.schemas.js";

const MANAGERS = ["owner", "manager"] as const;
type Transaction = Parameters<Parameters<DatabaseService["db"]["transaction"]>[0]>[0];

function fingerprint(value: unknown) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function assertIdempotencyKey(value: string | undefined) {
  const key = value?.trim();
  if (!key || key.length < 8 || key.length > 180)
    throw new BadRequestException({
      code: "IDEMPOTENCY_KEY_INVALID",
      message: "Informe uma chave de idempotência válida.",
    });
  return key;
}

@Injectable()
export class DoseClubReconciliationService {
  constructor(
    private readonly database: DatabaseService,
    private readonly scope: ScopeService,
  ) {}

  private async authorize(identityId: string, organizationId: string, unitId: string) {
    await this.scope.requireOrganizationRole(identityId, organizationId, MANAGERS);
    await this.scope.requireUnitAccess(identityId, organizationId, unitId);
  }

  private inUnit<T>(
    identityId: string,
    organizationId: string,
    unitId: string,
    work: (tx: Transaction) => Promise<T>,
  ) {
    return this.database.withTenantContext(
      { source: "http", organizationId, unitId, actorIdentityId: identityId },
      (tx) => work(tx as Transaction),
    );
  }

  private audit(
    tx: Transaction,
    input: {
      organizationId: string;
      unitId: string;
      identityId: string;
      action: string;
      entityType: string;
      entityId: string;
      metadata?: Record<string, unknown>;
    },
  ) {
    return tx.insert(auditEvents).values({
      organizationId: input.organizationId,
      unitId: input.unitId,
      actorIdentityId: input.identityId,
      action: input.action,
      entityType: input.entityType,
      entityId: input.entityId,
      metadata: input.metadata ?? {},
    });
  }

  private async validBinding(
    tx: Transaction,
    organizationId: string,
    input: {
      unitId: string;
      productId: string;
      inventoryItemId: string;
      stockLocationId: string;
    },
  ) {
    const [binding] = await tx
      .select({
        dimension: managementInventoryItems.dimension,
        unit: managementInventoryItems.unit,
        locationId: managementStockLocations.id,
      })
      .from(managementInventoryItems)
      .innerJoin(
        managementStockLocations,
        and(
          eq(managementStockLocations.organizationId, managementInventoryItems.organizationId),
          eq(managementStockLocations.unitId, managementInventoryItems.unitId),
          eq(managementStockLocations.id, input.stockLocationId),
          eq(managementStockLocations.active, true),
        ),
      )
      .where(
        and(
          eq(managementInventoryItems.organizationId, organizationId),
          eq(managementInventoryItems.unitId, input.unitId),
          eq(managementInventoryItems.id, input.inventoryItemId),
          eq(managementInventoryItems.productId, input.productId),
        ),
      )
      .limit(1);
    if (binding?.dimension !== "volume" || binding.unit.toLowerCase() !== "ml")
      throw new BadRequestException({
        code: "DOSECLUB_MAPPING_INCOMPATIBLE",
        message: "Associe produto, item volumétrico em ml e local ativo da mesma unidade.",
      });
  }

  private async mappingProjection(
    tx: Transaction,
    organizationId: string,
    unitId: string,
    mappingId: string,
  ) {
    const [mapping] = await tx
      .select({
        id: doseClubProductMappings.id,
        unitId: doseClubProductMappings.unitId,
        externalProductId: doseClubProductMappings.externalProductId,
        productId: doseClubProductMappings.productId,
        productName: posProducts.name,
        inventoryItemId: doseClubProductMappings.inventoryItemId,
        inventoryItemName: managementInventoryItems.name,
        stockLocationId: doseClubProductMappings.stockLocationId,
        stockLocationName: managementStockLocations.name,
        active: doseClubProductMappings.active,
        version: doseClubProductMappings.version,
        updatedAt: doseClubProductMappings.updatedAt,
      })
      .from(doseClubProductMappings)
      .innerJoin(
        posProducts,
        and(
          eq(posProducts.organizationId, doseClubProductMappings.organizationId),
          eq(posProducts.id, doseClubProductMappings.productId),
        ),
      )
      .innerJoin(
        managementInventoryItems,
        and(
          eq(managementInventoryItems.organizationId, doseClubProductMappings.organizationId),
          eq(managementInventoryItems.unitId, doseClubProductMappings.unitId),
          eq(managementInventoryItems.id, doseClubProductMappings.inventoryItemId),
        ),
      )
      .innerJoin(
        managementStockLocations,
        and(
          eq(managementStockLocations.organizationId, doseClubProductMappings.organizationId),
          eq(managementStockLocations.unitId, doseClubProductMappings.unitId),
          eq(managementStockLocations.id, doseClubProductMappings.stockLocationId),
        ),
      )
      .where(
        and(
          eq(doseClubProductMappings.organizationId, organizationId),
          eq(doseClubProductMappings.unitId, unitId),
          eq(doseClubProductMappings.id, mappingId),
        ),
      )
      .limit(1);
    if (!mapping) throw new Error("DOSECLUB_MAPPING_PROJECTION_FAILED");
    return mapping;
  }

  async overview(identityId: string, organizationId: string, unitId: string) {
    await this.authorize(identityId, organizationId, unitId);
    return this.inUnit(identityId, organizationId, unitId, async (tx) => {
      const [integration] = await tx
        .select({
          provider: growthIntegrations.provider,
          status: growthIntegrations.status,
          unitId: growthIntegrations.unitId,
          updatedAt: growthIntegrations.updatedAt,
        })
        .from(growthIntegrations)
        .where(
          and(
            eq(growthIntegrations.organizationId, organizationId),
            eq(growthIntegrations.unitId, unitId),
            eq(growthIntegrations.provider, "doseclub"),
          ),
        )
        .limit(1);
      const mappings = await tx
        .select({
          id: doseClubProductMappings.id,
          unitId: doseClubProductMappings.unitId,
          externalProductId: doseClubProductMappings.externalProductId,
          productId: doseClubProductMappings.productId,
          productName: posProducts.name,
          inventoryItemId: doseClubProductMappings.inventoryItemId,
          inventoryItemName: managementInventoryItems.name,
          stockLocationId: doseClubProductMappings.stockLocationId,
          stockLocationName: managementStockLocations.name,
          active: doseClubProductMappings.active,
          version: doseClubProductMappings.version,
          updatedAt: doseClubProductMappings.updatedAt,
        })
        .from(doseClubProductMappings)
        .innerJoin(
          posProducts,
          and(
            eq(posProducts.organizationId, doseClubProductMappings.organizationId),
            eq(posProducts.id, doseClubProductMappings.productId),
          ),
        )
        .innerJoin(
          managementInventoryItems,
          and(
            eq(managementInventoryItems.organizationId, doseClubProductMappings.organizationId),
            eq(managementInventoryItems.unitId, doseClubProductMappings.unitId),
            eq(managementInventoryItems.id, doseClubProductMappings.inventoryItemId),
          ),
        )
        .innerJoin(
          managementStockLocations,
          and(
            eq(managementStockLocations.organizationId, doseClubProductMappings.organizationId),
            eq(managementStockLocations.unitId, doseClubProductMappings.unitId),
            eq(managementStockLocations.id, doseClubProductMappings.stockLocationId),
          ),
        )
        .where(
          and(
            eq(doseClubProductMappings.organizationId, organizationId),
            eq(doseClubProductMappings.unitId, unitId),
          ),
        );
      const findings = await tx
        .select({
          id: doseClubReconciliationFindings.id,
          unitId: doseClubReconciliationFindings.unitId,
          kind: doseClubReconciliationFindings.kind,
          status: doseClubReconciliationFindings.status,
          severity: doseClubReconciliationFindings.severity,
          entityType: doseClubReconciliationFindings.entityType,
          entityId: doseClubReconciliationFindings.entityId,
          summary: doseClubReconciliationFindings.summary,
          evidence: doseClubReconciliationFindings.evidence,
          firstDetectedAt: doseClubReconciliationFindings.firstDetectedAt,
          lastDetectedAt: doseClubReconciliationFindings.lastDetectedAt,
          resolvedAt: doseClubReconciliationFindings.resolvedAt,
          version: doseClubReconciliationFindings.version,
        })
        .from(doseClubReconciliationFindings)
        .where(
          and(
            eq(doseClubReconciliationFindings.organizationId, organizationId),
            eq(doseClubReconciliationFindings.unitId, unitId),
          ),
        )
        .orderBy(desc(doseClubReconciliationFindings.lastDetectedAt));
      const runs = await tx
        .select({
          id: doseClubReconciliationRuns.id,
          unitId: doseClubReconciliationRuns.unitId,
          runDate: doseClubReconciliationRuns.runDate,
          trigger: doseClubReconciliationRuns.trigger,
          status: doseClubReconciliationRuns.status,
          findingCount: doseClubReconciliationRuns.findingCount,
          failureCode: doseClubReconciliationRuns.failureCode,
          version: doseClubReconciliationRuns.version,
          startedAt: doseClubReconciliationRuns.startedAt,
          completedAt: doseClubReconciliationRuns.completedAt,
          createdAt: doseClubReconciliationRuns.createdAt,
          updatedAt: doseClubReconciliationRuns.updatedAt,
        })
        .from(doseClubReconciliationRuns)
        .where(
          and(
            eq(doseClubReconciliationRuns.organizationId, organizationId),
            eq(doseClubReconciliationRuns.unitId, unitId),
          ),
        )
        .orderBy(desc(doseClubReconciliationRuns.createdAt))
        .limit(20);
      const lastRun = runs[0] ?? null;
      const openFindingCount = findings.filter((item) => item.status === "open").length;
      const status = !lastRun
        ? "not_scanned"
        : lastRun.status === "failed"
          ? "failed"
          : openFindingCount > 0
            ? "attention"
            : lastRun.status === "completed"
              ? "healthy"
              : "not_scanned";
      return {
        integration: integration ?? null,
        reconciliation: {
          status,
          remoteHeartbeat: "partial" as const,
          lastRun,
          openFindingCount,
        },
        mappings,
        findings,
        runs,
      };
    });
  }

  async createMapping(
    identityId: string,
    organizationId: string,
    input: DoseClubMappingCreateInput,
  ) {
    await this.authorize(identityId, organizationId, input.unitId);
    return this.inUnit(identityId, organizationId, input.unitId, async (tx) => {
      await tx.execute(
        sql`select pg_advisory_xact_lock(hashtextextended(${`doseclub-mapping:${organizationId}:${input.unitId}:${input.productId}`}, 0))`,
      );
      await this.validBinding(tx, organizationId, input);
      const [existing] = await tx
        .select({ id: doseClubProductMappings.id })
        .from(doseClubProductMappings)
        .where(
          and(
            eq(doseClubProductMappings.organizationId, organizationId),
            eq(doseClubProductMappings.unitId, input.unitId),
            eq(doseClubProductMappings.externalProductId, input.productId),
          ),
        )
        .limit(1);
      if (existing)
        throw new ConflictException({
          code: "DOSECLUB_MAPPING_EXISTS",
          message: "Este produto já possui mapeamento nesta unidade.",
        });
      const [created] = await tx
        .insert(doseClubProductMappings)
        .values({
          organizationId,
          unitId: input.unitId,
          externalProductId: input.productId,
          productId: input.productId,
          inventoryItemId: input.inventoryItemId,
          stockLocationId: input.stockLocationId,
        })
        .returning();
      if (!created) throw new Error("DOSECLUB_MAPPING_INSERT_FAILED");
      await this.audit(tx, {
        organizationId,
        unitId: input.unitId,
        identityId,
        action: "doseclub.mapping.created",
        entityType: "doseclub_product_mapping",
        entityId: created.id,
        metadata: { externalProductId: created.externalProductId, version: created.version },
      });
      return this.mappingProjection(tx, organizationId, input.unitId, created.id);
    });
  }

  async updateMapping(
    identityId: string,
    organizationId: string,
    mappingId: string,
    input: DoseClubMappingUpdateInput,
  ) {
    await this.authorize(identityId, organizationId, input.unitId);
    return this.inUnit(identityId, organizationId, input.unitId, async (tx) => {
      const [mapping] = await tx
        .select({ productId: doseClubProductMappings.productId })
        .from(doseClubProductMappings)
        .where(
          and(
            eq(doseClubProductMappings.organizationId, organizationId),
            eq(doseClubProductMappings.unitId, input.unitId),
            eq(doseClubProductMappings.id, mappingId),
            eq(doseClubProductMappings.version, input.expectedVersion),
          ),
        )
        .limit(1);
      if (!mapping)
        throw new ConflictException({
          code: "DOSECLUB_MAPPING_VERSION_CONFLICT",
          message: "O mapeamento foi alterado por outra sessão.",
        });
      await this.validBinding(tx, organizationId, { ...input, productId: mapping.productId });
      const [updated] = await tx
        .update(doseClubProductMappings)
        .set({
          inventoryItemId: input.inventoryItemId,
          stockLocationId: input.stockLocationId,
          active: input.active,
          version: input.expectedVersion + 1,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(doseClubProductMappings.organizationId, organizationId),
            eq(doseClubProductMappings.unitId, input.unitId),
            eq(doseClubProductMappings.id, mappingId),
            eq(doseClubProductMappings.version, input.expectedVersion),
          ),
        )
        .returning();
      if (!updated)
        throw new ConflictException({
          code: "DOSECLUB_MAPPING_VERSION_CONFLICT",
          message: "O mapeamento foi alterado por outra sessão.",
        });
      await this.audit(tx, {
        organizationId,
        unitId: input.unitId,
        identityId,
        action: "doseclub.mapping.updated",
        entityType: "doseclub_product_mapping",
        entityId: updated.id,
        metadata: { active: updated.active, version: updated.version },
      });
      return this.mappingProjection(tx, organizationId, input.unitId, updated.id);
    });
  }

  private async requestRunInTransaction(
    tx: Transaction,
    input: {
      identityId: string;
      organizationId: string;
      unitId: string;
      idempotencyKey: string;
      metadata: Record<string, unknown>;
    },
  ) {
    const requestFingerprint = fingerprint({
      unitId: input.unitId,
      action: "doseclub.reconciliation.run",
      metadata: input.metadata,
    });
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtextextended(${`doseclub-run:${input.organizationId}:${input.unitId}:${input.idempotencyKey}`}, 0))`,
    );
    const [existing] = await tx
      .select()
      .from(doseClubReconciliationRuns)
      .where(
        and(
          eq(doseClubReconciliationRuns.organizationId, input.organizationId),
          eq(doseClubReconciliationRuns.unitId, input.unitId),
          eq(doseClubReconciliationRuns.idempotencyKey, input.idempotencyKey),
        ),
      )
      .limit(1);
    if (existing) {
      if (existing.requestFingerprint !== requestFingerprint)
        throw new ConflictException({
          code: "IDEMPOTENCY_KEY_REUSED",
          message: "A chave de idempotência já foi usada com outro conteúdo.",
        });
      return existing;
    }
    const [created] = await tx
      .insert(doseClubReconciliationRuns)
      .values({
        organizationId: input.organizationId,
        unitId: input.unitId,
        runDate: new Date().toISOString().slice(0, 10),
        trigger: "manual",
        status: "pending",
        idempotencyKey: input.idempotencyKey,
        requestFingerprint,
        requestedByIdentityId: input.identityId,
      })
      .returning();
    if (!created) throw new Error("DOSECLUB_RECONCILIATION_RUN_INSERT_FAILED");
    await this.audit(tx, {
      organizationId: input.organizationId,
      unitId: input.unitId,
      identityId: input.identityId,
      action: "doseclub.reconciliation.requested",
      entityType: "doseclub_reconciliation_run",
      entityId: created.id,
      metadata: input.metadata,
    });
    return created;
  }

  async requestRun(
    identityId: string,
    organizationId: string,
    unitId: string,
    rawIdempotencyKey: string | undefined,
    metadata: Record<string, unknown> = {},
  ) {
    const idempotencyKey = assertIdempotencyKey(rawIdempotencyKey);
    await this.authorize(identityId, organizationId, unitId);
    return this.inUnit(identityId, organizationId, unitId, (tx) =>
      this.requestRunInTransaction(tx, {
        identityId,
        organizationId,
        unitId,
        idempotencyKey,
        metadata,
      }),
    );
  }

  async retryRun(
    identityId: string,
    organizationId: string,
    runId: string,
    input: DoseClubRetryRunInput,
  ) {
    await this.authorize(identityId, organizationId, input.unitId);
    return this.inUnit(identityId, organizationId, input.unitId, async (tx) => {
      const [updated] = await tx
        .update(doseClubReconciliationRuns)
        .set({
          status: "pending",
          leaseOwner: null,
          leaseUntil: null,
          failureCode: null,
          startedAt: null,
          completedAt: null,
          version: input.expectedVersion + 1,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(doseClubReconciliationRuns.organizationId, organizationId),
            eq(doseClubReconciliationRuns.unitId, input.unitId),
            eq(doseClubReconciliationRuns.id, runId),
            eq(doseClubReconciliationRuns.status, "failed"),
            eq(doseClubReconciliationRuns.version, input.expectedVersion),
          ),
        )
        .returning();
      if (!updated)
        throw new ConflictException({
          code: "DOSECLUB_RUN_RETRY_CONFLICT",
          message: "A execução não está mais disponível para nova tentativa.",
        });
      await this.audit(tx, {
        organizationId,
        unitId: input.unitId,
        identityId,
        action: "doseclub.reconciliation.retry_requested",
        entityType: "doseclub_reconciliation_run",
        entityId: updated.id,
        metadata: { version: updated.version },
      });
      return updated;
    });
  }

  async recheckFinding(
    identityId: string,
    organizationId: string,
    findingId: string,
    input: DoseClubFindingRecheckInput,
    rawIdempotencyKey: string | undefined,
  ) {
    const idempotencyKey = assertIdempotencyKey(rawIdempotencyKey);
    await this.authorize(identityId, organizationId, input.unitId);
    return this.inUnit(identityId, organizationId, input.unitId, async (tx) => {
      await tx.execute(
        sql`select id from ${doseClubReconciliationFindings}
            where organization_id = ${organizationId}::uuid
              and unit_id = ${input.unitId}::uuid
              and id = ${findingId}::uuid
            for update`,
      );
      const [row] = await tx
        .select({
          id: doseClubReconciliationFindings.id,
          version: doseClubReconciliationFindings.version,
        })
        .from(doseClubReconciliationFindings)
        .where(
          and(
            eq(doseClubReconciliationFindings.organizationId, organizationId),
            eq(doseClubReconciliationFindings.unitId, input.unitId),
            eq(doseClubReconciliationFindings.id, findingId),
          ),
        )
        .limit(1);
      if (!row)
        throw new NotFoundException({
          code: "DOSECLUB_FINDING_NOT_FOUND",
          message: "Divergência não encontrada.",
        });
      if (row.version !== input.expectedVersion)
        throw new ConflictException({
          code: "DOSECLUB_FINDING_VERSION_CONFLICT",
          message: "A divergência foi atualizada por outra sessão.",
        });
      return this.requestRunInTransaction(tx, {
        identityId,
        organizationId,
        unitId: input.unitId,
        idempotencyKey,
        metadata: { findingId, findingVersion: row.version },
      });
    });
  }
}
