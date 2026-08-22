import { describe, expect, it } from "vitest";
import {
  fiscalRejectionGuidance,
  InvalidFiscalPayloadError,
  parseAccountantWorkspace,
  parseFiscalDocumentDetail,
  parseFiscalWorkspace,
} from "./fiscal";

const period = {
  id: "period-1",
  competence: "2026-08-01",
  status: "open",
  closedAt: null,
  blockers: { count: 3, rejectedCount: 1 },
};

describe("contrato fiscal do Ops", () => {
  it("normaliza o contrato real sem confiar no payload", () => {
    const workspace = parseFiscalWorkspace({
      profile: {
        legalEntityId: "legal-1",
        taxRegime: "simples_nacional",
        crt: "1",
        municipalRegistration: null,
        cnae: "5611201",
        stateCode: "",
        cityCode: "",
        environment: "homologation",
        provider: null,
        settings: { series: { nfce: "1" } },
      },
      taxRevisions: [{ productId: "product-1", status: "active" }],
      catalog: {
        categories: [],
        prices: [],
        availability: [],
        products: [
          { id: "product-1", categoryId: "category-1", name: "Produto classificado", active: true },
          { id: "product-2", categoryId: "category-1", name: "Produto pendente", active: true },
        ],
      },
      dashboard: {
        profile: { provider: "focus", environment: "production" },
        documentsByStatus: { authorized: 12, rejected: 1, pending: 2 },
        pendingDocuments: 2,
        openPeriods: 1,
        openAccountantRequests: 1,
        products: { total: 20, classified: 18, missingClassification: 2 },
      },
      provider: {
        status: "ready",
        environment: "homologation",
        nextAction: "Conexão pronta para o ambiente selecionado.",
        connection: {
          registered: true,
          status: "ready",
          certificateValidUntil: "2027-08-17",
          lastCheckedAt: "2026-08-17T11:00:00Z",
          environments: { homologation: true, production: true },
        },
      },
      documents: {
        items: [
          {
            id: "d1",
            model: "nfce",
            number: 123,
            series: "1",
            status: "authorized",
            customerDocument: null,
            totalCents: 4500,
            issuedAt: "2026-08-17T11:00:00Z",
            accessKey: "31260812345678000190650010000001231000001234",
          },
        ],
      },
      periods: [period],
    });

    expect(workspace.dashboard.summary.totalCents).toBe(4500);
    expect(workspace.dashboard.provider.registered).toBe(true);
    expect(workspace.dashboard.provider.status).toBe("ready");
    expect(workspace.dashboard.pending).toHaveLength(4);
    expect(workspace.profile?.series.nfce).toBe("1");
    expect(workspace.profile?.stateCode).toBe("");
    expect(workspace.products.map((product) => product.name)).toContain("Produto pendente");
    expect(workspace.documents[0]?.model).toBe("nfce");
    expect(workspace.periods[0]?.competence).toBe("2026-08");
  });

  it("valida pacote e solicitações retornados pelo backend", () => {
    const workspace = parseAccountantWorkspace({
      periods: [period],
      accountingPackage: {
        period: { competence: "2026-08-01" },
        accountingPackage: {
          status: "ready",
          generatedAt: "2026-08-17T12:00:00Z",
          payload: { schemaVersion: 1, documents: [] },
        },
      },
      requests: [
        {
          id: "r1",
          competence: "2026-08-01",
          title: "XML faltante",
          description: "Enviar XML da compra 42.",
          status: "open",
          dueDate: null,
          createdAt: "2026-08-17T12:00:00Z",
        },
      ],
    });

    expect(workspace.accountingPackage?.payload).toMatchObject({ schemaVersion: 1 });
    expect(workspace.periods[0]?.blockers).toEqual([
      "1 documento(s) rejeitado(s)",
      "2 documento(s) pendente(s)",
    ]);
    expect(workspace.requests[0]?.detail).toBe("Enviar XML da compra 42.");
    expect(() =>
      parseAccountantWorkspace({
        periods: [{ ...period, status: "deleted" }],
        accountingPackage: null,
        requests: [],
      }),
    ).toThrow(InvalidFiscalPayloadError);
  });

  it("normaliza o detalhe da nota e traduz rejeições em próxima ação", () => {
    const detail = parseFiscalDocumentDetail({
      id: "document-1",
      orderId: "order-1",
      model: "nfce",
      number: 42,
      series: "1",
      status: "rejected",
      customerDocument: "12345678901",
      totalCents: 2500,
      taxCents: 300,
      issuedAt: "2026-08-21T12:00:00Z",
      authorizedAt: null,
      canceledAt: null,
      accessKey: null,
      items: [
        {
          id: "item-1",
          lineNumber: 1,
          description: "Almoço",
          quantityMilli: 1000,
          unitPriceCents: 2500,
          totalCents: 2500,
          taxCents: 300,
        },
      ],
      events: [
        {
          id: "event-1",
          type: "fiscal.document.issue_result",
          status: "rejected",
          code: "NCM_INVALIDO",
          message: "NCM inválido",
          occurredAt: "2026-08-21T12:01:00Z",
        },
      ],
    });

    expect(detail.items[0]?.quantityMilli).toBe(1000);
    expect(fiscalRejectionGuidance(detail.events[0]?.code ?? null, null)).toContain(
      "classificação fiscal",
    );
  });
});
