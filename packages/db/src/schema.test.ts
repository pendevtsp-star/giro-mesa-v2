import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { describe, it } from "node:test";
import { getTableName } from "drizzle-orm";
import {
  accountantRequests,
  accountingExports,
  fiscalDocumentEvents,
  fiscalDocumentItems,
  fiscalDocuments,
  fiscalPeriods,
  fiscalProfiles,
  fiscalWebhookReceipts,
  productTaxRevisions,
} from "./fiscal-schema.js";
import {
  deliveryCourierAssignments,
  deliveryCourierEvents,
  deliveryCouriers,
  deliveryNotifications,
  deliveryOrderStatusHistory,
  deliveryOrders,
  deliveryZones,
} from "./growth-schema.js";
import {
  managementCommissions,
  managementInterunitTransferLines,
  managementInterunitTransferReceipts,
  managementInterunitTransfers,
  managementInventoryAssetCondition,
  managementInventoryAssets,
  managementInventoryClosingLines,
  managementInventoryClosings,
  managementInventoryCountSchedules,
  managementInventoryIssueRoutes,
  managementInventoryItemKind,
  managementInventoryItems,
  managementInventoryReservations,
  managementInventoryReviewRequests,
  managementInventoryReviewStatus,
  managementInventorySupplierAliases,
  managementInventoryTransferReceipts,
  managementInventoryTransferStatus,
  managementInventoryTransfers,
  managementNfeImportLineStatus,
  managementNfeImportLines,
  managementNfeImports,
  managementPeople,
  managementProductionBatches,
  managementProductionBatchInputs,
  managementProductReturnables,
  managementPurchaseReceiptStatus,
  managementPurchaseReceipts,
  managementReturnableCustodyMovements,
  managementReturnableCustodyMovementType,
  managementReturnableIncidentStatus,
  managementReturnableIncidents,
  managementReturnableSupplierExchanges,
  managementSchedules,
  managementStockLocationItemSettings,
  managementStockLocationKind,
  managementStockLocations,
  managementSupplierInvoiceStatus,
  managementSupplierInvoices,
  managementTimeTrackingClosureStatus,
  managementTimeTrackingClosures,
} from "./management-schema.js";
import {
  posCatalogBranding,
  posCatalogPromotions,
  posCategoryUnitConfigs,
  posKdsAttentionAcknowledgements,
  posKdsBatchAssignments,
  posKdsBatches,
  posKdsItemChanges,
  posKdsTerminalProfiles,
  posKdsTicketItems,
  posKdsTickets,
  posOperationalShifts,
  posOrderItems,
  posOrders,
  posProductAvailability,
  posProductPrices,
  posProductStations,
  posProducts,
  posServiceSections,
  posShiftSectionTables,
  posShiftTableLayouts,
  posShiftTableTransfers,
  posTabs,
  posTerminalProfiles,
} from "./operations-schema.js";
import { operationalCommands, organizations, units } from "./schema.js";

