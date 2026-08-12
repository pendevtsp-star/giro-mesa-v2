import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { paymentProviderCallbackSchema } from "./payments.schemas.js";

const callback = {
  attemptId: "00000000-0000-4000-8000-000000000001",
  providerEventId: "provider-event-1",
  status: "authorized" as const,
  amountCents: 1_200,
};

describe("payment provider callback scope", () => {
  it("derives tenant scope from the authenticated attempt instead of accepting it from the body", () => {
    assert.equal(paymentProviderCallbackSchema.safeParse(callback).success, true);
    assert.equal(
      paymentProviderCallbackSchema.safeParse({
        ...callback,
        organizationId: "00000000-0000-4000-8000-000000000002",
        unitId: "00000000-0000-4000-8000-000000000003",
      }).success,
      false,
    );
  });
});
