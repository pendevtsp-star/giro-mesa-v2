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
  assert.equal(first.serviceAreas.length, 3);
  assert.deepEqual(
    first.serviceAreas.map((area) => area.roomId),
    first.rooms.map((room) => room.id),
  );
  assert.equal(first.tables.length, 120);
  assert.equal(first.serviceShifts.length, 4);
  assert.deepEqual(
    first.serviceShifts.map((shift) => shift.state),
    ["closed", "open", "closed", "scheduled"],
  );
  assert.equal(first.stations.length, 2);
  assert.equal(first.kdsTickets.length, 4);
  assert.ok(first.inventoryItems.length >= 8);
  assert.equal(first.returnableAssets.length, 3);
  assert.deepEqual(
    first.returnableAssets.map((asset) => asset.trackingMode),
    ["aggregate", "aggregate", "serialized"],
  );
  assert.equal(first.returnableSerials.length, 2);
  assert.equal(first.returnableMovements.length, 6);
  assert.equal(first.inventoryEvents.length, 2);
  assert.equal(first.incidents.length, 2);
  assert.equal(first.incidentEvents.length, 2);
  for (const incident of first.incidents) {
    const initialEvent = first.incidentEvents.find((event) => event.incidentId === incident.id);
    assert.equal(incident.status, "reported");
    assert.equal(incident.payrollAction, false);
    assert.equal(initialEvent?.fromStatus, null);
    assert.equal(initialEvent?.toStatus, "reported");
    assert.equal(initialEvent?.actorIdentityId, incident.reporterIdentityId);
  }
  assert.equal(first.receivablePayments.length, 3);
  assert.equal(first.financialLedgerTransactions.length, 3);
  assert.equal(first.financialLedgerEntries.length, 6);
  for (const transaction of first.financialLedgerTransactions) {
    const entries = first.financialLedgerEntries.filter(
      (entry) => entry.transactionId === transaction.id,
    );
    assert.equal(
      entries.reduce((total, entry) => total + (entry.debitCents ?? 0), 0),
      transaction.debitCents,
    );
    assert.equal(
      entries.reduce((total, entry) => total + (entry.creditCents ?? 0), 0),
      transaction.creditCents,
    );
  }
  assert.equal(first.paymentTerminals.length, 1);
  assert.equal(first.paymentIntents.length, 3);
  assert.equal(first.paymentAttempts.length, 3);
  assert.equal(first.paymentAttemptTransitions.length, 6);
  assert.equal(first.paymentIntentTransitions.length, 1);
  assert.equal(first.paymentProviderEvents.length, 2);
  assert.equal(first.growthIntegrations[0]?.provider, "doseclub");
  assert.equal(first.growthIntegrations[0]?.status, "disabled");
  assert.equal(first.growthIntegrations[0]?.credentialReference, null);
  assert.equal(first.doseClubProductMappings.length, 3);
  assert.equal(first.doseClubStates.length, 2);
  assert.deepEqual(
    first.doseClubStates.map((state) => state.contractVersion),
    ["v2", "v2"],
  );
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
