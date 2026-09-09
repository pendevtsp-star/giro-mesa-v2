import { describe, expect, it } from "vitest";
import { isOnUnitDay, unitDateKey } from "./people-date";

describe("datas locais de Pessoas", () => {
  it("respeita a virada do dia no fuso da unidade", () => {
    const instant = "2026-09-10T02:30:00.000Z";

    expect(unitDateKey(instant, "America/Sao_Paulo")).toBe("2026-09-09");
    expect(unitDateKey(instant, "Europe/Lisbon")).toBe("2026-09-10");
    expect(isOnUnitDay(instant, "2026-09-09", "America/Sao_Paulo")).toBe(true);
    expect(isOnUnitDay(instant, "2026-09-10", "America/Sao_Paulo")).toBe(false);
  });
});
