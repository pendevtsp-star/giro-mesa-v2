import assert from "node:assert/strict";
import { randomInt, randomUUID } from "node:crypto";
import { it } from "node:test";
import {
  identities,
  managementIncidentEvents,
  managementIncidents,
  memberships,
  organizations,
  roleBindings,
  units,
} from "@giromesa/db";
import { eq } from "drizzle-orm";
import { DatabaseService } from "../database/database.module.js";
import { ScopeService } from "../organizations/scope.service.js";
import { IncidentsService } from "./incidents.service.js";

it("keeps neutral evidence, dual approval and an append-only trail without payroll action", async (context) => {
  const databaseUrl = process.env.INCIDENTS_DATABASE_URL;
  if (!databaseUrl) {
    context.skip("INCIDENTS_DATABASE_URL not configured");
    return;
  }
  process.env.DATABASE_URL = databaseUrl;
  const database = new DatabaseService();
  try {
    const [organization] = await database.db
      .insert(organizations)
      .values({
        legalName: "Incidents Test Ltda",
        tradeName: "Incidents Test",
        document: String(randomInt(10_000_000_000_000, 99_999_999_999_999)),
      })
      .returning();
    assert.ok(organization);
    const [unit] = await database.db
      .insert(units)
      .values({ organizationId: organization.id, name: "Incidents Unit" })
      .returning();
    const [reporter, approver] = await database.db
      .insert(identities)
      .values([
        { email: `incident-reporter-${randomUUID()}@example.test`, displayName: "Reporter" },
        { email: `incident-approver-${randomUUID()}@example.test`, displayName: "Approver" },
      ])
      .returning();
    assert.ok(unit && reporter && approver);
    const membershipsInserted = await database.db
      .insert(memberships)
      .values([
        { identityId: reporter.id, organizationId: organization.id, status: "active" },
        { identityId: approver.id, organizationId: organization.id, status: "active" },
      ])
      .returning();
    assert.equal(membershipsInserted.length, 2);
    await database.db.insert(roleBindings).values(
      membershipsInserted.map((membership) => ({
        membershipId: membership.id,
        role: "owner" as const,
      })),
    );

    const service = new IncidentsService(database, new ScopeService(database));
    const incident = await service.report(
      reporter.id,
      organization.id,
      unit.id,
      "incident-report-0001",
      {
        incidentType: "inventory_variance",
        neutralSummary: "Contagem física divergiu do saldo registrado no fechamento.",
        evidence: [
          { kind: "document", reference: "count-sheet-2026-08-11", checksum: "sha256:abc" },
        ],
        amountCents: 5_000,
        occurredAt: "2026-08-11T20:00:00.000Z",
      },
    );
    assert.equal(incident.status, "reported");
    const appContext = {
      source: "http" as const,
      organizationId: organization.id,
      unitId: unit.id,
      actorIdentityId: reporter.id,
    };
    await assert.rejects(() =>
      database.withTenantContext(appContext, (tx) =>
        tx
          .update(managementIncidents)
          .set({
            neutralSummary: "Resumo adulterado sem evento.",
            evidence: [],
            amountCents: 0,
          })
          .where(eq(managementIncidents.id, incident.incidentId)),
      ),
    );
    await assert.rejects(() =>
      database.withTenantContext(appContext, (tx) =>
        tx
          .update(managementIncidents)
          .set({ status: "under_review" })
          .where(eq(managementIncidents.id, incident.incidentId)),
      ),
    );
    await service.review(
      reporter.id,
      organization.id,
      unit.id,
      incident.incidentId,
      "incident-review-0001",
      "Evidências encaminhadas para revisão independente.",
    );
    await assert.rejects(() =>
      service.decide(
        reporter.id,
        organization.id,
        unit.id,
        incident.incidentId,
        "incident-decision-self",
        "approved",
        "Aprovação pelo próprio relator não deve ser aceita.",
      ),
    );
    const approved = await service.decide(
      approver.id,
      organization.id,
      unit.id,
      incident.incidentId,
      "incident-decision-0001",
      "approved",
      "Revisão concluída com base nas evidências registradas.",
    );
    assert.equal(approved.status, "approved");
    const report = await service.reportView(
      approver.id,
      organization.id,
      unit.id,
      incident.incidentId,
    );
    assert.equal(report.payrollAction, false);
    assert.deepEqual(
      report.events.map((event) => event.toStatus),
      ["reported", "under_review", "approved"],
    );
    await assert.rejects(() =>
      database.db
        .update(managementIncidentEvents)
        .set({ neutralNote: "Tentativa de mutação" })
        .where(eq(managementIncidentEvents.incidentId, incident.incidentId)),
    );
    await assert.rejects(() =>
      database.db
        .update(managementIncidents)
        .set({ payrollAction: true })
        .where(eq(managementIncidents.id, incident.incidentId)),
    );
  } finally {
    await database.onModuleDestroy();
  }
});
