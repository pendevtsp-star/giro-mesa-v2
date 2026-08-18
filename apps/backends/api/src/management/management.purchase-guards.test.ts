import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  auditEvents,
  managementIdempotency,
  managementSupplierInvoices,
  outboxEvents,
} from "@giromesa/db";
import type { DatabaseService } from "../database/database.module.js";
import type { ScopeService } from "../organizations/scope.service.js";
import { ManagementService } from "./management.service.js";

const organizationId = "11111111-1111-4111-8111-111111111111";
const unitId = "22222222-2222-4222-8222-222222222222";
const identityId = "33333333-3333-4333-8333-333333333333";
const purchaseOrderId = "44444444-4444-4444-8444-444444444444";
const invoiceId = "55555555-5555-4555-8555-555555555555";
const purchaseOrderItemId = "66666666-6666-4666-8666-666666666666";

function hasCode(expected: string) {
  return (error: unknown) => {
    const response = (error as { getResponse?: () => unknown }).getResponse?.();
    return (
      typeof response === "object" &&
      response !== null &&
      (response as { code?: string }).code === expected
    );
  };
}

describe("purchase authorization and optimistic guards", () => {
  it("does not let inventory confirm an invoice or start a payable transaction", async () => {
    let transactions = 0;
    const database = {
      db: {
        transaction: async () => {
          transactions += 1;
          throw new Error("transaction should not start");
        },
      },
    } as unknown as DatabaseService;
    const scope = {
      requireUnitAccess: async () => ({ organizationId, unitId }),
      requireOrganizationRole: async () => [{ role: "inventory", unitId }],
    } as unknown as ScopeService;
    const management = new ManagementService(database, scope);

    await assert.rejects(
      () =>
        management.createSupplierInvoice(
          identityId,
          organizationId,
          unitId,
          purchaseOrderId,
          "inventory-confirm-invoice-001",
          {
            documentNumber: "NF-1",
            issuedAt: "2026-08-17",
            competenceDate: "2026-08-17",
            dueDate: "2026-08-17",
            totalCents: 100,
            toleranceCents: 0,
            confirmIfMatched: true,
            lines: [{ purchaseOrderItemId, quantity: "1", unitCostCents: 100 }],
          },
        ),
      hasCode("MANAGEMENT_ROLE_DENIED"),
    );
    assert.equal(transactions, 0);
  });

  it("rejects stale invoice reconciliation before audit, outbox or idempotency writes", async () => {
    const insertCounts = new Map<unknown, number>();
    const tx = {
      execute: async () => undefined,
      select: () => ({
        from: (table: unknown) => ({
          where: () => ({
            limit: async () =>
              table === managementSupplierInvoices
                ? [{ id: invoiceId, version: 2, status: "matched" }]
                : [],
          }),
        }),
      }),
      insert: (table: unknown) => ({
        values: async () => {
          insertCounts.set(table, (insertCounts.get(table) ?? 0) + 1);
        },
      }),
    };
    const database = {
      db: {
        transaction: async (work: (transaction: typeof tx) => Promise<unknown>) => work(tx),
      },
    } as unknown as DatabaseService;
    const scope = {
      requireUnitAccess: async () => ({ organizationId, unitId }),
      requireOrganizationRole: async () => [{ role: "owner", unitId: null }],
    } as unknown as ScopeService;
    const management = new ManagementService(database, scope);

    await assert.rejects(
      () =>
        management.reconcileSupplierInvoice(
          identityId,
          organizationId,
          unitId,
          invoiceId,
          "stale-reconciliation-001",
          { toleranceCents: 0, version: 1 },
        ),
      hasCode("SUPPLIER_INVOICE_VERSION_CONFLICT"),
    );
    assert.equal(insertCounts.get(auditEvents) ?? 0, 0);
    assert.equal(insertCounts.get(outboxEvents) ?? 0, 0);
    assert.equal(insertCounts.get(managementIdempotency) ?? 0, 0);
  });
});
