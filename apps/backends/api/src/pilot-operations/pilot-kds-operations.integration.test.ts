import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { it } from "node:test";
import {
  auditEvents,
  deviceEnrollments,
  hubCommands,
  identities,
  memberships,
  organizations,
  outboxEvents,
  posCatalogCategories,
  posKdsTicketItems,
  posKdsTickets,
  posOrders,
  posPrintJobs,
  posProductAvailability,
  posProductionStations,
  posProductPrices,
  posProductStations,
  posProducts,
  posRecipeComponents,
  posTabs,
  roleBindings,
  units,
} from "@giromesa/db";
import { and, eq } from "drizzle-orm";
import { DatabaseService } from "../database/database.module.js";
import { ScopeService } from "../organizations/scope.service.js";
import { PilotPosService } from "./pilot-pos.service.js";
import { kdsReadModelSchema } from "./pilot-schemas.js";
import { PilotSmartPosService } from "./pilot-smartpos.service.js";
import { ProductionPrintingService } from "./production-printing.service.js";

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
    const productionPrinting = new ProductionPrintingService(database, scope);
    const pos = new PilotPosService(
      database,
      scope,
      new PilotSmartPosService(database, scope),
      productionPrinting,
    );
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
    const [hub] = await database.db
      .insert(deviceEnrollments)
      .values({
        organizationId: organization.id,
        unitId: unit.id,
        label: "Edge cozinha",
        syncKeyHash: runId.replaceAll("-", "").padEnd(64, "0").slice(0, 64),
      })
      .returning();
    assert.ok(hub);
    const createdPrinter = await productionPrinting.createPrinter(
      owner.id,
      organization.id,
      unit.id,
      `printer-create-${runId}`,
      {
        hubId: hub.id,
        label: "Impressora cozinha",
        host: "192.168.44.20",
        port: 9100,
        paperWidthMm: 80,
        charactersPerLine: 48,
        codeTable: 16,
        cut: true,
        supportsRasterGraphics: false,
        isDefault: false,
        documentTypes: ["kds_ticket"],
        fallbackPrinterId: null,
        active: true,
      },
    );
    const printer = createdPrinter.printer as { id: string; isDefault: boolean };
    assert.equal(printer.isDefault, true);
    await productionPrinting.updateStationPolicy(
      owner.id,
      organization.id,
      unit.id,
      hotStation.id,
      `policy-hot-${runId}`,
      { deliveryMode: "both", copies: 1, printerId: printer.id },
    );
    await productionPrinting.updateStationPolicy(
      owner.id,
      organization.id,
      unit.id,
      coldStation.id,
      `policy-cold-${runId}`,
      { deliveryMode: "printer_only", copies: 2, printerId: printer.id },
    );
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
        stage: 1,
      },
      {
        organizationId: organization.id,
        unitId: unit.id,
        productId: product.id,
        stationId: coldStation.id,
        stage: 2,
      },
    ]);
    await database.db.insert(posRecipeComponents).values({
      organizationId: organization.id,
      productId: product.id,
      ingredientName: "Base preparada",
      quantityMilli: 250,
      unit: "g",
    });
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
    const printJobIds = sent.printJobIds as string[];
    assert.equal(printJobIds.length, 2);
    const [orderSentOutbox] = await database.db
      .select({ payload: outboxEvents.payload })
      .from(outboxEvents)
      .where(and(eq(outboxEvents.topic, "pos.order.sent"), eq(outboxEvents.aggregateId, tab.id)))
      .limit(1);
    assert.deepEqual(orderSentOutbox?.payload, {
      organizationId: organization.id,
      unitId: unit.id,
      tabId: tab.id,
      orderId: order.id,
      ticketIds,
    });
    const replayedSend = await pos.sendOrder(
      owner.id,
      organization.id,
      unit.id,
      order.id,
      `send-${runId}`,
    );
    assert.equal(replayedSend.idempotentReplay, true);
    assert.deepEqual([...replayedSend.printJobIds].sort(), [...printJobIds].sort());
    const automaticJobs = await database.db
      .select({
        id: posPrintJobs.id,
        stationId: posPrintJobs.stationId,
        hubCommandId: posPrintJobs.hubCommandId,
      })
      .from(posPrintJobs)
      .innerJoin(
        posKdsTickets,
        and(
          eq(posKdsTickets.organizationId, posPrintJobs.organizationId),
          eq(posKdsTickets.unitId, posPrintJobs.unitId),
          eq(posKdsTickets.id, posPrintJobs.kdsTicketId),
        ),
      )
      .where(
        and(
          eq(posPrintJobs.organizationId, organization.id),
          eq(posPrintJobs.unitId, unit.id),
          eq(posKdsTickets.orderId, order.id),
        ),
      );
    assert.equal(automaticJobs.length, 2);
    assert.deepEqual(
      automaticJobs.map((job) => job.stationId).sort(),
      [hotStation.id, coldStation.id].sort(),
    );
    const executeCommands = await database.db
      .select({ id: hubCommands.id })
      .from(hubCommands)
      .where(
        and(
          eq(hubCommands.organizationId, organization.id),
          eq(hubCommands.unitId, unit.id),
          eq(hubCommands.type, "print_job.execute"),
        ),
      );
    assert.equal(executeCommands.length, 2);
    const printerOnlySnapshot = await pos.snapshotKds(organization.id, unit.id);
    assert.equal(
      (printerOnlySnapshot.stations as Array<{ id: string }>).some(
        (station) => station.id === coldStation.id,
      ),
      false,
    );
    assert.equal(
      (printerOnlySnapshot.tickets as Array<{ stationId: string }>).every(
        (ticket) => ticket.stationId === hotStation.id,
      ),
      true,
    );
    const explicitPrinterOnlySnapshot = await pos.snapshotKds(
      organization.id,
      unit.id,
      coldStation.id,
    );
    assert.equal((explicitPrinterOnlySnapshot.tickets as unknown[]).length, 0);

    const failedJob = automaticJobs.find((job) => job.stationId === hotStation.id);
    const unknownJob = automaticJobs.find((job) => job.stationId === coldStation.id);
    const failedCommandId = failedJob?.hubCommandId;
    const unknownCommandId = unknownJob?.hubCommandId;
    if (!failedJob || !unknownJob || !failedCommandId || !unknownCommandId) {
      assert.fail("Automatic production print jobs must have durable Hub commands");
    }
    await database.db.transaction((tx) =>
      productionPrinting.applyCommandResult(
        tx,
        { id: hub.id, organizationId: organization.id, unitId: unit.id },
        {
          commandId: failedCommandId,
          type: "print_job.execute",
          cloudPrintJobId: failedJob.id,
          localPrintJobId: null,
          printerId: printer.id,
          status: "failed",
          errorCode: "PAPER_OUT",
          duplicate: false,
        },
      ),
    );
    const reprinted = await pos.reprintJob(
      owner.id,
      organization.id,
      unit.id,
      failedJob.id,
      `reprint-failed-${runId}`,
      { reason: "Falha de papel confirmada pela cozinha" },
    );
    assert.equal(
      (reprinted.printJob as { reprintOfJobId: string; status: string }).reprintOfJobId,
      failedJob.id,
    );
    assert.equal((reprinted.printJob as { status: string }).status, "queued");

    await database.db.transaction((tx) =>
      productionPrinting.applyCommandResult(
        tx,
        { id: hub.id, organizationId: organization.id, unitId: unit.id },
        {
          commandId: unknownCommandId,
          type: "print_job.execute",
          cloudPrintJobId: unknownJob.id,
          localPrintJobId: null,
          printerId: printer.id,
          status: "confirmation_required",
          errorCode: "PRINTER_RESULT_UNKNOWN",
          duplicate: false,
        },
      ),
    );
    await assert.rejects(
      () =>
        pos.reprintJob(
          owner.id,
          organization.id,
          unit.id,
          unknownJob.id,
          `reprint-unknown-${runId}`,
          { reason: "Tentativa indevida antes da confirmação" },
        ),
      (error: unknown) => errorCode(error) === "PRINT_JOB_RESULT_CONFIRMATION_REQUIRED",
    );
    const resolvedUnknown = await productionPrinting.resolveUnknownPrintJob(
      owner.id,
      organization.id,
      unit.id,
      unknownJob.id,
      `resolve-unknown-${runId}`,
      { outcome: "printed", reason: "Operador confirmou a impressão física" },
    );
    assert.equal((resolvedUnknown.printJob as { status: string }).status, "printed");
    const replayedResolution = await productionPrinting.resolveUnknownPrintJob(
      owner.id,
      organization.id,
      unit.id,
      unknownJob.id,
      `resolve-unknown-${runId}`,
      { outcome: "printed", reason: "Operador confirmou a impressão física" },
    );
    assert.equal(replayedResolution.idempotentReplay, true);
    const [resolutionAudit] = await database.db
      .select({ id: auditEvents.id })
      .from(auditEvents)
      .where(
        and(
          eq(auditEvents.organizationId, organization.id),
          eq(auditEvents.unitId, unit.id),
          eq(auditEvents.action, "pos.print_job.unknown_resolved"),
          eq(auditEvents.entityId, unknownJob.id),
        ),
      )
      .limit(1);
    const [resolutionOutbox] = await database.db
      .select({ id: outboxEvents.id })
      .from(outboxEvents)
      .where(
        and(
          eq(outboxEvents.topic, "pos.print_job.unknown_resolved"),
          eq(outboxEvents.aggregateId, unknownJob.id),
        ),
      )
      .limit(1);
    assert.ok(resolutionAudit && resolutionOutbox);

    await productionPrinting.updateStationPolicy(
      owner.id,
      organization.id,
      unit.id,
      coldStation.id,
      `policy-cold-both-${runId}`,
      { deliveryMode: "both", copies: 2, printerId: printer.id },
    );

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
    const snapshotItems = snapshot.items as Array<{
      ticketId: string;
      item: { id: string };
      kds: { stage: number; dependencyHeld: boolean; held: boolean };
      recipe: Array<{ ingredientName: string }>;
    }>;
    const hotAssignment = snapshotItems.find(
      (entry) =>
        (snapshot.tickets as Array<{ id: string; stationId: string }>).find(
          (ticket) => ticket.id === entry.ticketId,
        )?.stationId === hotStation.id,
    );
    const coldAssignment = snapshotItems.find((entry) => entry !== hotAssignment);
    assert.ok(hotAssignment && coldAssignment);
    assert.deepEqual([hotAssignment.kds.stage, coldAssignment.kds.stage], [1, 2]);
    assert.equal(coldAssignment.kds.dependencyHeld, true);
    assert.equal(coldAssignment.recipe[0]?.ingredientName, "Base preparada");

    await pos.claimKdsTicket(
      kdsOperator.id,
      organization.id,
      unit.id,
      hotAssignment.ticketId,
      `claim-${runId}`,
      { installationId: stationInstallationId, leaseSeconds: 120 },
    );
    await pos.transitionKdsItem(
      kdsOperator.id,
      organization.id,
      unit.id,
      hotAssignment.ticketId,
      hotAssignment.item.id,
      `hot-start-${runId}`,
      { state: "preparing" },
    );
    await pos.transitionKdsItem(
      kdsOperator.id,
      organization.id,
      unit.id,
      hotAssignment.ticketId,
      hotAssignment.item.id,
      `hot-ready-${runId}`,
      { state: "ready" },
    );
    const [releasedCold] = await database.db
      .select({ held: posKdsTicketItems.held, dependencyHeld: posKdsTicketItems.dependencyHeld })
      .from(posKdsTicketItems)
      .where(
        and(
          eq(posKdsTicketItems.ticketId, coldAssignment.ticketId),
          eq(posKdsTicketItems.orderItemId, coldAssignment.item.id),
        ),
      );
    assert.deepEqual(releasedCold, { held: false, dependencyHeld: false });
    await pos.transitionKdsItem(
      kdsOperator.id,
      organization.id,
      unit.id,
      coldAssignment.ticketId,
      coldAssignment.item.id,
      `cold-start-${runId}`,
      { state: "preparing" },
    );
    await pos.transitionKdsItem(
      kdsOperator.id,
      organization.id,
      unit.id,
      coldAssignment.ticketId,
      coldAssignment.item.id,
      `cold-ready-${runId}`,
      { state: "ready" },
    );
    await pos.handoffKdsOrder(
      kdsOperator.id,
      organization.id,
      unit.id,
      order.id,
      `expedition-${runId}`,
      { target: "expedition" },
    );
    await pos.claimKdsRunner(
      kdsOperator.id,
      organization.id,
      unit.id,
      order.id,
      `runner-claim-${runId}`,
      {},
    );
    await pos.handoffKdsOrder(
      kdsOperator.id,
      organization.id,
      unit.id,
      order.id,
      `runner-pickup-${runId}`,
      { target: "runner" },
    );
    const served = await pos.handoffKdsOrder(
      kdsOperator.id,
      organization.id,
      unit.id,
      order.id,
      `runner-served-${runId}`,
      { target: "served" },
    );
    assert.equal(served.target, "served");
  } finally {
    await database.onModuleDestroy();
  }
});
