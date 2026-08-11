import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  activationReadiness,
  assertProvisioningTransition,
  CHECKLIST_ITEMS,
  normalizeLegacyChecklist,
  provisioningResumeState,
  type StructuredActivationChecklist,
} from "./onboarding.js";

describe("onboarding provisioning domain", () => {
  it("does not promote legacy browser booleans to verified evidence", () => {
    const normalized = normalizeLegacyChecklist({ business: true, unit: false });
    assert.equal(normalized.business.status, "in_progress");
    assert.equal(normalized.business.source, "legacy_import");
    assert.equal(normalized.unit.status, "pending");
    assert.deepEqual(activationReadiness(normalized).missingItems, [...CHECKLIST_ITEMS]);
  });

  it("requires every operational item and accepts only verified or authorized waivers", () => {
    const checklist = Object.fromEntries(
      CHECKLIST_ITEMS.map((item) => [
        item,
        {
          status: "verified",
          source: "system",
          evidenceReference: `resource:${item}`,
        },
      ]),
    ) as StructuredActivationChecklist;
    assert.deepEqual(activationReadiness(checklist), { ready: true, missingItems: [] });
    checklist.qr = {
      status: "not_applicable",
      source: "authorized_waiver",
      evidenceReference: "waiver:qr-disabled",
      waiverReason: "Atendimento por QR desativado pelo proprietário.",
      actorIdentityId: "00000000-0000-4000-8000-000000000001",
    };
    assert.deepEqual(activationReadiness(checklist), { ready: true, missingItems: [] });
    checklist.tables = {
      status: "not_applicable",
      source: "system",
      evidenceReference: "resource:tables",
    };
    assert.deepEqual(activationReadiness(checklist), {
      ready: false,
      missingItems: ["tables"],
    });
  });

  it("rejects illegal state overwrites and resumes from the durable checkpoint", () => {
    assert.doesNotThrow(() => assertProvisioningTransition("requested", "validating"));
    assert.doesNotThrow(() => assertProvisioningTransition("activating", "publishing"));
    assert.throws(() => assertProvisioningTransition("completed", "activating"));
    assert.throws(() => assertProvisioningTransition("provisioning", "completed"));
    assert.equal(provisioningResumeState("retryable_failed", "internal_provisioned"), "activating");
    assert.equal(provisioningResumeState("retryable_failed", "activation_committed"), "publishing");
  });
});
