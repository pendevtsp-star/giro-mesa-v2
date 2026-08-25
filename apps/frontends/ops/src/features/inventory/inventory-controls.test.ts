import { beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "../../api";
import { parseInventoryControls } from "./inventory-controls";
import { buildInventoryLabelsHtml } from "./inventory-labels";
import {
  enqueueInventoryAction,
  inventoryOfflineStatus,
  replayInventoryQueue,
} from "./inventory-offline";

const scope = { organizationId: "org", unitId: "unit" };
const storage = new Map<string, string>();

beforeEach(() => {
  storage.clear();
  vi.restoreAllMocks();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value),
    removeItem: (key: string) => storage.delete(key),
  });
});

describe("controles operacionais do estoque", () => {
  it("valida o painel, escapa etiquetas e sincroniza uma leitura offline", async () => {
    const dashboard = parseInventoryControls({
      policies: [],
      countSessions: [],
      lotHolds: [],
      temperatureReadings: [],
      confidence: {
        score: 96,
        level: "high",
        countAccuracyPercent: 99,
        transferAccuracyPercent: 98,
        lossRatePercent: 1,
      },
      anomalies: [],
      purchaseSuggestions: [],
      productionVariances: [],
      returnableDepositExposures: [],
      returnableDepositMode: "disabled",
      capabilities: { canReviewCount: true, canReleaseLot: true, canChargeDeposit: true },
    });
    expect(dashboard.confidence.score).toBe(96);
    expect(
      buildInventoryLabelsHtml([
        { title: "<Cerveja>", detail: "Lote & setor", code: "123", dataUrl: "data:image/png" },
      ]),
    ).toContain("&lt;Cerveja&gt;");

    enqueueInventoryAction(scope, {
      kind: "temperature",
      body: { locationId: "location", celsius: 4, source: "manual" },
      idempotencyKey: "temperature-1",
    });
    expect(inventoryOfflineStatus(scope).pending).toBe(1);
    vi.spyOn(api.management, "recordInventoryTemperature").mockResolvedValue({});
    expect(await replayInventoryQueue(scope)).toEqual({ pending: 0, rejected: 0 });
  });
});
