import { describe, expect, it } from "vitest";
import { createDemoScenario, initialTables, organizations, profiles } from "./demo-data";

function sensitiveValues(value: unknown, path = "demo"): string[] {
  if (Array.isArray(value)) {
    return value.flatMap((entry, index) => sensitiveValues(entry, `${path}[${index}]`));
  }
  if (!value || typeof value !== "object") return [];

  return Object.entries(value).flatMap(([key, entry]) => {
    const currentPath = `${path}.${key}`;
    const normalizedKey = key.replace(/[A-Z]/g, (letter) => `_${letter}`).toLowerCase();
    const sensitiveKey = /(^|_)(password|secret|credential|token|pin|pan|cvv|track)(_|$)/.test(
      normalizedKey,
    );
    if (sensitiveKey && entry !== null && entry !== false && entry !== "") return [currentPath];
    return sensitiveValues(entry, currentPath);
  });
}

describe("complete demo scenario", () => {
  it("builds the same explicitly-demo operating day on every run", () => {
    const first = createDemoScenario();
    const second = createDemoScenario();

    expect(first).toEqual(second);
    expect(first.metadata).toEqual({
      dataset: "giromesa-complete-demo",
      version: 1,
      demoOnly: true,
      referenceTime: "2026-08-10T18:00:00.000Z",
    });
    expect(organizations.map((organization) => organization.name)).toEqual(["[DEMO] Grupo Aurora"]);
    expect(organizations[0]?.units.map((unit) => unit.name)).toEqual([
      "[DEMO] Aurora Centro",
      "[DEMO] Aurora Lagoa",
    ]);
  });

  it("covers every operating role and the complete salon, KDS, stock, finance and DoseClub story", () => {
    const scenario = createDemoScenario();

    expect(profiles.map((profile) => profile.id)).toEqual([
      "owner",
      "manager",
      "waiter",
      "cashier",
      "kitchen",
      "inventory",
      "finance",
      "delivery",
      "platform",
    ]);
    expect(initialTables).toHaveLength(120);
    expect(new Set(initialTables.map((table) => table.id)).size).toBe(120);
    expect(scenario.serviceAreas.map((area) => area.tableCount)).toEqual([40, 40, 40]);
    expect(scenario.shifts).toHaveLength(4);
    expect(scenario.kdsTickets.map((ticket) => ticket.status)).toEqual([
      "new",
      "preparing",
      "ready",
      "preparing",
    ]);
    expect(scenario.inventory.items.length).toBeGreaterThanOrEqual(5);
    expect(scenario.returnables).toHaveLength(3);
    expect(scenario.incidents).toHaveLength(2);
    expect(scenario.finance.payments).toHaveLength(3);
    expect(
      scenario.finance.payments.every((payment) => Number.isInteger(payment.amountCents)),
    ).toBe(true);
    expect(scenario.doseClub).toEqual({
      provider: "doseclub",
      status: "disabled",
      mode: "simulator",
      mappingCount: 3,
      pendingReconciliationCount: 1,
    });
  });

  it("contains no credential, payment-card data or enabled real provider", () => {
    const scenario = {
      profiles,
      organizations,
      ...createDemoScenario(),
    };

    expect(sensitiveValues(scenario)).toEqual([]);
    expect(JSON.stringify(scenario)).not.toMatch(/https?:\/\//i);
    expect(JSON.stringify(scenario)).not.toMatch(/[\u{1F300}-\u{1FAFF}]/u);
  });
});
