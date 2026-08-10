import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  billingAccess,
  hasPermission,
  missingActivationItems,
  transitionBilling,
  trialWindow,
} from "./index.js";

describe("critical domain rules", () => {
  it("allows only declared billing transitions", () => {
    assert.equal(transitionBilling("draft", "START_ONBOARDING"), "onboarding");
    assert.equal(transitionBilling("trial_active", "TRIAL_EXPIRED"), "restricted");
    assert.throws(() => transitionBilling("draft", "CONFIRM_PAYMENT"));
  });

  it("opens a fourteen day trial only after activation", () => {
    const startsAt = new Date("2026-08-09T12:00:00.000Z");
    assert.equal(trialWindow(startsAt).endsAt.toISOString(), "2026-08-23T12:00:00.000Z");
  });

  it("restricts expired tenants but preserves a bounded shift closure", () => {
    const now = new Date("2026-08-10T00:00:00.000Z");
    assert.equal(
      billingAccess("restricted", now, new Date("2026-08-10T01:00:00.000Z")),
      "finish_shift",
    );
    assert.equal(
      billingAccess("restricted", now, new Date("2026-08-09T23:59:59.000Z")),
      "read_billing_export_support",
    );
  });

  it("requires every activation gate", () => {
    assert.deepEqual(missingActivationItems({ business: true }), [
      "unit",
      "catalog",
      "team",
      "production",
      "cashier",
      "fiscalChoice",
      "training",
      "rehearsal",
    ]);
  });

  it("keeps owner universal and staff scoped", () => {
    assert.equal(hasPermission("owner", "billing:write"), true);
    assert.equal(hasPermission("waiter", "orders:write"), true);
    assert.equal(hasPermission("waiter", "finance:write"), false);
  });
});
