import {
  remunerationCalculationEntries,
  remunerationCalculationRuns,
  remunerationRuleSets,
  remunerationRuleVersions,
} from "@giromesa/db";
import {
  freezeRemunerationCalculation,
  type RemunerationExpression,
  type RemunerationMetrics,
  type RemunerationRuleKind,
  type RemunerationRuleVersion,
  simulateRemunerationRule,
} from "@giromesa/domain";
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { and, asc, eq, gte, lte, sql } from "drizzle-orm";
import { DatabaseService } from "../database/database.module.js";
import { ScopeService } from "../organizations/scope.service.js";
import { managementRequestHash } from "./management.rules.js";
import { remunerationExpressionSchema } from "./remuneration.schemas.js";

const REMUNERATION_ROLES = ["owner", "manager", "finance"] as const;

function key(value: string) {
  const normalized = value.trim();
  if (normalized.length < 8 || normalized.length > 160)
    throw new BadRequestException({
      code: "INVALID_IDEMPOTENCY_KEY",
      message: "Idempotency-Key deve ter entre 8 e 160 caracteres.",
    });
  return normalized;
}

function dateOnly(value: string, field: string) {
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(value) ||
    Number.isNaN(new Date(`${value}T00:00:00.000Z`).valueOf())
  )
    throw new BadRequestException({
      code: "REMUNERATION_PERIOD_INVALID",
      message: `${field} inválido.`,
    });
  return value;
}

function ruleFromRows(
  set: typeof remunerationRuleSets.$inferSelect,
  version: typeof remunerationRuleVersions.$inferSelect,
): RemunerationRuleVersion {
  return {
    ruleSetId: set.id,
    version: version.version,
    kind: set.kind,
    effectiveFrom: version.effectiveFrom.toISOString(),
    effectiveUntil: version.effectiveUntil?.toISOString() ?? null,
    expression: version.expression as unknown as RemunerationExpression,
  };
}

function escapeCsv(value: string | number | null) {
  const raw = value === null ? "" : String(value);
  const text = /^[\t ]*[=+\-@]/.test(raw) ? `'${raw}` : raw;
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function pdfBuffer(lines: string[]) {
  const safe = lines
    .map((line) =>
      line
        .normalize("NFD")
        .replaceAll(/[\u0300-\u036f]/g, "")
        .replaceAll(/[()\\]/g, " "),
    )
    .slice(0, 45);
  const content = safe
    .map((line, index) => `BT /F1 10 Tf 50 ${790 - index * 16} Td (${line}) Tj ET`)
    .join("\n");
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>",
    `<< /Length ${Buffer.byteLength(content)} >>\nstream\n${content}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  let document = "%PDF-1.4\n";
  const offsets = [0];
  objects.forEach((object, index) => {
    offsets.push(Buffer.byteLength(document));
    document += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xref = Buffer.byteLength(document);
  document += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  document += offsets
    .slice(1)
    .map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`)
    .join("");
  document += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(document, "ascii");
}

function safeSimulation(rule: RemunerationRuleVersion, metrics: RemunerationMetrics) {
  try {
    return simulateRemunerationRule(rule, metrics);
  } catch (error) {
    throw new BadRequestException({
      code: "REMUNERATION_RULE_INVALID",
      message: error instanceof Error ? error.message : "Regra de remuneração inválida.",
    });
  }
}

const ZERO_METRICS: RemunerationMetrics = {
  grossSalesCents: 0,
  netSalesCents: 0,
  serviceChargeCents: 0,
  eligibleSalesCents: 0,
  profitCents: 0,
  hoursMinutes: 0,
  unitsSold: 0,
};

function validatedExpression(value: unknown) {
  const parsed = remunerationExpressionSchema.safeParse(value);
  if (!parsed.success)
    throw new BadRequestException({
      code: "REMUNERATION_RULE_INVALID",
      message: "A expressão deve usar apenas a DSL de remuneração suportada.",
    });
  return parsed.data;
}

