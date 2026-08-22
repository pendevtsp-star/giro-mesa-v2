import { Button, Card } from "@giromesa/ui";
import { useCallback, useEffect, useRef, useState } from "react";
import type { ProfileId } from "./domain";
import type { PilotDispatcher, PilotLoader } from "./operational-dispatch";

export interface PilotScope {
  organizationId: string;
  unitId: string;
  identityId: string;
  membershipId: string;
  profileId: ProfileId;
  refreshToken: number;
  installationId?: string;
  embedded?: boolean;
  dispatch: PilotDispatcher;
  load: PilotLoader;
}

export type Row = Record<string, unknown>;
export type RemoteState<T> =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; data: T };

export function remoteStateAfterFailure<T>(state: RemoteState<T>, message: string): RemoteState<T> {
  return state.status === "ready" ? state : { status: "error", message };
}

export interface CatalogProduct {
  id: string;
  categoryId: string;
  sku: string | null;
  name: string;
  description: string | null;
  imageUrl: string | null;
  estimatedPrepTimeMinutes?: number | null;
  stationIds: string[];
  stationRouting?: Array<{ stationId: string; stage: number }>;
  priceCents: number;
  deliveryPriceCents?: number | null;
  costCents?: number | null;
  tags?: Array<"chef_special" | "bestseller" | "new" | "promo">;
  suggestedProductIds?: string[];
  availabilitySchedule?: {
    windows: Array<{ dayOfWeek: number; start: string; end: string }>;
  } | null;
  dailyStockLimit?: number | null;
  dailyStockRemaining?: number | null;
  priceHistory?: Array<{
    date: string;
    user: string;
    oldPriceCents: number;
    newPriceCents: number;
    reason?: string;
  }>;
  productType?: "prepared" | "resale";
  eanBarcode?: string | null;
  currentStockUnits?: number | null;
  minStockAlert?: number | null;
  autoDeductStock?: boolean;
  available: boolean;
  active: boolean;
  allergenIds: string[];
  modifierGroupIds: string[];
  sizes?: ProductSizeVariation[];
  spiciness?: SpicinessLevel;
  dietaryTags?: DietaryTag[];
  pairingSuggestion?: string | null;
  ncm?: string | null;
  cfop?: string | null;
  cest?: string | null;
  fiscalOrigin?: number | null;
  translations?: {
    en?: { name?: string; description?: string };
    es?: { name?: string; description?: string };
  };
  recipe: Array<{
    componentId?: string;
    name?: string;
    quantity: number;
    unit?: string;
    costCents?: number;
  }>;
}

export interface RecipeIngredient {
  id: string;
  name: string;
  quantity: number;
  unit: "g" | "kg" | "ml" | "l" | "un";
  costCents: number;
}

export interface PendingStockProductSuggestion {
  id: string;
  name: string;
  sku: string;
  eanBarcode: string;
  suggestedCategoryName: string;
  stockCostCents: number;
  suggestedPriceCents: number;
  currentStockUnits: number;
  unit: string;
  supplier: string;
  receivedDate: string;
}

export interface ProductSizeVariation {
  id: string;
  name: string; // ex: "P (300ml)", "M (500ml)", "Individual", "Para 2 Pessoas"
  priceCents: number;
  costCents?: number | null;
  default?: boolean;
}

export type SpicinessLevel = "none" | "mild" | "medium" | "hot";

export type DietaryTag =
  | "vegan"
  | "vegetarian"
  | "gluten_free"
  | "lactose_free"
  | "low_carb"
  | "organic"
  | "sugar_free";

export interface CatalogPromotionRule {
  id: string;
  name: string; // ex: "Happy Hour Chopp & Petiscos"
  discountType: "percentage" | "fixed_price" | "amount_off";
  discountValue: number; // 25 (para 25%) ou 890 (para R$ 8,90) ou 1000 (para R$ 10,00 off)
  daysOfWeek: number[]; // [1, 2, 3, 4, 5] (Seg a Sex)
  startTime: string; // "17:30"
  endTime: string; // "20:30"
  categoryIds?: string[];
  productIds?: string[];
  channels: {
    salon: boolean;
    qrMesa: boolean;
    delivery: boolean;
  };
  active: boolean;
}

export interface CatalogBrandingSettings {
  restaurantName: string;
  slogan?: string | null;
  brandColor: string; // "#10b981", "#6366f1", "#e11d48", etc
  headerBannerUrl?: string | null;
  address?: string | null;
  phone?: string | null;
  instagram?: string | null;
  openingHours?: string | null;
  serviceTaxNotice?: string | null; // "Cobramos 10% opcional de serviço"
  wifiNotice?: string | null; // "Wi-Fi: GiroMesa / Senha: gourmet"
  corkageFeeNotice?: string | null; // "Taxa de rolha: R$ 40,00"
}

export interface CatalogCombo {
  id: string;
  name: string;
  description: string | null;
  priceCents: number;
  active: boolean;
  items: Array<{ productId: string; quantity: number }>;
}
export interface Allergen {
  id: string;
  code: string;
  name: string;
}

export interface ModifierGroup {
  id: string;
  name: string;
  minimumSelections: number;
  maximumSelections: number;
}

export interface ModifierOption {
  id: string;
  groupId: string;
  name: string;
  priceDeltaCents: number;
  active: boolean;
}

export interface PilotCatalogCategory {
  id: string;
  name: string;
  description?: string | null;
  channels?: {
    salon: boolean;
    qrMesa: boolean;
    delivery: boolean;
  };
  schedule?: {
    startTime: string;
    endTime: string;
  } | null;
  defaultStationId?: string | null;
}

export interface PilotCatalog {
  categories: Array<PilotCatalogCategory>;
  stations: Array<{ id: string; name: string }>;
  allergens: Allergen[];
  groups: ModifierGroup[];
  options: ModifierOption[];
  products: CatalogProduct[];
  combos: CatalogCombo[];
  promotions?: CatalogPromotionRule[];
  branding?: CatalogBrandingSettings;
}

export interface FloorTable {
  id: string;
  roomId: string;
  label: string;
  seats: number;
  status: "available" | "occupied" | "reserved" | "needs_cleaning" | "cleaning";
  layoutX: number | null;
  layoutY: number | null;
  active: boolean;
}

export interface FloorPoint {
  x: number;
  y: number;
}

export type ServiceMode = "full_service" | "quick_service" | "bar" | "hybrid";

export function usesQuickServiceMode(mode: ServiceMode) {
  return mode === "quick_service" || mode === "bar";
}

export interface PosTab {
  id: string;
  tableId: string | null;
  openedAt?: string | null;
  createdAt?: string | null;
  operationalShiftId: string | null;
  shiftSectionId: string | null;
  label: string | null;
  displayNumber: number | null;
  fulfillmentType: "dine_in" | "pickup" | "delivery";
  customerName: string | null;
  customerPhone: string | null;
  readyNotificationConsent: boolean;
  serviceNotes: string | null;
  deliveryAddress: string | null;
  promisedAt: string | null;
  readyNotifiedAt: string | null;
  responsibleIdentityId: string | null;
  guestCount: number;
  version: number;
  status: string;
  serviceChargeBasisPoints: number;
  tipCents: number;
  subtotalCents: number;
  discountCents: number;
  serviceChargeCents: number;
  totalCents: number;
}

export interface PilotFloor {
  rooms: Array<{
    id: string;
    name: string;
    active: boolean;
    layoutPolygon: FloorPoint[] | null;
  }>;
  tables: FloorTable[];
  openTabs: PosTab[];
  tableGroups: Array<{
    id: string;
    anchorTableId: string;
    primaryTabId: string | null;
    mode: "physical_only" | "single_tab";
    responsibleIdentityId: string | null;
  }>;
  tableGroupMembers: Array<{ groupId: string; tableId: string }>;
  serviceCalls: Array<{
    id: string;
    tableId: string;
    tabId: string | null;
    kind: "assistance" | "bill" | "water" | "other";
    status: "open" | "acknowledged";
    slaMinutes: number;
    acknowledgedByIdentityId: string | null;
    acknowledgedAt: string | null;
    createdAt: string;
  }>;
  tablePhases: Array<{
    tableId: string;
    tabId: string;
    phase: "awaiting_order" | "production" | "ready" | "served";
    since: string;
  }>;
  staff: Array<{ identityId: string; displayName: string }>;
  serviceMode: ServiceMode;
  serviceSections: Array<{
    id: string;
    name: string;
    color: string;
    serviceMode: ServiceMode;
    defaultResponsibleIdentityId: string | null;
  }>;
  serviceSectionTables: Array<{ sectionId: string; tableId: string }>;
  activeShift: {
    id: string;
    label: string;
    serviceMode: ServiceMode;
    startsAt: string;
  } | null;
  shiftSections: Array<{
    id: string;
    shiftId: string;
    sectionTemplateId: string | null;
    name: string;
    color: string;
    serviceMode: ServiceMode;
  }>;
  shiftSectionTables: Array<{ shiftId: string; shiftSectionId: string; tableId: string }>;
  shiftSectionStaff: Array<{
    shiftId: string;
    shiftSectionId: string;
    identityId: string;
    role: "primary" | "support";
  }>;
  shiftTableLayouts: Array<{
    shiftId: string;
    tableId: string;
    roomId: string;
    x: number;
    y: number;
  }>;
  shiftTableTransfers: Array<{
    id: string;
    shiftId: string;
    tableId: string;
    sourceShiftSectionId: string;
    targetShiftSectionId: string;
    expiresAt: string;
    reason: string;
    transferredByIdentityId: string;
  }>;
}

