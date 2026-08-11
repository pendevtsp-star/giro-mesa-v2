import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { demoSeedConfiguration } from "./seed-policy.js";

describe("seed policy", () => {
  it("keeps the standard commercial seed demo-free", () => {
    assert.deepEqual(demoSeedConfiguration({ NODE_ENV: "production" }), {
      enabled: false,
      namespace: null,
    });
  });

  it("refuses demo tenants and credentials in production", () => {
    assert.throws(
      () =>
        demoSeedConfiguration({
          NODE_ENV: "production",
          GIROMESA_SEED_DEMO: "true",
          GIROMESA_DEMO_NAMESPACE: "demo-pilot",
        }),
      /DEMO_SEED_REFUSED_IN_PRODUCTION/,
    );
    assert.throws(
      () =>
        demoSeedConfiguration({
          NODE_ENV: "test",
          GIROMESA_SEED_DEMO: "true",
          GIROMESA_DEMO_NAMESPACE: "demo-pilot",
          GIROMESA_DEMO_PASSWORD: "fixed-secret",
        }),
      /DEMO_SEED_PASSWORDS_ARE_NOT_ACCEPTED/,
    );
  });
});
