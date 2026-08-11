import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createLedgerPosting, createSalePosting, reverseLedgerPosting } from "./money-ledger.js";

describe("immutable balanced money ledger", () => {
  it("posts sale, service and tip using integer cents and balanced entries", () => {
    const posting = createSalePosting({
      referenceId: "order-1",
      saleCents: 10_001,
      serviceCents: 1_000,
      tipCents: 333,
    });

    assert.equal(posting.debitCents, 11_334);
    assert.equal(posting.creditCents, 11_334);
    assert.deepEqual(
      posting.entries.map((entry) => [entry.account, entry.debitCents, entry.creditCents]),
      [
        ["accounts_receivable", 11_334, 0],
        ["sales_revenue", 0, 10_001],
        ["service_fee_payable", 0, 1_000],
        ["tips_payable", 0, 333],
      ],
    );
  });

  it("supports partial receipts, provider fees, refunds, chargebacks and adjustments", () => {
    const posting = createLedgerPosting({
      kind: "payment",
      referenceId: "attempt-1",
      entries: [
        { account: "cash_at_provider", debitCents: 8_760, creditCents: 0 },
        { account: "provider_fees", debitCents: 240, creditCents: 0 },
        { account: "accounts_receivable", debitCents: 0, creditCents: 9_000 },
      ],
    });
    assert.equal(posting.debitCents, 9_000);
    assert.equal(posting.creditCents, 9_000);

    for (const kind of ["refund", "chargeback", "adjustment"] as const) {
      assert.equal(
        createLedgerPosting({
          kind,
          referenceId: `${kind}-1`,
          entries: [
            { account: "adjustments", debitCents: 1, creditCents: 0 },
            { account: "cash_at_provider", debitCents: 0, creditCents: 1 },
          ],
        }).kind,
        kind,
      );
    }
  });

  it("rejects floats, unbalanced entries and a line with two sides", () => {
    assert.throws(
      () =>
        createLedgerPosting({
          kind: "sale",
          referenceId: "bad-float",
          entries: [
            { account: "cash", debitCents: 10.5, creditCents: 0 },
            { account: "sales", debitCents: 0, creditCents: 10.5 },
          ],
        }),
      /integer cents/,
    );
    assert.throws(
      () =>
        createLedgerPosting({
          kind: "sale",
          referenceId: "bad-balance",
          entries: [
            { account: "cash", debitCents: 10, creditCents: 0 },
            { account: "sales", debitCents: 0, creditCents: 9 },
          ],
        }),
      /balanced/,
    );
    assert.throws(
      () =>
        createLedgerPosting({
          kind: "sale",
          referenceId: "bad-line",
          entries: [
            { account: "cash", debitCents: 10, creditCents: 10 },
            { account: "sales", debitCents: 0, creditCents: 10 },
          ],
        }),
      /exactly one side/,
    );
  });

  it("creates an explicit immutable reversal instead of mutating history", () => {
    const original = createSalePosting({ referenceId: "order-2", saleCents: 2_500 });
    const reversal = reverseLedgerPosting(original, "refund-2");

    assert.equal(reversal.kind, "reversal");
    assert.equal(reversal.reversalOf, original.postingId);
    assert.deepEqual(reversal.entries[0], {
      account: "accounts_receivable",
      debitCents: 0,
      creditCents: 2_500,
      component: "sale",
    });
    assert.equal(original.entries[0]?.debitCents, 2_500);
  });
});
