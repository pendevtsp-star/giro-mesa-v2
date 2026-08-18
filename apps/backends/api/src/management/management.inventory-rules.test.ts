import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  assertIncidentTransition,
  assessInventoryRisk,
  cycleCountPolicy,
  forecastInventoryDemand,
  NfeParseError,
  parseNfe,
  replenishmentSuggestion,
  returnableAging,
  suggestNfeLineMatch,
  supplierPerformance,
} from "./management.inventory-rules.js";

const xml = `<?xml version="1.0"?><nfeProc><NFe><infNFe Id="NFe35260811222333000144550010000000421123456782"><ide><mod>55</mod><serie>1</serie><nNF>42</nNF><dhEmi>2026-08-15T10:00:00-03:00</dhEmi></ide><emit><CNPJ>11222333000144</CNPJ><xNome>Fornecedor</xNome></emit><dest><CNPJ>99888777000166</CNPJ></dest><det nItem="1"><prod><cProd>ABC</cProd><cEAN>7891234567890</cEAN><xProd>Cerveja 600 ml</xProd><uCom>UN</uCom><qCom>2.0000</qCom><vUnCom>5.5000</vUnCom><vProd>11.00</vProd></prod></det><total><ICMSTot><vTotTrib>1.10</vTotTrib><vNF>11.00</vNF></ICMSTot></total></infNFe></NFe></nfeProc>`;

describe("NF-e inventory rules", () => {
  it("parses text or base64 without accepting external entities", () => {
    const parsed = parseNfe(Buffer.from(xml).toString("base64"));
    assert.equal(parsed.documentNumber, "42");
    assert.equal(parsed.lines[0]?.quantity, "2.000");
    assert.equal(parsed.lines[0]?.unitCostCents, 550);
    assert.equal(parsed.totalCents, 1_100);
    assert.equal(parsed.series, "1");
    assert.equal(parsed.model, "55");
    assert.equal(parsed.taxTotalCents, 110);
    assert.throws(() => parseNfe(xml.replace("56782", "56781")), NfeParseError);
    assert.throws(
      () =>
        parseNfe(
          xml.replace(
            "<nfeProc>",
            '<!DOCTYPE x [<!ENTITY e SYSTEM "file:///etc/passwd">]><nfeProc>',
          ),
        ),
      NfeParseError,
    );
  });

  it("prefers the stable supplier alias before GTIN and marks unknown items as new", () => {
    assert.deepEqual(
      suggestNfeLineMatch(
        { supplierProductCode: "ABC", barcode: "789" },
        [{ inventoryItemId: "alias", supplierProductCode: "ABC", supplierBarcode: null }],
        [{ id: "gtin", barcode: "789" }],
      ),
      { inventoryItemId: "alias", matchType: "supplier_alias" },
    );
    assert.equal(
      suggestNfeLineMatch({ supplierProductCode: "X", barcode: null }, [], []).matchType,
      "new",
    );
  });

  it("only allows a pending returnable incident to be reviewed once", () => {
    assert.equal(assertIncidentTransition("pending", "approved"), "approved");
    assert.throws(() => assertIncidentTransition("approved", "rejected"), /ALREADY_REVIEWED/);
  });

  it("classifies risky adjustments and accounts for open purchases in replenishment", () => {
    assert.equal(
      assessInventoryRisk({
        type: "count",
        previousQuantity: 100,
        requestedQuantity: 70,
        unitCostCents: 500,
      }).requiresApproval,
      true,
    );
    assert.deepEqual(
      replenishmentSuggestion({
        currentQuantity: 5,
        minimumQuantity: 10,
        reorderQuantity: 12,
        purchaseToStockFactor: 6,
        leadTimeDays: 2,
        consumedLast30Days: 30,
        outstandingStockQuantity: 6,
      }).purchaseQuantity,
      2,
    );
  });

  it("ages remaining returnable custody using FIFO and preserves deposit exposure", () => {
    const result = returnableAging(
      [
        { quantityDelta: 4, occurredAt: new Date("2026-08-01T00:00:00Z"), depositCents: 200 },
        { quantityDelta: -3, occurredAt: new Date("2026-08-02T00:00:00Z") },
        { quantityDelta: 2, occurredAt: new Date("2026-08-10T00:00:00Z"), depositCents: 300 },
      ],
      new Date("2026-08-17T00:00:00Z"),
    );
    assert.equal(result.ageDays, 16);
    assert.equal(result.depositExposureCents, 800);
  });

  it("prioritizes cycle counts and forecasts demand without hiding commitments", () => {
    assert.deepEqual(
      cycleCountPolicy({
        inventoryValueCents: 120_000,
        movementCount90Days: 100,
        divergencePercent: 12,
        expiresWithinDays: 5,
      }),
      { classification: "A", riskScore: 87, frequencyDays: 7 },
    );
    const forecast = forecastInventoryDemand({
      dailyUsage: Array.from({ length: 14 }, (_, index) => ({
        date: `2026-08-${String(index + 1).padStart(2, "0")}`,
        quantity: 2,
      })),
      horizonDays: 7,
      currentQuantity: 20,
      reservedQuantity: 8,
      outstandingPurchaseQuantity: 1,
      from: new Date("2026-08-17T00:00:00Z"),
    });
    assert.equal(forecast.forecastQuantity, 14);
    assert.equal(forecast.availableQuantity, 12);
    assert.equal(forecast.netRequiredQuantity, 1);
    assert.equal(
      supplierPerformance({
        orderedQuantity: 100,
        receivedQuantity: 90,
        completedOrders: 4,
        onTimeOrders: 3,
        invoices: 5,
        divergentInvoices: 1,
        previousAverageCostCents: 100,
        currentAverageCostCents: 110,
      }).fillRatePercent,
      90,
    );
  });
});
