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
  managementCashAdjustments,
  managementCashApprovalRequests,
  managementCashEntries,
  managementCashRegisters,
  managementCashRegisterTerminals,
  managementCashSettings,
  managementCashShiftResponsibilities,
  managementCashShifts,
  managementCashShiftTenderCounts,
  managementCashTransfers,
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
  managementPersonAccess,
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
  posPaymentAttemptResults,
  posPaymentAttempts,
  posPaymentDeviceCredentials,
  posPaymentDeviceDiagnostics,
  posPaymentReconciliations,
  posPaymentReversalResults,
  posPaymentReversals,
  posPaymentTerminalCertifications,
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
import {
  operationalCommands,
  organizations,
  terminalOperatorPins,
  terminalSessions,
  units,
} from "./schema.js";

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
    assert.ok(posTerminalProfiles.paymentProvider);
    assert.ok(posTerminalProfiles.paymentStatus);

    const migration = await readFile(
      new URL("../drizzle/0043_tricky_diamondback.sql", import.meta.url),
      "utf8",
    );
    assert.match(migration, /CREATE TABLE "pos_terminal_profiles"/);
    assert.match(migration, /pos_terminal_profiles_station_fk/);
  });

  it("persists trusted SmartPOS attempts separately from posted payments", async () => {
    for (const table of [posPaymentAttempts, posPaymentAttemptResults, posPaymentReversals]) {
      assert.ok(table.organizationId);
      assert.ok(table.unitId);
      assert.ok(table.installationId);
    }
    const migration = await readFile(
      new URL("../drizzle/0046_milky_zarek.sql", import.meta.url),
      "utf8",
    );
    assert.match(migration, /pos_payment_attempts_device_fk/);
    assert.match(migration, /pos_tab_payments_attempt_unique/);
    assert.match(migration, /pos_payment_attempt_results_device_result_unique/);
    for (const table of [
      posPaymentDeviceCredentials,
      posPaymentDeviceDiagnostics,
      posPaymentTerminalCertifications,
      posPaymentReversalResults,
      posPaymentReconciliations,
    ]) {
      assert.ok(table.organizationId);
      assert.ok(table.unitId);
    }
    const hardeningMigration = await readFile(
      new URL("../drizzle/0047_narrow_slyde.sql", import.meta.url),
      "utf8",
    );
    assert.match(hardeningMigration, /pos_payment_attempt_results_attempt_fk/);
    assert.match(hardeningMigration, /pos_tab_payments_attempt_fk/);
    assert.match(hardeningMigration, /pos_payment_reversals_payment_attempt_fk/);
    assert.match(hardeningMigration, /Cannot backfill payment_attempt_id/);
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

  it("persists an immutable, tenant-scoped cash ledger", async () => {
    assert.equal(getTableName(managementCashEntries), "management_cash_entries");
    for (const table of [managementCashEntries, managementCashShifts]) {
      assert.ok(table.organizationId);
      assert.ok(table.unitId);
    }
    assert.ok(managementCashEntries.cashShiftId);
    assert.ok(managementCashEntries.direction);
    assert.ok(managementCashEntries.entryType);
    assert.ok(managementCashEntries.paymentMethod);
    assert.ok(managementCashEntries.affectsDrawer);
    assert.ok(managementCashEntries.sourceType);
    assert.ok(managementCashEntries.sourceId);
    assert.ok(managementCashEntries.actorIdentityId);
    assert.ok(managementCashShifts.closedByIdentityId);
    assert.ok(managementCashShifts.reviewedByIdentityId);
    assert.ok(managementCashShifts.reviewedAt);
    assert.ok(managementCashShifts.reviewNote);
    assert.ok(managementCashShifts.reviewIdempotencyKey);

    const migration = await readFile(
      new URL("../drizzle/0048_cash_ledger.sql", import.meta.url),
      "utf8",
    );
    assert.match(migration, /management_cash_entries_source_unique/);
    assert.match(migration, /management_cash_entries_shift_fk/);
    assert.match(migration, /management_cash_entries_immutable/);
    assert.match(migration, /management_cash_shifts_review_idempotency_unique/);
  });

  it("persists multiple cash registers, terminal assignments and transfers", async () => {
    for (const table of [
      managementCashRegisters,
      managementCashRegisterTerminals,
      managementCashTransfers,
    ]) {
      assert.ok(table.organizationId);
      assert.ok(table.unitId);
    }
    assert.ok(managementCashRegisters.name);
    assert.ok(managementCashRegisters.active);
    assert.ok(managementCashRegisterTerminals.installationId);
    assert.ok(managementCashRegisterTerminals.cashRegisterId);
    assert.ok(managementCashTransfers.fromCashShiftId);
    assert.ok(managementCashTransfers.toCashShiftId);
    assert.ok(managementCashTransfers.amountCents);
    assert.ok(managementCashTransfers.idempotencyKey);
    assert.ok(managementCashShifts.cashRegisterId);

    const migration = await readFile(
      new URL("../drizzle/0049_cash_registers.sql", import.meta.url),
      "utf8",
    );
    assert.match(migration, /CREATE TABLE "management_cash_registers"/);
    assert.match(migration, /CREATE TABLE "management_cash_register_terminals"/);
    assert.match(migration, /CREATE TABLE "management_cash_transfers"/);
    assert.match(migration, /INSERT INTO "management_cash_registers"/);
    assert.match(migration, /FROM "units"/);
    assert.match(migration, /ALTER COLUMN "cash_register_id" SET NOT NULL/);
    assert.match(migration, /management_cash_shifts_one_open_unique/);
    assert.match(migration, /'transfer_in','transfer_out'/);
  });

  it("persists advanced cash controls and append-only adjustments", async () => {
    for (const table of [
      managementCashSettings,
      managementCashShiftResponsibilities,
      managementCashShiftTenderCounts,
      managementCashApprovalRequests,
      managementCashAdjustments,
    ]) {
      assert.ok(table.organizationId);
      assert.ok(table.unitId);
    }
    assert.ok(managementCashSettings.movementApprovalThresholdCents);
    assert.ok(managementCashSettings.discrepancyCriticalThresholdCents);
    assert.ok(managementCashSettings.maxShiftMinutes);
    assert.ok(managementCashShifts.currentResponsibleIdentityId);
    assert.ok(managementCashShiftResponsibilities.fromIdentityId);
    assert.ok(managementCashShiftResponsibilities.toIdentityId);
    assert.ok(managementCashShiftTenderCounts.expectedCents);
    assert.ok(managementCashShiftTenderCounts.observedCents);
    assert.ok(managementCashShiftTenderCounts.differenceCents);
    assert.ok(managementCashApprovalRequests.executedMovementId);
    assert.ok(managementCashApprovalRequests.executedTransferId);
    assert.ok(managementCashAdjustments.originalCashShiftId);
    assert.ok(managementCashAdjustments.sourceId);

    const migration = await readFile(
      new URL("../drizzle/0052_cash_controls.sql", import.meta.url),
      "utf8",
    );
    assert.match(migration, /CREATE TABLE "management_cash_settings"/);
    assert.match(migration, /CREATE TABLE "management_cash_shift_responsibilities"/);
    assert.match(migration, /CREATE TABLE "management_cash_shift_tender_counts"/);
    assert.match(migration, /CREATE TABLE "management_cash_approval_requests"/);
    assert.match(migration, /CREATE TABLE "management_cash_adjustments"/);
    assert.match(migration, /SET "current_responsible_identity_id" = "operator_identity_id"/);
    assert.match(migration, /ALTER COLUMN "current_responsible_identity_id" SET NOT NULL/);
    assert.match(migration, /management_cash_approval_requests_movement_fk/);
    assert.match(migration, /management_cash_approval_requests_transfer_fk/);
    assert.match(migration, /management_cash_adjustments_immutable/);
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

  it("persists person access ownership and scoped quick-switch sessions", async () => {
    assert.ok(managementPersonAccess.invitationId);
    assert.ok(managementPersonAccess.membershipId);
    assert.ok(managementPersonAccess.roleBindingId);
    assert.ok(terminalOperatorPins.pinHash);
    assert.ok(terminalSessions.organizationId);
    assert.ok(terminalSessions.unitId);
    assert.ok(terminalSessions.activeActorMembershipId);
    assert.ok(terminalSessions.actorEpoch);
    assert.ok(terminalSessions.lockedUntil);
    assert.ok(terminalSessions.deviceId);

    const migration = await readFile(
      new URL("../drizzle/0051_regular_prowler.sql", import.meta.url),
      "utf8",
    );
    assert.match(migration, /CREATE TABLE "management_person_access"/);
    assert.match(migration, /CREATE TABLE "terminal_operator_pins"/);
    assert.match(migration, /CREATE TABLE "terminal_sessions"/);
    assert.match(migration, /terminal_sessions_organization_unit_fk/);
    assert.doesNotMatch(migration, /management_cash_adjustments/);

    const multiunitMigration = await readFile(
      new URL("../drizzle/0053_petite_trauma.sql", import.meta.url),
      "utf8",
    );
    assert.match(multiunitMigration, /management_person_access_person_unit_pk/);
    assert.match(multiunitMigration, /DROP CONSTRAINT "management_person_access_pkey"/);
    assert.match(multiunitMigration, /ADD COLUMN "device_id"/);
  });
});
