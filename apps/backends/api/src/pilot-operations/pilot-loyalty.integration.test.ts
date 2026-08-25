import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { it } from "node:test";
import {
  type Database,
  growthCustomers,
  identities,
  loyaltyLedger,
  loyaltyPrograms,
  organizations,
  posTabCustomerLinks,
  posTabs,
  units,
} from "@giromesa/db";
import { and, eq } from "drizzle-orm";
import { DatabaseService } from "../database/database.module.js";
import { ScopeService } from "../organizations/scope.service.js";
import { PilotPosService } from "./pilot-pos.service.js";

type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];
type LoyaltyHooks = {
  earnLoyaltyForClosedTab(
    tx: Transaction,
    actorIdentityId: string,
    organizationId: string,
    unitId: string,
    tabId: string,
    paidCents: number,
    closedAt: Date,
  ): Promise<typeof loyaltyLedger.$inferSelect | null>;
  reverseLoyaltyForReopenedTab(
    tx: Transaction,
    actorIdentityId: string,
    organizationId: string,
    unitId: string,
    tabId: string,
  ): Promise<typeof loyaltyLedger.$inferSelect | null>;
};

it("credits a linked customer once and reverses the credit once", async (context) => {
  const databaseUrl = process.env.PILOT_DATABASE_URL;
  if (!databaseUrl) {
    context.skip("PILOT_DATABASE_URL not configured");
    return;
  }
  process.env.DATABASE_URL = databaseUrl;
  const database = new DatabaseService();
  try {
    const runId = randomUUID();
    const [organization] = await database.db
      .insert(organizations)
      .values({
        legalName: "Loyalty integration Ltda",
        tradeName: "Loyalty integration",
        document: runId.replaceAll("-", "").slice(0, 14),
        billingState: "active",
      })
      .returning();
    assert.ok(organization);
    const [unit] = await database.db
      .insert(units)
      .values({ organizationId: organization.id, name: "Unidade" })
      .returning();
    const [identity] = await database.db
      .insert(identities)
      .values({ email: `loyalty-${runId}@example.test`, displayName: "Operador" })
      .returning();
    assert.ok(unit && identity);
    const [customer] = await database.db
      .insert(growthCustomers)
      .values({
        organizationId: organization.id,
        defaultUnitId: unit.id,
        name: "Cliente fidelidade",
        idempotencyKey: `test:${runId}`,
        requestFingerprint: "0".repeat(64),
      })
      .returning();
    const [program] = await database.db
      .insert(loyaltyPrograms)
      .values({ organizationId: organization.id, mode: "points", rate: "2" })
      .returning();
    const [tab] = await database.db
      .insert(posTabs)
      .values({
        organizationId: organization.id,
        unitId: unit.id,
        openedByIdentityId: identity.id,
        totalCents: 1_250,
      })
      .returning();
    assert.ok(customer && program && tab);
    await database.db.insert(posTabCustomerLinks).values({
      organizationId: organization.id,
      unitId: unit.id,
      tabId: tab.id,
      customerId: customer.id,
      linkedByIdentityId: identity.id,
    });

    const hooks = new PilotPosService(
      database,
      new ScopeService(database),
    ) as unknown as LoyaltyHooks;
    const closedAt = new Date();
    const earned = await database.db.transaction((tx) =>
      hooks.earnLoyaltyForClosedTab(
        tx,
        identity.id,
        organization.id,
        unit.id,
        tab.id,
        1_250,
        closedAt,
      ),
    );
    const duplicate = await database.db.transaction((tx) =>
      hooks.earnLoyaltyForClosedTab(
        tx,
        identity.id,
        organization.id,
        unit.id,
        tab.id,
        1_250,
        closedAt,
      ),
    );
    assert.equal(earned?.amount, 25);
    assert.equal(duplicate, null);

    const reversed = await database.db.transaction((tx) =>
      hooks.reverseLoyaltyForReopenedTab(tx, identity.id, organization.id, unit.id, tab.id),
    );
    const duplicateReversal = await database.db.transaction((tx) =>
      hooks.reverseLoyaltyForReopenedTab(tx, identity.id, organization.id, unit.id, tab.id),
    );
    assert.equal(reversed?.amount, -25);
    assert.equal(duplicateReversal, null);
    const entries = await database.db
      .select()
      .from(loyaltyLedger)
      .where(
        and(
          eq(loyaltyLedger.organizationId, organization.id),
          eq(loyaltyLedger.customerId, customer.id),
        ),
      );
    assert.equal(
      entries.reduce((balance, entry) => balance + entry.amount, 0),
      0,
    );
  } finally {
    await database.onModuleDestroy();
  }
});
