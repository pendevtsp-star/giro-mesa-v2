import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  DoseClubProvisioningError,
  doseClubAccessReference,
  hasDoseClubManualConflict,
  hasEffectiveDoseClubAccess,
  includesDoseClubEntitlement,
  isActiveDoseClubTrial,
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
