import { describe, expect, it } from "vitest";
import { fiscalTaxCsvTemplate, parseFiscalTaxCsv } from "./fiscal-csv";

describe("CSV de classificação fiscal", () => {
  it("preserva campos com vírgula e valida cada produto", () => {
    const template = [
      "productId,productName,category,ncm,cfop,origin,csosn,cstIcms,cstPis,cstCofins,cstIbsCbs,cClassTrib,effectiveFrom",
      'product-1,"Arroz, feijão",Pratos,21069090,5102,0,102,,49,49,000,000001,2026-08-21',
    ].join("\n");
    const rows = parseFiscalTaxCsv(template, new Set(["product-1"]));
    expect(rows[0]).toMatchObject({
      productId: "product-1",
      effectiveFrom: "2026-08-21",
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
    });
  });

  it("rejeita produto fora da unidade", () => {
    expect(() =>
      parseFiscalTaxCsv(
        "productId,ncm,cfop,origin,cstPis,cstCofins,effectiveFrom\nother,21069090,5102,0,49,49,2026-08-21",
        new Set(["product-1"]),
      ),
    ).toThrow("produto inválido");
  });

  it("neutraliza fórmulas em nomes exportados", () => {
    expect(
      fiscalTaxCsvTemplate(
        [{ id: "product-1", name: "=IMPORTXML()", categoryName: "Pratos" }],
        "2026-08-21",
      ),
    ).toContain("'=IMPORTXML()");
  });
});
