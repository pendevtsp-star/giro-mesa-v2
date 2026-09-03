import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { stableOperationalId } from "./stable-operational-id.js";
import { hubSyncKey } from "./sync.controller.js";
import { cloudCommandResultSchema, syncBatchSchema } from "./sync.schemas.js";
import {
  canonicalJson,
  operationalSnapshotRevision,
  redactOperationalSecrets,
} from "./sync.service.js";

describe("edge sync boundaries", () => {
  it("canonicalizes JSON for idempotency without depending on property order", () => {
    assert.equal(
      canonicalJson({ b: 2, a: { d: 4, c: 3 } }),
      canonicalJson({ a: { c: 3, d: 4 }, b: 2 }),
    );
  });

  it("keeps snapshot revision stable within the lease bucket but tracks domain timestamps", () => {
    const base = {
      capturedAt: new Date("2026-08-16T10:05:00.000Z"),
      approvals: { validUntil: new Date("2026-08-16T22:05:00.000Z"), actors: [] },
      kds: {
        capturedAt: new Date("2026-08-16T10:05:00.000Z"),
        serverTime: new Date("2026-08-16T10:05:00.000Z"),
        tickets: [{ id: "ticket-1", promisedAt: new Date("2026-08-16T10:30:00.000Z") }],
      },
    };
    const sameBucket = {
      ...base,
      capturedAt: new Date("2026-08-16T10:45:00.000Z"),
      approvals: { ...base.approvals, validUntil: new Date("2026-08-16T22:45:00.000Z") },
      kds: {
        ...base.kds,
        capturedAt: new Date("2026-08-16T10:45:00.000Z"),
        serverTime: new Date("2026-08-16T10:45:00.000Z"),
      },
    };
    assert.equal(operationalSnapshotRevision(base), operationalSnapshotRevision(sameBucket));
    assert.notEqual(
      operationalSnapshotRevision(base),
      operationalSnapshotRevision({
        ...base,
        kds: { tickets: [{ id: "ticket-1", promisedAt: new Date("2026-08-16T10:35:00.000Z") }] },
      }),
    );
  });

  it("rejects tenant scope supplied by the edge and oversized batches", () => {
    const base = { protocolVersion: 1, hubVersion: "2.0.0", events: [] };
    assert.equal(syncBatchSchema.safeParse(base).success, true);
    assert.equal(
      syncBatchSchema.safeParse({ ...base, unitId: crypto.randomUUID() }).success,
      false,
    );
    assert.equal(
      syncBatchSchema.safeParse({
        ...base,
        acknowledgedCommandIds: Array.from({ length: 101 }, () => crypto.randomUUID()),
      }).success,
      false,
    );
  });

  it("accepts typed cloud command results and requires an explicit unknown code", () => {
    const commandId = crypto.randomUUID();
    const cloudPrintJobId = crypto.randomUUID();
    assert.equal(
      cloudCommandResultSchema.safeParse({
        commandId,
        type: "print_job.execute",
        cloudPrintJobId,
        localPrintJobId: crypto.randomUUID(),
        printerId: crypto.randomUUID(),
        status: "printed",
        errorCode: null,
        duplicate: false,
      }).success,
      true,
    );
    assert.equal(
      cloudCommandResultSchema.safeParse({
        commandId,
        type: "print_job.execute",
        cloudPrintJobId: null,
        status: "failed",
        errorCode: "CLOUD_PRINT_JOB_INVALID",
      }).success,
      true,
    );
    assert.equal(
      cloudCommandResultSchema.safeParse({
        commandId,
        type: "printer.configuration.upsert",
        printerId: null,
        revision: 0,
        status: "failed",
        errorCode: "PRINTER_CONFIGURATION_COMMAND_INVALID",
      }).success,
      true,
    );
    assert.equal(
      cloudCommandResultSchema.safeParse({
        commandId,
        type: "printer.test",
        printerId: null,
        revision: 0,
        status: "failed",
        errorCode: "PRINTER_TEST_COMMAND_INVALID",
      }).success,
      true,
    );
    assert.equal(
      cloudCommandResultSchema.safeParse({
        commandId,
        type: "print_job.execute",
        cloudPrintJobId,
        status: "confirmation_required",
      }).success,
      false,
    );
    assert.equal(
      cloudCommandResultSchema.safeParse({
        commandId,
        type: "printer.test",
        printerId: crypto.randomUUID(),
        revision: 2,
        status: "confirmation_required",
        errorCode: "PRINTER_RESULT_UNKNOWN",
        duplicate: true,
      }).success,
      true,
    );
    assert.equal(
      cloudCommandResultSchema.safeParse({
        commandId,
        type: "printer.configuration.upsert",
        printerId: crypto.randomUUID(),
        revision: 3,
        status: "applied",
        errorCode: null,
        duplicate: false,
      }).success,
      true,
    );
    assert.equal(
      cloudCommandResultSchema.safeParse({
        commandId,
        type: "printer.connection.probe",
        status: "reachable",
        errorCode: null,
      }).success,
      true,
    );
  });

  it("accepts only the dedicated authorization scheme", () => {
    assert.equal(hubSyncKey("GiroMesaHub one-time-secret"), "one-time-secret");
    assert.equal(hubSyncKey("Bearer one-time-secret"), undefined);
    assert.equal(hubSyncKey(undefined), undefined);
  });

  it("derives the same stable UUID contract used by the Edge Hub", () => {
    assert.equal(
      stableOperationalId("11111111-1111-4111-8111-111111111111", "order-item", "0"),
      "65798188-b7b6-5dff-9e7a-3d1eb3cdcdd0",
    );
  });

  it("never persists a manager PIN from an offline command envelope", () => {
    const redacted = redactOperationalSecrets({
      kind: "pilot.mutation",
      data: {
        body: {
          approval: { approverMembershipId: crypto.randomUUID(), pin: "1234" },
        },
      },
    });
    assert.equal(JSON.stringify(redacted).includes("1234"), false);
    assert.equal(JSON.stringify(redacted).includes("[redacted]"), true);
  });
});
