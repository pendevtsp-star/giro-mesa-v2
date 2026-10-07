import assert from "node:assert/strict";
import { createServer } from "node:http";
import { describe, it } from "node:test";
import {
  DoseClubProvisioningError,
  doseClubAccessReference,
  hasDoseClubManualConflict,
  hasEffectiveDoseClubAccess,
  includesDoseClubEntitlement,
  isActiveDoseClubTrial,
  requestJson,
} from "./doseclub-provisioning.js";

describe("Dose Club subscription entitlement", () => {
  it("provisions only an explicit Dose Club or bundle entitlement", () => {
    assert.equal(includesDoseClubEntitlement(["salon", "doseclub.subscription"]), true);
    assert.equal(includesDoseClubEntitlement(["bundle"]), true);
    assert.equal(includesDoseClubEntitlement(["integrations", "inventory"]), false);
    assert.equal(includesDoseClubEntitlement("bundle"), false);
  });
});

describe("Dose Club access event", () => {
  const organizationId = "123e4567-e89b-42d3-a456-426614174000";
  const trialId = "123e4567-e89b-42d3-a456-426614174001";

  it("aceita trial idempotente e rejeita aggregate divergente", () => {
    assert.deepEqual(
      doseClubAccessReference({
        id: "event-1",
        topic: "doseclub.provisioning_requested",
        aggregate_type: "trial",
        aggregate_id: trialId,
        payload: { organizationId, trialId },
        attempts: 0,
      }),
      { organizationId, accessId: trialId, kind: "trial" },
    );
    assert.throws(
      () =>
        doseClubAccessReference({
          id: "event-2",
          topic: "doseclub.provisioning_requested",
          aggregate_type: "trial",
          aggregate_id: organizationId,
          payload: { organizationId, trialId },
          attempts: 0,
        }),
      DoseClubProvisioningError,
    );
  });
});

describe("Dose Club trial eligibility", () => {
  const now = new Date("2026-08-27T12:00:00.000Z");
  const trial = {
    billingState: "trial_active",
    startsAt: new Date("2026-08-01T00:00:00.000Z"),
    endsAt: new Date("2027-02-27T00:00:00.000Z"),
    entitlements: ["doseclub.subscription"],
  };

  it("aceita somente trial vigente, ativo e elegível", () => {
    assert.equal(isActiveDoseClubTrial(trial, now), true);
    assert.equal(
      isActiveDoseClubTrial({ ...trial, endsAt: new Date("2026-08-27T12:00:00.000Z") }, now),
      false,
    );
    assert.equal(isActiveDoseClubTrial({ ...trial, entitlements: ["salon"] }, now), false);
    assert.equal(isActiveDoseClubTrial({ ...trial, billingState: "restricted" }, now), false);
  });
});

describe("Dose Club managed provisioning boundaries", () => {
  it("rejects provisioning redirects before forwarding credentials", async () => {
    let redirectStatus = 307;
    let redirectedRequests = 0;
    const server = createServer((request, response) => {
      if (request.url === "/redirected") {
        redirectedRequests += 1;
        response.writeHead(200, { "content-type": "application/json" });
        response.end("{}");
        return;
      }
      response.writeHead(redirectStatus, { location: "/redirected" });
      response.end();
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    assert.ok(address && typeof address === "object");
    try {
      for (const status of [307, 308]) {
        redirectStatus = status;
        await assert.rejects(
          requestJson(`http://127.0.0.1:${address.port}/provision`, {
            method: "POST",
            headers: { "x-giromesa-provisioning-key": "test-secret" },
            body: JSON.stringify({ integrationKey: "test-token" }),
          }),
          (error: unknown) =>
            error instanceof DoseClubProvisioningError &&
            error.code === "DOSECLUB_PROVISIONING_UNAVAILABLE",
        );
      }
      assert.equal(redirectedRequests, 0);
    } finally {
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it("bloqueia conexão manual global ou de unidade antes de provisionar", () => {
    const unitIds = ["unit-a", "unit-b"];
    assert.equal(
      hasDoseClubManualConflict(
        [{ unitId: null, credentialReference: "DOSECLUB_MANUAL_CREDENTIAL" }],
        unitIds,
      ),
      true,
    );
    assert.equal(
      hasDoseClubManualConflict(
        [{ unitId: "unit-b", credentialReference: "DOSECLUB_MANUAL_CREDENTIAL" }],
        unitIds,
      ),
      true,
    );
    assert.equal(
      hasDoseClubManualConflict(
        [{ unitId: "unit-a", credentialReference: `managed:v1:${"a".repeat(64)}` }],
        unitIds,
      ),
      false,
    );
  });

  it("preserva acesso quando um evento antigo chega após outra fonte válida", () => {
    assert.equal(hasEffectiveDoseClubAccess([false, true]), true);
    assert.equal(hasEffectiveDoseClubAccess([false, false]), false);
  });
});
