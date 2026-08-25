import { describe, expect, it } from "vitest";
import {
  apiCompatibilityError,
  OPS_REQUIRED_API_CAPABILITIES,
  OPS_REQUIRED_SCHEMA_VERSION,
  operationalApiErrorMessage,
} from "./api";

describe("compatibilidade e erros da API", () => {
  it("bloqueia uma API antiga sem expor a rota técnica", () => {
    expect(apiCompatibilityError({ status: "ok", version: "2.0.0" })).toContain(
      "Atualize e reinicie a API",
    );
    expect(
      operationalApiErrorMessage(
        404,
        "Cannot GET /v1/organizations/example/units/example/pilot/catalog/tables/qr/lifecycle",
        "request-123",
      ),
    ).toBe("Este recurso não está disponível na versão atual da API. Referência: request-123.");
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
