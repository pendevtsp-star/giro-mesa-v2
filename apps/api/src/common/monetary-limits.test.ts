import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { fiscalIssueSchema } from "../fiscal/fiscal.schemas.js";
import { incidentReportSchema } from "../incidents/incidents.schemas.js";
import { purchaseOrderSchema } from "../management/management.schemas.js";
import { remunerationAdjustmentSchema } from "../management/remuneration.schemas.js";
import { paymentIntentSchema } from "../payments/payments.schemas.js";
import { createReturnableAssetSchema } from "../returnables/returnables.schemas.js";

const INT4_OVERFLOW = 2_147_483_648;

describe("PostgreSQL monetary boundaries", () => {
  it("rejects direct cent values that cannot be persisted in integer columns", () => {
    assert.equal(
      paymentIntentSchema.safeParse({
        sourceType: "order",
        sourceId: "order-1",
        amountCents: INT4_OVERFLOW,
      }).success,
      false,
    );
    assert.equal(
      fiscalIssueSchema.safeParse({
        saleReference: "sale-1",
        documentType: "nfce",
        totalCents: INT4_OVERFLOW,
        document: {},
      }).success,
      false,
    );
    assert.equal(
      incidentReportSchema.safeParse({
        incidentType: "inventory_variance",
        neutralSummary: "Contagem física divergiu do saldo registrado.",
        evidence: [],
        amountCents: INT4_OVERFLOW,
        occurredAt: "2026-08-11T20:00:00.000Z",
      }).success,
      false,
    );
    assert.equal(
      createReturnableAssetSchema.safeParse({
        sku: "CRATE",
        name: "Engradado",
        trackingMode: "aggregate",
        depositCents: INT4_OVERFLOW,
        serialNumbers: [],
      }).success,
      false,
    );
    assert.equal(
      remunerationAdjustmentSchema.safeParse({
        amountCents: INT4_OVERFLOW,
        reason: "Ajuste documentado após o fechamento financeiro.",
        sourceReferences: ["document:1"],
        recipient: { reference: "person-1", label: "Pessoa 1" },
      }).success,
      false,
    );
  });

  it("rejects a purchase order whose valid-looking line would overflow its persisted total", () => {
    assert.equal(
      purchaseOrderSchema.safeParse({
        supplierId: "00000000-0000-4000-8000-000000000001",
        items: [
          {
            inventoryItemId: "00000000-0000-4000-8000-000000000002",
            quantity: "2",
            unitCostCents: 2_000_000_000,
          },
        ],
      }).success,
      false,
    );
  });
});
