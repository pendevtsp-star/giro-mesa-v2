import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  platformIncidentActionSchema,
  platformReasonBodySchema,
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
});
