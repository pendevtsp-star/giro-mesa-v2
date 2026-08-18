import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  createTableAccessToken,
  tableAccessSecret,
  verifyTableAccessToken,
} from "./table-access-token.js";

const secret = "q".repeat(32);
const claims = {
  slug: "unidade-centro",
  tableId: "00000000-0000-4000-8000-000000000001",
  tokenVersion: 3,
  exp: 2_000_000_000,
};

describe("table access token", () => {
  it("binds a signed token to its menu, table, version and expiry", () => {
    const token = createTableAccessToken(claims, secret);
    assert.deepEqual(verifyTableAccessToken(token, claims.slug, secret, 1_900_000_000), {
      v: 1,
      ...claims,
    });
    assert.equal(verifyTableAccessToken(token, "outra-unidade", secret, 1_900_000_000), null);
    assert.equal(verifyTableAccessToken(token, claims.slug, secret, claims.exp), null);
    assert.equal(
      verifyTableAccessToken(`${token.slice(0, -1)}x`, claims.slug, secret, 1_900_000_000),
      null,
    );
  });

  it("requires a dedicated production secret and only falls back outside production", () => {
    assert.equal(
      tableAccessSecret({ NODE_ENV: "test", SESSION_SECRET: "s".repeat(32) }),
      "s".repeat(32),
    );
    assert.throws(
      () => tableAccessSecret({ NODE_ENV: "production", SESSION_SECRET: "s".repeat(32) }),
      /QR_TABLE_TOKEN_SECRET/,
    );
  });
});
