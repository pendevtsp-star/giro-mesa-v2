import { createHash, randomUUID } from "node:crypto";
import { createDatabase, type DatabaseConnection, withWorkerContext } from "@giromesa/db";
import { sql } from "drizzle-orm";

type MappingSource = Readonly<{
  externalProductId: string;
  active: boolean;
  dimension: string;
  unit: string;
}>;

type StateSource = Readonly<{
  externalClubId: string;
  eligibleProductIds: readonly string[];
  contractVersion: string;
  version: number;
  updatedAt: Date;
  latestOperationVersion: number | null;
  latestReconcileAt: Date | null;
}>;

export type DoseClubFindingCandidate = Readonly<{
  fingerprint: string;
  kind:
    | "missing_mapping"
    | "inactive_mapping"
    | "invalid_inventory_dimension"
    | "invalid_inventory_unit"
    | "state_version_gap"
    | "missing_reconcile_heartbeat";
  severity: "warning" | "critical";
  entityType: "product" | "club";
  entityId: string;
  summary: string;
  evidence: Record<string, unknown>;
}>;

type ClaimedRun = {
  id: string;
  organization_id: string;
  unit_id: string;
  lease_owner: string;
};

const HEARTBEAT_MAX_AGE_MS = 26 * 60 * 60 * 1_000;

function finding(
  kind: DoseClubFindingCandidate["kind"],
  severity: DoseClubFindingCandidate["severity"],
  entityType: DoseClubFindingCandidate["entityType"],
  entityId: string,
  summary: string,
  evidence: Record<string, unknown>,
): DoseClubFindingCandidate {
  return {
    fingerprint: createHash("sha256")
      .update(JSON.stringify([kind, entityType, entityId]))
      .digest("hex"),
    kind,
    severity,
    entityType,
    entityId,
    summary,
    evidence,
  };
}

export function buildDoseClubFindings(
  source: Readonly<{ mappings: readonly MappingSource[]; states: readonly StateSource[] }>,
  now = new Date(),
): DoseClubFindingCandidate[] {
  const findings: DoseClubFindingCandidate[] = [];
  const mappingByExternalProduct = new Map(
    source.mappings.map((mapping) => [mapping.externalProductId, mapping] as const),
  );

  for (const mapping of source.mappings) {
    if (!mapping.active)
      findings.push(
        finding(
          "inactive_mapping",
          "critical",
          "product",
          mapping.externalProductId,
          "O produto elegível está associado a um mapeamento inativo.",
          { externalProductId: mapping.externalProductId },
        ),
      );
    if (mapping.dimension !== "volume")
      findings.push(
        finding(
          "invalid_inventory_dimension",
          "critical",
          "product",
          mapping.externalProductId,
          "O item de estoque associado não usa dimensão de volume.",
          { externalProductId: mapping.externalProductId, observedDimension: mapping.dimension },
        ),
      );
    if (mapping.unit.toLowerCase() !== "ml")
      findings.push(
        finding(
          "invalid_inventory_unit",
          "critical",
          "product",
          mapping.externalProductId,
          "O item de estoque associado não usa mililitros como unidade base.",
          { externalProductId: mapping.externalProductId, observedUnit: mapping.unit },
        ),
      );
  }

  for (const state of source.states) {
    for (const externalProductId of state.eligibleProductIds) {
      if (!mappingByExternalProduct.has(externalProductId))
        findings.push(
          finding(
            "missing_mapping",
            "critical",
            "product",
            externalProductId,
            "Produto elegível do DoseClube ainda não possui mapeamento local.",
            { externalClubId: state.externalClubId, externalProductId },
          ),
        );
    }

    if (state.latestOperationVersion === null || state.latestOperationVersion !== state.version)
      findings.push(
        finding(
          "state_version_gap",
          "critical",
          "club",
          state.externalClubId,
          "A versão do estado local diverge da última operação aceita.",
          {
            externalClubId: state.externalClubId,
            stateVersion: state.version,
            latestOperationVersion: state.latestOperationVersion,
          },
        ),
      );

    if (
      state.contractVersion === "v2" &&
      now.getTime() - state.updatedAt.getTime() > HEARTBEAT_MAX_AGE_MS &&
      (!state.latestReconcileAt ||
        now.getTime() - state.latestReconcileAt.getTime() > HEARTBEAT_MAX_AGE_MS)
    )
      findings.push(
        finding(
          "missing_reconcile_heartbeat",
          "warning",
          "club",
          state.externalClubId,
          "Não há heartbeat de reconciliação v2 recente para este clube.",
          {
            externalClubId: state.externalClubId,
            lastStateUpdateAt: state.updatedAt.toISOString(),
            lastReconcileAt: state.latestReconcileAt?.toISOString() ?? null,
            coverage: "partial",
          },
        ),
      );
  }

  return [...new Map(findings.map((item) => [item.fingerprint, item])).values()].sort(
    (left, right) => left.fingerprint.localeCompare(right.fingerprint),
  );
}

