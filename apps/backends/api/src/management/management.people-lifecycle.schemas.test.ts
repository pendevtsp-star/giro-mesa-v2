import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  commissionTransitionSchema,
  peopleListQuerySchema,
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

  it("exige nota operacional nas transições de comissão", () => {
    assert.equal(commissionTransitionSchema.safeParse({ action: "pay", note: "" }).success, false);
    assert.equal(
      commissionTransitionSchema.safeParse({ action: "pay", note: "Folha agosto" }).success,
      true,
    );
  });
});
