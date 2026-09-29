import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { it } from "node:test";
import {
  fiscalDocuments,
  identities,
  managementSettlementSettings,
  memberships,
  organizations,
  posCatalogCategories,
  posOperationApprovals,
  posOrderItems,
  posOrders,
  posProducts,
  posTabPayments,
  posTabs,
  roleBindings,
  units,
} from "@giromesa/db";
import { eq } from "drizzle-orm";
import { DatabaseService } from "../database/database.module.js";
import { defaultSettlementConfig } from "../management/management-settlements.rules.js";
import { ScopeService } from "../organizations/scope.service.js";
import { PilotPosService } from "./pilot-pos.service.js";
import { approvalRequestSchema } from "./pilot-schemas.js";
import { PilotSmartPosService } from "./pilot-smartpos.service.js";

it("distributes account discount atomically with manager approval and preserves charges", async (context) => {
  if (!process.env.PILOT_DATABASE_URL) {
    context.skip("PILOT_DATABASE_URL not configured");
    return;
  }
  process.env.DATABASE_URL = process.env.PILOT_DATABASE_URL;
  const database = new DatabaseService();
  try {
    const run = randomUUID();
    const [org] = await database.db
      .insert(organizations)
      .values({
        legalName: "Discount QA",
        tradeName: "Discount QA",
        document: run.replaceAll("-", "").slice(0, 14),
        billingState: "active",
      })
      .returning();
    assert.ok(org);
    const [unit, otherUnit] = await database.db
      .insert(units)
      .values([
        { organizationId: org.id, name: "Discount" },
        { organizationId: org.id, name: "Other" },
      ])
      .returning();
    const [manager, cashier, otherManager] = await database.db
      .insert(identities)
      .values([
        { email: `manager-${run}@example.test`, displayName: "Manager" },
        { email: `cashier-${run}@example.test`, displayName: "Cashier" },
        { email: `manager2-${run}@example.test`, displayName: "Other manager" },
      ])
      .returning();
    assert.ok(unit && otherUnit && manager && cashier && otherManager);
    const [managerMember, cashierMember, otherMember] = await database.db
      .insert(memberships)
      .values([
        { identityId: manager.id, organizationId: org.id, status: "active" },
        { identityId: cashier.id, organizationId: org.id, status: "active" },
        { identityId: otherManager.id, organizationId: org.id, status: "active" },
      ])
      .returning();
    assert.ok(managerMember && cashierMember && otherMember);
    await database.db.insert(roleBindings).values([
      { membershipId: managerMember.id, role: "owner" },
      { membershipId: cashierMember.id, role: "cashier" },
      { membershipId: otherMember.id, role: "manager" },
    ]);
    const scope = new ScopeService(database);
    const service = new PilotPosService(database, scope, new PilotSmartPosService(database, scope));
    await service.setManagerPin(manager.id, org.id, unit.id, { pin: "1234" });
    await service.setManagerPin(otherManager.id, org.id, unit.id, { pin: "5678" });
    await database.db.insert(managementSettlementSettings).values({
      organizationId: org.id,
      unitId: unit.id,
      updatedByIdentityId: manager.id,
      configuration: {
        ...defaultSettlementConfig,
        serviceChargeEnabled: true,
        defaultServiceChargeBasisPoints: 800,
        serviceChargeApplication: "suggest_dine_in",
      },
    });
    const [localTab] = await database.db
      .insert(posTabs)
      .values({
        organizationId: org.id,
        unitId: unit.id,
        openedByIdentityId: manager.id,
        fulfillmentType: "dine_in",
      })
      .returning();
    assert.ok(localTab);
    assert.equal(
      (await service.getTab(manager.id, org.id, unit.id, localTab.id)).tab
        .suggestedServiceChargeBasisPoints,
      800,
    );
    await service.setServiceCharge(manager.id, org.id, unit.id, localTab.id, `restore-${run}`, {
      basisPoints: 800,
    });
    await service.setServiceCharge(manager.id, org.id, unit.id, localTab.id, `remove-${run}`, {
      basisPoints: 0,
    });
    const removedCharge = await service.getTab(manager.id, org.id, unit.id, localTab.id);
    assert.equal(removedCharge.tab.serviceChargeBasisPoints, 0);
    assert.equal(removedCharge.tab.suggestedServiceChargeBasisPoints, 800);
    const [category] = await database.db
      .insert(posCatalogCategories)
      .values({ organizationId: org.id, name: "QA", slug: "qa" })
      .returning();
    assert.ok(category);
    const [product] = await database.db
      .insert(posProducts)
      .values({ organizationId: org.id, categoryId: category.id, name: "QA product" })
      .returning();
    assert.ok(product);
    const [tab] = await database.db
      .insert(posTabs)
      .values({
        organizationId: org.id,
        unitId: unit.id,
        openedByIdentityId: manager.id,
        serviceChargeBasisPoints: 1000,
        tipCents: 200,
        deliveryFeeCents: 500,
        fulfillmentType: "delivery",
        totalCents: 2570,
      })
      .returning();
    assert.ok(tab);
    const [order] = await database.db
      .insert(posOrders)
      .values({
        organizationId: org.id,
        unitId: unit.id,
        tabId: tab.id,
        createdByIdentityId: manager.id,
      })
      .returning();
    assert.ok(order);
    const items = await database.db
      .insert(posOrderItems)
      .values(
        [1000, 800].map((grossCents, index) => ({
          organizationId: org.id,
          unitId: unit.id,
          orderId: order.id,
          productId: product.id,
          productName: `Item ${index}`,
          quantity: 1,
          unitPriceCents: grossCents,
          grossCents,
          discountCents: index === 0 ? 100 : 0,
          netCents: grossCents - (index === 0 ? 100 : 0),
        })),
      )
      .returning();
    const approval = {
      approverMembershipId: managerMember.id,
      pin: "1234",
      reason: "Cortesia da conta",
    };
    const discount = (amount: number, key: string) =>
      service.discountTab(manager.id, org.id, unit.id, tab.id, key, {
        discountCents: amount,
        approval,
      });
    const applied = await discount(201, `direct-${run}`);
    assert.deepEqual(applied.totals, {
      subtotalCents: 1800,
      discountCents: 301,
      serviceChargeCents: 149,
      tipCents: 200,
      totalCents: 2348,
    });
    assert.equal((await discount(201, `direct-${run}`)).idempotentReplay, true);
    const snapshot = await service.getTab(manager.id, org.id, unit.id, tab.id);
    assert.equal(snapshot.tab.discountCents, 301);
    assert.equal(snapshot.tab.deliveryFeeCents, 500);
    for (const original of items)
      assert.ok(
        (snapshot.items.find((item) => item.id === original.id)?.discountCents ?? 0) >=
          original.discountCents,
      );
    await assert.rejects(
      service.discountTab(cashier.id, org.id, unit.id, tab.id, `cashier-${run}`, {
        discountCents: 100,
        approval,
      }),
    );
    await assert.rejects(
      service.discountTab(otherManager.id, org.id, unit.id, tab.id, `foreignpin-${run}`, {
        discountCents: 100,
        approval,
      }),
    );
    await assert.rejects(
      service.discountTab(manager.id, org.id, otherUnit.id, tab.id, `scope-${run}`, {
        discountCents: 100,
        approval,
      }),
    );
    await assert.rejects(discount(1500, `excess-${run}`));
    assert.equal(
      approvalRequestSchema.safeParse({
        action: "tab_discount",
        discountCents: 100,
        reason: "Cortesia solicitada",
      }).success,
      true,
    );
    assert.equal(
      approvalRequestSchema.safeParse({
        action: "tab_discount",
        itemId: items[0]?.id,
        discountCents: 100,
        reason: "Inválida",
      }).success,
      false,
    );
    const request = await service.requestApproval(
      cashier.id,
      org.id,
      unit.id,
      tab.id,
      `request-${run}`,
      { action: "tab_discount", discountCents: 100, reason: "Cortesia solicitada" },
    );
    const listed = (await service.listApprovalRequests(manager.id, org.id, unit.id)).find(
      (row) => row.requestId === request.requestId,
    );
    assert.equal(listed?.itemId, null);
    assert.equal(listed?.productName, "Conta inteira");
    await assert.rejects(
      service.decideApprovalRequest(
        cashier.id,
        org.id,
        unit.id,
        request.requestId,
        "approved",
        `cashier-decision-${run}`,
        { pin: "1234" },
      ),
    );
    const decisions = await Promise.allSettled([
      service.decideApprovalRequest(
        manager.id,
        org.id,
        unit.id,
        request.requestId,
        "approved",
        `approved-${run}`,
        { pin: "1234" },
      ),
      service.decideApprovalRequest(
        manager.id,
        org.id,
        unit.id,
        request.requestId,
        "rejected",
        `rejected-${run}`,
        { pin: "1234" },
      ),
    ]);
    assert.equal(decisions.filter((result) => result.status === "fulfilled").length, 1);
    const winner = decisions[0]?.status === "fulfilled" ? "approved" : "rejected";
    const replay = await service.decideApprovalRequest(
      manager.id,
      org.id,
      unit.id,
      request.requestId,
      winner,
      `${winner}-${run}`,
      { pin: "1234" },
    );
    assert.equal("idempotentReplay" in replay && replay.idempotentReplay, true);
    const afterApproval = await service.getTab(manager.id, org.id, unit.id, tab.id);
    assert.equal(afterApproval.tab.discountCents, winner === "approved" ? 401 : 301);
    const previousDiscount = afterApproval.tab.discountCents;
    const [payment] = await database.db
      .insert(posTabPayments)
      .values({
        organizationId: org.id,
        unitId: unit.id,
        tabId: tab.id,
        method: "cash",
        amountCents: afterApproval.tab.totalCents,
        createdByIdentityId: manager.id,
      })
      .returning();
    assert.ok(payment);
    await assert.rejects(discount(1, `paid-${run}`));
    assert.equal(
      (await service.getTab(manager.id, org.id, unit.id, tab.id)).tab.discountCents,
      previousDiscount,
    );
    const [fiscal] = await database.db
      .insert(fiscalDocuments)
      .values({
        organizationId: org.id,
        unitId: unit.id,
        tabId: tab.id,
        model: "nfce",
        environment: "homologation",
        status: "authorized",
        idempotencyKey: `fiscal-${run}`,
        totalCents: afterApproval.tab.totalCents,
        snapshot: {},
      })
      .returning();
    assert.ok(fiscal);
    await assert.rejects(discount(1, `fiscal-discount-${run}`), (error: unknown) => {
      assert.equal(
        (error as { response?: { code?: string } }).response?.code,
        "DISCOUNT_REQUIRES_FISCAL_CANCELLATION",
      );
      return true;
    });
    const approvals = await database.db
      .select()
      .from(posOperationApprovals)
      .where(eq(posOperationApprovals.entityId, tab.id));
    assert.equal(approvals.length, winner === "approved" ? 2 : 1);
    await database.db.update(posTabs).set({ status: "closed" }).where(eq(posTabs.id, tab.id));
    await assert.rejects(discount(1, `closed-${run}`));
  } finally {
    await database.onModuleDestroy();
  }
});
