import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { it } from "node:test";
import {
  deviceEnrollments,
  hubCommands,
  hubHeartbeats,
  identities,
  memberships,
  organizations,
  posPrintJobs,
  posProductionPrinters,
  posTabEvents,
  posTabs,
  roleBindings,
  units,
} from "@giromesa/db";
import { and, eq } from "drizzle-orm";
import { DatabaseService } from "../database/database.module.js";
import { ScopeService } from "../organizations/scope.service.js";
import { PilotPosService } from "./pilot-pos.service.js";
import { ProductionPrintingService } from "./production-printing.service.js";

function errorCode(error: unknown) {
  return (error as { getResponse?: () => { code?: string } }).getResponse?.().code;
}

it("keeps one desired default per Edge Hub and ignores stale printer-test results", async (context) => {
  const databaseUrl = process.env.PILOT_DATABASE_URL;
  if (!databaseUrl) {
    context.skip("PILOT_DATABASE_URL not configured");
    return;
  }
  process.env.DATABASE_URL = databaseUrl;
  const database = new DatabaseService();
  let organizationId: string | null = null;
  let identityId: string | null = null;
  try {
    const runId = randomUUID();
    const document = runId.replaceAll("-", "").slice(0, 14);
    const [organization] = await database.db
      .insert(organizations)
      .values({
        legalName: "Production Printing Integration Ltda",
        tradeName: "Production Printing Integration",
        document,
        billingState: "active",
      })
      .returning();
    assert.ok(organization);
    organizationId = organization.id;
    const [unit] = await database.db
      .insert(units)
      .values({
        organizationId: organization.id,
        name: "Unidade impressão",
        timezone: "America/Sao_Paulo",
      })
      .returning();
    const [owner] = await database.db
      .insert(identities)
      .values({
        email: `production-printing+${runId}@example.test`,
        displayName: "Production Printing Owner",
      })
      .returning();
    assert.ok(unit && owner);
    identityId = owner.id;
    const [membership] = await database.db
      .insert(memberships)
      .values({ identityId: owner.id, organizationId: organization.id, status: "active" })
      .returning();
    assert.ok(membership);
    await database.db.insert(roleBindings).values({ membershipId: membership.id, role: "owner" });
    const [hubA, hubB] = await database.db
      .insert(deviceEnrollments)
      .values([
        { organizationId: organization.id, unitId: unit.id, label: "Edge A" },
        { organizationId: organization.id, unitId: unit.id, label: "Edge B" },
      ])
      .returning();
    assert.ok(hubA && hubB);

    const service = new ProductionPrintingService(database, new ScopeService(database));
    await database.db.insert(hubHeartbeats).values({
      organizationId: organization.id,
      unitId: unit.id,
      hubId: hubA.id,
      version: "integration-test",
      lastSeenAt: new Date(),
    });
    const probe = await service.probePrinterConnection(
      owner.id,
      organization.id,
      unit.id,
      `probe-a-${runId}`,
      { hubId: hubA.id, host: "192.168.10.10", port: 9100 },
    );
    assert.equal(probe.state, "pending");
    assert.equal(
      (
        await service.printerConnectionProbeStatus(
          owner.id,
          organization.id,
          unit.id,
          probe.commandId,
        )
      ).state,
      "pending",
    );
    await database.db.transaction((tx) =>
      service.applyCommandResult(
        tx,
        { id: hubA.id, organizationId: organization.id, unitId: unit.id },
        {
          commandId: probe.commandId,
          type: "printer.connection.probe",
          status: "reachable",
          errorCode: null,
        },
      ),
    );
    assert.equal(
      (
        await service.printerConnectionProbeStatus(
          owner.id,
          organization.id,
          unit.id,
          probe.commandId,
        )
      ).state,
      "reachable",
    );
    await assert.rejects(
      service.probePrinterConnection(owner.id, organization.id, unit.id, `probe-b-${runId}`, {
        hubId: hubB.id,
        host: "192.168.20.10",
        port: 9100,
      }),
      (error: unknown) => errorCode(error) === "EDGE_HUB_OFFLINE",
    );
    const desired = (hubId: string, label: string, host: string) => ({
      hubId,
      label,
      host,
      port: 9100,
      paperWidthMm: 80 as const,
      charactersPerLine: 48,
      codeTable: 16,
      cut: true,
      supportsRasterGraphics: false,
      isDefault: false,
      documentTypes: ["kds_ticket" as const],
      fallbackPrinterId: null,
      active: true,
    });
    const inputA = desired(hubA.id, "A principal", "192.168.10.10");
    const inputB = desired(hubB.id, "B principal", "192.168.20.10");
    const inputASecondary = desired(hubA.id, "A reserva", "192.168.10.11");
    const createdA = await service.createPrinter(
      owner.id,
      organization.id,
      unit.id,
      `create-a-${runId}`,
      inputA,
    );
    const createdB = await service.createPrinter(
      owner.id,
      organization.id,
      unit.id,
      `create-b-${runId}`,
      inputB,
    );
    const createdASecondary = await service.createPrinter(
      owner.id,
      organization.id,
      unit.id,
      `create-a-secondary-${runId}`,
      inputASecondary,
    );
    assert.equal((createdA.printer as { isDefault: boolean }).isDefault, true);
    assert.equal((createdB.printer as { isDefault: boolean }).isDefault, true);
    assert.equal((createdASecondary.printer as { isDefault: boolean }).isDefault, false);

    const printerA = createdA.printer as { id: string; revision: number };
    const printerB = createdB.printer as { id: string; revision: number };
    const secondary = createdASecondary.printer as { id: string; revision: number };
    const promoted = await service.updatePrinter(
      owner.id,
      organization.id,
      unit.id,
      secondary.id,
      `promote-secondary-${runId}`,
      { ...inputASecondary, isDefault: true, revision: secondary.revision },
    );
    const promotedPrinter = promoted.printer as { id: string; revision: number };
    const [demotedA] = await database.db
      .select()
      .from(posProductionPrinters)
      .where(eq(posProductionPrinters.id, printerA.id))
      .limit(1);
    assert.equal(demotedA?.isDefault, false);
    assert.equal(demotedA?.revision, printerA.revision + 1);
    const [demotionCommand] = demotedA?.pendingCommandId
      ? await database.db
          .select({ payload: hubCommands.payload })
          .from(hubCommands)
          .where(eq(hubCommands.id, demotedA.pendingCommandId))
          .limit(1)
      : [];
    assert.equal(
      ((demotionCommand?.payload.configuration as Record<string, unknown> | undefined)?.isDefault as
        | boolean
        | undefined) ?? null,
      false,
    );
    await assert.rejects(
      () =>
        service.updatePrinter(
          owner.id,
          organization.id,
          unit.id,
          promotedPrinter.id,
          `unset-default-${runId}`,
          { ...inputASecondary, isDefault: false, revision: promotedPrinter.revision },
        ),
      (error: unknown) => errorCode(error) === "PRODUCTION_PRINTER_DEFAULT_REQUIRED",
    );
    await assert.rejects(
      () =>
        service.archivePrinter(
          owner.id,
          organization.id,
          unit.id,
          promotedPrinter.id,
          `archive-default-${runId}`,
          promotedPrinter.revision,
        ),
      (error: unknown) => errorCode(error) === "PRODUCTION_PRINTER_DEFAULT_REASSIGNMENT_REQUIRED",
    );

    assert.ok(demotedA);
    const restored = await service.updatePrinter(
      owner.id,
      organization.id,
      unit.id,
      printerA.id,
      `restore-a-default-${runId}`,
      { ...inputA, isDefault: true, revision: demotedA.revision },
    );
    const restoredA = restored.printer as { id: string; revision: number };
    const [demotedSecondary] = await database.db
      .select({ revision: posProductionPrinters.revision })
      .from(posProductionPrinters)
      .where(eq(posProductionPrinters.id, promotedPrinter.id))
      .limit(1);
    assert.ok(demotedSecondary);
    await service.archivePrinter(
      owner.id,
      organization.id,
      unit.id,
      promotedPrinter.id,
      `archive-secondary-${runId}`,
      demotedSecondary.revision,
    );
    const activeDefaults = await database.db
      .select({ hubId: posProductionPrinters.hubId, id: posProductionPrinters.id })
      .from(posProductionPrinters)
      .where(
        and(
          eq(posProductionPrinters.organizationId, organization.id),
          eq(posProductionPrinters.unitId, unit.id),
          eq(posProductionPrinters.active, true),
          eq(posProductionPrinters.isDefault, true),
        ),
      );
    assert.deepEqual(
      activeDefaults.map(({ hubId, id }) => [hubId, id]).sort(),
      [
        [hubA.id, restoredA.id],
        [hubB.id, printerB.id],
      ].sort(),
    );

    const tested = await service.testPrinter(
      owner.id,
      organization.id,
      unit.id,
      restoredA.id,
      `test-a-${runId}`,
      restoredA.revision,
    );
    const changed = await service.updatePrinter(
      owner.id,
      organization.id,
      unit.id,
      restoredA.id,
      `change-a-${runId}`,
      { ...inputA, label: "A principal atualizada", isDefault: true, revision: restoredA.revision },
    );
    const changedA = changed.printer as {
      revision: number;
      lastTestCommandId?: string | null;
      lastStatus: string;
    };
    assert.equal(changedA.lastTestCommandId ?? null, null);
    assert.equal(changedA.lastStatus, "unknown");
    await database.db.transaction((tx) =>
      service.applyCommandResult(
        tx,
        { id: hubA.id, organizationId: organization.id, unitId: unit.id },
        {
          commandId: tested.commandId,
          type: "printer.test",
          printerId: restoredA.id,
          revision: restoredA.revision,
          status: "printed",
          errorCode: null,
          duplicate: false,
        },
      ),
    );
    const [afterStaleResult] = await database.db
      .select({
        revision: posProductionPrinters.revision,
        lastTestCommandId: posProductionPrinters.lastTestCommandId,
        lastStatus: posProductionPrinters.lastStatus,
      })
      .from(posProductionPrinters)
      .where(eq(posProductionPrinters.id, restoredA.id))
      .limit(1);
    assert.deepEqual(afterStaleResult, {
      revision: changedA.revision,
      lastTestCommandId: null,
      lastStatus: "unknown",
    });
    const [acknowledgedTest] = await database.db
      .select({ acknowledgedAt: hubCommands.acknowledgedAt })
      .from(hubCommands)
      .where(eq(hubCommands.id, tested.commandId))
      .limit(1);
    assert.ok(acknowledgedTest?.acknowledgedAt);

    await database.db
      .update(posProductionPrinters)
      .set({ documentTypes: ["kds_ticket", "partial_statement"] })
      .where(eq(posProductionPrinters.id, restoredA.id));
    const configuredPolicy = await service.updateBillPolicy(
      owner.id,
      organization.id,
      unit.id,
      `bill-policy-${runId}`,
      {
        mode: "cashier_printer",
        printerId: restoredA.id,
        revision: 0,
      },
    );
    assert.equal(configuredPolicy.policy.revision, 1);
    assert.deepEqual(
      (await service.readBillPolicy(owner.id, organization.id, unit.id)).policy,
      configuredPolicy.policy,
    );
    await assert.rejects(
      service.updateBillPolicy(owner.id, organization.id, unit.id, `bill-policy-stale-${runId}`, {
        mode: "notify_cashier",
        printerId: null,
        revision: 0,
      }),
      (error: unknown) => errorCode(error) === "BILL_PRINTING_POLICY_VERSION_CONFLICT",
    );
    const [tab] = await database.db
      .insert(posTabs)
      .values({ organizationId: organization.id, unitId: unit.id, openedByIdentityId: owner.id })
      .returning();
    assert.ok(tab);
    const snapshot = {
      schemaVersion: 2,
      tab: { label: "Mesa teste" },
      totals: { totalCents: 1234 },
      items: [],
      payments: [],
    };
    const [initial] = await database.db
      .insert(posPrintJobs)
      .values({
        organizationId: organization.id,
        unitId: unit.id,
        tabId: tab.id,
        documentType: "partial_statement",
        payload: snapshot,
        requestedByIdentityId: owner.id,
      })
      .returning();
    assert.ok(initial);
    await database.db.delete(hubHeartbeats).where(eq(hubHeartbeats.hubId, hubA.id));
    const queued = await database.db.transaction((tx) =>
      service.queueFinancialJob(tx, initial, restoredA.id),
    );
    assert.equal(queued.status, "queued");
    assert.equal(queued.lastError, "EDGE_HUB_OFFLINE");
    assert.ok(queued.hubCommandId);
    const queuedCommandId = queued.hubCommandId;
    const [command] = await database.db
      .select()
      .from(hubCommands)
      .where(eq(hubCommands.id, queued.hubCommandId));
    assert.equal(command?.payload.documentType, "partial_statement");
    assert.deepEqual(command?.payload.payload, snapshot);
    assert.equal(command?.payload.stationId, undefined);
    const scope = { id: hubA.id, organizationId: organization.id, unitId: unit.id };
    await database.db.transaction((tx) =>
      service.applyCommandResult(tx, scope, {
        commandId: queuedCommandId,
        type: "print_job.execute",
        cloudPrintJobId: queued.id,
        status: "printed",
        errorCode: null,
      }),
    );
    assert.equal(
      (await database.db.select().from(posPrintJobs).where(eq(posPrintJobs.id, queued.id)))[0]
        ?.status,
      "printed",
    );
    const [second] = await database.db
      .insert(posPrintJobs)
      .values({
        organizationId: organization.id,
        unitId: unit.id,
        tabId: tab.id,
        documentType: "partial_statement",
        payload: snapshot,
        requestedByIdentityId: owner.id,
      })
      .returning();
    assert.ok(second);
    const expired = await database.db.transaction((tx) =>
      service.queueFinancialJob(tx, second, restoredA.id),
    );
    assert.ok(expired.hubCommandId);
    await database.db
      .update(hubCommands)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(hubCommands.id, expired.hubCommandId));
    await database.db.transaction((tx) =>
      service.expireUnknownPrintCommands(tx, { organizationId: organization.id, unitId: unit.id }),
    );
    assert.equal(
      (await database.db.select().from(posPrintJobs).where(eq(posPrintJobs.id, expired.id)))[0]
        ?.status,
      "confirmation_required",
    );
    const pos = new PilotPosService(database, new ScopeService(database), undefined, service);
    const listed = await pos.listPrintJobs(owner.id, organization.id, unit.id, {
      tabId: tab.id,
      limit: 100,
    });
    assert.ok(listed.every((job) => job.deliveryRoute === "cloud"));
    const paymentStatement = await pos.createPrintJob(
      owner.id,
      organization.id,
      unit.id,
      tab.id,
      `payment-statement-${runId}`,
      {
        documentType: "payment_statement",
        copies: 1,
      },
    );
    assert.equal(paymentStatement.printJob.deliveryRoute, "cashier");
    assert.equal(paymentStatement.printJob.hubCommandId, null);
    await assert.rejects(
      pos.updatePrintJobStatus(
        owner.id,
        organization.id,
        unit.id,
        expired.id,
        `client-ack-${runId}`,
        {
          status: "printed",
        },
      ),
      (error: unknown) => errorCode(error) === "KDS_PRINT_JOB_RESULT_VIA_HUB_REQUIRED",
    );
    await assert.rejects(
      pos.retryPrintJob(
        owner.id,
        organization.id,
        unit.id,
        expired.id,
        `unknown-retry-${runId}`,
        {},
      ),
      (error: unknown) => errorCode(error) === "PRINT_JOB_NOT_FAILED",
    );
    await service.resolveUnknownPrintJob(
      owner.id,
      organization.id,
      unit.id,
      expired.id,
      `resolve-${runId}`,
      {
        outcome: "failed",
        reason: "Operador conferiu ausência de impressão",
      },
    );
    const retryA = await pos.retryPrintJob(
      owner.id,
      organization.id,
      unit.id,
      expired.id,
      `retry-a-${runId}`,
      {},
    );
    const retryB = await pos.retryPrintJob(
      owner.id,
      organization.id,
      unit.id,
      expired.id,
      `retry-b-${runId}`,
      {},
    );
    assert.equal(retryA.printJob.id, retryB.printJob.id);
    assert.notEqual(retryA.printJob.id, expired.id);
    assert.equal(retryA.printJob.deliveryRoute, "cloud");
    assert.deepEqual(retryA.printJob.payload, snapshot);
    assert.ok(retryA.printJob.hubCommandId);
    const retryCommandId = retryA.printJob.hubCommandId;
    await database.db.transaction((tx) =>
      service.applyCommandResult(tx, scope, {
        commandId: retryCommandId,
        type: "print_job.execute",
        cloudPrintJobId: retryA.printJob.id,
        status: "failed",
        errorCode: "PRINTER_UNREACHABLE",
      }),
    );
    assert.equal(
      (
        await database.db
          .select()
          .from(posProductionPrinters)
          .where(eq(posProductionPrinters.id, restoredA.id))
      )[0]?.lastStatus,
      "error",
    );
  } finally {
    if (organizationId) {
      await database.db.delete(posTabEvents).where(eq(posTabEvents.organizationId, organizationId));
      await database.db.delete(posPrintJobs).where(eq(posPrintJobs.organizationId, organizationId));
      await database.db.delete(posTabs).where(eq(posTabs.organizationId, organizationId));
      await database.db.delete(organizations).where(eq(organizations.id, organizationId));
    }
    if (identityId) {
      await database.db.delete(identities).where(eq(identities.id, identityId));
    }
    await database.onModuleDestroy();
  }
});
