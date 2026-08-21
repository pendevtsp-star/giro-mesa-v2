import assert from "node:assert/strict";
import { randomInt, randomUUID } from "node:crypto";
import { it } from "node:test";
import {
  identities,
  managementInventoryClosings,
  managementNfeImportLines,
  managementPurchaseReceipts,
  managementStockBalances,
  memberships,
  organizations,
  roleBindings,
  units,
} from "@giromesa/db";
import { and, eq } from "drizzle-orm";
import { DatabaseService } from "../database/database.module.js";
import { ScopeService } from "../organizations/scope.service.js";
import { ManagementService } from "./management.service.js";

function digits(length: number) {
  return Array.from({ length }, () => randomInt(0, 10)).join("");
}

function nfeAccessKey(issuerDocument: string) {
  const base = `352608${issuerDocument}55001000000099112345678`;
  const sum = [...base]
    .reverse()
    .reduce((total, digit, index) => total + Number(digit) * ((index % 8) + 2), 0);
  const candidate = 11 - (sum % 11);
  return `${base}${candidate >= 10 ? 0 : candidate}`;
}

function hasCode(expected: string) {
  return (error: unknown) => {
    const response = (error as { getResponse?: () => unknown }).getResponse?.();
    return Boolean(
      response && typeof response === "object" && (response as { code?: string }).code === expected,
    );
  };
}