export function summarizeOperationalLoad(floor: PilotFloor) {
  const effectiveSectionId = (tableId: string) =>
    floor.shiftTableTransfers.find((row) => row.tableId === tableId)?.targetShiftSectionId ??
    floor.shiftSectionTables.find((row) => row.tableId === tableId)?.shiftSectionId;
  const sections = floor.shiftSections.map((section) => {
    const tableIds = floor.tables
      .filter((table) => table.active && effectiveSectionId(table.id) === section.id)
      .map((table) => table.id);
    const tabs = floor.openTabs.filter((tab) => tab.tableId && tableIds.includes(tab.tableId));
    return {
      id: section.id,
      name: section.name,
      color: section.color,
      tables: tableIds.length,
      occupied: floor.tables.filter(
        (table) => tableIds.includes(table.id) && table.status === "occupied",
      ).length,
      guests: tabs.reduce((sum, tab) => sum + tab.guestCount, 0),
      calls: floor.serviceCalls.filter((call) => tableIds.includes(call.tableId)).length,
      totalCents: tabs.reduce((sum, tab) => sum + tab.totalCents, 0),
      staffIds: floor.shiftSectionStaff
        .filter((row) => row.shiftSectionId === section.id)
        .map((row) => row.identityId),
    };
  });
  const staff = floor.staff
    .map((person) => {
      const tabs = floor.openTabs.filter((tab) => tab.responsibleIdentityId === person.identityId);
      return {
        ...person,
        sections: sections.filter((section) => section.staffIds.includes(person.identityId)).length,
        tabs: tabs.length,
        guests: tabs.reduce((sum, tab) => sum + tab.guestCount, 0),
        totalCents: tabs.reduce((sum, tab) => sum + tab.totalCents, 0),
      };
    })
    .filter((person) => person.sections > 0 || person.tabs > 0);
  return { sections, staff };
}

export interface PosOrder {
  id: string;
  originTableId: string | null;
  status: string;
  createdAt: string | null;
}

export interface PosItem {
  id: string;
  orderId: string;
  orderStatus: string | null;
  productName: string;
  quantity: number;
  grossCents: number;
  discountCents: number;
  netCents: number;
  status: string;
  seatNumber: number | null;
  course: "anytime" | "starter" | "main" | "dessert";
  allergyNote: string | null;
  notes: string | null;
}

export type PaymentFinancialStatus = "posted" | "reversed";

export interface TabPayment {
  id: string;
  method: "cash" | "credit_card" | "debit_card" | "pix" | "other";
  amountCents: number;
  reversedCents: number;
  netAmountCents: number;
  financialStatus: PaymentFinancialStatus;
  reference: string | null;
  createdAt: string;
}

export interface TabDetail {
  tab: PosTab;
  orders: PosOrder[];
  items: PosItem[];
  payments: TabPayment[];
  events: Array<{
    id: string;
    type: string;
    payload: Record<string, unknown>;
    actorIdentityId: string;
    actorName: string;
    createdAt: string;
  }>;
  presence: Array<{ identityId: string; displayName: string }>;
}

export type KdsTicketStatus = "pending" | "preparing" | "ready" | "done" | "canceled";

export type KdsItemState =
  | "pending"
  | "queued"
  | "held"
  | "fired"
  | "preparing"
  | "ready"
  | "done"
  | "canceled";

export interface KdsStation {
  id: string;
  name: string;
  code: string | null;
  capacity: KdsStationCapacity | null;
}

export interface KdsStationCapacity {
  status: "normal" | "strained" | "overloaded" | "paused" | "unknown";
  activeSlots: number | null;
  activeAssignments: number | null;
  blockedAssignments: number | null;
  queuedQuantity: number | null;
  preparingQuantity: number | null;
  sampleSize: number | null;
  p50PrepMinutes: number | null;
  p90PrepMinutes: number | null;
  estimatedUnitsPerHour: number | null;
  estimatedWaitMinutes: number | null;
  estimatedClearAt: string | null;
  updatedAt: string | null;
  recommendation: {
    state: "normal" | "strained" | "overloaded";
    suggestedDelayMinutes: number | null;
    reasons: Array<"queue_depth" | "blocked_items" | "slow_history" | "insufficient_history">;
  } | null;
}

export type KdsBlockCode =
  | "missing_ingredient"
  | "equipment_issue"
  | "quality_check"
  | "dependency"
  | "other";

export interface KdsItemBlock {
  active: boolean;
  code: KdsBlockCode | null;
  reason: string | null;
  blockedAt: string | null;
  blockedBy: string | null;
}

export interface KdsAttention {
  noteId: "allergy" | "notes";
  revision: string | null;
  text: string;
  required: boolean;
  acknowledgedAt: string | null;
  acknowledgedBy: string | null;
}

export interface KdsTicket {
  id: string;
  orderId: string;
  stationId: string;
  status: KdsTicketStatus;
  createdAt: string | null;
  updatedAt: string | null;
  dueAt: string | null;
  promisedAt: string | null;
  reference: string | null;
  tableLabel: string | null;
  tabLabel: string | null;
  customerName: string | null;
  channel: string | null;
  stationName: string | null;
  priority: number;
  rush: boolean;
  priorityReason: string | null;
  priorityUpdatedAt: string | null;
  priorityUpdatedByIdentityId: string | null;
  elapsedMinutes: number | null;
  slaMinutes: number | null;
  overdueMinutes: number | null;
  isOverdue: boolean;
  canceledAt: string | null;
  cancelReason: string | null;
  handedOffAt: string | null;
  servedAt: string | null;
  orderStatus: string | null;
  orderReadyNotifiedAt: string | null;
  claimedByInstallationId: string | null;
  claimedAt: string | null;
  claimExpiresAt: string | null;
  runnerIdentityId: string | null;
  runnerClaimedAt: string | null;
  runnerPickedUpAt: string | null;
  eta: {
    predictedReadyAt: string | null;
    remainingMinutes: number | null;
    confidence: "low" | "medium" | "high" | null;
    p50Minutes: number | null;
    p90Minutes: number | null;
    sampleSize: number | null;
    source: string | null;
  } | null;
}

export interface KdsItem extends PosItem {
  productId: string | null;
  kdsState: KdsItemState;
  modifiers: string[];
  readyQuantity: number;
  held: boolean;
  heldReason: string | null;
  heldAt: string | null;
  firedAt: string | null;
  startedAt: string | null;
  readyAt: string | null;
  completedAt: string | null;
  blocked: KdsItemBlock | null;
  attention: KdsAttention[];
  stage: number;
  dependencyHeld: boolean;
  recipe: Array<{
    id: string;
    ingredientName: string;
    quantityMilli: number;
    unit: string;
    lossBasisPoints: number;
  }>;
  changes: Array<{
    id: string;
    revision: string;
    kind: "added" | "updated" | "removed";
    summary: string;
    acknowledgedAt: string | null;
    createdAt: string | null;
  }>;
}

export interface KdsBatchAssignment {
  ticketId: string;
  orderItemId: string;
  quantity: number;
  reference: string | null;
  position: number | null;
}

export interface KdsBatch {
  id: string;
  stationId: string;
  productId: string | null;
  productName: string | null;
  status: "active" | "completed" | "canceled";
  maxAssignments: number | null;
  assignmentCount: number;
  totalQuantity: number;
  assignments: KdsBatchAssignment[];
  createdAt: string | null;
  completedAt: string | null;
  canceledAt: string | null;
  cancelReason: string | null;
}

export interface KdsAllDayItem {
  productId: string | null;
  productName: string;
  quantity: number;
  stationId: string | null;
  queuedQuantity: number;
  preparingQuantity: number;
  readyQuantity: number;
  heldQuantity: number;
}

export interface KdsProductAvailability {
  productId: string;
  productName: string;
  status: "available" | "limited" | "unavailable";
  available: boolean;
  dailyStock: number | null;
  soldToday: number | null;
  remainingQuantity: number | null;
  autoDeductStock: boolean | null;
  reason: string | null;
  updatedByIdentityId: string | null;
  updatedAt: string | null;
  resetAt: string | null;
}

export interface KdsTerminalProfile {
  installationId: string;
  mode: "station" | "pass";
  stationId: string | null;
  label: string;
  soundEnabled: boolean;
  fullscreenPreferred: boolean;
  createdAt: string | null;
  updatedAt: string | null;
  updatedByIdentityId: string | null;
}

export interface KdsMetrics {
  total: number | null;
  pending: number | null;
  preparing: number | null;
  ready: number | null;
  averagePrepMinutes: number | null;
  averageWaitMinutes: number | null;
  medianPrepMinutes: number | null;
  p90PrepMinutes: number | null;
  overdueCount: number | null;
  rushCount: number | null;
}

export interface KdsFreshness {
  status: "live" | "degraded" | "offline" | "stale" | "unknown";
  lastSyncedAt: string | null;
  pendingCount: number | null;
  message: string | null;
  projectionBlocked: boolean;
  leaseExpiresAt: string | null;
}

export interface KdsCapabilities {
  itemState: boolean;
  partialReady: boolean;
  courseFire: boolean;
  priority: boolean;
  orderPriority: boolean;
  recall: boolean;
  refire: boolean;
  handoff: boolean;
  availability: boolean;
  authorizedCancellation: boolean;
  block: boolean;
  attentionAcknowledgement: boolean;
  reroute: boolean;
  batches: boolean;
  analytics: boolean;
  capacity: boolean;
  recommendation: boolean;
  automaticThrottling: boolean;
  terminalProfileRead: boolean;
  terminalProfileManage: boolean;
  hardwarePrinting: boolean;
  bumpBar: boolean;
  offlineBlock: boolean;
  offlineAttentionAcknowledgement: boolean;
  offlineAvailability: boolean;
  offlineAvailabilityLifecycle: boolean;
  sequentialStages: boolean;
  ticketClaim: boolean;
  orderChanges: boolean;
  runnerHandoff: boolean;
  productionGrid: boolean;
  recipes: boolean;
  demandControl: boolean;
}

export interface KdsCancellationAlert {
  id: string;
  ticketId: string;
  orderId: string;
  reference: string | null;
  tableLabel: string | null;
  tabLabel: string | null;
  stationId: string | null;
  stationName: string | null;
  reason: string | null;
  canceledAt: string | null;
  items: Array<{ productName: string; quantity: number }>;
}

