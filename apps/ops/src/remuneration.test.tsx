import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  InvalidRemunerationPayloadError,
  parseRemunerationPortfolio,
  RemunerationReport,
} from "./remuneration";

describe("relatório de remuneração", () => {
  it("separa categorias e marca valores estimados", () => {
    const portfolio = parseRemunerationPortfolio({
      periodStart: "2026-07-01",
      periodEnd: "2026-07-31",
      disclaimer: "Valores estimados até aprovação.",
      byKind: {
        service: [
          {
            runId: "run-1",
            kind: "service",
            status: "estimated",
            outputCents: 10_000,
            memoryHash: "a".repeat(64),
          },
        ],
        commission: [],
        profit_sharing: [],
      },
    });
    const html = renderToStaticMarkup(<RemunerationReport portfolio={portfolio} />);
    expect(html).toContain("Taxa de serviço");
    expect(html).toContain("Comissão");
    expect(html).toContain("Participação nos resultados");
    expect(html).toContain("Estimado");
    expect(html).toContain("PDF");
    expect(html).toContain("CSV");
    expect(html).toContain("Imprimir");
  });

  it("rejeita categoria ausente sem fabricar relatório", () => {
    expect(() =>
      parseRemunerationPortfolio({
        periodStart: "2026-07-01",
        periodEnd: "2026-07-31",
        disclaimer: "Persistido.",
        byKind: { service: [], commission: [] },
      }),
    ).toThrow(InvalidRemunerationPayloadError);
  });
});
