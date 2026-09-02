import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  commissionTransitionSchema,
  peopleListQuerySchema,
  personAccessInviteSchema,
  personAccessReactivateSchema,
  personAccessRoleUpdateSchema,
  personAccessStepUpSchema,
  personSchema,
  personUnitAccessRemovalSchema,
  personUnitAccessSchema,
  personUpdateSchema,
  scheduleBatchSchema,
  scheduleUpdateSchema,
} from "./management.schemas.js";

describe("people lifecycle schemas", () => {
  it("permite limpar campos opcionais e valida filtros paginados", () => {
    assert.equal(
      personUpdateSchema.parse({ identityId: null, hourlyRateCents: null }).identityId,
      null,
    );
    assert.deepEqual(peopleListQuerySchema.parse({ status: "on_shift", page: "2" }), {
      status: "on_shift",
      page: 2,
      pageSize: 25,
    });
  });

  it("rejeita janela invertida e lote vazio", () => {
    assert.equal(
      scheduleUpdateSchema.safeParse({
        startsAt: "2026-08-17T12:00:00-03:00",
        endsAt: "2026-08-17T11:00:00-03:00",
      }).success,
      false,
    );
    assert.equal(scheduleBatchSchema.safeParse({ schedules: [] }).success, false);
  });

  it("valida o contrato congelado do ciclo de acesso", () => {
    const person = personSchema.parse({
      name: "Ana Souza",
      roleLabel: "Garçonete",
      access: { email: " ANA@EXAMPLE.COM ", role: "waiter" },
    });
    assert.deepEqual(person.access, {
      email: "ana@example.com",
      role: "waiter",
      roles: ["waiter"],
    });
    assert.deepEqual(
      personAccessInviteSchema.parse({
        email: "ana@example.com",
        roles: ["waiter", "cashier"],
      }).roles,
      ["waiter", "cashier"],
    );
    assert.equal(
      personAccessInviteSchema.safeParse({
        email: "ana@example.com",
        roles: ["waiter", "waiter"],
      }).success,
      false,
    );
    assert.equal(
      personAccessInviteSchema.safeParse({ email: "invalido", role: "cashier" }).success,
      false,
    );
    assert.equal(
      personAccessRoleUpdateSchema.safeParse({ role: "manager", reason: "Promoção aprovada" })
        .success,
      true,
    );
    assert.equal(
      personAccessReactivateSchema.safeParse({ reason: "Retorno autorizado" }).success,
      true,
    );
  });

  it("exige uma única prova de identidade e motivo no acesso multiunidade", () => {
    assert.equal(personAccessStepUpSchema.safeParse({ currentPassword: "segredo" }).success, true);
    assert.equal(personAccessStepUpSchema.safeParse({ mfaCode: "123456" }).success, true);
    assert.equal(personAccessStepUpSchema.safeParse({}).success, false);
    assert.equal(
      personAccessStepUpSchema.safeParse({ currentPassword: "segredo", mfaCode: "123456" }).success,
      false,
    );
    assert.equal(
      personUnitAccessSchema.safeParse({
        unitId: "00000000-0000-4000-8000-000000000001",
        roles: ["manager", "finance"],
        reason: "Cobertura da unidade",
        reauth: { mfaCode: "123456" },
      }).success,
      true,
    );
    assert.equal(personUnitAccessRemovalSchema.safeParse({ reason: "curto" }).success, true);
    assert.equal(personUnitAccessRemovalSchema.safeParse({ reason: "não" }).success, false);
  });

  it("exige nota operacional nas transições de comissão", () => {
    assert.equal(commissionTransitionSchema.safeParse({ action: "pay", note: "" }).success, false);
    assert.equal(
      commissionTransitionSchema.safeParse({ action: "pay", note: "Folha agosto" }).success,
      true,
    );
  });
});