export interface KdsData {
  capturedAt: string | null;
  revision: string | null;
  operationServiceMode: ServiceMode | null;
  stations: KdsStation[];
  tickets: KdsTicket[];
  items: Array<{ ticketId: string; item: KdsItem }>;
  metrics: KdsMetrics;
  allDay: KdsAllDayItem[];
  productAvailability: KdsProductAvailability[];
  freshness: KdsFreshness;
  capabilities: KdsCapabilities;
  alerts: KdsCancellationAlert[];
  batches: KdsBatch[];
  productionGrid: Array<{
    stationId: string;
    productId: string;
    productName: string;
    totalQuantity: number;
    queuedQuantity: number;
    preparingQuantity: number;
    readyQuantity: number;
    heldQuantity: number;
    assignments: Array<{
      ticketId: string;
      orderItemId: string;
      reference: string;
      quantity: number;
      readyQuantity: number;
      status: KdsItemState;
      stage: number;
    }>;
  }>;
  demand: {
    state: "normal" | "strained" | "overloaded";
    suggestedDelayMinutes: number;
    automatic: false;
    channels: Array<{ channel: string; activeOrders: number; suggestedDelayMinutes: number }>;
  } | null;
}

export const nextKdsState: Record<
  KdsTicket["status"],
  "preparing" | "ready" | "done" | "canceled" | null
> = {
  pending: "preparing",
  preparing: "ready",
  ready: null,
  done: null,
  canceled: null,
};

export const kdsActionLabel: Partial<Record<KdsTicket["status"], string>> = {
  pending: "Iniciar preparo",
  preparing: "Marcar ticket pronto",
};

export class InvalidPilotPayloadError extends Error {
  constructor() {
    super("A API retornou dados operacionais em formato inesperado.");
    this.name = "InvalidPilotPayloadError";
  }
}

export function record(value: unknown): Row {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new InvalidPilotPayloadError();
  }
  return value as Row;
}

export function records(value: unknown): Row[] {
  if (!Array.isArray(value)) throw new InvalidPilotPayloadError();
  return value.map(record);
}

export function text(value: unknown): string {
  if (typeof value !== "string" || value.trim() === "") throw new InvalidPilotPayloadError();
  return value;
}

export function optionalText(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "string" && value.trim() === "") return null;
  return text(value);
}

export function number(value: unknown): number {
  const parsed =
    typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  if (!Number.isFinite(parsed)) throw new InvalidPilotPayloadError();
  return parsed;
}

function optionalNumber(value: unknown): number | null {
  return value === null || value === undefined ? null : number(value);
}

function optionalFloorPolygon(value: unknown): FloorPoint[] | null {
  if (value === null || value === undefined) return null;
  const points = records(value).map((point) => ({ x: number(point.x), y: number(point.y) }));
  if (
    points.length < 3 ||
    points.length > 16 ||
    points.some(
      (point) =>
        point.x < -1_000_000 || point.x > 1_000_000 || point.y < -1_000_000 || point.y > 1_000_000,
    )
  ) {
    throw new InvalidPilotPayloadError();
  }
  return points;
}

export function bool(value: unknown): boolean {
  if (typeof value !== "boolean") throw new InvalidPilotPayloadError();
  return value;
}

function parseServiceMode(value: unknown): ServiceMode {
  const mode = text(value ?? "hybrid");
  if (!["full_service", "quick_service", "bar", "hybrid"].includes(mode)) {
    throw new InvalidPilotPayloadError();
  }
  return mode as ServiceMode;
}

export function parseTab(row: Row): PosTab {
  const fulfillmentType = text(row.fulfillmentType ?? "dine_in");
  if (!["dine_in", "pickup", "delivery"].includes(fulfillmentType)) {
    throw new InvalidPilotPayloadError();
  }
  return {
    id: text(row.id),
    tableId: optionalText(row.tableId),
    openedAt: optionalText(row.openedAt ?? row.createdAt),
    createdAt: optionalText(row.createdAt ?? row.openedAt),
    operationalShiftId: optionalText(row.operationalShiftId),
    shiftSectionId: optionalText(row.shiftSectionId),
    label: optionalText(row.label),
    displayNumber: optionalNumber(row.displayNumber),
    fulfillmentType: fulfillmentType as PosTab["fulfillmentType"],
    customerName: optionalText(row.customerName),
    customerPhone: optionalText(row.customerPhone),
    readyNotificationConsent: row.readyNotificationConsent === true,
    serviceNotes: optionalText(row.serviceNotes),
    deliveryAddress: optionalText(row.deliveryAddress),
    promisedAt: optionalText(row.promisedAt),
    readyNotifiedAt: optionalText(row.readyNotifiedAt),
    responsibleIdentityId: optionalText(row.responsibleIdentityId),
    guestCount: number(row.guestCount),
    version: number(row.version ?? 1),
    status: text(row.status),
    serviceChargeBasisPoints: number(row.serviceChargeBasisPoints),
    tipCents: number(row.tipCents),
    subtotalCents: number(row.subtotalCents),
    discountCents: number(row.discountCents),
    serviceChargeCents: number(row.serviceChargeCents),
    totalCents: number(row.totalCents),
  };
}

export function parseItem(row: Row): PosItem {
  const course = text(row.course ?? "anytime");
  if (!["anytime", "starter", "main", "dessert"].includes(course)) {
    throw new InvalidPilotPayloadError();
  }
  return {
    id: text(row.id),
    orderId: text(row.orderId),
    orderStatus: optionalText(row.orderStatus),
    productName: text(row.productName),
    quantity: number(row.quantity),
    grossCents: number(row.grossCents),
    discountCents: number(row.discountCents),
    netCents: number(row.netCents),
    status: text(row.status),
    seatNumber: optionalNumber(row.seatNumber),
    course: course as PosItem["course"],
    allergyNote: optionalText(row.allergyNote),
    notes: optionalText(row.notes),
  };
}

