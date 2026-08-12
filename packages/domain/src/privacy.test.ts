import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  assertPrivacyTransition,
  PRIVACY_REQUIRED_DOMAINS,
  privacyCompletionState,
  privacyExecutionPlan,
  redactPrivacyMetadata,
} from "./privacy.js";

describe("privacy lifecycle invariants", () => {
  it("fails closed when a mandatory processor is absent", () => {
    const plan = privacyExecutionPlan(new Set(["identity", "organization_membership"]));

    assert.deepEqual(plan.available, ["identity", "organization_membership"]);
    assert.deepEqual(plan.blocked, [
      "operations",
      "management_finance",
      "growth_crm",
      "objects_media",
      "offline_edge",
      "backups",
    ]);
    assert.equal(privacyCompletionState(plan.steps), "partial");
  });

  it("only completes after every mandatory processor confirms", () => {
    const plan = privacyExecutionPlan(new Set(PRIVACY_REQUIRED_DOMAINS));
    assert.equal(privacyCompletionState(plan.steps), "processing");

    const completed = plan.steps.map((step) => ({ ...step, status: "completed" as const }));
    assert.equal(privacyCompletionState(completed), "completed");
  });

  it("rejects terminal-state replay and skips no approval", () => {
    assert.doesNotThrow(() => assertPrivacyTransition("verification_pending", "approval_pending"));
    assert.doesNotThrow(() => assertPrivacyTransition("approval_pending", "processing"));
    assert.throws(() => assertPrivacyTransition("verification_pending", "processing"));
    assert.throws(() => assertPrivacyTransition("completed", "processing"));
  });

  it("redacts values and accepts only non-sensitive audit keys", () => {
    assert.deepEqual(
      redactPrivacyMetadata({
        domain: "identity",
        email: "subject@example.test",
        payload: { displayName: "Subject" },
        reasonCode: "PROCESSOR_ABSENT",
      }),
      { domain: "identity", reasonCode: "PROCESSOR_ABSENT" },
    );
  });
});
