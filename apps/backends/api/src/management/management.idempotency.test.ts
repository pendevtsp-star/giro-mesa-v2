import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { commissionTransitionAllowed, normalizeIdempotencyKey } from "./management.service.js";

describe("normalizeIdempotencyKey", () => {
  it("rejeita header ausente e normaliza uma chave válida", () => {
    assert.throws(() => normalizeIdempotencyKey(undefined));
    assert.equal(normalizeIdempotencyKey("  people-123  "), "people-123");
  });
});

describe("commissionTransitionAllowed", () => {
  it("mantém o ciclo financeiro monotônico", () => {
    assert.equal(commissionTransitionAllowed("pending", "approved"), true);
    assert.equal(commissionTransitionAllowed("approved", "paid"), true);
    assert.equal(commissionTransitionAllowed("paid", "canceled"), false);
    assert.equal(commissionTransitionAllowed("rejected", "approved"), false);
  });
});
