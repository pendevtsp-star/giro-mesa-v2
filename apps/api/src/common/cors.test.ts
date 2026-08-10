import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  configuredOrigins,
  configuredTrustProxy,
  corsConfiguration,
  isAllowedRealtimeOrigin,
} from "./cors.js";

describe("CORS configuration", () => {
  it("trims an explicit allowlist and never combines wildcard with credentials", () => {
    assert.deepEqual(corsConfiguration("https://site.example, https://ops.example "), {
      origin: ["https://site.example", "https://ops.example"],
      credentials: true,
    });
    assert.deepEqual(corsConfiguration("*"), { origin: "*", credentials: false });
  });

  it("requires an exact origin for credentialed realtime connections", () => {
    assert.equal(isAllowedRealtimeOrigin("https://ops.example", "https://ops.example"), true);
    assert.equal(isAllowedRealtimeOrigin("https://evil.example", "https://ops.example"), false);
    assert.equal(isAllowedRealtimeOrigin("https://ops.example", "*"), false);
    assert.equal(isAllowedRealtimeOrigin(undefined, "https://ops.example"), false);
  });

  it("fails closed when production allowlists are absent", () => {
    assert.deepEqual(configuredOrigins(undefined, "production"), []);
    assert.equal(isAllowedRealtimeOrigin("http://localhost:3102", undefined, "production"), false);
  });

  it("does not trust arbitrary forwarded addresses in production", () => {
    assert.equal(configuredTrustProxy(undefined, "production"), false);
    assert.equal(configuredTrustProxy("1", "production"), 1);
    assert.deepEqual(configuredTrustProxy("loopback, 10.0.0.0/8", "production"), [
      "loopback",
      "10.0.0.0/8",
    ]);
    assert.throws(() => configuredTrustProxy("true", "production"));
  });
});