export function parsePilotCatalog(value: unknown): PilotCatalog {
  const payload = record(value);
  const isActive = (row: Record<string, unknown>) => row.active == null || bool(row.active);
  const prices = new Map(records(payload.prices).map((row) => [text(row.productId), row]));
  const availability = new Map(
    records(payload.availability).map((row) => {
      const schedule = row.schedule == null ? null : record(row.schedule);
      return [
        text(row.productId),
        {
          available: bool(row.available),
          dailyStock: optionalNumber(row.dailyStock),
          soldToday: optionalNumber(row.soldToday) ?? 0,
          autoDeductStock: row.autoDeductStock == null ? false : bool(row.autoDeductStock),
          schedule: schedule
            ? {
                windows: records(schedule.windows).map((window) => ({
                  dayOfWeek: number(window.dayOfWeek),
                  start: text(window.start),
                  end: text(window.end),
                })),
              }
            : null,
        },
      ] as const;
    }),
  );
  const productStations = new Map<string, string[]>();
  const productStationRouting = new Map<string, Array<{ stationId: string; stage: number }>>();
  for (const row of records(payload.productStations ?? [])) {
    const pid = text(row.productId);
    if (!productStations.has(pid)) productStations.set(pid, []);
    const stationId = text(row.stationId);
    productStations.get(pid)?.push(stationId);
    if (!productStationRouting.has(pid)) productStationRouting.set(pid, []);
    productStationRouting.get(pid)?.push({ stationId, stage: optionalNumber(row.stage) ?? 1 });
  }
  const productAllergens = new Map<string, string[]>();
  for (const row of records(payload.productAllergens ?? [])) {
    const pid = text(row.productId);
    if (!productAllergens.has(pid)) productAllergens.set(pid, []);
    productAllergens.get(pid)?.push(text(row.allergenId));
  }
  const productModifierGroups = new Map<string, string[]>();
  for (const row of records(payload.productModifierGroups ?? [])) {
    const pid = text(row.productId);
    if (!productModifierGroups.has(pid)) productModifierGroups.set(pid, []);
    productModifierGroups.get(pid)?.push(text(row.groupId));
  }
  const productRecipes = new Map<string, CatalogProduct["recipe"]>();
  for (const row of records(payload.recipes ?? [])) {
    const productId = text(row.productId);
    if (!productRecipes.has(productId)) productRecipes.set(productId, []);
    productRecipes.get(productId)?.push({
      componentId: text(row.id),
      name: text(row.ingredientName),
      quantity: number(row.quantityMilli) / 1_000,
      unit: text(row.unit),
    });
  }
  const comboItems = new Map<string, CatalogCombo["items"]>();
  for (const row of records(payload.comboItems ?? [])) {
    const comboId = text(row.comboId);
    if (!comboItems.has(comboId)) comboItems.set(comboId, []);
    comboItems.get(comboId)?.push({
      productId: text(row.productId),
      quantity: number(row.quantity),
    });
  }
  const categoryUnitConfigs = new Map(
    records(payload.categoryUnitConfigs ?? []).map((row) => [text(row.categoryId), row]),
  );
  const branding = payload.branding == null ? null : record(payload.branding);

  return {
    categories: records(payload.categories)
      .filter((row) => bool(row.active))
      .sort(
        (left, right) =>
          (optionalNumber(left.sortOrder) ?? 0) - (optionalNumber(right.sortOrder) ?? 0),
      )
      .map((row) => ({
        id: text(row.id),
        name: text(row.name),
        description: optionalText(row.description),
        ...parseCategoryUnitConfig(categoryUnitConfigs.get(text(row.id))),
      })),
    stations: records(payload.stations ?? [])
      .filter(isActive)
      .map((row) => ({ id: text(row.id), name: text(row.name) })),
    allergens: records(payload.allergens ?? [])
      .filter(isActive)
      .map((row) => ({ id: text(row.id), code: text(row.code), name: text(row.name) })),
    groups: records(payload.modifierGroups ?? [])
      .filter(isActive)
      .map((row) => ({
        id: text(row.id),
        name: text(row.name),
        minimumSelections: number(row.minimumSelections),
        maximumSelections: number(row.maximumSelections),
      })),
    options: records(payload.modifierOptions ?? [])
      .filter(isActive)
      .map((row) => ({
        id: text(row.id),
        groupId: text(row.groupId),
        name: text(row.name),
        priceDeltaCents: number(row.priceDeltaCents),
        active: true,
      })),
    products: records(payload.products)
      .sort(
        (left, right) =>
          (optionalNumber(left.sortOrder) ?? 0) - (optionalNumber(right.sortOrder) ?? 0),
      )
      .map((row) => {
        const id = text(row.id);
        const unitAvailability = availability.get(id);
        const price = prices.get(id);
        const metadata = row.metadata == null ? {} : record(row.metadata);
        const fiscal = metadata.fiscal == null ? {} : record(metadata.fiscal);
        const translations = metadata.translations == null ? {} : record(metadata.translations);
        const spiciness = optionalNumber(metadata.spiciness);
        return {
          id,
          categoryId: text(row.categoryId),
          sku: row.sku != null ? text(row.sku) : null,
          eanBarcode: optionalText(row.ean),
          productType: row.productType === "resale" ? "resale" : "prepared",
          name: text(row.name),
          description: row.description != null ? text(row.description) : null,
          imageUrl: row.imageUrl != null ? text(row.imageUrl) : null,
          estimatedPrepTimeMinutes: optionalNumber(row.estimatedPrepTimeMinutes),
          stationIds: productStations.get(id) ?? [],
          stationRouting: productStationRouting.get(id) ?? [],
          priceCents: price ? number(price.priceCents) : 0,
          deliveryPriceCents: price ? optionalNumber(price.deliveryPriceCents) : null,
          costCents: price ? optionalNumber(price.costCents) : null,
          tags: values(metadata.tags).map((tag) => text(tag)) as CatalogProduct["tags"],
          suggestedProductIds: values(metadata.suggestedProductIds).map((item) => text(item)),
          dietaryTags: values(metadata.dietaryFlags).map((tag) => text(tag)) as DietaryTag[],
          spiciness:
            spiciness == null || spiciness <= 0
              ? "none"
              : spiciness >= 5
                ? "hot"
                : spiciness >= 3
                  ? "medium"
                  : "mild",
          pairingSuggestion: optionalText(metadata.pairing),
          sizes: values(metadata.sizes).map((value) => {
            const size = record(value);
            return {
              id: text(size.code),
              name: text(size.name),
              priceCents: number(size.priceCents),
            };
          }),
          translations: {
            en: parseProductTranslation(translations.en),
            es: parseProductTranslation(translations.es),
          },
          ncm: optionalText(fiscal.ncm),
          cfop: optionalText(fiscal.cfop),
          cest: optionalText(fiscal.cest),
          fiscalOrigin: optionalNumber(fiscal.origin),
          available: unitAvailability?.available ?? false,
          availabilitySchedule: unitAvailability?.schedule ?? null,
          dailyStockLimit: unitAvailability?.dailyStock ?? null,
          dailyStockRemaining:
            unitAvailability?.dailyStock == null
              ? null
              : Math.max(0, unitAvailability.dailyStock - unitAvailability.soldToday),
          currentStockUnits:
            unitAvailability?.dailyStock == null
              ? null
              : Math.max(0, unitAvailability.dailyStock - unitAvailability.soldToday),
          autoDeductStock: unitAvailability?.autoDeductStock ?? false,
          active: bool(row.active),
          allergenIds: productAllergens.get(id) ?? [],
          modifierGroupIds: productModifierGroups.get(id) ?? [],
          recipe: productRecipes.get(id) ?? [],
        };
      }),
    combos: payload.combos
      ? records(payload.combos)
          .filter(isActive)
          .map((item) => {
            return {
              id: text(item.id),
              name: text(item.name),
              description: item.description != null ? text(item.description) : null,
              priceCents: number(item.priceCents),
              active: bool(item.active),
              items: comboItems.get(text(item.id)) ?? [],
            };
          })
      : [],
    promotions: records(payload.promotions ?? []).map(parseCatalogPromotion),
    branding: branding
      ? {
          restaurantName: text(branding.displayName),
          slogan: optionalText(branding.slogan),
          brandColor: text(branding.primaryColor),
          headerBannerUrl: optionalText(branding.logoUrl),
          address: optionalText(branding.address),
          phone: optionalText(branding.phone),
          instagram: optionalText(branding.instagram),
          openingHours: optionalText(branding.openingHours),
          serviceTaxNotice:
            optionalText(branding.serviceTaxNotice) ?? optionalText(branding.notice),
          wifiNotice: parseBrandingWifi(branding.wifi),
          corkageFeeNotice: optionalText(branding.corkageFeeNotice),
        }
      : undefined,
  };
}

function parseCategoryUnitConfig(row: Record<string, unknown> | undefined) {
  if (!row) return {};
  const channels = values(row.channels).map((channel) => text(channel));
  const schedule = row.schedule == null ? null : record(row.schedule);
  const firstWindow = schedule ? records(schedule.windows)[0] : undefined;
  return {
    channels: {
      salon: channels.includes("salon"),
      qrMesa: channels.includes("qr"),
      delivery: channels.includes("delivery"),
    },
    schedule: firstWindow
      ? { startTime: text(firstWindow.start), endTime: text(firstWindow.end) }
      : null,
    defaultStationId: optionalText(row.defaultStationId),
  };
}

function parseProductTranslation(value: unknown) {
  if (value == null) return undefined;
  const translation = record(value);
  const name = optionalText(translation.name);
  if (!name) return undefined;
  return { name, description: optionalText(translation.description) ?? undefined };
}

function parseCatalogPromotion(value: Record<string, unknown>): CatalogPromotionRule {
  const channels = values(value.channels).map((channel) => text(channel));
  const discountType = text(value.discountType) === "percentage" ? "percentage" : "fixed_price";
  const storedValue = number(value.discountValue);
  return {
    id: text(value.id),
    name: text(value.name),
    discountType,
    discountValue: discountType === "percentage" ? storedValue / 100 : storedValue,
    daysOfWeek: values(value.daysOfWeek).map((day) => number(day)),
    startTime: optionalText(value.startTime) ?? "00:00",
    endTime: optionalText(value.endTime) ?? "23:59",
    categoryIds: values(value.categoryIds).map((id) => text(id)),
    productIds: values(value.productIds).map((id) => text(id)),
    channels: {
      salon: channels.includes("salon"),
      qrMesa: channels.includes("qr"),
      delivery: channels.includes("delivery"),
    },
    active: bool(value.active),
  };
}

function parseBrandingWifi(value: unknown) {
  if (value == null) return null;
  const wifi = record(value);
  const ssid = optionalText(wifi.ssid);
  if (!ssid) return null;
  const password = optionalText(wifi.password);
  return `Wi-Fi: ${ssid}${password ? ` | Senha: ${password}` : ""}`;
}

function values(value: unknown): unknown[] {
  if (value === null || value === undefined) return [];
  if (!Array.isArray(value)) throw new InvalidPilotPayloadError();
  return value;
}

export function parsePilotFloor(value: unknown): PilotFloor {
  const payload = record(value);
  const activeShift = payload.activeShift == null ? null : record(payload.activeShift);
  return {
    rooms: records(payload.rooms).map((row) => ({
      id: text(row.id),
      name: text(row.name),
      active: bool(row.active),
      layoutPolygon: optionalFloorPolygon(row.layoutPolygon),
    })),
    tables: records(payload.tables).map((row) => {
      const status = text(row.status);
      if (!["available", "occupied", "reserved", "needs_cleaning", "cleaning"].includes(status)) {
        throw new InvalidPilotPayloadError();
      }
      return {
        id: text(row.id),
        roomId: text(row.roomId),
        label: text(row.label),
        seats: number(row.seats),
        status: status as FloorTable["status"],
        layoutX: optionalNumber(row.layoutX),
        layoutY: optionalNumber(row.layoutY),
        active: bool(row.active),
      };
    }),
    openTabs: records(payload.openTabs).map(parseTab),
    tableGroups: records(payload.tableGroups ?? []).map((row) => {
      const mode = text(row.mode);
      if (mode !== "physical_only" && mode !== "single_tab") {
        throw new InvalidPilotPayloadError();
      }
      return {
        id: text(row.id),
        anchorTableId: text(row.anchorTableId),
        primaryTabId: optionalText(row.primaryTabId),
        mode: mode as "physical_only" | "single_tab",
        responsibleIdentityId: optionalText(row.responsibleIdentityId),
      };
    }),
    tableGroupMembers: records(payload.tableGroupMembers ?? []).map((row) => ({
      groupId: text(row.groupId),
      tableId: text(row.tableId),
    })),
    serviceCalls: records(payload.serviceCalls ?? []).map((row) => {
      const kind = text(row.kind);
      const status = text(row.status);
      if (
        !["assistance", "bill", "water", "other"].includes(kind) ||
        !["open", "acknowledged"].includes(status)
      ) {
        throw new InvalidPilotPayloadError();
      }
      return {
        id: text(row.id),
        tableId: text(row.tableId),
        tabId: optionalText(row.tabId),
        kind: kind as PilotFloor["serviceCalls"][number]["kind"],
        status: status as PilotFloor["serviceCalls"][number]["status"],
        slaMinutes: number(row.slaMinutes),
        acknowledgedByIdentityId: optionalText(row.acknowledgedByIdentityId),
        acknowledgedAt: optionalText(row.acknowledgedAt),
        createdAt: text(row.createdAt),
      };
    }),
    tablePhases: records(payload.tablePhases ?? []).map((row) => {
      const phase = text(row.phase);
      if (!["awaiting_order", "production", "ready", "served"].includes(phase)) {
        throw new InvalidPilotPayloadError();
      }
      return {
        tableId: text(row.tableId),
        tabId: text(row.tabId),
        phase: phase as PilotFloor["tablePhases"][number]["phase"],
        since: text(row.since),
      };
    }),
    staff: records(payload.staff ?? []).map((row) => ({
      identityId: text(row.identityId),
      displayName: text(row.displayName),
    })),
    serviceMode: parseServiceMode(payload.serviceMode),
    serviceSections: records(payload.serviceSections ?? []).map((row) => ({
      id: text(row.id),
      name: text(row.name),
      color: text(row.color),
      serviceMode: parseServiceMode(row.serviceMode),
      defaultResponsibleIdentityId: optionalText(row.defaultResponsibleIdentityId),
    })),
    serviceSectionTables: records(payload.serviceSectionTables ?? []).map((row) => ({
      sectionId: text(row.sectionId),
      tableId: text(row.tableId),
    })),
    activeShift: activeShift
      ? {
          id: text(activeShift.id),
          label: text(activeShift.label),
          serviceMode: parseServiceMode(activeShift.serviceMode),
          startsAt: text(activeShift.startsAt),
        }
      : null,
    shiftSections: records(payload.shiftSections ?? []).map((row) => ({
      id: text(row.id),
      shiftId: text(row.shiftId),
      sectionTemplateId: optionalText(row.sectionTemplateId),
      name: text(row.name),
      color: text(row.color),
      serviceMode: parseServiceMode(row.serviceMode),
    })),
    shiftSectionTables: records(payload.shiftSectionTables ?? []).map((row) => ({
      shiftId: text(row.shiftId),
      shiftSectionId: text(row.shiftSectionId),
      tableId: text(row.tableId),
    })),
    shiftSectionStaff: records(payload.shiftSectionStaff ?? []).map((row) => {
      const role = text(row.role);
      if (role !== "primary" && role !== "support") throw new InvalidPilotPayloadError();
      return {
        shiftId: text(row.shiftId),
        shiftSectionId: text(row.shiftSectionId),
        identityId: text(row.identityId),
        role,
      };
    }),
    shiftTableLayouts: records(payload.shiftTableLayouts ?? []).map((row) => ({
      shiftId: text(row.shiftId),
      tableId: text(row.tableId),
      roomId: text(row.roomId),
      x: number(row.x),
      y: number(row.y),
    })),
    shiftTableTransfers: records(payload.shiftTableTransfers ?? []).map((row) => ({
      id: text(row.id),
      shiftId: text(row.shiftId),
      tableId: text(row.tableId),
      sourceShiftSectionId: text(row.sourceShiftSectionId),
      targetShiftSectionId: text(row.targetShiftSectionId),
      expiresAt: text(row.expiresAt),
      reason: text(row.reason),
      transferredByIdentityId: text(row.transferredByIdentityId),
    })),
  };
}

