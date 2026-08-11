import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { BadRequestException } from "@nestjs/common";
import { assertNoSensitiveFiscalData } from "./fiscal.service.js";

function assertRejected(value: unknown) {
  assert.throws(
    () => assertNoSensitiveFiscalData(value),
    (error: unknown) =>
      error instanceof BadRequestException &&
      (error.getResponse() as { code?: string }).code === "CARD_DATA_FORBIDDEN",
  );
}

describe("fiscal document DLP", () => {
  it("rejects a PAN hidden in a generic note after separator normalization and Luhn", () => {
    assertRejected({ note: "Pagamento 4111 1111-1111 1111" });
  });

  it("rejects secret/token keys before inspecting scalar values", () => {
    assertRejected({ metadata: { token: "opaque-provider-value" } });
    assertRejected({ credentials: [{ apiSecret: "opaque-provider-value" }] });
  });

  it("recurses through arrays and rejects track data", () => {
    assertRejected({ observations: ["safe", ";4111111111111111=29121010000000000000?"] });
  });

  it("allows fiscal identifiers and words that merely contain sensitive substrings", () => {
    assert.doesNotThrow(() =>
      assertNoSensitiveFiscalData({
        cnpj: "12345678000190",
        pantryLocation: "Estoque seco",
        tokenizationStatus: "not_applicable",
        note: "Mesa 12 - pagamento presencial",
        items: [{ description: "Cerveja", quantity: 2 }],
      }),
    );
  });
});
