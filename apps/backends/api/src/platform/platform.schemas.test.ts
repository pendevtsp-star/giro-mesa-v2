import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  platformIncidentActionSchema,
  platformReasonBodySchema,
  platformTenantRegistrationSchema,
  tenantDirectoryQuerySchema,
} from "./platform.schemas.js";

describe("platform request schemas", () => {
  it("bounds pagination and requires reasons for privileged actions", () => {
    assert.deepEqual(tenantDirectoryQuerySchema.parse({}), { search: "", page: 1, limit: 25 });
    assert.equal(tenantDirectoryQuerySchema.safeParse({ limit: 101 }).success, false);
    assert.equal(platformReasonBodySchema.safeParse({ reason: "curto" }).success, false);
    assert.equal(
      platformIncidentActionSchema.safeParse({ action: "snooze", reason: "Investigação" }).success,
      false,
    );
    assert.equal(
      platformIncidentActionSchema.safeParse({
        action: "snooze",
        reason: "Aguardando retorno do provedor",
        snoozedUntil: new Date(Date.now() + 60_000).toISOString(),
      }).success,
      true,
    );
    assert.equal(
      platformIncidentActionSchema.safeParse({
        action: "snooze",
        reason: "Aguardando retorno do provedor",
        snoozedUntil: "amanhã",
      }).success,
      false,
    );
  });

  it("normalizes the existing owner email and requires a complete tenant registration", () => {
    const registered = platformTenantRegistrationSchema.parse({
      legalName: "Piloto Restaurante Ltda",
      tradeName: "Piloto Restaurante",
      document: "12ab3456cd7811",
      unitName: "Matriz",
      timezone: "America/Sao_Paulo",
      ownerEmail: " OWNER@EXAMPLE.TEST ",
      reason: "Cliente piloto aprovado pelo time de produto",
    });
    assert.equal(registered.document, "12AB3456CD7811");
    assert.equal(registered.ownerEmail, "owner@example.test");
    assert.equal(
      platformTenantRegistrationSchema.safeParse({
        ...registered,
        ownerEmail: "não é um e-mail",
      }).success,
      false,
    );
    assert.equal(
      platformTenantRegistrationSchema.safeParse({ ...registered, unexpected: true }).success,
      false,
    );
  });
});
