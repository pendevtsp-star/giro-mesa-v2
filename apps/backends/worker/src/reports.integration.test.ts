import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import {
  createDatabase,
  identities,
  managementReportExports,
  managementReportSchedules,
  memberships,
  organizations,
  posTabs,
  roleBindings,
  units,
} from "@giromesa/db";
import { and, eq } from "drizzle-orm";
import { EmailDeliveryError } from "./email.js";
import { OutboxWorker } from "./outbox.js";
import { processDueReportSchedules, reportContentSha256 } from "./reports.js";

test("claims each scheduled execution once and gates email by current permission", async (context) => {
  const databaseUrl = process.env.WORKER_DATABASE_URL;
  if (!databaseUrl) {
    context.skip("WORKER_DATABASE_URL not configured");
    return;
  }

  const previousEnvironment = { ...process.env };
  const previousFetch = globalThis.fetch;
  process.env.DATABASE_URL = databaseUrl;
  const database = createDatabase(databaseUrl);
  let worker: OutboxWorker | undefined;
  let organizationId: string | undefined;
  let ownerIdentityId: string | undefined;
  let cashierIdentityId: string | undefined;
  try {
    const [owner, cashier] = await database.db
      .insert(identities)
      .values([
        {
          displayName: "Reports Owner",
          email: `reports-owner-${randomUUID()}@example.test`,
        },
        {
          displayName: "Reports Cashier",
          email: `reports-cashier-${randomUUID()}@example.test`,
        },
      ])
      .returning();
    assert.ok(owner && cashier);
    ownerIdentityId = owner.id;
    cashierIdentityId = cashier.id;
    const [organization] = await database.db
      .insert(organizations)
      .values({
        legalName: "Reports Integration Ltda",
        tradeName: "Reports Integration",
        document: String(Math.floor(Math.random() * 10 ** 14)).padStart(14, "0"),
      })
      .returning();
    assert.ok(organization);
    organizationId = organization.id;
    const [unit] = await database.db
      .insert(units)
      .values({
        organizationId: organization.id,
        name: "Reports Unit",
        timezone: "America/Sao_Paulo",
      })
      .returning();
    assert.ok(unit);
    const [ownerMembership, cashierMembership] = await database.db
      .insert(memberships)
      .values([
        { identityId: owner.id, organizationId: organization.id, status: "active" },
        { identityId: cashier.id, organizationId: organization.id, status: "active" },
      ])
      .returning();
    assert.ok(ownerMembership && cashierMembership);
    await database.db.insert(roleBindings).values([
      { membershipId: ownerMembership.id, unitId: unit.id, role: "finance" },
      { membershipId: cashierMembership.id, unitId: unit.id, role: "cashier" },
    ]);

    const scheduledFor = new Date("2026-08-17T12:30:00.000Z");
    const [inAppSchedule, emailSchedule] = await database.db
      .insert(managementReportSchedules)
      .values([
        {
          organizationId: organization.id,
          unitId: unit.id,
          name: "Weekly in-app",
          frequency: "weekly",
          weekday: 1,
          localTime: "09:30:00",
          range: "previous_week",
          comparisonMode: "previous_period",
          delivery: "in_app",
          nextRunAt: scheduledFor,
          createdByIdentityId: owner.id,
          updatedByIdentityId: owner.id,
        },
        {
          organizationId: organization.id,
          unitId: unit.id,
          name: "Weekly email",
          frequency: "weekly",
          weekday: 1,
          localTime: "09:30:00",
          range: "previous_week",
          comparisonMode: "previous_period",
          delivery: "email",
          recipientIdentityId: cashier.id,
          nextRunAt: scheduledFor,
          createdByIdentityId: owner.id,
          updatedByIdentityId: owner.id,
        },
      ])
      .returning();
    assert.ok(inAppSchedule && emailSchedule);
    await database.db.insert(posTabs).values({
      organizationId: organization.id,
      unitId: unit.id,
      openedByIdentityId: owner.id,
      displayNumber: 1,
      fulfillmentType: "dine_in",
      status: "closed",
      subtotalCents: 10_000,
      discountCents: 500,
      serviceChargeCents: 1_000,
      totalCents: 10_500,
      closedAt: new Date("2026-08-12T15:00:00.000Z"),
    });

    const now = new Date("2026-08-17T12:31:00.000Z");
    const claims = await Promise.all([
      processDueReportSchedules(database.db, { now, limit: 10 }),
      processDueReportSchedules(database.db, { now, limit: 10 }),
    ]);
    assert.equal(
      claims.reduce((sum, value) => sum + value, 0),
      2,
    );
    const exports = await database.db
      .select()
      .from(managementReportExports)
      .where(eq(managementReportExports.organizationId, organization.id));
    assert.equal(exports.length, 2);
    const inAppExport = exports.find((entry) => entry.scheduleId === inAppSchedule.id);
    const emailExport = exports.find((entry) => entry.scheduleId === emailSchedule.id);
    assert.ok(inAppExport?.content && emailExport?.content);
    assert.ok(inAppExport.rowCount > 1);
    assert.match(inAppExport.content, /fluxo_caixa/);
    assert.match(inAppExport.content, /dre/);
    assert.match(inAppExport.content, /detalhamento_channels/);
    assert.equal(inAppExport.sha256, reportContentSha256(inAppExport.content));

    worker = new OutboxWorker();
    await assert.rejects(
      worker.deliverReportExportEmail({
        id: randomUUID(),
        topic: "management.report_export_email_requested",
        aggregate_type: "management_report_export",
        aggregate_id: emailExport.id,
        payload: {
          organizationId: organization.id,
          unitId: unit.id,
          exportId: emailExport.id,
          recipientIdentityId: cashier.id,
        },
        attempts: 1,
      }),
      (error: unknown) =>
        error instanceof EmailDeliveryError &&
        error.code === "REPORT_RECIPIENT_NOT_AUTHORIZED" &&
        !error.retryable,
    );

    await database.db
      .update(roleBindings)
      .set({ role: "finance" })
      .where(eq(roleBindings.membershipId, cashierMembership.id));
    process.env.EMAIL_PROVIDER_ENABLED = "false";
    await assert.rejects(
      worker.deliverReportExportEmail({
        id: randomUUID(),
        topic: "management.report_export_email_requested",
        aggregate_type: "management_report_export",
        aggregate_id: emailExport.id,
        payload: {
          organizationId: organization.id,
          unitId: unit.id,
          exportId: emailExport.id,
          recipientIdentityId: cashier.id,
        },
        attempts: 1,
      }),
      (error: unknown) =>
        error instanceof EmailDeliveryError &&
        error.code === "EMAIL_PROVIDER_DISABLED" &&
        error.retryable,
    );

    process.env.EMAIL_PROVIDER_ENABLED = "true";
    process.env.EMAIL_PROVIDER_CREDENTIAL_REFERENCE = "resend";
    process.env.RESEND_API_KEY = "re_reports_integration_key";
    process.env.RESEND_FROM = "GiroMesa <reports@example.test>";
    process.env.APP_URL = "https://app.example.test";
    process.env.API_URL = "https://api.example.test";
    let emailRequest: RequestInit | undefined;
    globalThis.fetch = async (_input, init) => {
      emailRequest = init;
      return new Response(JSON.stringify({ id: "report-email-provider-id" }), { status: 200 });
    };
    await worker.deliverReportExportEmail({
      id: randomUUID(),
      topic: "management.report_export_email_requested",
      aggregate_type: "management_report_export",
      aggregate_id: emailExport.id,
      payload: {
        organizationId: organization.id,
        unitId: unit.id,
        exportId: emailExport.id,
        recipientIdentityId: cashier.id,
      },
      attempts: 2,
    });
    assert.equal(
      (emailRequest?.headers as Record<string, string>)["Idempotency-Key"],
      `report-export/${emailExport.id}`,
    );
    assert.match(
      String(emailRequest?.body),
      new RegExp(
        `https://api\\.example\\.test/v1/organizations/${organization.id}/units/${unit.id}/management/reports/exports/${emailExport.id}/content`,
      ),
    );

    const schedules = await database.db
      .select()
      .from(managementReportSchedules)
      .where(
        and(
          eq(managementReportSchedules.organizationId, organization.id),
          eq(managementReportSchedules.unitId, unit.id),
        ),
      );
    assert.equal(
      schedules.every((schedule) => schedule.lastRunAt?.getTime() === scheduledFor.getTime()),
      true,
    );
    assert.equal(
      schedules.every((schedule) => schedule.nextRunAt > scheduledFor),
      true,
    );
  } finally {
    if (worker) await worker.close();
    if (organizationId) {
      await database.db.delete(posTabs).where(eq(posTabs.organizationId, organizationId));
      await database.db.delete(organizations).where(eq(organizations.id, organizationId));
    }
    if (cashierIdentityId) {
      await database.db.delete(identities).where(eq(identities.id, cashierIdentityId));
    }
    if (ownerIdentityId) {
      await database.db.delete(identities).where(eq(identities.id, ownerIdentityId));
    }
    await database.client.end();
    globalThis.fetch = previousFetch;
    for (const name of Object.keys(process.env)) {
      if (!(name in previousEnvironment)) delete process.env[name];
    }
    Object.assign(process.env, previousEnvironment);
  }
});
