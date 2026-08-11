import assert from "node:assert/strict";
import { randomInt, randomUUID } from "node:crypto";
import { it } from "node:test";
import {
  identities,
  memberships,
  organizations,
  remunerationCalculationRuns,
  roleBindings,
  units,
} from "@giromesa/db";
import { eq } from "drizzle-orm";
import { DatabaseService } from "../database/database.module.js";
import { ScopeService } from "../organizations/scope.service.js";
import { RemunerationService } from "./remuneration.service.js";

it("separates service, commission and profit sharing through estimated, approved and closed reports", async (context) => {
  const databaseUrl = process.env.REMUNERATION_DATABASE_URL;
  if (!databaseUrl) {
    context.skip("REMUNERATION_DATABASE_URL not configured");
    return;
  }
  process.env.DATABASE_URL = databaseUrl;
  const database = new DatabaseService();
  try {
    const [organization] = await database.db
      .insert(organizations)
      .values({
        legalName: "Remuneration Test Ltda",
        tradeName: "Remuneration Test",
        document: String(randomInt(10_000_000_000_000, 99_999_999_999_999)),
      })
      .returning();
    assert.ok(organization);
    const [unit] = await database.db
      .insert(units)
      .values({ organizationId: organization.id, name: "Remuneration Unit" })
      .returning();
    const [creator, approver] = await database.db
      .insert(identities)
      .values([
        { email: `remuneration-creator-${randomUUID()}@example.test`, displayName: "Creator" },
        { email: `remuneration-approver-${randomUUID()}@example.test`, displayName: "Approver" },
      ])
      .returning();
    assert.ok(unit && creator && approver);
    const insertedMemberships = await database.db
      .insert(memberships)
      .values([
        { identityId: creator.id, organizationId: organization.id, status: "active" },
        { identityId: approver.id, organizationId: organization.id, status: "active" },
      ])
      .returning();
    await database.db.insert(roleBindings).values(
      insertedMemberships.map((membership) => ({
        membershipId: membership.id,
        role: "owner" as const,
      })),
    );

    const service = new RemunerationService(database, new ScopeService(database));
    const zeroMetrics = {
      grossSalesCents: 0,
      netSalesCents: 0,
      serviceChargeCents: 0,
      eligibleSalesCents: 0,
      profitCents: 0,
      hoursMinutes: 0,
      unitsSold: 0,
    };
    const definitions = [
      { kind: "service" as const, metric: "serviceChargeCents" as const, basisPoints: 5_000 },
      { kind: "commission" as const, metric: "eligibleSalesCents" as const, basisPoints: 500 },
      { kind: "profit_sharing" as const, metric: "profitCents" as const, basisPoints: 1_000 },
    ];
    const runIds: string[] = [];
    for (const [index, definition] of definitions.entries()) {
      const rule = await service.createRule(
        creator.id,
        organization.id,
        unit.id,
        `remuneration-rule-${index + 1}`,
        {
          kind: definition.kind,
          name: `Regra ${definition.kind}`,
          expression: {
            type: "basis_points",
            operand: { type: "metric", metric: definition.metric },
            basisPoints: definition.basisPoints,
            rounding: "down",
          },
          effectiveFrom: "2026-01-01T00:00:00.000Z",
        },
      );
      const metrics = { ...zeroMetrics, [definition.metric]: 100_000 };
      const simulation = await service.simulate(
        creator.id,
        organization.id,
        unit.id,
        rule.ruleVersionId,
        metrics,
      );
      assert.ok(simulation.outputCents > 0);
      const run = await service.calculate(
        creator.id,
        organization.id,
        unit.id,
        `remuneration-run-${index + 1}`,
        {
          kind: definition.kind,
          periodStart: "2026-07-01",
          periodEnd: "2026-07-31",
          ruleVersionId: rule.ruleVersionId,
          metrics,
          sourceReferences: [`ledger:${definition.kind}:2026-07`],
          recipients: [
            { reference: "person-a", label: "Pessoa A", basisPoints: 6_000 },
            { reference: "person-b", label: "Pessoa B", basisPoints: 4_000 },
          ],
        },
      );
      assert.equal(run.status, "estimated");
      runIds.push(run.runId);
    }

    await assert.rejects(() =>
      service.approve(creator.id, organization.id, unit.id, runIds[0] as string),
    );
    const approved = await service.approve(
      approver.id,
      organization.id,
      unit.id,
      runIds[0] as string,
    );
    assert.equal(approved.status, "approved");
    const closed = await service.close(approver.id, organization.id, unit.id, runIds[0] as string);
    assert.equal(closed.status, "closed");
    const adjustment = await service.adjustClosed(
      approver.id,
      organization.id,
      unit.id,
      closed.runId,
      "remuneration-adjustment-0001",
      {
        amountCents: 250,
        reason: "Ajuste aprovado após o fechamento por documento complementar.",
        sourceReferences: ["document:complement-001"],
        recipient: { reference: "person-a", label: "Pessoa A" },
      },
    );
    assert.equal(adjustment.adjustmentOf, closed.runId);
    assert.equal(adjustment.status, "estimated");
    await assert.rejects(() =>
      database.db
        .update(remunerationCalculationRuns)
        .set({ outputCents: 1 })
        .where(eq(remunerationCalculationRuns.id, closed.runId)),
    );

    const portfolio = await service.portfolio(
      approver.id,
      organization.id,
      unit.id,
      "2026-07-01",
      "2026-07-31",
    );
    assert.deepEqual(Object.keys(portfolio.byKind).sort(), [
      "commission",
      "profit_sharing",
      "service",
    ]);
    const csv = await service.exportRun(approver.id, organization.id, unit.id, closed.runId, "csv");
    const pdf = await service.exportRun(approver.id, organization.id, unit.id, closed.runId, "pdf");
    const print = await service.exportRun(
      approver.id,
      organization.id,
      unit.id,
      closed.runId,
      "print",
    );
    assert.ok("body" in csv && typeof csv.body === "string");
    assert.ok("bodyBase64" in pdf && typeof pdf.bodyBase64 === "string");
    assert.ok("body" in print && typeof print.body === "string");
    assert.match(csv.body, /categoria,status,referencia,beneficiario,valor_centavos/);
    assert.ok(Buffer.from(pdf.bodyBase64, "base64").subarray(0, 5).equals(Buffer.from("%PDF-")));
    assert.match(print.body, /Relatório de remuneração/);
  } finally {
    await database.onModuleDestroy();
  }
});