@Injectable()
export class RemunerationService {
  constructor(
    private readonly database: DatabaseService,
    private readonly scope: ScopeService,
  ) {}

  private async requireRole(identityId: string, organizationId: string, unitId: string) {
    await this.scope.requireUnitAccess(identityId, organizationId, unitId);
    const roles = await this.scope.requireOrganizationRole(
      identityId,
      organizationId,
      REMUNERATION_ROLES,
    );
    if (
      !roles.some(
        (role) =>
          REMUNERATION_ROLES.includes(role.role as (typeof REMUNERATION_ROLES)[number]) &&
          (role.unitId === null || role.unitId === unitId),
      )
    )
      throw new ForbiddenException({
        code: "REMUNERATION_ROLE_DENIED",
        message: "Apuração de remuneração não autorizada nesta unidade.",
      });
  }

  async createRule(
    identityId: string,
    organizationId: string,
    unitId: string,
    keyValue: string,
    input: {
      kind: RemunerationRuleKind;
      name: string;
      expression: RemunerationExpression;
      effectiveFrom: string;
    },
  ) {
    await this.requireRole(identityId, organizationId, unitId);
    const expression = validatedExpression(input.expression);
    const idempotencyKey = key(keyValue);
    const effectiveFrom = new Date(input.effectiveFrom);
    if (
      input.name.trim().length < 3 ||
      input.name.length > 160 ||
      Number.isNaN(effectiveFrom.valueOf())
    )
      throw new BadRequestException({
        code: "REMUNERATION_RULE_INVALID",
        message: "Regra inválida.",
      });
    const requestHash = managementRequestHash("remuneration-rule", input);
    return this.database.db.transaction(async (tx) => {
      await tx.execute(
        sql`select pg_advisory_xact_lock(hashtext(${`remuneration-rule:${organizationId}:${unitId}:${idempotencyKey}`}))`,
      );
      const [existing] = await tx
        .select()
        .from(remunerationRuleSets)
        .where(
          and(
            eq(remunerationRuleSets.organizationId, organizationId),
            eq(remunerationRuleSets.unitId, unitId),
            eq(remunerationRuleSets.idempotencyKey, idempotencyKey),
          ),
        )
        .limit(1);
      if (existing) {
        if (existing.requestHash !== requestHash)
          throw new ConflictException({ code: "IDEMPOTENCY_PAYLOAD_MISMATCH" });
        const [version] = await tx
          .select()
          .from(remunerationRuleVersions)
          .where(eq(remunerationRuleVersions.ruleSetId, existing.id))
          .limit(1);
        if (!version) throw new Error("Rule set has no version.");
        return {
          ruleSetId: existing.id,
          ruleVersionId: version.id,
          version: version.version,
          idempotentReplay: true,
        };
      }
      const candidate: RemunerationRuleVersion = {
        ruleSetId: "validation",
        version: 1,
        kind: input.kind,
        effectiveFrom: effectiveFrom.toISOString(),
        effectiveUntil: null,
        expression,
      };
      safeSimulation(candidate, ZERO_METRICS);
      const [set] = await tx
        .insert(remunerationRuleSets)
        .values({
          organizationId,
          unitId,
          kind: input.kind,
          name: input.name.trim(),
          idempotencyKey,
          requestHash,
          createdByIdentityId: identityId,
        })
        .returning();
      if (!set) throw new Error("Rule set insert returned no row.");
      const [version] = await tx
        .insert(remunerationRuleVersions)
        .values({
          organizationId,
          unitId,
          ruleSetId: set.id,
          version: 1,
          expression: expression as unknown as Record<string, unknown>,
          effectiveFrom,
          createdByIdentityId: identityId,
        })
        .returning();
      if (!version) throw new Error("Rule version insert returned no row.");
      return { ruleSetId: set.id, ruleVersionId: version.id, version: 1, idempotentReplay: false };
    });
  }

