import assert from "node:assert/strict";
import test from "node:test";
import {
  publicOrderLines,
  readPublicOrderOptions,
  readPublicOrderReceipt,
} from "./public-order.ts";

test("aceita somente opções persistidas e pagamento no recebimento", () => {
  assert.deepEqual(
    readPublicOrderOptions({
      fulfillment: { pickup: true, delivery: true },
      deliveryZones: [{ name: "Centro", feeCents: 700, minimumOrderCents: 3_000 }],
      payment: {
        method: "pay_on_fulfillment",
        status: "awaiting_payment",
        label: "Pagamento na entrega",
      },
    })?.deliveryZones,
    [{ name: "Centro", feeCents: 700, minimumOrderCents: 3_000 }],
  );
  assert.equal(
    readPublicOrderOptions({
      fulfillment: { pickup: true, delivery: true },
      deliveryZones: [],
      payment: { method: "credit_card", status: "paid", label: "Pago" },
    }),
    null,
  );
});

test("valida protocolo, total e estado real do recibo", () => {
  assert.equal(
    readPublicOrderReceipt({
      protocol: "GM-20260810-ABCDEF1234",
      status: "placed",
      fulfillment: "delivery",
      payment: { method: "pay_on_fulfillment", status: "awaiting_payment" },
      subtotalCents: 5_000,
      deliveryFeeCents: 700,
      totalCents: 5_700,
    })?.totalCents,
    5_700,
  );
  assert.equal(
    readPublicOrderReceipt({
      protocol: "tab-interno",
      status: "placed",
      fulfillment: "pickup",
      payment: { method: "pay_on_fulfillment", status: "awaiting_payment" },
      subtotalCents: 5_000,
      deliveryFeeCents: 0,
      totalCents: 5_000,
    }),
    null,
  );
});

test("envia somente referências e quantidades para o servidor recalcular preços", () => {
  assert.deepEqual(
    publicOrderLines([
      {
        lineId: "linha-local",
        item: {
          id: "5e801d8a-0dca-4e68-944b-9cf970a45f98",
          category: "Pratos",
          name: "Executivo",
          description: "Descrição exibida",
          priceCents: 1,
          visual: "plate",
          available: true,
        },
        quantity: 2,
        modifiers: [
          {
            id: "888a3a50-fe2e-49c4-a575-6656e704ac57",
            name: "Adicional exibido",
            priceCents: 1,
          },
        ],
        notes: "Sem cebola",
      },
    ]),
    [
      {
        productId: "5e801d8a-0dca-4e68-944b-9cf970a45f98",
        quantity: 2,
        modifierOptionIds: ["888a3a50-fe2e-49c4-a575-6656e704ac57"],
        notes: "Sem cebola",
      },
    ],
  );
});
