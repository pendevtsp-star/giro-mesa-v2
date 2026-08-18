import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  decryptMfaSecret,
  encryptMfaSecret,
  inheritedMfaAttempts,
  recoveryCodeHash,
  recoveryCodeMatches,
  totpReplayHash,
  verifiedTotpCounter,
  verifyTotp,
} from "./mfa.js";

describe("MFA primitives", () => {
  const key = Buffer.alloc(32, 7);

  it("encrypts the TOTP secret and rejects a different key", () => {
    const encrypted = encryptMfaSecret("GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ", key);
    assert.equal(decryptMfaSecret(encrypted, key), "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ");
    assert.throws(() => decryptMfaSecret(encrypted, Buffer.alloc(32, 8)));
  });

  it("verifies the RFC counter result inside the bounded clock window", () => {
    assert.equal(verifyTotp("GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ", "287082", 59_000), true);
    assert.equal(verifiedTotpCounter("GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ", "287082", 59_000), 1);
    assert.equal(verifyTotp("GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ", "287083", 59_000), false);
  });

  it("matches recovery codes without storing them in clear text", () => {
    const hashes = [recoveryCodeHash("one-time-code", key)];
    assert.equal(recoveryCodeMatches("one-time-code", hashes, key), 0);
    assert.equal(recoveryCodeMatches("wrong", hashes, key), -1);
  });

  it("derives a tenant-safe one-time marker for each accepted TOTP counter", () => {
    const marker = totpReplayHash("identity-a", 42, key);
    assert.equal(marker.length, 64);
    assert.equal(totpReplayHash("identity-a", 42, key), marker);
    assert.notEqual(totpReplayHash("identity-a", 43, key), marker);
    assert.notEqual(totpReplayHash("identity-b", 42, key), marker);
  });

  it("carries failed attempts across replacement challenges and locks at five", () => {
    assert.equal(inheritedMfaAttempts(undefined), 0);
    assert.equal(inheritedMfaAttempts(4), 4);
    assert.equal(inheritedMfaAttempts(5), null);
  });
});
