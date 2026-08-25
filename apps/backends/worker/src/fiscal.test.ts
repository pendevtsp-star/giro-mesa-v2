import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  assertFiscalRuntimeEnvironment,
  buildNfcePayload,
  FiscalDeliveryError,
  nextFiscalStatus,
  parseFocusDocument,
} from "./fiscal.js";

describe("fiscal NFC-e", () => {
  it("derives items and payments from the persisted sale snapshot", () => {
    const payload = buildNfcePayload({
      issuerDocument: "12abc34501de35",
      issuedAt: new Date("2026-08-21T12:00:00.000Z"),
      buyerPresence: 1,
      totalCents: 1_150,
      extraCents: 150,
      lines: [
        {
          id: "item",
          productId: "product",
          productName: "Almoço",
          sku: "SKU-1",
          quantity: 1,
          unitPriceCents: 1_000,
          grossCents: 1_000,
          discountCents: 0,
          netCents: 1_000,
          revisionId: "revision",
          classification: {
            ncm: "21069090",
            cfop: "5102",
            origin: 0,
            csosn: "102",
            cstPis: "49",
            cstCofins: "49",
            cstIbsCbs: "000",
            cClassTrib: "000001",
          },
        },
      ],
      payments: [{ method: "pix", amountCents: 1_150 }],
    });
    assert.equal(payload.items[0]?.valor_outras_despesas, 1.5);
    assert.equal(payload.cnpj_emitente, "12ABC34501DE35");
    assert.equal(payload.items[0]?.ibs_cbs_situacao_tributaria, "000");
    assert.equal(payload.items[0]?.ibs_cbs_classificacao_tributaria, "000001");
    assert.deepEqual(payload.formas_pagamento, [{ forma_pagamento: "17", valor_pagamento: 11.5 }]);
    assert.equal(
      parseFocusDocument({ status: "autorizado", valor_total_tributos: "1,23" }).taxCents,
      123,
    );
  });

  it("rejects incomplete tax classifications before delivery", () => {
    assert.throws(
      () =>
        buildNfcePayload({
          issuerDocument: "12345678000123",
          issuedAt: new Date(),
          buyerPresence: 1,
          totalCents: 100,
          extraCents: 0,
          lines: [
            {
              id: "item",
              productId: "product",
              productName: "Produto",
              sku: null,
              quantity: 1,
              unitPriceCents: 100,
              grossCents: 100,
              discountCents: 0,
              netCents: 100,
              revisionId: "revision",
              classification: { ncm: "21069090", cfop: "5102", origin: 0 },
            },
          ],
          payments: [{ method: "cash", amountCents: 100 }],
        }),
      (error) =>
        error instanceof FiscalDeliveryError &&
        error.code === "FISCAL_PRODUCT_CLASSIFICATION_INCOMPLETE",
    );
  });

  it("requires IBS/CBS codes in pairs", () => {
    assert.throws(
      () =>
        buildNfcePayload({
          issuerDocument: "12345678000123",
          issuedAt: new Date("2026-08-21T12:00:00.000Z"),
          buyerPresence: 1,
          totalCents: 1_000,
          extraCents: 0,
          lines: [
            {
              id: "line-1",
              productId: "product-1",
              productName: "Produto",
              sku: null,
              revisionId: "revision-1",
              quantity: 1,
              unitPriceCents: 1_000,
              grossCents: 1_000,
              discountCents: 0,
              netCents: 1_000,
              classification: {
                ncm: "21069090",
                cfop: "5102",
                origin: 0,
                csosn: "102",
                cstPis: "49",
                cstCofins: "49",
                cstIbsCbs: "000",
              },
            },
          ],
          payments: [{ method: "pix", amountCents: 1_000 }],
        }),
      (error) =>
        error instanceof FiscalDeliveryError &&
        error.code === "FISCAL_IBS_CBS_CLASSIFICATION_INCOMPLETE",
    );
  });

  it("rejects an invalid issuer document before delivery", () => {
    assert.throws(
      () =>
        buildNfcePayload({
          issuerDocument: "123",
          issuedAt: new Date(),
          buyerPresence: 1,
          totalCents: 0,
          extraCents: 0,
          lines: [],
          payments: [],
        }),
      (error) =>
        error instanceof FiscalDeliveryError && error.code === "FISCAL_ISSUER_DOCUMENT_INVALID",
    );
  });

  it("fails closed in production and keeps terminal document states monotonic", () => {
    assert.throws(
      () => assertFiscalRuntimeEnvironment("production", "homologation"),
      (error) =>
        error instanceof FiscalDeliveryError &&
        error.code === "FISCAL_PRODUCTION_RELEASE_BLOCKED" &&
        !error.retryable,
    );
    assert.doesNotThrow(() => assertFiscalRuntimeEnvironment("production", "production"));
    assert.equal(nextFiscalStatus("authorized", "rejected"), "authorized");
    assert.equal(nextFiscalStatus("authorized", "canceled"), "canceled");
    assert.equal(nextFiscalStatus("canceled", "authorized"), "canceled");
  });
});