  async publishVersion(
    identityId: string,
    organizationId: string,
    unitId: string,
    ruleSetId: string,
    expression: RemunerationExpression,
    effectiveFromValue: string,
  ) {
    await this.requireRole(identityId, organizationId, unitId);
    const parsedExpression = validatedExpression(expression);
    const effectiveFrom = new Date(effectiveFromValue);
    if (Number.isNaN(effectiveFrom.valueOf()))
      throw new BadRequestException({ code: "REMUNERATION_RULE_INVALID" });
    return this.database.db.transaction(async (tx) => {
      await tx.execute(
        sql`select pg_advisory_xact_lock(hashtext(${`remuneration-rule-set:${ruleSetId}`}))`,
      );
      const [set] = await tx
        .select()
        .from(remunerationRuleSets)
        .where(
          and(
            eq(remunerationRuleSets.organizationId, organizationId),
            eq(remunerationRuleSets.unitId, unitId),
            eq(remunerationRuleSets.id, ruleSetId),
          ),
        )
        .limit(1);
      if (!set) throw new NotFoundException({ code: "REMUNERATION_RULE_SET_NOT_FOUND" });
      const versions = await tx
        .select()
        .from(remunerationRuleVersions)
        .where(eq(remunerationRuleVersions.ruleSetId, set.id))
        .orderBy(asc(remunerationRuleVersions.version));
      const current = versions.at(-1);
      if (!current || current.effectiveFrom >= effectiveFrom)
        throw new ConflictException({ code: "REMUNERATION_RULE_EFFECTIVE_ORDER_INVALID" });
      safeSimulation(
        {
          ruleSetId: set.id,
          version: current.version + 1,
          kind: set.kind,
          effectiveFrom: effectiveFrom.toISOString(),
          effectiveUntil: null,
          expression: parsedExpression,
        },
        ZERO_METRICS,
      );
      await tx
        .update(remunerationRuleVersions)
        .set({ effectiveUntil: effectiveFrom })
        .where(eq(remunerationRuleVersions.id, current.id));
      const [created] = await tx
        .insert(remunerationRuleVersions)
        .values({
          organizationId,
          unitId,
          ruleSetId: set.id,
          version: current.version + 1,
          expression: parsedExpression as unknown as Record<string, unknown>,
          effectiveFrom,
          createdByIdentityId: identityId,
        })
        .returning();
      if (!created) throw new Error("Rule version insert returned no row.");
      return { ruleSetId: set.id, ruleVersionId: created.id, version: created.version };
    });
  }

  async simulate(
    identityId: string,
    organizationId: string,
    unitId: string,
    ruleVersionId: string,
    metrics: RemunerationMetrics,
  ) {
    await this.requireRole(identityId, organizationId, unitId);
    const rule = await this.rule(organizationId, unitId, ruleVersionId);
    return safeSimulation(rule, metrics);
  }

