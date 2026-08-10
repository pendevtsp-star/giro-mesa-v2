import { describe, expect, it } from "vitest";
import {
  InvalidPilotPayloadError,
  parseKds,
  parsePilotCatalog,
  parsePilotFloor,
} from "./operations";

describe("contratos operacionais reais", () => {
  it("compõe preço, disponibilidade e complementos do catálogo", () => {
    const catalog = parsePilotCatalog({
      categories: [{ id: "cat-1", name: "Pratos" }],
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
          active: true,
        },
      ],
      recipes: [],
      productAllergens: [],
      productModifierGroups: [{ productId: "product-1", groupId: "group-1" }],
      prices: [{ productId: "product-1", priceCents: 3_500 }],
      availability: [{ productId: "product-1", available: true }],
      stations: [],
      productStations: [],
    });

    expect(catalog.products[0]).toMatchObject({
      priceCents: 3_500,
      available: true,
      modifierGroupIds: ["group-1"],
    });
  });

  it("interpreta o mapa do salão sem criar mesas artificiais", () => {
    expect(
      parsePilotFloor({
        rooms: [{ id: "room-1", name: "Salão", active: true }],
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
      }).tables,
    ).toHaveLength(1);
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
