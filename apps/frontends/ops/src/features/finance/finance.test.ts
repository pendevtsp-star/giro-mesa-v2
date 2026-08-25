import { describe, expect, it } from "vitest";
import { parseReconciliationFile } from "./finance";

describe("importação de conciliação financeira", () => {
  it("normaliza CSV brasileiro e OFX sem inventar vínculo interno", () => {
    expect(
      parseReconciliationFile(
        "extrato.csv",
        "referência;valor;taxa;direção\npix-1;1.234,56;4,56;receber",
      )[0],
    ).toEqual({
      paymentDirection: "receivable",
      externalKey: "pix-1",
      grossCents: 123456,
      feeCents: 456,
      netCents: 123000,
      status: "unmatched",
    });
    expect(
      parseReconciliationFile(
        "extrato.ofx",
        "<BANKTRANLIST><STMTTRN><TRNAMT>-25.90<FITID>tarifa-1</BANKTRANLIST>",
      )[0]?.paymentDirection,
    ).toBe("payable");
  });
});
