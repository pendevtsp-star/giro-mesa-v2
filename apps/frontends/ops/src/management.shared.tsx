import { Button, Card } from "@giromesa/ui";
import { useCallback, useEffect, useRef, useState } from "react";
import { ApiClientError } from "./api";
import type { ProfileId, RouteId } from "./domain";

export interface ManagementScope {
  organizationId: string;
  unitId: string;
  profileId: ProfileId;
  refreshToken?: number;
}

export type Row = Record<string, unknown>;

export type InventoryItemKind =
  | "ingredient"
  | "prepared"
  | "resale"
  | "reusable"
  | "returnable_container";

export interface InventoryCapabilities {
  canConfirmReturnables: boolean;
  canRecordReturnableIncident: boolean;
  canApproveReturnableIncident: boolean;
  canApproveInventoryRisk?: boolean;
  canResolveTransfers?: boolean;
  canManageAssets?: boolean;
  canManagePlanning?: boolean;
  canCloseInventory?: boolean;
  canTransferBetweenUnits?: boolean;
  canManageReturnablePolicy?: boolean;
  canTransferReturnableResponsibility?: boolean;
  canConfigureReturnables?: boolean;
  canManageReturnableDeposits?: boolean;
}

export interface InventoryItem {
  id: string;
  productId: string | null;
  preferredSupplierId: string | null;
  name: string;
  sku: string | null;
  barcode: string | null;
  unit: string;
  purchaseUnit: string | null;
  purchaseToStockFactor: number;
  minimumQuantity: number;
  reorderQuantity: number;
  leadTimeDays: number;
  allowNegative: boolean;
  returnableContainerItemId?: string | null;
  returnableQuantityPerUnit?: number | null;
  returnableDepositCents?: number | null;
  kind?: InventoryItemKind;
  active: boolean;
}

export interface ReturnablePosition {
  inventoryItemId: string;
  locationId: string | null;
  expectedQuantity: number;
  physicalQuantity: number;
  divergenceQuantity: number;
  oldestOutstandingAt: string | null;
  ageDays: number;
  depositExposureCents: number;
  updatedAt: string | null;
}

export interface ReturnableIncident {
  id: string;
  inventoryItemId: string;
  locationId: string | null;
  kind: "breakage" | "loss" | "suspected_theft" | "recording_error" | "other";
  quantity: number;
  status: "pending" | "approved" | "rejected";
  reason: string;
  actorName: string | null;
  occurredAt: string;
}

export interface ReturnableMovement {
  id: string;
  type: "issue" | "return" | "incident" | "correction" | "supplier_exchange";
  orderId: string | null;
  orderItemId: string | null;
  inventoryItemId: string;
  locationId: string | null;
  quantityDelta: number;
  context: Row;
  occurredAt: string;
}

export interface ReturnableCustody {
  id: string;
  inventoryItemId: string;
  locationId: string | null;
  orderId: string | null;
  orderItemId: string | null;
  responsibleIdentityId: string | null;
  responsibleName: string | null;
  counterpartyName: string | null;
  orderCode: string | null;
  tableLabel: string | null;
  dueAt: string | null;
  occurredAt: string;
  issuedQuantity: number;
  returnedQuantity: number;
  openQuantity: number;
  depositCents: number;
  ageDays: number;
  handoff: {
    toIdentityId: string;
    toIdentityName: string | null;
    toShiftReference: string | null;
    at: string;
  } | null;
}

export interface ReturnablePolicy {
  depositMode: "disabled" | "manual";
  defaultDueDays: number;
  returnableClosePolicy: "ignore" | "warn" | "block";
}

export interface ReturnableSectorReconciliation {
  inventoryItemId: string | null;
  locationId: string | null;
  fullEquivalentQuantity: number;
  emptyPhysicalQuantity: number;
  openCustodyQuantity: number;
  supplierInTransitQuantity: number;
  approvedLossQuantity: number;
  explainableBalanceQuantity: number | null;
  lastCountedAt: string | null;
  lastCountDifferenceQuantity: number | null;
}

export interface ReturnableConfigurationHealth {
  status: "healthy" | "attention";
  undecidedProductIds: string[];
  unlinkedReturnableProductIds: string[];
  missingDepositValueProductIds: string[];
  inactiveContainerLinkProductIds: string[];
}

export interface ReturnableClassificationStatus {
  productId: string;
  productName: string | null;
  containerInventoryItemId: string | null;
  active: boolean;
  classification: "returnable" | "non_returnable" | "undecided";
}

export interface StockLocation {
  id: string;
  name: string;
  code: string;
  barcode: string | null;
  kind: "warehouse" | "cooler" | "freezer" | "bar" | "kitchen" | "returnables" | "other";
  responsibleIdentityId: string | null;
  requireDistinctTransferReceiver: boolean;
  transferSlaMinutes: number;
  active: boolean;
}

export interface StockLocationItemSetting {
  locationId: string;
  inventoryItemId: string;
  minimumQuantity: number;
  targetQuantity: number;
  transferUnitLabel: string | null;
  unitsPerTransferUnit: number;
}

export interface InventoryIssueRoute {
  id: string;
  productId: string;
  stationId: string | null;
  locationId: string;
  active: boolean;
}

export interface SectorReplenishmentSuggestion {
  inventoryItemId: string;
  sourceLocationId: string;
  destinationLocationId: string;
  suggestedQuantity: number;
  transferUnitLabel: string | null;
  unitsPerTransferUnit: number;
}

export interface StockBalance {
  locationId: string;
  inventoryItemId: string;
  quantity: number;
  reservedQuantity: number;
  blockedQuantity: number;
  availableQuantity: number;
  averageCostCents: number | null;
}

export interface InventoryReservation {
  id: string;
  inventoryItemId: string;
  locationId: string;
  quantity: number;
  status: "active" | "consumed" | "released" | "canceled";
  sourceType: string;
  sourceId: string;
  reason: string;
  expiresAt: string | null;
  createdAt: string;
}

export interface InventoryCountSchedule {
  id: string;
  inventoryItemId: string;
  locationId: string;
  classification: "A" | "B" | "C";
  riskScore: number;
  frequencyDays: number;
  nextDueAt: string;
  lastCountedAt: string | null;
}

export interface InventoryForecast {
  inventoryItemId: string;
  horizonDays: number;
  expectedDemand: number;
  suggestedPurchaseQuantity: number;
  projectedAvailableQuantity: number;
}

export interface SupplierPerformance {
  supplierId: string;
  supplierName: string;
  fillRatePercent: number;
  onTimePercent: number;
  divergencePercent: number;
  priceVariationPercent: number | null;
}

export interface ProductionBatchInputRow {
  id: string;
  inventoryItemId: string;
  locationId: string;
  lotId: string | null;
  plannedQuantity: number;
  actualQuantity: number | null;
}

export interface ProductionBatch {
  id: string;
  outputInventoryItemId: string;
  outputLocationId: string;
  batchCode: string;
  plannedQuantity: number;
  actualQuantity: number | null;
  status: "planned" | "completed" | "canceled";
  expiresAt: string | null;
  createdAt: string;
  inputs: ProductionBatchInputRow[];
}

export interface InterunitTransferLine {
  id: string;
  sourceInventoryItemId: string;
  destinationInventoryItemId: string;
  sourceLocationId: string;
  destinationLocationId: string;
  sourceLotId: string | null;
  quantitySent: number;
  quantityReceived: number;
}

export interface InterunitTransfer {
  id: string;
  sourceUnitId: string;
  destinationUnitId: string;
  status: "in_transit" | "partially_received" | "received" | "canceled";
  reason: string;
  sentAt: string;
  lines: InterunitTransferLine[];
}

export interface InventoryClosing {
  id: string;
  period: string;
  locationId: string | null;
  shiftReference: string | null;
  totalValueCents: number;
  totalReservedValueCents: number;
  totalInTransitValueCents: number;
  lineCount: number;
  closedAt: string;
}

export interface InventoryLot {
  id: string;
  locationId: string;
  inventoryItemId: string;
  batchCode: string;
  expiresAt: string | null;
  quantity: number;
  unitCostCents: number | null;
  active: boolean;
}

export interface InventoryMovement {
  id: string;
  locationId: string;
  inventoryItemId: string;
  lotId: string | null;
  type: string;
  quantityDelta: number;
  unitCostCents: number | null;
  sourceType: string;
  actorName: string | null;
  reason: string | null;
  occurredAt: string;
}

export interface InventoryAutomation {
  pending: number;
  failed: number;
  lastProcessedAt: string | null;
}

export interface InventoryAsset {
  id: string;
  inventoryItemId: string;
  locationId: string;
  assetTag: string;
  status: "in_use" | "maintenance" | "damaged" | "retired";
  condition: "good" | "fair" | "poor" | "unusable";
  responsibleIdentityId: string | null;
  acquiredAt: string | null;
  lastMaintenanceAt: string | null;
  notes: string | null;
  version: number;
}

export interface InventoryReviewRequest {
  id: string;
  type: "count" | "loss" | "adjustment";
  reason: string;
  status: "pending" | "approved" | "rejected" | "posted";
  riskSummary: Row;
  requestedByIdentityId: string;
  createdAt: string;
}

export interface InventoryTransfer {
  id: string;
  inventoryItemId: string;
  sourceLocationId: string;
  destinationLocationId: string;
  sourceLotId: string | null;
  destinationLotId: string | null;
  quantity: number;
  quantityReceived: number;
  quantityDivergent: number;
  batchId: string | null;
  lineNumber: number;
  reason: string;
  status: "in_transit" | "partially_received" | "received" | "divergent" | "canceled";
  sentByName: string | null;
  receivedByName: string | null;
  canceledByName: string | null;
  deadlineAt: string;
  createdAt: string;
  receivedAt: string | null;
  canceledAt: string | null;
  resolutionNote: string | null;
  receipts: Array<{
    id: string;
    quantityReceived: number;
    quantityDivergent: number;
    divergenceReason: string | null;
    note: string;
    receivedByName: string | null;
    receivedAt: string;
  }>;
}

export interface InventoryPendingAction {
  id: string;
  type:
    | "inventory_review"
    | "transfer_receipt"
    | "nfe_review"
    | "returnable_incident"
    | "low_stock"
    | "expiring_lot"
    | "automation_failure"
    | "cycle_count_due"
    | "production_batch"
    | "interunit_transfer"
    | "expired_reservation";
  priority: "high" | "medium" | "low";
  title: string;
  detail: string;
  createdAt: string;
}

export interface InventoryData {
  locations: StockLocation[];
  items: InventoryItem[];
  balances: StockBalance[];
  lots: InventoryLot[];
  recentMovements: InventoryMovement[];
  automation: InventoryAutomation;
  assets: InventoryAsset[];
  inventoryReviewRequests: InventoryReviewRequest[];
  transfers: InventoryTransfer[];
  inTransitBalances: Array<{ inventoryItemId: string; quantity: number }>;
  locationItemSettings: StockLocationItemSetting[];
  issueRoutes: InventoryIssueRoute[];
  sectorReplenishmentSuggestions: SectorReplenishmentSuggestion[];
  inventoryOperators: Array<{ id: string; name: string }>;
  reservations: InventoryReservation[];
  countSchedules: InventoryCountSchedule[];
  productionBatches: ProductionBatch[];
  interunitTransfers: InterunitTransfer[];
  closings: InventoryClosing[];
  organizationUnits: Array<{ id: string; name: string }>;
  interunitCatalog: {
    items: Array<{
      id: string;
      unitId: string;
      name: string;
      sku: string | null;
      barcode: string | null;
    }>;
    locations: Array<{ id: string; unitId: string; name: string }>;
  };
  forecasts: InventoryForecast[];
  supplierPerformance: SupplierPerformance[];
  pendingActions: InventoryPendingAction[];
  returnables?: ReturnablePosition[];
  returnableIncidents?: ReturnableIncident[];
  physicalByLocation?: ReturnablesData["physicalByLocation"];
  custodyByLocation?: ReturnablesData["custodyByLocation"];
  fullContainersByLocation?: ReturnablesData["fullContainersByLocation"];
  supplierExchanges?: ReturnablesData["supplierExchanges"];
  lossIndicators?: ReturnablesData["lossIndicators"];
  openCustodies?: ReturnablesData["openCustodies"];
  reconciliation?: ReturnablesData["reconciliation"];
  configurationHealth?: ReturnablesData["configurationHealth"];
  classificationStatus?: ReturnablesData["classificationStatus"];
  returnablePendingActions?: ReturnablesData["pendingActions"];
  returnableClosings?: ReturnablesData["closings"];
  capabilities?: InventoryCapabilities | null;
}

export interface ReturnablesData {
  returnables: ReturnablePosition[];
  returnableIncidents: ReturnableIncident[];
  policy: ReturnablePolicy;
  capabilities: InventoryCapabilities | null;
  recentReturnableMovements: ReturnableMovement[];
  openCustodies: ReturnableCustody[];
  reconciliation: {
    totals: ReturnableSectorReconciliation;
    byLocation: ReturnableSectorReconciliation[];
  };
  configurationHealth: ReturnableConfigurationHealth;
  classificationStatus: ReturnableClassificationStatus[];
  pendingActions: Array<{
    id: string;
    title: string;
    detail: string;
    priority: "high" | "medium" | "low";
    createdAt: string;
  }>;
  closings: Array<{
    id: string;
    period: string;
    locationId: string | null;
    pendingCustodyQuantity: number;
    supplierInTransitQuantity: number;
    approvedLossQuantity: number;
    closedAt: string;
  }>;
  physicalByLocation: Array<{
    inventoryItemId: string;
    locationId: string;
    physicalQuantity: number;
  }>;
  custodyByLocation: Array<{
    inventoryItemId: string;
    locationId: string;
    expectedQuantity: number;
  }>;
  fullContainersByLocation: Array<{
    inventoryItemId: string;
    locationId: string;
    quantity: number;
  }>;
  supplierExchanges: Array<{
    id: string;
    inventoryItemId: string;
    locationId: string;
    supplierId: string;
    quantity: number;
    status: "in_transit" | "received" | "canceled";
    note: string;
    sentAt: string;
    resolvedAt: string | null;
  }>;
  lossIndicators: Array<{
    kind: ReturnableIncident["kind"];
    locationId: string | null;
    quantity: number;
    estimatedCostCents: number;
    incidentCount: number;
  }>;
}

export interface RecipeProduct {
  id: string;
  name: string;
  active: boolean;
}

export interface RecipeCatalog {
  products: RecipeProduct[];
}

export interface RecipeComponent {
  inventoryItemId: string;
  locationId: string;
  quantityMilli: number;
  lossBasisPoints: number;
}

export interface RecipeVersion {
  id: string;
  productId: string;
  version: number;
  validFrom: string;
  validUntil: string | null;
  components: RecipeComponent[];
}

export interface PurchaseOrder {
  id: string;
  humanNumber: number | null;
  version: number;
  supplierId: string | null;
  status: string;
  totalCents: number;
  expectedAt: string | null;
  approvedAt: string | null;
  approvedByIdentityId: string | null;
  rejectedAt: string | null;
  rejectedByIdentityId: string | null;
  rejectionReason: string | null;
  canceledAt: string | null;
  cancelReason: string | null;
  createdAt: string | null;
  updatedAt: string | null;
  notes: string | null;
}

export interface PurchaseOrderItem {
  id: string;
  purchaseOrderId: string;
  inventoryItemId: string;
  quantity: string;
  unitCostCents: number;
  receivedQuantity: string | null;
  totalCents: number | null;
  purchaseUnit: string | null;
  stockUnit: string | null;
  purchaseToStockFactor: number | null;
  itemName: string | null;
}

export interface PurchaseReceipt {
  id: string;
  purchaseOrderId: string;
  supplierId: string | null;
  totalCents: number | null;
  status: string;
  receivedByIdentityId: string | null;
  receivedAt: string | null;
  reversedAt: string | null;
  reversalReason: string | null;
  version: number;
}

export interface PurchaseReceiptLine {
  id: string;
  receiptId: string;
  purchaseOrderItemId: string;
  inventoryItemId: string;
  locationId: string;
  quantity: string;
  stockQuantity: string | null;
  unitCostCents: number | null;
  stockUnitCostCents: number | null;
  totalCents: number | null;
  lotId: string | null;
}

export interface Supplier {
  id: string;
  name: string;
  document: string | null;
  contactName: string | null;
  email: string | null;
  phone: string | null;
  address: string | null;
  notes: string | null;
  active: boolean;
  version: number;
}

export interface PurchaseInvoice {
  id: string;
  purchaseOrderId: string;
  documentNumber: string;
  documentKey: string | null;
  accessKey: string | null;
  series: string | null;
  model: string | null;
  taxTotalCents: number | null;
  status: string;
  amountCents: number;
  totalCents: number;
  issuedAt: string | null;
  competenceDate: string | null;
  dueDate: string | null;
  payableId: string | null;
  reconciliation: Row | null;
  reconciledAt: string | null;
  confirmedAt: string | null;
  confirmedByIdentityId: string | null;
  reversedAt: string | null;
  reversalReason: string | null;
  reconciliationLines: Row[];
  version: number;
}

export interface PurchaseInvoiceLine {
  id: string;
  invoiceId: string;
  purchaseOrderItemId: string;
  inventoryItemId: string;
  quantity: string;
  unitCostCents: number;
  totalCents: number;
}

export interface PurchaseSuggestion {
  inventoryItemId: string;
  itemName: string;
  supplierId: string | null;
  supplierName: string | null;
  currentQuantity: number;
  minimumQuantity: number;
  suggestedQuantity: string;
  purchaseUnit: string;
  stockUnit: string;
  purchaseToStockFactor: number;
  leadTimeDays: number;
  dailyConsumption: number;
  coverageDays: number | null;
  outstandingStockQuantity: number;
  reason: string | null;
}

export interface PurchaseMetric {
  key: string;
  value: number;
  label: string | null;
}

export interface PurchaseCapabilities {
  canCreate: boolean;
  canApprove: boolean;
  canReceive: boolean;
  canInvoice: boolean;
  canReconcile: boolean;
  canConfirmInvoice: boolean;
  canReverseReceipt: boolean;
  canCancelInvoice: boolean;
}

export interface PurchasePage {
  page: number;
  pageSize: number;
  total: number;
}

export interface PurchasesData {
  orders: PurchaseOrder[];
  items: PurchaseOrderItem[];
  receipts: PurchaseReceipt[];
  receiptLines: PurchaseReceiptLine[];
  suppliers: Supplier[];
  invoices: PurchaseInvoice[];
  invoiceLines: PurchaseInvoiceLine[];
  suggestions: PurchaseSuggestion[];
  metrics: PurchaseMetric[];
  capabilities: PurchaseCapabilities | null;
  page: PurchasePage | null;
}

export interface FinancialEntry {
  id: string;
  description: string;
  status: string;
  amountCents: number;
  settledCents: number;
  competenceDate: string;
  dueDate: string;
  direction: "payable" | "receivable";
  category: string | null;
  costCenter: string | null;
  documentNumber: string | null;
  notes: string | null;
  supplierName: string | null;
  installmentNumber: number | null;
  installmentCount: number | null;
  attachments: Array<{ name: string; url: string }>;
  version: number;
  payments: FinancialPayment[];
}

export interface FinancialPayment {
  id: string;
  amountCents: number;
  method: string;
  reference: string | null;
  status: "posted" | "reversed";
  occurredAt: string;
  reversalReason: string | null;
}

export interface FinanceApproval {
  id: string;
  direction: "payable" | "receivable";
  entryId: string;
  amountCents: number;
  method: string;
  reference: string | null;
  cashRegisterId: string | null;
  occurredAt: string | null;
  status: "pending" | "approved";
  requestedByIdentityId: string;
}

export interface FinanceReconciliationEntry {
  id: string;
  externalKey: string;
  paymentDirection: "payable" | "receivable";
  paymentId: string | null;
  grossCents: number;
  feeCents: number;
  netCents: number;
  status: "matched" | "unmatched" | "divergent" | "resolved";
  resolutionNote: string | null;
  version: number;
}

export interface FinanceData {
  entries: FinancialEntry[];
  reconciliationImports: Row[];
  reconciliationEntries: FinanceReconciliationEntry[];
  approvals: FinanceApproval[];
  settings: {
    paymentApprovalThresholdCents: number | null;
    requireDistinctApprover: boolean;
    dueSoonDays: number;
  };
  summary: {
    payableCents: number;
    receivableCents: number;
    projectedBalanceCents: number;
    overdueCount: number;
    dueTodayCount: number;
    dueSoonCount: number;
    unresolvedReconciliations: number;
  };
  projection: Array<{
    date: string;
    payableCents: number;
    receivableCents: number;
    balanceCents: number;
  }>;
  pagination: { page: number; pageSize: number; total: number; pageCount: number };
  capabilities: {
    canManage: boolean;
    canConfigure: boolean;
    canApprove: boolean;
    canOperateCash: boolean;
  };
}

