import assert from "node:assert/strict";
import test from "node:test";
import { assertDemoResetAllowed, createDemoSeedPlan, DEMO_RESET_CONFIRMATION } from "./seed.js";

function sensitivePaths(value: unknown, path = "seed"): string[] {
  if (Array.isArray(value)) {
    return value.flatMap((entry, index) => sensitivePaths(entry, `${path}[${index}]`));
  }
  if (!value || typeof value !== "object") return [];
  return Object.entries(value).flatMap(([key, entry]) => {
    const normalizedKey = key.replace(/[A-Z]/g, (letter) => `_${letter}`).toLowerCase();
    const currentPath = `${path}.${key}`;
    const sensitive = /(^|_)(password|secret|credential|token|pin|pan|cvv|track)(_|$)/.test(
      normalizedKey,
    );
    if (sensitive && entry !== null && entry !== false && entry !== "") return [currentPath];
    return sensitivePaths(entry, currentPath);
  });
}

test("demo seed plan is deterministic, explicit and operationally complete", () => {
  const first = createDemoSeedPlan();
  const second = createDemoSeedPlan();

  assert.deepEqual(first, second);
  assert.equal(DEMO_RESET_CONFIRMATION, "RESET_GIROMESA_DEMO");
  assert.equal(first.organization.tradeName, "[DEMO] Grupo Aurora");
  assert.equal(first.units.length, 2);
  assert.deepEqual(
    first.roleBindings.map((binding) => binding.role),
    ["owner", "manager", "waiter", "cashier", "kds", "inventory", "finance"],
  );
  assert.equal(first.rooms.length, 3);
  assert.equal(first.tables.length, 120);
  assert.equal(first.stations.length, 2);
  assert.equal(first.kdsTickets.length, 4);
  assert.ok(first.inventoryItems.length >= 8);
  assert.equal(first.returnableInventoryItemIds.length, 3);
  assert.equal(first.inventoryEvents.length, 2);
  assert.equal(first.receivablePayments.length, 3);
  assert.equal(first.growthIntegrations[0]?.provider, "doseclub");
  assert.equal(first.growthIntegrations[0]?.status, "disabled");
  assert.equal(first.growthIntegrations[0]?.credentialReference, null);
});

test("demo seed plan contains no secret, card data or real provider endpoint", () => {
  const plan = createDemoSeedPlan();

  assert.deepEqual(sensitivePaths(plan), []);
  assert.doesNotMatch(JSON.stringify(plan), /https?:\/\//i);
  assert.doesNotMatch(JSON.stringify(plan), /[\u{1F300}-\u{1FAFF}]/u);
});

test("database seed independently refuses a non-demo database", () => {
  assert.throws(
    () =>
      assertDemoResetAllowed(
        "postgresql://demo_user:local-only@127.0.0.1:5432/giromesa",
        DEMO_RESET_CONFIRMATION,
      ),
    /database name must end with _demo/,
  );
  assert.doesNotThrow(() =>
    assertDemoResetAllowed(
      "postgresql://demo_user:local-only@127.0.0.1:5432/giromesa_task35_demo",
      DEMO_RESET_CONFIRMATION,
    ),
  );
});
