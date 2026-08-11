import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { IncidentsReport, InvalidIncidentPayloadError, parseIncidentReports } from "./incidents";

describe("incidentes gerenciais", () => {
  it("exibe linguagem neutra e ausência explícita de ação salarial", () => {
    const reports = parseIncidentReports([
      {
        incidentId: "incident-1",
        status: "under_review",
        neutralSummary: "Contagem física divergiu do registro.",
        amountCents: 5_000,
        payrollAction: false,
        evidenceCount: 2,
      },
    ]);
    const html = renderToStaticMarkup(<IncidentsReport incidents={reports} />);
    expect(html).toContain("Nenhum desconto em folha");
    expect(html).toContain("Contagem física divergiu");
  });

  it("rejeita qualquer payload que sinalize ação salarial", () => {
    expect(() =>
      parseIncidentReports([
        {
          incidentId: "incident-1",
          status: "approved",
          neutralSummary: "Divergência revisada.",
          amountCents: 1_000,
          payrollAction: true,
          evidenceCount: 1,
        },
      ]),
    ).toThrow(InvalidIncidentPayloadError);
  });
});
