import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { transitionFiscalDocument } from "./fiscal-state.js";

describe("independent fiscal document state", () => {
  it("authorizes and cancels only through explicit transitions", () => {
    assert.equal(transitionFiscalDocument("pending", "submit"), "submitted");
    assert.equal(transitionFiscalDocument("submitted", "authorize"), "authorized");
    assert.equal(transitionFiscalDocument("authorized", "cancel"), "cancelled");
  });

  it("keeps a failed document retryable without changing the sale", () => {
    const sale = Object.freeze({ id: "sale-1", status: "paid" as const });
    assert.equal(transitionFiscalDocument("submitted", "reject"), "rejected");
    assert.equal(transitionFiscalDocument("rejected", "retry"), "pending");
    assert.deepEqual(sale, { id: "sale-1", status: "paid" });
  });

  it("rejects illegal skips and terminal retries", () => {
    assert.throws(() => transitionFiscalDocument("pending", "authorize"));
    assert.throws(() => transitionFiscalDocument("cancelled", "retry"));
  });
});
