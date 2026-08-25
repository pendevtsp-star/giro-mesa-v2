import assert from "node:assert/strict";
import test from "node:test";
import type { CartItem } from "./menu.ts";
import {
  classifyPublicFailure,
  isTableOrderId,
  readPresenceChallenge,
  readTableConsumption,
  readTableOrder,
  readTableSession,
  tableOrderLines,
  tableSessionCapabilities,
} from "./table-session.ts";

test("aceita somente UUID de pedido para restaurar o acompanhamento", () => {
  assert.equal(isTableOrderId("00000000-0000-4000-8000-000000000001"), true);
  assert.equal(isTableOrderId("------------------------------------"), false);
  assert.equal(isTableOrderId(null), false);
});

test("aceita apenas sessão de mesa curta e explícita", () => {
  assert.deepEqual(
    readTableSession({
      status: "active",
      tableLabel: " Mesa 12 ",
      activeTab: true,
      expiresAt: "2026-08-24T18:00:00.000Z",
      organizationId: "não deve vazar",
    }),
    {
      status: "active",
      tableLabel: "Mesa 12",
      activeTab: true,
      expiresAt: "2026-08-24T18:00:00.000Z",
    },
  );
  assert.deepEqual(
    readTableSession({
      status: "awaiting_tab",
      tableLabel: "Mesa 12",
      activeTab: false,
      expiresAt: "2026-08-24T18:00:00.000Z",
    }),
    {
      status: "awaiting_tab",
      tableLabel: "Mesa 12",
      activeTab: false,
      expiresAt: "2026-08-24T18:00:00.000Z",
    },
  );
  assert.equal(
    readTableSession({
      status: "awaiting_tab",
      tableLabel: "Mesa 12",
      activeTab: true,
      expiresAt: "2026-08-24T18:00:00.000Z",
    }),
    null,
  );
  assert.equal(readTableSession({ tableLabel: "Mesa 12", activeTab: true }), null);
});

test("aceita somente o desafio público de presença esperado", () => {
  assert.deepEqual(
    readPresenceChallenge({
      code: "PUBLIC_TABLE_PRESENCE_CODE_REQUIRED",
      tableLabel: " Mesa 12 ",
      message: "Informe o código.",
    }),
    { tableLabel: "Mesa 12", message: "Informe o código." },
  );
  assert.equal(readPresenceChallenge({ code: "INTERNAL_ERROR", stack: "não vazar" }), null);
});

test("mantém somente atendimento e cardápio antes da abertura da comanda", () => {
  assert.deepEqual(tableSessionCapabilities(false), {
    callWaiter: true,
    requestCheck: false,
    viewConsumption: false,
    placeOrder: false,
  });
  assert.deepEqual(tableSessionCapabilities(true), {
    callWaiter: true,
    requestCheck: true,
    viewConsumption: true,
    placeOrder: true,
  });
});

test("normaliza somente consumo sanitizado em centavos", () => {
  assert.deepEqual(
    readTableConsumption({
      status: "open",
      tableLabel: " Mesa 12 ",
      items: [{ name: "Água", quantity: 2, totalCents: 1_400, productId: "interno" }],
      subtotalCents: 1_400,
      totalCents: 1_540,
    }),
    {
      status: "open",
      tableLabel: "Mesa 12",
      items: [{ name: "Água", quantity: 2, totalCents: 1_400 }],
      subtotalCents: 1_400,
      totalCents: 1_540,
    },
  );
  assert.equal(
    readTableConsumption({
      status: "open",
      tableLabel: "Mesa 12",
      items: [{ name: "Água", quantity: 0, totalCents: 0 }],
      subtotalCents: 0,
      totalCents: 0,
    }),
    null,
  );
});

test("pedido da mesa envia somente produtos, adicionais e observação", () => {
  const cart: CartItem[] = [
    {
      lineId: "local",
      item: {
        id: "produto-1",
        category: "Pratos",
        name: "Prato",
        description: "Descrição",
        priceCents: 2_000,
        visual: "",
        available: true,
      },
      quantity: 2,
      modifiers: [{ id: "adicional-1", name: "Molho", priceCents: 100 }],
      notes: "Sem cebola",
    },
  ];
  assert.deepEqual(tableOrderLines(cart), [
    {
      productId: "produto-1",
      quantity: 2,
      modifierOptionIds: ["adicional-1"],
      notes: "Sem cebola",
    },
  ]);
  assert.deepEqual(
    readTableOrder({
      orderId: "pedido-1",
      status: "draft",
      source: "qr_table",
      items: [{ name: "Prato", quantity: 2, totalCents: 4_200 }],
      totalCents: 4_200,
      internal: true,
    }),
    {
      orderId: "pedido-1",
      status: "draft",
      items: [{ name: "Prato", quantity: 2, totalCents: 4_200 }],
      totalCents: 4_200,
    },
  );
  assert.equal(
    readTableOrder({ orderId: "pedido-1", status: "approved", items: [], totalCents: 0 }),
    null,
  );
});

test("classifica falhas públicas sem confundir sessão com indisponibilidade", () => {
  assert.equal(classifyPublicFailure(401), "session");
  assert.equal(classifyPublicFailure(409), "conflict");
  assert.equal(classifyPublicFailure(429), "rate_limit");
  assert.equal(classifyPublicFailure(503), "unavailable");
});
