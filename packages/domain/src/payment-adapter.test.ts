import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  assertSafePaymentPayload,
  canStartPaymentAttempt,
  normalizeAdapterResult,
} from "./payment-adapter.js";

describe("payment adapter boundary", () => {
  it("keeps unknown explicit and blocks an incompatible retry", () => {
    const unknown = normalizeAdapterResult({
      status: "unknown",
      providerReference: "provider-ref-1",
      errorCode: "TIMEOUT_AFTER_SEND",
    });
    assert.equal(unknown.reviewRequired, true);
    assert.equal(unknown.nextAction, "lookup_or_reconcile");
    assert.equal(canStartPaymentAttempt([{ status: "unknown", amountCents: 2_500 }], 2_500), false);
    assert.equal(canStartPaymentAttempt([{ status: "declined", amountCents: 2_500 }], 2_500), true);
  });

  it("accepts only integer cents and closed adapter outcomes", () => {
    assert.throws(() => normalizeAdapterResult({ status: "authorized", amountCents: 10.2 }));
    assert.throws(() =>
      normalizeAdapterResult({ status: "approved" as "authorized", amountCents: 10 }),
    );
  });

  it("rejects PAN, CVV, track data and credential-shaped payloads recursively", () => {
    for (const payload of [
      { pan: "4111111111111111" },
      { nested: { cvv: "123" } },
      { track2: "4111111111111111=29122010000000000000" },
      { terminalPassword: "secret" },
      { note: "4111 1111 1111 1111" },
    ]) {
      assert.throws(() => assertSafePaymentPayload(payload), /Sensitive payment data/);
    }
    assert.deepEqual(assertSafePaymentPayload({ terminalId: "term-1", method: "credit" }), {
      terminalId: "term-1",
      method: "credit",
    });
  });

  it("does not mistake canonical UUID identifiers for card numbers", () => {
    assert.doesNotThrow(() =>
      assertSafePaymentPayload({
        intentId: "00000000-0000-4000-8000-000000000000",
        attemptId: "12345678-1234-4123-8123-123456789012",
      }),
    );
  });
});