export interface ReportData {
  period: { from: string; to: string };
  timezone: string | null;
  previousPeriod: { from: string; to: string } | null;
  comparison: {
    mode: ReportComparisonMode;
    revenueCents: number;
    previousRevenueCents: number | null;
    changeCents: number | null;
    changePercent: number | null;
  } | null;
  dailySeries: Array<{
    date: string;
    revenueCents: number;
    previousRevenueCents: number | null;
  }>;
  breakdowns: {
    products: ReportBreakdownRow[];
    categories: ReportBreakdownRow[];
    channels: ReportBreakdownRow[];
    paymentMethods: ReportBreakdownRow[];
  };
  cashFlow: {
    inflowsCents: number;
    outflowsCents: number;
    netCents: number;
    basis: string;
  };
  incomeStatement: {
    revenueCents: number;
    cmvCents: number | null;
    grossMarginCents: number | null;
    operatingExpensesCents: number | null;
    operatingResultCents: number | null;
    costCoverage: {
      coverage: "complete" | "partial" | "unavailable";
      missingCostLines: number;
      completeForRevenue: boolean;
    };
    basis: string;
  };
  meta: {
    generatedAt: string;
    dataThrough: string | null;
    sourceCounts: {
      posSales: number;
      receivablePayments: number;
      payablePayments: number;
      receivables: number;
      payables: number;
      costLines: number;
    };
    coverage: {
      sales: ReportCoverage;
      cashFlow: ReportCoverage;
      costs: ReportCoverage;
      budget: ReportCoverage;
      labor: ReportCoverage;
      reconciliation: ReportCoverage;
      forecast: ReportCoverage;
    };
    indicators: Record<
      string,
      { coverage: ReportCoverage; dataThrough: string | null; sources: string[] }
    >;
  } | null;
  capabilities: ReportCapabilities;
  budget: {
    coverage: ReportCoverage;
    basis: "calendar_month_prorated_by_days";
    targets: {
      posRevenueCents: number | null;
      cashInflowsCents: number | null;
      cashOutflowsCents: number | null;
      competenceRevenueCents: number | null;
      competenceExpensesCents: number | null;
      averageTicketCents: number | null;
      grossMarginCents: number | null;
      inventoryLossCents: number | null;
      canceledValueCents: number | null;
    };
    alerts: Array<{
      key: string;
      actualCents: number;
      targetCents: number;
      differenceCents: number;
      status: "on_track" | "attention";
      direction: "minimum" | "maximum";
    }>;
  } | null;
  reportFamilies: ReportFamilies;
}

export interface ReportFamilies {
  sales: {
    coverage: ReportCoverage;
    closedTabs: number;
    subtotalCents: number;
    discountsCents: number;
    netRevenueCents: number;
    averageTicketCents: number | null;
    guests: number;
    averageSpendPerGuestCents: number | null;
    hourly: Array<{ hour: number; closedTabs: number; revenueCents: number }>;
    comparison: ReportFamilyComparison;
  };
  exceptions: {
    coverage: ReportCoverage;
    canceledItems: number;
    canceledValueCents: number;
    discountedItems: number;
    itemDiscountCents: number;
    tabDiscountCents: number;
    cancellationReasons: Array<{ label: string; quantity: number; amountCents: number }>;
    comparison: ReportFamilyComparison;
  };
  inventory: {
    coverage: ReportCoverage;
    basis: "period_events_and_current_balance";
    lossEvents: number;
    lossQuantity: number;
    lossValueCents: number | null;
    stockoutItems: number;
    lowStockItems: number;
    currentInventoryValueCents: number | null;
    analysis: Array<{
      key: string;
      label: string;
      abcClass: "A" | "B" | "C" | null;
      consumedQuantity: number;
      consumedValueCents: number | null;
      currentQuantity: number;
      coverageDays: number | null;
    }>;
    comparison: ReportFamilyComparison;
  };
  purchasing: {
    coverage: ReportCoverage;
    orderCount: number;
    orderedCents: number | null;
    canceledOrders: number;
    receiptCount: number;
    receivedCents: number | null;
    suppliers: Array<{
      key: string;
      label: string;
      orderCount: number;
      orderedCents: number | null;
      receiptCount: number;
      receivedCents: number | null;
    }>;
    supplierPerformance: Array<{
      key: string;
      label: string;
      orderCount: number;
      receiptCount: number;
      onTimeRatePercent: number | null;
      averageLeadDays: number | null;
      priceVariancePercent: number | null;
    }>;
    comparison: ReportFamilyComparison;
  };
  operations: {
    coverage: ReportCoverage;
    closedTabs: number;
    dineInTabs: number;
    tableTurnovers: number;
    guests: number;
    averageGuestsPerTab: number | null;
    averageServiceMinutes: number | null;
    shifts: Array<{
      key: string;
      label: string;
      closedTabs: number;
      guests: number;
      revenueCents: number;
      averageServiceMinutes: number | null;
    }>;
    comparison: ReportFamilyComparison;
  };
  profitability: {
    coverage: ReportCoverage;
    grossMarginPercent: number | null;
    productProfitabilityCoverage: ReportCoverage;
    products: Array<{
      key: string;
      label: string;
      quantity: number;
      revenueCents: number;
      costCents: number | null;
      grossMarginCents: number | null;
      grossMarginPercent: number | null;
    }>;
    comparison: ReportFamilyComparison;
  };
  multiunit: {
    coverage: ReportCoverage;
    units: Array<{
      key: string;
      label: string;
      closedTabs: number;
      revenueCents: number;
      averageTicketCents: number | null;
      changePercent: number | null;
      rank: number;
      operatingDays: number;
      revenuePerOperatingDayCents: number | null;
      organizationRevenueSharePercent: number | null;
      sameStoreChangePercent: number | null;
      minimumComparableOperatingDays: number;
      comparableStoreEligible: boolean;
      seatCount: number;
      activeEmployees: number;
      openHours: number | null;
      revenuePerSeatCents: number | null;
      revenuePerOpenHourCents: number | null;
      revenuePerEmployeeCents: number | null;
    }>;
  };
  quality: {
    scorePercent: number;
    issues: Array<{
      key: string;
      label: string;
      count: number;
      severity: "info" | "warning" | "critical";
    }>;
  };
  labor: {
    coverage: ReportCoverage;
    costCoverage: ReportCoverage;
    scheduleCoverage: ReportCoverage;
    people: number;
    workedMinutes: number;
    scheduledMinutes: number;
    overtimeMinutes: number | null;
    laborCostCents: number | null;
    laborCostPercent: number | null;
    salesPerLaborHourCents: number | null;
    roles: Array<{
      roleLabel: string;
      people: number;
      workedMinutes: number;
      scheduledMinutes: number;
      overtimeMinutes: number;
      laborCostCents: number | null;
      costCoverage: ReportCoverage;
    }>;
  };
  reconciliation: {
    coverage: ReportCoverage;
    posRevenueCents: number;
    paymentCents: number;
    paymentDifferenceCents: number;
    fiscalAuthorizedCents: number;
    fiscalDifferenceCents: number;
    taxCents: number;
    documents: { total: number; authorized: number; rejected: number; canceled: number };
    external: {
      matched: number;
      unmatched: number;
      divergent: number;
      resolved: number;
      unmatchedCents: number;
      divergentCents: number;
    };
    closure: {
      status: "open" | "closed";
      closedAt: string | null;
      closedByIdentityId: string | null;
      note: string;
      evidence: string[];
      checklist: { payments: boolean; fiscal: boolean; external: boolean };
    };
  };
  forecast: {
    method: "weekday_seasonality_v2";
    available: boolean;
    minimumSampleDays: number;
    horizonDays: number;
    sampleDays: number;
    confidence: "low" | "medium" | "high";
    errorPercent: number | null;
    revenue: {
      dailyAverageCents: number;
      forecastCents: number;
      lowerBoundCents: number;
      upperBoundCents: number;
    };
    cash: { inflowsCents: number; outflowsCents: number; netCents: number };
    calendarSignals: Array<{
      date: string;
      reservations: number;
      guests: number;
      demandFloorCents: number;
      applied: boolean;
    }>;
    purchases: Array<{
      key: string;
      label: string;
      suggestedQuantity: number;
      dailyDemand: number;
    }>;
  };
}

export type ReportFamilyComparison = Record<
  string,
  {
    current: number | null;
    previous: number | null;
    change: number | null;
    changePercent: number | null;
  }
>;

export type ReportComparisonMode = "previous_period" | "previous_year" | "none";
export type ReportCoverage = "complete" | "partial" | "unavailable";

export interface ReportCapabilities {
  viewCosts: boolean;
  drillDown: boolean;
  export: boolean;
  manageBudget: boolean;
  manageSchedules: boolean;
  manageViews: boolean;
  manageAlerts: boolean;
  backfillCosts: boolean;
  emailDeliveryConfigured: boolean;
}

export interface ReportBreakdownRow {
  key: string;
  label: string;
  revenueCents: number;
  quantity: number;
}

export type ReportDrillDownDimension =
  | "metric"
  | "product"
  | "category"
  | "channel"
  | "payment_method"
  | "exception"
  | "inventory"
  | "purchase"
  | "operation"
  | "labor"
  | "reconciliation"
  | "forecast";

export interface ReportDrillDownData {
  period: { from: string; to: string };
  timezone: string | null;
  dimension: ReportDrillDownDimension;
  key: string;
  totals: { amountCents: number; quantity: number };
  rows: Array<{
    occurredAt: string | null;
    localDate: string;
    referenceType: string;
    referenceId: string;
    label: string;
    amountCents: number;
    quantity: number;
  }>;
  page: { nextCursor: string | null };
}

export type ReportBudgetMetric =
  | "pos_revenue"
  | "cash_inflows"
  | "cash_outflows"
  | "competence_revenue"
  | "competence_expenses"
  | "average_ticket"
  | "gross_margin"
  | "inventory_loss"
  | "canceled_value";

export interface ReportBudgetItem {
  metric: ReportBudgetMetric;
  targetCents: number;
  version: number;
}

export interface ReportBudgetMonth {
  month: string;
  items: ReportBudgetItem[];
}

export interface ReportExportData {
  id: string;
  status: "ready" | "failed";
  format: "csv" | "pdf" | "xlsx";
  filename: string;
  rowCount: number;
  sha256: string | null;
  requestedAt: string;
  completedAt: string | null;
  expiresAt: string | null;
}

export interface ReportScheduleData {
  id: string;
  name: string;
  frequency: "weekly" | "monthly";
  weekday: number | null;
  dayOfMonth: number | null;
  localTime: string;
  range: "previous_week" | "previous_month";
  comparisonMode: ReportComparisonMode;
  family:
    | "overview"
    | "sales"
    | "exceptions"
    | "inventory"
    | "purchasing"
    | "operations"
    | "profitability"
    | "multiunit"
    | "quality"
    | "labor"
    | "reconciliation"
    | "forecast";
  format: "csv" | "pdf" | "xlsx";
  delivery: "in_app" | "email";
  enabled: boolean;
  nextRunAt: string | null;
  lastRunAt: string | null;
  version: number;
}

export interface CashShift {
  id: string;
  cashRegisterId: string;
  cashRegisterName: string;
  status: string;
  openingCents: number;
  expectedCents: number | null;
  countedCents: number | null;
  differenceCents: number | null;
  openedAt: string | null;
  closedAt: string | null;
  operatorName: string | null;
  closedByName: string | null;
  reviewedByName: string | null;
  reviewedAt: string | null;
  reviewNote: string | null;
  currentResponsibleIdentityId: string | null;
  responsibleName: string | null;
  tenderBreakdown: CashTenderCount[];
  differenceSeverity: "none" | "warning" | "critical";
}

export interface CashTenderCount {
  method: string;
  expectedCents: number;
  observedCents: number;
  differenceCents: number;
  source: "manual" | "smartpos";
}

export interface CashRegister {
  id: string;
  name: string;
  active: boolean;
  openShiftId: string | null;
}

export interface CashRegisterTerminal {
  installationId: string;
  label: string;
  cashRegisterId: string | null;
  status: "online" | "offline" | "unpaired";
  lastSeenAt: string | null;
}

export interface CashSettings {
  movementApprovalThresholdCents: number;
  discrepancyCriticalThresholdCents: number;
  maxShiftMinutes: number;
}

export interface CashAlert {
  code: string;
  severity: "warning" | "critical";
  message: string;
  cashShiftId: string | null;
  cashRegisterId: string | null;
  installationId: string | null;
}

export interface CashOperator {
  identityId: string;
  name: string;
}

export interface CashApproval {
  id: string;
  kind: "supply" | "withdrawal" | "transfer";
  fromCashShiftId: string;
  toCashShiftId: string | null;
  amountCents: number;
  reason: string;
  requestedByName: string;
  status: "pending" | "approved" | "rejected";
  requestedAt: string | null;
}

export interface PendingCashTransfer {
  id: string;
  fromCashShiftId: string;
  toCashShiftId: string;
  fromCashRegisterName: string;
  toCashRegisterName: string;
  amountCents: number;
  reason: string;
  requestedByName: string;
  requestedAt: string | null;
  canDecide: boolean;
}

export interface CashAdjustment {
  id: string;
  cashRegisterId: string | null;
  originalCashShiftId: string | null;
  direction: "in" | "out";
  entryType: string;
  paymentMethod: string | null;
  affectsDrawer: boolean;
  amountCents: number;
  description: string | null;
  actorName: string | null;
  occurredAt: string | null;
}

export interface CashEntry {
  id: string;
  cashShiftId: string;
  direction: "in" | "out";
  entryType: string;
  paymentMethod: string | null;
  affectsDrawer: boolean;
  amountCents: number;
  description: string | null;
  actorName: string | null;
  occurredAt: string | null;
}

export interface PendingCashTab {
  id: string;
  label: string;
  totalCents: number;
  paidCents: number;
  remainingCents: number;
}

export interface CashCapabilities {
  canOpen: boolean;
  canMove: boolean;
  canClose: boolean;
  canReview: boolean;
  canViewExpected: boolean;
  canManageRegisters: boolean;
  canTransfer: boolean;
  canManageCashSettings: boolean;
  canManageTerminals: boolean;
  canApproveCashRequests: boolean;
  canHandover: boolean;
}

export interface CashData {
  settings: CashSettings;
  alerts: CashAlert[];
  operators: CashOperator[];
  approvals: CashApproval[];
  pendingTransfers: PendingCashTransfer[];
  adjustments: CashAdjustment[];
  registers: CashRegister[];
  availableTerminals: CashRegisterTerminal[];
  shifts: CashShift[];
  entries: CashEntry[];
  pendingTabs: PendingCashTab[];
  capabilities: CashCapabilities;
}

export interface CashHistoryItem {
  id: string;
  cashRegisterId: string;
  cashRegisterName: string;
  status: string;
  openingCents: number;
  expectedCents: number | null;
  countedCents: number | null;
  differenceCents: number | null;
  differenceSeverity: "none" | "warning" | "critical";
  openedAt: string | null;
  closedAt: string | null;
  operatorName: string | null;
  responsibleName: string | null;
  closedByName: string | null;
}

export interface CashHistoryPage {
  items: CashHistoryItem[];
  nextCursor: string | null;
}

export interface CashResponsibilityChange {
  id: string;
  fromName: string;
  toName: string;
  transferredByName: string;
  reason: string;
  occurredAt: string | null;
}

export interface CashShiftDetail {
  shift: CashHistoryItem;
  entries: CashEntry[];
  tenderCounts: CashTenderCount[];
  responsibilities: CashResponsibilityChange[];
  adjustments: CashAdjustment[];
}

export interface CashClosureResult {
  cashShiftId: string;
  status: string;
  expectedCents: number;
  countedCents: number;
  differenceCents: number;
  drawerInCents: number;
  drawerOutCents: number;
  breakdown: Array<{ method: string; amountCents: number }>;
  reviewRequired: boolean;
  differenceSeverity: "none" | "warning" | "critical";
  tenderBreakdown: CashTenderCount[];
}

export interface Person {
  id: string;
  identityId: string | null;
  name: string;
  roleLabel: string;
  employmentCode?: string | null;
  active: boolean;
  hourlyRateCents: number | null;
  updatedAt?: string;
  statusReason?: string | null;
  statusChangedAt?: string | null;
  access: PersonAccess;
}

export type PersonAccessStatus = "none" | "pending" | "expired" | "active" | "suspended";

export interface PersonAccess {
  status: PersonAccessStatus;
  email: string | null;
  role: string | null;
  invitationId: string | null;
  expiresAt: string | null;
  membershipId: string | null;
}

export interface ManagedTerminalSession {
  id: string;
  deviceId: string | null;
  openedBy: string;
  activeOperator: string | null;
  status: "waiting" | "active" | "locked";
  createdAt: string;
  lastActivityAt: string | null;
  lockedUntil: string | null;
  expiresAt: string;
}

export interface PeopleAccessCenterData {
  terminals: ManagedTerminalSession[];
}

export interface PersonOffboardingPreflight {
  canProceed: boolean;
  counts: {
    openTimeEntries: number;
    futureSchedules: number;
    unsettledCommissions: number;
    openCashShifts: number;
    activeTerminals: number;
    accessAssignments: number;
  };
  checks: Array<{
    code: string;
    label: string;
    count: number;
    severity: "blocker" | "warning" | "info";
  }>;
}

export interface PersonAccessOverviewData {
  units: Array<{ id: string; name: string; active: boolean }>;
  assignments: Array<{
    unitId: string;
    unitName: string;
    primary: boolean;
    access: PersonAccess;
    delivery: null | {
      status: "queued" | "sent" | "failed";
      attempts: number;
      processedAt: string | null;
      lastError: string | null;
    };
  }>;
  history: Array<{
    id: string;
    action: string;
    actorName: string;
    metadata: Record<string, unknown>;
    occurredAt: string;
  }>;
  offboarding: PersonOffboardingPreflight;
}

export interface Schedule {
  id: string;
  personId: string;
  startsAt: string;
  endsAt: string;
  breakMinutes: number;
  notes?: string | null;
  status?: "active" | "canceled";
  canceledAt?: string | null;
  cancelReason?: string | null;
  updatedAt?: string;
}

export interface CommissionRule {
  id: string;
  name: string;
  basisPoints: number;
  active: boolean;
}

export interface Commission {
  id: string;
  personId: string;
  ruleId: string | null;
  sourceOrderId: string | null;
  baseCents: number;
  amountCents: number;
  status: "pending" | "approved" | "rejected" | "paid" | "canceled";
  createdAt: string;
  reviewNote?: string | null;
  reviewedAt?: string | null;
  paidAt?: string | null;
  canceledAt?: string | null;
}

export interface EmployeeAccount {
  id: string;
  displayName: string;
  email: string;
}

export interface TimeEntry {
  id: string;
  personId: string;
  clockedInAt: string;
  clockedOutAt: string | null;
  source: string;
}

export interface TimeBreak {
  id: string;
  timeEntryId: string;
  type: "meal" | "temporary";
  startedAt: string;
  endedAt: string | null;
}

export interface TimeCorrection {
  id: string;
  timeEntryId: string;
  personId: string;
  requestedClockedInAt: string;
  requestedClockedOutAt: string | null;
  reason: string;
  status: "pending" | "approved" | "rejected";
  requiresSpecialApproval: boolean;
}

export interface TimeEntrySummary {
  timeEntryId: string;
  personId: string;
  date: string;
  workedMinutes: number;
  breakMinutes: number;
  scheduledMinutes: number | null;
  overtimeMinutes: number;
  anomalyCodes: string[];
}

export interface TimeTrackingSettings {
  mode: "off" | "all" | "selected";
  geofenceEnabled: boolean;
  locationLabel: string | null;
  locationAddress: string | null;
  latitude: number | null;
  longitude: number | null;
  radiusMeters: number;
  accuracyToleranceMeters: number;
  maxLocationAccuracyMeters: number;
  lowAccuracyPolicy: "block" | "flag";
  additionalLocations: TimeTrackingLocation[];
  managerCanView: boolean;
  financeCanView: boolean;
  antiFraudEnabled: boolean;
  offlineEnabled: boolean;
  offlineMaxDelayMinutes: number;
  offlineRequiresJustification: boolean;
  notificationsEnabled: boolean;
  emailAlertsEnabled: boolean;
  managerAlertOnAnomaly: boolean;
  locationRetentionDays: number;
  lateToleranceMinutes: number;
  minimumBreakMinutes: number;
  maxOvertimeMinutes: number;
  longShiftAlertMinutes: number;
  reminderBeforeShiftMinutes: number;
  reminderAfterShiftMinutes: number;
}

export interface TimeTrackingLocation {
  id: string;
  label: string;
  address: string | null;
  latitude: number;
  longitude: number;
  radiusMeters: number;
  accuracyToleranceMeters: number;
}

export interface TimeTrackingAlert {
  type: string;
  personId: string;
  timeEntryId?: string;
  message: string;
  severity: "info" | "warning" | "danger";
}

export interface TimeTrackingClosure {
  id: string;
  periodStart: string;
  periodEnd: string;
  status: "closed";
  closedAt: string;
  reason: string | null;
}

export interface PeopleData {
  people: Person[];
  schedules: Schedule[];
  timeEntries: TimeEntry[];
  breaks: TimeBreak[];
  corrections: TimeCorrection[];
  summaries: TimeEntrySummary[];
  anomalies: TimeEntrySummary[];
  alerts: TimeTrackingAlert[];
  closures: TimeTrackingClosure[];
  settings: TimeTrackingSettings;
  canManage: boolean;
  selectedPersonIds: string[];
  accounts: EmployeeAccount[];
  commissionRules: CommissionRule[];
  commissions: Commission[];
}

