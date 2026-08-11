import { describe, expect, it } from "vitest";
import { buildSalonMapModel, clampMapScale, moveSalonFocus } from "./salon-map";

const tables = [
  { id: "t1", label: "Mesa 01", seats: 4, status: "available" as const, x: 100, y: 100, width: 160, height: 120, areaId: "a1" },
  { id: "t2", label: "Mesa 02", seats: 2, status: "occupied" as const, x: 400, y: 100, width: 160, height: 120, areaId: "a2", totalCents: 7_850 },
  { id: "t3", label: "Mesa 03", seats: 6, status: "attention" as const, x: 400, y: 420, width: 180, height: 140, areaId: "a1", elapsedMinutes: 42 },
];

describe("mapa operacional do salão", () => {
  it("mantém o layout estável e combina busca, status e praça", () => {
    const model = buildSalonMapModel(tables, {
      query: "mesa",
      statuses: ["occupied", "attention"],
      allowedAreaIds: ["a1"],
    });
    expect(model.visible.map((table) => table.id)).toEqual(["t3"]);
    expect(model.summary).toEqual({ available: 1, occupied: 1, attention: 1, reserved: 0, paying: 0 });
    expect(model.bounds).toEqual({ width: 580, height: 560 });
  });

  it("limita o zoom e move o foco por proximidade espacial", () => {
    expect(clampMapScale(0.2)).toBe(0.65);
    expect(clampMapScale(4)).toBe(1.8);
    expect(moveSalonFocus(tables, "t1", "right")).toBe("t2");
    expect(moveSalonFocus(tables, "t2", "down")).toBe("t3");
  });
});
