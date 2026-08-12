import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  InvalidReturnablesPayloadError,
  parseReturnableLedger,
  ReturnablesLedger,
} from "./returnables";

describe("retornáveis", () => {
  it("preserva quantidade e custódia do ledger real", () => {
    const ledger = parseReturnableLedger([
      {
        movementId: "movement-1",
        movementType: "circulate",
        quantity: 2,
        fromCustodyType: "location",
        fromCustodyId: "stock-main",
        toCustodyType: "table",
        toCustodyId: "table-12",
        occurredAt: "2026-08-11T12:00:00.000Z",
      },
    ]);
    const html = renderToStaticMarkup(<ReturnablesLedger movements={ledger} />);
    expect(html).toContain("Trilha de custódia");
    expect(html).toContain("table-12");
  });

  it("rejeita payload incompleto sem fabricar saldo", () => {
    expect(() => parseReturnableLedger([{ movementId: "movement-1" }])).toThrow(
      InvalidReturnablesPayloadError,
    );
  });
});