export interface PeopleDirectoryData {
  items: Person[];
  pagination: { page: number; pageSize: number; total: number; pageCount: number };
}

export interface PeopleCapabilities {
  canView: boolean;
  canManage: boolean;
  canConfigure: boolean;
  canApproveCommissions: boolean;
  canPayCommissions: boolean;
  reason: string | null;
}

export interface PeopleIndicatorsData {
  period: { from: string; to: string };
  timezone: string;
  indicators: {
    scheduledShifts: number;
    absences: number;
    lateArrivals: number;
    recurringLatePeople: number;
    overtimeMinutes: number;
    laborCostCents: number;
    laborCostPercentage: number | null;
  };
  coverage: {
    schedules: "complete" | "partial";
    timeEntries: "complete" | "partial";
    laborCost: "complete" | "partial";
    missingHourlyRatePeople: number;
  };
}

export interface PersonTimelineData {
  person: Person;
  period: { from: string; to: string; timezone: string };
  schedules: Schedule[];
  entries: TimeTrackingReportRow[];
  reconciliation: {
    scheduledMinutes: number;
    workedMinutes: number;
    overtimeMinutes: number;
    lateArrivals: number;
  };
  coverage: {
    schedules: "complete" | "partial";
    timeEntries: "complete" | "partial";
    laborCost: "complete" | "partial";
  };
}

export interface TimeTrackingReportRow extends TimeEntry {
  personName: string;
  summary: TimeEntrySummary;
  hourlyRateCents: number | null;
  estimatedLaborCostCents: number | null;
}

export interface TimeTrackingReport {
  from: string;
  to: string;
  timezone: string;
  rows: TimeTrackingReportRow[];
  totals: {
    workedMinutes: number;
    breakMinutes: number;
    overtimeMinutes: number;
    laborCostCents: number;
    revenueCents: number;
    laborCostPercentage: number | null;
    entries: number;
    anomalies: number;
  };
}

export interface SelfTimeTrackingData {
  enabled: boolean;
  person: Person | null;
  settings: TimeTrackingSettings;
  current: TimeEntry | null;
  entries: TimeEntry[];
  breaks: TimeBreak[];
}

export interface OverviewMetric {
  id: string;
  label: string;
  value: string;
  detail: string;
  tone: OverviewTone;
  route: RouteId;
  source: OverviewSourceId;
  comparison?: { label: string; value: string; tone: OverviewTone };
  goal?: { label: string; tone: OverviewTone };
}

export type OverviewTone = "neutral" | "success" | "warning" | "danger" | "info";
export type OverviewSourceId =
  | "operationalShift"
  | "operations"
  | "inventory"
  | "finance"
  | "cash"
  | "delivery"
  | "reservations"
  | "activity"
  | "multiunit";

export interface OverviewPriority {
  id: string;
  title: string;
  detail: string;
  tone: OverviewTone;
  route: RouteId;
  actionLabel: string;
  source: OverviewSourceId;
  occurrenceKey: string;
  status: "open" | "claimed";
  assignedTo: { id: string; name: string; isMe: boolean } | null;
}

export interface OverviewPulseItem {
  id: string;
  label: string;
  value: string;
  route?: RouteId;
  source: OverviewSourceId;
}

export interface OverviewQuickAction {
  id: string;
  label: string;
  route: RouteId;
}

export interface OverviewData {
  profileId: Exclude<ProfileId, "platform">;
  generatedAt: string;
  activeShift: { label: string; startsAt: string } | null;
  unavailableSources: string[];
  metrics: OverviewMetric[];
  priorities: OverviewPriority[];
  pulse: OverviewPulseItem[];
  quickActions: OverviewQuickAction[];
  sources: Array<{
    id: OverviewSourceId;
    status: "fresh" | "unavailable";
    checkedAt: string;
  }>;
  activity: Array<{
    id: string;
    label: string;
    detail: string;
    occurredAt: string;
    route?: RouteId;
  }>;
  multiunit: Array<{
    unitId: string;
    name: string;
    salesCents: number;
    marginCents: number | null;
    alerts: number;
    tone: OverviewTone;
  }>;
  preferences: {
    alertsEnabled: boolean;
    minimumTone: "info" | "warning" | "danger";
    digestMinutes: number;
    thresholds: {
      kdsDelayMinutes: number;
      stockCoverageDays: number;
      deliveryRiskMinutes: number;
      salesGoalCents: number;
      maxKdsDelayed: number;
      maxStockouts: number;
      maxDeliveryDelayed: number;
      maxReconciliations: number;
    };
  };
  lastVisitedAt: string | null;
  partialSource: OverviewSourceId | null;
}

export type RemoteState<T> =
  | { status: "loading" }
  | {
      status: "error";
      message: string;
      httpStatus?: number;
      retryAfterSeconds?: number;
      requestId?: string;
    }
  | { status: "ready"; data: T };

export class InvalidManagementPayloadError extends Error {
  constructor() {
    super("A API retornou dados gerenciais em formato inesperado.");
    this.name = "InvalidManagementPayloadError";
  }
}

type ManagementRemoteLoader = (organizationId: string, unitId: string) => Promise<unknown>;
type ManagementRemoteParser<T> = (value: unknown) => T;
type ManagementRemoteCacheEntry<T> =
  | { status: "loading"; promise: Promise<T> }
  | { status: "ready"; data: T; expiresAt: number };

const managementRemoteCache = new WeakMap<
  ManagementRemoteLoader,
  WeakMap<ManagementRemoteParser<unknown>, Map<string, ManagementRemoteCacheEntry<unknown>>>
>();
const managementRemoteCacheTtlMs = 5_000;

export function loadManagementRemote<T>(
  loader: ManagementRemoteLoader,
  parser: ManagementRemoteParser<T>,
  organizationId: string,
  unitId: string,
  bypassReadyCache = false,
): Promise<T> {
  let loaderCache = managementRemoteCache.get(loader);
  if (!loaderCache) {
    loaderCache = new WeakMap();
    managementRemoteCache.set(loader, loaderCache);
  }

  const cacheParser = parser as ManagementRemoteParser<unknown>;
  let parserCache = loaderCache.get(cacheParser);
  if (!parserCache) {
    parserCache = new Map();
    loaderCache.set(cacheParser, parserCache);
  }

  const scopeKey = `${organizationId}:${unitId}`;
  const cached = parserCache.get(scopeKey) as ManagementRemoteCacheEntry<T> | undefined;
  if (cached?.status === "loading") return cached.promise;
  if (!bypassReadyCache && cached?.status === "ready" && cached.expiresAt > Date.now()) {
    return Promise.resolve(cached.data);
  }

  const promise = Promise.resolve()
    .then(() => loader(organizationId, unitId))
    .then(parser);
  parserCache.set(scopeKey, { status: "loading", promise });
  void promise.then(
    (data) => {
      const current = parserCache.get(scopeKey);
      if (current?.status === "loading" && current.promise === promise) {
        parserCache.set(scopeKey, {
          status: "ready",
          data,
          expiresAt: Date.now() + managementRemoteCacheTtlMs,
        });
      }
    },
    () => {
      const current = parserCache.get(scopeKey);
      if (current?.status === "loading" && current.promise === promise)
        parserCache.delete(scopeKey);
    },
  );
  return promise;
}

export function record(value: unknown): Row {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new InvalidManagementPayloadError();
  }
  return value as Row;
}

export function rows(value: Row, key: string): Row[] {
  const list = value[key];
  if (!Array.isArray(list)) throw new InvalidManagementPayloadError();
  return list.map(record);
}

export function optionalRows(value: Row, key: string): Row[] {
  return value[key] === undefined ? [] : rows(value, key);
}

export function records(value: unknown): Row[] {
  if (!Array.isArray(value)) throw new InvalidManagementPayloadError();
  return value.map(record);
}

export function requiredString(value: unknown): string {
  if (typeof value !== "string" || !value.trim()) throw new InvalidManagementPayloadError();
  return value;
}

export function optionalString(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  return requiredString(value);
}

export function numeric(value: unknown, nullable = false): number | null {
  if (nullable && (value === null || value === undefined)) return null;
  const parsed =
    typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  if (!Number.isFinite(parsed)) throw new InvalidManagementPayloadError();
  return parsed;
}

export function integer(value: unknown): number {
  const parsed = numeric(value);
  if (parsed === null || !Number.isInteger(parsed)) throw new InvalidManagementPayloadError();
  return parsed;
}

export function boolean(value: unknown): boolean {
  if (typeof value !== "boolean") throw new InvalidManagementPayloadError();
  return value;
}

function inventoryItemKind(value: unknown): InventoryItemKind {
  return value === "prepared" ||
    value === "resale" ||
    value === "reusable" ||
    value === "returnable_container"
    ? value
    : "ingredient";
}

function stockLocationKind(value: unknown): StockLocation["kind"] {
  return value === "cooler" ||
    value === "freezer" ||
    value === "bar" ||
    value === "kitchen" ||
    value === "returnables" ||
    value === "other"
    ? value
    : "warehouse";
}

function returnableIncidentKind(value: unknown): ReturnableIncident["kind"] {
  return value === "breakage" ||
    value === "suspected_theft" ||
    value === "recording_error" ||
    value === "other"
    ? value
    : "loss";
}

function returnableIncidentStatus(value: unknown): ReturnableIncident["status"] {
  return value === "approved" || value === "rejected" ? value : "pending";
}

export function parseInventory(value: unknown): InventoryData {
  const payload = record(value);
  return {
    locations: rows(payload, "locations").map((location) => ({
      id: requiredString(location.id),
      name: requiredString(location.name),
      code: requiredString(location.code),
      barcode: optionalString(location.barcode),
      kind: stockLocationKind(location.kind),
      responsibleIdentityId: optionalString(location.responsibleIdentityId),
      requireDistinctTransferReceiver: boolean(location.requireDistinctTransferReceiver ?? false),
      transferSlaMinutes: integer(location.transferSlaMinutes ?? 30),
      active: boolean(location.active),
    })),
    items: rows(payload, "items").map((item) => ({
      id: requiredString(item.id),
      productId: optionalString(item.productId),
      preferredSupplierId: optionalString(item.preferredSupplierId),
      name: requiredString(item.name),
      sku: optionalString(item.sku),
      barcode: optionalString(item.barcode),
      unit: requiredString(item.unit),
      purchaseUnit: optionalString(item.purchaseUnit),
      purchaseToStockFactor: numeric(item.purchaseToStockFactor) ?? 1,
      minimumQuantity: numeric(item.minimumQuantity) ?? 0,
      reorderQuantity: numeric(item.reorderQuantity) ?? 0,
      leadTimeDays: integer(item.leadTimeDays),
      allowNegative: boolean(item.allowNegative),
      returnableContainerItemId: optionalString(item.returnableContainerItemId),
      returnableQuantityPerUnit: numeric(item.returnableQuantityPerUnit, true),
      returnableDepositCents: numeric(item.returnableDepositCents, true),
      ...(item.kind === undefined ? {} : { kind: inventoryItemKind(item.kind) }),
      active: boolean(item.active),
    })),
    balances: rows(payload, "balances").map((balance) => ({
      locationId: requiredString(balance.locationId),
      inventoryItemId: requiredString(balance.inventoryItemId),
      quantity: numeric(balance.quantity) ?? 0,
      reservedQuantity: numeric(balance.reservedQuantity, true) ?? 0,
      blockedQuantity: numeric(balance.blockedQuantity, true) ?? 0,
      availableQuantity: numeric(balance.availableQuantity, true) ?? numeric(balance.quantity) ?? 0,
      averageCostCents: numeric(balance.averageCostCents, true),
    })),
    lots: rows(payload, "lots").map((lot) => ({
      id: requiredString(lot.id),
      locationId: requiredString(lot.locationId),
      inventoryItemId: requiredString(lot.inventoryItemId),
      batchCode: requiredString(lot.batchCode),
      expiresAt: optionalString(lot.expiresAt),
      quantity: numeric(lot.quantity) ?? 0,
      unitCostCents: numeric(lot.unitCostCents, true),
      active: boolean(lot.active),
    })),
    assets: optionalRows(payload, "assets").map((asset) => ({
      id: requiredString(asset.id),
      inventoryItemId: requiredString(asset.inventoryItemId),
      locationId: requiredString(asset.locationId),
      assetTag: requiredString(asset.assetTag),
      status: requiredString(asset.status) as InventoryAsset["status"],
      condition: requiredString(asset.condition) as InventoryAsset["condition"],
      responsibleIdentityId: optionalString(asset.responsibleIdentityId),
      acquiredAt: optionalString(asset.acquiredAt),
      lastMaintenanceAt: optionalString(asset.lastMaintenanceAt),
      notes: optionalString(asset.notes),
      version: integer(asset.version),
    })),
    inventoryReviewRequests: optionalRows(payload, "inventoryReviewRequests").map((request) => ({
      id: requiredString(request.id),
      type: requiredString(request.type) as InventoryReviewRequest["type"],
      reason: requiredString(request.reason),
      status: requiredString(request.status) as InventoryReviewRequest["status"],
      riskSummary: record(request.riskSummary),
      requestedByIdentityId: requiredString(request.requestedByIdentityId),
      createdAt: requiredString(request.createdAt),
    })),
    transfers: optionalRows(payload, "transfers").map((transfer) => ({
      id: requiredString(transfer.id),
      inventoryItemId: requiredString(transfer.inventoryItemId),
      sourceLocationId: requiredString(transfer.sourceLocationId),
      destinationLocationId: requiredString(transfer.destinationLocationId),
      sourceLotId: optionalString(transfer.sourceLotId),
      destinationLotId: optionalString(transfer.destinationLotId),
      quantity: numeric(transfer.quantity) ?? 0,
      quantityReceived: numeric(transfer.quantityReceived, true) ?? 0,
      quantityDivergent: numeric(transfer.quantityDivergent, true) ?? 0,
      batchId: optionalString(transfer.batchId),
      lineNumber: integer(transfer.lineNumber ?? 1),
      reason: requiredString(transfer.reason),
      status: requiredString(transfer.status) as InventoryTransfer["status"],
      sentByName: optionalString(transfer.sentByName),
      receivedByName: optionalString(transfer.receivedByName),
      canceledByName: optionalString(transfer.canceledByName),
      deadlineAt: requiredString(transfer.deadlineAt ?? transfer.createdAt),
      createdAt: requiredString(transfer.createdAt),
      receivedAt: optionalString(transfer.receivedAt),
      canceledAt: optionalString(transfer.canceledAt),
      resolutionNote: optionalString(transfer.resolutionNote),
      receipts: Array.isArray(transfer.receipts)
        ? transfer.receipts.map((value) => {
            const receipt = record(value);
            return {
              id: requiredString(receipt.id),
              quantityReceived: numeric(receipt.quantityReceived) ?? 0,
              quantityDivergent: numeric(receipt.quantityDivergent) ?? 0,
              divergenceReason: optionalString(receipt.divergenceReason),
              note: requiredString(receipt.note),
              receivedByName: optionalString(receipt.receivedByName),
              receivedAt: requiredString(receipt.receivedAt),
            };
          })
        : [],
    })),
    inTransitBalances: optionalRows(payload, "inTransitBalances").map((balance) => ({
      inventoryItemId: requiredString(balance.inventoryItemId),
      quantity: numeric(balance.quantity) ?? 0,
    })),
    locationItemSettings: optionalRows(payload, "locationItemSettings").map((setting) => ({
      locationId: requiredString(setting.locationId),
      inventoryItemId: requiredString(setting.inventoryItemId),
      minimumQuantity: numeric(setting.minimumQuantity) ?? 0,
      targetQuantity: numeric(setting.targetQuantity) ?? 0,
      transferUnitLabel: optionalString(setting.transferUnitLabel),
      unitsPerTransferUnit: numeric(setting.unitsPerTransferUnit) ?? 1,
    })),
    issueRoutes: optionalRows(payload, "issueRoutes").map((route) => ({
      id: requiredString(route.id),
      productId: requiredString(route.productId),
      stationId: optionalString(route.stationId),
      locationId: requiredString(route.locationId),
      active: boolean(route.active),
    })),
    sectorReplenishmentSuggestions: optionalRows(payload, "sectorReplenishmentSuggestions").map(
      (suggestion) => ({
        inventoryItemId: requiredString(suggestion.inventoryItemId),
        sourceLocationId: requiredString(suggestion.sourceLocationId),
        destinationLocationId: requiredString(suggestion.destinationLocationId),
        suggestedQuantity: numeric(suggestion.suggestedQuantity) ?? 0,
        transferUnitLabel: optionalString(suggestion.transferUnitLabel),
        unitsPerTransferUnit: numeric(suggestion.unitsPerTransferUnit) ?? 1,
      }),
    ),
    inventoryOperators: optionalRows(payload, "inventoryOperators").map((operator) => ({
      id: requiredString(operator.id),
      name: requiredString(operator.name),
    })),
    reservations: optionalRows(payload, "reservations").map((reservation) => ({
      id: requiredString(reservation.id),
      inventoryItemId: requiredString(reservation.inventoryItemId),
      locationId: requiredString(reservation.locationId),
      quantity: numeric(reservation.quantity) ?? 0,
      status: requiredString(reservation.status) as InventoryReservation["status"],
      sourceType: requiredString(reservation.sourceType),
      sourceId: requiredString(reservation.sourceId),
      reason: requiredString(reservation.reason),
      expiresAt: optionalString(reservation.expiresAt),
      createdAt: requiredString(reservation.createdAt),
    })),
    countSchedules: optionalRows(payload, "countSchedules").map((schedule) => ({
      id: requiredString(schedule.id),
      inventoryItemId: requiredString(schedule.inventoryItemId),
      locationId: requiredString(schedule.locationId),
      classification: requiredString(
        schedule.classification,
      ) as InventoryCountSchedule["classification"],
      riskScore: integer(schedule.riskScore),
      frequencyDays: integer(schedule.frequencyDays),
      nextDueAt: requiredString(schedule.nextDueAt),
      lastCountedAt: optionalString(schedule.lastCountedAt),
    })),
    productionBatches: optionalRows(payload, "productionBatches").map((batch) => ({
      id: requiredString(batch.id),
      outputInventoryItemId: requiredString(batch.outputInventoryItemId),
      outputLocationId: requiredString(batch.outputLocationId),
      batchCode: requiredString(batch.batchCode),
      plannedQuantity: numeric(batch.plannedQuantity) ?? 0,
      actualQuantity: numeric(batch.actualQuantity, true),
      status: requiredString(batch.status) as ProductionBatch["status"],
      expiresAt: optionalString(batch.expiresAt),
      createdAt: requiredString(batch.createdAt),
      inputs: Array.isArray(batch.inputs)
        ? batch.inputs.map((value) => {
            const line = record(value);
            return {
              id: requiredString(line.id),
              inventoryItemId: requiredString(line.inventoryItemId),
              locationId: requiredString(line.locationId),
              lotId: optionalString(line.lotId),
              plannedQuantity: numeric(line.plannedQuantity) ?? 0,
              actualQuantity: numeric(line.actualQuantity, true),
            };
          })
        : [],
    })),
    interunitTransfers: optionalRows(payload, "interunitTransfers").map((transfer) => ({
      id: requiredString(transfer.id),
      sourceUnitId: requiredString(transfer.sourceUnitId),
      destinationUnitId: requiredString(transfer.destinationUnitId),
      status: requiredString(transfer.status) as InterunitTransfer["status"],
      reason: requiredString(transfer.reason),
      sentAt: requiredString(transfer.sentAt),
      lines: Array.isArray(transfer.lines)
        ? transfer.lines.map((value) => {
            const line = record(value);
            return {
              id: requiredString(line.id),
              sourceInventoryItemId: requiredString(line.sourceInventoryItemId),
              destinationInventoryItemId: requiredString(line.destinationInventoryItemId),
              sourceLocationId: requiredString(line.sourceLocationId),
              destinationLocationId: requiredString(line.destinationLocationId),
              sourceLotId: optionalString(line.sourceLotId),
              quantitySent: numeric(line.quantitySent) ?? 0,
              quantityReceived: numeric(line.quantityReceived) ?? 0,
            };
          })
        : [],
    })),
    closings: optionalRows(payload, "closings").map((closing) => ({
      id: requiredString(closing.id),
      period: requiredString(closing.period),
      locationId: optionalString(closing.locationId),
      shiftReference: optionalString(closing.shiftReference),
      totalValueCents: integer(closing.totalValueCents),
      totalReservedValueCents: integer(closing.totalReservedValueCents),
      totalInTransitValueCents: integer(closing.totalInTransitValueCents ?? 0),
      lineCount: integer(closing.lineCount),
      closedAt: requiredString(closing.closedAt),
    })),
    organizationUnits: optionalRows(payload, "organizationUnits").map((unit) => ({
      id: requiredString(unit.id),
      name: requiredString(unit.name),
    })),
    interunitCatalog: (() => {
      const catalog = record(payload.interunitCatalog ?? {});
      return {
        items: optionalRows(catalog, "items").map((item) => ({
          id: requiredString(item.id),
          unitId: requiredString(item.unitId),
          name: requiredString(item.name),
          sku: optionalString(item.sku),
          barcode: optionalString(item.barcode),
        })),
        locations: optionalRows(catalog, "locations").map((location) => ({
          id: requiredString(location.id),
          unitId: requiredString(location.unitId),
          name: requiredString(location.name),
        })),
      };
    })(),
    forecasts: optionalRows(payload, "forecasts").map((forecast) => ({
      inventoryItemId: requiredString(forecast.inventoryItemId),
      horizonDays: integer(forecast.horizonDays),
      expectedDemand: numeric(forecast.expectedDemand) ?? 0,
      suggestedPurchaseQuantity: numeric(forecast.suggestedPurchaseQuantity) ?? 0,
      projectedAvailableQuantity: numeric(forecast.projectedAvailableQuantity) ?? 0,
    })),
    supplierPerformance: optionalRows(payload, "supplierPerformance").map((supplier) => ({
      supplierId: requiredString(supplier.supplierId),
      supplierName: requiredString(supplier.supplierName),
      fillRatePercent: numeric(supplier.fillRatePercent, true) ?? 0,
      onTimePercent: numeric(supplier.onTimePercent, true) ?? 0,
      divergencePercent: numeric(supplier.divergencePercent, true) ?? 0,
      priceVariationPercent: numeric(supplier.priceVariationPercent, true),
    })),
    pendingActions: optionalRows(payload, "pendingActions").map((action) => ({
      id: requiredString(action.id),
      type: requiredString(action.type) as InventoryPendingAction["type"],
      priority: requiredString(action.priority) as InventoryPendingAction["priority"],
      title: requiredString(action.title),
      detail: requiredString(action.detail),
      createdAt: requiredString(action.createdAt),
    })),
    recentMovements: rows(payload, "recentMovements").map((movement) => ({
      id: requiredString(movement.id),
      locationId: requiredString(movement.locationId),
      inventoryItemId: requiredString(movement.inventoryItemId),
      lotId: optionalString(movement.lotId),
      type: requiredString(movement.type),
      quantityDelta: numeric(movement.quantityDelta) ?? 0,
      unitCostCents: numeric(movement.unitCostCents, true),
      sourceType: requiredString(movement.sourceType),
      actorName: optionalString(movement.actorName),
      reason: optionalString(movement.reason),
      occurredAt: requiredString(movement.occurredAt),
    })),
    automation: (() => {
      const automation = record(payload.automation);
      return {
        pending: integer(automation.pending),
        failed: integer(automation.failed),
        lastProcessedAt: optionalString(automation.lastProcessedAt),
      };
    })(),
    capabilities:
      payload.capabilities === undefined
        ? null
        : (() => {
            const capabilities = record(payload.capabilities);
            return {
              canConfirmReturnables: false,
              canRecordReturnableIncident: false,
              canApproveReturnableIncident: false,
              canApproveInventoryRisk: boolean(capabilities.canApproveInventoryRisk),
              canResolveTransfers: boolean(capabilities.canResolveTransfers),
              canManageAssets: boolean(capabilities.canManageAssets),
              canManagePlanning: capabilities.canManagePlanning === true,
              canCloseInventory: capabilities.canCloseInventory === true,
              canTransferBetweenUnits: capabilities.canTransferBetweenUnits === true,
            };
          })(),
  };
}

