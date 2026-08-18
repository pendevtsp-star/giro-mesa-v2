import { describe, expect, it } from "vitest";
import {
  InvalidPilotPayloadError,
  parseKds,
  parsePilotCatalog,
  parsePilotFloor,
  summarizeOperationalLoad,
  usesQuickServiceMode,
} from "./operations";

describe("contratos operacionais reais", () => {
  it("usa abertura em um toque somente nos modos de alto giro", () => {
    expect(usesQuickServiceMode("quick_service")).toBe(true);
    expect(usesQuickServiceMode("bar")).toBe(true);
    expect(usesQuickServiceMode("full_service")).toBe(false);
    expect(usesQuickServiceMode("hybrid")).toBe(false);
  });

  it("compõe preço, disponibilidade e complementos do catálogo", () => {
    const catalog = parsePilotCatalog({
      categories: [
        { id: "cat-1", name: "Pratos", active: true },
        { id: "cat-archived", name: "Arquivada", active: false },
      ],
      allergens: [],
      modifierGroups: [
        { id: "group-1", name: "Ponto", minimumSelections: 1, maximumSelections: 1 },
      ],
      modifierOptions: [
        {
          id: "option-1",
          groupId: "group-1",
          name: "Ao ponto",
          priceDeltaCents: 0,
          active: true,
        },
      ],
      products: [
        {
          id: "product-1",
          categoryId: "cat-1",
          name: "Executivo",
          description: null,
          estimatedPrepTimeMinutes: 18,
          active: true,
        },
      ],
      recipes: [
        {
          id: "recipe-1",
          productId: "product-1",
          ingredientName: "Arroz",
          quantityMilli: 180_000,
          unit: "g",
        },
      ],
      productAllergens: [],
      productModifierGroups: [{ productId: "product-1", groupId: "group-1" }],
      prices: [{ productId: "product-1", priceCents: 3_500 }],
      availability: [
        {
          productId: "product-1",
          available: true,
          schedule: {
            windows: [{ dayOfWeek: 1, start: "11:00", end: "15:00" }],
          },
        },
      ],
      stations: [],
      productStations: [],
      combos: [
        {
          id: "combo-1",
          name: "Executivo completo",
          description: null,
          priceCents: 4_500,
          active: true,
        },
      ],
      comboItems: [{ comboId: "combo-1", productId: "product-1", quantity: 1 }],
    });

    expect(catalog.products[0]).toMatchObject({
      priceCents: 3_500,
      available: true,
      estimatedPrepTimeMinutes: 18,
      availabilitySchedule: {
        windows: [{ dayOfWeek: 1, start: "11:00", end: "15:00" }],
      },
      modifierGroupIds: ["group-1"],
      recipe: [{ componentId: "recipe-1", name: "Arroz", quantity: 180, unit: "g" }],
    });
    expect(catalog.categories.map((category) => category.id)).toEqual(["cat-1"]);
    expect(catalog.combos[0]?.items).toEqual([{ productId: "product-1", quantity: 1 }]);
  });

  it("interpreta o mapa do salão sem criar mesas artificiais", () => {
    const floor = parsePilotFloor({
      rooms: [
        {
          id: "room-1",
          name: "Salão",
          active: true,
          layoutPolygon: [
            { x: 20, y: 20 },
            { x: 480, y: 20 },
            { x: 460, y: 300 },
            { x: 20, y: 300 },
          ],
        },
      ],
      tables: [
        {
          id: "table-1",
          roomId: "room-1",
          label: "Mesa 1",
          seats: 4,
          status: "available",
          active: true,
        },
      ],
      openTabs: [],
      tablePhases: [
        {
          tableId: "table-1",
          tabId: "tab-1",
          phase: "ready",
          since: "2026-08-15T20:20:00.000Z",
        },
      ],
      activeShift: {
        id: "shift-1",
        label: "Jantar",
        serviceMode: "hybrid",
        startsAt: "2026-08-15T20:00:00.000Z",
      },
      shiftTableLayouts: [
        { shiftId: "shift-1", tableId: "table-1", roomId: "room-1", x: 220, y: 140 },
      ],
      shiftSections: [
        {
          id: "section-1",
          shiftId: "shift-1",
          name: "Praça A",
          color: "#176B4D",
          serviceMode: "hybrid",
        },
        {
          id: "section-2",
          shiftId: "shift-1",
          name: "Praça B",
          color: "#245D8C",
          serviceMode: "hybrid",
        },
      ],
      shiftSectionTables: [{ shiftId: "shift-1", shiftSectionId: "section-1", tableId: "table-1" }],
      shiftSectionStaff: [
        {
          shiftId: "shift-1",
          shiftSectionId: "section-2",
          identityId: "waiter-1",
          role: "primary",
        },
      ],
      shiftTableTransfers: [
        {
          id: "transfer-1",
          shiftId: "shift-1",
          tableId: "table-1",
          sourceShiftSectionId: "section-1",
          targetShiftSectionId: "section-2",
          expiresAt: "2026-08-15T21:00:00.000Z",
          reason: "Cobertura temporária",
          transferredByIdentityId: "manager-1",
        },
      ],
      staff: [{ identityId: "waiter-1", displayName: "Lia" }],
    });

    expect(floor.tables).toHaveLength(1);
    expect(floor.rooms[0]?.layoutPolygon).toHaveLength(4);
    expect(floor.shiftTableLayouts[0]).toMatchObject({ tableId: "table-1", x: 220, y: 140 });
    expect(floor.tablePhases[0]).toMatchObject({ tableId: "table-1", phase: "ready" });
    expect(summarizeOperationalLoad(floor)).toMatchObject({
      sections: [
        { id: "section-1", tables: 0 },
        { id: "section-2", tables: 1 },
      ],
      staff: [{ identityId: "waiter-1", sections: 1 }],
    });
  });

  it("agrupa somente itens de tickets reais e rejeita estado desconhecido", () => {
    expect(
      parseKds({
        tickets: [
          {
            id: "ticket-1",
            orderId: "order-1",
            stationId: "station-1",
            status: "pending",
            createdAt: "2026-08-09T20:00:00.000Z",
          },
        ],
        items: [
          {
            ticketId: "ticket-1",
            item: {
              id: "item-1",
              orderId: "order-1",
              productName: "Executivo",
              quantity: 1,
              grossCents: 3_500,
              discountCents: 0,
              netCents: 3_500,
              status: "queued",
              notes: null,
            },
          },
        ],
      }).items,
    ).toHaveLength(1);
    expect(() => parseKds({ tickets: [{ status: "inventado" }], items: [] })).toThrow(
      InvalidPilotPayloadError,
    );
  });
});
