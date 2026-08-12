import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { describe, it } from "node:test";
import { PRIVACY_REQUIRED_DOMAINS } from "@giromesa/domain";
import {
  privacyProcessingAggregateId,
  privacyProcessorPolicy,
  REGISTERED_PRIVACY_PROCESSORS,
} from "./privacy-processors.js";

describe("privacy processor registry", () => {
  it("registers every mandatory local domain instead of masking gaps as absent processors", () => {
    assert.deepEqual([...REGISTERED_PRIVACY_PROCESSORS], [...PRIVACY_REQUIRED_DOMAINS]);
  });

  it("completes access exports locally while keeping mutating backup propagation fail-closed", () => {
    for (const domain of PRIVACY_REQUIRED_DOMAINS) {
      assert.deepEqual(privacyProcessorPolicy("access_export", domain), {
        outcome: "process",
      });
    }
    assert.deepEqual(privacyProcessorPolicy("anonymization", "backups"), {
      outcome: "blocked",
      reasonCode: "BACKUP_RETENTION_POLICY_UNAPPROVED",
    });
    assert.deepEqual(privacyProcessorPolicy("correction", "operations"), {
      outcome: "preflight",
    });
  });

  it("binds every retry attempt into the durable outbox aggregate identity", () => {
    const requestId = randomUUID();
    assert.equal(privacyProcessingAggregateId(requestId, 3), `${requestId}:3`);
    assert.throws(() => privacyProcessingAggregateId(requestId, 0), /PRIVACY_ATTEMPT_INVALID/);
  });
});