export function aggregateReturnableReconciliation(
  rows: ReturnableSectorReconciliation[],
): ReturnableSectorReconciliation {
  const latestCountedAt = rows
    .map((row) => row.lastCountedAt)
    .filter((value): value is string => value !== null)
    .sort()
    .at(-1);
  const countDifferences = rows
    .map((row) => row.lastCountDifferenceQuantity)
    .filter((value): value is number => value !== null);
  return {
    inventoryItemId: rows.length === 1 ? (rows[0]?.inventoryItemId ?? null) : null,
    locationId: rows.every((row) => row.locationId === rows[0]?.locationId)
      ? (rows[0]?.locationId ?? null)
      : null,
    fullEquivalentQuantity: rows.reduce((sum, row) => sum + row.fullEquivalentQuantity, 0),
    emptyPhysicalQuantity: rows.reduce((sum, row) => sum + row.emptyPhysicalQuantity, 0),
    openCustodyQuantity: rows.reduce((sum, row) => sum + row.openCustodyQuantity, 0),
    supplierInTransitQuantity: rows.reduce((sum, row) => sum + row.supplierInTransitQuantity, 0),
    approvedLossQuantity: rows.reduce((sum, row) => sum + row.approvedLossQuantity, 0),
    explainableBalanceQuantity: rows.every((row) => row.explainableBalanceQuantity !== null)
      ? rows.reduce((sum, row) => sum + (row.explainableBalanceQuantity ?? 0), 0)
      : null,
    lastCountedAt: latestCountedAt ?? null,
    lastCountDifferenceQuantity: countDifferences.length
      ? countDifferences.reduce((sum, value) => sum + value, 0)
      : null,
  };
}

export function parseReturnables(value: unknown): ReturnablesData {
  const payload = record(value);
  const stringArray = (source: unknown) =>
    Array.isArray(source)
      ? source.filter((entry): entry is string => typeof entry === "string")
      : [];
  const parseReconciliation = (source: Row): ReturnableSectorReconciliation => ({
    inventoryItemId: optionalString(source.containerInventoryItemId ?? source.inventoryItemId),
    locationId: optionalString(source.locationId),
    fullEquivalentQuantity: numeric(source.fullEquivalentQuantity ?? 0) ?? 0,
    emptyPhysicalQuantity: numeric(source.emptyPhysicalQuantity ?? 0) ?? 0,
    openCustodyQuantity: numeric(source.openCustodyQuantity ?? 0) ?? 0,
    supplierInTransitQuantity: numeric(source.supplierInTransitQuantity ?? 0) ?? 0,
    approvedLossQuantity: numeric(source.approvedLossQuantity ?? 0) ?? 0,
    explainableBalanceQuantity: numeric(source.explainableBalanceQuantity, true),
    lastCountedAt: optionalString(source.lastCountedAt),
    lastCountDifferenceQuantity: numeric(
      source.lastCountDifferenceQuantity ?? source.recentCountDifferenceQuantity,
      true,
    ),
  });
  const explicitPositions =
    payload.returnables === undefined
      ? optionalRows(payload, "positions")
      : rows(payload, "returnables");
  const custody = optionalRows(payload, "custody");
  const physical = optionalRows(payload, "physical");
  const custodyByItem = new Map(
    custody.map((position) => [
      requiredString(position.containerInventoryItemId),
      numeric(position.expectedQuantity) ?? 0,
    ]),
  );
  const physicalByItem = new Map(
    physical.map((position) => [
      requiredString(position.containerInventoryItemId),
      numeric(position.physicalQuantity) ?? 0,
    ]),
  );
  const derivedPositions = [...new Set([...custodyByItem.keys(), ...physicalByItem.keys()])].map(
    (inventoryItemId) => {
      const expectedQuantity = custodyByItem.get(inventoryItemId) ?? 0;
      const physicalQuantity = physicalByItem.get(inventoryItemId) ?? 0;
      return {
        inventoryItemId,
        locationId: null,
        expectedQuantity,
        physicalQuantity,
        divergenceQuantity: physicalQuantity - expectedQuantity,
        oldestOutstandingAt: null,
        ageDays: 0,
        depositExposureCents: 0,
        updatedAt: null,
      } satisfies ReturnablePosition;
    },
  );
  const incidentRows =
    payload.returnableIncidents === undefined
      ? optionalRows(payload, "incidents")
      : rows(payload, "returnableIncidents");
  const physicalByLocation = optionalRows(payload, "physicalByLocation").map((position) => ({
    inventoryItemId: requiredString(position.containerInventoryItemId),
    locationId: requiredString(position.locationId),
    physicalQuantity: numeric(position.physicalQuantity) ?? 0,
  }));
  const custodyByLocation = optionalRows(payload, "custodyByLocation").map((position) => ({
    inventoryItemId: requiredString(position.containerInventoryItemId),
    locationId: requiredString(position.locationId),
    expectedQuantity: numeric(position.expectedQuantity ?? position.openCustodyQuantity) ?? 0,
  }));
  const fullContainersByLocation = optionalRows(payload, "fullContainersByLocation").map(
    (position) => ({
      inventoryItemId: requiredString(position.containerInventoryItemId),
      locationId: requiredString(position.locationId),
      quantity: numeric(position.quantity) ?? 0,
    }),
  );
  const supplierExchanges = optionalRows(payload, "supplierExchanges").map((exchange) => ({
    id: requiredString(exchange.id),
    inventoryItemId: requiredString(exchange.containerInventoryItemId),
    locationId: requiredString(exchange.locationId),
    supplierId: requiredString(exchange.supplierId),
    quantity: numeric(exchange.quantity) ?? 0,
    status: requiredString(
      exchange.status,
    ) as ReturnablesData["supplierExchanges"][number]["status"],
    note: requiredString(exchange.note),
    sentAt: requiredString(exchange.sentAt),
    resolvedAt: optionalString(exchange.resolvedAt),
  }));
  const lossIndicators = optionalRows(payload, "lossIndicators").map((indicator) => ({
    kind: returnableIncidentKind(indicator.type),
    locationId: optionalString(indicator.locationId),
    quantity: numeric(indicator.quantity) ?? 0,
    estimatedCostCents: integer(indicator.estimatedCostCents),
    incidentCount: integer(indicator.incidentCount),
  }));
  const reconciliationSource =
    payload.reconciliation && typeof payload.reconciliation === "object"
      ? record(payload.reconciliation)
      : {};
  const fallbackTotals: ReturnableSectorReconciliation = {
    inventoryItemId: null,
    locationId: null,
    fullEquivalentQuantity: fullContainersByLocation.reduce((sum, row) => sum + row.quantity, 0),
    emptyPhysicalQuantity: physicalByLocation.reduce((sum, row) => sum + row.physicalQuantity, 0),
    openCustodyQuantity: custodyByLocation.reduce((sum, row) => sum + row.expectedQuantity, 0),
    supplierInTransitQuantity: supplierExchanges
      .filter((row) => row.status === "in_transit")
      .reduce((sum, row) => sum + row.quantity, 0),
    approvedLossQuantity: lossIndicators.reduce((sum, row) => sum + row.quantity, 0),
    explainableBalanceQuantity: null,
    lastCountedAt: null,
    lastCountDifferenceQuantity: null,
  };
  const reconciliationTotalRows = Array.isArray(reconciliationSource.totals)
    ? optionalRows(reconciliationSource, "totals").map(parseReconciliation)
    : [];
  const reconciliationTotalsSource =
    reconciliationSource.totals &&
    !Array.isArray(reconciliationSource.totals) &&
    typeof reconciliationSource.totals === "object"
      ? record(reconciliationSource.totals)
      : reconciliationSource;
  const configurationSource =
    payload.configurationHealth && typeof payload.configurationHealth === "object"
      ? record(payload.configurationHealth)
      : {};
  return {
    policy: parseReturnablePolicy(payload.policy),
    returnables: explicitPositions.length
      ? explicitPositions.map((position) => ({
          inventoryItemId: requiredString(
            position.inventoryItemId ?? position.containerInventoryItemId,
          ),
          locationId: optionalString(position.locationId),
          expectedQuantity: numeric(position.expectedQuantity ?? position.expected ?? 0) ?? 0,
          physicalQuantity: numeric(position.physicalQuantity ?? position.physical ?? 0) ?? 0,
          divergenceQuantity: numeric(position.divergenceQuantity ?? position.divergence ?? 0) ?? 0,
          oldestOutstandingAt: optionalString(position.oldestOutstandingAt),
          ageDays: integer(position.ageDays ?? 0),
          depositExposureCents: integer(position.depositExposureCents ?? 0),
          updatedAt: optionalString(position.updatedAt),
        }))
      : derivedPositions,
    returnableIncidents: incidentRows.map((incident) => ({
      id: requiredString(incident.id),
      inventoryItemId: requiredString(
        incident.inventoryItemId ?? incident.containerInventoryItemId,
      ),
      locationId: optionalString(incident.locationId),
      kind: returnableIncidentKind(incident.kind ?? incident.type),
      quantity: numeric(incident.quantity) ?? 0,
      status: returnableIncidentStatus(incident.status),
      reason: requiredString(incident.reason ?? incident.note ?? incident.notes),
      actorName: optionalString(incident.actorName ?? incident.actorIdentityId),
      occurredAt: requiredString(incident.occurredAt ?? incident.createdAt),
    })),
    capabilities:
      payload.capabilities === undefined
        ? null
        : (() => {
            const capabilities = record(payload.capabilities);
            return {
              canConfirmReturnables:
                capabilities.canConfirmReturnables === true ||
                capabilities.canConfirmCustody === true,
              canRecordReturnableIncident:
                capabilities.canRecordReturnableIncident === true ||
                capabilities.canReportIncident === true,
              canApproveReturnableIncident:
                capabilities.canApproveReturnableIncident === true ||
                capabilities.canApproveIncident === true,
              canManageReturnablePolicy:
                capabilities.canConfigurePolicy === true ||
                capabilities.canManageReturnablePolicy === true,
              canTransferReturnableResponsibility:
                capabilities.canHandoffCustody === true ||
                capabilities.canTransferReturnableResponsibility === true,
              canConfigureReturnables: capabilities.canConfigure === true,
              canManageReturnableDeposits: capabilities.canManageDeposit === true,
            };
          })(),
    recentReturnableMovements: optionalRows(payload, "recentMovements").map((movement) => ({
      id: requiredString(movement.id),
      type: requiredString(movement.type) as ReturnableMovement["type"],
      orderId: optionalString(movement.orderId),
      orderItemId: optionalString(movement.orderItemId),
      inventoryItemId: requiredString(movement.containerInventoryItemId),
      locationId: optionalString(movement.locationId),
      quantityDelta: numeric(movement.quantityDelta) ?? 0,
      context: movement.context === undefined ? {} : record(movement.context),
      occurredAt: requiredString(movement.occurredAt),
    })),
    openCustodies: optionalRows(
      payload,
      payload.openCustodies === undefined ? "custodyInbox" : "openCustodies",
    ).map((custody) => {
      const handoff =
        custody.handoff && typeof custody.handoff === "object" ? record(custody.handoff) : null;
      const issuedQuantity = numeric(custody.issuedQuantity, true);
      const returnedQuantity = numeric(custody.returnedQuantity, true) ?? 0;
      const openQuantity = numeric(custody.openQuantity ?? custody.outstandingQuantity) ?? 0;
      return {
        id: requiredString(custody.id ?? custody.issueMovementId),
        inventoryItemId: requiredString(
          custody.containerInventoryItemId ?? custody.inventoryItemId,
        ),
        locationId: optionalString(custody.locationId),
        orderId: optionalString(custody.orderId),
        orderItemId: optionalString(custody.orderItemId),
        responsibleIdentityId: optionalString(custody.responsibleIdentityId),
        responsibleName: optionalString(custody.responsibleName),
        counterpartyName: optionalString(custody.counterpartyName),
        orderCode: optionalString(custody.orderCode),
        tableLabel: optionalString(custody.tableLabel),
        dueAt: optionalString(custody.dueAt),
        occurredAt: requiredString(custody.occurredAt ?? custody.oldestOutstandingAt),
        issuedQuantity: issuedQuantity ?? openQuantity + returnedQuantity,
        returnedQuantity,
        openQuantity,
        depositCents: integer(custody.depositCents ?? custody.depositExposureCents ?? 0),
        ageDays: integer(
          custody.ageDays ??
            Math.max(
              0,
              Math.floor(
                (Date.now() -
                  new Date(
                    requiredString(custody.occurredAt ?? custody.oldestOutstandingAt),
                  ).getTime()) /
                  86_400_000,
              ),
            ),
        ),
        handoff: handoff
          ? {
              toIdentityId: requiredString(handoff.toIdentityId),
              toIdentityName: optionalString(handoff.toIdentityName),
              toShiftReference: optionalString(handoff.toShiftReference),
              at: requiredString(handoff.at),
            }
          : null,
      };
    }),
    reconciliation: {
      totals: reconciliationTotalRows.length
        ? aggregateReturnableReconciliation(reconciliationTotalRows)
        : Object.keys(reconciliationTotalsSource).length
          ? parseReconciliation(reconciliationTotalsSource)
          : fallbackTotals,
      byLocation: optionalRows(reconciliationSource, "byLocation").map(parseReconciliation),
    },
    configurationHealth: {
      status:
        configurationSource.status === "attention" ||
        stringArray(configurationSource.undecidedProductIds).length > 0 ||
        stringArray(configurationSource.unlinkedReturnableProductIds).length > 0 ||
        stringArray(configurationSource.inactiveContainerLinkProductIds).length > 0
          ? "attention"
          : "healthy",
      undecidedProductIds: stringArray(configurationSource.undecidedProductIds),
      unlinkedReturnableProductIds: stringArray(configurationSource.unlinkedReturnableProductIds),
      missingDepositValueProductIds: stringArray(configurationSource.missingDepositValueProductIds),
      inactiveContainerLinkProductIds: stringArray(
        configurationSource.inactiveContainerLinkProductIds,
      ),
    },
    classificationStatus: optionalRows(payload, "classificationStatus").map((entry) => {
      const activeLink =
        entry.activeLink && typeof entry.activeLink === "object" ? record(entry.activeLink) : null;
      const classification = entry.status ?? entry.classification;
      return {
        productId: requiredString(entry.productId),
        productName: optionalString(entry.productName),
        containerInventoryItemId: optionalString(
          activeLink?.containerInventoryItemId ?? entry.containerInventoryItemId,
        ),
        active: activeLink ? activeLink.containerActive !== false : entry.active !== false,
        classification:
          classification === "returnable" || classification === "non_returnable"
            ? classification
            : "undecided",
      };
    }),
    pendingActions: optionalRows(payload, "pendingActions").map((entry) => ({
      id: requiredString(entry.id),
      title: requiredString(entry.title),
      detail: requiredString(entry.detail),
      priority: entry.priority === "high" || entry.priority === "low" ? entry.priority : "medium",
      createdAt: requiredString(entry.createdAt),
    })),
    closings: optionalRows(payload, "closings").map((entry) => ({
      id: requiredString(entry.id),
      period: requiredString(entry.period),
      locationId: optionalString(entry.locationId),
      pendingCustodyQuantity: numeric(entry.pendingCustodyQuantity) ?? 0,
      supplierInTransitQuantity: numeric(entry.supplierInTransitQuantity) ?? 0,
      approvedLossQuantity: numeric(entry.approvedLossQuantity) ?? 0,
      closedAt: requiredString(entry.closedAt),
    })),
    physicalByLocation,
    custodyByLocation,
    fullContainersByLocation,
    supplierExchanges,
    lossIndicators,
  };
}

export function parseReturnablePolicy(value: unknown): ReturnablePolicy {
  const payload =
    value && typeof value === "object" && !Array.isArray(value) ? record(value) : ({} as Row);
  return {
    depositMode: payload.depositMode === "manual" ? "manual" : "disabled",
    defaultDueDays: integer(payload.defaultDueDays ?? 7),
    returnableClosePolicy:
      payload.returnableClosePolicy === "ignore" || payload.returnableClosePolicy === "block"
        ? payload.returnableClosePolicy
        : "warn",
  };
}

export function parseRecipeCatalog(value: unknown): RecipeCatalog {
  const payload = record(value);
  return {
    products: rows(payload, "products").map((product) => ({
      id: requiredString(product.id),
      name: requiredString(product.name),
      active: boolean(product.active),
    })),
  };
}

export function parseRecipes(value: unknown): RecipeVersion[] {
  return records(value).map((recipe) => ({
    id: requiredString(recipe.id),
    productId: requiredString(recipe.productId),
    version: integer(recipe.version),
    validFrom: requiredString(recipe.validFrom),
    validUntil: optionalString(recipe.validUntil),
    components: records(recipe.components).map((component) => ({
      inventoryItemId: requiredString(component.inventoryItemId),
      locationId: requiredString(component.locationId),
      quantityMilli: integer(component.quantityMilli),
      lossBasisPoints: integer(component.lossBasisPoints),
    })),
  }));
}

export function recipeQuantityToMilli(value: string): number {
  const normalized = value.trim().replace(",", ".");
  if (!/^\d+(?:\.\d{1,3})?$/.test(normalized)) {
    throw new Error("Informe uma quantidade com até três casas decimais.");
  }
  const quantityMilli = Math.round(Number(normalized) * 1_000);
  if (quantityMilli < 1 || quantityMilli > 1_000_000_000) {
    throw new Error("A quantidade deve ser maior que zero e respeitar o limite operacional.");
  }
  return quantityMilli;
}

export function recipeLossToBasisPoints(value: string): number {
  const normalized = value.trim().replace(",", ".");
  if (!/^\d+(?:\.\d{1,2})?$/.test(normalized)) {
    throw new Error("Informe a perda percentual com até duas casas decimais.");
  }
  const lossBasisPoints = Math.round(Number(normalized) * 100);
  if (lossBasisPoints < 0 || lossBasisPoints > 9_999) {
    throw new Error("A perda deve estar entre 0% e 99,99%.");
  }
  return lossBasisPoints;
}