export function parseTabs(value: unknown): PosTab[] {
  return records(value).map(parseTab);
}

function paymentCents(value: unknown): number {
  const parsed = number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0) throw new InvalidPilotPayloadError();
  return parsed;
}

function parseTabPayment(row: Row): TabPayment {
  const method = text(row.method);
  if (!["cash", "credit_card", "debit_card", "pix", "other"].includes(method)) {
    throw new InvalidPilotPayloadError();
  }
  const amountCents = paymentCents(row.amountCents);
  const providedNetAmountCents =
    row.netAmountCents === undefined ? undefined : paymentCents(row.netAmountCents);
  const reversedCents =
    row.reversedCents === undefined
      ? providedNetAmountCents === undefined
        ? 0
        : amountCents - providedNetAmountCents
      : paymentCents(row.reversedCents);
  const netAmountCents = providedNetAmountCents ?? amountCents - reversedCents;
  const expectedFinancialStatus: PaymentFinancialStatus = reversedCents > 0 ? "reversed" : "posted";
  const financialStatus = text(row.financialStatus ?? expectedFinancialStatus);
  if (
    reversedCents > amountCents ||
    netAmountCents !== amountCents - reversedCents ||
    financialStatus !== expectedFinancialStatus
  ) {
    throw new InvalidPilotPayloadError();
  }
  return {
    id: text(row.id),
    method: method as TabPayment["method"],
    amountCents,
    reversedCents,
    netAmountCents,
    financialStatus,
    reference: optionalText(row.reference),
    createdAt: text(row.createdAt),
  };
}

export function summarizeTabPayments(payments: TabPayment[]) {
  return payments.reduce(
    (summary, payment) => ({
      grossPaidCents: summary.grossPaidCents + payment.amountCents,
      reversedCents: summary.reversedCents + payment.reversedCents,
      paidCents: summary.paidCents + payment.netAmountCents,
    }),
    { grossPaidCents: 0, reversedCents: 0, paidCents: 0 },
  );
}

export function parseTabDetail(value: unknown): TabDetail {
  const payload = record(value);
  return {
    tab: parseTab(record(payload.tab)),
    orders: records(payload.orders).map((row) => ({
      id: text(row.id),
      originTableId: optionalText(row.originTableId),
      status: text(row.status),
      createdAt: optionalText(row.createdAt),
    })),
    items: records(payload.items).map(parseItem),
    payments: records(payload.payments ?? []).map(parseTabPayment),
    events: records(payload.events ?? []).map((row) => ({
      id: text(row.id),
      type: text(row.type),
      payload: record(row.payload),
      actorIdentityId: text(row.actorIdentityId),
      actorName: text(row.actorName),
      createdAt: text(row.createdAt),
    })),
    presence: records(payload.presence ?? []).map((row) => ({
      identityId: text(row.identityId),
      displayName: text(row.displayName),
    })),
  };
}

const kdsItemStates: KdsItemState[] = [
  "pending",
  "queued",
  "held",
  "fired",
  "preparing",
  "ready",
  "done",
  "canceled",
];

function parseOptionalKdsBoolean(value: unknown, fallback = false): boolean {
  return value === null || value === undefined ? fallback : bool(value);
}

function parseKdsPriority(row: Row): number {
  if (row.priority === "rush" || row.rush === true) return 100;
  if (row.priority === "normal" || row.priority === null || row.priority === undefined) return 0;
  const priority = number(row.priority);
  if (priority < 0 || priority > 100) throw new InvalidPilotPayloadError();
  return priority;
}

function parseKdsItemState(item: Row, production: Row | null): KdsItemState {
  const explicit = optionalText(production?.status ?? item.kdsState ?? item.productionState);
  const fallback = optionalText(item.status);
  const rawState = explicit ?? fallback ?? "queued";
  const state = rawState === "served" ? "done" : rawState === "draft" ? "queued" : rawState;
  if (!kdsItemStates.includes(state as KdsItemState)) throw new InvalidPilotPayloadError();
  return state as KdsItemState;
}

function parseKdsModifiers(value: unknown): string[] {
  if (value === null || value === undefined) return [];
  if (!Array.isArray(value)) throw new InvalidPilotPayloadError();
  return value.map((entry) => {
    if (typeof entry === "string") return text(entry);
    const modifier = record(entry);
    const name = text(modifier.name ?? modifier.label);
    const quantity = optionalNumber(modifier.quantity);
    return quantity && quantity > 1 ? `${quantity}× ${name}` : name;
  });
}

function parseKdsServiceMode(value: unknown): ServiceMode | null {
  if (value === null || value === undefined) return null;
  const mode = text(value);
  if (!["full_service", "quick_service", "bar", "hybrid"].includes(mode)) {
    throw new InvalidPilotPayloadError();
  }
  return mode as ServiceMode;
}

function parseKdsRevision(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "string" || typeof value === "number") return String(value);
  throw new InvalidPilotPayloadError();
}

const kdsBlockCodes: KdsBlockCode[] = [
  "missing_ingredient",
  "equipment_issue",
  "quality_check",
  "dependency",
  "other",
];

function parseKdsBlock(value: unknown, fallback: Row): KdsItemBlock | null {
  if (value === null || value === undefined || value === false) return null;
  const block = value === true ? fallback : record(value);
  const active = parseOptionalKdsBoolean(block.active, true);
  if (!active) return null;
  const rawCode = optionalText(block.code ?? block.blockCode);
  const code =
    rawCode && kdsBlockCodes.includes(rawCode as KdsBlockCode)
      ? (rawCode as KdsBlockCode)
      : rawCode
        ? "other"
        : null;
  const actor = block.blockedBy;
  const blockedBy =
    typeof actor === "string"
      ? actor
      : actor && typeof actor === "object" && !Array.isArray(actor)
        ? optionalText(record(actor).name ?? record(actor).displayName ?? record(actor).id)
        : optionalText(block.blockedByName);
  return {
    active,
    code,
    reason: optionalText(block.reason ?? block.blockedReason),
    blockedAt: optionalText(block.blockedAt),
    blockedBy,
  };
}

function parseKdsAttention(value: unknown): KdsAttention[] {
  if (value === null || value === undefined) return [];
  return records(value).map((entry) => {
    const rawNoteId = text(entry.noteId ?? entry.kind ?? entry.type ?? entry.id);
    const noteId =
      rawNoteId === "allergy" || rawNoteId === "allergy_note"
        ? "allergy"
        : rawNoteId === "notes" || rawNoteId === "note" || rawNoteId === "observation"
          ? "notes"
          : null;
    if (!noteId) throw new InvalidPilotPayloadError();
    const acknowledgedBy = entry.acknowledgedBy;
    return {
      noteId,
      revision: parseKdsRevision(entry.revision ?? entry.sha256),
      text: text(entry.text ?? entry.message ?? entry.value),
      required: parseOptionalKdsBoolean(entry.required, true),
      acknowledgedAt: optionalText(entry.acknowledgedAt),
      acknowledgedBy:
        typeof acknowledgedBy === "string"
          ? acknowledgedBy
          : acknowledgedBy && typeof acknowledgedBy === "object" && !Array.isArray(acknowledgedBy)
            ? optionalText(
                record(acknowledgedBy).name ??
                  record(acknowledgedBy).displayName ??
                  record(acknowledgedBy).id,
              )
            : null,
    } satisfies KdsAttention;
  });
}

