import { describe, expect, it } from "vitest";
import { isValidCounterPhone, parseCounterQueue } from "./CounterPage";
import { groupDraftItemsByCourse, parseStoredCart, parseStoredIds } from "./CounterWorkspace";

describe("atalhos e rascunho operacional", () => {
  it("restaura apenas itens e identificadores válidos", () => {
    expect(
      parseStoredCart(
        JSON.stringify([
          {
            id: "draft-1",
            productId: "product-1",
            name: "Executivo",
            quantity: 2,
            modifierOptionIds: [],
            course: "main",
          },
          { id: "invalid", quantity: 0 },
        ]),
      ),
    ).toEqual([
      {
        id: "draft-1",
        productId: "product-1",
        name: "Executivo",
        quantity: 2,
        modifierOptionIds: [],
        course: "main",
      },
    ]);
    expect(parseStoredIds(JSON.stringify(["a", "a", 3, "b"]))).toEqual(["a", "b"]);
  });

  it("separa etapas para permitir liberação independente na produção", () => {
    const items = parseStoredCart(
      JSON.stringify([
        {
          id: "1",
          productId: "p1",
          name: "Entrada",
          quantity: 1,
          modifierOptionIds: [],
          course: "starter",
        },
        {
          id: "2",
          productId: "p2",
          name: "Bebida",
          quantity: 2,
          modifierOptionIds: [],
          course: "anytime",
        },
        {
          id: "3",
          productId: "p3",
          name: "Principal",
          quantity: 1,
          modifierOptionIds: [],
          course: "main",
        },
        {
          id: "4",
          productId: "p4",
          name: "Outra entrada",
          quantity: 1,
          modifierOptionIds: [],
          course: "starter",
        },
      ]),
    );

    expect(groupDraftItemsByCourse(items).map((group) => group.map((item) => item.id))).toEqual([
      ["1", "4"],
      ["2"],
      ["3"],
    ]);
  });
});

describe("etapas do balcão", () => {
  const item = {
    id: "tab-1",
    tableId: null,
    operationalShiftId: null,
    shiftSectionId: null,
    label: "Retirada 12",
    displayNumber: 12,
    fulfillmentType: "pickup",
    customerName: "Ana",
    customerPhone: null,
    readyNotificationConsent: false,
    serviceNotes: null,
    deliveryAddress: null,
    promisedAt: null,
    readyNotifiedAt: null,
    responsibleIdentityId: null,
    structuralMergeAllowed: null,
    structuralMergeReason: null,
    guestCount: 1,
    version: 1,
    status: "open",
    serviceChargeBasisPoints: 0,
    tipCents: 0,
    subtotalCents: 1_000,
    discountCents: 0,
    serviceChargeCents: 0,
    totalCents: 1_000,
    queueStage: "ready",
  };

  it("consome etapa, contagens e paginação autoritativas", () => {
    const queue = parseCounterQueue({
      items: [item],
      counts: { all: 4, new: 1, production: 1, ready: 1, waiting: 1, delivered: 2, late: 0 },
      pagination: { page: 1, limit: 50, total: 4, totalPages: 1 },
    });

    expect(queue.items[0]?.queueStage).toBe("ready");
    expect(queue.counts).toMatchObject({ all: 4, delivered: 2 });
    expect(queue.pagination).toEqual({ page: 1, limit: 50, total: 4, totalPages: 1 });
  });

  it("rejeita etapa de fila fora do contrato", () => {
    expect(() =>
      parseCounterQueue({
        items: [{ ...item, queueStage: "unknown" }],
        counts: { all: 1, new: 0, production: 0, ready: 1, waiting: 0, delivered: 0, late: 0 },
        pagination: { page: 1, limit: 50, total: 1, totalPages: 1 },
      }),
    ).toThrow("formato inesperado");
  });
});

describe("telefone da retirada", () => {
  it("aceita o mesmo formato do backend e rejeita telefone incompleto", () => {
    expect(isValidCounterPhone("")).toBe(true);
    expect(isValidCounterPhone("+55 (11) 99999-9999")).toBe(true);
    expect(isValidCounterPhone("11999999999")).toBe(true);
    expect(isValidCounterPhone("1234")).toBe(false);
    expect(isValidCounterPhone("11 9999 RAMAL")).toBe(false);
  });
});