export function parsePurchases(value: unknown): PurchasesData {
  const payload = record(value);
  const pagination = payload.pagination === undefined ? null : record(payload.pagination);
  const capabilities = payload.capabilities === undefined ? null : record(payload.capabilities);
  const metricRows = Array.isArray(payload.metrics)
    ? records(payload.metrics)
    : payload.metrics === undefined
      ? []
      : Object.entries(record(payload.metrics)).map(([key, value]) => ({ key, value }));
  return {
    orders: rows(payload, "orders").map((order) => ({
      id: requiredString(order.id),
      humanNumber: order.humanNumber === undefined ? null : integer(order.humanNumber),
      version: order.version === undefined ? 1 : integer(order.version),
      supplierId: optionalString(order.supplierId),
      status: requiredString(order.status),
      totalCents: numeric(order.totalCents) ?? 0,
      expectedAt: optionalString(order.expectedAt),
      approvedAt: optionalString(order.approvedAt),
      approvedByIdentityId: optionalString(order.approvedByIdentityId),
      rejectedAt: optionalString(order.rejectedAt),
      rejectedByIdentityId: optionalString(order.rejectedByIdentityId),
      rejectionReason: optionalString(order.rejectionReason),
      canceledAt: optionalString(order.canceledAt),
      cancelReason: optionalString(order.cancelReason),
      createdAt: optionalString(order.createdAt),
      updatedAt: optionalString(order.updatedAt),
      notes: optionalString(order.notes),
    })),
    items: rows(payload, "items").map((item) => ({
      id: requiredString(item.id),
      purchaseOrderId: requiredString(item.purchaseOrderId),
      inventoryItemId: requiredString(item.inventoryItemId),
      quantity: requiredString(item.quantity),
      unitCostCents: numeric(item.unitCostCents) ?? 0,
      receivedQuantity: optionalString(item.receivedQuantity),
      totalCents: numeric(item.totalCents, true),
      purchaseUnit: optionalString(item.purchaseUnit),
      stockUnit: optionalString(item.stockUnit),
      purchaseToStockFactor: numeric(item.purchaseToStockFactor, true),
      itemName: optionalString(item.itemName),
    })),
    receipts: rows(payload, "receipts").map((receipt) => ({
      id: requiredString(receipt.id),
      purchaseOrderId: requiredString(receipt.purchaseOrderId),
      supplierId: optionalString(receipt.supplierId),
      totalCents: numeric(receipt.totalCents, true),
      status: receipt.status === undefined ? "posted" : requiredString(receipt.status),
      receivedByIdentityId: optionalString(receipt.receivedByIdentityId),
      receivedAt: optionalString(receipt.receivedAt),
      reversedAt: optionalString(receipt.reversedAt),
      reversalReason: optionalString(receipt.reversalReason),
      version: receipt.version === undefined ? 1 : integer(receipt.version),
    })),
    receiptLines: optionalRows(payload, "receiptLines").map((line) => ({
      id: requiredString(line.id),
      receiptId: requiredString(line.receiptId),
      purchaseOrderItemId: requiredString(line.purchaseOrderItemId),
      inventoryItemId: requiredString(line.inventoryItemId),
      locationId: requiredString(line.locationId),
      quantity: requiredString(line.quantity),
      stockQuantity: optionalString(line.stockQuantity),
      unitCostCents: numeric(line.unitCostCents, true),
      stockUnitCostCents: numeric(line.stockUnitCostCents, true),
      totalCents: numeric(line.totalCents, true),
      lotId: optionalString(line.lotId),
    })),
    suppliers: optionalRows(payload, "suppliers").map(parseSupplier),
    invoices: optionalRows(payload, "invoices").map((invoice) => {
      const reconciliation =
        invoice.reconciliation === null || invoice.reconciliation === undefined
          ? null
          : record(invoice.reconciliation);
      return {
        id: requiredString(invoice.id),
        purchaseOrderId: requiredString(invoice.purchaseOrderId),
        documentNumber: requiredString(invoice.documentNumber),
        documentKey: optionalString(invoice.documentKey),
        accessKey: optionalString(invoice.accessKey ?? invoice.documentKey),
        series: optionalString(invoice.series),
        model: optionalString(invoice.model),
        taxTotalCents: numeric(invoice.taxTotalCents, true),
        status: requiredString(invoice.status),
        amountCents: numeric(invoice.totalCents ?? invoice.amountCents) ?? 0,
        totalCents: numeric(invoice.totalCents ?? invoice.amountCents) ?? 0,
        issuedAt: optionalString(invoice.issuedAt),
        competenceDate: optionalString(invoice.competenceDate),
        dueDate: optionalString(invoice.dueDate),
        payableId: optionalString(invoice.payableId),
        reconciliation,
        reconciliationLines: reconciliation ? optionalRows(reconciliation, "lines") : [],
        reconciledAt: optionalString(invoice.reconciledAt),
        confirmedAt: optionalString(invoice.confirmedAt),
        confirmedByIdentityId: optionalString(invoice.confirmedByIdentityId),
        reversedAt: optionalString(invoice.reversedAt),
        reversalReason: optionalString(invoice.reversalReason),
        version: invoice.version === undefined ? 1 : integer(invoice.version),
      };
    }),
    invoiceLines: optionalRows(payload, "invoiceLines").map((line) => ({
      id: requiredString(line.id),
      invoiceId: requiredString(line.invoiceId),
      purchaseOrderItemId: requiredString(line.purchaseOrderItemId),
      inventoryItemId: requiredString(line.inventoryItemId),
      quantity: requiredString(line.quantity),
      unitCostCents: numeric(line.unitCostCents) ?? 0,
      totalCents: numeric(line.totalCents) ?? 0,
    })),
    suggestions: optionalRows(payload, "suggestions").map((suggestion) => ({
      inventoryItemId: requiredString(suggestion.inventoryItemId),
      itemName: optionalString(suggestion.itemName) ?? "Item",
      supplierId: optionalString(suggestion.supplierId),
      supplierName: optionalString(suggestion.supplierName),
      currentQuantity: numeric(suggestion.currentQuantity, true) ?? 0,
      minimumQuantity: numeric(suggestion.minimumQuantity, true) ?? 0,
      suggestedQuantity: requiredString(suggestion.suggestedQuantity),
      purchaseUnit: optionalString(suggestion.purchaseUnit) ?? "un",
      stockUnit: optionalString(suggestion.stockUnit) ?? "un",
      purchaseToStockFactor: numeric(suggestion.purchaseToStockFactor, true) ?? 1,
      leadTimeDays: Math.trunc(numeric(suggestion.leadTimeDays, true) ?? 0),
      dailyConsumption: numeric(suggestion.dailyConsumption, true) ?? 0,
      coverageDays: numeric(suggestion.coverageDays, true),
      outstandingStockQuantity: numeric(suggestion.outstandingStockQuantity, true) ?? 0,
      reason: optionalString(suggestion.reason),
    })),
    metrics: metricRows.map((metric) => ({
      key: requiredString(metric.key),
      value: numeric(metric.value) ?? 0,
      label: "label" in metric ? optionalString(metric.label) : null,
    })),
    capabilities: capabilities
      ? {
          canCreate: boolean(capabilities.canCreate),
          canApprove: boolean(capabilities.canApprove),
          canReceive: boolean(capabilities.canReceive),
          canInvoice: boolean(capabilities.canInvoice),
          canReconcile: boolean(capabilities.canReconcile),
          canConfirmInvoice:
            capabilities.canConfirmInvoice === undefined
              ? false
              : boolean(capabilities.canConfirmInvoice),
          canReverseReceipt:
            capabilities.canReverseReceipt === undefined
              ? false
              : boolean(capabilities.canReverseReceipt),
          canCancelInvoice:
            capabilities.canCancelInvoice === undefined
              ? false
              : boolean(capabilities.canCancelInvoice),
        }
      : null,
    page: pagination
      ? {
          page: integer(pagination.page),
          pageSize: integer(pagination.pageSize),
          total: integer(pagination.total),
        }
      : null,
  };
}

export function parseSupplier(value: Row): Supplier {
  return {
    id: requiredString(value.id),
    name: requiredString(value.name),
    document: optionalString(value.document),
    contactName: optionalString(value.contactName),
    email: optionalString(value.email),
    phone: optionalString(value.phone),
    address: optionalString(value.address),
    notes: optionalString(value.notes),
    active: value.active === undefined ? true : boolean(value.active),
    version: value.version === undefined ? 1 : integer(value.version),
  };
}

export function parseSuppliers(value: unknown): Supplier[] {
  const payload = Array.isArray(value) ? value : record(value);
  const source = Array.isArray(payload)
    ? records(payload)
    : payload.items === undefined
      ? rows(payload, "suppliers")
      : rows(payload, "items");
  return source.map(parseSupplier);
}

export function parseFinance(value: unknown): FinanceData {
  const payload = record(value);
  const paymentRows: Row[] = [
    ...rows(payload, "payablePayments").map((payment) => ({ ...payment, direction: "payable" })),
    ...rows(payload, "receivablePayments").map((payment) => ({
      ...payment,
      direction: "receivable",
    })),
  ];
  const parsePayment = (payment: Row): FinancialPayment => ({
    id: requiredString(payment.id),
    amountCents: numeric(payment.amountCents) ?? 0,
    method: requiredString(payment.method),
    reference: optionalString(payment.reference),
    status: payment.status === "reversed" ? "reversed" : "posted",
    occurredAt: requiredString(payment.paidAt ?? payment.receivedAt),
    reversalReason: optionalString(payment.reversalReason),
  });
  const entryRows = rows(payload, "entries");
  const sourceEntries: Row[] = entryRows.length
    ? entryRows
    : [
        ...rows(payload, "payables").map((entry) => ({ ...entry, direction: "payable" })),
        ...rows(payload, "receivables").map((entry) => ({ ...entry, direction: "receivable" })),
      ];
  const entries = sourceEntries.map((entry): FinancialEntry => {
    const direction = entry.direction === "receivable" ? "receivable" : "payable";
    const attachments = Array.isArray(entry.attachments)
      ? records(entry.attachments).map((attachment) => ({
          name: requiredString(attachment.name),
          url: requiredString(attachment.url),
        }))
      : [];
    return {
      id: requiredString(entry.id),
      description: requiredString(entry.description),
      status: requiredString(entry.status),
      amountCents: numeric(entry.amountCents) ?? 0,
      settledCents: numeric(entry.settledCents ?? entry.paidCents ?? entry.receivedCents) ?? 0,
      competenceDate: requiredString(entry.competenceDate),
      dueDate: requiredString(entry.dueDate),
      direction,
      category: optionalString(entry.category),
      costCenter: optionalString(entry.costCenter),
      documentNumber: optionalString(entry.documentNumber),
      notes: optionalString(entry.notes),
      supplierName: optionalString(entry.supplierName),
      installmentNumber: numeric(entry.installmentNumber),
      installmentCount: numeric(entry.installmentCount),
      attachments,
      version: integer(entry.version),
      payments: paymentRows
        .filter(
          (payment) =>
            payment.direction === direction &&
            (direction === "payable" ? payment.payableId : payment.receivableId) === entry.id,
        )
        .map(parsePayment),
    };
  });
  const settings = record(payload.settings);
  const summary = record(payload.summary);
  const pagination = record(payload.pagination);
  const capabilities = record(payload.capabilities);
  return {
    entries,
    reconciliationImports: rows(payload, "reconciliationImports"),
    reconciliationEntries: rows(payload, "reconciliationEntries").map((entry) => ({
      id: requiredString(entry.id),
      externalKey: requiredString(entry.externalKey),
      paymentDirection: entry.paymentDirection === "payable" ? "payable" : "receivable",
      paymentId: optionalString(entry.paymentId),
      grossCents: numeric(entry.grossCents) ?? 0,
      feeCents: numeric(entry.feeCents) ?? 0,
      netCents: numeric(entry.netCents) ?? 0,
      status:
        entry.status === "matched" || entry.status === "divergent" || entry.status === "resolved"
          ? entry.status
          : "unmatched",
      resolutionNote: optionalString(entry.resolutionNote),
      version: integer(entry.version),
    })),
    approvals: rows(payload, "approvals").map((approval) => {
      const direction = approval.direction === "receivable" ? "receivable" : "payable";
      return {
        id: requiredString(approval.id),
        direction,
        entryId: requiredString(
          direction === "payable" ? approval.payableId : approval.receivableId,
        ),
        amountCents: numeric(approval.amountCents) ?? 0,
        method: requiredString(approval.method),
        reference: optionalString(approval.reference),
        cashRegisterId: optionalString(approval.cashRegisterId),
        occurredAt: optionalString(approval.occurredAt),
        status: approval.status === "approved" ? "approved" : "pending",
        requestedByIdentityId: requiredString(approval.requestedByIdentityId),
      };
    }),
    settings: {
      paymentApprovalThresholdCents: numeric(settings.paymentApprovalThresholdCents),
      requireDistinctApprover: settings.requireDistinctApprover !== false,
      dueSoonDays: integer(settings.dueSoonDays ?? 7),
    },
    summary: {
      payableCents: numeric(summary.payableCents) ?? 0,
      receivableCents: numeric(summary.receivableCents) ?? 0,
      projectedBalanceCents: numeric(summary.projectedBalanceCents) ?? 0,
      overdueCount: integer(summary.overdueCount),
      dueTodayCount: integer(summary.dueTodayCount),
      dueSoonCount: integer(summary.dueSoonCount),
      unresolvedReconciliations: integer(summary.unresolvedReconciliations),
    },
    projection: rows(payload, "projection").map((item) => ({
      date: requiredString(item.date),
      payableCents: numeric(item.payableCents) ?? 0,
      receivableCents: numeric(item.receivableCents) ?? 0,
      balanceCents: numeric(item.balanceCents) ?? 0,
    })),
    pagination: {
      page: integer(pagination.page ?? 1),
      pageSize: integer(pagination.pageSize ?? 25),
      total: integer(pagination.total),
      pageCount: integer(pagination.pageCount),
    },
    capabilities: {
      canManage: capabilities.canManage !== false,
      canConfigure: capabilities.canConfigure === true,
      canApprove: capabilities.canApprove === true,
      canOperateCash: capabilities.canOperateCash === true,
    },
  };
}

