import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  edgeFiscalEventSchema,
  focusCompanyOnboardingSchema,
  productTaxRevisionImportSchema,
} from "./fiscal.schemas.js";
import {
  buildAccountingPackage,
  buildFocusCompanyInput,
  competenceBounds,
  providerStatusPayload,
} from "./fiscal.service.js";
import { FocusNfeClient, parseFocusCompany, parseFocusDocument } from "./focus-nfe.client.js";

describe("fiscal core", () => {
  it("uses a canonical first-day competence", () => {
    assert.equal(competenceBounds("2026-08").competenceDate, "2026-08-01");
  });

  it("totals only authorized documents in the accounting package", () => {
    const packageData = buildAccountingPackage("org", "unit", "2026-08", new Date(0), [
      {
        id: "authorized",
        model: "nfce",
        status: "authorized",
        accessKey: null,
        series: "1",
        number: 1,
        totalCents: 2_500,
        taxCents: 200,
        issuedAt: new Date(0),
        xmlSha256: null,
      },
      {
        id: "rejected",
        model: "nfce",
        status: "rejected",
        accessKey: null,
        series: "1",
        number: 2,
        totalCents: 9_999,
        taxCents: 999,
        issuedAt: new Date(0),
        xmlSha256: null,
      },
    ]);
    assert.equal(packageData.totals.documents, 2);
    assert.equal(packageData.totals.totalCents, 2_500);
    assert.equal(packageData.totals.taxCents, 200);
    assert.deepEqual(packageData.totals.byStatus, { authorized: 1, rejected: 1 });
  });

  it("validates edge event type and invalidation status", () => {
    const event = edgeFiscalEventSchema.parse({
      id: "event-1",
      type: "fiscal.number_invalidation_result",
      occurredAt: "2026-08-17T00:00:00.000Z",
      payload: {
        kind: "fiscal.number_invalidation_result",
        idempotencyKey: "invalidate-1",
        status: "invalidated",
        cnpj: "12ABC34501DE67",
        series: "1",
        initialNumber: 10,
        finalNumber: 12,
      },
    });
    assert.equal(event.payload.status, "invalidated");
    assert.throws(() =>
      edgeFiscalEventSchema.parse({ ...event, type: "fiscal.document.reconciled" }),
    );
  });

  it("rejects duplicate products in a fiscal CSV import", () => {
    const row = {
      productId: "9f33ca16-47d7-4c9c-b212-8366c985b7d1",
      status: "active" as const,
      effectiveFrom: "2026-08-21",
      classification: { ncm: "21069090", cfop: "5102", origin: 0 },
    };
    assert.equal(productTaxRevisionImportSchema.safeParse({ rows: [row, row] }).success, false);
  });

  it("maps the unit profile to a Focus company without exposing credentials", () => {
    const onboarding = focusCompanyOnboardingSchema.parse({
      tradeName: "GiroMesa Centro",
      stateRegistration: "123456789",
      email: "fiscal@giromesa.test",
      phone: "11999999999",
      street: "Rua Central",
      number: 42,
      district: "Centro",
      city: "São Paulo",
      postalCode: "01001000",
      certificateBase64: Buffer.alloc(64, 1).toString("base64"),
      certificatePassword: "secret",
      enableNfce: true,
      enableNfe: false,
      enableNfse: false,
      cscHomologation: "csc-test",
      cscHomologationId: "1",
    });
    const result = buildFocusCompanyInput(
      { legalName: "GiroMesa Centro Ltda", document: "05953016000132" },
      {
        taxRegime: "simples_nacional",
        crt: "1",
        stateCode: "SP",
        municipalRegistration: null,
        settings: { series: { nfce: "1" } },
      },
      onboarding,
    );
    assert.equal(result.regime_tributario, 1);
    assert.equal(result.serie_nfce_homologacao, "1");
    assert.equal(result.arquivo_certificado_base64, onboarding.certificateBase64);
  });

  it("normalizes company tokens and document artifacts returned by Focus", () => {
    assert.deepEqual(
      parseFocusCompany({
        id: 42,
        cnpj: "05953016000132",
        token_producao: "prod-token",
        token_homologacao: "hom-token",
        habilita_nfce: true,
      }),
      {
        id: "42",
        cnpj: "05953016000132",
        tokenProduction: "prod-token",
        tokenHomologation: "hom-token",
        certificateValidUntil: null,
        enabled: { nfce: true, nfe: false, nfse: false },
      },
    );
    const document = parseFocusDocument({
      status: "autorizado",
      chave_nfe: "31260812345678000190650010000001231000001234",
      numero: "123",
      serie: "1",
      valor_total_tributos: "12.34",
      caminho_xml_nota_fiscal: "https://api.focusnfe.com.br/xml/1",
      caminho_danfe: "https://api.focusnfe.com.br/danfe/1",
    });
    assert.equal(document.status, "authorized");
    assert.equal(document.number, 123);
    assert.equal(document.taxCents, 1234);
  });

  it("authenticates private Focus artifacts without exposing the token", async () => {
    const originalFetch = globalThis.fetch;
    let authorization: string | null = null;
    globalThis.fetch = async (_input, init) => {
      authorization = new Headers(init?.headers).get("authorization");
      return new Response("<procInutNFe />", { status: 200 });
    };
    try {
      const artifact = await new FocusNfeClient().artifact(
        "https://api.focusnfe.com.br/xml/1",
        "production",
        "secret-token",
      );
      assert.equal(artifact.toString(), "<procInutNFe />");
      assert.equal(authorization, `Basic ${Buffer.from("secret-token:").toString("base64")}`);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("returns business status without provider identifiers or credentials", () => {
    const status = providerStatusPayload(
      {
        provider: "focus",
        environment: "homologation",
        settings: {
          focus: {
            companyId: "internal-company-id",
            cnpj: "05953016000132",
            status: "ready",
            tokenHomologation: { encryptedSecret: "secret" },
          },
        },
      },
      true,
      true,
    );
    assert.equal(status.connection?.registered, true);
    assert.equal("provider" in status, false);
    assert.equal("companyId" in (status.connection ?? {}), false);
    assert.equal("tokenHomologation" in (status.connection ?? {}), false);
  });
});