function parseKdsCapacity(value: unknown): KdsStationCapacity | null {
  if (value === null || value === undefined) return null;
  const capacity = record(value);
  const rawStatus = optionalText(capacity.status) ?? "unknown";
  const status = ["normal", "strained", "overloaded", "paused", "unknown"].includes(rawStatus)
    ? (rawStatus as KdsStationCapacity["status"])
    : "unknown";
  const recommendationRow =
    capacity.recommendation === null || capacity.recommendation === undefined
      ? null
      : record(capacity.recommendation);
  const recommendationState = optionalText(recommendationRow?.state);
  const recommendationReasons =
    recommendationRow && Array.isArray(recommendationRow.reasons)
      ? recommendationRow.reasons.map((reason) => text(reason))
      : [];
  const acceptedRecommendationReasons = [
    "queue_depth",
    "blocked_items",
    "slow_history",
    "insufficient_history",
  ] as const;
  return {
    status,
    activeSlots: optionalNumber(capacity.activeSlots),
    activeAssignments: optionalNumber(capacity.activeAssignments),
    blockedAssignments: optionalNumber(capacity.blockedAssignments),
    queuedQuantity: optionalNumber(
      capacity.queuedQuantity ?? capacity.queuedUnits ?? capacity.queued,
    ),
    preparingQuantity: optionalNumber(
      capacity.preparingQuantity ?? capacity.preparingUnits ?? capacity.preparing,
    ),
    sampleSize: optionalNumber(capacity.sampleSize),
    p50PrepMinutes: optionalNumber(capacity.p50PrepMinutes),
    p90PrepMinutes: optionalNumber(capacity.p90PrepMinutes),
    estimatedUnitsPerHour: optionalNumber(capacity.estimatedUnitsPerHour),
    estimatedWaitMinutes: optionalNumber(capacity.estimatedWaitMinutes ?? capacity.waitMinutes),
    estimatedClearAt: optionalText(capacity.estimatedClearAt),
    updatedAt: optionalText(capacity.updatedAt),
    recommendation:
      recommendationRow &&
      recommendationState &&
      ["normal", "strained", "overloaded"].includes(recommendationState)
        ? {
            state: recommendationState as NonNullable<
              KdsStationCapacity["recommendation"]
            >["state"],
            suggestedDelayMinutes: optionalNumber(recommendationRow.suggestedDelayMinutes),
            reasons: recommendationReasons.filter(
              (
                reason,
              ): reason is NonNullable<KdsStationCapacity["recommendation"]>["reasons"][number] =>
                acceptedRecommendationReasons.includes(
                  reason as (typeof acceptedRecommendationReasons)[number],
                ),
            ),
          }
        : null,
  };
}

export function parseKdsProductAvailability(value: unknown): KdsProductAvailability[] {
  const payload = record(value);
  return records(payload.productAvailability ?? payload.products ?? []).map((row) => {
    const rawStatus = optionalText(row.status);
    const available = parseOptionalKdsBoolean(row.available, rawStatus !== "unavailable");
    const remainingQuantity = optionalNumber(row.remainingQuantity);
    const status =
      rawStatus && ["available", "limited", "unavailable"].includes(rawStatus)
        ? (rawStatus as KdsProductAvailability["status"])
        : !available
          ? "unavailable"
          : remainingQuantity !== null
            ? "limited"
            : "available";
    return {
      productId: text(row.productId ?? row.id),
      productName: text(row.productName ?? row.name),
      status,
      available,
      dailyStock: optionalNumber(row.dailyStock),
      soldToday: optionalNumber(row.soldToday),
      remainingQuantity,
      autoDeductStock:
        row.autoDeductStock === null || row.autoDeductStock === undefined
          ? null
          : bool(row.autoDeductStock),
      reason: optionalText(row.reason),
      updatedByIdentityId: optionalText(row.updatedByIdentityId),
      updatedAt: optionalText(row.updatedAt),
      resetAt: optionalText(row.resetAt),
    } satisfies KdsProductAvailability;
  });
}

export function parseKdsTerminalProfile(value: unknown): KdsTerminalProfile {
  const row = record(value);
  const mode = text(row.mode);
  if (mode !== "station" && mode !== "pass") throw new InvalidPilotPayloadError();
  return {
    installationId: text(row.installationId),
    mode,
    stationId: optionalText(row.stationId),
    label: text(row.label),
    soundEnabled: bool(row.soundEnabled),
    fullscreenPreferred: bool(row.fullscreenPreferred),
    createdAt: optionalText(row.createdAt),
    updatedAt: optionalText(row.updatedAt),
    updatedByIdentityId: optionalText(row.updatedByIdentityId),
  };
}