export function parseReports(value: unknown): ReportData {
  const payload = record(value);
  const period = record(payload.period);
  const cashFlow = record(payload.cashFlow);
  const incomeStatement = record(payload.incomeStatement);
  const costCoverage = record(incomeStatement.costCoverage);
  const previousPeriod =
    payload.previousPeriod === undefined || payload.previousPeriod === null
      ? null
      : record(payload.previousPeriod);
  const comparison =
    payload.comparison === undefined || payload.comparison === null
      ? null
      : record(payload.comparison);
  const meta = payload.meta === undefined || payload.meta === null ? null : record(payload.meta);
  const capabilities =
    payload.capabilities === undefined || payload.capabilities === null
      ? {}
      : record(payload.capabilities);
  const budget =
    payload.budget === undefined || payload.budget === null ? null : record(payload.budget);
  const breakdowns =
    payload.breakdowns === undefined || payload.breakdowns === null
      ? {}
      : record(payload.breakdowns);
  const parseBreakdown = (key: string): ReportBreakdownRow[] =>
    optionalRows(breakdowns, key).map((entry) => ({
      key: requiredString(entry.key),
      label: requiredString(entry.label),
      revenueCents: numeric(entry.revenueCents) ?? 0,
      quantity: numeric(entry.quantity) ?? 0,
    }));
  const coverage = requiredString(costCoverage.coverage);
  if (!["complete", "partial", "unavailable"].includes(coverage)) {
    throw new InvalidManagementPayloadError();
  }
  const reportCoverage = (entry: unknown): ReportCoverage => {
    const result = typeof entry === "string" ? entry : "unavailable";
    return result === "complete" || result === "partial" ? result : "unavailable";
  };
  const comparisonMode = (entry: unknown): ReportComparisonMode =>
    entry === "previous_year" || entry === "none" ? entry : "previous_period";
  const metaSourceCounts = meta ? record(meta.sourceCounts) : {};
  const metaCoverage = meta ? record(meta.coverage) : {};
  const metaIndicators = meta?.indicators === undefined ? {} : record(meta.indicators);
  const budgetTargets = budget ? record(budget.targets) : {};
  const reportFamilies =
    payload.reportFamilies === undefined || payload.reportFamilies === null
      ? {}
      : record(payload.reportFamilies);
  const family = (key: string) =>
    reportFamilies[key] === undefined || reportFamilies[key] === null
      ? {}
      : record(reportFamilies[key]);
  const salesFamily = family("sales");
  const exceptionsFamily = family("exceptions");
  const inventoryFamily = family("inventory");
  const purchasingFamily = family("purchasing");
  const operationsFamily = family("operations");
  const profitabilityFamily = family("profitability");
  const multiunitFamily = family("multiunit");
  const qualityFamily = family("quality");
  const laborFamily = family("labor");
  const reconciliationFamily = family("reconciliation");
  const forecastFamily = family("forecast");
  const reconciliationDocuments = reconciliationFamily.documents
    ? record(reconciliationFamily.documents)
    : {};
  const reconciliationExternal = reconciliationFamily.external
    ? record(reconciliationFamily.external)
    : {};
  const reconciliationClosure = reconciliationFamily.closure
    ? record(reconciliationFamily.closure)
    : {};
  const reconciliationChecklist = reconciliationClosure.checklist
    ? record(reconciliationClosure.checklist)
    : {};
  const forecastRevenue = forecastFamily.revenue ? record(forecastFamily.revenue) : {};
  const forecastCash = forecastFamily.cash ? record(forecastFamily.cash) : {};
  const parseFamilyComparison = (source: Row): ReportFamilyComparison =>
    Object.fromEntries(
      Object.entries(
        source.comparison === undefined || source.comparison === null
          ? {}
          : record(source.comparison),
      ).map(([key, value]) => {
        const entry = record(value);
        return [
          key,
          {
            current: numeric(entry.current, true),
            previous: numeric(entry.previous, true),
            change: numeric(entry.change, true),
            changePercent: numeric(entry.changePercent, true),
          },
        ];
      }),
    );
  return {
    period: { from: requiredString(period.from), to: requiredString(period.to) },
    timezone: optionalString(payload.timezone),
    previousPeriod: previousPeriod
      ? { from: requiredString(previousPeriod.from), to: requiredString(previousPeriod.to) }
      : null,
    comparison: comparison
      ? {
          mode: comparisonMode(comparison.mode),
          revenueCents: numeric(comparison.revenueCents) ?? 0,
          previousRevenueCents: numeric(comparison.previousRevenueCents, true),
          changeCents: numeric(comparison.changeCents, true),
          changePercent: numeric(comparison.changePercent, true),
        }
      : null,
    dailySeries: optionalRows(payload, "dailySeries").map((entry) => ({
      date: requiredString(entry.date),
      revenueCents: numeric(entry.revenueCents) ?? 0,
      previousRevenueCents: numeric(entry.previousRevenueCents, true),
    })),
    breakdowns: {
      products: parseBreakdown("products"),
      categories: parseBreakdown("categories"),
      channels: parseBreakdown("channels"),
      paymentMethods: parseBreakdown("paymentMethods"),
    },
    cashFlow: {
      inflowsCents: numeric(cashFlow.inflowsCents) ?? 0,
      outflowsCents: numeric(cashFlow.outflowsCents) ?? 0,
      netCents: numeric(cashFlow.netCents) ?? 0,
      basis: requiredString(cashFlow.basis),
    },
    incomeStatement: {
      revenueCents: numeric(incomeStatement.revenueCents) ?? 0,
      cmvCents: numeric(incomeStatement.cmvCents, true),
      grossMarginCents: numeric(incomeStatement.grossMarginCents, true),
      operatingExpensesCents: numeric(incomeStatement.operatingExpensesCents, true),
      operatingResultCents: numeric(incomeStatement.operatingResultCents, true),
      costCoverage: {
        coverage: coverage as ReportData["incomeStatement"]["costCoverage"]["coverage"],
        missingCostLines: integer(costCoverage.missingCostLines),
        completeForRevenue: boolean(costCoverage.completeForRevenue),
      },
      basis: requiredString(incomeStatement.basis),
    },
    meta: meta
      ? {
          generatedAt: requiredString(meta.generatedAt),
          dataThrough: optionalString(meta.dataThrough),
          sourceCounts: {
            posSales: integer(metaSourceCounts.posSales),
            receivablePayments: integer(metaSourceCounts.receivablePayments),
            payablePayments: integer(metaSourceCounts.payablePayments),
            receivables: integer(metaSourceCounts.receivables),
            payables: integer(metaSourceCounts.payables),
            costLines: integer(metaSourceCounts.costLines),
          },
          coverage: {
            sales: reportCoverage(metaCoverage.sales),
            cashFlow: reportCoverage(metaCoverage.cashFlow),
            costs: reportCoverage(metaCoverage.costs),
            budget: reportCoverage(metaCoverage.budget),
            labor: reportCoverage(metaCoverage.labor),
            reconciliation: reportCoverage(metaCoverage.reconciliation),
            forecast: reportCoverage(metaCoverage.forecast),
          },
          indicators: Object.fromEntries(
            Object.entries(metaIndicators).map(([key, value]) => {
              const indicator = record(value);
              return [
                key,
                {
                  coverage: reportCoverage(indicator.coverage),
                  dataThrough: optionalString(indicator.dataThrough),
                  sources: Array.isArray(indicator.sources)
                    ? indicator.sources.filter(
                        (source): source is string => typeof source === "string",
                      )
                    : [],
                },
              ];
            }),
          ),
        }
      : null,
    capabilities: {
      viewCosts: capabilities.viewCosts !== false,
      drillDown: capabilities.drillDown === true,
      export: capabilities.export === true,
      manageBudget: capabilities.manageBudget === true,
      manageSchedules: capabilities.manageSchedules === true,
      manageViews: capabilities.manageViews === true,
      manageAlerts: capabilities.manageAlerts === true,
      backfillCosts: capabilities.backfillCosts === true,
      emailDeliveryConfigured: capabilities.emailDeliveryConfigured === true,
    },
    budget: budget
      ? {
          coverage: reportCoverage(budget.coverage),
          basis: "calendar_month_prorated_by_days",
          targets: {
            posRevenueCents: numeric(budgetTargets.posRevenueCents, true),
            cashInflowsCents: numeric(budgetTargets.cashInflowsCents, true),
            cashOutflowsCents: numeric(budgetTargets.cashOutflowsCents, true),
            competenceRevenueCents: numeric(budgetTargets.competenceRevenueCents, true),
            competenceExpensesCents: numeric(budgetTargets.competenceExpensesCents, true),
            averageTicketCents: numeric(budgetTargets.averageTicketCents, true),
            grossMarginCents: numeric(budgetTargets.grossMarginCents, true),
            inventoryLossCents: numeric(budgetTargets.inventoryLossCents, true),
            canceledValueCents: numeric(budgetTargets.canceledValueCents, true),
          },
          alerts: optionalRows(budget, "alerts").map((entry) => ({
            key: requiredString(entry.key),
            actualCents: numeric(entry.actualCents) ?? 0,
            targetCents: numeric(entry.targetCents) ?? 0,
            differenceCents: numeric(entry.differenceCents) ?? 0,
            status: entry.status === "attention" ? "attention" : "on_track",
            direction: entry.direction === "maximum" ? "maximum" : "minimum",
          })),
        }
      : null,
    reportFamilies: {
      sales: {
        coverage: reportCoverage(salesFamily.coverage ?? metaCoverage.sales),
        closedTabs: integer(salesFamily.closedTabs ?? metaSourceCounts.posSales ?? 0),
        subtotalCents: numeric(salesFamily.subtotalCents ?? 0) ?? 0,
        discountsCents: numeric(salesFamily.discountsCents ?? 0) ?? 0,
        netRevenueCents: numeric(salesFamily.netRevenueCents ?? comparison?.revenueCents ?? 0) ?? 0,
        averageTicketCents: numeric(salesFamily.averageTicketCents, true),
        guests: integer(salesFamily.guests ?? 0),
        averageSpendPerGuestCents: numeric(salesFamily.averageSpendPerGuestCents, true),
        hourly: optionalRows(salesFamily, "hourly").map((entry) => ({
          hour: integer(entry.hour),
          closedTabs: integer(entry.closedTabs),
          revenueCents: numeric(entry.revenueCents) ?? 0,
        })),
        comparison: parseFamilyComparison(salesFamily),
      },
      exceptions: {
        coverage: reportCoverage(exceptionsFamily.coverage),
        canceledItems: integer(exceptionsFamily.canceledItems ?? 0),
        canceledValueCents: numeric(exceptionsFamily.canceledValueCents ?? 0) ?? 0,
        discountedItems: integer(exceptionsFamily.discountedItems ?? 0),
        itemDiscountCents: numeric(exceptionsFamily.itemDiscountCents ?? 0) ?? 0,
        tabDiscountCents: numeric(exceptionsFamily.tabDiscountCents ?? 0) ?? 0,
        cancellationReasons: optionalRows(exceptionsFamily, "cancellationReasons").map((entry) => ({
          label: requiredString(entry.label),
          quantity: integer(entry.quantity ?? 0),
          amountCents: numeric(entry.amountCents ?? 0) ?? 0,
        })),
        comparison: parseFamilyComparison(exceptionsFamily),
      },
      inventory: {
        coverage: reportCoverage(inventoryFamily.coverage),
        basis: "period_events_and_current_balance",
        lossEvents: integer(inventoryFamily.lossEvents ?? 0),
        lossQuantity: numeric(inventoryFamily.lossQuantity ?? 0) ?? 0,
        lossValueCents: numeric(inventoryFamily.lossValueCents, true),
        stockoutItems: integer(inventoryFamily.stockoutItems ?? 0),
        lowStockItems: integer(inventoryFamily.lowStockItems ?? 0),
        currentInventoryValueCents: numeric(inventoryFamily.currentInventoryValueCents, true),
        analysis: optionalRows(inventoryFamily, "analysis").map((entry) => ({
          key: requiredString(entry.key),
          label: requiredString(entry.label),
          abcClass:
            entry.abcClass === "A" || entry.abcClass === "B" || entry.abcClass === "C"
              ? entry.abcClass
              : null,
          consumedQuantity: numeric(entry.consumedQuantity) ?? 0,
          consumedValueCents: numeric(entry.consumedValueCents, true),
          currentQuantity: numeric(entry.currentQuantity) ?? 0,
          coverageDays: numeric(entry.coverageDays, true),
        })),
        comparison: parseFamilyComparison(inventoryFamily),
      },
      purchasing: {
        coverage: reportCoverage(purchasingFamily.coverage),
        orderCount: integer(purchasingFamily.orderCount ?? 0),
        orderedCents: numeric(purchasingFamily.orderedCents, true),
        canceledOrders: integer(purchasingFamily.canceledOrders ?? 0),
        receiptCount: integer(purchasingFamily.receiptCount ?? 0),
        receivedCents: numeric(purchasingFamily.receivedCents, true),
        suppliers: optionalRows(purchasingFamily, "suppliers").map((entry) => ({
          key: requiredString(entry.key),
          label: requiredString(entry.label),
          orderCount: integer(entry.orderCount ?? 0),
          orderedCents: numeric(entry.orderedCents, true),
          receiptCount: integer(entry.receiptCount ?? 0),
          receivedCents: numeric(entry.receivedCents, true),
        })),
        supplierPerformance: optionalRows(purchasingFamily, "supplierPerformance").map((entry) => ({
          key: requiredString(entry.key),
          label: requiredString(entry.label),
          orderCount: integer(entry.orderCount),
          receiptCount: integer(entry.receiptCount),
          onTimeRatePercent: numeric(entry.onTimeRatePercent, true),
          averageLeadDays: numeric(entry.averageLeadDays, true),
          priceVariancePercent: numeric(entry.priceVariancePercent, true),
        })),
        comparison: parseFamilyComparison(purchasingFamily),
      },
      operations: {
        coverage: reportCoverage(operationsFamily.coverage),
        closedTabs: integer(operationsFamily.closedTabs ?? 0),
        dineInTabs: integer(operationsFamily.dineInTabs ?? 0),
        tableTurnovers: integer(operationsFamily.tableTurnovers ?? 0),
        guests: integer(operationsFamily.guests ?? 0),
        averageGuestsPerTab: numeric(operationsFamily.averageGuestsPerTab, true),
        averageServiceMinutes: numeric(operationsFamily.averageServiceMinutes, true),
        shifts: optionalRows(operationsFamily, "shifts").map((entry) => ({
          key: requiredString(entry.key),
          label: requiredString(entry.label),
          closedTabs: integer(entry.closedTabs),
          guests: integer(entry.guests),
          revenueCents: numeric(entry.revenueCents) ?? 0,
          averageServiceMinutes: numeric(entry.averageServiceMinutes, true),
        })),
        comparison: parseFamilyComparison(operationsFamily),
      },
      profitability: {
        coverage: reportCoverage(profitabilityFamily.coverage ?? metaCoverage.costs),
        grossMarginPercent: numeric(profitabilityFamily.grossMarginPercent, true),
        productProfitabilityCoverage: reportCoverage(
          profitabilityFamily.productProfitabilityCoverage,
        ),
        products: optionalRows(profitabilityFamily, "products").map((entry) => ({
          key: requiredString(entry.key),
          label: requiredString(entry.label),
          quantity: integer(entry.quantity),
          revenueCents: numeric(entry.revenueCents) ?? 0,
          costCents: numeric(entry.costCents, true),
          grossMarginCents: numeric(entry.grossMarginCents, true),
          grossMarginPercent: numeric(entry.grossMarginPercent, true),
        })),
        comparison: parseFamilyComparison(profitabilityFamily),
      },
      multiunit: {
        coverage: reportCoverage(multiunitFamily.coverage),
        units: optionalRows(multiunitFamily, "units").map((entry) => ({
          key: requiredString(entry.key),
          label: requiredString(entry.label),
          closedTabs: integer(entry.closedTabs),
          revenueCents: numeric(entry.revenueCents) ?? 0,
          averageTicketCents: numeric(entry.averageTicketCents, true),
          changePercent: numeric(entry.changePercent, true),
          rank: integer(entry.rank ?? 0),
          operatingDays: integer(entry.operatingDays ?? 0),
          revenuePerOperatingDayCents: numeric(entry.revenuePerOperatingDayCents, true),
          organizationRevenueSharePercent: numeric(entry.organizationRevenueSharePercent, true),
          sameStoreChangePercent: numeric(entry.sameStoreChangePercent, true),
          minimumComparableOperatingDays: integer(entry.minimumComparableOperatingDays ?? 7),
          comparableStoreEligible: entry.comparableStoreEligible === true,
          seatCount: integer(entry.seatCount ?? 0),
          activeEmployees: integer(entry.activeEmployees ?? 0),
          openHours: numeric(entry.openHours, true),
          revenuePerSeatCents: numeric(entry.revenuePerSeatCents, true),
          revenuePerOpenHourCents: numeric(entry.revenuePerOpenHourCents, true),
          revenuePerEmployeeCents: numeric(entry.revenuePerEmployeeCents, true),
        })),
      },
      quality: {
        scorePercent: numeric(qualityFamily.scorePercent ?? 100) ?? 100,
        issues: optionalRows(qualityFamily, "issues").map((entry) => ({
          key: requiredString(entry.key),
          label: requiredString(entry.label),
          count: integer(entry.count),
          severity:
            entry.severity === "critical"
              ? "critical"
              : entry.severity === "warning"
                ? "warning"
                : "info",
        })),
      },
      labor: {
        coverage: reportCoverage(laborFamily.coverage),
        costCoverage: reportCoverage(laborFamily.costCoverage),
        scheduleCoverage: reportCoverage(laborFamily.scheduleCoverage),
        people: integer(laborFamily.people ?? 0),
        workedMinutes: integer(laborFamily.workedMinutes ?? 0),
        scheduledMinutes: integer(laborFamily.scheduledMinutes ?? 0),
        overtimeMinutes: numeric(laborFamily.overtimeMinutes, true),
        laborCostCents: numeric(laborFamily.laborCostCents, true),
        laborCostPercent: numeric(laborFamily.laborCostPercent, true),
        salesPerLaborHourCents: numeric(laborFamily.salesPerLaborHourCents, true),
        roles: optionalRows(laborFamily, "roles").map((entry) => ({
          roleLabel: requiredString(entry.roleLabel),
          people: integer(entry.people ?? 0),
          workedMinutes: integer(entry.workedMinutes ?? 0),
          scheduledMinutes: integer(entry.scheduledMinutes ?? 0),
          overtimeMinutes: integer(entry.overtimeMinutes ?? 0),
          laborCostCents: numeric(entry.laborCostCents, true),
          costCoverage: reportCoverage(entry.costCoverage),
        })),
      },
      reconciliation: {
        coverage: reportCoverage(reconciliationFamily.coverage),
        posRevenueCents: numeric(reconciliationFamily.posRevenueCents ?? 0) ?? 0,
        paymentCents: numeric(reconciliationFamily.paymentCents ?? 0) ?? 0,
        paymentDifferenceCents: numeric(reconciliationFamily.paymentDifferenceCents ?? 0) ?? 0,
        fiscalAuthorizedCents: numeric(reconciliationFamily.fiscalAuthorizedCents ?? 0) ?? 0,
        fiscalDifferenceCents: numeric(reconciliationFamily.fiscalDifferenceCents ?? 0) ?? 0,
        taxCents: numeric(reconciliationFamily.taxCents ?? 0) ?? 0,
        documents: {
          total: integer(reconciliationDocuments.total ?? 0),
          authorized: integer(reconciliationDocuments.authorized ?? 0),
          rejected: integer(reconciliationDocuments.rejected ?? 0),
          canceled: integer(reconciliationDocuments.canceled ?? 0),
        },
        external: {
          matched: integer(reconciliationExternal.matched ?? 0),
          unmatched: integer(reconciliationExternal.unmatched ?? 0),
          divergent: integer(reconciliationExternal.divergent ?? 0),
          resolved: integer(reconciliationExternal.resolved ?? 0),
          unmatchedCents: numeric(reconciliationExternal.unmatchedCents ?? 0) ?? 0,
          divergentCents: numeric(reconciliationExternal.divergentCents ?? 0) ?? 0,
        },
        closure: {
          status: reconciliationClosure.status === "closed" ? "closed" : "open",
          closedAt: optionalString(reconciliationClosure.closedAt),
          closedByIdentityId: optionalString(reconciliationClosure.closedByIdentityId),
          note: typeof reconciliationClosure.note === "string" ? reconciliationClosure.note : "",
          evidence: Array.isArray(reconciliationClosure.evidence)
            ? reconciliationClosure.evidence.filter(
                (item): item is string => typeof item === "string",
              )
            : [],
          checklist: {
            payments: reconciliationChecklist.payments === true,
            fiscal: reconciliationChecklist.fiscal === true,
            external: reconciliationChecklist.external === true,
          },
        },
      },
      forecast: {
        method: "weekday_seasonality_v2",
        available: forecastFamily.available === true,
        minimumSampleDays: integer(forecastFamily.minimumSampleDays ?? 14),
        horizonDays: integer(forecastFamily.horizonDays ?? 7),
        sampleDays: integer(forecastFamily.sampleDays ?? 0),
        confidence:
          forecastFamily.confidence === "high"
            ? "high"
            : forecastFamily.confidence === "medium"
              ? "medium"
              : "low",
        errorPercent: numeric(forecastFamily.errorPercent, true),
        revenue: {
          dailyAverageCents: numeric(forecastRevenue.dailyAverageCents ?? 0) ?? 0,
          forecastCents: numeric(forecastRevenue.forecastCents ?? 0) ?? 0,
          lowerBoundCents: numeric(forecastRevenue.lowerBoundCents ?? 0) ?? 0,
          upperBoundCents: numeric(forecastRevenue.upperBoundCents ?? 0) ?? 0,
        },
        cash: {
          inflowsCents: numeric(forecastCash.inflowsCents ?? 0) ?? 0,
          outflowsCents: numeric(forecastCash.outflowsCents ?? 0) ?? 0,
          netCents: numeric(forecastCash.netCents ?? 0) ?? 0,
        },
        calendarSignals: optionalRows(forecastFamily, "calendarSignals").map((entry) => ({
          date: requiredString(entry.date),
          reservations: integer(entry.reservations ?? 0),
          guests: integer(entry.guests ?? 0),
          demandFloorCents: numeric(entry.demandFloorCents ?? 0) ?? 0,
          applied: entry.applied === true,
        })),
        purchases: optionalRows(forecastFamily, "purchases").map((entry) => ({
          key: requiredString(entry.key),
          label: requiredString(entry.label),
          suggestedQuantity: numeric(entry.suggestedQuantity) ?? 0,
          dailyDemand: numeric(entry.dailyDemand) ?? 0,
        })),
      },
    },
  };
}

function reportComparisonMode(value: unknown): ReportComparisonMode {
  return value === "previous_year" || value === "none" ? value : "previous_period";
}

export function parseReportDrillDown(value: unknown): ReportDrillDownData {
  const payload = record(value);
  const period = record(payload.period);
  const totals =
    payload.totals === undefined || payload.totals === null ? null : record(payload.totals);
  const page = record(payload.page);
  const dimension = requiredString(payload.dimension);
  if (
    ![
      "metric",
      "product",
      "category",
      "channel",
      "payment_method",
      "exception",
      "inventory",
      "purchase",
      "operation",
      "labor",
      "reconciliation",
      "forecast",
    ].includes(dimension)
  ) {
    throw new InvalidManagementPayloadError();
  }
  const parsedRows = rows(payload, "rows").map((entry) => ({
    occurredAt: optionalString(entry.occurredAt),
    localDate: requiredString(entry.localDate),
    referenceType: requiredString(entry.referenceType),
    referenceId: requiredString(entry.referenceId ?? entry.id),
    label: requiredString(entry.label),
    amountCents: numeric(entry.amountCents) ?? 0,
    quantity: numeric(entry.quantity) ?? 0,
  }));
  return {
    period: { from: requiredString(period.from), to: requiredString(period.to) },
    timezone: optionalString(payload.timezone),
    dimension: dimension as ReportDrillDownDimension,
    key: requiredString(payload.key),
    totals: {
      amountCents: totals
        ? (numeric(totals.amountCents) ?? 0)
        : parsedRows.reduce((sum, entry) => sum + entry.amountCents, 0),
      quantity: totals
        ? (numeric(totals.quantity) ?? 0)
        : parsedRows.reduce((sum, entry) => sum + entry.quantity, 0),
    },
    rows: parsedRows,
    page: { nextCursor: optionalString(page.nextCursor) },
  };
}

function reportBudgetMetric(value: unknown): ReportBudgetMetric {
  const metric = requiredString(value);
  if (
    ![
      "pos_revenue",
      "cash_inflows",
      "cash_outflows",
      "competence_revenue",
      "competence_expenses",
      "average_ticket",
      "gross_margin",
      "inventory_loss",
      "canceled_value",
    ].includes(metric)
  ) {
    throw new InvalidManagementPayloadError();
  }
  return metric as ReportBudgetMetric;
}

export function parseReportBudgets(value: unknown): ReportBudgetMonth[] {
  const payload = record(value);
  const grouped = optionalRows(payload, "months");
  if (grouped.length) {
    return grouped.map((month) => ({
      month: requiredString(month.month).slice(0, 7),
      items: rows(month, "items").map((item) => ({
        metric: reportBudgetMetric(item.metric),
        targetCents: numeric(item.targetCents) ?? 0,
        version: integer(item.version),
      })),
    }));
  }
  const byMonth = new Map<string, ReportBudgetItem[]>();
  for (const item of optionalRows(payload, "budgets")) {
    const month = requiredString(item.month).slice(0, 7);
    const items = byMonth.get(month) ?? [];
    items.push({
      metric: reportBudgetMetric(item.metric),
      targetCents: numeric(item.targetCents) ?? 0,
      version: integer(item.version),
    });
    byMonth.set(month, items);
  }
  return [...byMonth].map(([month, items]) => ({ month, items }));
}

export function parseReportExport(value: unknown): ReportExportData {
  const payload = record(value);
  const status = payload.status === "failed" ? "failed" : "ready";
  return {
    id: requiredString(payload.id),
    status,
    format: payload.format === "pdf" ? "pdf" : payload.format === "xlsx" ? "xlsx" : "csv",
    filename: optionalString(payload.filename) ?? `relatorio-giromesa.${payload.format ?? "csv"}`,
    rowCount: integer(payload.rowCount),
    sha256: optionalString(payload.sha256),
    requestedAt: requiredString(payload.requestedAt),
    completedAt: optionalString(payload.completedAt),
    expiresAt: optionalString(payload.expiresAt),
  };
}

export function parseReportExports(value: unknown): ReportExportData[] {
  const payload = record(value);
  return rows(payload, "exports").map(parseReportExport);
}

export function parseReportSchedules(value: unknown): ReportScheduleData[] {
  const payload = record(value);
  return rows(payload, "schedules").map((entry) => ({
    id: requiredString(entry.id),
    name: requiredString(entry.name),
    frequency: entry.frequency === "monthly" ? "monthly" : "weekly",
    weekday: numeric(entry.weekday, true),
    dayOfMonth: numeric(entry.dayOfMonth, true),
    localTime: requiredString(entry.localTime),
    range: entry.range === "previous_month" ? "previous_month" : "previous_week",
    comparisonMode: reportComparisonMode(entry.comparisonMode),
    family:
      entry.family === "sales" ||
      entry.family === "exceptions" ||
      entry.family === "inventory" ||
      entry.family === "purchasing" ||
      entry.family === "operations" ||
      entry.family === "profitability" ||
      entry.family === "multiunit" ||
      entry.family === "quality" ||
      entry.family === "labor" ||
      entry.family === "reconciliation" ||
      entry.family === "forecast"
        ? entry.family
        : "overview",
    format: entry.format === "pdf" ? "pdf" : entry.format === "xlsx" ? "xlsx" : "csv",
    delivery: entry.delivery === "email" ? "email" : "in_app",
    enabled: entry.enabled !== false,
    nextRunAt: optionalString(entry.nextRunAt),
    lastRunAt: optionalString(entry.lastRunAt),
    version: integer(entry.version),
  }));
}

function cashDifferenceSeverity(value: unknown): CashShift["differenceSeverity"] {
  return value === "critical" ? "critical" : value === "warning" ? "warning" : "none";
}

function parseCashTenderCounts(value: unknown): CashTenderCount[] {
  if (!Array.isArray(value)) throw new InvalidManagementPayloadError();
  return value.map((candidate) => {
    const entry = record(candidate);
    return {
      method: requiredString(entry.method),
      expectedCents: numeric(entry.expectedCents) ?? 0,
      observedCents: numeric(entry.observedCents) ?? 0,
      differenceCents: numeric(entry.differenceCents) ?? 0,
      source: entry.source === "smartpos" ? "smartpos" : "manual",
    };
  });
}

