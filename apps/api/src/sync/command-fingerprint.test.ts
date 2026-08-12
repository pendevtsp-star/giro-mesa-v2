import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { describe, it } from "node:test";
import { createCommandEnvelope } from "@giromesa/domain";
import {
  commandFingerprintMaterial,
  createCommandFingerprint,
  loadCommandFingerprintKeyring,
  verifyCommandFingerprint,
} from "./command-fingerprint.js";

const key = (byte: number) => Buffer.alloc(32, byte).toString("base64url");
const envelope = createCommandEnvelope(
  {
    commandId: "11111111-1111-4111-8111-111111111111",
    idempotencyKey: "fingerprint-command",
    actorId: "22222222-2222-4222-8222-222222222222",
    deviceId: "33333333-3333-4333-8333-333333333333",
    type: "pos.item.discount_requested",
    aggregate: { type: "tab", id: "44444444-4444-4444-8444-444444444444" },
    occupancyEpoch: "55555555-5555-4555-8555-555555555555",
    resourceVersion: 1,
    aggregateSequence: 2,
    occurredAt: "2026-08-10T12:00:00.000Z",
    payload: { approval: { pin: "1234" } },
  },
  {
    organizationId: "66666666-6666-4666-8666-666666666666",
    unitId: "77777777-7777-4777-8777-777777777777",
    receivedAt: "2026-08-10T12:00:01.000Z",
  },
);

describe("command fingerprint commitment", () => {
  it("cannot be reproduced by a plain SHA-256 candidate", () => {
    const keyring = loadCommandFingerprintKeyring({
      COMMAND_FINGERPRINT_ACTIVE_KEY_VERSION: "v1",
      COMMAND_FINGERPRINT_KEYS: JSON.stringify({ v1: key(1) }),
    });
    const fingerprint = createCommandFingerprint(envelope, keyring);
    const plainCandidate = createHash("sha256")
      .update(commandFingerprintMaterial(envelope))
      .digest("hex");
    assert.equal(fingerprint.keyVersion, "v1");
    assert.notEqual(fingerprint.digest, plainCandidate);
  });

  it("verifies retained versions deterministically across active-key rotation", () => {
    const beforeRotation = loadCommandFingerprintKeyring({
      COMMAND_FINGERPRINT_ACTIVE_KEY_VERSION: "v1",
      COMMAND_FINGERPRINT_KEYS: JSON.stringify({ v1: key(1) }),
    });
    const stored = createCommandFingerprint(envelope, beforeRotation);
    const afterRotation = loadCommandFingerprintKeyring({
      COMMAND_FINGERPRINT_ACTIVE_KEY_VERSION: "v2",
      COMMAND_FINGERPRINT_KEYS: JSON.stringify({ v1: key(1), v2: key(2) }),
    });
    assert.equal(verifyCommandFingerprint(envelope, stored, afterRotation), true);
    assert.deepEqual(createCommandFingerprint(envelope, afterRotation), {
      keyVersion: "v2",
      digest: createCommandFingerprint(envelope, afterRotation).digest,
    });
    const retired = loadCommandFingerprintKeyring({
      COMMAND_FINGERPRINT_ACTIVE_KEY_VERSION: "v2",
      COMMAND_FINGERPRINT_KEYS: JSON.stringify({ v2: key(2) }),
    });
    assert.throws(() => verifyCommandFingerprint(envelope, stored, retired), {
      message: "COMMAND_FINGERPRINT_KEY_VERSION_UNAVAILABLE",
    });
  });

  it("fails closed for missing, malformed, or short key configuration", () => {
    assert.throws(() => loadCommandFingerprintKeyring({}), {
      message: "COMMAND_FINGERPRINT_KEYRING_MISSING",
    });
    assert.throws(
      () =>
        loadCommandFingerprintKeyring({
          COMMAND_FINGERPRINT_ACTIVE_KEY_VERSION: "v1",
          COMMAND_FINGERPRINT_KEYS: JSON.stringify({ v1: key(1).slice(0, 12) }),
        }),
      { message: "COMMAND_FINGERPRINT_KEY_INVALID" },
    );
  });
});
