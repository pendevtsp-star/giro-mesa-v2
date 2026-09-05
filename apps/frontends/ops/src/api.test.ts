import { describe, expect, it } from "vitest";
import {
  apiCompatibilityError,
  OPS_REQUIRED_API_CAPABILITIES,
  OPS_REQUIRED_SCHEMA_VERSION,
  operationalApiErrorMessage,
} from "./api";

describe("compatibilidade e erros do serviço", () => {
  it("bloqueia um serviço antigo sem expor a rota técnica", () => {
    expect(apiCompatibilityError({ status: "ok", version: "2.0.0" })).toContain(
      "Atualize e reinicie o sistema",
    );
    expect(
      operationalApiErrorMessage(
        404,
        "Cannot GET /v1/organizations/example/units/example/pilot/catalog/tables/qr/lifecycle",
        "request-123",
      ),
    ).toBe("Este recurso não está disponível nesta versão do GiroMesa. Referência: request-123.");
  });

  it("explica quando um pedido não possui rota de produção", () => {
    expect(
      operationalApiErrorMessage(
        409,
        undefined,
        "request-409",
        undefined,
        "PRODUCT_WITHOUT_STATION",
      ),
    ).toBe(
      "Este pedido contém produto sem estação de produção. Configure a rota no Catálogo e tente novamente. Referência: request-409.",
    );
  });

  it("explica o vínculo duplicado entre produto e estoque", () => {
    expect(
      operationalApiErrorMessage(
        409,
        undefined,
        "request-inventory",
        undefined,
        "INVENTORY_MAPPING_AMBIGUOUS",
      ),
    ).toBe(
      "Um produto deste pedido está ligado a mais de um item de estoque. Corrija o vínculo em Estoque e tente novamente. Referência: request-inventory.",
    );
  });

  it("preserva os erros operacionais seguros do cadastro de PIN", () => {
    expect(
      operationalApiErrorMessage(
        503,
        undefined,
        "request-pin-config",
        undefined,
        "TERMINAL_PIN_NOT_CONFIGURED",
      ),
    ).toBe(
      "A troca rápida por PIN ainda não foi configurada neste ambiente. Referência: request-pin-config.",
    );
    expect(
      operationalApiErrorMessage(
        401,
        undefined,
        "request-pin-password",
        undefined,
        "TERMINAL_PIN_REAUTH_REQUIRED",
      ),
    ).toBe("A senha atual não confere. Referência: request-pin-password.");
  });

  it("aceita a identidade de release compatível", () => {
    expect(
      apiCompatibilityError({
        status: "ok",
        version: "2.0.0",
        buildSha: "test-sha",
        schemaVersion: OPS_REQUIRED_SCHEMA_VERSION,
        capabilities: OPS_REQUIRED_API_CAPABILITIES,
        database: "up",
        integrations: {},
      }),
    ).toBeNull();
  });
});
