import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ServiceUnavailableException } from "@nestjs/common";
import { DatabaseService } from "../database/database.module.js";
import { DatabaseReadinessService } from "./health.module.js";

describe("database readiness", () => {
  it("accepts the migrated PostgreSQL schema", async (context) => {
    if (!process.env.PILOT_DATABASE_URL) return context.skip("PILOT_DATABASE_URL not configured");
    const previousUrl = process.env.DATABASE_URL;
    process.env.DATABASE_URL = process.env.PILOT_DATABASE_URL;
    const database = new DatabaseService();
    try {
      await new DatabaseReadinessService(database).assertReady();
    } finally {
      await database.onModuleDestroy();
      if (previousUrl === undefined) delete process.env.DATABASE_URL;
      else process.env.DATABASE_URL = previousUrl;
    }
  });

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
            "management_finance_attachments",
            "management_waiter_settlements.payment_columns",
            "growth_delivery_status.failure_states",
          ],
        });
        return true;
      },
    );
  });

  it("does not declare schema 82 ready when delivery migration is missing", async () => {
    const readiness = {
      management: "present",
      tableQrMetrics: "present",
      operationalPush: "present",
      whatsappMessages: "present",
      crmAutomations: "present",
      crmQuickReplies: "present",
      edgeHubPairings: "present",
      financeAttachments: "present",
      settlementPayments: true,
      deliveryFailures: false,
    };
    const database = { db: { execute: async () => [readiness] } } as unknown as DatabaseService;
    const service = new DatabaseReadinessService(database);
    await assert.rejects(
      () => service.assertReady(),
      (error: unknown) => {
        assert.ok(error instanceof ServiceUnavailableException);
        assert.deepEqual((error.getResponse() as { missingRelations: string[] }).missingRelations, [
          "growth_delivery_status.failure_states",
        ]);
        return true;
      },
    );
    readiness.deliveryFailures = true;
    await service.assertReady();
  });
});
