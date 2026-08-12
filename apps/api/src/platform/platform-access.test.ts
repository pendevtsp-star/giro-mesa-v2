import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  canPlatformMutate,
  hasRecentPlatformStepUp,
  isPlatformAdminEmail,
  platformAccessFor,
} from "./platform-access.js";

describe("platform administrator allowlist", () => {
  it("matches complete normalized addresses and rejects partial matches", () => {
    const configured = " admin@giromesa.com.br,ops@giromesa.com.br ";
    assert.equal(isPlatformAdminEmail("ADMIN@giromesa.com.br", configured), true);
    assert.equal(isPlatformAdminEmail("min@giromesa.com.br", configured), false);
    assert.equal(isPlatformAdminEmail("admin@evil.example", configured), false);
  });

  it("keeps allowlisted administrators read-only until exact mutation grants exist", () => {
    const allowlist = "admin@giromesa.com.br";
    const readOnly = platformAccessFor("admin@giromesa.com.br", allowlist, undefined);
    assert.deepEqual(readOnly.permissions, ["platform.read"]);
    assert.equal(canPlatformMutate(readOnly, "tenant.suspend", "propose"), false);

    const granted = platformAccessFor(
      "ADMIN@giromesa.com.br",
      allowlist,
      "admin@giromesa.com.br=platform.action.propose|platform.tenant.suspend",
    );
    assert.equal(canPlatformMutate(granted, "tenant.suspend", "propose"), true);
    assert.equal(canPlatformMutate(granted, "tenant.restore", "propose"), false);
    assert.equal(canPlatformMutate(granted, "tenant.suspend", "approve"), false);
  });

  it("fails closed when platform grant configuration is malformed", () => {
    const access = platformAccessFor(
      "admin@giromesa.com.br",
      "admin@giromesa.com.br",
      "admin@giromesa.com.br=platform.action.propose|platform.unknown",
    );
    assert.deepEqual(access.permissions, ["platform.read"]);
  });

  it("accepts step-up only for this session inside the ten-minute window", () => {
    const now = new Date("2026-08-11T12:00:00.000Z");
    assert.equal(hasRecentPlatformStepUp(new Date("2026-08-11T11:50:00.001Z"), now), true);
    assert.equal(hasRecentPlatformStepUp(new Date("2026-08-11T11:50:00.000Z"), now), false);
    assert.equal(hasRecentPlatformStepUp(null, now), false);
  });
});
