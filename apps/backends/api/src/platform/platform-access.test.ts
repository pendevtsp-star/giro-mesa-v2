import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { isPlatformAdminEmail, platformAccessForEmail } from "./platform-access.js";

describe("platform administrator allowlist", () => {
  it("matches complete normalized addresses and rejects partial matches", () => {
    const configured = " admin@giromesa.com.br,ops@giromesa.com.br ";
    assert.equal(isPlatformAdminEmail("ADMIN@giromesa.com.br", configured), true);
    assert.equal(isPlatformAdminEmail("min@giromesa.com.br", configured), false);
    assert.equal(isPlatformAdminEmail("admin@evil.example", configured), false);
  });

  it("maps configured roles to least-privilege capabilities and keeps the legacy allowlist", () => {
    const engineering = platformAccessForEmail(
      "dev@giromesa.com.br",
      "dev@giromesa.com.br=engineering, fiscal@giromesa.com.br:fiscal",
      "",
    );
    assert.deepEqual(engineering?.capabilities, [
      "tenants:read",
      "incidents:write",
      "outbox:retry",
      "commercial:read",
      "commercial:media",
    ]);
    assert.equal(engineering?.capabilities.includes("pii:read"), false);
    assert.equal(engineering?.capabilities.includes("billing:write"), false);
    assert.equal(engineering?.capabilities.includes("tenants:write"), false);
    assert.equal(
      platformAccessForEmail(
        "admin@giromesa.com.br",
        "admin@giromesa.com.br=admin,viewer@giromesa.com.br=viewer",
        "",
      )?.capabilities.includes("billing:write"),
      true,
    );
    assert.equal(
      platformAccessForEmail(
        "admin@giromesa.com.br",
        "admin@giromesa.com.br=admin",
        "",
      )?.capabilities.includes("tenants:write"),
      true,
    );
    assert.equal(
      platformAccessForEmail(
        "viewer@giromesa.com.br",
        "admin@giromesa.com.br=admin,viewer@giromesa.com.br=viewer",
        "",
      )?.role,
      "viewer",
    );
    assert.equal(
      platformAccessForEmail("legacy@giromesa.com.br", "", "legacy@giromesa.com.br")?.role,
      "admin",
    );
    const previous = process.env.PLATFORM_ADMIN_ROLES;
    process.env.PLATFORM_ADMIN_ROLES = "viewer@giromesa.com.br=viewer";
    assert.equal(isPlatformAdminEmail("viewer@giromesa.com.br"), true);
    if (previous === undefined) delete process.env.PLATFORM_ADMIN_ROLES;
    else process.env.PLATFORM_ADMIN_ROLES = previous;
    assert.equal(platformAccessForEmail("unknown@example.com", "", ""), null);
  });
});
