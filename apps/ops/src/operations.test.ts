import { describe, expect, it } from "vitest";
import {
  InvalidPilotPayloadError,
  parseDurableKds,
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

  it("associa cada efeito da inbox Edge a um ticket local visível", () => {
    const kds = parseDurableKds({
      snapshot: {
        tickets: [
          {
            id: "ticket-1",
            orderId: "order-1",
            stationId: "station-1",
            status: "pending",
            createdAt: "2026-08-11T20:00:00.000Z",
          },
        ],
        items: [],
      },
      deliveries: [
        {
          effectId: "effect-1",
          deliveryKey: "delivery-1",
          targetRef: "kds:cozinha",
          operation: "dispatch",
          payload: JSON.stringify({ orderId: "order-1", stationId: "station-1" }),
          deliveredAt: "2026-08-11T20:00:01.000Z",
        },
      ],
    });

    expect(kds.tickets[0]?.deliveries).toEqual([
      { effectId: "effect-1", deliveryKey: "delivery-1" },
    ]);
    expect(kds.deliveries).toHaveLength(1);
    expect(() =>
      parseDurableKds({
        snapshot: { tickets: [], items: [] },
        deliveries: [
          {
            effectId: "effect-unknown",
            deliveryKey: "delivery-unknown",
            targetRef: "kds:cozinha",
            operation: "dispatch",
            payload: JSON.stringify({ orderId: "order-x", stationId: "station-x" }),
            deliveredAt: "2026-08-11T20:00:01.000Z",
          },
        ],
      }),
    ).toThrow(InvalidPilotPayloadError);
  });
});