describe("database schema", () => {
  it("keeps tenant scope in the operational core", () => {
    assert.equal(getTableName(organizations), "organizations");
    assert.equal(getTableName(units), "units");
    assert.equal(getTableName(operationalCommands), "operational_commands");
    assert.ok(operationalCommands.organizationId);
    assert.ok(operationalCommands.unitId);
    for (const table of [
      posServiceSections,
      posOperationalShifts,
      posShiftSectionTables,
      posShiftTableLayouts,
      posShiftTableTransfers,
    ]) {
      assert.ok(table.organizationId);
      assert.ok(table.unitId);
    }
  });

  it("persists unit-scoped terminal profiles", async () => {
    assert.ok(posTerminalProfiles.organizationId);
    assert.ok(posTerminalProfiles.unitId);
    assert.ok(posTerminalProfiles.installationId);
    assert.ok(posTerminalProfiles.printerId);
    assert.ok(posTerminalProfiles.quickActions);

    const migration = await readFile(
      new URL("../drizzle/0043_tricky_diamondback.sql", import.meta.url),
      "utf8",
    );
    assert.match(migration, /CREATE TABLE "pos_terminal_profiles"/);
    assert.match(migration, /pos_terminal_profiles_station_fk/);
  });

  it("persists unit-scoped advanced catalog state", () => {
    for (const table of [posCatalogBranding, posCatalogPromotions, posCategoryUnitConfigs]) {
      assert.ok(table.organizationId);
      assert.ok(table.unitId);
    }
    assert.ok(posProducts.metadata);
    assert.ok(posProducts.ean);
    assert.ok(posProductPrices.deliveryPriceCents);
    assert.ok(posProductPrices.costCents);
    assert.ok(posProductAvailability.dailyStock);
    assert.ok(posProductAvailability.stockDate);
  });

  it("persists delivery SLA configuration and deadlines", () => {
    assert.ok(deliveryZones.estimatedDeliveryMinutes);
    assert.ok(deliveryOrders.promisedAt);
  });

  it("persists tenant-scoped and auditable delivery operations", () => {
    assert.ok(deliveryOrders.courierId);
    assert.ok(deliveryOrders.addressValidationStatus);
    for (const table of [
      deliveryCouriers,
      deliveryCourierAssignments,
      deliveryCourierEvents,
      deliveryOrderStatusHistory,
      deliveryNotifications,
    ]) {
      assert.ok(table.organizationId);
      assert.ok(table.unitId);
    }
    assert.ok(deliveryNotifications.requestFingerprint);
    assert.ok(deliveryCourierEvents.requestFingerprint);
  });

  it("persists the item-level KDS lifecycle and per-order ready notification", () => {
    assert.ok(posTabs.readyNotificationConsent);
    assert.ok(posOrders.readyNotifiedAt);
    assert.ok(posOrders.kdsPriority);
    assert.ok(posOrders.kdsPriorityUpdatedByIdentityId);
    assert.ok(posOrders.runnerIdentityId);
    assert.ok(posOrders.runnerPickedUpAt);
    assert.ok(posProductAvailability.operationalReason);
    assert.ok(posProductAvailability.operationalResetAt);
    assert.ok(posKdsTerminalProfiles.installationId);
    assert.ok(posKdsTerminalProfiles.mode);
    assert.ok(posKdsTerminalProfiles.stationId);
    assert.ok(posOrderItems.estimatedPrepTimeMinutes);
    assert.ok(posKdsTickets.priority);
    assert.ok(posKdsTickets.dueAt);
    assert.ok(posKdsTickets.handedOffAt);
    assert.ok(posKdsTickets.servedAt);
    assert.ok(posKdsTickets.claimedByInstallationId);
    assert.ok(posKdsTickets.claimExpiresAt);
    assert.ok(posKdsTicketItems.quantity);
    assert.ok(posKdsTicketItems.readyQuantity);
    assert.ok(posKdsTicketItems.status);
    assert.ok(posKdsTicketItems.held);
    assert.ok(posKdsTicketItems.firedAt);
    assert.ok(posKdsTicketItems.stage);
    assert.ok(posKdsTicketItems.dependencyHeld);
    assert.ok(posKdsTicketItems.blockCode);
    assert.ok(posKdsTicketItems.blockedAt);
    assert.ok(posKdsTicketItems.blockedByIdentityId);
    assert.ok(posKdsTicketItems.blockCount);
    assert.ok(posKdsAttentionAcknowledgements.revision);
    assert.ok(posKdsAttentionAcknowledgements.acknowledgedByIdentityId);
    assert.ok(posKdsBatches.status);
    assert.ok(posKdsBatches.stationId);
    assert.ok(posKdsBatchAssignments.position);
    assert.ok(posKdsBatchAssignments.releasedAt);
    assert.ok(posKdsItemChanges.revision);
    assert.ok(posKdsItemChanges.acknowledgedAt);
    assert.ok(posProductStations.stage);
  });

  it("persists inventory extensions with tenant scope and auditable staging", () => {
    assert.deepEqual(managementInventoryItemKind.enumValues, [
      "ingredient",
      "prepared",
      "resale",
      "reusable",
      "returnable_container",
    ]);
    assert.ok(managementNfeImportLineStatus.enumValues.includes("new"));
    assert.deepEqual(managementReturnableCustodyMovementType.enumValues, [
      "issue",
      "return",
      "incident",
      "correction",
      "supplier_exchange",
    ]);
    assert.deepEqual(managementReturnableIncidentStatus.enumValues, [
      "pending",
      "approved",
      "rejected",
    ]);
    assert.deepEqual(managementInventoryReviewStatus.enumValues, [
      "pending",
      "approved",
      "rejected",
      "posted",
    ]);
    assert.deepEqual(managementInventoryTransferStatus.enumValues, [
      "in_transit",
      "partially_received",
      "received",
      "divergent",
      "canceled",
    ]);
    assert.ok(managementStockLocationKind.enumValues.includes("cooler"));
    assert.ok(managementStockLocationKind.enumValues.includes("returnables"));
    assert.deepEqual(managementInventoryAssetCondition.enumValues, [
      "good",
      "fair",
      "poor",
      "unusable",
    ]);
    assert.ok(managementInventoryItems.kind);

    for (const table of [
      managementProductReturnables,
      managementInventorySupplierAliases,
      managementNfeImports,
      managementNfeImportLines,
      managementReturnableCustodyMovements,
      managementReturnableIncidents,
      managementInventoryAssets,
      managementInventoryReviewRequests,
      managementInventoryTransfers,
      managementInventoryTransferReceipts,
      managementInventoryIssueRoutes,
      managementStockLocationItemSettings,
      managementReturnableSupplierExchanges,
      managementInventoryReservations,
      managementInventoryCountSchedules,
      managementProductionBatches,
      managementProductionBatchInputs,
      managementInventoryClosings,
      managementInventoryClosingLines,
    ]) {
      assert.ok(table.organizationId);
      assert.ok(table.unitId);
    }

    assert.ok(managementProductReturnables.quantityPerUnit);
    assert.ok(managementProductReturnables.depositCents);
    assert.ok(managementInventorySupplierAliases.supplierProductCode);
    assert.ok(managementNfeImports.accessKey);
    assert.ok(managementNfeImports.xmlSha256);
    assert.ok(managementNfeImports.idempotencyKey);
    assert.ok(managementNfeImportLines.status);
    assert.ok(managementReturnableCustodyMovements.quantityDelta);
    assert.ok(managementReturnableCustodyMovements.sourceId);
    assert.ok(managementReturnableCustodyMovements.idempotencyKey);
    assert.ok(managementReturnableIncidents.status);
    assert.ok(managementReturnableIncidents.evidenceMetadata);
    assert.ok(managementInventoryAssets.assetTag);
    assert.ok(managementInventoryReviewRequests.riskSummary);
    assert.ok(managementInventoryTransfers.status);
    assert.ok(managementInventoryTransfers.quantityReceived);
    assert.ok(managementInventoryTransfers.deadlineAt);
    assert.ok(managementInventoryTransferReceipts.quantityDivergent);
    assert.ok(managementInventoryIssueRoutes.locationId);
    assert.ok(managementStockLocationItemSettings.targetQuantity);
    assert.ok(managementStockLocations.requireDistinctTransferReceiver);
    assert.ok(managementReturnableSupplierExchanges.status);
    assert.ok(managementInventoryReservations.status);
    assert.ok(managementInventoryCountSchedules.nextDueAt);
    assert.ok(managementProductionBatches.actualQuantity);
    assert.ok(managementProductionBatchInputs.actualQuantity);
    assert.ok(managementInventoryClosings.period);
    assert.ok(managementInventoryClosings.locationId);
    assert.ok(managementInventoryClosings.shiftReference);
    assert.ok(managementInventoryClosingLines.reservedQuantity);
    assert.ok(managementInterunitTransfers.destinationUnitId);
    assert.ok(managementInterunitTransferLines.quantityReceived);
    assert.ok(managementInterunitTransferReceipts.lines);
  });

  it("persists auditable purchase reversals and complete NF-e data", () => {
    assert.deepEqual(managementPurchaseReceiptStatus.enumValues, ["posted", "reversed"]);
    assert.deepEqual(managementSupplierInvoiceStatus.enumValues, [
      "pending",
      "matched",
      "divergent",
      "confirmed",
      "canceled",
      "reversed",
    ]);

    for (const table of [managementPurchaseReceipts, managementSupplierInvoices]) {
      assert.ok(table.status);
      assert.ok(table.reversalReason);
      assert.ok(table.reversedAt);
      assert.ok(table.reversedByIdentityId);
      assert.ok(table.version);
    }

    assert.ok(managementSupplierInvoices.accessKey);
    assert.ok(managementSupplierInvoices.xmlContent);
    assert.ok(managementSupplierInvoices.series);
    assert.ok(managementSupplierInvoices.model);
    assert.ok(managementSupplierInvoices.taxTotalCents);
  });
  it("persists the tenant-scoped fiscal and accountant ledger", () => {
    for (const table of [
      fiscalProfiles,
      productTaxRevisions,
      fiscalDocuments,
      fiscalDocumentItems,
      fiscalDocumentEvents,
      fiscalPeriods,
      accountantRequests,
      accountingExports,
      fiscalWebhookReceipts,
    ]) {
      assert.ok(table.organizationId);
      assert.ok(table.unitId);
    }
    assert.ok(productTaxRevisions.classification);
    assert.ok(fiscalDocuments.snapshot);
    assert.ok(fiscalDocumentItems.taxSnapshot);
    assert.ok(accountantRequests.competence);
    assert.ok(accountingExports.sha256);
  });

  it("persists auditable people, schedule, commission and closure lifecycles", async () => {
    assert.ok(managementPeople.updatedByIdentityId);
    assert.ok(managementPeople.statusChangedAt);
    assert.ok(managementPeople.statusChangedByIdentityId);
    assert.ok(managementPeople.statusChangeReason);
    assert.ok(managementSchedules.canceledAt);
    assert.ok(managementSchedules.canceledByIdentityId);
    assert.ok(managementSchedules.cancellationReason);
    assert.ok(managementCommissions.reviewedAt);
    assert.ok(managementCommissions.reviewedByIdentityId);
    assert.ok(managementCommissions.reviewNote);
    assert.ok(managementCommissions.paidAt);
    assert.ok(managementCommissions.paidByIdentityId);
    assert.ok(managementCommissions.paymentNote);
    assert.ok(managementCommissions.canceledAt);
    assert.ok(managementCommissions.canceledByIdentityId);
    assert.ok(managementCommissions.cancellationReason);
    assert.deepEqual(managementTimeTrackingClosureStatus.enumValues, ["closed", "reopened"]);
    assert.ok(managementTimeTrackingClosures.idempotencyKey);
    assert.ok(managementTimeTrackingClosures.reopenedAt);
    assert.ok(managementTimeTrackingClosures.reopenedByIdentityId);
    assert.ok(managementTimeTrackingClosures.reopenReason);

    const migration = await readFile(
      new URL("../drizzle/0037_people_operational_integrity.sql", import.meta.url),
      "utf8",
    );
    assert.match(migration, /management_schedules_no_overlap_excl/);
    assert.match(migration, /management_time_tracking_closure_no_overlap_excl/);
    assert.match(migration, /CREATE EXTENSION IF NOT EXISTS btree_gist/);
  });
});
