import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { isPlatformAdminEmail } from "./platform-access.js";

describe("platform administrator allowlist", () => {
  it("matches complete normalized addresses and rejects partial matches", () => {
    const configured = " admin@giromesa.com.br,ops@giromesa.com.br ";
    assert.equal(isPlatformAdminEmail("ADMIN@giromesa.com.br", configured), true);
    assert.equal(isPlatformAdminEmail("min@giromesa.com.br", configured), false);
    assert.equal(isPlatformAdminEmail("admin@evil.example", configured), false);
  });
});