export class DoseClubReconciliationWorker {
  constructor(
    private readonly connection: DatabaseConnection = createDatabase(),
    private readonly workerId = `doseclub-reconciliation:${randomUUID()}`,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async runOnce(limit = 10) {
    await this.scheduleDailyRuns();
    let processed = 0;
    while (processed < limit) {
      const run = await this.claimRun();
      if (!run) break;
      await this.processRun(run);
      processed += 1;
    }
    return processed;
  }

  private async scheduleDailyRuns() {
    const runDate = this.now().toISOString().slice(0, 10);
    await withWorkerContext(this.connection, async (tx) => {
      await tx.execute(sql`
        insert into public.doseclub_reconciliation_runs (
          organization_id, unit_id, run_date, trigger, status
        )
        select distinct integration.organization_id, integration.unit_id, ${runDate}::date,
          'scheduled', 'pending'
        from public.growth_integrations as integration
        where integration.provider = 'doseclub'
          and integration.status = 'active'
          and integration.unit_id is not null
        on conflict (organization_id, unit_id, run_date) where trigger = 'scheduled'
        do nothing
      `);
    });
  }

  private async claimRun(): Promise<ClaimedRun | null> {
    return withWorkerContext(this.connection, async (tx) => {
      const now = this.now();
      const nowIso = now.toISOString();
      const leaseUntilIso = new Date(now.getTime() + 5 * 60 * 1_000).toISOString();
      const rows = await tx.execute<ClaimedRun>(sql`
        with candidate as (
          select id
          from public.doseclub_reconciliation_runs
          where status = 'pending'
             or (status = 'running' and lease_until < ${nowIso}::timestamptz)
          order by created_at, id
          for update skip locked
          limit 1
        )
        update public.doseclub_reconciliation_runs as run
        set status = 'running',
            lease_owner = ${this.workerId},
            lease_until = ${leaseUntilIso}::timestamptz,
            started_at = coalesce(started_at, ${nowIso}::timestamptz),
            completed_at = null,
            failure_code = null,
            version = version + 1,
            updated_at = ${nowIso}::timestamptz
        from candidate
        where run.id = candidate.id
        returning run.id, run.organization_id, run.unit_id, run.lease_owner
      `);
      return rows[0] ?? null;
    });
  }

  private async processRun(run: ClaimedRun) {
    try {
      await withWorkerContext(this.connection, async (tx) => {
        const observedAt = this.now();
        const observedAtIso = observedAt.toISOString();
        const mappings = await tx.execute<{
          external_product_id: string;
          active: boolean;
          dimension: string;
          unit: string;
        }>(sql`
          select mapping.external_product_id, mapping.active,
            item.dimension, item.unit
          from public.doseclub_product_mappings as mapping
          inner join public.management_inventory_items as item
            on item.organization_id = mapping.organization_id
           and item.unit_id = mapping.unit_id
           and item.id = mapping.inventory_item_id
          where mapping.organization_id = ${run.organization_id}
            and mapping.unit_id = ${run.unit_id}
        `);
        const states = await tx.execute<{
          external_club_id: string;
          eligible_product_ids: string[];
          contract_version: string;
          version: number;
          updated_at: Date;
          latest_operation_version: number | null;
          latest_reconcile_at: Date | null;
        }>(sql`
          select state.external_club_id, state.eligible_product_ids,
            state.contract_version, state.version, state.updated_at,
            latest.version latest_operation_version,
            latest_reconcile.occurred_at latest_reconcile_at
          from public.doseclub_states as state
          left join lateral (
            select operation.version
            from public.doseclub_operations as operation
            where operation.organization_id = state.organization_id
              and operation.unit_id = state.unit_id
              and operation.external_club_id = state.external_club_id
            order by operation.version desc, operation.created_at desc
            limit 1
          ) latest on true
          left join lateral (
            select operation.occurred_at
            from public.doseclub_operations as operation
            where operation.organization_id = state.organization_id
              and operation.unit_id = state.unit_id
              and operation.external_club_id = state.external_club_id
              and operation.operation = 'reconcile'
            order by operation.occurred_at desc
            limit 1
          ) latest_reconcile on true
          where state.organization_id = ${run.organization_id}
            and state.unit_id = ${run.unit_id}
        `);
        const candidates = buildDoseClubFindings(
          {
            mappings: mappings.map((row) => ({
              externalProductId: row.external_product_id,
              active: row.active,
              dimension: row.dimension,
              unit: row.unit,
            })),
            states: states.map((row) => ({
              externalClubId: row.external_club_id,
              eligibleProductIds: row.eligible_product_ids,
              contractVersion: row.contract_version,
              version: row.version,
              updatedAt: new Date(row.updated_at),
              latestOperationVersion: row.latest_operation_version,
              latestReconcileAt: row.latest_reconcile_at ? new Date(row.latest_reconcile_at) : null,
            })),
          },
          observedAt,
        );

        await tx.execute(
          sql`select pg_advisory_xact_lock(hashtextextended(${`doseclub-reconciliation:${run.organization_id}:${run.unit_id}`}, 0))`,
        );
        for (const candidate of candidates) {
          await tx.execute(sql`
            insert into public.doseclub_reconciliation_findings (
              organization_id, unit_id, last_run_id, fingerprint, kind, status,
              severity, entity_type, entity_id, summary, evidence,
              first_detected_at, last_detected_at
            ) values (
              ${run.organization_id}, ${run.unit_id}, ${run.id}, ${candidate.fingerprint},
              ${candidate.kind}, 'open', ${candidate.severity}, ${candidate.entityType},
              ${candidate.entityId}, ${candidate.summary}, ${candidate.evidence},
              ${observedAtIso}::timestamptz, ${observedAtIso}::timestamptz
            )
            on conflict (organization_id, unit_id, fingerprint) do update
            set last_run_id = excluded.last_run_id,
                status = 'open',
                severity = excluded.severity,
                summary = excluded.summary,
                evidence = excluded.evidence,
                last_detected_at = excluded.last_detected_at,
                resolved_at = null,
                version = doseclub_reconciliation_findings.version + 1,
                updated_at = excluded.last_detected_at
          `);
        }

        const fingerprints = candidates.map((candidate) => candidate.fingerprint);
        if (fingerprints.length === 0)
          await tx.execute(sql`
            update public.doseclub_reconciliation_findings
            set status = 'resolved', resolved_at = ${observedAtIso}::timestamptz,
                version = version + 1, updated_at = ${observedAtIso}::timestamptz
            where organization_id = ${run.organization_id}
              and unit_id = ${run.unit_id}
              and status = 'open'
          `);
        else
          await tx.execute(sql`
            update public.doseclub_reconciliation_findings
            set status = 'resolved', resolved_at = ${observedAtIso}::timestamptz,
                version = version + 1, updated_at = ${observedAtIso}::timestamptz
            where organization_id = ${run.organization_id}
              and unit_id = ${run.unit_id}
              and status = 'open'
              and not (fingerprint = any(${fingerprints}::varchar[]))
          `);

        const completed = await tx.execute<{ id: string }>(sql`
          update public.doseclub_reconciliation_runs
          set status = 'completed', finding_count = ${candidates.length},
              lease_owner = null, lease_until = null, completed_at = ${observedAtIso}::timestamptz,
              version = version + 1, updated_at = ${observedAtIso}::timestamptz
          where id = ${run.id}
            and organization_id = ${run.organization_id}
            and unit_id = ${run.unit_id}
            and status = 'running'
            and lease_owner = ${run.lease_owner}
          returning id
        `);
        if (!completed[0]) throw new Error("DOSECLUB_RECONCILIATION_LEASE_LOST");
      });
    } catch (error) {
      const failureCode =
        error instanceof Error && error.message === "DOSECLUB_RECONCILIATION_LEASE_LOST"
          ? "LEASE_LOST"
          : "SCAN_FAILED";
      await withWorkerContext(this.connection, async (tx) => {
        const failedAtIso = this.now().toISOString();
        await tx.execute(sql`
          update public.doseclub_reconciliation_runs
          set status = 'failed', failure_code = ${failureCode},
              lease_owner = null, lease_until = null, completed_at = ${failedAtIso}::timestamptz,
              version = version + 1, updated_at = ${failedAtIso}::timestamptz
          where id = ${run.id}
            and status = 'running'
            and lease_owner = ${run.lease_owner}
        `);
      });
    }
  }
}
