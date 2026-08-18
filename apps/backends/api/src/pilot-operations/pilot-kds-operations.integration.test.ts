import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { it } from "node:test";
import {
  auditEvents,
  identities,
  memberships,
  organizations,
  outboxEvents,
  posCatalogCategories,
  posKdsTickets,
  posOrders,
  posProductAvailability,
  posProductionStations,
  posProductPrices,
  posProductStations,
  posProducts,
  posTabs,
  roleBindings,
  units,
} from "@giromesa/db";
import { and, eq } from "drizzle-orm";
import { DatabaseService } from "../database/database.module.js";
import { ScopeService } from "../organizations/scope.service.js";
import { PilotPosService } from "./pilot-pos.service.js";
import { kdsReadModelSchema } from "./pilot-schemas.js";

function errorCode(error: unknown) {
  return (error as { getResponse?: () => { code?: string } }).getResponse?.().code;
}

it("coordinates KDS priority, terminal profiles and availability against PostgreSQL", async (context) => {
  const databaseUrl = process.env.PILOT_DATABASE_URL;
  if (!databaseUrl) {
    context.skip("PILOT_DATABASE_URL not configured");
    return;
  }
  process.env.DATABASE_URL = databaseUrl;
  const database = new DatabaseService();
  try {
    const runId = randomUUID();
    const documentPrefix = runId.replaceAll("-", "").slice(0, 13);
    const scope = new ScopeService(database);
    const pos = new PilotPosService(database, scope);
    const [organization] = await database.db
      .insert(organizations)
      .values({
        legalName: "KDS Integration Ltda",
        tradeName: "KDS Integration",
        document: `${documentPrefix}9`,
        billingState: "active",
      })
      .returning();
    assert.ok(organization);
    const [unit] = await database.db
      .insert(units)
      .values({
        organizationId: organization.id,
        name: "Unidade KDS",
        timezone: "America/Sao_Paulo",
      })
      .returning();
    assert.ok(unit);
    const [owner, kdsOperator] = await database.db
      .insert(identities)
      .values([
        { email: `kds-owner+${runId}@example.test`, displayName: "KDS Owner" },
        { email: `kds-operator+${runId}@example.test`, displayName: "KDS Operator" },
      ])
      .returning();
    assert.ok(owner && kdsOperator);
    const [ownerMembership, kdsMembership] = await database.db
      .insert(memberships)
      .values([
        { identityId: owner.id, organizationId: organization.id, status: "active" },
        { identityId: kdsOperator.id, organizationId: organization.id, status: "active" },
      ])
      .returning();
    assert.ok(ownerMembership && kdsMembership);
    await database.db.insert(roleBindings).values([
      { membershipId: ownerMembership.id, role: "owner" },
      { membershipId: kdsMembership.id, unitId: unit.id, role: "kds" },
    ]);

    const [category] = await database.db
      .insert(posCatalogCategories)
      .values({ organizationId: organization.id, name: "Produção", slug: `kds-${runId}` })
      .returning();
    assert.ok(category);
    const [hotStation, coldStation, inactiveStation] = await database.db
      .insert(posProductionStations)
      .values([
        {
          organizationId: organization.id,
          unitId: unit.id,
          name: "Quente",
          code: `hot-${documentPrefix}`,
        },
        {
          organizationId: organization.id,
          unitId: unit.id,
          name: "Fria",
          code: `cold-${documentPrefix}`,
        },
        {
          organizationId: organization.id,
          unitId: unit.id,
          name: "Inativa",
          code: `inactive-${documentPrefix}`,
          active: false,
        },
      ])
      .returning();
    assert.ok(hotStation && coldStation && inactiveStation);
    const [product] = await database.db
      .insert(posProducts)
      .values({
        organizationId: organization.id,
        categoryId: category.id,
        name: "Prato multi-praça",
      })
      .returning();
    assert.ok(product);
    await database.db.insert(posProductPrices).values({
      organizationId: organization.id,
      unitId: unit.id,
      productId: product.id,
      priceCents: 2_500,
    });
    await database.db.insert(posProductAvailability).values({
      organizationId: organization.id,
      unitId: unit.id,
      productId: product.id,
      available: true,
      dailyStock: 5,
    });
    await database.db.insert(posProductStations).values([
      {
        organizationId: organization.id,
        unitId: unit.id,
        productId: product.id,
        stationId: hotStation.id,
      },
      {
        organizationId: organization.id,
        unitId: unit.id,
        productId: product.id,
        stationId: coldStation.id,
      },
    ]);
    const [tab] = await database.db
      .insert(posTabs)
      .values({
        organizationId: organization.id,
        unitId: unit.id,
        openedByIdentityId: owner.id,
        label: "Comanda KDS",
      })
      .returning();
    assert.ok(tab);
    const created = await pos.createOrder(
      owner.id,
      organization.id,
      unit.id,
      tab.id,
      `create-${runId}`,
      { items: [{ productId: product.id, quantity: 1, modifierOptionIds: [] }] },
    );
    const order = created.order as { id: string };
    const sent = await pos.sendOrder(owner.id, organization.id, unit.id, order.id, `send-${runId}`);
    const ticketIds = sent.ticketIds as string[];
    assert.equal(ticketIds.length, 2);

    const stationInstallationId = randomUUID();
    const passInstallationId = randomUUID();
    await pos.putKdsTerminalProfile(
      owner.id,
      organization.id,
      unit.id,
      stationInstallationId,
      `terminal-station-${runId}`,
      {
        mode: "station",
        stationId: hotStation.id,
        label: "Tela Quente",
        soundEnabled: true,
        fullscreenPreferred: true,
      },
    );
    await pos.putKdsTerminalProfile(
      owner.id,
      organization.id,
      unit.id,
      passInstallationId,
      `terminal-pass-${runId}`,
      {
        mode: "pass",
        stationId: null,
        label: "Passe Principal",
        soundEnabled: true,
        fullscreenPreferred: false,
      },
    );
    await assert.rejects(
      () =>
        pos.putKdsTerminalProfile(
          owner.id,
          organization.id,
          unit.id,
          randomUUID(),
          `terminal-inactive-${runId}`,
          {
            mode: "station",
            stationId: inactiveStation.id,
            label: "Tela Inativa",
            soundEnabled: false,
            fullscreenPreferred: false,
          },
        ),
      (error: unknown) => errorCode(error) === "STATION_NOT_ACTIVE",
    );
    await assert.rejects(
      () =>
        pos.setKdsOrderPriority(
          kdsOperator.id,
          organization.id,
          unit.id,
          order.id,
          `priority-station-${runId}`,
          {
            priority: 75,
            reason: "Pedido atrasado no salão",
            installationId: stationInstallationId,
          },
        ),
      (error: unknown) => errorCode(error) === "KDS_PASS_TERMINAL_REQUIRED",
    );
    const priorityKey = `priority-pass-${runId}`;
    const prioritized = await pos.setKdsOrderPriority(
      kdsOperator.id,
      organization.id,
      unit.id,
      order.id,
      priorityKey,
      {
        priority: 75,
        reason: "Pedido atrasado no salão",
        installationId: passInstallationId,
      },
    );
    assert.deepEqual([...prioritized.ticketIds].sort(), [...ticketIds].sort());
    assert.equal(
      (
        await pos.setKdsOrderPriority(
          kdsOperator.id,
          organization.id,
          unit.id,
          order.id,
          priorityKey,
          {
            priority: 75,
            reason: "Pedido atrasado no salão",
            installationId: passInstallationId,
          },
        )
      ).idempotentReplay,
      true,
    );
    const priorityRows = await database.db
      .select({ priority: posKdsTickets.priority })
      .from(posKdsTickets)
      .where(
        and(
          eq(posKdsTickets.organizationId, organization.id),
          eq(posKdsTickets.unitId, unit.id),
          eq(posKdsTickets.orderId, order.id),
        ),
      );
    assert.deepEqual(
      priorityRows.map(({ priority }) => priority),
      [75, 75],
    );
    const [storedOrder] = await database.db
      .select({
        priority: posOrders.kdsPriority,
        reason: posOrders.kdsPriorityReason,
        actor: posOrders.kdsPriorityUpdatedByIdentityId,
      })
      .from(posOrders)
      .where(eq(posOrders.id, order.id))
      .limit(1);
    assert.deepEqual(storedOrder, {
      priority: 75,
      reason: "Pedido atrasado no salão",
      actor: kdsOperator.id,
    });
    assert.equal(
      (
        await database.db
          .select({ id: outboxEvents.id })
          .from(outboxEvents)
          .where(
            and(
              eq(outboxEvents.topic, "pos.kds_order_priority_changed"),
              eq(outboxEvents.aggregateId, order.id),
            ),
          )
      ).length,
      1,
    );
    assert.equal(
      (
        await database.db
          .select({ id: auditEvents.id })
          .from(auditEvents)
          .where(
            and(
              eq(auditEvents.action, "pos.kds.order_priority_changed"),
              eq(auditEvents.entityId, order.id),
            ),
          )
      ).length,
      1,
    );

    const resetAt = new Date(Date.now() + 60 * 60_000);
    const unavailable = await pos.setKdsProductAvailability(
      owner.id,
      organization.id,
      unit.id,
      product.id,
      `availability-${runId}`,
      {
        available: false,
        reason: "Insumo em reposição",
        resetAt: resetAt.toISOString(),
        dailyStock: 3,
      },
    );
    assert.equal(unavailable.status, "unavailable");
    assert.equal(unavailable.remainingQuantity, 2);
    await database.db
      .update(posProductAvailability)
      .set({ operationalResetAt: new Date(Date.now() - 1_000) })
      .where(
        and(
          eq(posProductAvailability.organizationId, organization.id),
          eq(posProductAvailability.unitId, unit.id),
          eq(posProductAvailability.productId, product.id),
        ),
      );
    const availability = await pos.listKdsProductAvailability(owner.id, organization.id, unit.id);
    const availableAgain = availability.products.find((row) => row.productId === product.id);
    assert.equal(availableAgain?.status, "limited");
    assert.equal(availableAgain?.remainingQuantity, 2);
    assert.equal(availableAgain?.resetAt, null);

    const snapshot = await pos.snapshotKds(organization.id, unit.id);
    kdsReadModelSchema.parse(JSON.parse(JSON.stringify(snapshot)));
    assert.equal(
      (snapshot.capabilities as { orderPriorityOffline: boolean }).orderPriorityOffline,
      false,
    );
    assert.equal(
      (snapshot.stations as { capacity: { recommendation: { state: string } } }[]).every((row) =>
        ["normal", "strained", "overloaded"].includes(row.capacity.recommendation.state),
      ),
      true,
    );
    assert.equal(
      (snapshot.productAvailability as { productId: string; status: string }[]).find(
        (row) => row.productId === product.id,
      )?.status,
      "limited",
    );
  } finally {
    await database.onModuleDestroy();
  }
});
