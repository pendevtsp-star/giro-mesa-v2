import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  type BusinessHours,
  billingAccess,
  getBusinessOpenState,
  hasPermission,
  missingActivationItems,
  transitionBilling,
  trialWindow,
} from "./index.js";

describe("critical domain rules", () => {
  it("calculates establishment hours in the unit timezone", () => {
    const weekly: BusinessHours["weekly"] = Array.from({ length: 7 }, (_, index) => ({
      weekday: index + 1,
      mode: "closed" as const,
    }));
    weekly[0] = {
      weekday: 1,
      mode: "periods",
      periods: [{ start: "09:00", end: "17:00", endsNextDay: false }],
    };
    assert.deepEqual(
      getBusinessOpenState(
        { weekly, exceptions: [] },
        "America/Sao_Paulo",
        new Date("2026-08-24T12:00:00.000Z"),
      ),
      { open: true, nextChangeAt: "2026-08-24T20:00:00.000Z" },
    );
  });

  it("supports overnight periods, open24h and exception precedence", () => {
    const weekly: BusinessHours["weekly"] = Array.from({ length: 7 }, (_, index) => ({
      weekday: index + 1,
      mode: "closed" as const,
    }));
    weekly[4] = {
      weekday: 5,
      mode: "periods",
      periods: [{ start: "22:00", end: "02:00", endsNextDay: true }],
    };
    const overnight = getBusinessOpenState(
      { weekly, exceptions: [] },
      "America/Sao_Paulo",
      new Date("2026-08-29T04:00:00.000Z"),
    );
    assert.equal(overnight.open, true);
    assert.equal(overnight.nextChangeAt, "2026-08-29T05:00:00.000Z");

    weekly[5] = { weekday: 6, mode: "open24h" };
    assert.equal(
      getBusinessOpenState(
        { weekly, exceptions: [] },
        "America/Sao_Paulo",
        new Date("2026-08-29T15:00:00.000Z"),
      ).open,
      true,
    );

    const holiday = getBusinessOpenState(
      {
        weekly,
        exceptions: [{ date: "2026-08-29", mode: "closed" }],
      },
      "America/Sao_Paulo",
      new Date("2026-08-29T04:00:00.000Z"),
    );
    assert.equal(holiday.open, false);
  });

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
    assert.equal(hasPermission("delivery", "orders:write"), true);
    assert.equal(hasPermission("delivery", "finance:write"), false);
    assert.equal(hasPermission("accountant", "fiscal:documents:read"), true);
    assert.equal(hasPermission("accountant", "fiscal:periods:write"), false);
    assert.equal(hasPermission("manager", "fiscal:configuration:write"), false);
    assert.equal(hasPermission("finance", "fiscal:configuration:write"), false);
    assert.equal(hasPermission("finance", "fiscal:periods:write"), true);
  });
});
