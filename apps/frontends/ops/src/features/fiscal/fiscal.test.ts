import { describe, expect, it } from "vitest";
import {
  accountantOpenRequestTitle,
  accountantRequestHref,
  accountantRequestStatusLabel,
  accountantRequestViewFromHash,
  canResolveAccountantRequest,
  fiscalRejectionGuidance,
  InvalidFiscalPayloadError,
  parseAccountantWorkspace,
  parseFiscalDocumentDetail,
  parseFiscalWorkspace,
  validateAccountantAttachment,
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
    expect(workspace.dashboard.pending.at(-1)?.title).toBe("1 solicitação do contador aberta");
    expect(workspace.profile?.series.nfce).toBe("1");
    expect(workspace.profile?.stateCode).toBe("");
    expect(workspace.products.map((product) => product.name)).toContain("Produto pendente");
    expect(workspace.documents[0]?.model).toBe("nfce");
    expect(workspace.periods[0]?.competence).toBe("2026-08");
  });

  it("valida o DTO público do contador e tolera o pacote legado", () => {
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
          createdByName: "Ana Contadora",
          storageKey: "internal/nao-expor.xml",
          idempotencyKey: "nao-expor",
        },
      ],
    });

    expect(workspace.accountingPackage).toMatchObject({
      competence: "2026-08",
      status: "ready",
      generatedAt: "2026-08-17T12:00:00Z",
    });
    expect(workspace.pagination).toBeNull();
    expect(workspace.periods[0]?.blockers).toEqual([
      "1 documento(s) rejeitado(s)",
      "2 documento(s) pendente(s)",
    ]);
    expect(workspace.requests[0]).toEqual({
      id: "r1",
      competence: "2026-08",
      title: "XML faltante",
      detail: "Enviar XML da compra 42.",
      status: "open",
      dueAt: null,
      createdAt: "2026-08-17T12:00:00Z",
      requestedBy: "Ana Contadora",
      resolution: null,
      resolvedAt: null,
      resolvedBy: null,
      targetAudience: "accountant",
      attachments: [],
    });

    expect(
      parseAccountantWorkspace({
        periods: [period],
        accountingPackage: {
          competence: "2026-08",
          status: "available",
          generatedAt: "2026-08-18T12:00:00Z",
          files: ["contabilidade-2026-08.zip"],
        },
        requests: {
          items: [
            {
              id: "r2",
              competence: "2026-08",
              title: "Conferência concluída",
              detail: "Documentos conferidos.",
              status: "resolved",
              dueAt: null,
              createdAt: "2026-08-17T12:00:00Z",
              resolution: "Tudo certo para o fechamento.",
              resolvedAt: "2026-08-18T12:00:00Z",
              resolvedByName: "Bruno Gestor",
              targetAudience: "establishment",
              attachments: [
                {
                  id: "attachment-1",
                  fileName: "compras.xml",
                  contentType: "application/xml",
                  sizeBytes: 1024,
                  createdAt: "2026-08-18T11:00:00Z",
                  storageKey: "internal/nao-expor.xml",
                  sha256: "a".repeat(64),
                },
              ],
            },
          ],
          pagination: { page: 1, pageSize: 50, total: 1 },
        },
      }),
    ).toMatchObject({
      accountingPackage: {
        status: "ready",
        files: [{ name: "contabilidade-2026-08.zip", sizeBytes: 0 }],
      },
      requests: [
        {
          detail: "Documentos conferidos.",
          resolution: "Tudo certo para o fechamento.",
          resolvedBy: "Bruno Gestor",
          targetAudience: "establishment",
          attachments: [
            {
              id: "attachment-1",
              fileName: "compras.xml",
              contentType: "application/xml",
              sizeBytes: 1024,
            },
          ],
        },
      ],
      pagination: { page: 1, pageSize: 50, total: 1 },
    });
    expect(() =>
      parseAccountantWorkspace({
        periods: [{ ...period, status: "deleted" }],
        accountingPackage: null,
        requests: [],
      }),
    ).toThrow(InvalidFiscalPayloadError);
  });

  it("preserva audiência, deep-link e valida anexos antes do envio", () => {
    const request = parseAccountantWorkspace({
      periods: [],
      accountingPackage: null,
      requests: [
        {
          id: "r1",
          competence: "2026-08",
          title: "Conferir compra",
          description: "Confira o XML.",
          status: "open",
          targetAudience: "establishment",
          dueDate: "2026-08-20",
          createdAt: "2026-08-17T12:00:00Z",
        },
      ],
    }).requests[0];

    expect(request && accountantRequestStatusLabel(request)).toBe("Aguardando empresa");
    expect(request && canResolveAccountantRequest(request, "establishment")).toBe(true);
    expect(request && canResolveAccountantRequest(request, "accountant")).toBe(false);
    expect(accountantOpenRequestTitle(2)).toBe("2 solicitações do contador abertas");
    expect(
      accountantRequestViewFromHash(accountantRequestHref("overdue", 3, "establishment")),
    ).toEqual({ filter: "overdue", page: 3, targetAudience: "establishment" });
    expect(validateAccountantAttachment({ name: "compras.xml", type: "", size: 1024 })).toEqual({
      valid: true,
      contentType: "application/xml",
    });
    expect(
      validateAccountantAttachment({
        name: "arquivo.exe",
        type: "application/octet-stream",
        size: 1024,
      }),
    ).toMatchObject({ valid: false });
    expect(
      validateAccountantAttachment({
        name: "grande.pdf",
        type: "application/pdf",
        size: 3 * 1024 * 1024 + 1,
      }),
    ).toMatchObject({ valid: false });
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
