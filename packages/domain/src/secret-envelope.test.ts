import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { decryptSecret, encryptionKey, encryptSecret } from "./secret-envelope.js";

describe("secret envelope", () => {
  it("round-trips a secret and binds it to associated data", () => {
    const key = Buffer.alloc(32, 7);
    const encrypted = encryptSecret("one-time-token", key, "identity:one");

    assert.equal(decryptSecret(encrypted, key, "identity:one"), "one-time-token");
    assert.throws(() => decryptSecret(encrypted, key, "identity:two"));
  });

  it("rejects keys that are missing or not 32 bytes", () => {
    assert.throws(() => encryptionKey(undefined, "TEST_KEY"), /TEST_KEY is required/);
    assert.throws(
      () => encryptionKey(Buffer.alloc(16).toString("base64"), "TEST_KEY"),
      /TEST_KEY must be 32 bytes/,
    );
  });
});
