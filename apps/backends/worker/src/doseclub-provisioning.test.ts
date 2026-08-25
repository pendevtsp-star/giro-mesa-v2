import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { includesDoseClubEntitlement } from "./doseclub-provisioning.js";

describe("Dose Club subscription entitlement", () => {
  it("provisions only an explicit Dose Club or bundle entitlement", () => {
    assert.equal(includesDoseClubEntitlement(["salon", "doseclub.subscription"]), true);
    assert.equal(includesDoseClubEntitlement(["bundle"]), true);
    assert.equal(includesDoseClubEntitlement(["integrations", "inventory"]), false);
    assert.equal(includesDoseClubEntitlement("bundle"), false);
  });
});