it("confirms an NF-e atomically once and keeps the import tenant isolated", async (context) => {
  const databaseUrl = process.env.MANAGEMENT_DATABASE_URL;
  if (!databaseUrl) {
    context.skip("MANAGEMENT_DATABASE_URL not configured");
    return;
  }
  process.env.DATABASE_URL = databaseUrl;
  const database = new DatabaseService();
  try {
    const management = new ManagementService(database, new ScopeService(database));
    const recipientDocument = digits(14);
    const otherDocument = digits(14);
    const issuerDocument = digits(14);
    const [organization, otherOrganization] = await database.db
      .insert(organizations)
      .values([
        {
          legalName: "NF-e Integration Ltda",
          tradeName: "NF-e Integration",
          document: recipientDocument,
        },
        { legalName: "Other NF-e Ltda", tradeName: "Other NF-e", document: otherDocument },
      ])
      .returning();
    assert.ok(organization && otherOrganization);
    const [unit, otherUnit] = await database.db
      .insert(units)
      .values([
        { organizationId: organization.id, name: "NF-e Unit" },
        { organizationId: otherOrganization.id, name: "Other NF-e Unit" },
      ])
      .returning();
    const [identity, reviewerIdentity, inventoryIdentity, otherIdentity] = await database.db
      .insert(identities)
      .values([
        { email: `nfe-${randomUUID()}@example.test`, displayName: "NF-e Owner" },
        { email: `nfe-reviewer-${randomUUID()}@example.test`, displayName: "NF-e Reviewer" },
        { email: `inventory-${randomUUID()}@example.test`, displayName: "Inventory Operator" },
        { email: `nfe-other-${randomUUID()}@example.test`, displayName: "Other Owner" },
      ])
      .returning();
    assert.ok(
      unit && otherUnit && identity && reviewerIdentity && inventoryIdentity && otherIdentity,
    );
    const [membership, reviewerMembership, inventoryMembership, otherMembership] = await database.db
      .insert(memberships)
      .values([
        { identityId: identity.id, organizationId: organization.id, status: "active" },
        { identityId: reviewerIdentity.id, organizationId: organization.id, status: "active" },
        { identityId: inventoryIdentity.id, organizationId: organization.id, status: "active" },
        { identityId: otherIdentity.id, organizationId: otherOrganization.id, status: "active" },
      ])
      .returning();
    assert.ok(membership && reviewerMembership && inventoryMembership && otherMembership);
    await database.db.insert(roleBindings).values([
      { membershipId: membership.id, role: "owner" },
      { membershipId: reviewerMembership.id, role: "manager" },
      { membershipId: inventoryMembership.id, role: "inventory" },
      { membershipId: otherMembership.id, role: "owner" },
    ]);
    const supplier = await management.createSupplier(
      identity.id,
      organization.id,
      unit.id,
      `supplier-${randomUUID()}`,
      { name: "Emitente NF-e", document: issuerDocument },
    );
    const location = await management.createStockLocation(
      identity.id,
      organization.id,
      unit.id,
      `location-${randomUUID()}`,
      { name: "Depósito NF-e", code: `NFE${randomInt(1000, 9999)}` },
    );
    const accessKey = nfeAccessKey(issuerDocument);
    const xml = `<NFe><infNFe Id="NFe${accessKey}"><ide><mod>55</mod><serie>1</serie><nNF>99</nNF><dhEmi>2026-08-17T10:00:00-03:00</dhEmi></ide><emit><CNPJ>${issuerDocument}</CNPJ><xNome>Emitente NF-e</xNome></emit><dest><CNPJ>${recipientDocument}</CNPJ></dest><det nItem="1"><prod><cProd>NEW-1</cProd><cEAN>SEM GTIN</cEAN><xProd>Produto novo</xProd><NCM>22030000</NCM><CFOP>5102</CFOP><uCom>UN</uCom><qCom>2</qCom><vProd>10.00</vProd></prod></det><total><ICMSTot><vNF>10.00</vNF></ICMSTot></total></infNFe></NFe>`;
    const imported = await management.importNfe(
      identity.id,
      organization.id,
      unit.id,
      `import-${randomUUID()}`,
      { xml, supplierId: supplier.id },
    );
    const line = imported.lines[0];
    assert.ok(line);
    await management.reviewNfeImport(
      identity.id,
      organization.id,
      unit.id,
      imported.importId,
      `review-${randomUUID()}`,
      {
        lines: [
          {
            lineId: line.id,
            status: "new",
            newItem: {
              name: "Produto novo",
              kind: "ingredient",
              unit: "UN",
              purchaseToStockFactor: "1",
            },
          },
        ],
      },
    );
    const confirmed = await management.confirmNfeImport(
      identity.id,
      organization.id,
      unit.id,
      imported.importId,
      `confirm-${randomUUID()}`,
      { locationId: location.id, acceptTotalDivergence: false },
    );
    const [storedLine] = await database.db
      .select()
      .from(managementNfeImportLines)
      .where(eq(managementNfeImportLines.id, line.id));
    assert.ok(storedLine?.inventoryItemId);
    const [balance, receipts] = await Promise.all([
      database.db
        .select()
        .from(managementStockBalances)
        .where(
          and(
            eq(managementStockBalances.organizationId, organization.id),
            eq(managementStockBalances.unitId, unit.id),
            eq(managementStockBalances.inventoryItemId, storedLine.inventoryItemId),
          ),
        ),
      database.db
        .select()
        .from(managementPurchaseReceipts)
        .where(eq(managementPurchaseReceipts.purchaseOrderId, confirmed.purchaseOrderId)),
    ]);
    assert.equal(balance[0]?.quantity, "2.000");
    assert.equal(receipts.length, 1);
    await assert.rejects(
      management.importNfe(identity.id, organization.id, unit.id, `duplicate-${randomUUID()}`, {
        xml,
        supplierId: supplier.id,
      }),
      hasCode("NFE_ACCESS_KEY_DUPLICATE"),
    );
    await assert.rejects(
      management.reviewNfeImport(
        otherIdentity.id,
        otherOrganization.id,
        otherUnit.id,
        imported.importId,
        `tenant-${randomUUID()}`,
        { lines: [{ lineId: line.id, status: "ignored" }] },
      ),
      hasCode("NFE_IMPORT_NOT_FOUND"),
    );

    const container = await management.createInventoryItem(
      identity.id,
      organization.id,
      unit.id,
      `container-${randomUUID()}`,
      {
        name: "Casco 600 ml",
        kind: "returnable_container",
        unit: "UN",
        purchaseToStockFactor: "1",
        minimumQuantity: "0",
        reorderQuantity: "0",
        leadTimeDays: 0,
        allowNegative: false,
      },
    );
    await database.db.insert(managementStockBalances).values({
      organizationId: organization.id,
      unitId: unit.id,
      locationId: location.id,
      inventoryItemId: container.id,
      quantity: "5",
      averageCostCents: 200,
    });
    const incident = await management.createReturnableIncident(
      identity.id,
      organization.id,
      unit.id,
      `incident-${randomUUID()}`,
      {
        containerInventoryItemId: container.id,
        locationId: location.id,
        type: "breakage",
        quantity: "2",
        note: "Quebra confirmada durante a conferência.",
        evidence: [],
      },
    );
    await assert.rejects(
      management.reviewReturnableIncident(
        identity.id,
        organization.id,
        unit.id,
        incident.incidentId,
        `self-review-${randomUUID()}`,
        { decision: "approved", reason: "Aprovação pelo próprio registrante." },
      ),
      hasCode("RETURNABLE_INCIDENT_DUAL_CONTROL"),
    );
    await management.reviewReturnableIncident(
      reviewerIdentity.id,
      organization.id,
      unit.id,
      incident.incidentId,
      `manager-review-${randomUUID()}`,
      { decision: "approved", reason: "Quebra conferida por segundo responsável." },
    );
    const [containerBalance] = await database.db
      .select()
      .from(managementStockBalances)
      .where(
        and(
          eq(managementStockBalances.organizationId, organization.id),
          eq(managementStockBalances.unitId, unit.id),
          eq(managementStockBalances.locationId, location.id),
          eq(managementStockBalances.inventoryItemId, container.id),
        ),
      );
    assert.equal(containerBalance?.quantity, "3.000");

    const countReview = await management.recordInventoryEvent(
      inventoryIdentity.id,
      organization.id,
      unit.id,
      `count-${randomUUID()}`,
      {
        type: "count",
        reason: "Contagem cega com divergência material.",
        lines: [
          {
            inventoryItemId: container.id,
            locationId: location.id,
            quantity: "1",
          },
        ],
      },
    );
    assert.ok("requestId" in countReview);
    assert.equal(countReview.status, "pending");
    const [beforeApproval] = await database.db
      .select()
      .from(managementStockBalances)
      .where(
        and(
          eq(managementStockBalances.organizationId, organization.id),
          eq(managementStockBalances.unitId, unit.id),
          eq(managementStockBalances.locationId, location.id),
          eq(managementStockBalances.inventoryItemId, container.id),
        ),
      );
    assert.equal(beforeApproval?.quantity, "3.000");
    await management.reviewInventoryEvent(
      reviewerIdentity.id,
      organization.id,
      unit.id,
      countReview.requestId,
      `count-review-${randomUUID()}`,
      { decision: "approved", reason: "Divergência conferida por gerente." },
    );
    const [afterApproval] = await database.db
      .select()
      .from(managementStockBalances)
      .where(eq(managementStockBalances.id, beforeApproval.id));
    assert.equal(afterApproval?.quantity, "1.000");

    const destination = await management.createStockLocation(
      identity.id,
      organization.id,
      unit.id,
      `destination-${randomUUID()}`,
      {
        name: "Freezer NF-e",
        code: `FRZ${randomInt(1000, 9999)}`,
        kind: "freezer",
        requireDistinctTransferReceiver: true,
        transferSlaMinutes: 15,
      },
    );
    const transferBatch = await management.transferInventoryBatch(
      inventoryIdentity.id,
      organization.id,
      unit.id,
      `transfer-${randomUUID()}`,
      {
        sourceLocationId: location.id,
        destinationLocationId: destination.id,
        reason: "Reposição do bar.",
        lines: [{ inventoryItemId: container.id, quantity: "1" }],
      },
    );
    const transfer = transferBatch.transfers[0];
    assert.ok(transfer);
    assert.equal(transfer.status, "in_transit");
    const balancesInTransit = await database.db
      .select()
      .from(managementStockBalances)
      .where(eq(managementStockBalances.inventoryItemId, container.id));
    assert.equal(
      balancesInTransit.find((balance) => balance.locationId === location.id)?.quantity,
      "0.000",
    );
    assert.equal(
      balancesInTransit.find((balance) => balance.locationId === destination.id)?.quantity,
      "0.000",
    );
    await assert.rejects(
      management.resolveInventoryTransfer(
        inventoryIdentity.id,
        organization.id,
        unit.id,
        transfer.id,
        `transfer-self-${randomUUID()}`,
        { decision: "received", quantityReceived: "1", note: "Auto conferência." },
      ),
      hasCode("TRANSFER_DISTINCT_RECEIVER_REQUIRED"),
    );
    await management.resolveInventoryTransfer(
      reviewerIdentity.id,
      organization.id,
      unit.id,
      transfer.id,
      `transfer-partial-${randomUUID()}`,
      { decision: "received", quantityReceived: "0.6", note: "Recebimento parcial conferido." },
    );
    const partialDashboard = await management.inventoryDashboard(
      reviewerIdentity.id,
      organization.id,
      unit.id,
    );
    assert.equal(
      partialDashboard.transfers.find((row) => row.id === transfer.id)?.status,
      "partially_received",
    );
    await management.resolveInventoryTransfer(
      reviewerIdentity.id,
      organization.id,
      unit.id,
      transfer.id,
      `transfer-receive-${randomUUID()}`,
      { decision: "received", quantityReceived: "0.4", note: "Saldo final conferido." },
    );
    const [destinationBalance] = await database.db
      .select()
      .from(managementStockBalances)
      .where(
        and(
          eq(managementStockBalances.organizationId, organization.id),
          eq(managementStockBalances.unitId, unit.id),
          eq(managementStockBalances.locationId, destination.id),
          eq(managementStockBalances.inventoryItemId, container.id),
        ),
      );
    assert.equal(destinationBalance?.quantity, "1.000");

    const prepared = await management.createInventoryItem(
      identity.id,
      organization.id,
      unit.id,
      randomUUID(),
      {
        name: "Molho da casa",
        kind: "prepared",
        unit: "L",
        purchaseToStockFactor: "1",
        minimumQuantity: "0",
        reorderQuantity: "0",
        leadTimeDays: 0,
        allowNegative: false,
      },
    );
    const production = await management.createProductionBatch(
      identity.id,
      organization.id,
      unit.id,
      randomUUID(),
      {
        outputInventoryItemId: prepared.id,
        outputLocationId: destination.id,
        batchCode: `MOLHO-${randomInt(1000, 9999)}`,
        plannedQuantity: "1",
        inputs: [
          {
            inventoryItemId: container.id,
            locationId: destination.id,
            plannedQuantity: "1",
          },
        ],
      },
    );
    const productionDashboard = await management.inventoryDashboard(
      identity.id,
      organization.id,
      unit.id,
    );
    const productionInput = productionDashboard.productionBatches.find(
      (batch) => batch.id === production.id,
    )?.inputs[0];
    assert.ok(productionInput);
    const completed = await management.completeProductionBatch(
      identity.id,
      organization.id,
      unit.id,
      production.id,
      randomUUID(),
      {
        actualQuantity: "1",
        inputs: [{ inputId: productionInput.id, actualQuantity: "1" }],
      },
    );
    assert.equal(completed.status, "completed");
    assert.ok(completed.outputLotId);

    const reservation = await management.createInventoryReservation(
      identity.id,
      organization.id,
      unit.id,
      randomUUID(),
      {
        inventoryItemId: prepared.id,
        locationId: destination.id,
        quantity: "0.2",
        sourceType: "manual",
        sourceId: randomUUID(),
        reason: "Reserva para evento de integração.",
      },
    );
    const reservedDashboard = await management.inventoryDashboard(
      identity.id,
      organization.id,
      unit.id,
    );
    assert.equal(
      reservedDashboard.balances.find(
        (balance) =>
          balance.inventoryItemId === prepared.id && balance.locationId === destination.id,
      )?.availableQuantity,
      "0.800",
    );
    await management.resolveInventoryReservation(
      identity.id,
      organization.id,
      unit.id,
      reservation.id,
      randomUUID(),
      { decision: "released", note: "Evento remarcado pelo cliente." },
    );
    const plan = await management.generateCycleCountPlan(
      identity.id,
      organization.id,
      unit.id,
      randomUUID(),
    );
    assert.ok(plan.schedules.length > 0);

    const [destinationUnit] = await database.db
      .insert(units)
      .values({ organizationId: organization.id, name: "Unidade destino" })
      .returning();
    assert.ok(destinationUnit);
    const destinationUnitLocation = await management.createStockLocation(
      identity.id,
      organization.id,
      destinationUnit.id,
      randomUUID(),
      { name: "Estoque destino", code: `DST${randomInt(1000, 9999)}` },
    );
    const destinationPrepared = await management.createInventoryItem(
      identity.id,
      organization.id,
      destinationUnit.id,
      randomUUID(),
      {
        name: "Molho da casa",
        kind: "prepared",
        unit: "L",
        purchaseToStockFactor: "1",
        minimumQuantity: "0",
        reorderQuantity: "0",
        leadTimeDays: 0,
        allowNegative: false,
      },
    );
    const interunit = await management.createInterunitTransfer(
      identity.id,
      organization.id,
      unit.id,
      randomUUID(),
      {
        destinationUnitId: destinationUnit.id,
        reason: "Reposição da unidade destino.",
        lines: [
          {
            sourceInventoryItemId: prepared.id,
            destinationInventoryItemId: destinationPrepared.id,
            sourceLocationId: destination.id,
            destinationLocationId: destinationUnitLocation.id,
            sourceLotId: completed.outputLotId,
            quantity: "1",
          },
        ],
      },
    );
    const interunitLine = interunit.lines[0];
    assert.ok(interunitLine);
    await management.receiveInterunitTransfer(
      identity.id,
      organization.id,
      destinationUnit.id,
      interunit.id,
      randomUUID(),
      {
        note: "Recebimento parcial conferido.",
        lines: [{ lineId: interunitLine.id, quantity: "0.4" }],
      },
    );
    await management.cancelInterunitTransfer(
      identity.id,
      organization.id,
      unit.id,
      interunit.id,
      randomUUID(),
      { reason: "Saldo em trânsito não será enviado." },
    );
    const [sourcePreparedBalance, destinationPreparedBalance] = await Promise.all([
      database.db
        .select()
        .from(managementStockBalances)
        .where(
          and(
            eq(managementStockBalances.unitId, unit.id),
            eq(managementStockBalances.inventoryItemId, prepared.id),
          ),
        ),
      database.db
        .select()
        .from(managementStockBalances)
        .where(
          and(
            eq(managementStockBalances.unitId, destinationUnit.id),
            eq(managementStockBalances.inventoryItemId, destinationPrepared.id),
          ),
        ),
    ]);
    assert.equal(sourcePreparedBalance[0]?.quantity, "0.600");
    assert.equal(destinationPreparedBalance[0]?.quantity, "0.400");

    const closing = await management.closeInventoryPeriod(
      identity.id,
      organization.id,
      unit.id,
      randomUUID(),
      { period: new Date().toISOString().slice(0, 7), notes: "Fechamento de integração." },
    );
    assert.equal(closing.lineCount > 0, true);
    await assert.rejects(
      database.db
        .update(managementInventoryClosings)
        .set({ notes: "Tentativa de alteração." })
        .where(eq(managementInventoryClosings.id, closing.id)),
      (error: unknown) =>
        (error as { cause?: { message?: string } }).cause?.message ===
        "inventory closings are immutable",
    );
  } finally {
    await database.onModuleDestroy();
  }
});
