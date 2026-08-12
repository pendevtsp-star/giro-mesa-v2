import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { ConflictException, Module } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { FastifyAdapter, type NestFastifyApplication } from "@nestjs/platform-fastify";
import { AuthService } from "../auth/auth.service.js";
import { SessionGuard } from "../auth/session.guard.js";
import { DatabaseService } from "../database/database.module.js";
import { DoseClubReconciliationController } from "./doseclub-reconciliation.controller.js";
import { DoseClubReconciliationService } from "./doseclub-reconciliation.service.js";

const identityId = "d1111111-1111-4111-8111-111111111111";
const organizationId = "a1111111-1111-4111-8111-111111111111";
const unitId = "b1111111-1111-4111-8111-111111111111";
const runId = "c1111111-1111-4111-8111-111111111111";
const calls: Array<{ operation: string; values: unknown[] }> = [];

function run() {
  return {
    id: runId,
    unitId,
    runDate: "2026-08-11",
    trigger: "manual",
    status: "pending",
    findingCount: 0,
    failureCode: null,
    version: 1,
    startedAt: null,
    completedAt: null,
    createdAt: new Date("2026-08-11T12:00:00.000Z"),
    updatedAt: new Date("2026-08-11T12:00:00.000Z"),
  };
}

const service = {
  overview(...values: unknown[]) {
    calls.push({ operation: "overview", values });
    return {
      integration: null,
      reconciliation: {
        status: "not_scanned",
        remoteHeartbeat: "partial",
        lastRun: null,
        openFindingCount: 0,
      },
      mappings: [],
      findings: [],
      runs: [],
    };
  },
  createMapping(...values: unknown[]) {
    calls.push({ operation: "createMapping", values });
    return {};
  },
  updateMapping(...values: unknown[]) {
    calls.push({ operation: "updateMapping", values });
    throw new ConflictException({ code: "DOSECLUB_MAPPING_VERSION_CONFLICT" });
  },
  requestRun(...values: unknown[]) {
    calls.push({ operation: "requestRun", values });
    return run();
  },
  retryRun(...values: unknown[]) {
    calls.push({ operation: "retryRun", values });
    return run();
  },
  recheckFinding(...values: unknown[]) {
    calls.push({ operation: "recheckFinding", values });
    return run();
  },
};

@Module({
  controllers: [DoseClubReconciliationController],
  providers: [
    { provide: DoseClubReconciliationService, useValue: service },
    {
      provide: AuthService,
      useValue: { authenticate: () => ({ identityId }) },
    },
    {
      provide: DatabaseService,
      useValue: { withRoleContext: (_role: string, _actor: null, work: () => unknown) => work() },
    },
    SessionGuard,
  ],
})
class DoseClubReconciliationHttpTestModule {}

let app: NestFastifyApplication;

before(async () => {
  app = await NestFactory.create<NestFastifyApplication>(
    DoseClubReconciliationHttpTestModule,
    new FastifyAdapter({ logger: false }),
    { abortOnError: false, logger: ["error"] },
  );
  await app.init();
  await app.getHttpAdapter().getInstance().ready();
});

after(async () => app?.close());

describe("DoseClub reconciliation HTTP contract", () => {
  for (const prefix of ["/api/v1", "/v1"]) {
    it(`serves ${prefix} with tenant parameters and 202/idempotency`, async () => {
      calls.length = 0;
      const base = `${prefix}/organizations/${organizationId}/growth/integrations/doseclub`;
      const overview = await app.inject({
        method: "GET",
        url: `${base}/overview?unitId=${unitId}`,
        headers: { authorization: "Bearer test-session" },
      });
      assert.equal(overview.statusCode, 200);
      assert.equal(calls[0]?.operation, "overview");
      assert.deepEqual(calls[0]?.values, [identityId, organizationId, unitId]);

      const queued = await app.inject({
        method: "POST",
        url: `${base}/runs`,
        // Session auth remains distinct from the request idempotency key.
        headers: {
          authorization: "Bearer test-session",
          "idempotency-key": "reconciliation-test-1",
        },
        payload: { unitId },
      });
      assert.equal(queued.statusCode, 202);
      assert.deepEqual(calls.at(-1)?.values, [
        identityId,
        organizationId,
        unitId,
        "reconciliation-test-1",
      ]);
    });
  }

  it("rejects invalid UUIDs before invoking the service and preserves 409", async () => {
    calls.length = 0;
    const invalid = await app.inject({
      method: "GET",
      url: "/api/v1/organizations/not-a-uuid/growth/integrations/doseclub/overview?unitId=bad",
      headers: { authorization: "Bearer test-session" },
    });
    assert.equal(invalid.statusCode, 400);
    assert.equal(calls.length, 0);

    const conflict = await app.inject({
      method: "PATCH",
      url: `/api/v1/organizations/${organizationId}/growth/integrations/doseclub/mappings/${runId}`,
      payload: {
        unitId,
        inventoryItemId: runId,
        stockLocationId: runId,
        active: true,
        expectedVersion: 1,
      },
      headers: { authorization: "Bearer test-session" },
    });
    assert.equal(conflict.statusCode, 409);
    assert.equal(conflict.json().code, "DOSECLUB_MAPPING_VERSION_CONFLICT");
  });

  it("requires a session and rejects unknown mutation fields", async () => {
    calls.length = 0;
    const base = `/v1/organizations/${organizationId}/growth/integrations/doseclub`;
    const unauthenticated = await app.inject({
      method: "GET",
      url: `${base}/overview?unitId=${unitId}`,
    });
    assert.equal(unauthenticated.statusCode, 401);
    assert.equal(calls.length, 0);

    const unknownField = await app.inject({
      method: "POST",
      url: `${base}/runs`,
      headers: {
        authorization: "Bearer test-session",
        "idempotency-key": "reconciliation-test-unknown",
      },
      payload: { unitId, pretendSuccess: true },
    });
    assert.equal(unknownField.statusCode, 400);
    assert.equal(calls.length, 0);
  });
});
