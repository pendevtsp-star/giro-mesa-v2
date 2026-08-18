import { describe, expect, it } from "vitest";
import {
  buildFloorPlanPositions,
  buildJoinedShiftLayout,
  type FloorPlanItem,
  fitFloorPlanViewport,
  parseFloorPlanViewport,
  resolveFloorPlanFullscreenTarget,
  zoomFloorPlanViewport,
} from "./FloorPlan";

const tables: FloorPlanItem[] = [
  {
    id: "table-1",
    operationId: "table-1",
    label: "Mesa 01",
    seats: 4,
    areaId: "main",
    areaLabel: "Salão principal",
    status: "occupied",
  },
  {
    id: "table-2",
    operationId: "table-2",
    label: "Mesa 02",
    seats: 2,
    areaId: "main",
    areaLabel: "Salão principal",
    status: "free",
  },
  {
    id: "table-3",
    operationId: "table-3",
    label: "Varanda 01",
    seats: 4,
    areaId: "patio",
    areaLabel: "Varanda",
    status: "reserved",
    layoutX: 760,
    layoutY: 180,
  },
];

describe("floor plan layout", () => {
  it("creates stable positions per area and preserves persisted coordinates", () => {
    const first = buildFloorPlanPositions(tables);
    const second = buildFloorPlanPositions(tables);

    expect(first.positions).toEqual(second.positions);
    expect(first.positions["table-1"]).not.toEqual(first.positions["table-2"]);
    expect(first.positions["table-3"]).toEqual({ x: 760, y: 180 });
    expect(first.zones.map((zone) => zone.label)).toEqual(["Salão principal", "Varanda"]);
  });

  it("uses persisted room polygons instead of rebuilding rectangular zones", () => {
    const points = [
      { x: 40, y: 40 },
      { x: 460, y: 30 },
      { x: 420, y: 300 },
      { x: 60, y: 280 },
    ];
    const layout = buildFloorPlanPositions(
      tables,
      [],
      [{ id: "main", label: "Salão principal", points }],
    );

    expect(layout.zones.find((zone) => zone.id === "main")?.points).toEqual(points);
  });

  it("reflows overlapping persisted tables into distinct positions", () => {
    const layout = buildFloorPlanPositions(
      tables.slice(0, 2).map((table) => ({ ...table, layoutX: 100, layoutY: 100 })),
    );

    expect(layout.positions["table-1"]).not.toEqual(layout.positions["table-2"]);
  });

  it("reflows legacy room polygons that occupy the same physical space", () => {
    const points = [
      { x: 20, y: 20 },
      { x: 500, y: 20 },
      { x: 500, y: 360 },
      { x: 20, y: 360 },
    ];
    const layout = buildFloorPlanPositions(
      tables,
      [],
      [
        { id: "main", label: "Salão principal", points },
        { id: "patio", label: "Varanda", points },
      ],
    );
    const [main, patio] = layout.zones;

    expect(main).toBeDefined();
    expect(patio).toBeDefined();
    expect(patio?.x).toBeGreaterThan((main?.x ?? 0) + (main?.width ?? 0));
  });

  it("moves a physical join into the anchor room without changing logical grouping", () => {
    const joined = buildJoinedShiftLayout(tables, ["table-1", "table-3"], "table-1");

    expect(joined.unplacedIds).toEqual([]);
    expect(joined.positions).toHaveLength(2);
    expect(joined.positions.every((position) => position.roomId === "main")).toBe(true);
    expect(joined.positions[0]?.tableId).toBe("table-1");
  });

  it("keeps the pointed world position stable while zooming", () => {
    const aspect = 1_000 / 620;
    const anchor = { x: 0.25, y: 0.75 };
    const before = { x: 100, y: 60, zoom: 1.2 };
    const after = zoomFloorPlanViewport(before, aspect, 2, anchor);
    const beforeWorld = {
      x: before.x + (1_000 / before.zoom) * anchor.x,
      y: before.y + (620 / before.zoom) * anchor.y,
    };
    const afterWorld = {
      x: after.x + (1_000 / after.zoom) * anchor.x,
      y: after.y + (620 / after.zoom) * anchor.y,
    };

    expect(afterWorld.x).toBeCloseTo(beforeWorld.x);
    expect(afterWorld.y).toBeCloseTo(beforeWorld.y);
  });

  it("adds an operational station without representing it as a table", () => {
    const layout = buildFloorPlanPositions(tables, [
      {
        id: "counter",
        label: "Balcão rápido",
        areaId: "counter",
        areaLabel: "Balcão",
        description: "Abrir comanda",
      },
    ]);

    expect(layout.zones.map((zone) => zone.label)).toContain("Balcão");
    expect(layout.positions.counter).toBeUndefined();
  });

  it("frames selections and rejects invalid persisted cameras", () => {
    const viewport = fitFloorPlanViewport(
      [
        { x: 120, y: 120 },
        { x: 820, y: 500 },
      ],
      1_000 / 620,
    );

    expect(viewport.zoom).toBeGreaterThanOrEqual(0.8);
    expect(viewport.x).toBeGreaterThanOrEqual(0);
    expect(parseFloorPlanViewport(JSON.stringify(viewport))).toEqual(viewport);
    expect(parseFloorPlanViewport('{"x":"wrong"}')).toBeNull();
  });

  it("expands the complete salon operation shell instead of only the SVG plan", () => {
    const shell = {} as HTMLElement;
    const plan = {
      closest: (selector: string) => (selector === "[data-salon-operation-shell]" ? shell : null),
    } as HTMLElement;

    expect(resolveFloorPlanFullscreenTarget(plan)).toBe(shell);
    expect(resolveFloorPlanFullscreenTarget(null)).toBeNull();
  });
});
