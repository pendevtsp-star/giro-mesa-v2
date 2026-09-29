import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { it } from "node:test";
import {
  identities,
  managementAccountsPayable,
  managementAccountsReceivable,
  managementPayablePayments,
  managementReceivableLines,
  managementReceivablePayments,
  managementReturnableDepositCharges,
  memberships,
  organizations,
  posCatalogCategories,
  posOrderItems,
  posOrders,
  posPaymentReversals,
  posProducts,
  posTabPayments,
  posTabs,
  reportFinancialTotals,
  roleBindings,
  units,
} from "@giromesa/db";
import { eq } from "drizzle-orm";
import { DatabaseService } from "../database/database.module.js";
import { MetricsService } from "../health/health.module.js";
import { ScopeService } from "../organizations/scope.service.js";
import { ManagementService } from "./management.service.js";
import { ManagementOverviewService } from "./management-overview.service.js";
import { ManagementReportService } from "./management-report.service.js";

function present<T>(value: T | undefined): T {
  assert.ok(value);
  return value;
}

it("unifies POS and independent finance events, preserving receipt dates and unknown costs", async (context) => {
  const url = process.env.MANAGEMENT_DATABASE_URL ?? process.env.DATABASE_URL;
  if (!url) return context.skip("MANAGEMENT_DATABASE_URL or DATABASE_URL not configured");
  process.env.DATABASE_URL = url;
  context.mock.timers.enable({ apis: ["Date"], now: new Date("2026-09-29T20:00:00Z") });
  const database = new DatabaseService();
  const rollback = new Error("ROLLBACK_TEST_FIXTURE");
  try {
    await assert.rejects(
      database.db.transaction(async (tx) => {
        const [org] = await tx
          .insert(organizations)
          .values({
            legalName: "Financial sources",
            tradeName: "Financial sources",
            document: randomUUID().replaceAll("-", "").slice(0, 14),
          })
          .returning();
        const [unit] = await tx
          .insert(units)
          .values({
            organizationId: present(org).id,
            name: "Sources",
            timezone: "America/Sao_Paulo",
          })
          .returning();
        const [identity] = await tx
          .insert(identities)
          .values({ email: `${randomUUID()}@example.test`, displayName: "Owner" })
          .returning();
        assert.ok(org && unit && identity);
        const scope = { organizationId: org.id, unitId: unit.id };
        const [membership] = await tx
          .insert(memberships)
          .values({ organizationId: org.id, identityId: identity.id, status: "active" })
          .returning();
        await tx
          .insert(roleBindings)
          .values({ membershipId: present(membership).id, role: "owner" });
        const transactionalDatabase = { db: tx } as unknown as DatabaseService;
        const access = new ScopeService(transactionalDatabase);
        const management = new ManagementService(transactionalDatabase, access);
        const reports = new ManagementReportService(
          transactionalDatabase,
          access,
          management,
          new MetricsService(),
        );
        const overview = new ManagementOverviewService(transactionalDatabase, access, management);
        const day = new Date("2026-09-29T20:00:00Z");
        const nextDay = new Date("2026-09-30T03:00:00Z");
        const period = { from: "2026-09-29", to: "2026-09-29", comparisonMode: "none" as const };
        const financialScope = { ...scope, ...period, timezone: unit.timezone };
        const [closed, open] = await tx
          .insert(posTabs)
          .values([
            {
              ...scope,
              openedByIdentityId: identity.id,
              status: "closed",
              subtotalCents: 3000,
              totalCents: 3000,
              closedAt: day,
            },
            {
              ...scope,
              openedByIdentityId: identity.id,
              status: "open",
              subtotalCents: 1500,
              totalCents: 1500,
            },
          ])
          .returning();
        assert.ok(closed && open);
        const payments = await tx
          .insert(posTabPayments)
          .values([
            {
              ...scope,
              tabId: closed.id,
              createdByIdentityId: identity.id,
              method: "cash",
              amountCents: 1000,
              createdAt: day,
            },
            {
              ...scope,
              tabId: closed.id,
              createdByIdentityId: identity.id,
              method: "pix",
              amountCents: 1000,
              createdAt: day,
            },
            {
              ...scope,
              tabId: closed.id,
              createdByIdentityId: identity.id,
              method: "cash",
              amountCents: 1000,
              receivedCents: 2000,
              changeCents: 1000,
              createdAt: day,
            },
            {
              ...scope,
              tabId: closed.id,
              createdByIdentityId: identity.id,
              method: "cash",
              amountCents: 1000,
              createdAt: day,
            },
            {
              ...scope,
              tabId: open.id,
              createdByIdentityId: identity.id,
              method: "cash",
              amountCents: 500,
              createdAt: day,
            },
          ])
          .returning();
        await tx.insert(posPaymentReversals).values([
          {
            ...scope,
            paymentId: present(payments[2]).id,
            requestedByIdentityId: identity.id,
            amountCents: 1000,
            reason: "Same-day correction",
            status: "approved",
            resolvedAt: day,
          },
          {
            ...scope,
            paymentId: present(payments[4]).id,
            requestedByIdentityId: identity.id,
            amountCents: 500,
            reason: "Next-day refund",
            status: "approved",
            resolvedAt: nextDay,
          },
          {
            ...scope,
            paymentId: present(payments[0]).id,
            requestedByIdentityId: identity.id,
            amountCents: 1000,
            reason: "Declined refund",
            status: "declined",
            resolvedAt: day,
          },
        ]);
        let report = await reports.reports(identity.id, org.id, unit.id, period);
        assert.equal(
          report.cashFlow.inflowsCents,
          3500,
          "change is excluded; open advance is realized",
        );
        assert.equal(
          report.incomeStatement.revenueCents,
          3000,
          "only closed POS sales are recognized",
        );
        assert.equal(report.incomeStatement.grossMarginCents, null);
        assert.equal(report.meta.dataThrough, period.to);
        assert.equal(report.meta.sourceCounts.receivablePayments, 6);
        assert.equal(report.meta.sourceCounts.costLines, 0);
        const finance = await overview.overview(identity.id, org.id, unit.id, "finance");
        assert.equal(
          finance.metrics.find((metric) => metric.id === "gross-margin")?.value,
          "—",
          "POS without costs is not a zero-margin sale",
        );
        const [order] = await tx
          .insert(posOrders)
          .values({ ...scope, tabId: closed.id, createdByIdentityId: identity.id })
          .returning();
        const [category] = await tx
          .insert(posCatalogCategories)
          .values({ organizationId: org.id, name: "Menu", slug: randomUUID() })
          .returning();
        assert.ok(category);
        const [product] = await tx
          .insert(posProducts)
          .values({ organizationId: org.id, categoryId: category.id, name: "Plate" })
          .returning();
        const [item] = await tx
          .insert(posOrderItems)
          .values({
            ...scope,
            orderId: present(order).id,
            productId: present(product).id,
            productName: "Plate",
            quantity: 2,
            unitPriceCents: 1500,
            grossCents: 3000,
            netCents: 3000,
            costCents: 3000,
          })
          .returning();
        assert.equal(
          (await overview.overview(identity.id, org.id, unit.id, "finance")).metrics.find(
            (metric) => metric.id === "gross-margin",
          )?.value,
          new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(0),
          "known equal cost produces an actual zero margin",
        );
        report = await reports.reports(identity.id, org.id, unit.id, period);
        assert.equal(report.incomeStatement.cmvCents, 3000);
        assert.equal(report.incomeStatement.grossMarginCents, 0);
        await tx
          .update(posOrderItems)
          .set({ costCents: null })
          .where(eq(posOrderItems.id, present(item).id));

        const [manual, deposit, canceled] = await tx
          .insert(managementAccountsReceivable)
          .values([
            {
              ...scope,
              sourceOrderId: present(order).id,
              description: "Additional service",
              amountCents: 700,
              competenceDate: period.from,
              dueDate: period.from,
              idempotencyKey: randomUUID(),
            },
            {
              ...scope,
              sourceOrderId: present(order).id,
              description: "Returnable deposit",
              amountCents: 300,
              competenceDate: period.from,
              dueDate: period.from,
              idempotencyKey: randomUUID(),
            },
            {
              ...scope,
              description: "Canceled",
              amountCents: 900,
              competenceDate: period.from,
              dueDate: period.from,
              idempotencyKey: randomUUID(),
              status: "canceled",
              canceledAt: day,
              canceledByIdentityId: identity.id,
              cancellationReason: "Canceled fixture",
            },
          ])
          .returning();
        assert.ok(manual && deposit && canceled);
        await tx.insert(managementReturnableDepositCharges).values({
          ...scope,
          orderId: present(order).id,
          receivableId: deposit.id,
          amountCents: 300,
          idempotencyKey: randomUUID(),
          chargedByIdentityId: identity.id,
        });
        await tx.insert(managementReceivableLines).values({
          ...scope,
          receivableId: canceled.id,
          description: "Must not affect coverage",
          revenueCents: 900,
          costCents: 900,
        });
        await tx.insert(managementReceivablePayments).values([
          {
            ...scope,
            receivableId: manual.id,
            amountCents: 400,
            method: "pix",
            idempotencyKey: randomUUID(),
            receivedByIdentityId: identity.id,
            receivedAt: day,
            status: "reversed",
            reversedByIdentityId: identity.id,
            reversedAt: nextDay,
            reversalReason: "Next day",
          },
          {
            ...scope,
            receivableId: manual.id,
            amountCents: 200,
            method: "pix",
            idempotencyKey: randomUUID(),
            receivedByIdentityId: identity.id,
            receivedAt: day,
            status: "reversed",
            reversedByIdentityId: identity.id,
            reversedAt: day,
            reversalReason: "Same day",
          },
          {
            ...scope,
            receivableId: deposit.id,
            amountCents: 300,
            method: "pix",
            idempotencyKey: randomUUID(),
            receivedByIdentityId: identity.id,
            receivedAt: day,
          },
        ]);
        const [payable] = await tx
          .insert(managementAccountsPayable)
          .values({
            ...scope,
            description: "Expense",
            amountCents: 600,
            competenceDate: period.from,
            dueDate: period.from,
            idempotencyKey: randomUUID(),
          })
          .returning();
        await tx.insert(managementPayablePayments).values({
          ...scope,
          payableId: present(payable).id,
          amountCents: 600,
          method: "pix",
          idempotencyKey: randomUUID(),
          paidByIdentityId: identity.id,
          paidAt: day,
          status: "reversed",
          reversedByIdentityId: identity.id,
          reversedAt: nextDay,
          reversalReason: "Next day",
        });
        report = await reports.reports(identity.id, org.id, unit.id, period);
        assert.equal(report.cashFlow.inflowsCents, 4200);
        assert.equal(report.cashFlow.outflowsCents, 600);
        assert.equal(report.cashFlow.netCents, 3600);
        assert.equal(
          report.incomeStatement.revenueCents,
          4000,
          "referenced independent AR and deposit remain included; canceled AR does not",
        );
        for (const [key, expected] of [
          ["cash_inflows", 4200],
          ["cash_outflows", 600],
          ["competence_revenue", 4000],
          ["competence_expenses", 600],
        ] as const) {
          const drill = await reports.drillDown(identity.id, org.id, unit.id, {
            ...period,
            dimension: "metric",
            key,
            limit: 100,
          });
          assert.equal(drill.totals.amountCents, expected);
          assert.equal(
            drill.rows.reduce((sum, row) => sum + Number(row.amountCents), 0),
            expected,
          );
        }
        const next = await reportFinancialTotals(tx, {
          ...financialScope,
          from: "2026-09-30",
          to: "2026-09-30",
        });
        assert.equal(
          next.cash_inflows.amountCents,
          -900,
          "POS and manual refunds belong to their local reversal day",
        );
        assert.equal(next.cash_outflows.amountCents, -600);
        assert.equal(next.competence_revenue.amountCents, 0);
        const [otherUnit] = await tx
          .insert(units)
          .values({ organizationId: org.id, name: "Isolated" })
          .returning();
        const foreign = await reportFinancialTotals(tx, {
          ...financialScope,
          unitId: present(otherUnit).id,
        });
        assert.equal(foreign.cash_inflows.amountCents, 0);
        assert.equal(foreign.competence_revenue.amountCents, 0);
        throw rollback;
      }),
      (error) => error === rollback,
    );
  } finally {
    await database.onModuleDestroy();
  }
});
