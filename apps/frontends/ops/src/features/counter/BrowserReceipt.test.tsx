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
  it.each([
    "partial_statement",
    "final_receipt",
  ] as const)("mostra desconto agregado uma vez e separa serviço/gorjeta em %s", (documentType) => {
    const discounted = {
      ...payload,
      items: [{ ...payload.items[0], grossCents: 1800, discountCents: 300, netCents: 1500 }],
      totals: {
        ...payload.totals,
        discountCents: 300,
        serviceChargeCents: 150,
        tipCents: 200,
        totalCents: 1850,
        suggestedTotalCents: 1850,
      },
    };
    const html = renderToStaticMarkup(
      <BrowserReceipt documentType={documentType} payload={discounted} />,
    );
    const content = html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
    expect(content).toMatch(/2× Espresso R\$ 18,00/);
    expect(content).toMatch(/Subtotal R\$ 18,00 Descontos -R\$ 3,00/);
    expect(content.match(/Descontos/g)).toHaveLength(1);
    expect(content).toMatch(/Serviço opcional R\$ 1,50 Gorjeta R\$ 2,00/);
    expect(content).toContain(
      `${documentType === "partial_statement" ? "TOTAL SUGERIDO" : "TOTAL"} R$ 18,50`,
    );

    const removedService = renderToStaticMarkup(
      <BrowserReceipt
        documentType={documentType}
        payload={{
          ...discounted,
          totals: {
            ...discounted.totals,
            serviceChargeCents: 0,
            serviceChargeOptional: false,
            totalCents: 1700,
            suggestedTotalCents: 1700,
            serviceTaxNotice: null,
          },
        }}
      />,
    );
    expect(removedService).not.toContain("Serviço opcional");
    expect(removedService).not.toContain("TOTAL SUGERIDO");
    expect(removedService).toContain("Gorjeta");
  });

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
      "PRÉ-CONTA",
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
    expect(html).toContain("PEDIDO 42");
    expect(html).toContain("STATUS: Aberto");
  });

  const deliveryPayload = {
    ...payload,
    print: { isReprint: true },
    totals: { ...payload.totals, deliveryFeeCents: 700 },
    delivery: {
      orderId: "order-1",
      status: "dispatched",
      customerName: "Cliente Entrega",
      customerPhone: "(81) 99999-1234",
      address: {
        street: "Rua das Flores",
        number: "100",
        complement: "Apto 302",
        reference: "Portaria azul",
        neighborhood: "Boa Vista",
        city: "Recife",
        state: "PE",
        postalCode: "50050-000",
      },
      notes: "Chamar na portaria",
      promisedAt: "2026-08-22T23:00:00Z",
      courier: { name: "Entregador exemplo", reference: "courier-1", phone: "(81) 98888-4321" },
    },
  };

  it("imprime entrega completa, taxas e segunda via a partir do snapshot real", () => {
    const html = renderToStaticMarkup(
      <BrowserReceipt documentType="delivery_slip" payload={deliveryPayload} />,
    );
    for (const value of [
      "VIA DE ENTREGA",
      "SEGUNDA VIA",
      "Cliente Entrega",
      "99999-1234",
      "Rua das Flores",
      "100",
      "Apto 302",
      "Portaria azul",
      "Boa Vista",
      "Recife",
      "PE",
      "50050-000",
      "Chamar na portaria",
      "Entregador exemplo",
      "98888-4321",
      "Saiu para entrega",
      "PREVISÃO:",
      "20:00",
      "Taxa de entrega",
      "OBS_INTERNA",
      "Espresso",
      "Leite",
    ]) {
      expect(html).toContain(value);
    }
    expect(html).not.toContain("ALERGIA_INTERNA");
    expect(html).not.toContain("courier-1");
    expect(html).not.toContain("TEMPO DE CONSUMO");
  });

  it.each([
    "partial_statement",
    "payment_statement",
    "final_receipt",
  ] as const)("mantém dados da entrega fora da via financeira %s", (documentType) => {
    const html = renderToStaticMarkup(
      <BrowserReceipt documentType={documentType} payload={deliveryPayload} />,
    );
    for (const value of [
      "Cliente Entrega",
      "99999-1234",
      "Rua das Flores",
      "Portaria azul",
      "Chamar na portaria",
      "Entregador exemplo",
      "98888-4321",
      "OBS_INTERNA",
    ]) {
      expect(html).not.toContain(value);
    }
    expect(html).toContain("SEGUNDA VIA");
    expect(html).toContain("Pago");
    expect(html).toContain("Saldo");
  });

  it("omite cadastro e datas ausentes sem criar 1970 ou repetir o nome", () => {
    const html = renderToStaticMarkup(
      <BrowserReceipt
        documentType="partial_statement"
        payload={{
          establishment: { displayName: "Casa Giro", legalName: "Casa Giro" },
          context: { label: "Mesa 1" },
        }}
      />,
    );
    expect(html.match(/Casa Giro/g)).toHaveLength(1);
    for (const value of [
      "1970",
      "CNPJ:",
      "END:",
      "TEL:",
      "HORÁRIO:",
      "INÍCIO:",
      "IMPRESSO:",
      "TEMPO DE CONSUMO:",
    ]) {
      expect(html).not.toContain(value);
    }
  });

  it("aceita fila legada e fuso inválido sem quebrar a impressão", () => {
    const legacy = {
      establishmentName: "Casa Giro",
      establishment: { timezone: "invalid/zone", logoUrl: "javascript:alert(1)" },
      tab: { label: "Mesa 9", fulfillmentType: "takeaway" },
      generatedAt: "2026-09-18T18:00:00Z",
    };
    const html = renderToStaticMarkup(
      <BrowserReceipt documentType="partial_statement" payload={legacy} />,
    );
    expect(html).toContain("Casa Giro");
    expect(html).toContain("Mesa 9");
    expect(html).toContain("Retirada");
    expect(html).not.toContain("javascript:");
    expect(html).not.toContain("Invalid Date");
  });

  it("exibe pagamentos pelo líquido depois do estorno", () => {
    const result = normalizeBrowserReceiptPayload({
      payments: [
        { amountCents: 1000, reversedCents: 200 },
        { amountCents: 3000, netAmountCents: 1500 },
        { amountCents: 2000, reversedCents: 2000 },
      ],
    });
    expect(result.payments.map((payment) => payment.amountCents)).toEqual([800, 1500, 0]);
  });

  it.each([
    "partial_statement",
    "payment_statement",
    "final_receipt",
  ] as const)("imprime o dinheiro recebido e troco persistidos em %s sem somá-los ao saldo", (documentType) => {
    const html = renderToStaticMarkup(
      <BrowserReceipt
        documentType={documentType}
        payload={{
          ...payload,
          totals: { ...payload.totals, totalCents: 10000, paidCents: 5000, remainingCents: 5000 },
          payments: [{ method: "cash", amountCents: 5000, receivedCents: 7000, changeCents: 2000 }],
        }}
      />,
    );
    const content = html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
    expect(content).toContain("Dinheiro R$ 50,00 Recebido em dinheiro R$ 70,00 Troco R$ 20,00");
    expect(content).toContain("Pago R$ 50,00 Saldo R$ 50,00");
  });

  it.each([2000, 5000])("preserva a troca original ao estornar %i centavos", (reversedCents) => {
    const netAmountCents = 5000 - reversedCents;
    const html = renderToStaticMarkup(
      <BrowserReceipt
        documentType="payment_statement"
        payload={{
          payments: [
            {
              method: "cash",
              amountCents: netAmountCents,
              netAmountCents,
              reversedCents,
              receivedCents: 7000,
              changeCents: 2000,
            },
          ],
          totals: { paidCents: netAmountCents, remainingCents: reversedCents },
        }}
      />,
    );
    const content = html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
    expect(content).toContain(
      `Dinheiro (líquido) R$ ${netAmountCents / 100},00 Estornado R$ ${reversedCents / 100},00`,
    );
    expect(content).toContain("Recebimento original Recebido em dinheiro R$ 70,00 Troco R$ 20,00");
  });

  it.each([
    {},
    { receivedCents: null, changeCents: null },
    { receivedCents: 7000 },
    { changeCents: 2000 },
    { receivedCents: "7000", changeCents: 2000 },
    { receivedCents: 7000.1, changeCents: 2000.1 },
    { receivedCents: 5000, changeCents: -1 },
    { receivedCents: 7000, changeCents: 1000 },
    { method: "pix", receivedCents: 7000, changeCents: 2000 },
  ])("omite troca ausente ou inválida sem inventar troco zero: %j", (cashFields) => {
    const html = renderToStaticMarkup(
      <BrowserReceipt
        documentType="final_receipt"
        payload={{
          payments: [
            {
              method: "cash",
              amountCents: 5000,
              reference: "Recebido 70; troco 20",
              ...cashFields,
            },
          ],
        }}
      />,
    );
    expect(html).not.toContain("Recebido em dinheiro");
    expect(html).not.toContain("Troco");
  });

  it("imprime troco zero somente quando registrado", () => {
    const html = renderToStaticMarkup(
      <BrowserReceipt
        documentType="final_receipt"
        payload={{
          payments: [{ method: "cash", amountCents: 5000, receivedCents: 5000, changeCents: 0 }],
        }}
      />,
    );
    expect(html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ")).toContain("Troco R$ 0,00");
  });
});
