import { describe, expect, it } from "vitest";
import {
  hasCatalogProductionStation,
  normalizeCatalogStationIds,
  toggleCatalogStationId,
} from "./catalog.stations";

describe("praças de produção do catálogo", () => {
  it("preserva múltiplas praças, remove duplicatas e permite alternar cada seleção", () => {
    expect(normalizeCatalogStationIds(["cozinha", "bar", "cozinha", ""])).toEqual([
      "cozinha",
      "bar",
    ]);
    expect(toggleCatalogStationId(["cozinha"], "bar")).toEqual(["cozinha", "bar"]);
    expect(toggleCatalogStationId(["cozinha", "bar"], "cozinha")).toEqual(["bar"]);
    expect(hasCatalogProductionStation([])).toBe(false);
    expect(hasCatalogProductionStation(["cozinha", "bar"])).toBe(true);
  });
});
