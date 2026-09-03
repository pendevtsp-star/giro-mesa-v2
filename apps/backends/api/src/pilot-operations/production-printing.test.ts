import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  createProductionPrinterSchema,
  productionPrinterConnectionProbeInputSchema,
  productionPrintPolicyInputSchema,
} from "@giromesa/contracts";
import { isPrivatePrinterAddress } from "./production-printing.service.js";

const printer = {
  hubId: crypto.randomUUID(),
  label: "Cozinha",
  host: "192.168.1.42",
  port: 9100,
  paperWidthMm: 80,
  charactersPerLine: 48,
  codeTable: 16,
  cut: true,
  supportsRasterGraphics: false,
  isDefault: true,
  documentTypes: ["kds_ticket"],
  fallbackPrinterId: null,
  active: true,
} as const;

describe("production printing contracts", () => {
  it("accepts private, link-local and loopback IP literals only", () => {
    assert.equal(isPrivatePrinterAddress("10.1.2.3"), true);
    assert.equal(isPrivatePrinterAddress("172.31.0.9"), true);
    assert.equal(isPrivatePrinterAddress("192.168.44.20"), true);
    assert.equal(isPrivatePrinterAddress("127.0.0.1"), true);
    assert.equal(isPrivatePrinterAddress("169.254.20.9"), true);
    assert.equal(isPrivatePrinterAddress("fd12:3456:789a::42"), true);
    assert.equal(isPrivatePrinterAddress("::1"), true);
    assert.equal(isPrivatePrinterAddress("fe80::1"), true);
    assert.equal(isPrivatePrinterAddress("::ffff:192.168.1.42"), true);
    assert.equal(isPrivatePrinterAddress("::ffff:c0a8:012a"), true);
    assert.equal(isPrivatePrinterAddress("8.8.8.8"), false);
    assert.equal(isPrivatePrinterAddress("::ffff:8.8.8.8"), false);
    assert.equal(isPrivatePrinterAddress("2001:4860:4860::8888"), false);
    assert.equal(isPrivatePrinterAddress("printer.local"), false);
  });

  it("keeps station routing out of printer writes and requires an explicit Hub", () => {
    assert.equal(createProductionPrinterSchema.safeParse(printer).success, true);
    assert.equal(
      createProductionPrinterSchema.safeParse({ ...printer, hubId: undefined }).success,
      false,
    );
    assert.equal(
      createProductionPrinterSchema.safeParse({ ...printer, stationIds: [crypto.randomUUID()] })
        .success,
      false,
    );
  });

  it("requires a bounded connection probe target", () => {
    assert.equal(
      productionPrinterConnectionProbeInputSchema.safeParse({
        hubId: printer.hubId,
        host: printer.host,
        port: printer.port,
      }).success,
      true,
    );
    assert.equal(
      productionPrinterConnectionProbeInputSchema.safeParse({
        hubId: printer.hubId,
        host: printer.host,
        port: 0,
      }).success,
      false,
    );
  });

  it("requires a printer only for automatic printer delivery modes", () => {
    const printerId = crypto.randomUUID();
    assert.equal(
      productionPrintPolicyInputSchema.safeParse({
        deliveryMode: "printer_only",
        copies: 2,
        printerId,
      }).success,
      true,
    );
    assert.equal(
      productionPrintPolicyInputSchema.safeParse({
        deliveryMode: "both",
        copies: 1,
        printerId: null,
      }).success,
      false,
    );
    assert.equal(
      productionPrintPolicyInputSchema.safeParse({
        deliveryMode: "kds_only",
        copies: 1,
        printerId: null,
      }).success,
      true,
    );
    assert.equal(
      productionPrintPolicyInputSchema.safeParse({
        deliveryMode: "disabled",
        copies: 1,
        printerId,
      }).success,
      false,
    );
  });
});
