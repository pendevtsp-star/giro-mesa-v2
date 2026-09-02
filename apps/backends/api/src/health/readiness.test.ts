import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ServiceUnavailableException } from "@nestjs/common";
import type { DatabaseService } from "../database/database.module.js";
import { DatabaseReadinessService } from "./health.module.js";

describe("database readiness", () => {
  it("reports the missing management migration clearly", async () => {
    const database = {
      db: {
        execute: async () => [
          {
            management: null,
            tableQrMetrics: null,
            operationalPush: null,
            whatsappMessages: null,
            crmAutomations: null,
            crmQuickReplies: null,
            edgeHubPairingCodes: null,
          },
        ],
      },
    } as unknown as DatabaseService;

    await assert.rejects(
      () => new DatabaseReadinessService(database).assertReady(),
      (error: unknown) => {
        assert.ok(error instanceof ServiceUnavailableException);
        assert.deepEqual(error.getResponse(), {
          code: "DATABASE_MIGRATION_REQUIRED",
          message: "Schema do banco desatualizado. Execute as migrations antes de iniciar a API.",
          missingRelations: [
            "management_time_tracking_settings",
            "pos_table_qr_metrics",
            "pos_operational_push_subscriptions",
            "growth_whatsapp_messages",
            "growth_crm_automation_rules",
            "growth_crm_quick_replies",
            "edge_hub_pairing_codes",
          ],
        });
        return true;
      },
    );
  });
});