export function parseKds(value: unknown): KdsData {
  const payload = record(value);
  const rawTickets = records(payload.tickets ?? []);
  const tickets = rawTickets.map((row) => {
    const status = text(row.status);
    if (!["pending", "preparing", "ready", "done", "canceled"].includes(status)) {
      throw new InvalidPilotPayloadError();
    }
    const station = row.station == null ? null : record(row.station);
    const order = row.order == null ? null : record(row.order);
    const tab = row.tab == null ? null : record(row.tab);
    const table = row.table == null ? null : record(row.table);
    const sla = row.sla == null ? null : record(row.sla);
    const eta = row.eta == null ? null : record(row.eta);
    const priority = parseKdsPriority({
      ...row,
      priority: order?.priority ?? row.priority,
      rush: order?.rush ?? row.rush,
    });
    const overdueMinutes = optionalNumber(sla?.overdueMinutes ?? row.overdueMinutes);
    return {
      id: text(row.id),
      orderId: text(row.orderId ?? order?.id),
      orderStatus: optionalText(row.orderStatus ?? order?.status),
      stationId: text(row.stationId ?? station?.id),
      status: status as KdsTicket["status"],
      createdAt: optionalText(row.createdAt),
      updatedAt: optionalText(row.updatedAt),
      dueAt: optionalText(row.dueAt),
      promisedAt: optionalText(row.promisedAt ?? tab?.promisedAt),
      reference:
        optionalText(
          row.reference ?? row.orderReference ?? row.displayReference ?? order?.displayReference,
        ) ??
        (order?.displayNumber === null || order?.displayNumber === undefined
          ? null
          : String(number(order.displayNumber))),
      tableLabel: optionalText(row.tableLabel ?? table?.label),
      tabLabel: optionalText(row.tabLabel ?? tab?.label),
      customerName: optionalText(row.customerName ?? tab?.customerName),
      channel: optionalText(row.channel ?? row.fulfillmentType ?? tab?.fulfillmentType),
      stationName: optionalText(row.stationName ?? station?.name),
      priority,
      rush: parseOptionalKdsBoolean(order?.rush ?? row.rush, priority >= 50),
      priorityReason: optionalText(order?.priorityReason ?? order?.reason ?? row.priorityReason),
      priorityUpdatedAt: optionalText(order?.priorityUpdatedAt ?? order?.updatedAt),
      priorityUpdatedByIdentityId: optionalText(
        order?.priorityUpdatedByIdentityId ?? order?.updatedByIdentityId,
      ),
      elapsedMinutes: optionalNumber(sla?.elapsedMinutes ?? row.elapsedMinutes),
      slaMinutes: optionalNumber(sla?.targetMinutes ?? row.slaMinutes),
      overdueMinutes,
      isOverdue: parseOptionalKdsBoolean(
        sla?.isOverdue ?? row.isOverdue,
        overdueMinutes !== null && overdueMinutes > 0,
      ),
      canceledAt: optionalText(row.canceledAt),
      cancelReason: optionalText(row.cancelReason),
      handedOffAt: optionalText(row.handedOffAt),
      servedAt: optionalText(row.servedAt),
      orderReadyNotifiedAt: optionalText(
        row.orderReadyNotifiedAt ?? order?.readyNotifiedAt ?? tab?.readyNotifiedAt,
      ),
      claimedByInstallationId: optionalText(row.claimedByInstallationId),
      claimedAt: optionalText(row.claimedAt),
      claimExpiresAt: optionalText(row.claimExpiresAt),
      runnerIdentityId: optionalText(order?.runnerIdentityId ?? row.runnerIdentityId),
      runnerClaimedAt: optionalText(order?.runnerClaimedAt ?? row.runnerClaimedAt),
      runnerPickedUpAt: optionalText(order?.runnerPickedUpAt ?? row.runnerPickedUpAt),
      eta:
        eta === null
          ? null
          : {
              predictedReadyAt: optionalText(eta.predictedReadyAt ?? eta.estimatedReadyAt),
              remainingMinutes: optionalNumber(eta.remainingMinutes),
              confidence: ["low", "medium", "high"].includes(optionalText(eta.confidence) ?? "")
                ? (optionalText(eta.confidence) as "low" | "medium" | "high")
                : null,
              p50Minutes: optionalNumber(eta.p50Minutes),
              p90Minutes: optionalNumber(eta.p90Minutes),
              sampleSize: optionalNumber(eta.sampleSize),
              source: optionalText(eta.source),
            },
    };
  });

  const rawItems = records(payload.items ?? []);
  const items = rawItems.map((row) => {
    const itemRow = record(row.item ?? row);
    const item = parseItem(itemRow);
    const production =
      row.kds == null ? (itemRow.kds == null ? null : record(itemRow.kds)) : record(row.kds);
    const held = parseOptionalKdsBoolean(production?.held ?? itemRow.held);
    const kdsState = held ? "held" : parseKdsItemState(itemRow, production);
    return {
      ticketId: text(row.ticketId ?? itemRow.ticketId),
      item: {
        ...item,
        productId: optionalText(row.productId ?? itemRow.productId),
        quantity: optionalNumber(production?.quantity) ?? item.quantity,
        kdsState,
        modifiers: parseKdsModifiers(row.modifiers ?? itemRow.modifiers),
        readyQuantity: optionalNumber(production?.readyQuantity) ?? 0,
        held,
        heldReason: optionalText(production?.heldReason ?? itemRow.heldReason),
        heldAt: optionalText(production?.heldAt ?? itemRow.heldAt),
        firedAt: optionalText(production?.firedAt ?? itemRow.firedAt),
        startedAt: optionalText(production?.startedAt ?? itemRow.startedAt),
        readyAt: optionalText(production?.readyAt ?? itemRow.readyAt),
        completedAt: optionalText(production?.completedAt ?? itemRow.completedAt),
        blocked: parseKdsBlock(production?.blocked ?? itemRow.blocked, production ?? itemRow),
        attention: parseKdsAttention(production?.attention ?? row.attention ?? itemRow.attention),
        stage: optionalNumber(production?.stage ?? itemRow.stage) ?? 1,
        dependencyHeld: parseOptionalKdsBoolean(
          production?.dependencyHeld ?? itemRow.dependencyHeld,
        ),
        recipe: records(row.recipe ?? itemRow.recipe ?? []).map((component) => ({
          id: text(component.id),
          ingredientName: text(component.ingredientName ?? component.name),
          quantityMilli: number(component.quantityMilli),
          unit: text(component.unit),
          lossBasisPoints: optionalNumber(component.lossBasisPoints) ?? 0,
        })),
        changes: records(row.changes ?? itemRow.changes ?? []).map((change) => {
          const kind = text(change.kind);
          if (!(["added", "updated", "removed"] as const).includes(kind as "added")) {
            throw new InvalidPilotPayloadError();
          }
          return {
            id: text(change.id),
            revision: text(change.revision),
            kind: kind as "added" | "updated" | "removed",
            summary: text(change.summary),
            acknowledgedAt: optionalText(change.acknowledgedAt),
            createdAt: optionalText(change.createdAt),
          };
        }),
      },
    };
  });

  const stationRows = records(payload.stations ?? []);
  const stationMap = new Map<string, KdsStation>();
  for (const station of stationRows) {
    const id = text(station.id);
    stationMap.set(id, {
      id,
      name: text(station.name),
      code: optionalText(station.code),
      capacity: parseKdsCapacity(station.capacity),
    });
  }
  for (const ticket of tickets) {
    if (!stationMap.has(ticket.stationId)) {
      stationMap.set(ticket.stationId, {
        id: ticket.stationId,
        name: ticket.stationName ?? `Estação ${ticket.stationId.slice(0, 6)}`,
        code: null,
        capacity: null,
      });
    }
    ticket.stationName ??= stationMap.get(ticket.stationId)?.name ?? null;
  }

  const metricsRow = payload.metrics == null ? null : record(payload.metrics);
  const allDay = records(payload.allDay ?? []).map((row) => ({
    productId: optionalText(row.productId),
    productName: text(row.productName ?? row.name),
    quantity: number(row.totalQuantity ?? row.quantity),
    stationId: optionalText(row.stationId),
    queuedQuantity: optionalNumber(row.queuedQuantity) ?? 0,
    preparingQuantity: optionalNumber(row.preparingQuantity) ?? 0,
    readyQuantity: optionalNumber(row.readyQuantity) ?? 0,
    heldQuantity: optionalNumber(row.heldQuantity) ?? 0,
  }));
  const productAvailability = parseKdsProductAvailability({
    productAvailability: payload.productAvailability ?? [],
  });
  const batches = records(payload.batches ?? payload.productionBatches ?? []).map((row) => {
    const rawStatus = text(row.status ?? row.state);
    const status =
      rawStatus === "open" || rawStatus === "preparing"
        ? "active"
        : rawStatus === "ready" || rawStatus === "done"
          ? "completed"
          : rawStatus === "cancelled"
            ? "canceled"
            : rawStatus;
    if (!(["active", "completed", "canceled"] as const).includes(status as KdsBatch["status"])) {
      throw new InvalidPilotPayloadError();
    }
    const assignments = records(row.assignments ?? row.items ?? []).map((assignment) => ({
      ticketId: text(assignment.ticketId),
      orderItemId: text(assignment.orderItemId ?? assignment.itemId),
      quantity: optionalNumber(assignment.quantity) ?? 1,
      reference: optionalText(assignment.reference ?? assignment.orderReference),
      position: optionalNumber(assignment.position),
    }));
    return {
      id: text(row.batchId ?? row.id),
      stationId: text(row.stationId),
      productId: optionalText(row.productId),
      productName: optionalText(row.productName),
      status: status as KdsBatch["status"],
      maxAssignments: optionalNumber(row.maxAssignments),
      assignmentCount: optionalNumber(row.assignmentCount) ?? assignments.length,
      totalQuantity:
        optionalNumber(row.totalQuantity) ??
        assignments.reduce((sum, assignment) => sum + assignment.quantity, 0),
      assignments,
      createdAt: optionalText(row.createdAt),
      completedAt: optionalText(row.completedAt),
      canceledAt: optionalText(row.canceledAt ?? row.cancelledAt),
      cancelReason: optionalText(row.cancelReason),
    } satisfies KdsBatch;
  });
  const capturedAt = optionalText(payload.capturedAt ?? payload.serverTime);
  const freshnessRow = payload.freshness == null ? null : record(payload.freshness);
  const syncRow = payload.sync == null ? null : record(payload.sync);
  const rawFreshnessStatus =
    optionalText(
      freshnessRow?.status ?? freshnessRow?.state ?? syncRow?.status ?? syncRow?.state,
    ) ?? "unknown";
  const freshnessStatus =
    rawFreshnessStatus === "online" || rawFreshnessStatus === "ok" || rawFreshnessStatus === "fresh"
      ? "live"
      : rawFreshnessStatus === "blocked"
        ? "degraded"
        : rawFreshnessStatus;
  if (!["live", "degraded", "offline", "stale", "unknown"].includes(freshnessStatus)) {
    throw new InvalidPilotPayloadError();
  }
  const extendedContract =
    rawTickets.some((row) => row.station != null || row.sla != null) ||
    rawItems.some((row) => row.kds != null);
  const capabilityRow = payload.capabilities == null ? null : record(payload.capabilities);
  const offlineRow =
    capabilityRow?.offline &&
    typeof capabilityRow.offline === "object" &&
    !Array.isArray(capabilityRow.offline)
      ? record(capabilityRow.offline)
      : null;
  const offlineActions = new Set(
    Array.isArray(capabilityRow?.offlineActions)
      ? capabilityRow.offlineActions.filter((value): value is string => typeof value === "string")
      : [],
  );
  const capability = (
    name: keyof KdsCapabilities,
    aliases: string[] = [],
    legacyFallback = extendedContract,
  ) => {
    const value =
      capabilityRow?.[name] ??
      aliases.map((alias) => capabilityRow?.[alias]).find((item) => item != null);
    if (value != null) return bool(value);
    return capabilityRow === null ? legacyFallback : false;
  };
  const alerts = records(payload.alerts ?? []).map((row) => {
    const ticket = row.ticket == null ? row : record(row.ticket);
    const order = ticket.order == null ? null : record(ticket.order);
    const tab = ticket.tab == null ? null : record(ticket.tab);
    const table = ticket.table == null ? null : record(ticket.table);
    const station = ticket.station == null ? null : record(ticket.station);
    const ticketId = text(row.ticketId ?? ticket.id);
    const orderId = text(row.orderId ?? ticket.orderId ?? order?.id ?? ticketId);
    const canceledAt = optionalText(row.canceledAt ?? ticket.canceledAt);
    return {
      id: optionalText(row.id) ?? `cancel:${ticketId}:${canceledAt ?? "active"}`,
      ticketId,
      orderId,
      reference:
        optionalText(
          row.reference ?? ticket.reference ?? ticket.displayReference ?? order?.displayReference,
        ) ??
        (order?.displayNumber === null || order?.displayNumber === undefined
          ? null
          : String(number(order.displayNumber))),
      tableLabel: optionalText(row.tableLabel ?? ticket.tableLabel ?? table?.label),
      tabLabel: optionalText(row.tabLabel ?? ticket.tabLabel ?? tab?.label),
      stationId: optionalText(row.stationId ?? ticket.stationId ?? station?.id),
      stationName: optionalText(row.stationName ?? ticket.stationName ?? station?.name),
      reason: optionalText(row.reason ?? ticket.cancelReason),
      canceledAt,
      items: records(row.items ?? []).map((entry) => {
        const item = record(entry.item ?? entry);
        return {
          productName: text(item.productName ?? item.name),
          quantity: number(item.quantity),
        };
      }),
    };
  });
  for (const ticket of tickets.filter((ticket) => ticket.status === "canceled")) {
    if (alerts.some((alert) => alert.ticketId === ticket.id)) continue;
    alerts.push({
      id: `cancel:${ticket.id}:${ticket.canceledAt ?? "active"}`,
      ticketId: ticket.id,
      orderId: ticket.orderId,
      reference: ticket.reference,
      tableLabel: ticket.tableLabel,
      tabLabel: ticket.tabLabel,
      stationId: ticket.stationId,
      stationName: ticket.stationName,
      reason: ticket.cancelReason,
      canceledAt: ticket.canceledAt,
      items: items
        .filter((row) => row.ticketId === ticket.id)
        .map((row) => ({ productName: row.item.productName, quantity: row.item.quantity })),
    });
  }

  return {
    capturedAt,
    revision: parseKdsRevision(payload.revision),
    operationServiceMode: parseKdsServiceMode(payload.operationServiceMode ?? payload.serviceMode),
    stations: [...stationMap.values()],
    tickets,
    items,
    metrics: {
      total: optionalNumber(metricsRow?.total),
      pending: optionalNumber(metricsRow?.pending),
      preparing: optionalNumber(metricsRow?.preparing),
      ready: optionalNumber(metricsRow?.ready),
      averagePrepMinutes: optionalNumber(metricsRow?.averagePrepMinutes),
      averageWaitMinutes: optionalNumber(metricsRow?.averageWaitMinutes),
      medianPrepMinutes: optionalNumber(metricsRow?.medianPrepMinutes),
      p90PrepMinutes: optionalNumber(metricsRow?.p90PrepMinutes),
      overdueCount: optionalNumber(metricsRow?.overdue ?? metricsRow?.overdueCount),
      rushCount: optionalNumber(metricsRow?.rush ?? metricsRow?.rushCount),
    },
    allDay,
    freshness: {
      status: freshnessStatus as KdsFreshness["status"],
      lastSyncedAt: optionalText(freshnessRow?.lastSyncedAt ?? syncRow?.lastSyncedAt) ?? capturedAt,
      pendingCount: optionalNumber(
        freshnessRow?.pendingCount ??
          freshnessRow?.pending ??
          syncRow?.pendingCount ??
          syncRow?.pending,
      ),
      message: optionalText(freshnessRow?.message ?? syncRow?.message),
      projectionBlocked:
        parseOptionalKdsBoolean(syncRow?.projectionBlocked ?? freshnessRow?.projectionBlocked) ||
        syncRow?.projectionBlockedByEventId != null ||
        freshnessRow?.projectionBlockedByEventId != null,
      leaseExpiresAt: optionalText(
        syncRow?.leaseExpiresAt ?? freshnessRow?.leaseExpiresAt ?? payload.leaseExpiresAt,
      ),
    },
    capabilities: {
      itemState: capability("itemState", ["itemTransition"]),
      partialReady: capability("partialReady", [], false),
      courseFire: capability("courseFire", ["courseHold"]),
      priority: capability("priority"),
      orderPriority: capability("orderPriority", [], false),
      recall: capability("recall"),
      refire: capability("refire", ["itemRefire"], false),
      handoff: capability("handoff", ["orderHandoff"]),
      availability: capability("availability"),
      authorizedCancellation: capability(
        "authorizedCancellation",
        ["ticketCancel", "cancel"],
        false,
      ),
      block: capability("block", ["itemBlock"], false),
      attentionAcknowledgement: capability(
        "attentionAcknowledgement",
        ["acknowledgeAttention", "criticalNoteAcknowledgement"],
        false,
      ),
      reroute: capability("reroute", ["itemReroute"], false),
      batches: capability("batches", ["productionBatches"], false),
      analytics: capability("analytics", ["history"], false),
      capacity: capability("capacity", ["stationCapacity"], false),
      recommendation: capability("recommendation", ["capacityRecommendation"], false),
      automaticThrottling: capability("automaticThrottling", [], false),
      terminalProfileRead: capability("terminalProfileRead", [], false),
      terminalProfileManage: capability("terminalProfileManage", [], false),
      hardwarePrinting: capability("hardwarePrinting", ["printing", "printer"], false),
      bumpBar: capability("bumpBar", [], true),
      offlineBlock:
        parseOptionalKdsBoolean(
          capabilityRow?.offlineBlock ?? offlineRow?.block ?? offlineRow?.itemBlock,
        ) ||
        offlineActions.has("block-kds-item") ||
        offlineActions.has("unblock-kds-item"),
      offlineAttentionAcknowledgement:
        parseOptionalKdsBoolean(
          capabilityRow?.offlineAttentionAcknowledgement ??
            offlineRow?.attentionAcknowledgement ??
            offlineRow?.criticalNoteAcknowledgement,
        ) || offlineActions.has("acknowledge-kds-critical-note"),
      offlineAvailability:
        parseOptionalKdsBoolean(capabilityRow?.offlineAvailability ?? offlineRow?.availability) ||
        offlineActions.has("set-kds-product-availability"),
      offlineAvailabilityLifecycle: parseOptionalKdsBoolean(
        capabilityRow?.offlineAvailabilityLifecycle ?? offlineRow?.availabilityLifecycle,
      ),
      sequentialStages: capability("sequentialStages", [], false),
      ticketClaim: capability("ticketClaim", [], false),
      orderChanges: capability("orderChanges", [], false),
      runnerHandoff: capability("runnerHandoff", [], false),
      productionGrid: capability("productionGrid", [], false),
      recipes: capability("recipes", [], false),
      demandControl: capability("demandControl", [], false),
    },
    productAvailability,
    alerts,
    batches,
    productionGrid: records(payload.productionGrid ?? []).map((row) => ({
      stationId: text(row.stationId),
      productId: text(row.productId),
      productName: text(row.productName),
      totalQuantity: number(row.totalQuantity),
      queuedQuantity: optionalNumber(row.queuedQuantity) ?? 0,
      preparingQuantity: optionalNumber(row.preparingQuantity) ?? 0,
      readyQuantity: optionalNumber(row.readyQuantity) ?? 0,
      heldQuantity: optionalNumber(row.heldQuantity) ?? 0,
      assignments: records(row.assignments ?? []).map((assignment) => ({
        ticketId: text(assignment.ticketId),
        orderItemId: text(assignment.orderItemId),
        reference: text(assignment.reference),
        quantity: number(assignment.quantity),
        readyQuantity: optionalNumber(assignment.readyQuantity) ?? 0,
        status: text(assignment.status) as KdsItemState,
        stage: optionalNumber(assignment.stage) ?? 1,
      })),
    })),
    demand:
      payload.demand == null
        ? null
        : (() => {
            const demand = record(payload.demand);
            const state = text(demand.state);
            if (!(["normal", "strained", "overloaded"] as const).includes(state as "normal")) {
              throw new InvalidPilotPayloadError();
            }
            return {
              state: state as "normal" | "strained" | "overloaded",
              suggestedDelayMinutes: optionalNumber(demand.suggestedDelayMinutes) ?? 0,
              automatic: false as const,
              channels: records(demand.channels ?? []).map((channel) => ({
                channel: text(channel.channel),
                activeOrders: optionalNumber(channel.activeOrders) ?? 0,
                suggestedDelayMinutes: optionalNumber(channel.suggestedDelayMinutes) ?? 0,
              })),
            };
          })(),
  };
}