export function parseCash(value: unknown): CashData {
  const payload = record(value);
  const capabilities = record(payload.capabilities);
  const settings = record(payload.settings);
  return {
    settings: {
      movementApprovalThresholdCents: numeric(settings.movementApprovalThresholdCents) ?? 0,
      discrepancyCriticalThresholdCents: numeric(settings.discrepancyCriticalThresholdCents) ?? 0,
      maxShiftMinutes: numeric(settings.maxShiftMinutes) ?? 0,
    },
    alerts: rows(payload, "alerts").map((alert) => ({
      code: requiredString(alert.code),
      severity: alert.severity === "critical" ? "critical" : "warning",
      message: requiredString(alert.message),
      cashShiftId: optionalString(alert.cashShiftId),
      cashRegisterId: optionalString(alert.cashRegisterId),
      installationId: optionalString(alert.installationId),
    })),
    operators: rows(payload, "operators").map((operator) => ({
      identityId: requiredString(operator.identityId),
      name: requiredString(operator.name),
    })),
    approvals: rows(payload, "approvals").map((approval) => ({
      id: requiredString(approval.id),
      kind:
        approval.kind === "supply"
          ? "supply"
          : approval.kind === "transfer"
            ? "transfer"
            : "withdrawal",
      fromCashShiftId: requiredString(approval.fromCashShiftId),
      toCashShiftId: optionalString(approval.toCashShiftId),
      amountCents: numeric(approval.amountCents) ?? 0,
      reason: requiredString(approval.reason),
      requestedByName: requiredString(approval.requestedByName),
      status:
        approval.status === "approved"
          ? "approved"
          : approval.status === "rejected"
            ? "rejected"
            : "pending",
      requestedAt: optionalString(approval.requestedAt),
    })),
    pendingTransfers: rows(payload, "pendingTransfers").map((transfer) => ({
      id: requiredString(transfer.id),
      fromCashShiftId: requiredString(transfer.fromCashShiftId),
      toCashShiftId: requiredString(transfer.toCashShiftId),
      fromCashRegisterName: requiredString(transfer.fromCashRegisterName),
      toCashRegisterName: requiredString(transfer.toCashRegisterName),
      amountCents: numeric(transfer.amountCents) ?? 0,
      reason: requiredString(transfer.reason),
      requestedByName: requiredString(transfer.requestedByName),
      requestedAt: optionalString(transfer.requestedAt),
      canDecide: boolean(transfer.canDecide),
    })),
    adjustments: rows(payload, "adjustments").map((adjustment) => ({
      id: requiredString(adjustment.id),
      cashRegisterId: optionalString(adjustment.cashRegisterId),
      originalCashShiftId: optionalString(adjustment.originalCashShiftId),
      direction: adjustment.direction === "out" ? "out" : "in",
      entryType: requiredString(adjustment.entryType),
      paymentMethod: optionalString(adjustment.paymentMethod),
      affectsDrawer: boolean(adjustment.affectsDrawer),
      amountCents: numeric(adjustment.amountCents) ?? 0,
      description: optionalString(adjustment.description),
      actorName: optionalString(adjustment.actorName),
      occurredAt: optionalString(adjustment.occurredAt),
    })),
    registers: rows(payload, "registers").map((cashRegister) => ({
      id: requiredString(cashRegister.id),
      name: requiredString(cashRegister.name),
      active: boolean(cashRegister.active),
      openShiftId: optionalString(cashRegister.openShiftId),
    })),
    availableTerminals: rows(payload, "availableTerminals").map((terminal) => ({
      installationId: requiredString(terminal.installationId),
      label: requiredString(terminal.label),
      cashRegisterId: optionalString(terminal.cashRegisterId),
      status:
        terminal.status === "online"
          ? "online"
          : terminal.status === "offline"
            ? "offline"
            : "unpaired",
      lastSeenAt: optionalString(terminal.lastSeenAt),
    })),
    shifts: rows(payload, "shifts").map((shift) => ({
      id: requiredString(shift.id),
      cashRegisterId: requiredString(shift.cashRegisterId),
      cashRegisterName: requiredString(shift.cashRegisterName),
      status: requiredString(shift.status),
      openingCents: numeric(shift.openingCents) ?? 0,
      expectedCents: numeric(shift.expectedCents, true),
      countedCents: numeric(shift.countedCents, true),
      differenceCents: numeric(shift.differenceCents, true),
      openedAt: optionalString(shift.openedAt),
      closedAt: optionalString(shift.closedAt),
      operatorName: optionalString(shift.operatorName),
      closedByName: optionalString(shift.closedByName),
      reviewedByName: optionalString(shift.reviewedByName),
      reviewedAt: optionalString(shift.reviewedAt),
      reviewNote: optionalString(shift.reviewNote),
      currentResponsibleIdentityId: optionalString(shift.currentResponsibleIdentityId),
      responsibleName: optionalString(shift.responsibleName),
      tenderBreakdown: parseCashTenderCounts(shift.tenderBreakdown),
      differenceSeverity: cashDifferenceSeverity(shift.differenceSeverity),
    })),
    entries: rows(payload, "entries").map((entry) => ({
      id: requiredString(entry.id),
      cashShiftId: requiredString(entry.cashShiftId),
      direction: entry.direction === "out" ? "out" : "in",
      entryType: requiredString(entry.entryType),
      paymentMethod: optionalString(entry.paymentMethod),
      affectsDrawer: boolean(entry.affectsDrawer),
      amountCents: numeric(entry.amountCents) ?? 0,
      description: optionalString(entry.description),
      actorName: optionalString(entry.actorName),
      occurredAt: optionalString(entry.occurredAt),
    })),
    pendingTabs: rows(payload, "pendingTabs").map((tab) => ({
      id: requiredString(tab.id),
      label: requiredString(tab.label),
      totalCents: numeric(tab.totalCents) ?? 0,
      paidCents: numeric(tab.paidCents) ?? 0,
      remainingCents: numeric(tab.remainingCents) ?? 0,
    })),
    capabilities: {
      canOpen: boolean(capabilities.canOpen),
      canMove: boolean(capabilities.canMove),
      canClose: boolean(capabilities.canClose),
      canReview: boolean(capabilities.canReview),
      canViewExpected: boolean(capabilities.canViewExpected),
      canManageRegisters: boolean(capabilities.canManageRegisters),
      canTransfer: boolean(capabilities.canTransfer),
      canManageCashSettings: boolean(capabilities.canManageCashSettings),
      canManageTerminals: boolean(capabilities.canManageTerminals),
      canApproveCashRequests: boolean(capabilities.canApproveCashRequests),
      canHandover: boolean(capabilities.canHandover),
    },
  };
}

function parseCashHistoryItem(value: unknown): CashHistoryItem {
  const shift = record(value);
  return {
    id: requiredString(shift.id),
    cashRegisterId: requiredString(shift.cashRegisterId),
    cashRegisterName: requiredString(shift.cashRegisterName),
    status: requiredString(shift.status),
    openingCents: numeric(shift.openingCents) ?? 0,
    expectedCents: numeric(shift.expectedCents, true),
    countedCents: numeric(shift.countedCents, true),
    differenceCents: numeric(shift.differenceCents, true),
    differenceSeverity: cashDifferenceSeverity(shift.differenceSeverity),
    openedAt: optionalString(shift.openedAt),
    closedAt: optionalString(shift.closedAt),
    operatorName: optionalString(shift.operatorName),
    responsibleName: optionalString(shift.responsibleName),
    closedByName: optionalString(shift.closedByName),
  };
}

function parseCashEntry(value: unknown): CashEntry {
  const entry = record(value);
  return {
    id: requiredString(entry.id),
    cashShiftId: requiredString(entry.cashShiftId),
    direction: entry.direction === "out" ? "out" : "in",
    entryType: requiredString(entry.entryType),
    paymentMethod: optionalString(entry.paymentMethod),
    affectsDrawer: boolean(entry.affectsDrawer),
    amountCents: numeric(entry.amountCents) ?? 0,
    description: optionalString(entry.description),
    actorName: optionalString(entry.actorName),
    occurredAt: optionalString(entry.occurredAt),
  };
}

function parseCashAdjustment(value: unknown): CashAdjustment {
  const adjustment = record(value);
  return {
    id: requiredString(adjustment.id),
    cashRegisterId: optionalString(adjustment.cashRegisterId),
    originalCashShiftId: optionalString(adjustment.originalCashShiftId),
    direction: adjustment.direction === "out" ? "out" : "in",
    entryType: requiredString(adjustment.entryType),
    paymentMethod: optionalString(adjustment.paymentMethod),
    affectsDrawer: boolean(adjustment.affectsDrawer),
    amountCents: numeric(adjustment.amountCents) ?? 0,
    description: optionalString(adjustment.description),
    actorName: optionalString(adjustment.actorName),
    occurredAt: optionalString(adjustment.occurredAt),
  };
}

export function parseCashHistory(value: unknown): CashHistoryPage {
  const payload = record(value);
  return {
    items: rows(payload, "items").map(parseCashHistoryItem),
    nextCursor: optionalString(payload.nextCursor),
  };
}

export function parseCashShiftDetail(value: unknown): CashShiftDetail {
  const payload = record(value);
  return {
    shift: parseCashHistoryItem(payload.shift),
    entries: rows(payload, "entries").map(parseCashEntry),
    tenderCounts: parseCashTenderCounts(payload.tenderCounts),
    responsibilities: rows(payload, "responsibilities").map((candidate) => ({
      id: requiredString(candidate.id),
      fromName: requiredString(candidate.fromName),
      toName: requiredString(candidate.toName),
      transferredByName: requiredString(candidate.transferredByName),
      reason: requiredString(candidate.reason),
      occurredAt: optionalString(candidate.occurredAt),
    })),
    adjustments: rows(payload, "adjustments").map(parseCashAdjustment),
  };
}

export function parseCashClosure(value: unknown): CashClosureResult {
  const payload = record(value);
  return {
    cashShiftId: requiredString(payload.cashShiftId),
    status: requiredString(payload.status),
    expectedCents: numeric(payload.expectedCents) ?? 0,
    countedCents: numeric(payload.countedCents) ?? 0,
    differenceCents: numeric(payload.differenceCents) ?? 0,
    drawerInCents: numeric(payload.drawerInCents) ?? 0,
    drawerOutCents: numeric(payload.drawerOutCents) ?? 0,
    breakdown: rows(payload, "breakdown").map((entry) => ({
      method: requiredString(entry.method),
      amountCents: numeric(entry.amountCents) ?? 0,
    })),
    reviewRequired: boolean(payload.reviewRequired),
    differenceSeverity: cashDifferenceSeverity(payload.differenceSeverity),
    tenderBreakdown: parseCashTenderCounts(payload.tenderBreakdown),
  };
}

function parsePerson(person: Row): Person {
  const rawAccess =
    person.access === undefined || person.access === null ? null : record(person.access);
  const accessStatus = rawAccess
    ? requiredString(rawAccess.status)
    : person.identityId
      ? "active"
      : "none";
  if (!["none", "pending", "expired", "active", "suspended"].includes(accessStatus)) {
    throw new InvalidManagementPayloadError();
  }
  return {
    id: requiredString(person.id),
    identityId: optionalString(person.identityId),
    name: requiredString(person.name),
    roleLabel: requiredString(person.roleLabel),
    employmentCode: optionalString(person.employmentCode),
    active: boolean(person.active),
    hourlyRateCents: numeric(person.hourlyRateCents, true),
    updatedAt: optionalString(person.updatedAt) ?? undefined,
    statusReason: optionalString(person.statusChangeReason ?? person.statusReason),
    statusChangedAt: optionalString(person.statusChangedAt),
    access: {
      status: accessStatus as PersonAccessStatus,
      email: rawAccess ? optionalString(rawAccess.email) : null,
      role: rawAccess ? optionalString(rawAccess.role) : null,
      invitationId: rawAccess ? optionalString(rawAccess.invitationId) : null,
      expiresAt: rawAccess ? optionalString(rawAccess.expiresAt) : null,
      membershipId: rawAccess ? optionalString(rawAccess.membershipId) : null,
    },
  };
}

function parsePersonAccessValue(value: unknown): PersonAccess {
  const access = record(value);
  const status = requiredString(access.status);
  if (!["none", "pending", "expired", "active", "suspended"].includes(status)) {
    throw new InvalidManagementPayloadError();
  }
  return {
    status: status as PersonAccessStatus,
    email: optionalString(access.email),
    role: optionalString(access.role),
    invitationId: optionalString(access.invitationId),
    expiresAt: optionalString(access.expiresAt),
    membershipId: optionalString(access.membershipId),
  };
}

export function parsePeopleAccessCenter(value: unknown): PeopleAccessCenterData {
  const payload = record(value);
  return {
    terminals: rows(payload, "terminals").map((terminal) => {
      const status = requiredString(terminal.status);
      if (!["waiting", "active", "locked"].includes(status)) {
        throw new InvalidManagementPayloadError();
      }
      return {
        id: requiredString(terminal.id),
        deviceId: optionalString(terminal.deviceId),
        openedBy: requiredString(terminal.openedBy),
        activeOperator: optionalString(terminal.activeOperator),
        status: status as ManagedTerminalSession["status"],
        createdAt: requiredString(terminal.createdAt),
        lastActivityAt: optionalString(terminal.lastActivityAt),
        lockedUntil: optionalString(terminal.lockedUntil),
        expiresAt: requiredString(terminal.expiresAt),
      };
    }),
  };
}

export function parsePersonOffboardingPreflight(value: unknown): PersonOffboardingPreflight {
  const payload = record(value);
  const counts = record(payload.counts);
  return {
    canProceed: boolean(payload.canProceed),
    counts: {
      openTimeEntries: integer(counts.openTimeEntries),
      futureSchedules: integer(counts.futureSchedules),
      unsettledCommissions: integer(counts.unsettledCommissions),
      openCashShifts: integer(counts.openCashShifts),
      activeTerminals: integer(counts.activeTerminals),
      accessAssignments: integer(counts.accessAssignments),
    },
    checks: rows(payload, "checks").map((check) => {
      const severity = requiredString(check.severity);
      if (!["blocker", "warning", "info"].includes(severity)) {
        throw new InvalidManagementPayloadError();
      }
      return {
        code: requiredString(check.code),
        label: requiredString(check.label),
        count: integer(check.count),
        severity: severity as "blocker" | "warning" | "info",
      };
    }),
  };
}

export function parsePersonAccessOverview(value: unknown): PersonAccessOverviewData {
  const payload = record(value);
  return {
    units: rows(payload, "units").map((unit) => ({
      id: requiredString(unit.id),
      name: requiredString(unit.name),
      active: boolean(unit.active),
    })),
    assignments: rows(payload, "assignments").map((assignment) => {
      const rawDelivery = assignment.delivery ? record(assignment.delivery) : null;
      const deliveryStatus = rawDelivery ? requiredString(rawDelivery.status) : null;
      if (deliveryStatus && !["queued", "sent", "failed"].includes(deliveryStatus)) {
        throw new InvalidManagementPayloadError();
      }
      return {
        unitId: requiredString(assignment.unitId),
        unitName: requiredString(assignment.unitName),
        primary: boolean(assignment.primary),
        access: parsePersonAccessValue(assignment.access),
        delivery: rawDelivery
          ? {
              status: deliveryStatus as "queued" | "sent" | "failed",
              attempts: integer(rawDelivery.attempts),
              processedAt: optionalString(rawDelivery.processedAt),
              lastError: optionalString(rawDelivery.lastError),
            }
          : null,
      };
    }),
    history: rows(payload, "history").map((event) => ({
      id: requiredString(event.id),
      action: requiredString(event.action),
      actorName: requiredString(event.actorName),
      metadata: record(event.metadata),
      occurredAt: requiredString(event.occurredAt),
    })),
    offboarding: parsePersonOffboardingPreflight(payload.offboarding),
  };
}

export function parsePeopleDirectory(value: unknown): PeopleDirectoryData {
  const payload = record(value);
  const pagination = record(payload.pagination);
  return {
    items: rows(payload, "items").map(parsePerson),
    pagination: {
      page: integer(pagination.page),
      pageSize: integer(pagination.pageSize),
      total: integer(pagination.total),
      pageCount: integer(pagination.pageCount ?? pagination.totalPages),
    },
  };
}

export function parsePeopleCapabilities(value: unknown): PeopleCapabilities {
  const payload = record(value);
  return {
    canView: boolean(payload.canView),
    canManage: boolean(payload.canManage),
    canConfigure: boolean(payload.canConfigure),
    canApproveCommissions: boolean(payload.canApproveCommissions),
    canPayCommissions: boolean(payload.canPayCommissions),
    reason: optionalString(payload.reason),
  };
}

function peopleCoverage(value: unknown): "complete" | "partial" {
  if (value === "complete" || value === "partial") return value;
  throw new InvalidManagementPayloadError();
}

export function parsePeopleIndicators(value: unknown): PeopleIndicatorsData {
  const payload = record(value);
  const period = record(payload.period);
  const indicators = record(payload.indicators);
  const coverage = record(payload.coverage);
  return {
    period: { from: requiredString(period.from), to: requiredString(period.to) },
    timezone: requiredString(payload.timezone),
    indicators: {
      scheduledShifts: integer(indicators.scheduledShifts),
      absences: integer(indicators.absences),
      lateArrivals: integer(indicators.lateArrivals),
      recurringLatePeople: integer(indicators.recurringLatePeople),
      overtimeMinutes: integer(indicators.overtimeMinutes),
      laborCostCents: integer(indicators.laborCostCents),
      laborCostPercentage: numeric(indicators.laborCostPercentage, true),
    },
    coverage: {
      schedules: peopleCoverage(coverage.schedules),
      timeEntries: peopleCoverage(coverage.timeEntries),
      laborCost: peopleCoverage(coverage.laborCost),
      missingHourlyRatePeople: integer(coverage.missingHourlyRatePeople),
    },
  };
}

export function parsePersonTimeline(value: unknown): PersonTimelineData {
  const payload = record(value);
  const period = record(payload.period);
  const reconciliation = record(payload.reconciliation);
  const coverage = record(payload.coverage);
  return {
    person: parsePerson(record(payload.person)),
    period: {
      from: requiredString(period.from),
      to: requiredString(period.to),
      timezone: requiredString(period.timezone),
    },
    schedules: rows(payload, "schedules").map((schedule) => ({
      id: requiredString(schedule.id),
      personId: requiredString(schedule.personId),
      startsAt: requiredString(schedule.startsAt),
      endsAt: requiredString(schedule.endsAt),
      breakMinutes: integer(schedule.breakMinutes),
      notes: optionalString(schedule.notes),
      status: schedule.canceledAt ? "canceled" : "active",
      canceledAt: optionalString(schedule.canceledAt),
      cancelReason: optionalString(schedule.cancelReason),
      updatedAt: optionalString(schedule.updatedAt) ?? undefined,
    })),
    entries: rows(payload, "entries").map((entry) => {
      const summary = record(entry.summary);
      const person = record(entry.person);
      return {
        id: requiredString(entry.id),
        personId: requiredString(entry.personId),
        clockedInAt: requiredString(entry.clockedInAt),
        clockedOutAt: optionalString(entry.clockedOutAt),
        source: requiredString(entry.source),
        personName: requiredString(person.name),
        summary: {
          timeEntryId: requiredString(summary.timeEntryId),
          personId: requiredString(summary.personId),
          date: requiredString(summary.date),
          workedMinutes: integer(summary.workedMinutes),
          breakMinutes: integer(summary.breakMinutes),
          scheduledMinutes: numeric(summary.scheduledMinutes, true),
          overtimeMinutes: integer(summary.overtimeMinutes),
          anomalyCodes: Array.isArray(summary.anomalyCodes)
            ? summary.anomalyCodes.filter((item): item is string => typeof item === "string")
            : [],
        },
        hourlyRateCents: numeric(entry.hourlyRateCents, true),
        estimatedLaborCostCents: numeric(entry.estimatedLaborCostCents, true),
      };
    }),
    reconciliation: {
      scheduledMinutes: integer(reconciliation.scheduledMinutes),
      workedMinutes: integer(reconciliation.workedMinutes),
      overtimeMinutes: integer(reconciliation.overtimeMinutes),
      lateArrivals: integer(reconciliation.lateArrivals),
    },
    coverage: {
      schedules: peopleCoverage(coverage.schedules),
      timeEntries: peopleCoverage(coverage.timeEntries),
      laborCost: peopleCoverage(coverage.laborCost),
    },
  };
}