  async calculate(
    identityId: string,
    organizationId: string,
    unitId: string,
    keyValue: string,
    input: {
      kind: RemunerationRuleKind;
      periodStart: string;
      periodEnd: string;
      ruleVersionId: string;
      metrics: RemunerationMetrics;
      sourceReferences: string[];
      recipients: { reference: string; label: string; basisPoints: number }[];
    },
  ) {
    await this.requireRole(identityId, organizationId, unitId);
    const idempotencyKey = key(keyValue);
    const periodStart = dateOnly(input.periodStart, "periodStart");
    const periodEnd = dateOnly(input.periodEnd, "periodEnd");
    if (periodEnd < periodStart)
      throw new BadRequestException({ code: "REMUNERATION_PERIOD_INVALID" });
    if (
      input.sourceReferences.length === 0 ||
      input.recipients.length === 0 ||
      new Set(input.recipients.map((recipient) => recipient.reference)).size !==
        input.recipients.length ||
      input.recipients.some(
        (recipient) =>
          recipient.reference.trim().length === 0 ||
          recipient.label.trim().length === 0 ||
          !Number.isSafeInteger(recipient.basisPoints) ||
          recipient.basisPoints < 0,
      ) ||
      input.recipients.reduce((sum, recipient) => sum + recipient.basisPoints, 0) !== 10_000
    )
      throw new BadRequestException({
        code: "REMUNERATION_ALLOCATION_INVALID",
        message: "Beneficiários devem ser únicos e totalizar 10000 pontos-base.",
      });
    const requestHash = managementRequestHash("remuneration-run", input);
    return this.database.db.transaction(async (tx) => {
      await tx.execute(
        sql`select pg_advisory_xact_lock(hashtext(${`remuneration-run:${organizationId}:${unitId}:${idempotencyKey}`}))`,
      );
      const [existing] = await tx
        .select()
        .from(remunerationCalculationRuns)
        .where(
          and(
            eq(remunerationCalculationRuns.organizationId, organizationId),
            eq(remunerationCalculationRuns.unitId, unitId),
            eq(remunerationCalculationRuns.idempotencyKey, idempotencyKey),
          ),
        )
        .limit(1);
      if (existing) {
        if (existing.requestHash !== requestHash)
          throw new ConflictException({ code: "IDEMPOTENCY_PAYLOAD_MISMATCH" });
        return this.runDto(existing, true);
      }
      const [version] = await tx
        .select()
        .from(remunerationRuleVersions)
        .where(
          and(
            eq(remunerationRuleVersions.organizationId, organizationId),
            eq(remunerationRuleVersions.unitId, unitId),
            eq(remunerationRuleVersions.id, input.ruleVersionId),
          ),
        )
        .limit(1);
      if (!version) throw new NotFoundException({ code: "REMUNERATION_RULE_NOT_FOUND" });
      const [set] = await tx
        .select()
        .from(remunerationRuleSets)
        .where(eq(remunerationRuleSets.id, version.ruleSetId))
        .limit(1);
      if (!set || set.kind !== input.kind)
        throw new ConflictException({ code: "REMUNERATION_ENGINE_KIND_MISMATCH" });
      const periodEndInstant = new Date(`${periodEnd}T23:59:59.999Z`);
      if (
        version.effectiveFrom > periodEndInstant ||
        (version.effectiveUntil !== null && version.effectiveUntil <= periodEndInstant)
      )
        throw new ConflictException({ code: "REMUNERATION_RULE_NOT_EFFECTIVE" });
      const rule = ruleFromRows(set, version);
      const simulation = safeSimulation(rule, input.metrics);
      const memory = freezeRemunerationCalculation(
        rule,
        input.metrics,
        input.sourceReferences,
        new Date().toISOString(),
      );
      const [run] = await tx
        .insert(remunerationCalculationRuns)
        .values({
          organizationId,
          unitId,
          kind: input.kind,
          periodStart,
          periodEnd,
          ruleVersionId: version.id,
          frozenRule: memory.rule as unknown as Record<string, unknown>,
          frozenMetrics: memory.metrics,
          sourceReferences: memory.sourceReferences,
          evaluationTrace: simulation.trace as unknown as Record<string, unknown>[],
          outputCents: memory.outputCents,
          memoryHash: memory.memoryHash,
          idempotencyKey,
          requestHash,
          createdByIdentityId: identityId,
        })
        .returning();
      if (!run) throw new Error("Remuneration run insert returned no row.");
      const base = input.recipients.map((recipient) => ({
        ...recipient,
        amountCents: Number((BigInt(run.outputCents) * BigInt(recipient.basisPoints)) / 10_000n),
      }));
      let remainder =
        run.outputCents - base.reduce((sum, recipient) => sum + recipient.amountCents, 0);
      for (const recipient of base) {
        if (remainder <= 0) break;
        recipient.amountCents += 1;
        remainder -= 1;
      }
      await tx.insert(remunerationCalculationEntries).values(
        base.map((recipient) => ({
          organizationId,
          unitId,
          runId: run.id,
          recipientReference: recipient.reference.trim(),
          recipientLabel: recipient.label.trim(),
          amountCents: recipient.amountCents,
        })),
      );
      return this.runDto(run, false);
    });
  }

