import { describe, expect, it } from "vitest";
import { counterQueueStage, sortCounterQueue } from "./CounterPage";
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
  const now = new Date("2026-08-16T18:00:00.000Z").getTime();

  it("prioriza atraso, prontidão, espera e encerramento", () => {
    expect(
      counterQueueStage(
        {
          status: "open",
          totalCents: 1000,
          promisedAt: "2026-08-16T17:59:00.000Z",
          readyNotifiedAt: null,
        },
        now,
      ),
    ).toBe("late");
    expect(
      counterQueueStage(
        {
          status: "open",
          totalCents: 1000,
          promisedAt: null,
          readyNotifiedAt: "2026-08-16T17:59:00.000Z",
        },
        now,
      ),
    ).toBe("ready");
    expect(
      counterQueueStage(
        {
          status: "open",
          totalCents: 1000,
          promisedAt: null,
          readyNotifiedAt: "2026-08-16T17:50:00.000Z",
        },
        now,
      ),
    ).toBe("waiting");
    expect(
      counterQueueStage(
        { status: "closed", totalCents: 1000, promisedAt: null, readyNotifiedAt: null },
        now,
      ),
    ).toBe("delivered");
  });

  it("ordena primeiro o que exige ação imediata", () => {
    const tabs = [
      {
        id: "production",
        status: "open",
        totalCents: 1000,
        promisedAt: null,
        readyNotifiedAt: null,
      },
      {
        id: "ready",
        status: "open",
        totalCents: 1000,
        promisedAt: null,
        readyNotifiedAt: "2026-08-16T17:59:00.000Z",
      },
      {
        id: "late",
        status: "open",
        totalCents: 1000,
        promisedAt: "2026-08-16T17:50:00.000Z",
        readyNotifiedAt: null,
      },
    ];

    expect(sortCounterQueue(tabs, now).map((tab) => tab.id)).toEqual([
      "late",
      "ready",
      "production",
    ]);
  });
});
