import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createTableSessionToken, verifyTableSessionToken } from "./table-session-token.js";

const secret = "s".repeat(32);
const claims = {
  slug: "unidade-centro",
  organizationId: "00000000-0000-4000-8000-000000000001",
  unitId: "00000000-0000-4000-8000-000000000002",
  tableId: "00000000-0000-4000-8000-000000000003",
  tabId: "00000000-0000-4000-8000-000000000004",
  tokenVersion: 3,
  exp: 2_000_000_000,
};

describe("table session token", () => {
  it("binds the short session to tenant, unit, table, tab and menu", () => {
    const token = createTableSessionToken(claims, secret);
    assert.deepEqual(verifyTableSessionToken(token, claims.slug, secret, 1_900_000_000), {
      v: 1,
      ...claims,
    });
    assert.equal(verifyTableSessionToken(token, "outra-unidade", secret, 1_900_000_000), null);

    const crossTenant = createTableSessionToken(
      { ...claims, organizationId: "00000000-0000-4000-8000-000000000099" },
      secret,
    );
    assert.notEqual(crossTenant, token);
  });

  it("allows a table session before a tab is opened", () => {
    const { tabId: _tabId, ...tableClaims } = claims;
    const token = createTableSessionToken(tableClaims, secret);

    assert.deepEqual(verifyTableSessionToken(token, claims.slug, secret, 1_900_000_000), {
      v: 1,
      ...tableClaims,
    });
  });

  it("rejects tampering and expiry", () => {
    const token = createTableSessionToken(claims, secret);
    assert.equal(verifyTableSessionToken(token, claims.slug, secret, claims.exp), null);
    assert.equal(
      verifyTableSessionToken(`${token.slice(0, -1)}x`, claims.slug, secret, 1_900_000_000),
      null,
    );
  });
});