  async approve(identityId: string, organizationId: string, unitId: string, runId: string) {
    await this.requireRole(identityId, organizationId, unitId);
    return this.database.db.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`remuneration-run:${runId}`}))`);
      const [run] = await tx
        .select()
        .from(remunerationCalculationRuns)
        .where(
          and(
            eq(remunerationCalculationRuns.organizationId, organizationId),
            eq(remunerationCalculationRuns.unitId, unitId),
            eq(remunerationCalculationRuns.id, runId),
          ),
        )
        .limit(1);
      if (!run) throw new NotFoundException({ code: "REMUNERATION_RUN_NOT_FOUND" });
      if (run.status !== "estimated")
        throw new ConflictException({ code: "REMUNERATION_RUN_NOT_ESTIMATED" });
      if (run.createdByIdentityId === identityId)
        throw new ConflictException({ code: "REMUNERATION_INDEPENDENT_APPROVAL_REQUIRED" });
      const [updated] = await tx
        .update(remunerationCalculationRuns)
        .set({
          status: "approved",
          approvedByIdentityId: identityId,
          approvedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(remunerationCalculationRuns.id, run.id))
        .returning();
      if (!updated) throw new Error("Remuneration approval returned no row.");
      return this.runDto(updated, false);
    });
  }

  async close(identityId: string, organizationId: string, unitId: string, runId: string) {
    await this.requireRole(identityId, organizationId, unitId);
    const [run] = await this.database.db
      .select()
      .from(remunerationCalculationRuns)
      .where(
        and(
          eq(remunerationCalculationRuns.organizationId, organizationId),
          eq(remunerationCalculationRuns.unitId, unitId),
          eq(remunerationCalculationRuns.id, runId),
        ),
      )
      .limit(1);
    if (!run) throw new NotFoundException({ code: "REMUNERATION_RUN_NOT_FOUND" });
    if (run.status !== "approved")
      throw new ConflictException({ code: "REMUNERATION_RUN_NOT_APPROVED" });
    if (run.periodEnd >= new Date().toISOString().slice(0, 10))
      throw new ConflictException({
        code: "REMUNERATION_PERIOD_STILL_OPEN",
        message: "O fechamento exige período financeiro já encerrado.",
      });
    const [updated] = await this.database.db
      .update(remunerationCalculationRuns)
      .set({
        status: "closed",
        closedByIdentityId: identityId,
        closedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(remunerationCalculationRuns.id, run.id))
      .returning();
    if (!updated) throw new Error("Remuneration close returned no row.");
    return this.runDto(updated, false);
  }

  async adjustClosed(
    identityId: string,
    organizationId: string,
    unitId: string,
    parentRunId: string,
    keyValue: string,
    input: {
      amountCents: number;
      reason: string;
      sourceReferences: string[];
      recipient: { reference: string; label: string };
    },
  ) {
    await this.requireRole(identityId, organizationId, unitId);
    const idempotencyKey = key(keyValue);
    if (
      !Number.isSafeInteger(input.amountCents) ||
      input.amountCents <= 0 ||
      input.reason.trim().length < 15 ||
      input.reason.length > 500 ||
      input.sourceReferences.length === 0 ||
      input.recipient.reference.trim().length === 0 ||
      input.recipient.label.trim().length === 0
    )
      throw new BadRequestException({
        code: "REMUNERATION_ADJUSTMENT_INVALID",
        message: "Ajuste exige valor positivo em centavos, justificativa, origem e beneficiário.",
      });
    const requestHash = managementRequestHash("remuneration-adjustment", { parentRunId, ...input });
    return this.database.db.transaction(async (tx) => {
      await tx.execute(
        sql`select pg_advisory_xact_lock(hashtext(${`remuneration-adjustment:${organizationId}:${unitId}:${idempotencyKey}`}))`,
      );
      const [existing] = await tx
        .select()
        .from(remunerationCalculationRuns)
        .where(
          and(
            eq(remunerationCalculationRuns.organizationId, organizationId),
            eq(remunerationCalculationRuns.unitId, unitId),
            eq(remunerationCalculationRuns.idempotencyKey, idempotencyKey),
          ),
        )
        .limit(1);
      if (existing) {
        if (existing.requestHash !== requestHash)
          throw new ConflictException({ code: "IDEMPOTENCY_PAYLOAD_MISMATCH" });
        return this.runDto(existing, true);
      }
      const [parent] = await tx
        .select()
        .from(remunerationCalculationRuns)
        .where(
          and(
            eq(remunerationCalculationRuns.organizationId, organizationId),
            eq(remunerationCalculationRuns.unitId, unitId),
            eq(remunerationCalculationRuns.id, parentRunId),
          ),
        )
        .limit(1);
      if (!parent) throw new NotFoundException({ code: "REMUNERATION_RUN_NOT_FOUND" });
      if (parent.status !== "closed")
        throw new ConflictException({ code: "REMUNERATION_ADJUSTMENT_REQUIRES_CLOSED_RUN" });
      const original = parent.frozenRule as unknown as RemunerationRuleVersion;
      const rule: RemunerationRuleVersion = {
        ruleSetId: original.ruleSetId,
        version: original.version,
        kind: parent.kind,
        effectiveFrom: original.effectiveFrom,
        effectiveUntil: original.effectiveUntil,
        expression: { type: "constant", value: input.amountCents },
      };
      const metrics: RemunerationMetrics = {
        grossSalesCents: 0,
        netSalesCents: 0,
        serviceChargeCents: 0,
        eligibleSalesCents: 0,
        profitCents: 0,
        hoursMinutes: 0,
        unitsSold: 0,
      };
      const memory = freezeRemunerationCalculation(
        rule,
        metrics,
        [`adjustment:${parent.id}`, ...input.sourceReferences],
        new Date().toISOString(),
      );
      const [adjustment] = await tx
        .insert(remunerationCalculationRuns)
        .values({
          organizationId,
          unitId,
          kind: parent.kind,
          periodStart: parent.periodStart,
          periodEnd: parent.periodEnd,
          ruleVersionId: parent.ruleVersionId,
          frozenRule: memory.rule as unknown as Record<string, unknown>,
          frozenMetrics: memory.metrics,
          sourceReferences: memory.sourceReferences,
          evaluationTrace: [{ type: "approved_adjustment", reason: input.reason.trim() }],
          outputCents: memory.outputCents,
          memoryHash: memory.memoryHash,
          idempotencyKey,
          requestHash,
          adjustmentOf: parent.id,
          createdByIdentityId: identityId,
        })
        .returning();
      if (!adjustment) throw new Error("Remuneration adjustment insert returned no row.");
      await tx.insert(remunerationCalculationEntries).values({
        organizationId,
        unitId,
        runId: adjustment.id,
        recipientReference: input.recipient.reference.trim(),
        recipientLabel: input.recipient.label.trim(),
        amountCents: input.amountCents,
      });
      return this.runDto(adjustment, false);
    });
  }

  async portfolio(
    identityId: string,
    organizationId: string,
    unitId: string,
    periodStartValue: string,
    periodEndValue: string,
  ) {
    await this.requireRole(identityId, organizationId, unitId);
    const periodStart = dateOnly(periodStartValue, "periodStart");
    const periodEnd = dateOnly(periodEndValue, "periodEnd");
    const runs = await this.database.db
      .select()
      .from(remunerationCalculationRuns)
      .where(
        and(
          eq(remunerationCalculationRuns.organizationId, organizationId),
          eq(remunerationCalculationRuns.unitId, unitId),
          gte(remunerationCalculationRuns.periodStart, periodStart),
          lte(remunerationCalculationRuns.periodEnd, periodEnd),
        ),
      );
    const byKind = Object.fromEntries(
      (["service", "commission", "profit_sharing"] as const).map((kind) => [
        kind,
        runs.filter((run) => run.kind === kind).map((run) => this.runDto(run, false)),
      ]),
    ) as Record<RemunerationRuleKind, ReturnType<RemunerationService["runDto"]>[]>;
    return {
      periodStart,
      periodEnd,
      byKind,
      disclaimer:
        "Valores estimados não constituem fechamento até aprovação e encerramento explícitos.",
    };
  }

  async exportRun(
    identityId: string,
    organizationId: string,
    unitId: string,
    runId: string,
    format: "csv" | "pdf" | "print",
  ) {
    await this.requireRole(identityId, organizationId, unitId);
    const [run] = await this.database.db
      .select()
      .from(remunerationCalculationRuns)
      .where(
        and(
          eq(remunerationCalculationRuns.organizationId, organizationId),
          eq(remunerationCalculationRuns.unitId, unitId),
          eq(remunerationCalculationRuns.id, runId),
        ),
      )
      .limit(1);
    if (!run) throw new NotFoundException({ code: "REMUNERATION_RUN_NOT_FOUND" });
    const entries = await this.database.db
      .select()
      .from(remunerationCalculationEntries)
      .where(eq(remunerationCalculationEntries.runId, run.id))
      .orderBy(asc(remunerationCalculationEntries.recipientLabel));
    if (format === "csv") {
      const rows = ["categoria,status,referencia,beneficiario,valor_centavos"];
      rows.push(
        ...entries.map((entry) =>
          [run.kind, run.status, entry.recipientReference, entry.recipientLabel, entry.amountCents]
            .map(escapeCsv)
            .join(","),
        ),
      );
      return {
        contentType: "text/csv; charset=utf-8",
        fileName: `remuneracao-${run.id}.csv`,
        body: `${rows.join("\r\n")}\r\n`,
      };
    }
    const statusLabel =
      run.status === "estimated" ? "ESTIMADO - NAO APROVADO" : run.status.toUpperCase();
    const lines = [
      "Relatorio de remuneracao GiroMesa",
      `Categoria: ${run.kind}`,
      `Status: ${statusLabel}`,
      `Periodo: ${run.periodStart} a ${run.periodEnd}`,
      ...entries.map((entry) => `${entry.recipientLabel}: ${entry.amountCents} centavos`),
      `Total: ${run.outputCents} centavos`,
      `Memoria: ${run.memoryHash}`,
    ];
    if (format === "pdf") {
      const body = pdfBuffer(lines);
      return {
        contentType: "application/pdf",
        fileName: `remuneracao-${run.id}.pdf`,
        bodyBase64: body.toString("base64"),
      };
    }
    const body = `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>Relatório de remuneração</title></head><body><h1>Relatório de remuneração</h1>${lines
      .slice(1)
      .map((line) => `<p>${escapeHtml(line)}</p>`)
      .join("")}</body></html>`;
    return { contentType: "text/html; charset=utf-8", fileName: null, body };
  }

  private async rule(organizationId: string, unitId: string, ruleVersionId: string) {
    const [version] = await this.database.db
      .select()
      .from(remunerationRuleVersions)
      .where(
        and(
          eq(remunerationRuleVersions.organizationId, organizationId),
          eq(remunerationRuleVersions.unitId, unitId),
          eq(remunerationRuleVersions.id, ruleVersionId),
        ),
      )
      .limit(1);
    if (!version) throw new NotFoundException({ code: "REMUNERATION_RULE_NOT_FOUND" });
    const [set] = await this.database.db
      .select()
      .from(remunerationRuleSets)
      .where(eq(remunerationRuleSets.id, version.ruleSetId))
      .limit(1);
    if (!set) throw new NotFoundException({ code: "REMUNERATION_RULE_SET_NOT_FOUND" });
    return ruleFromRows(set, version);
  }

  private runDto(run: typeof remunerationCalculationRuns.$inferSelect, idempotentReplay: boolean) {
    return {
      runId: run.id,
      kind: run.kind,
      periodStart: run.periodStart,
      periodEnd: run.periodEnd,
      status: run.status,
      outputCents: run.outputCents,
      memoryHash: run.memoryHash,
      adjustmentOf: run.adjustmentOf,
      approvedAt: run.approvedAt,
      closedAt: run.closedAt,
      idempotentReplay,
      estimated: run.status === "estimated",
    };
  }
}
