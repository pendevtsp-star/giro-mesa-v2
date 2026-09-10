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

  it.each([
    ["TRANSFER_DISTINCT_RECEIVER_REQUIRED", "Outra pessoa precisa conferir esta transferência."],
    ["INVENTORY_COUNT_DUAL_CONTROL_REQUIRED", "A conferência precisa ser feita por outra pessoa."],
    ["INVENTORY_REVIEW_DUAL_CONTROL_REQUIRED", "A conferência precisa ser feita por outra pessoa."],
    ["RETURNABLE_INCIDENT_DUAL_CONTROL", "A conferência precisa ser feita por outra pessoa."],
  ])("explica a separação entre autor e conferente em %s", (code, message) => {
    expect(operationalApiErrorMessage(403, undefined, "request-review", undefined, code)).toBe(
      `${message} Referência: request-review.`,
    );
  });

  it("orienta uma nova contagem quando o saldo mudou", () => {
    expect(
      operationalApiErrorMessage(
        409,
        undefined,
        undefined,
        undefined,
        "INVENTORY_COUNT_STALE_BALANCE",
      ),
    ).toBe(
      "O saldo mudou desde o início desta contagem. Refaça a contagem com o saldo atualizado.",
    );
  });

  it("preserva a orientação de permissão para uma recusa sem regra específica", () => {
    expect(operationalApiErrorMessage(403, undefined, undefined, undefined, "FORBIDDEN")).toBe(
      "Seu perfil não possui permissão para esta operação.",
    );
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
  it("bloqueia schema anterior aos vínculos financeiros e estados de entrega", () => {
    expect(
      apiCompatibilityError({
        status: "ok",
        version: "2.0.0",
        buildSha: "previous",
        schemaVersion: 81,
        capabilities: OPS_REQUIRED_API_CAPABILITIES,
        database: "up",
        integrations: {},
      }),
    ).not.toBeNull();
  });
});
