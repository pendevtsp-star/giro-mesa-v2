import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { doseClubManagedCredential, includesDoseClubEntitlement } from "./doseclub.js";

describe("includesDoseClubEntitlement", () => {
  it("aceita somente o entitlement explícito ou aliases legados", () => {
    assert.equal(includesDoseClubEntitlement(["salon", "doseclub.subscription"]), true);
    assert.equal(includesDoseClubEntitlement(["bundle"]), true);
    assert.equal(includesDoseClubEntitlement(["integrations", "inventory"]), false);
    assert.equal(includesDoseClubEntitlement("bundle"), false);
  });
});

describe("doseClubManagedCredential", () => {
  it("derives a stable tenant credential without persisting the token", () => {
    const first = doseClubManagedCredential("integration-1", "x".repeat(32));
    const replay = doseClubManagedCredential("integration-1", "x".repeat(32));
    const other = doseClubManagedCredential("integration-2", "x".repeat(32));
    assert.deepEqual(first, replay);
    assert.notEqual(first.token, other.token);
    assert.match(first.reference, /^managed:v1:[0-9a-f]{64}$/);
    assert.equal(first.reference.includes(first.token), false);
  });
});
