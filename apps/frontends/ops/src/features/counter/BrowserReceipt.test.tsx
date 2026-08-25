import type { PrintDocumentPayloadV2 } from "@giromesa/contracts";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { BrowserReceipt, normalizeBrowserReceiptPayload } from "./BrowserReceipt";

const payload = {
  schemaVersion: 2,
  generatedAt: "2026-08-22T22:30:00.000Z",
  establishment: {
    displayName: "Giro Bistrô",
    legalName: "Giro Bistrô Ltda.",
    document: "12.345.678/0001-90",
    address: "Rua Central, 10",
    phone: "(11) 99999-0000",
    openingHours: "Ter–Dom, 18h–23h",
    timezone: "America/Sao_Paulo",
    logoUrl: "https://cdn.example.com/logo.png",
  },
  context: {
    tabId: "tab-1",
    label: "Mesa 8",
    displayNumber: 42,
    tableLabel: "Mesa 8",
    areaName: "Salão principal",
    squareName: "Praça Azul",
    waiterDisplayName: "Ana",
    fulfillmentType: "dine_in",
    guestCount: 2,
    status: "open",
    openedAt: "2026-08-22T21:00:00.000Z",
    closedAt: null,
    durationMinutes: 90,
  },
  totals: {
    subtotalCents: 1800,
    discountCents: 0,
    serviceChargeCents: 180,
    serviceChargeBasisPoints: 1000,
    serviceChargeOptional: true,
    suggestedTotalCents: 1980,
    serviceTaxNotice: "Serviço sugerido e opcional.",
    tipCents: 0,
    totalCents: 1980,
    grossPaidCents: 990,
    reversedCents: 0,
    paidCents: 990,
    remainingCents: 990,
  },
  items: [
    {
      id: "item-1",
      orderId: "order-1",
      productName: "Espresso",
      quantity: 2,
      unitPriceCents: 700,
      modifiersCents: 400,
      grossCents: 1800,
      discountCents: 0,
      netCents: 1800,
      status: "active",
      seatNumber: 1,
      course: "anytime",
      modifiers: [{ name: "Leite", quantity: 2, unitDeltaCents: 200, totalDeltaCents: 400 }],
      allergyNote: "ALERGIA_INTERNA",
      notes: "OBS_INTERNA",
    },
  ],
  payments: [
    {
      id: "payment-1",
      method: "pix",
      amountCents: 990,
      financialStatus: "posted",
      createdAt: "2026-08-22T22:00:00.000Z",
    },
  ],
  split: {
    splitId: "split-1",
    partNumber: 1,
    partCount: 2,
    amountCents: 990,
    balanceSnapshotCents: 1980,
    method: "equal_people",
  },
  customerName: "CLIENTE_INTERNO",
} as unknown as PrintDocumentPayloadV2 & Record<string, unknown>;

describe("BrowserReceipt", () => {
  it("mantém o snapshot v2 e a ordem canônica sem dados internos", () => {
    const normalized = normalizeBrowserReceiptPayload(payload);
    expect([
      normalized.schemaVersion,
      normalized.establishment.displayName,
      normalized.context.label,
      normalized.items[0]?.productName,
      normalized.items[0]?.modifiers[0]?.name,
      normalized.totals.totalCents,
      normalized.split?.method,
      normalized.payments[0]?.method,
    ]).toMatchInlineSnapshot(`
      [
        2,
        "Giro Bistrô",
        "Mesa 8",
        "Espresso",
        "Leite",
        1980,
        "equal_people",
        "pix",
      ]
    `);

    const html = renderToStaticMarkup(
      <BrowserReceipt documentType="partial_statement" payload={payload} />,
    );
    const orderedMarkers = [
      "Giro Bistrô",
      "EXTRATO PARCIAL",
      "Mesa 8",
      "INÍCIO:",
      "2× Espresso",
      "+ 2× Leite",
      "Subtotal",
      "DIVISÃO DA CONTA",
      "PARTE 1 DE 2",
      "PAGAMENTOS",
      "Pago",
      "NÃO É DOCUMENTO FISCAL",
    ].map((marker) => html.indexOf(marker));

    expect(orderedMarkers.every((position) => position >= 0)).toBe(true);
    expect(orderedMarkers).toEqual([...orderedMarkers].sort((left, right) => left - right));
    expect(html).not.toContain("CLIENTE_INTERNO");
    expect(html).not.toContain("ALERGIA_INTERNA");
    expect(html).not.toContain("OBS_INTERNA");
  });
});
