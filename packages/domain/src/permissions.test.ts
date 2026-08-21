import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { hasPermission } from "./permissions.js";

const reportPermissions = [
  "reports:read",
  "reports:costs:read",
  "reports:drilldown",
  "reports:export",
  "reports:budget:manage",
  "reports:schedule:manage",
  "reports:views:manage",
  "reports:alerts:manage",
  "reports:costs:backfill",
] as const;

describe("report permissions", () => {
  it("grants every report capability to owner and finance", () => {
    for (const permission of reportPermissions) {
      assert.equal(hasPermission("owner", permission), true);
      assert.equal(hasPermission("finance", permission), true);
    }
  });

  it("keeps manager read-only for configuration and other roles unchanged", () => {
    for (const permission of [
      "reports:read",
      "reports:costs:read",
      "reports:drilldown",
      "reports:export",
      "reports:views:manage",
      "reports:alerts:manage",
    ] as const) {
      assert.equal(hasPermission("manager", permission), true);
    }
    assert.equal(hasPermission("manager", "reports:budget:manage"), false);
    assert.equal(hasPermission("manager", "reports:schedule:manage"), false);
    assert.equal(hasPermission("manager", "reports:costs:backfill"), false);
    for (const role of [
      "waiter",
      "cashier",
      "kds",
      "delivery",
      "inventory",
      "accountant",
    ] as const) {
      assert.equal(hasPermission(role, "reports:read"), false);
      assert.equal(hasPermission(role, "reports:export"), false);
    }
  });
});

describe("operational capabilities", () => {
  it("keeps routine payment and closing compatible without granting approvals", () => {
    for (const role of ["waiter", "cashier"] as const) {
      assert.equal(hasPermission(role, "operations:payments:record"), true);
      assert.equal(hasPermission(role, "operations:tabs:close"), true);
      assert.equal(hasPermission(role, "operations:exceptions:request"), true);
      assert.equal(hasPermission(role, "operations:exceptions:approve"), false);
    }
  });

  it("keeps charge adjustments at cashier or manager level", () => {
    assert.equal(hasPermission("waiter", "operations:charges:adjust"), false);
    assert.equal(hasPermission("cashier", "operations:charges:adjust"), true);
    assert.equal(hasPermission("manager", "operations:charges:adjust"), true);
    assert.equal(hasPermission("manager", "operations:exceptions:approve"), true);
    assert.equal(hasPermission("delivery", "operations:payments:record"), false);
  });

  it("separates reception and turnover duties without widening financial access", () => {
    assert.equal(hasPermission("receptionist", "operations:reception:manage"), true);
    assert.equal(hasPermission("receptionist", "operations:reception:seat"), true);
    assert.equal(hasPermission("receptionist", "operations:payments:record"), false);
    assert.equal(hasPermission("busser", "operations:tables:turnover"), true);
    assert.equal(hasPermission("busser", "orders:write"), false);
    assert.equal(hasPermission("busser", "operations:payments:record"), false);
  });
});