export function parsePeople(value: unknown): PeopleData {
  const payload = record(value);
  const settings = parseTimeTrackingSettings(payload.settings);
  const parseSummary = (summary: Record<string, unknown>): TimeEntrySummary => ({
    timeEntryId: requiredString(summary.timeEntryId),
    personId: requiredString(summary.personId),
    date: requiredString(summary.date),
    workedMinutes: integer(summary.workedMinutes),
    breakMinutes: integer(summary.breakMinutes),
    scheduledMinutes: numeric(summary.scheduledMinutes, true),
    overtimeMinutes: integer(summary.overtimeMinutes),
    anomalyCodes: Array.isArray(summary.anomalyCodes)
      ? summary.anomalyCodes.filter((item): item is string => typeof item === "string")
      : [],
  });
  const parseCorrection = (correction: Record<string, unknown>): TimeCorrection => ({
    id: requiredString(correction.id),
    timeEntryId: requiredString(correction.timeEntryId),
    personId: requiredString(correction.personId),
    requestedClockedInAt: requiredString(correction.requestedClockedInAt),
    requestedClockedOutAt: optionalString(correction.requestedClockedOutAt),
    reason: requiredString(correction.reason),
    status: correction.status as TimeCorrection["status"],
    requiresSpecialApproval: correction.requiresSpecialApproval === true,
  });
  return {
    people: rows(payload, "people").map(parsePerson),
    schedules: rows(payload, "schedules").map((schedule) => ({
      id: requiredString(schedule.id),
      personId: requiredString(schedule.personId),
      startsAt: requiredString(schedule.startsAt),
      endsAt: requiredString(schedule.endsAt),
      breakMinutes: integer(schedule.breakMinutes),
      notes: optionalString(schedule.notes),
      status: schedule.status === "canceled" ? "canceled" : "active",
      canceledAt: optionalString(schedule.canceledAt),
      cancelReason: optionalString(schedule.cancelReason),
      updatedAt: optionalString(schedule.updatedAt) ?? undefined,
    })),
    timeEntries: rows(payload, "timeEntries").map((entry) => ({
      id: requiredString(entry.id),
      personId: requiredString(entry.personId),
      clockedInAt: requiredString(entry.clockedInAt),
      clockedOutAt: optionalString(entry.clockedOutAt),
      source: requiredString(entry.source),
    })),
    breaks: parseTimeBreaks(payload),
    corrections: rows(payload, "corrections").map(parseCorrection),
    summaries: rows(payload, "summaries").map(parseSummary),
    anomalies: rows(payload, "anomalies").map(parseSummary),
    alerts: rows(payload, "alerts").map((alert) => ({
      type: requiredString(alert.type),
      personId: requiredString(alert.personId),
      timeEntryId: optionalString(alert.timeEntryId) ?? undefined,
      message: requiredString(alert.message),
      severity:
        alert.severity === "danger" || alert.severity === "warning" ? alert.severity : "info",
    })),
    closures: rows(payload, "closures").map((closure) => ({
      id: requiredString(closure.id),
      periodStart: requiredString(closure.periodStart),
      periodEnd: requiredString(closure.periodEnd),
      status: "closed" as const,
      closedAt: requiredString(closure.closedAt),
      reason: optionalString(closure.reason),
    })),
    settings,
    canManage: payload.canManage !== false,
    accounts: rows(payload, "accounts").map((account) => ({
      id: requiredString(account.id),
      displayName: requiredString(account.displayName),
      email: requiredString(account.email),
    })),
    commissionRules: optionalRows(payload, "commissionRules").map((rule) => ({
      id: requiredString(rule.id),
      name: requiredString(rule.name),
      basisPoints: integer(rule.basisPoints),
      active: boolean(rule.active),
    })),
    commissions: optionalRows(payload, "commissions").map((commission) => {
      const status = requiredString(commission.status);
      if (!["pending", "approved", "rejected", "paid", "canceled"].includes(status)) {
        throw new InvalidManagementPayloadError();
      }
      return {
        id: requiredString(commission.id),
        personId: requiredString(commission.personId),
        ruleId: optionalString(commission.ruleId),
        sourceOrderId: optionalString(commission.sourceOrderId),
        baseCents: integer(commission.baseCents),
        amountCents: integer(commission.amountCents),
        status: status as Commission["status"],
        createdAt: requiredString(commission.createdAt),
        reviewNote: optionalString(commission.reviewNote),
        reviewedAt: optionalString(commission.reviewedAt),
        paidAt: optionalString(commission.paidAt),
        canceledAt: optionalString(commission.canceledAt),
      };
    }),
    selectedPersonIds: Array.isArray(payload.selectedPersonIds)
      ? payload.selectedPersonIds.filter((item): item is string => typeof item === "string")
      : [],
  };
}

export function parseTimeTrackingReport(value: unknown): TimeTrackingReport {
  const payload = record(value);
  const rows = rowsFromPayload(payload);
  const parseSummary = (summary: Record<string, unknown>): TimeEntrySummary => ({
    timeEntryId: requiredString(summary.timeEntryId),
    personId: requiredString(summary.personId),
    date: requiredString(summary.date),
    workedMinutes: integer(summary.workedMinutes),
    breakMinutes: integer(summary.breakMinutes),
    scheduledMinutes: numeric(summary.scheduledMinutes, true),
    overtimeMinutes: integer(summary.overtimeMinutes),
    anomalyCodes: Array.isArray(summary.anomalyCodes)
      ? summary.anomalyCodes.filter((item): item is string => typeof item === "string")
      : [],
  });
  return {
    from: requiredString(payload.from),
    to: requiredString(payload.to),
    timezone: requiredString(payload.timezone),
    rows: rows.map((entry) => {
      const person = record(entry.person);
      return {
        id: requiredString(entry.id),
        personId: requiredString(entry.personId),
        clockedInAt: requiredString(entry.clockedInAt),
        clockedOutAt: optionalString(entry.clockedOutAt),
        source: requiredString(entry.source),
        personName: requiredString(person.name),
        hourlyRateCents: numeric(entry.hourlyRateCents, true),
        estimatedLaborCostCents: numeric(entry.estimatedLaborCostCents, true),
        summary: parseSummary(record(entry.summary)),
      };
    }),
    totals: {
      workedMinutes: integer(record(payload.totals).workedMinutes),
      breakMinutes: integer(record(payload.totals).breakMinutes),
      overtimeMinutes: integer(record(payload.totals).overtimeMinutes),
      laborCostCents: integer(record(payload.totals).laborCostCents),
      revenueCents: integer(record(payload.totals).revenueCents),
      laborCostPercentage: numeric(record(payload.totals).laborCostPercentage, true),
      entries: integer(record(payload.totals).entries),
      anomalies: integer(record(payload.totals).anomalies),
    },
  };
}

function rowsFromPayload(payload: Record<string, unknown>) {
  return rows(payload, "rows");
}

export function parseSelfTimeTracking(value: unknown): SelfTimeTrackingData {
  const payload = record(value);
  const personValue =
    payload.person === null || payload.person === undefined ? null : record(payload.person);
  const parseEntry = (entry: Record<string, unknown>): TimeEntry => ({
    id: requiredString(entry.id),
    personId: requiredString(entry.personId),
    clockedInAt: requiredString(entry.clockedInAt),
    clockedOutAt: optionalString(entry.clockedOutAt),
    source: requiredString(entry.source),
  });
  const current =
    payload.current === null || payload.current === undefined
      ? null
      : parseEntry(record(payload.current));
  return {
    enabled: payload.enabled === true,
    person: personValue ? parsePerson(personValue) : null,
    settings: parseTimeTrackingSettings(payload.settings),
    current,
    entries: rows(payload, "entries").map(parseEntry),
    breaks: parseTimeBreaks(payload),
  };
}

function parseTimeTrackingSettings(value: unknown): TimeTrackingSettings {
  const settings = record(value);
  const mode = requiredString(settings.mode);
  if (!(["off", "all", "selected"] as const).includes(mode as TimeTrackingSettings["mode"])) {
    throw new InvalidManagementPayloadError();
  }
  return {
    mode: mode as TimeTrackingSettings["mode"],
    geofenceEnabled: settings.geofenceEnabled !== false,
    locationLabel: optionalString(settings.locationLabel),
    locationAddress: optionalString(settings.locationAddress),
    latitude: numeric(settings.latitude, true),
    longitude: numeric(settings.longitude, true),
    radiusMeters: numeric(settings.radiusMeters, true) ?? 100,
    accuracyToleranceMeters: numeric(settings.accuracyToleranceMeters, true) ?? 50,
    maxLocationAccuracyMeters: numeric(settings.maxLocationAccuracyMeters, true) ?? 100,
    lowAccuracyPolicy: settings.lowAccuracyPolicy === "flag" ? "flag" : "block",
    additionalLocations: optionalRows(settings, "additionalLocations").map((location) => ({
      id: requiredString(location.id),
      label: requiredString(location.label),
      address: optionalString(location.address),
      latitude: numeric(location.latitude, true) ?? 0,
      longitude: numeric(location.longitude, true) ?? 0,
      radiusMeters: numeric(location.radiusMeters, true) ?? 100,
      accuracyToleranceMeters: numeric(location.accuracyToleranceMeters, true) ?? 50,
    })),
    managerCanView: settings.managerCanView === true,
    financeCanView: settings.financeCanView === true,
    antiFraudEnabled: settings.antiFraudEnabled !== false,
    offlineEnabled: settings.offlineEnabled !== false,
    offlineMaxDelayMinutes: numeric(settings.offlineMaxDelayMinutes, true) ?? 120,
    offlineRequiresJustification: settings.offlineRequiresJustification !== false,
    notificationsEnabled: settings.notificationsEnabled !== false,
    emailAlertsEnabled: settings.emailAlertsEnabled === true,
    managerAlertOnAnomaly: settings.managerAlertOnAnomaly !== false,
    locationRetentionDays: numeric(settings.locationRetentionDays, true) ?? 365,
    lateToleranceMinutes: numeric(settings.lateToleranceMinutes, true) ?? 15,
    minimumBreakMinutes: numeric(settings.minimumBreakMinutes, true) ?? 0,
    maxOvertimeMinutes: numeric(settings.maxOvertimeMinutes, true) ?? 120,
    longShiftAlertMinutes: numeric(settings.longShiftAlertMinutes, true) ?? 720,
    reminderBeforeShiftMinutes: numeric(settings.reminderBeforeShiftMinutes, true) ?? 15,
    reminderAfterShiftMinutes: numeric(settings.reminderAfterShiftMinutes, true) ?? 15,
  };
}

function parseTimeBreaks(payload: Record<string, unknown>): TimeBreak[] {
  return rows(payload, "breaks").map((entry) => {
    const type = requiredString(entry.type);
    if (type !== "meal" && type !== "temporary") throw new InvalidManagementPayloadError();
    return {
      id: requiredString(entry.id),
      timeEntryId: requiredString(entry.timeEntryId),
      type,
      startedAt: requiredString(entry.startedAt),
      endedAt: optionalString(entry.endedAt),
    };
  });
}

export function useRemote<T>(
  scope: ManagementScope,
  loader: (organizationId: string, unitId: string) => Promise<unknown>,
  parser: (value: unknown) => T,
) {
  const [refresh, setRefresh] = useState(0);
  const [state, setState] = useState<RemoteState<T>>({ status: "loading" });
  const [updating, setUpdating] = useState(false);
  const [refreshError, setRefreshError] = useState<string | null>(null);
  const loaderRef = useRef(loader);
  const parserRef = useRef(parser);
  const readyRef = useRef(false);
  const scopeKey = `${scope.organizationId}:${scope.unitId}`;
  const scopeKeyRef = useRef(scopeKey);
  const requestIdRef = useRef(0);
  const hasRequestedRef = useRef(false);
  loaderRef.current = loader;
  parserRef.current = parser;
  useEffect(() => {
    void refresh;
    void scope.refreshToken;
    let active = true;
    const requestId = ++requestIdRef.current;
    const scopeChanged = scopeKeyRef.current !== scopeKey;
    scopeKeyRef.current = scopeKey;
    if (scopeChanged) readyRef.current = false;
    setUpdating(readyRef.current);
    setRefreshError(null);
    setState((prev) => (scopeChanged || prev.status !== "ready" ? { status: "loading" } : prev));
    const bypassReadyCache = hasRequestedRef.current;
    hasRequestedRef.current = true;
    loadManagementRemote(
      loaderRef.current,
      parserRef.current,
      scope.organizationId,
      scope.unitId,
      bypassReadyCache,
    )
      .then((data) => {
        if (active && requestIdRef.current === requestId) {
          readyRef.current = true;
          setState({ status: "ready", data });
          setUpdating(false);
        }
      })
      .catch((error: unknown) => {
        if (!active || requestIdRef.current !== requestId) return;
        const message =
          error instanceof Error ? error.message : "Não foi possível carregar os dados.";
        if (readyRef.current) setRefreshError(message);
        setState((prev) =>
          prev.status === "ready"
            ? prev
            : {
                status: "error",
                message,
                ...(error instanceof ApiClientError
                  ? { httpStatus: error.status, requestId: error.requestId }
                  : {}),
                ...(error instanceof ApiClientError && error.status === 429
                  ? { retryAfterSeconds: retryDelay(error.message) }
                  : {}),
              },
        );
        setUpdating(false);
      });
    return () => {
      active = false;
    };
  }, [refresh, scope.refreshToken, scopeKey, scope.organizationId, scope.unitId]);
  const retry = useCallback(() => setRefresh((value) => value + 1), []);
  const update = useCallback(
    (updater: (data: T) => T) =>
      setState((current) =>
        current.status === "ready" ? { status: "ready", data: updater(current.data) } : current,
      ),
    [],
  );
  return {
    state,
    retry,
    update,
    updating,
    refreshError,
    stale: refreshError !== null,
  };
}

function retryDelay(message: string): number {
  const seconds = message.match(/(\d+)\s*(?:segundos?|seconds?)/i)?.[1];
  return seconds ? Math.max(1, Number(seconds)) : 30;
}

export function RemoteGate<T>({
  remote,
  children,
}: {
  remote: { state: RemoteState<T>; retry: () => void };
  children: (data: T) => React.ReactNode;
}) {
  if (remote.state.status === "loading") {
    return (
      <Card className="remote-state" role="status">
        <span className="spinner" aria-hidden="true" />
        <strong>Carregando dados da unidade…</strong>
        <p>Aguarde a resposta segura do servidor.</p>
      </Card>
    );
  }
  if (remote.state.status === "error") {
    const serverError = (remote.state.httpStatus ?? 0) >= 500;
    return (
      <Card className="remote-state" role="alert">
        <strong>
          {serverError
            ? "Serviço temporariamente indisponível"
            : "Não foi possível carregar esta área"}
        </strong>
        <p>
          {serverError
            ? "O servidor não conseguiu concluir a consulta. Tente novamente em instantes."
            : remote.state.message}
        </p>
        {remote.state.requestId && (
          <small>
            Referência: <code>{remote.state.requestId}</code>
          </small>
        )}
        <Button onClick={remote.retry} size="sm" variant="secondary">
          Tentar novamente
        </Button>
      </Card>
    );
  }
  return children(remote.state.data);
}

export function dateLabel(value: string | null): string {
  if (!value) return "Não informado";
  const date = new Date(value.length === 10 ? `${value}T12:00:00` : value);
  if (Number.isNaN(date.getTime())) return "Data inválida";
  return new Intl.DateTimeFormat("pt-BR", {
    dateStyle: "short",
    timeStyle: value.length > 10 ? "short" : undefined,
  }).format(date);
}

export function currencyToCents(value: string): number {
  const amount = Number(value.trim().replace(/\./g, "").replace(",", "."));
  return Number.isFinite(amount) ? Math.round(amount * 100) : -1;
}

export function operationalKey(prefix: string): string {
  return `${prefix}-${crypto.randomUUID()}`;
}

export function parseOverview(value: unknown): OverviewData {
  const payload = record(value);
  const profileId = requiredString(payload.profileId) as ProfileId;
  if (!overviewProfiles.has(profileId)) throw new InvalidManagementPayloadError();
  const activeShift = payload.activeShift === null ? null : record(payload.activeShift);
  const preferences = record(payload.preferences);
  const thresholds = record(preferences.thresholds);
  return {
    profileId: profileId as OverviewData["profileId"],
    generatedAt: requiredString(payload.generatedAt),
    activeShift: activeShift
      ? {
          label: requiredString(activeShift.label),
          startsAt: requiredString(activeShift.startsAt),
        }
      : null,
    unavailableSources: stringList(payload.unavailableSources),
    metrics: rows(payload, "metrics").map((item) => ({
      ...(item.comparison === undefined
        ? {}
        : {
            comparison: (() => {
              const comparison = record(item.comparison);
              return {
                label: requiredString(comparison.label),
                value: requiredString(comparison.value),
                tone: overviewTone(comparison.tone),
              };
            })(),
          }),
      ...(item.goal === undefined
        ? {}
        : {
            goal: (() => {
              const goal = record(item.goal);
              return { label: requiredString(goal.label), tone: overviewTone(goal.tone) };
            })(),
          }),
      id: requiredString(item.id),
      label: requiredString(item.label),
      value: requiredString(item.value),
      detail: requiredString(item.detail),
      tone: overviewTone(item.tone),
      route: overviewRoute(item.route),
      source: overviewSource(item.source),
    })),
    priorities: rows(payload, "priorities").map((item) => ({
      id: requiredString(item.id),
      title: requiredString(item.title),
      detail: requiredString(item.detail),
      tone: overviewTone(item.tone),
      route: overviewRoute(item.route),
      actionLabel: requiredString(item.actionLabel),
      source: overviewSource(item.source),
      occurrenceKey: requiredString(item.occurrenceKey),
      status: item.status === "claimed" ? "claimed" : "open",
      assignedTo:
        item.assignedTo === null
          ? null
          : (() => {
              const assigned = record(item.assignedTo);
              return {
                id: requiredString(assigned.id),
                name: requiredString(assigned.name),
                isMe: boolean(assigned.isMe),
              };
            })(),
    })),
    pulse: rows(payload, "pulse").map((item) => ({
      id: requiredString(item.id),
      label: requiredString(item.label),
      value: requiredString(item.value),
      route: item.route === undefined ? undefined : overviewRoute(item.route),
      source: overviewSource(item.source),
    })),
    quickActions: rows(payload, "quickActions").map((item) => ({
      id: requiredString(item.id),
      label: requiredString(item.label),
      route: overviewRoute(item.route),
    })),
    sources: rows(payload, "sources").map((source) => ({
      id: overviewSource(source.id),
      status: source.status === "fresh" ? "fresh" : "unavailable",
      checkedAt: requiredString(source.checkedAt),
    })),
    activity: rows(payload, "activity").map((item) => ({
      id: requiredString(item.id),
      label: requiredString(item.label),
      detail: requiredString(item.detail),
      occurredAt: requiredString(item.occurredAt),
      route: item.route === undefined ? undefined : overviewRoute(item.route),
    })),
    multiunit: rows(payload, "multiunit").map((unit) => ({
      unitId: requiredString(unit.unitId),
      name: requiredString(unit.name),
      salesCents: integer(unit.salesCents),
      marginCents: numeric(unit.marginCents, true),
      alerts: integer(unit.alerts),
      tone: overviewTone(unit.tone),
    })),
    preferences: {
      alertsEnabled: boolean(preferences.alertsEnabled),
      minimumTone:
        preferences.minimumTone === "info" || preferences.minimumTone === "danger"
          ? preferences.minimumTone
          : "warning",
      digestMinutes: integer(preferences.digestMinutes),
      thresholds: {
        kdsDelayMinutes: integer(thresholds.kdsDelayMinutes),
        stockCoverageDays: integer(thresholds.stockCoverageDays),
        deliveryRiskMinutes: integer(thresholds.deliveryRiskMinutes),
        salesGoalCents: integer(thresholds.salesGoalCents),
        maxKdsDelayed: integer(thresholds.maxKdsDelayed),
        maxStockouts: integer(thresholds.maxStockouts),
        maxDeliveryDelayed: integer(thresholds.maxDeliveryDelayed),
        maxReconciliations: integer(thresholds.maxReconciliations),
      },
    },
    lastVisitedAt: optionalString(payload.lastVisitedAt),
    partialSource: payload.partialSource === null ? null : overviewSource(payload.partialSource),
  };
}

const overviewProfiles = new Set<ProfileId>([
  "owner",
  "manager",
  "waiter",
  "cashier",
  "kitchen",
  "inventory",
  "finance",
  "delivery",
  "accountant",
]);

const overviewTones = new Set<OverviewTone>(["neutral", "success", "warning", "danger", "info"]);
const overviewSources = new Set<OverviewSourceId>([
  "operationalShift",
  "operations",
  "inventory",
  "finance",
  "cash",
  "delivery",
  "reservations",
  "activity",
  "multiunit",
]);

const overviewRoutes = new Set<RouteId>([
  "dashboard",
  "salon",
  "counter",
  "catalog",
  "kds",
  "cash",
  "inventory",
  "purchases",
  "finance",
  "reports",
  "fiscal",
  "accountant",
  "people",
  "delivery",
  "reservations",
  "crm",
  "multiunit",
  "alerts",
]);

function overviewTone(value: unknown): OverviewTone {
  const tone = requiredString(value) as OverviewTone;
  if (!overviewTones.has(tone)) throw new InvalidManagementPayloadError();
  return tone;
}

function overviewRoute(value: unknown): RouteId {
  const route = requiredString(value) as RouteId;
  if (!overviewRoutes.has(route)) throw new InvalidManagementPayloadError();
  return route;
}

function overviewSource(value: unknown): OverviewSourceId {
  const source = requiredString(value) as OverviewSourceId;
  if (!overviewSources.has(source)) throw new InvalidManagementPayloadError();
  return source;
}

function stringList(value: unknown): string[] {
  if (!Array.isArray(value)) throw new InvalidManagementPayloadError();
  return value.map(requiredString);
}