export function useRemote<T>(
  scope: PilotScope,
  loader: () => Promise<unknown>,
  parser: (value: unknown) => T,
) {
  const [retryToken, setRetryToken] = useState(0);
  const [state, setState] = useState<RemoteState<T>>({ status: "loading" });
  const [refreshing, setRefreshing] = useState(false);
  const [refreshError, setRefreshError] = useState<string | null>(null);
  const [lastSuccessfulAt, setLastSuccessfulAt] = useState<string | null>(null);
  const loaderRef = useRef(loader);
  const parserRef = useRef(parser);
  const readyRef = useRef(false);
  const mountedRef = useRef(true);
  const requestIdRef = useRef(0);
  const scopeKeyRef = useRef(`${scope.organizationId}:${scope.unitId}`);
  loaderRef.current = loader;
  parserRef.current = parser;
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);
  useEffect(() => {
    void retryToken;
    void scope.load;
    void scope.organizationId;
    void scope.refreshToken;
    void scope.unitId;
    let active = true;
    const requestId = ++requestIdRef.current;
    const scopeKey = `${scope.organizationId}:${scope.unitId}`;
    if (scopeKeyRef.current !== scopeKey) {
      scopeKeyRef.current = scopeKey;
      readyRef.current = false;
      setLastSuccessfulAt(null);
      setState({ status: "loading" });
    } else if (readyRef.current) {
      setRefreshing(true);
    } else {
      setState({ status: "loading" });
    }
    setRefreshError(null);
    loaderRef
      .current()
      .then(parserRef.current)
      .then((data) => {
        if (!active || requestIdRef.current !== requestId) return;
        readyRef.current = true;
        setState({ status: "ready", data });
        setLastSuccessfulAt(new Date().toISOString());
        setRefreshing(false);
      })
      .catch((error: unknown) => {
        if (!active || requestIdRef.current !== requestId) return;
        const message =
          error instanceof Error ? error.message : "Não foi possível carregar a operação.";
        if (readyRef.current) setRefreshError(message);
        setState((previous) => remoteStateAfterFailure(previous, message));
        setRefreshing(false);
      });
    return () => {
      active = false;
    };
  }, [retryToken, scope.load, scope.organizationId, scope.refreshToken, scope.unitId]);
  const retry = useCallback(() => setRetryToken((value) => value + 1), []);
  const refresh = useCallback(async (): Promise<boolean> => {
    const expectedScopeKey = scopeKeyRef.current;
    const requestId = ++requestIdRef.current;
    if (readyRef.current) setRefreshing(true);
    else setState({ status: "loading" });
    setRefreshError(null);
    try {
      const data = parserRef.current(await loaderRef.current());
      if (
        !mountedRef.current ||
        scopeKeyRef.current !== expectedScopeKey ||
        requestIdRef.current !== requestId
      ) {
        return false;
      }
      readyRef.current = true;
      setState({ status: "ready", data });
      setLastSuccessfulAt(new Date().toISOString());
      setRefreshing(false);
      return true;
    } catch (error) {
      if (
        !mountedRef.current ||
        scopeKeyRef.current !== expectedScopeKey ||
        requestIdRef.current !== requestId
      ) {
        return false;
      }
      const message =
        error instanceof Error ? error.message : "Não foi possível carregar a operação.";
      if (readyRef.current) setRefreshError(message);
      setState((previous) => remoteStateAfterFailure(previous, message));
      setRefreshing(false);
      return false;
    }
  }, []);
  return { state, retry, refresh, refreshing, refreshError, lastSuccessfulAt };
}

export function RemoteGate<T>({
  remote,
  children,
}: {
  remote: ReturnType<typeof useRemote<T>>;
  children: (data: T) => React.ReactNode;
}) {
  if (remote.state.status === "loading") {
    return (
      <Card className="remote-state" role="status">
        <span className="spinner" aria-hidden="true" />
        <strong>Carregando operação…</strong>
        <p>Sincronizando o estado atual da unidade.</p>
      </Card>
    );
  }
  if (remote.state.status === "error") {
    return (
      <Card className="remote-state" role="alert">
        <strong>Não foi possível carregar esta área</strong>
        <p>{remote.state.message}</p>
        <Button onClick={remote.retry} size="sm" variant="secondary">
          Tentar novamente
        </Button>
      </Card>
    );
  }
  return children(remote.state.data);
}

export function statusTone(status: string): "success" | "warning" | "neutral" | "danger" {
  if (["available", "ready", "done", "served"].includes(status)) return "success";
  if (["reserved", "preparing", "pending", "draft"].includes(status)) return "warning";
  if (["canceled", "blocked"].includes(status)) return "danger";
  return "neutral";
}

export function slugify(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

export function priceToCents(value: string): number {
  const amount = Number(value.trim().replace(/\./g, "").replace(",", "."));
  return Number.isFinite(amount) ? Math.round(amount * 100) : -1;
}
