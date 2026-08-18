import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ServiceUnavailableException } from "@nestjs/common";
import type { DatabaseService } from "../database/database.module.js";
import { DatabaseReadinessService } from "./health.module.js";

describe("database readiness", () => {
  it("reports the missing management migration clearly", async () => {
    const database = {
      db: { execute: async () => [{ relation: null }] },
    } as unknown as DatabaseService;

    await assert.rejects(
      () => new DatabaseReadinessService(database).assertReady(),
      (error: unknown) => {
        assert.ok(error instanceof ServiceUnavailableException);
        assert.deepEqual(error.getResponse(), {
          code: "DATABASE_MIGRATION_REQUIRED",
          message:
            "Schema do banco desatualizado: tabela management_time_tracking_settings ausente. Execute as migrations antes de iniciar a API.",
          missingRelations: ["management_time_tracking_settings"],
        });
        return true;
      },
    );
  });
});
