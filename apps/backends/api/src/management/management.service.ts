import { createHash, randomBytes, randomUUID } from "node:crypto";
import {
  auditEvents,
  authSessions,
  buildReportArtifact,
  type Database,
  identities,
  legalEntities,
  managementAccountsPayable,
  managementAccountsReceivable,
  managementCashAdjustments,
  managementCashApprovalRequests,
  managementCashEntries,
  managementCashMovements,
  managementCashRegisters,
  managementCashRegisterTerminals,
  managementCashSettings,
  managementCashShiftResponsibilities,
  managementCashShifts,
  managementCashShiftTenderCounts,
  managementCashTransfers,
  managementCommissionRules,
  managementCommissions,
  managementIdempotency,
  managementInterunitTransferLines,
  managementInterunitTransferReceipts,
  managementInterunitTransfers,
  managementInventoryAssets,
  managementInventoryClosingLines,
  managementInventoryClosings,
  managementInventoryCountSchedules,
  managementInventoryEventLines,
  managementInventoryEvents,
  managementInventoryIssueRoutes,
  managementInventoryItems,
  managementInventoryLots,
  managementInventoryMovements,
  managementInventoryReservations,
  managementInventoryReviewRequests,
  managementInventorySupplierAliases,
  managementInventoryTransferReceipts,
  managementInventoryTransfers,
  managementNfeImportLines,
  managementNfeImports,
  managementOverviewPreferences,
  managementOverviewPriorityStates,
  managementPayablePayments,
  managementPeople,
  managementPersonAccess,
  managementProductionBatches,
  managementProductionBatchInputs,
  managementProductReturnables,
  managementPurchaseOrderItems,
  managementPurchaseOrders,
  managementPurchaseReceiptLines,
  managementPurchaseReceipts,
  managementReceivableLines,
  managementReceivablePayments,
  managementRecipeComponents,
  managementRecipeVersions,
  managementReconciliationEntries,
  managementReconciliationImports,
  managementReturnableCustodyMovements,
  managementReturnableIncidents,
  managementReturnableSupplierExchanges,
  managementSchedules,
  managementStockBalances,
  managementStockLocationItemSettings,
  managementStockLocations,
  managementSupplierInvoiceLines,
  managementSupplierInvoices,
  managementSuppliers,
  managementTimeCorrections,
  managementTimeEntries,
  managementTimeEntryBreaks,
  managementTimeTrackingAssignments,
  managementTimeTrackingClosures,
  managementTimeTrackingSettings,
  membershipInvitations,
  memberships,
  organizations,
  outboxEvents,
  posCatalogCategories,
  posOrderItems,
  posOrders,
  posPaymentDeviceDiagnostics,
  posPaymentReversals,
  posProductionStations,
  posProducts,
  posTabPayments,
  posTabs,
  posTerminalProfiles,
  roleBindings,
  terminalSessions,
  units,
} from "@giromesa/db";
import { encryptionKey, encryptSecret } from "@giromesa/domain";
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from "@nestjs/common";
import {
  and,
  asc,
  desc,
  eq,
  getTableColumns,
  gt,
  gte,
  ilike,
  inArray,
  isNotNull,
  isNull,
  lt,
  lte,
  ne,
  or,
  sql,
} from "drizzle-orm";
import { AuthService } from "../auth/auth.service.js";
import { TerminalSessionService } from "../auth/terminal-session.service.js";
import { DatabaseService } from "../database/database.module.js";
import { ScopeService } from "../organizations/scope.service.js";
import {
  assertIncidentTransition,
  assessInventoryRisk,
  cycleCountPolicy,
  forecastInventoryDemand,
  NfeParseError,
  parseNfe,
  replenishmentSuggestion,
  returnableAging,
  suggestNfeLineMatch,
  supplierPerformance,
} from "./management.inventory-rules.js";
import {
  assertCashDrawerDebit,
  assertCommissionCents,
  purchaseReconciliation as calculatePurchaseReconciliation,
  canGrantPersonAccessRole,
  cashDifferenceSeverity,
  cashTenderConference,
  cashTransferLockOrder,
  commissionAmountFromBasisPoints,
  inventoryChange,
  managementReplay,
  managementRequestHash,
  milliToQuantity,
  normalizeBusinessDocument,
  type PersonAccessRole,
  personAccessPublicStatus,
  profitabilityCoverage,
  purchaseLineReconciliation,
  purchaseReceiptPlan,
  purchaseStockConversion,
  quantityToMilli,
  reportPercentageChange,
  reportPeriodContext,
  requiresCashApproval,
  settlement,
} from "./management.rules.js";
import type {
  CashApprovalDecisionInput,
  CashMovementInput,
  CashRegisterCreateInput,
  CashRegisterUpdateInput,
  CashSettingsInput,
  CashShiftExportQuery,
  CashShiftHandoverInput,
  CashShiftHistoryQuery,
  CashShiftReviewInput,
  CashTerminalUpdateInput,
  CashTransferInput,
  ClockOutInput,
  CloseCashShiftInput,
  CommissionInput,
  CommissionRuleInput,
  CommissionTransitionInput,
  FinancialPaymentInput,
  InterunitTransferCancellationInput,
  InterunitTransferInput,
  InterunitTransferReceiptInput,
  InventoryAssetInput,
  InventoryAssetUpdateInput,
  InventoryClosingInput,
  InventoryEventInput,
  InventoryIssueRouteInput,
  InventoryItemInput,
  InventoryItemUpdateInput,
  InventoryLotInput,
  InventoryLotUpdateInput,
  InventoryReservationInput,
  InventoryReservationResolutionInput,
  InventoryReviewInput,
  InventoryTransferBatchInput,
  InventoryTransferInput,
  InventoryTransferResolutionInput,
  NfeImportConfirmInput,
  NfeImportInput,
  NfeImportReviewInput,
  OpenCashShiftInput,
  OverviewPreferencesInput,
  OverviewPriorityActionInput,
  PayableInput,
  PeopleAssignmentBatchInput,
  PeopleExportInput,
  PeopleListQuery,
  PersonAccessInviteInput,
  PersonAccessReactivateInput,
  PersonAccessRoleUpdateInput,
  PersonInput,
  PersonStatusInput,
  PersonUnitAccessInput,
  PersonUnitAccessRemovalInput,
  PersonUpdateInput,
  ProductionBatchCancellationInput,
  ProductionBatchCompletionInput,
  ProductionBatchInput,
  ProductReturnableInput,
  PunchLocationInput,
  PurchaseInvoiceConfirmInput,
  PurchaseListQuery,
  PurchaseOrderInput,
  PurchaseOrderUpdateInput,
  PurchaseReceiptInput,
  PurchaseReconciliationInput,
  PurchaseReversalInput,
  PurchaseTransitionInput,
  PurchaseVersionInput,
  ReceivableInput,
  ReceivablePaymentInput,
  RecipeConfigurationInput,
  ReconciliationInput,
  ReportPeriodInput,
  ReturnableCustodyConfirmInput,
  ReturnableIncidentInput,
  ReturnableIncidentReviewInput,
  ReturnableSupplierExchangeInput,
  ReturnableSupplierExchangeResolutionInput,
  ScheduleBatchInput,
  ScheduleCancelInput,
  ScheduleInput,
  ScheduleUpdateInput,
  SelfBreakInput,
  SelfClockInInput,
  SelfClockOutInput,
  StockLocationInput,
  StockLocationItemSettingInput,
  StockLocationUpdateInput,
  SupplierInput,
  SupplierInvoiceInput,
  SupplierListQuery,
  SupplierUpdateInput,
  TimeCorrectionDecisionInput,
  TimeCorrectionInput,
  TimeEntryInput,
  TimeTrackingClosureInput,
  TimeTrackingSettingsInput,
} from "./management.schemas.js";
import { inventoryEventSchema } from "./management.schemas.js";
import { reportNextCursor, reportPageOffset } from "./management-report.rules.js";

type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];
type JsonResponse = Record<string, unknown>;
type ManagementRole = "owner" | "manager" | "inventory" | "finance" | "cashier";

const INVENTORY_ROLES = ["owner", "manager", "inventory"] as const;
const FINANCE_ROLES = ["owner", "manager", "finance"] as const;
const CASH_READ_ROLES = ["owner", "manager", "finance", "cashier"] as const;
const CASH_OPERATE_ROLES = ["owner", "manager", "cashier"] as const;
const CASH_REVIEW_ROLES = ["owner", "manager"] as const;
const DEFAULT_CASH_SETTINGS = {
  movementApprovalThresholdCents: 50_000,
  discrepancyCriticalThresholdCents: 1_000,
  maxShiftMinutes: 720,
} as const;
const CASH_PAYMENT_METHODS = [
  "cash",
  "pix",
  "credit_card",
  "debit_card",
  "bank_transfer",
  "other",
] as const;
const PEOPLE_ROLES = ["owner", "manager"] as const;
const SENSITIVE_PERSON_ACCESS_ROLES = new Set<PersonAccessRole>([
  "manager",
  "finance",
  "accountant",
]);
const TIME_TRACKING_READ_ROLES = ["owner", "manager", "finance"] as const;
const PERSON_ACCESS_INVITATION_TTL_MS = 7 * 24 * 60 * 60 * 1_000;
const personAccessInvitationHash = (token: string) =>
  createHash("sha256").update(token).digest("hex");
const CHANNEL_LABELS = { dine_in: "Salão", pickup: "Retirada", delivery: "Delivery" } as const;
const PAYMENT_LABELS = {
  cash: "Dinheiro",
  credit_card: "Cartão de crédito",
  debit_card: "Cartão de débito",
  pix: "Pix",
  bank_transfer: "Transferência bancária",
  other: "Outro",
} as const;

type PersonAccessRead = typeof managementPersonAccess.$inferSelect & {
  invitationExpiresAt: Date | null;
};

function personAccessView(access: PersonAccessRead | undefined) {
  if (!access) return { status: "none" as const };
  const status = personAccessPublicStatus(access.status, access.invitationExpiresAt);
  if (status === "none") return { status };
  return {
    status,
    email: access.email,
    role: access.role,
    invitationId: access.invitationId ?? undefined,
    expiresAt: access.invitationExpiresAt?.toISOString(),
    membershipId: access.membershipId ?? undefined,
  };
}

type ReportDailyChannelSale = {
  date: string;
  channel: keyof typeof CHANNEL_LABELS;
  revenueCents: number;
  quantity: number;
};
type ReportProductSale = {
  productId: string;
  productName: string;
  categoryId: string;
  categoryName: string;
  revenueCents: number;
  quantity: number;
};

const DEFAULT_TIME_TRACKING_SETTINGS = {
  mode: "off" as const,
  geofenceEnabled: true,
  locationLabel: null,
  locationAddress: null,
  latitude: null,
  longitude: null,
  radiusMeters: 100,
  accuracyToleranceMeters: 50,
  maxLocationAccuracyMeters: 100,
  lowAccuracyPolicy: "block" as const,
  additionalLocations: [] as Array<{
    id: string;
    label: string;
    address?: string;
    latitude: number;
    longitude: number;
    radiusMeters: number;
    accuracyToleranceMeters: number;
  }>,
  managerCanView: false,
  financeCanView: false,
  antiFraudEnabled: true,
  offlineEnabled: true,
  offlineMaxDelayMinutes: 120,
  offlineRequiresJustification: true,
  notificationsEnabled: true,
  emailAlertsEnabled: false,
  managerAlertOnAnomaly: true,
  locationRetentionDays: 365,
  lateToleranceMinutes: 15,
  minimumBreakMinutes: 0,
  maxOvertimeMinutes: 120,
  longShiftAlertMinutes: 720,
  reminderBeforeShiftMinutes: 15,
  reminderAfterShiftMinutes: 15,
};

function timeTrackingSettingsWithoutCoordinates<
  T extends {
    locationAddress: string | null;
    latitude: number | null;
    longitude: number | null;
    additionalLocations: unknown[];
  },
>(settings: T) {
  return {
    ...settings,
    locationAddress: null,
    latitude: null,
    longitude: null,
    additionalLocations: [] as T["additionalLocations"],
  };
}

export function timeTrackingEntryForRead<
  T extends {
    id: string;
    personId: string;
    clockedInAt: Date;
    clockedOutAt: Date | null;
    source: string;
  },
>(entry: T) {
  return {
    id: entry.id,
    personId: entry.personId,
    clockedInAt: entry.clockedInAt,
    clockedOutAt: entry.clockedOutAt,
    source: entry.source,
  };
}

function timeTrackingBreakForRead(entry: {
  id: string;
  timeEntryId: string;
  type: "meal" | "temporary";
  startedAt: Date;
  endedAt: Date | null;
}) {
  return {
    id: entry.id,
    timeEntryId: entry.timeEntryId,
    type: entry.type,
    startedAt: entry.startedAt,
    endedAt: entry.endedAt,
  };
}

export function assertTimeTrackingReadPolicy(
  role: (typeof TIME_TRACKING_READ_ROLES)[number],
  settings: Pick<typeof DEFAULT_TIME_TRACKING_SETTINGS, "managerCanView" | "financeCanView">,
) {
  if (role === "manager" && !settings.managerCanView) {
    throw new ForbiddenException({
      code: "TIME_TRACKING_MANAGER_VIEW_DISABLED",
      message: "A visualização do ponto está desativada para gerentes nesta unidade.",
    });
  }
  if (role === "finance" && !settings.financeCanView) {
    throw new ForbiddenException({
      code: "TIME_TRACKING_FINANCE_VIEW_DISABLED",
      message: "A visualização do ponto está desativada para o contador nesta unidade.",
    });
  }
}

export type PunchContext = {
  ipAddress?: string;
  userAgent?: string;
};

export function normalizeIdempotencyKey(key: unknown) {
  if (typeof key !== "string") {
    throw new BadRequestException({
      code: "IDEMPOTENCY_KEY_REQUIRED",
      message: "Envie Idempotency-Key com 8 a 160 caracteres.",
    });
  }
  const normalized = key.trim();
  if (normalized.length < 8 || normalized.length > 160) {
    throw new BadRequestException({
      code: "IDEMPOTENCY_KEY_REQUIRED",
      message: "Envie Idempotency-Key com 8 a 160 caracteres.",
    });
  }
  return normalized;
}

export function commissionTransitionAllowed(
  current: "pending" | "approved" | "rejected" | "paid" | "canceled",
  next: "approved" | "rejected" | "paid" | "canceled",
) {
  return (
    (current === "pending" && ["approved", "rejected", "canceled"].includes(next)) ||
    (current === "approved" && ["paid", "canceled"].includes(next))
  );
}

function distanceMeters(
  latitudeA: number,
  longitudeA: number,
  latitudeB: number,
  longitudeB: number,
) {
  const earthRadius = 6_371_000;
  const toRadians = (value: number) => (value * Math.PI) / 180;
  const deltaLatitude = toRadians(latitudeB - latitudeA);
  const deltaLongitude = toRadians(longitudeB - longitudeA);
  const a =
    Math.sin(deltaLatitude / 2) ** 2 +
    Math.cos(toRadians(latitudeA)) *
      Math.cos(toRadians(latitudeB)) *
      Math.sin(deltaLongitude / 2) ** 2;
  return earthRadius * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export type TimeEntrySummary = {
  timeEntryId: string;
  personId: string;
  date: string;
  workedMinutes: number;
  breakMinutes: number;
  scheduledMinutes: number | null;
  overtimeMinutes: number;
  anomalyCodes: string[];
};

type TimeTrackingRuleOptions = {
  lateToleranceMinutes?: number;
  minimumBreakMinutes?: number;
  maxOvertimeMinutes?: number;
  longShiftAlertMinutes?: number;
  antiFraudEnabled?: boolean;
};

export function summarizeTimeEntries(
  entries: Array<{
    id: string;
    personId: string;
    clockedInAt: Date;
    clockedOutAt: Date | null;
    clockInDeviceId?: string | null;
    clockInFlags?: string[] | null;
    clockOutFlags?: string[] | null;
  }>,
  breaks: Array<{
    id: string;
    timeEntryId: string;
    startedAt: Date;
    endedAt: Date | null;
  }>,
  schedules: Array<{ personId: string; startsAt: Date; endsAt: Date; breakMinutes?: number }>,
  pendingCorrectionEntryIds: Set<string>,
  now = new Date(),
  options: TimeTrackingRuleOptions = {},
): TimeEntrySummary[] {
  return entries.map((entry) => {
    const entryBreaks = breaks.filter((item) => item.timeEntryId === entry.id);
    const end = entry.clockedOutAt ?? now;
    const breakMinutes = entryBreaks.reduce((total, item) => {
      if (!item.endedAt) return total;
      return (
        total +
        Math.max(0, Math.round((item.endedAt.getTime() - item.startedAt.getTime()) / 60_000))
      );
    }, 0);
    const workedMinutes = Math.max(
      0,
      Math.round((end.getTime() - entry.clockedInAt.getTime()) / 60_000) - breakMinutes,
    );
    const anomalyCodes: string[] = [];
    const schedule = schedules
      .filter(
        (item) =>
          item.personId === entry.personId &&
          Math.abs(item.startsAt.getTime() - entry.clockedInAt.getTime()) < 36 * 60 * 60_000,
      )
      .sort(
        (left, right) =>
          Math.abs(left.startsAt.getTime() - entry.clockedInAt.getTime()) -
          Math.abs(right.startsAt.getTime() - entry.clockedInAt.getTime()),
      )[0];
    const scheduledMinutes = schedule
      ? Math.max(
          0,
          Math.round((schedule.endsAt.getTime() - schedule.startsAt.getTime()) / 60_000) -
            (schedule.breakMinutes ?? 0),
        )
      : null;
    const overtimeMinutes =
      scheduledMinutes === null ? 0 : Math.max(0, workedMinutes - scheduledMinutes);
    if (!entry.clockedOutAt && workedMinutes >= (options.longShiftAlertMinutes ?? 12 * 60)) {
      anomalyCodes.push("long_open_shift");
    }
    if (!entry.clockedOutAt && workedMinutes >= 16 * 60) anomalyCodes.push("missing_clock_out");
    if (entryBreaks.some((item) => !item.endedAt)) anomalyCodes.push("open_break");
    if (
      schedule &&
      entry.clockedInAt.getTime() >
        schedule.startsAt.getTime() + (options.lateToleranceMinutes ?? 15) * 60_000
    ) {
      anomalyCodes.push("late_arrival");
    }
    if (
      (options.minimumBreakMinutes ?? 0) > 0 &&
      workedMinutes + breakMinutes >= 6 * 60 &&
      breakMinutes < (options.minimumBreakMinutes ?? 0)
    ) {
      anomalyCodes.push("short_break");
    }
    if (
      scheduledMinutes !== null &&
      overtimeMinutes > (options.maxOvertimeMinutes ?? Number.MAX_SAFE_INTEGER)
    ) {
      anomalyCodes.push("overtime_limit_exceeded");
    }
    const devices = new Set(
      entries
        .filter((other) => other.personId === entry.personId && other.clockInDeviceId)
        .map((other) => other.clockInDeviceId),
    );
    if (devices.size > 1) anomalyCodes.push("multiple_devices");
    if (options.antiFraudEnabled !== false) {
      const flags = [...(entry.clockInFlags ?? []), ...(entry.clockOutFlags ?? [])];
      if (flags.includes("mock_location")) anomalyCodes.push("mock_location");
      if (flags.includes("clock_skew")) anomalyCodes.push("clock_skew");
      if (flags.includes("missing_device")) anomalyCodes.push("missing_device");
      if (flags.includes("missing_session")) anomalyCodes.push("missing_session");
      if (flags.includes("low_location_accuracy")) anomalyCodes.push("low_location_accuracy");
      if (flags.includes("missing_location_accuracy"))
        anomalyCodes.push("missing_location_accuracy");
      if (flags.includes("offline_punch")) anomalyCodes.push("offline_punch");
    }
    if (
      entries.some(
        (other) =>
          other.id !== entry.id &&
          other.personId === entry.personId &&
          other.clockedInAt < end &&
          (other.clockedOutAt ?? now) > entry.clockedInAt,
      )
    ) {
      anomalyCodes.push("overlapping_shift");
    }
    if (pendingCorrectionEntryIds.has(entry.id)) anomalyCodes.push("pending_correction");
    return {
      timeEntryId: entry.id,
      personId: entry.personId,
      date: entry.clockedInAt.toISOString().slice(0, 10),
      workedMinutes,
      breakMinutes,
      scheduledMinutes,
      overtimeMinutes,
      anomalyCodes,
    };
  });
}

export function buildTimeTrackingAlerts(
  entries: Array<{
    id: string;
    personId: string;
    clockedInAt: Date;
    clockedOutAt: Date | null;
  }>,
  schedules: Array<{ id: string; personId: string; startsAt: Date; endsAt: Date }>,
  summaries: TimeEntrySummary[],
  settings: Pick<
    typeof DEFAULT_TIME_TRACKING_SETTINGS,
    | "notificationsEnabled"
    | "reminderBeforeShiftMinutes"
    | "reminderAfterShiftMinutes"
    | "managerAlertOnAnomaly"
  >,
  now = new Date(),
) {
  if (!settings.notificationsEnabled) return [];
  const alerts: Array<{
    type: string;
    personId: string;
    timeEntryId?: string;
    message: string;
    severity: "info" | "warning" | "danger";
  }> = [];
  for (const schedule of schedules) {
    if (
      now < new Date(schedule.startsAt.getTime() - settings.reminderBeforeShiftMinutes * 60_000)
    ) {
      continue;
    }
    const matchingEntry = entries.find(
      (entry) =>
        entry.personId === schedule.personId &&
        entry.clockedInAt <= schedule.endsAt &&
        (entry.clockedOutAt ?? now) >= schedule.startsAt,
    );
    if (!matchingEntry) {
      alerts.push({
        type: "missing_clock_in",
        personId: schedule.personId,
        message: "A escala começou e ainda não há entrada registrada.",
        severity: "warning",
      });
    } else if (
      !matchingEntry.clockedOutAt &&
      now > new Date(schedule.endsAt.getTime() + settings.reminderAfterShiftMinutes * 60_000)
    ) {
      alerts.push({
        type: "missing_clock_out",
        personId: schedule.personId,
        timeEntryId: matchingEntry.id,
        message: "A escala terminou e o turno continua aberto.",
        severity: "warning",
      });
    }
  }
  if (settings.managerAlertOnAnomaly) {
    for (const summary of summaries) {
      for (const code of summary.anomalyCodes) {
        alerts.push({
          type: code,
          personId: summary.personId,
          timeEntryId: summary.timeEntryId,
          message: code === "mock_location" ? "Localização simulada reportada no registro." : code,
          severity: code === "mock_location" || code === "clock_skew" ? "danger" : "warning",
        });
      }
    }
  }
  return alerts;
}

function parseCapturedAt(value: string | undefined) {
  if (!value) return null;
  const capturedAt = new Date(value);
  if (!Number.isFinite(capturedAt.getTime())) {
    throw new BadRequestException({
      code: "INVALID_CAPTURED_AT",
      message: "O horário capturado pelo dispositivo é inválido.",
    });
  }
  return capturedAt;
}

function resolvePunchTiming(
  input: PunchLocationInput & { capturedAt?: string },
  settings: Pick<
    typeof DEFAULT_TIME_TRACKING_SETTINGS,
    "offlineEnabled" | "offlineMaxDelayMinutes" | "offlineRequiresJustification"
  >,
  serverAt = new Date(),
) {
  const capturedAt = parseCapturedAt(input.capturedAt) ?? serverAt;
  if (!input.offline) {
    if (capturedAt.getTime() > serverAt.getTime() + 5 * 60_000) {
      throw new BadRequestException({
        code: "CAPTURED_AT_OUT_OF_RANGE",
        message: "O relógio do dispositivo está adiantado demais para registrar o ponto.",
      });
    }
    return { occurredAt: serverAt, capturedAt, serverAt };
  }
  if (!settings.offlineEnabled) {
    throw new ForbiddenException({
      code: "TIME_TRACKING_OFFLINE_DISABLED",
      message: "Marcações offline estão desativadas nesta unidade.",
    });
  }
  if (settings.offlineRequiresJustification && !input.offlineJustification?.trim()) {
    throw new BadRequestException({
      code: "TIME_TRACKING_OFFLINE_JUSTIFICATION_REQUIRED",
      message: "Informe a justificativa da marcação offline.",
    });
  }
  const delayMilliseconds = serverAt.getTime() - capturedAt.getTime();
  if (
    delayMilliseconds < -5 * 60_000 ||
    delayMilliseconds > settings.offlineMaxDelayMinutes * 60_000
  ) {
    throw new BadRequestException({
      code: "TIME_TRACKING_OFFLINE_DELAY_EXCEEDED",
      message:
        "A marcação offline ultrapassou o prazo configurado. Solicite uma correção ao proprietário.",
    });
  }
  return { occurredAt: capturedAt, capturedAt, serverAt };
}

function punchMetadata(
  capturedAt: Date,
  input: PunchLocationInput,
  context: PunchContext,
  antiFraudEnabled: boolean,
  serverAt = new Date(),
  extraFlags: string[] = [],
) {
  const flags = [...extraFlags];
  if (antiFraudEnabled && input.mockLocationDetected) flags.push("mock_location");
  if (antiFraudEnabled && !input.deviceId) flags.push("missing_device");
  if (antiFraudEnabled && !input.sessionId) flags.push("missing_session");
  if (input.offline) flags.push("offline_punch");
  if (
    antiFraudEnabled &&
    !input.offline &&
    Math.abs(serverAt.getTime() - capturedAt.getTime()) > 2 * 60_000
  ) {
    flags.push("clock_skew");
  }
  return {
    serverAt,
    deviceId: input.deviceId,
    sessionId: input.sessionId,
    ipAddress: context.ipAddress,
    userAgent: context.userAgent,
    flags: [...new Set(flags)],
  };
}

type ReportPaymentMethod = {
  method: keyof typeof PAYMENT_LABELS;
  revenueCents: number;
  quantity: number;
};

export function buildReportSalesAnalytics(
  period: { from: string; to: string },
  dailyChannelSales: ReportDailyChannelSale[],
  productSales: ReportProductSale[],
  paymentMethods: ReportPaymentMethod[],
  comparisonMode: ReportPeriodInput["comparisonMode"] = "previous_period",
) {
  const { dates, previousDates, previousPeriod } = reportPeriodContext(period, comparisonMode);
  const revenueByDate = new Map<string, number>();
  const channels = new Map<
    string,
    { key: string; label: string; revenueCents: number; quantity: number }
  >();
  for (const row of dailyChannelSales) {
    revenueByDate.set(row.date, (revenueByDate.get(row.date) ?? 0) + row.revenueCents);
    if (row.date < period.from || row.date > period.to) continue;
    const current = channels.get(row.channel) ?? {
      key: row.channel,
      label: CHANNEL_LABELS[row.channel],
      revenueCents: 0,
      quantity: 0,
    };
    current.revenueCents += row.revenueCents;
    current.quantity += row.quantity;
    channels.set(row.channel, current);
  }
  const dailySeries = dates.map((date, index) => ({
    date,
    revenueCents: revenueByDate.get(date) ?? 0,
    previousRevenueCents:
      previousDates[index] === null
        ? null
        : (revenueByDate.get(previousDates[index] as string) ?? 0),
  }));
  const revenueCents = dailySeries.reduce((sum, row) => sum + row.revenueCents, 0);
  const previousRevenueCents =
    comparisonMode === "none"
      ? null
      : dailySeries.reduce((sum, row) => sum + (row.previousRevenueCents ?? 0), 0);
  const categories = new Map<
    string,
    { key: string; label: string; revenueCents: number; quantity: number }
  >();
  for (const product of productSales) {
    const current = categories.get(product.categoryId) ?? {
      key: product.categoryId,
      label: product.categoryName,
      revenueCents: 0,
      quantity: 0,
    };
    current.revenueCents += product.revenueCents;
    current.quantity += product.quantity;
    categories.set(product.categoryId, current);
  }
  const rank = <T extends { label: string; revenueCents: number }>(rows: T[]) =>
    rows.sort(
      (left, right) =>
        right.revenueCents - left.revenueCents || left.label.localeCompare(right.label),
    );
  return {
    previousPeriod,
    comparison: {
      mode: comparisonMode,
      period: previousPeriod,
      revenueCents,
      previousRevenueCents,
      changeCents: previousRevenueCents === null ? null : revenueCents - previousRevenueCents,
      changePercent:
        previousRevenueCents === null
          ? null
          : reportPercentageChange(revenueCents, previousRevenueCents),
    },
    dailySeries,
    breakdowns: {
      products: rank(
        productSales.map((row) => ({
          key: row.productId,
          label: row.productName,
          revenueCents: row.revenueCents,
          quantity: row.quantity,
        })),
      ),
      categories: rank([...categories.values()]),
      channels: rank([...channels.values()]),
      paymentMethods: rank(
        paymentMethods.map((row) => ({
          key: row.method,
          label: PAYMENT_LABELS[row.method],
          revenueCents: row.revenueCents,
          quantity: row.quantity,
        })),
      ),
    },
  };
}

type ReportFamilySource = {
  salesCoverage: "complete" | "partial" | "unavailable";
  tabs: {
    closedTabs: number;
    dineInTabs: number;
    tableTurnovers: number;
    guests: number;
    subtotalCents: number;
    discountCents: number;
    netRevenueCents: number;
    averageServiceMinutes: number | null;
  };
  exceptions: {
    canceledItems: number;
    canceledValueCents: number;
    discountedItems: number;
    itemDiscountCents: number;
  };
  cancellationReasons: Array<{ label: string; quantity: number; amountCents: number }>;
  inventory: {
    lossEvents: number;
    lossQuantity: number;
    lossValueCents?: number | null;
    stockoutItems: number;
    lowStockItems: number;
    currentInventoryValueCents: number | null;
  };
  purchasing: {
    orderCount: number;
    orderedCents: number;
    canceledOrders: number;
    receiptCount: number;
    receivedCents: number;
    suppliers: Array<{
      key: string;
      label: string;
      orderCount: number;
      orderedCents: number;
      receiptCount: number;
      receivedCents: number;
    }>;
  };
  profitability: {
    coverage: "complete" | "partial" | "unavailable";
    grossMarginCents: number | null;
    revenueCents: number;
    products?: Array<{
      key: string;
      label: string;
      quantity: number;
      revenueCents: number;
      costCents: number | null;
      grossMarginCents: number | null;
      grossMarginPercent: number | null;
    }>;
  };
  comparisons?: Record<
    "sales" | "exceptions" | "inventory" | "purchasing" | "operations" | "profitability",
    Record<string, ReturnType<typeof reportMetricComparison>>
  >;
  hourlySales?: Array<{ hour: number; closedTabs: number; revenueCents: number }>;
  shifts?: Array<{
    key: string;
    label: string;
    closedTabs: number;
    guests: number;
    revenueCents: number;
    averageServiceMinutes: number | null;
  }>;
  inventoryAnalysis?: Array<{
    key: string;
    label: string;
    abcClass: "A" | "B" | "C" | null;
    consumedQuantity: number;
    consumedValueCents: number | null;
    currentQuantity: number;
    coverageDays: number | null;
  }>;
  supplierPerformance?: Array<{
    key: string;
    label: string;
    orderCount: number;
    receiptCount: number;
    onTimeRatePercent: number | null;
    averageLeadDays: number | null;
    priceVariancePercent: number | null;
  }>;
  multiunit?: Array<{
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
  }> | null;
  quality?: {
    scorePercent: number;
    issues: Array<{
      key: string;
      label: string;
      count: number;
      severity: "info" | "warning" | "critical";
    }>;
  };
};

export function reportMetricComparison(current: number | null, previous: number | null) {
  return {
    current,
    previous,
    change: current === null || previous === null ? null : current - previous,
    changePercent:
      current === null || previous === null ? null : reportPercentageChange(current, previous),
  };
}

export function buildReportFamilies(source: ReportFamilySource) {
  const average = (total: number, count: number) => (count > 0 ? Math.round(total / count) : null);
  const grossMarginPercent =
    source.profitability.grossMarginCents === null || source.profitability.revenueCents <= 0
      ? null
      : Number(
          (
            (source.profitability.grossMarginCents / source.profitability.revenueCents) *
            100
          ).toFixed(2),
        );
  const comparisons = source.comparisons ?? {
    sales: {},
    exceptions: {},
    inventory: {},
    purchasing: {},
    operations: {},
    profitability: {},
  };
  return {
    sales: {
      coverage: source.salesCoverage,
      closedTabs: source.tabs.closedTabs,
      subtotalCents: source.tabs.subtotalCents,
      discountsCents: source.tabs.discountCents,
      netRevenueCents: source.tabs.netRevenueCents,
      averageTicketCents: average(source.tabs.netRevenueCents, source.tabs.closedTabs),
      guests: source.tabs.guests,
      averageSpendPerGuestCents: average(source.tabs.netRevenueCents, source.tabs.guests),
      hourly: source.hourlySales ?? [],
      comparison: comparisons.sales,
    },
    exceptions: {
      coverage: "complete" as const,
      ...source.exceptions,
      tabDiscountCents: source.tabs.discountCents,
      cancellationReasons: source.cancellationReasons,
      comparison: comparisons.exceptions,
    },
    inventory: {
      coverage: "complete" as const,
      basis: "period_events_and_current_balance" as const,
      ...source.inventory,
      analysis: source.inventoryAnalysis ?? [],
      comparison: comparisons.inventory,
    },
    purchasing: {
      coverage: "complete" as const,
      ...source.purchasing,
      supplierPerformance: source.supplierPerformance ?? [],
      comparison: comparisons.purchasing,
    },
    operations: {
      coverage: "complete" as const,
      closedTabs: source.tabs.closedTabs,
      dineInTabs: source.tabs.dineInTabs,
      tableTurnovers: source.tabs.tableTurnovers,
      guests: source.tabs.guests,
      averageGuestsPerTab: average(source.tabs.guests, source.tabs.closedTabs),
      averageServiceMinutes: source.tabs.averageServiceMinutes,
      shifts: source.shifts ?? [],
      comparison: comparisons.operations,
    },
    profitability: {
      coverage: source.profitability.coverage,
      grossMarginPercent,
      productProfitabilityCoverage: source.profitability.coverage,
      products: source.profitability.products ?? [],
      comparison: comparisons.profitability,
    },
    multiunit: {
      coverage: !source.multiunit ? ("unavailable" as const) : ("complete" as const),
      units: source.multiunit ?? [],
    },
    quality: source.quality ?? { scorePercent: 100, issues: [] },
  };
}

@Injectable()
export class ManagementService {
  constructor(
    private readonly database: DatabaseService,
    private readonly scope: ScopeService,
    private readonly auth?: AuthService,
    private readonly terminals?: TerminalSessionService,
  ) {}

  private async requireRole(
    identityId: string,
    organizationId: string,
    unitId: string,
    allowed: readonly ManagementRole[],
  ) {
    await this.scope.requireUnitAccess(identityId, organizationId, unitId);
    const rows = await this.scope.requireOrganizationRole(identityId, organizationId, allowed);
    const role = allowed.find((candidate) =>
      rows.some((row) => row.role === candidate && (row.unitId === null || row.unitId === unitId)),
    );
    if (!role) {
      throw new ForbiddenException({
        code: "MANAGEMENT_ROLE_DENIED",
        message: "Ação não autorizada nesta unidade.",
      });
    }
    return role;
  }

  private assertPersonAccessGrant(actorRole: ManagementRole, targetRole: PersonAccessRole) {
    if (
      (actorRole !== "owner" && actorRole !== "manager") ||
      !canGrantPersonAccessRole(actorRole, targetRole)
    ) {
      throw new ForbiddenException({
        code: "PERSON_ACCESS_ROLE_DENIED",
        message: "Você não pode liberar este perfil de acesso.",
      });
    }
  }

  private async requireSensitiveAccessStepUp(
    identityId: string,
    role: PersonAccessRole,
    proof?: { currentPassword?: string; mfaCode?: string },
  ) {
    if (!SENSITIVE_PERSON_ACCESS_ROLES.has(role)) return;
    if (!this.auth) throw new ServiceUnavailableException({ code: "ACCESS_STEP_UP_UNAVAILABLE" });
    await this.auth.verifyStepUp(identityId, proof);
  }

  private async personAccessRows(
    source: Transaction | Database,
    organizationId: string,
    unitId: string,
    personIds: string[],
  ): Promise<PersonAccessRead[]> {
    if (personIds.length === 0) return [];
    const rows = await source
      .select({
        access: managementPersonAccess,
        invitationExpiresAt: membershipInvitations.expiresAt,
      })
      .from(managementPersonAccess)
      .leftJoin(
        membershipInvitations,
        eq(membershipInvitations.id, managementPersonAccess.invitationId),
      )
      .where(
        and(
          eq(managementPersonAccess.organizationId, organizationId),
          eq(managementPersonAccess.unitId, unitId),
          inArray(managementPersonAccess.personId, personIds),
        ),
      );
    return rows.map((row) => ({
      ...row.access,
      invitationExpiresAt: row.invitationExpiresAt,
    }));
  }

  private async personOffboardingFacts(
    source: Transaction | Database,
    organizationId: string,
    personId: string,
    identityId: string | null,
  ) {
    const now = new Date();
    const accesses = await source
      .select({ membershipId: managementPersonAccess.membershipId })
      .from(managementPersonAccess)
      .where(
        and(
          eq(managementPersonAccess.organizationId, organizationId),
          eq(managementPersonAccess.personId, personId),
          inArray(managementPersonAccess.status, ["active", "suspended", "pending"]),
        ),
      );
    const membershipIds = accesses
      .map((access) => access.membershipId)
      .filter((id): id is string => Boolean(id));
    const [openTime, futureSchedules, unsettledCommissions, openCash, activeTerminals] =
      await Promise.all([
        source
          .select({ count: sql<number>`count(*)::int` })
          .from(managementTimeEntries)
          .where(
            and(
              eq(managementTimeEntries.organizationId, organizationId),
              eq(managementTimeEntries.personId, personId),
              isNull(managementTimeEntries.clockedOutAt),
            ),
          ),
        source
          .select({ count: sql<number>`count(*)::int` })
          .from(managementSchedules)
          .where(
            and(
              eq(managementSchedules.organizationId, organizationId),
              eq(managementSchedules.personId, personId),
              gt(managementSchedules.endsAt, now),
              isNull(managementSchedules.canceledAt),
            ),
          ),
        source
          .select({ count: sql<number>`count(*)::int` })
          .from(managementCommissions)
          .where(
            and(
              eq(managementCommissions.organizationId, organizationId),
              eq(managementCommissions.personId, personId),
              inArray(managementCommissions.status, ["pending", "approved"]),
            ),
          ),
        identityId
          ? source
              .select({ count: sql<number>`count(*)::int` })
              .from(managementCashShifts)
              .where(
                and(
                  eq(managementCashShifts.organizationId, organizationId),
                  eq(managementCashShifts.status, "open"),
                  or(
                    eq(managementCashShifts.operatorIdentityId, identityId),
                    eq(managementCashShifts.currentResponsibleIdentityId, identityId),
                  ),
                ),
              )
          : Promise.resolve([{ count: 0 }]),
        membershipIds.length
          ? source
              .select({ count: sql<number>`count(*)::int` })
              .from(terminalSessions)
              .where(
                and(
                  inArray(terminalSessions.activeActorMembershipId, membershipIds),
                  isNull(terminalSessions.revokedAt),
                  gt(terminalSessions.expiresAt, now),
                ),
              )
          : Promise.resolve([{ count: 0 }]),
      ]);
    const counts = {
      openTimeEntries: openTime[0]?.count ?? 0,
      futureSchedules: futureSchedules[0]?.count ?? 0,
      unsettledCommissions: unsettledCommissions[0]?.count ?? 0,
      openCashShifts: openCash[0]?.count ?? 0,
      activeTerminals: activeTerminals[0]?.count ?? 0,
      accessAssignments: accesses.length,
    };
    return {
      canProceed: counts.openTimeEntries === 0 && counts.openCashShifts === 0,
      counts,
      checks: [
        {
          code: "OPEN_TIME_ENTRY",
          label: "Turnos de ponto em andamento",
          count: counts.openTimeEntries,
          severity: "blocker" as const,
        },
        {
          code: "OPEN_CASH_SHIFT",
          label: "Caixas sob responsabilidade",
          count: counts.openCashShifts,
          severity: "blocker" as const,
        },
        {
          code: "FUTURE_SCHEDULE",
          label: "Escalas futuras preservadas",
          count: counts.futureSchedules,
          severity: "warning" as const,
        },
        {
          code: "UNSETTLED_COMMISSION",
          label: "Comissões ainda não liquidadas",
          count: counts.unsettledCommissions,
          severity: "warning" as const,
        },
        {
          code: "ACTIVE_TERMINAL",
          label: "Terminais que serão bloqueados",
          count: counts.activeTerminals,
          severity: "info" as const,
        },
      ],
    };
  }

  private async createPersonAccessInvitation(
    tx: Transaction,
    actorIdentityId: string,
    organizationId: string,
    unitId: string,
    personId: string,
    input: PersonAccessInviteInput,
    replace: boolean,
  ) {
    if (process.env.EMAIL_PROVIDER_ENABLED !== "true") {
      throw new ServiceUnavailableException({
        code: "EMAIL_PROVIDER_DISABLED",
        message: "Convites por e-mail ainda não foram configurados neste ambiente.",
      });
    }
    const [person] = await tx
      .select({ id: managementPeople.id, active: managementPeople.active })
      .from(managementPeople)
      .where(
        and(
          eq(managementPeople.organizationId, organizationId),
          eq(managementPeople.unitId, unitId),
          eq(managementPeople.id, personId),
        ),
      )
      .limit(1);
    if (!person) throw new NotFoundException({ code: "PERSON_NOT_FOUND" });
    if (!person.active) throw new ConflictException({ code: "PERSON_INACTIVE" });

    const [current] = await tx
      .select()
      .from(managementPersonAccess)
      .where(
        and(
          eq(managementPersonAccess.organizationId, organizationId),
          eq(managementPersonAccess.unitId, unitId),
          eq(managementPersonAccess.personId, personId),
        ),
      )
      .limit(1);
    if (current?.membershipId && ["active", "suspended"].includes(current.status)) {
      throw new ConflictException({ code: "PERSON_ACCESS_ALREADY_LINKED" });
    }
    if (current?.status === "pending" && !replace) {
      throw new ConflictException({ code: "PERSON_ACCESS_INVITATION_PENDING" });
    }
    if (current?.invitationId) {
      await tx
        .update(membershipInvitations)
        .set({ acceptedAt: new Date() })
        .where(
          and(
            eq(membershipInvitations.id, current.invitationId),
            isNull(membershipInvitations.acceptedAt),
          ),
        );
    }

    const token = randomBytes(32).toString("base64url");
    const expiresAt = new Date(Date.now() + PERSON_ACCESS_INVITATION_TTL_MS);
    const [invitation] = await tx
      .insert(membershipInvitations)
      .values({
        organizationId,
        unitId,
        email: input.email,
        role: input.role,
        tokenHash: personAccessInvitationHash(token),
        invitedByIdentityId: actorIdentityId,
        expiresAt,
      })
      .returning({ id: membershipInvitations.id });
    if (!invitation) throw new Error("Person access invitation was not created");

    const changedAt = new Date();
    const accessValues = {
      email: input.email,
      role: input.role,
      status: "pending" as const,
      invitationId: invitation.id,
      membershipId: null,
      roleBindingId: null,
      statusChangedAt: changedAt,
      statusChangedByIdentityId: actorIdentityId,
      statusChangeReason: replace ? "Convite reenviado." : "Convite enviado.",
      updatedAt: changedAt,
    };
    const [access] = current
      ? await tx
          .update(managementPersonAccess)
          .set(accessValues)
          .where(
            and(
              eq(managementPersonAccess.organizationId, organizationId),
              eq(managementPersonAccess.unitId, unitId),
              eq(managementPersonAccess.personId, personId),
            ),
          )
          .returning()
      : await tx
          .insert(managementPersonAccess)
          .values({ personId, organizationId, unitId, ...accessValues })
          .returning();
    if (!access) throw new Error("Person access was not created");

    const encryption = encryptionKey(process.env.OUTBOX_ENCRYPTION_KEY, "OUTBOX_ENCRYPTION_KEY");
    await tx.insert(outboxEvents).values({
      topic: "membership.invited",
      aggregateType: "membership_invitation",
      aggregateId: invitation.id,
      payload: {
        email: input.email,
        invitationTokenEnvelope: encryptSecret(
          token,
          encryption,
          `membership-invitation:${invitation.id}`,
        ),
        expiresAt: expiresAt.toISOString(),
      },
    });
    await this.record(
      tx,
      actorIdentityId,
      organizationId,
      unitId,
      replace ? "management.person.access.resent" : "management.person.access.invited",
      "person_access",
      personId,
      { invitationId: invitation.id, email: input.email, role: input.role },
    );
    return personAccessView({ ...access, invitationExpiresAt: expiresAt });
  }

  private async lockedPersonAccess(
    tx: Transaction,
    organizationId: string,
    unitId: string,
    personId: string,
  ) {
    await tx.execute(
      sql`select person_id from management_person_access where organization_id=${organizationId}::uuid and unit_id=${unitId}::uuid and person_id=${personId}::uuid for update`,
    );
    const [access] = await tx
      .select()
      .from(managementPersonAccess)
      .where(
        and(
          eq(managementPersonAccess.organizationId, organizationId),
          eq(managementPersonAccess.unitId, unitId),
          eq(managementPersonAccess.personId, personId),
        ),
      )
      .limit(1);
    if (!access) throw new NotFoundException({ code: "PERSON_ACCESS_NOT_FOUND" });
    return access;
  }

  private async ensurePersonRoleBinding(
    tx: Transaction,
    membershipId: string,
    unitId: string,
    role: PersonAccessRole,
  ) {
    const [created] = await tx
      .insert(roleBindings)
      .values({ membershipId, unitId, role })
      .onConflictDoNothing()
      .returning({ id: roleBindings.id });
    if (created) return created.id;
    const [existing] = await tx
      .select({ id: roleBindings.id })
      .from(roleBindings)
      .where(
        and(
          eq(roleBindings.membershipId, membershipId),
          eq(roleBindings.unitId, unitId),
          eq(roleBindings.role, role),
        ),
      )
      .limit(1);
    if (!existing) throw new Error("Person role binding was not created");
    return existing.id;
  }

  private async revokeIdentitySessions(tx: Transaction, identityId: string | null) {
    if (!identityId) return;
    await tx
      .update(authSessions)
      .set({ revokedAt: new Date() })
      .where(and(eq(authSessions.identityId, identityId), isNull(authSessions.revokedAt)));
  }

  private async disableMembershipWithoutRoles(tx: Transaction, membershipId: string | null) {
    if (!membershipId) return;
    const [remaining] = await tx
      .select({ id: roleBindings.id })
      .from(roleBindings)
      .where(eq(roleBindings.membershipId, membershipId))
      .limit(1);
    if (!remaining) {
      await tx
        .update(memberships)
        .set({ status: "disabled", updatedAt: new Date() })
        .where(eq(memberships.id, membershipId));
    }
  }

  private async lockCashShiftById(
    tx: Transaction,
    organizationId: string,
    unitId: string,
    cashShiftId: string,
  ) {
    await tx.execute(
      sql`select id from management_cash_shifts where organization_id=${organizationId}::uuid and unit_id=${unitId}::uuid and id=${cashShiftId}::uuid for update`,
    );
    const [shift] = await tx
      .select()
      .from(managementCashShifts)
      .where(
        and(
          eq(managementCashShifts.organizationId, organizationId),
          eq(managementCashShifts.unitId, unitId),
          eq(managementCashShifts.id, cashShiftId),
        ),
      )
      .limit(1);
    if (!shift)
      throw new NotFoundException({
        code: "CASH_SHIFT_NOT_FOUND",
        message: "Caixa não encontrado nesta unidade.",
      });
    if (shift.status !== "open")
      throw new ConflictException({
        code: "CASH_SHIFT_CLOSED",
        message: "O caixa informado não está aberto.",
      });
    return shift;
  }

  private async requireActiveCashRegister(
    tx: Transaction,
    organizationId: string,
    unitId: string,
    cashRegisterId: string,
  ) {
    await tx.execute(
      sql`select id from management_cash_registers where organization_id=${organizationId}::uuid and unit_id=${unitId}::uuid and id=${cashRegisterId}::uuid for update`,
    );
    const [register] = await tx
      .select()
      .from(managementCashRegisters)
      .where(
        and(
          eq(managementCashRegisters.organizationId, organizationId),
          eq(managementCashRegisters.unitId, unitId),
          eq(managementCashRegisters.id, cashRegisterId),
        ),
      )
      .limit(1);
    if (!register)
      throw new NotFoundException({
        code: "CASH_REGISTER_NOT_FOUND",
        message: "Gaveta não encontrada nesta unidade.",
      });
    if (!register.active)
      throw new ConflictException({
        code: "CASH_REGISTER_INACTIVE",
        message: "A gaveta selecionada está inativa.",
      });
    return register;
  }

  private async lockOpenCashShift(
    tx: Transaction,
    organizationId: string,
    unitId: string,
    selector: { cashShiftId?: string; cashRegisterId?: string } = {},
  ) {
    if (selector.cashShiftId) {
      const shift = await this.lockCashShiftById(tx, organizationId, unitId, selector.cashShiftId);
      if (selector.cashRegisterId && selector.cashRegisterId !== shift.cashRegisterId)
        throw new ConflictException({
          code: "CASH_SHIFT_MISMATCH",
          message: "O turno informado não pertence à gaveta selecionada.",
        });
      return shift;
    }

    if (selector.cashRegisterId) {
      await this.requireActiveCashRegister(tx, organizationId, unitId, selector.cashRegisterId);
      await tx.execute(
        sql`select id from management_cash_shifts where organization_id=${organizationId}::uuid and unit_id=${unitId}::uuid and cash_register_id=${selector.cashRegisterId}::uuid and status='open' for update`,
      );
      const [shift] = await tx
        .select()
        .from(managementCashShifts)
        .where(
          and(
            eq(managementCashShifts.organizationId, organizationId),
            eq(managementCashShifts.unitId, unitId),
            eq(managementCashShifts.cashRegisterId, selector.cashRegisterId),
            eq(managementCashShifts.status, "open"),
          ),
        )
        .limit(1);
      return shift ?? null;
    }

    await tx.execute(
      sql`select id from management_cash_shifts where organization_id=${organizationId}::uuid and unit_id=${unitId}::uuid and status='open' order by id for update`,
    );
    const openShifts = await tx
      .select()
      .from(managementCashShifts)
      .where(
        and(
          eq(managementCashShifts.organizationId, organizationId),
          eq(managementCashShifts.unitId, unitId),
          eq(managementCashShifts.status, "open"),
        ),
      )
      .orderBy(managementCashShifts.id)
      .limit(2);
    if (openShifts.length > 1)
      throw new ConflictException({
        code: "CASH_REGISTER_REQUIRED",
        message: "Selecione a gaveta para registrar este pagamento.",
      });
    return openShifts[0] ?? null;
  }

  private async cashDrawerTotals(
    tx: Transaction | Database,
    organizationId: string,
    unitId: string,
    cashShiftId: string,
  ) {
    const [totals] = await tx
      .select({
        drawerInCents: sql<number>`coalesce(sum(case when ${managementCashEntries.affectsDrawer} and ${managementCashEntries.direction} = 'in' then ${managementCashEntries.amountCents} else 0 end), 0)::integer`,
        drawerOutCents: sql<number>`coalesce(sum(case when ${managementCashEntries.affectsDrawer} and ${managementCashEntries.direction} = 'out' then ${managementCashEntries.amountCents} else 0 end), 0)::integer`,
      })
      .from(managementCashEntries)
      .where(
        and(
          eq(managementCashEntries.organizationId, organizationId),
          eq(managementCashEntries.unitId, unitId),
          eq(managementCashEntries.cashShiftId, cashShiftId),
        ),
      );
    return {
      drawerInCents: Number(totals?.drawerInCents ?? 0),
      drawerOutCents: Number(totals?.drawerOutCents ?? 0),
    };
  }

  private async cashSettings(
    source: Transaction | Database,
    organizationId: string,
    unitId: string,
  ) {
    const [settings] = await source
      .select({
        movementApprovalThresholdCents: managementCashSettings.movementApprovalThresholdCents,
        discrepancyCriticalThresholdCents: managementCashSettings.discrepancyCriticalThresholdCents,
        maxShiftMinutes: managementCashSettings.maxShiftMinutes,
      })
      .from(managementCashSettings)
      .where(
        and(
          eq(managementCashSettings.organizationId, organizationId),
          eq(managementCashSettings.unitId, unitId),
        ),
      )
      .limit(1);
    return settings ?? DEFAULT_CASH_SETTINGS;
  }

  private async executeCashMovement(
    tx: Transaction,
    actorIdentityId: string,
    organizationId: string,
    unitId: string,
    cashShiftId: string,
    idempotencyKey: string,
    input: CashMovementInput,
  ) {
    const shift = await this.lockCashShiftById(tx, organizationId, unitId, cashShiftId);
    if (input.type === "withdrawal") {
      const drawer = await this.cashDrawerTotals(tx, organizationId, unitId, shift.id);
      assertCashDrawerDebit(
        shift.openingCents + drawer.drawerInCents - drawer.drawerOutCents,
        input.amountCents,
      );
    }
    const movementId = randomUUID();
    const occurredAt = input.occurredAt ? new Date(input.occurredAt) : new Date();
    await tx.insert(managementCashMovements).values({
      id: movementId,
      organizationId,
      unitId,
      cashShiftId,
      ...input,
      idempotencyKey,
      actorIdentityId,
      occurredAt,
    });
    await tx.insert(managementCashEntries).values({
      organizationId,
      unitId,
      cashShiftId,
      direction: input.type === "supply" ? "in" : "out",
      entryType: input.type,
      paymentMethod: null,
      affectsDrawer: true,
      amountCents: input.amountCents,
      sourceType: "cash_movement",
      sourceId: movementId,
      description: input.reason,
      actorIdentityId,
      occurredAt,
    });
    await this.record(
      tx,
      actorIdentityId,
      organizationId,
      unitId,
      `management.cash.${input.type}`,
      "cash_shift",
      cashShiftId,
      { movementId, amountCents: input.amountCents, reason: input.reason },
    );
    return { movementId, cashShiftId, type: input.type, amountCents: input.amountCents };
  }

  private async executeCashTransfer(
    tx: Transaction,
    actorIdentityId: string,
    organizationId: string,
    unitId: string,
    idempotencyKey: string,
    input: CashTransferInput,
  ) {
    const lockOrder = cashTransferLockOrder(input.fromCashShiftId, input.toCashShiftId);
    const lockedShifts = [];
    for (const cashShiftId of lockOrder)
      lockedShifts.push(await this.lockCashShiftById(tx, organizationId, unitId, cashShiftId));
    const fromShift = lockedShifts.find((shift) => shift.id === input.fromCashShiftId);
    const toShift = lockedShifts.find((shift) => shift.id === input.toCashShiftId);
    if (!fromShift || !toShift)
      throw new ConflictException({ code: "CASH_TRANSFER_SHIFT_LOCK_FAILED" });
    if (fromShift.cashRegisterId === toShift.cashRegisterId)
      throw new ConflictException({
        code: "CASH_TRANSFER_SAME_REGISTER",
        message: "Origem e destino devem ser gavetas diferentes.",
      });
    const drawer = await this.cashDrawerTotals(tx, organizationId, unitId, fromShift.id);
    assertCashDrawerDebit(
      fromShift.openingCents + drawer.drawerInCents - drawer.drawerOutCents,
      input.amountCents,
    );

    const transferId = randomUUID();
    const occurredAt = new Date();
    await tx.insert(managementCashTransfers).values({
      id: transferId,
      organizationId,
      unitId,
      fromCashShiftId: fromShift.id,
      toCashShiftId: toShift.id,
      amountCents: input.amountCents,
      reason: input.reason,
      transferredByIdentityId: actorIdentityId,
      occurredAt,
      idempotencyKey,
    });
    await tx.insert(managementCashEntries).values([
      {
        organizationId,
        unitId,
        cashShiftId: fromShift.id,
        direction: "out",
        entryType: "transfer_out",
        paymentMethod: null,
        affectsDrawer: true,
        amountCents: input.amountCents,
        sourceType: "cash_transfer_out",
        sourceId: transferId,
        description: input.reason,
        actorIdentityId,
        occurredAt,
      },
      {
        organizationId,
        unitId,
        cashShiftId: toShift.id,
        direction: "in",
        entryType: "transfer_in",
        paymentMethod: null,
        affectsDrawer: true,
        amountCents: input.amountCents,
        sourceType: "cash_transfer_in",
        sourceId: transferId,
        description: input.reason,
        actorIdentityId,
        occurredAt,
      },
    ]);
    await this.record(
      tx,
      actorIdentityId,
      organizationId,
      unitId,
      "management.cash.transferred",
      "cash_transfer",
      transferId,
      {
        fromCashShiftId: fromShift.id,
        toCashShiftId: toShift.id,
        amountCents: input.amountCents,
        reason: input.reason,
      },
    );
    return {
      transferId,
      fromCashShiftId: fromShift.id,
      toCashShiftId: toShift.id,
      amountCents: input.amountCents,
      occurredAt: occurredAt.toISOString(),
    };
  }

  async updateOverviewPriority(
    actorIdentityId: string,
    organizationId: string,
    unitId: string,
    idempotencyKey: string,
    priorityId: string,
    input: OverviewPriorityActionInput,
  ) {
    await this.scope.requireUnitAccess(actorIdentityId, organizationId, unitId);
    return this.idempotent(
      actorIdentityId,
      organizationId,
      unitId,
      idempotencyKey,
      "overview-priority-action",
      { priorityId, ...input },
      async (tx) => {
        const now = new Date();
        const status =
          input.action === "claim"
            ? ("claimed" as const)
            : input.action === "snooze"
              ? ("snoozed" as const)
              : ("resolved" as const);
        const snoozedUntil =
          input.action === "snooze"
            ? new Date(now.getTime() + (input.snoozeMinutes ?? 15) * 60_000)
            : null;
        const assignedToIdentityId = input.action === "snooze" ? null : actorIdentityId;
        const [state] = await tx
          .insert(managementOverviewPriorityStates)
          .values({
            organizationId,
            unitId,
            priorityId,
            occurrenceKey: input.occurrenceKey,
            status,
            assignedToIdentityId,
            snoozedUntil,
            updatedByIdentityId: actorIdentityId,
            updatedAt: now,
          })
          .onConflictDoUpdate({
            target: [
              managementOverviewPriorityStates.organizationId,
              managementOverviewPriorityStates.unitId,
              managementOverviewPriorityStates.priorityId,
              managementOverviewPriorityStates.occurrenceKey,
            ],
            set: {
              status,
              assignedToIdentityId,
              snoozedUntil,
              updatedByIdentityId: actorIdentityId,
              updatedAt: now,
            },
          })
          .returning({ id: managementOverviewPriorityStates.id });
        const entityId = state?.id ?? `${priorityId}:${input.occurrenceKey}`;
        await this.record(
          tx,
          actorIdentityId,
          organizationId,
          unitId,
          `management.overview.priority-${
            { claim: "claimed", resolve: "resolved", snooze: "snoozed" }[input.action]
          }`,
          "overview_priority",
          entityId,
          { priorityId, occurrenceKey: input.occurrenceKey, status, snoozedUntil },
        );
        return {
          priorityId,
          occurrenceKey: input.occurrenceKey,
          status,
          assignedToIdentityId,
          snoozedUntil: snoozedUntil?.toISOString() ?? null,
        };
      },
    );
  }

  async updateOverviewPreferences(
    actorIdentityId: string,
    organizationId: string,
    unitId: string,
    idempotencyKey: string,
    input: OverviewPreferencesInput,
  ) {
    await this.scope.requireUnitAccess(actorIdentityId, organizationId, unitId);
    return this.idempotent(
      actorIdentityId,
      organizationId,
      unitId,
      idempotencyKey,
      "overview-preferences-update",
      input,
      async (tx) => {
        const now = new Date();
        await tx
          .insert(managementOverviewPreferences)
          .values({
            organizationId,
            unitId,
            identityId: actorIdentityId,
            ...input,
            updatedAt: now,
          })
          .onConflictDoUpdate({
            target: [
              managementOverviewPreferences.organizationId,
              managementOverviewPreferences.unitId,
              managementOverviewPreferences.identityId,
            ],
            set: { ...input, updatedAt: now },
          });
        await this.record(
          tx,
          actorIdentityId,
          organizationId,
          unitId,
          "management.overview.preferences-updated",
          "overview_preferences",
          actorIdentityId,
          { minimumTone: input.minimumTone, digestMinutes: input.digestMinutes },
        );
        return { ...input, updatedAt: now.toISOString() };
      },
    );
  }

  async markOverviewVisited(
    actorIdentityId: string,
    organizationId: string,
    unitId: string,
    idempotencyKey: string,
  ) {
    await this.scope.requireUnitAccess(actorIdentityId, organizationId, unitId);
    return this.idempotent(
      actorIdentityId,
      organizationId,
      unitId,
      idempotencyKey,
      "overview-visited",
      {},
      async (tx) => {
        const visitedAt = new Date();
        await tx
          .insert(managementOverviewPreferences)
          .values({ organizationId, unitId, identityId: actorIdentityId, lastVisitedAt: visitedAt })
          .onConflictDoUpdate({
            target: [
              managementOverviewPreferences.organizationId,
              managementOverviewPreferences.unitId,
              managementOverviewPreferences.identityId,
            ],
            set: { lastVisitedAt: visitedAt, updatedAt: visitedAt },
          });
        return { visitedAt: visitedAt.toISOString() };
      },
    );
  }

  private async requireTimeTrackingReadRole(
    identityId: string,
    organizationId: string,
    unitId: string,
  ) {
    await this.scope.requireUnitAccess(identityId, organizationId, unitId);
    const rows = await this.scope.requireOrganizationRole(
      identityId,
      organizationId,
      TIME_TRACKING_READ_ROLES,
    );
    const role = TIME_TRACKING_READ_ROLES.find((candidate) =>
      rows.some((row) => row.role === candidate && (row.unitId === null || row.unitId === unitId)),
    );
    if (!role) {
      throw new ForbiddenException({
        code: "TIME_TRACKING_READ_DENIED",
        message: "Você não tem acesso aos registros de ponto desta unidade.",
      });
    }
    return role;
  }

  private async requireTimeTrackingReadAccess(
    identityId: string,
    organizationId: string,
    unitId: string,
  ) {
    const role = await this.requireTimeTrackingReadRole(identityId, organizationId, unitId);
    const settings = await this.timeTrackingSettings(this.database.db, organizationId, unitId);
    assertTimeTrackingReadPolicy(role, settings);
    return { role, settings };
  }

  private async timeTrackingSettings(
    source: Transaction | Database,
    organizationId: string,
    unitId: string,
  ) {
    const [settings] = await source
      .select()
      .from(managementTimeTrackingSettings)
      .where(
        and(
          eq(managementTimeTrackingSettings.organizationId, organizationId),
          eq(managementTimeTrackingSettings.unitId, unitId),
        ),
      )
      .limit(1);
    return settings ?? DEFAULT_TIME_TRACKING_SETTINGS;
  }

  private async employeeForIdentity(
    source: Transaction | Database,
    identityId: string,
    organizationId: string,
    unitId: string,
  ) {
    const [person] = await source
      .select()
      .from(managementPeople)
      .where(
        and(
          eq(managementPeople.organizationId, organizationId),
          eq(managementPeople.unitId, unitId),
          eq(managementPeople.identityId, identityId),
        ),
      )
      .limit(1);
    return person ?? null;
  }

  private async assertPunchEligibility(
    source: Transaction | Database,
    identityId: string,
    organizationId: string,
    unitId: string,
  ) {
    const person = await this.employeeForIdentity(source, identityId, organizationId, unitId);
    if (!person?.active) {
      throw new ForbiddenException({
        code: "TIME_TRACKING_EMPLOYEE_INACTIVE",
        message: "Apenas funcionários ativos e vinculados à sua conta podem registrar ponto.",
      });
    }
    const settings = await this.timeTrackingSettings(source, organizationId, unitId);
    if (settings.mode === "off") {
      throw new ForbiddenException({
        code: "TIME_TRACKING_DISABLED",
        message: "O ponto está desativado nesta unidade.",
      });
    }
    if (settings.mode === "selected") {
      const [assignment] = await source
        .select({ enabled: managementTimeTrackingAssignments.enabled })
        .from(managementTimeTrackingAssignments)
        .where(
          and(
            eq(managementTimeTrackingAssignments.organizationId, organizationId),
            eq(managementTimeTrackingAssignments.unitId, unitId),
            eq(managementTimeTrackingAssignments.personId, person.id),
            eq(managementTimeTrackingAssignments.enabled, true),
          ),
        )
        .limit(1);
      if (!assignment) {
        throw new ForbiddenException({
          code: "TIME_TRACKING_NOT_ASSIGNED",
          message: "O ponto não está habilitado para este funcionário.",
        });
      }
    }
    return { person, settings };
  }

  private assertGeofence(
    settings:
      | typeof DEFAULT_TIME_TRACKING_SETTINGS
      | typeof managementTimeTrackingSettings.$inferSelect,
    location: PunchLocationInput,
  ) {
    if (!settings.geofenceEnabled) return { flags: [], locationLabel: null };
    const configuredLocations = [
      settings.latitude === null || settings.longitude === null
        ? null
        : {
            label: settings.locationLabel ?? "Local principal",
            latitude: settings.latitude,
            longitude: settings.longitude,
            radiusMeters: settings.radiusMeters,
            accuracyToleranceMeters: settings.accuracyToleranceMeters,
          },
      ...settings.additionalLocations,
    ].filter(
      (
        candidate,
      ): candidate is {
        label: string;
        latitude: number;
        longitude: number;
        radiusMeters: number;
        accuracyToleranceMeters: number;
      } => candidate !== null,
    );
    if (configuredLocations.length === 0) {
      throw new ConflictException({
        code: "TIME_TRACKING_LOCATION_NOT_CONFIGURED",
        message: "Configure a localização da unidade antes de registrar o ponto.",
      });
    }
    const flags: string[] = [];
    if (location.accuracyMeters === undefined) flags.push("missing_location_accuracy");
    if (
      location.accuracyMeters !== undefined &&
      location.accuracyMeters > settings.maxLocationAccuracyMeters
    ) {
      if (settings.lowAccuracyPolicy === "block") {
        throw new ForbiddenException({
          code: "TIME_TRACKING_LOCATION_ACCURACY_TOO_LOW",
          message: `A precisão do GPS (${location.accuracyMeters} m) está acima do limite de ${settings.maxLocationAccuracyMeters} m configurado para esta unidade.`,
          details: {
            accuracyMeters: location.accuracyMeters,
            maximumAccuracyMeters: settings.maxLocationAccuracyMeters,
          },
        });
      }
      flags.push("low_location_accuracy");
    }
    const candidates = configuredLocations.map((configured) => {
      const distance = distanceMeters(
        configured.latitude,
        configured.longitude,
        location.latitude,
        location.longitude,
      );
      const allowedDistance = configured.radiusMeters + configured.accuracyToleranceMeters;
      return { ...configured, distance, allowedDistance };
    });
    const match = candidates.find((candidate) => candidate.distance <= candidate.allowedDistance);
    if (!match) {
      const closest = candidates.reduce((previous, candidate) =>
        candidate.distance < previous.distance ? candidate : previous,
      );
      throw new ForbiddenException({
        code: "TIME_TRACKING_OUTSIDE_GEOFENCE",
        message: `Você está a aproximadamente ${Math.round(closest.distance)} m do local permitido mais próximo. A marcação exige estar no raio configurado.`,
        details: {
          distanceMeters: Math.round(closest.distance),
          allowedDistanceMeters: closest.allowedDistance,
        },
      });
    }
    return {
      flags,
      locationLabel: match.label,
      distanceMeters: Math.round(match.distance),
      allowedDistanceMeters: match.allowedDistance,
    };
  }

  private async idempotent<T extends JsonResponse>(
    actorIdentityId: string,
    organizationId: string,
    unitId: string,
    key: string | undefined,
    operation: string,
    payload: unknown,
    work: (tx: Transaction) => Promise<T>,
  ): Promise<T & { idempotentReplay: boolean }> {
    const normalizedKey = normalizeIdempotencyKey(key);
    const payloadHash = managementRequestHash(operation, payload);
    return this.database.db.transaction(async (tx) => {
      await tx.execute(
        sql`select pg_advisory_xact_lock(hashtext(${`management:${organizationId}:${unitId}:${operation}:${normalizedKey}`}))`,
      );
      const [existing] = await tx
        .select({
          payloadHash: managementIdempotency.payloadHash,
          response: managementIdempotency.response,
        })
        .from(managementIdempotency)
        .where(
          and(
            eq(managementIdempotency.organizationId, organizationId),
            eq(managementIdempotency.unitId, unitId),
            eq(managementIdempotency.operation, operation),
            eq(managementIdempotency.idempotencyKey, normalizedKey),
          ),
        )
        .limit(1);
      if (existing) {
        const replay = managementReplay<T>(existing, payloadHash);
        if (replay) return replay;
      }
      const response = await work(tx);
      const stored = JSON.parse(JSON.stringify(response)) as T;
      await tx.insert(managementIdempotency).values({
        organizationId,
        unitId,
        actorIdentityId,
        operation,
        idempotencyKey: normalizedKey,
        payloadHash,
        response: stored,
      });
      return { ...stored, idempotentReplay: false };
    });
  }

  private async record(
    tx: Transaction,
    actorIdentityId: string,
    organizationId: string,
    unitId: string,
    action: string,
    entityType: string,
    entityId: string,
    metadata: Record<string, unknown>,
  ) {
    await tx
      .insert(auditEvents)
      .values({ organizationId, unitId, actorIdentityId, action, entityType, entityId, metadata });
    await tx.insert(outboxEvents).values({
      topic: action,
      aggregateType: entityType,
      aggregateId: entityId,
      payload: { organizationId, unitId, actorIdentityId, ...metadata },
    });
  }

  private async enqueueTimeTrackingAlert(
    tx: Transaction,
    organizationId: string,
    unitId: string,
    actorIdentityId: string,
    timeEntryId: string,
    flags: string[],
    settings: Pick<
      typeof DEFAULT_TIME_TRACKING_SETTINGS,
      "emailAlertsEnabled" | "managerAlertOnAnomaly" | "managerCanView"
    >,
  ) {
    if (flags.length === 0 || !settings.emailAlertsEnabled) return;
    await tx.insert(outboxEvents).values({
      topic: "management.time-tracking.alert",
      aggregateType: "time_entry",
      aggregateId: timeEntryId,
      payload: {
        organizationId,
        unitId,
        actorIdentityId,
        flags,
        includeManagers: settings.managerCanView && settings.managerAlertOnAnomaly,
      },
    });
  }

  private async requireProduct(tx: Transaction, organizationId: string, productId: string) {
    const [product] = await tx
      .select({ id: posProducts.id })
      .from(posProducts)
      .where(
        and(
          eq(posProducts.organizationId, organizationId),
          eq(posProducts.id, productId),
          eq(posProducts.active, true),
        ),
      )
      .limit(1);
    if (!product)
      throw new NotFoundException({
        code: "PRODUCT_NOT_FOUND",
        message: "Produto não encontrado nesta organização.",
      });
  }

  private async requireSupplier(
    tx: Transaction,
    organizationId: string,
    unitId: string,
    supplierId: string,
  ) {
    const [supplier] = await tx
      .select({ id: managementSuppliers.id })
      .from(managementSuppliers)
      .where(
        and(
          eq(managementSuppliers.organizationId, organizationId),
          eq(managementSuppliers.unitId, unitId),
          eq(managementSuppliers.id, supplierId),
          eq(managementSuppliers.active, true),
        ),
      )
      .limit(1);
    if (!supplier)
      throw new NotFoundException({
        code: "SUPPLIER_NOT_FOUND",
        message: "Fornecedor não encontrado nesta unidade.",
      });
  }

  private async requireOrder(
    tx: Transaction,
    organizationId: string,
    unitId: string,
    orderId: string,
  ) {
    const [order] = await tx
      .select({ id: posOrders.id })
      .from(posOrders)
      .where(
        and(
          eq(posOrders.organizationId, organizationId),
          eq(posOrders.unitId, unitId),
          eq(posOrders.id, orderId),
        ),
      )
      .limit(1);
    if (!order)
      throw new NotFoundException({
        code: "ORDER_NOT_FOUND",
        message: "Pedido não encontrado nesta unidade.",
      });
  }

  private async requireInventoryItem(
    tx: Transaction,
    organizationId: string,
    unitId: string,
    inventoryItemId: string,
    kinds?: readonly ("ingredient" | "prepared" | "resale" | "reusable" | "returnable_container")[],
  ) {
    const [item] = await tx
      .select()
      .from(managementInventoryItems)
      .where(
        and(
          eq(managementInventoryItems.organizationId, organizationId),
          eq(managementInventoryItems.unitId, unitId),
          eq(managementInventoryItems.id, inventoryItemId),
          eq(managementInventoryItems.active, true),
        ),
      )
      .limit(1);
    if (!item || (kinds && !kinds.includes(item.kind)))
      throw new NotFoundException({
        code: "INVENTORY_ITEM_NOT_FOUND",
        message: "Item de estoque ativo não encontrado nesta unidade.",
      });
    return item;
  }

  private async applyStockMovement(
    tx: Transaction,
    organizationId: string,
    unitId: string,
    input: {
      locationId: string;
      inventoryItemId: string;
      lotId?: string | null;
      quantityDeltaMilli: number;
      unitCostCents?: number | null;
      type: string;
      sourceType: string;
      sourceId: string;
      actorIdentityId: string;
      occurredAt?: Date;
    },
  ) {
    const item = await this.requireInventoryItem(tx, organizationId, unitId, input.inventoryItemId);
    const [location] = await tx
      .select({ id: managementStockLocations.id })
      .from(managementStockLocations)
      .where(
        and(
          eq(managementStockLocations.organizationId, organizationId),
          eq(managementStockLocations.unitId, unitId),
          eq(managementStockLocations.id, input.locationId),
          eq(managementStockLocations.active, true),
        ),
      )
      .limit(1);
    if (!location)
      throw new NotFoundException({
        code: "STOCK_LOCATION_NOT_FOUND",
        message: "Local de estoque ativo não encontrado nesta unidade.",
      });
    await tx
      .insert(managementStockBalances)
      .values({ organizationId, unitId, locationId: input.locationId, inventoryItemId: item.id })
      .onConflictDoNothing({
        target: [
          managementStockBalances.organizationId,
          managementStockBalances.unitId,
          managementStockBalances.locationId,
          managementStockBalances.inventoryItemId,
        ],
      });
    await tx.execute(
      sql`select id from management_stock_balances where organization_id=${organizationId}::uuid and unit_id=${unitId}::uuid and location_id=${input.locationId}::uuid and inventory_item_id=${item.id}::uuid for update`,
    );
    const [balance] = await tx
      .select()
      .from(managementStockBalances)
      .where(
        and(
          eq(managementStockBalances.organizationId, organizationId),
          eq(managementStockBalances.unitId, unitId),
          eq(managementStockBalances.locationId, input.locationId),
          eq(managementStockBalances.inventoryItemId, item.id),
        ),
      )
      .limit(1);
    if (!balance) throw new ConflictException("Não foi possível bloquear o saldo.");
    const previousMilli = quantityToMilli(balance.quantity);
    const resultingMilli = previousMilli + input.quantityDeltaMilli;
    if (resultingMilli < 0 && !item.allowNegative)
      throw new ConflictException({
        code: "NEGATIVE_STOCK_BLOCKED",
        message: "A operação deixaria o estoque negativo.",
      });
    if (input.lotId) {
      await tx.execute(
        sql`select id from management_inventory_lots where organization_id=${organizationId}::uuid and unit_id=${unitId}::uuid and id=${input.lotId}::uuid for update`,
      );
      const [lot] = await tx
        .select()
        .from(managementInventoryLots)
        .where(
          and(
            eq(managementInventoryLots.organizationId, organizationId),
            eq(managementInventoryLots.unitId, unitId),
            eq(managementInventoryLots.id, input.lotId),
            eq(managementInventoryLots.locationId, input.locationId),
            eq(managementInventoryLots.inventoryItemId, input.inventoryItemId),
            eq(managementInventoryLots.active, true),
          ),
        )
        .limit(1);
      if (!lot)
        throw new NotFoundException({
          code: "INVENTORY_LOT_NOT_FOUND",
          message: "Lote ativo não encontrado para este item e local.",
        });
      const resultingLotMilli = quantityToMilli(lot.quantity) + input.quantityDeltaMilli;
      if (resultingLotMilli < 0)
        throw new ConflictException({
          code: "INVENTORY_LOT_INSUFFICIENT",
          message: "O lote selecionado não possui quantidade suficiente.",
        });
      await tx
        .update(managementInventoryLots)
        .set({ quantity: milliToQuantity(resultingLotMilli), updatedAt: new Date() })
        .where(eq(managementInventoryLots.id, lot.id));
    }
    let averageCostCents = balance.averageCostCents;
    if (
      input.quantityDeltaMilli > 0 &&
      input.unitCostCents !== undefined &&
      input.unitCostCents !== null
    )
      averageCostCents =
        previousMilli > 0
          ? Math.round(
              (previousMilli * (balance.averageCostCents ?? input.unitCostCents) +
                input.quantityDeltaMilli * input.unitCostCents) /
                resultingMilli,
            )
          : input.unitCostCents;
    await tx.insert(managementInventoryMovements).values({
      organizationId,
      unitId,
      locationId: input.locationId,
      inventoryItemId: item.id,
      lotId: input.lotId,
      type: input.type,
      quantityDelta: milliToQuantity(input.quantityDeltaMilli),
      unitCostCents: input.unitCostCents,
      sourceType: input.sourceType,
      sourceId: input.sourceId,
      actorIdentityId: input.actorIdentityId,
      occurredAt: input.occurredAt,
    });
    await tx
      .update(managementStockBalances)
      .set({
        quantity: milliToQuantity(resultingMilli),
        averageCostCents,
        version: balance.version + 1,
        updatedAt: new Date(),
      })
      .where(eq(managementStockBalances.id, balance.id));
    return { previousMilli, resultingMilli, averageCostCents };
  }

  private async inventoryPlanningSnapshot(
    identityId: string,
    organizationId: string,
    unitId: string,
  ) {
    const roleRows = await this.scope.requireOrganizationRole(
      identityId,
      organizationId,
      INVENTORY_ROLES,
    );
    const globalAccess = roleRows.some(
      (row) => row.unitId === null && INVENTORY_ROLES.some((role) => role === row.role),
    );
    const authorizedUnitIds = globalAccess
      ? null
      : [
          ...new Set([
            unitId,
            ...roleRows
              .filter((row) => INVENTORY_ROLES.some((role) => role === row.role))
              .flatMap((row) => (row.unitId ? [row.unitId] : [])),
          ]),
        ];
    const since = new Date(Date.now() - 56 * 86_400_000);
    const [
      reservations,
      countSchedules,
      productionBatches,
      productionInputs,
      interunitTransfers,
      interunitLines,
      closings,
      organizationUnits,
      balances,
      items,
      dailyUsage,
      openPurchases,
      purchaseRows,
      invoiceRows,
      suppliers,
      destinationItems,
      destinationLocations,
    ] = await Promise.all([
      this.database.db
        .select()
        .from(managementInventoryReservations)
        .where(
          and(
            eq(managementInventoryReservations.organizationId, organizationId),
            eq(managementInventoryReservations.unitId, unitId),
          ),
        )
        .orderBy(desc(managementInventoryReservations.createdAt))
        .limit(300),
      this.database.db
        .select()
        .from(managementInventoryCountSchedules)
        .where(
          and(
            eq(managementInventoryCountSchedules.organizationId, organizationId),
            eq(managementInventoryCountSchedules.unitId, unitId),
            eq(managementInventoryCountSchedules.active, true),
          ),
        )
        .orderBy(managementInventoryCountSchedules.nextDueAt),
      this.database.db
        .select()
        .from(managementProductionBatches)
        .where(
          and(
            eq(managementProductionBatches.organizationId, organizationId),
            eq(managementProductionBatches.unitId, unitId),
          ),
        )
        .orderBy(desc(managementProductionBatches.createdAt))
        .limit(200),
      this.database.db
        .select()
        .from(managementProductionBatchInputs)
        .where(
          and(
            eq(managementProductionBatchInputs.organizationId, organizationId),
            eq(managementProductionBatchInputs.unitId, unitId),
          ),
        ),
      this.database.db
        .select()
        .from(managementInterunitTransfers)
        .where(
          and(
            eq(managementInterunitTransfers.organizationId, organizationId),
            or(
              eq(managementInterunitTransfers.sourceUnitId, unitId),
              eq(managementInterunitTransfers.destinationUnitId, unitId),
            ),
          ),
        )
        .orderBy(desc(managementInterunitTransfers.sentAt))
        .limit(200),
      this.database.db
        .select()
        .from(managementInterunitTransferLines)
        .where(eq(managementInterunitTransferLines.organizationId, organizationId)),
      this.database.db
        .select()
        .from(managementInventoryClosings)
        .where(
          and(
            eq(managementInventoryClosings.organizationId, organizationId),
            eq(managementInventoryClosings.unitId, unitId),
          ),
        )
        .orderBy(desc(managementInventoryClosings.period))
        .limit(24),
      this.database.db
        .select({ id: units.id, name: units.name })
        .from(units)
        .where(eq(units.organizationId, organizationId))
        .orderBy(units.name),
      this.database.db
        .select()
        .from(managementStockBalances)
        .where(
          and(
            eq(managementStockBalances.organizationId, organizationId),
            eq(managementStockBalances.unitId, unitId),
          ),
        ),
      this.database.db
        .select()
        .from(managementInventoryItems)
        .where(
          and(
            eq(managementInventoryItems.organizationId, organizationId),
            eq(managementInventoryItems.unitId, unitId),
            eq(managementInventoryItems.active, true),
          ),
        ),
      this.database.db
        .select({
          inventoryItemId: managementInventoryMovements.inventoryItemId,
          date: sql<string>`to_char(date_trunc('day', ${managementInventoryMovements.occurredAt}), 'YYYY-MM-DD')`,
          quantity: sql<string>`sum(abs(${managementInventoryMovements.quantityDelta}))`.mapWith(
            String,
          ),
        })
        .from(managementInventoryMovements)
        .where(
          and(
            eq(managementInventoryMovements.organizationId, organizationId),
            eq(managementInventoryMovements.unitId, unitId),
            gte(managementInventoryMovements.occurredAt, since),
            sql`${managementInventoryMovements.quantityDelta} < 0`,
            inArray(managementInventoryMovements.type, [
              "sale_consumption",
              "production_input",
              "reservation_consumption",
            ]),
          ),
        )
        .groupBy(
          managementInventoryMovements.inventoryItemId,
          sql`date_trunc('day', ${managementInventoryMovements.occurredAt})`,
        ),
      this.database.db
        .select({
          inventoryItemId: managementPurchaseOrderItems.inventoryItemId,
          quantity:
            sql<string>`coalesce(sum((${managementPurchaseOrderItems.quantity} - ${managementPurchaseOrderItems.receivedQuantity}) * ${managementPurchaseOrderItems.purchaseToStockFactor}), 0)`.mapWith(
              String,
            ),
        })
        .from(managementPurchaseOrderItems)
        .innerJoin(
          managementPurchaseOrders,
          eq(managementPurchaseOrderItems.purchaseOrderId, managementPurchaseOrders.id),
        )
        .where(
          and(
            eq(managementPurchaseOrderItems.organizationId, organizationId),
            eq(managementPurchaseOrderItems.unitId, unitId),
            inArray(managementPurchaseOrders.status, ["approved", "partially_received"]),
          ),
        )
        .groupBy(managementPurchaseOrderItems.inventoryItemId),
      this.database.db
        .select({
          supplierId: managementPurchaseOrders.supplierId,
          status: managementPurchaseOrders.status,
          expectedAt: managementPurchaseOrders.expectedAt,
          createdAt: managementPurchaseOrders.createdAt,
          updatedAt: managementPurchaseOrders.updatedAt,
          quantity: managementPurchaseOrderItems.quantity,
          receivedQuantity: managementPurchaseOrderItems.receivedQuantity,
          unitCostCents: managementPurchaseOrderItems.unitCostCents,
        })
        .from(managementPurchaseOrders)
        .innerJoin(
          managementPurchaseOrderItems,
          eq(managementPurchaseOrderItems.purchaseOrderId, managementPurchaseOrders.id),
        )
        .where(
          and(
            eq(managementPurchaseOrders.organizationId, organizationId),
            eq(managementPurchaseOrders.unitId, unitId),
          ),
        ),
      this.database.db
        .select({
          supplierId: managementSupplierInvoices.supplierId,
          status: managementSupplierInvoices.status,
        })
        .from(managementSupplierInvoices)
        .where(
          and(
            eq(managementSupplierInvoices.organizationId, organizationId),
            eq(managementSupplierInvoices.unitId, unitId),
          ),
        ),
      this.database.db
        .select({ id: managementSuppliers.id, name: managementSuppliers.name })
        .from(managementSuppliers)
        .where(
          and(
            eq(managementSuppliers.organizationId, organizationId),
            eq(managementSuppliers.unitId, unitId),
            eq(managementSuppliers.active, true),
          ),
        ),
      this.database.db
        .select({
          id: managementInventoryItems.id,
          unitId: managementInventoryItems.unitId,
          name: managementInventoryItems.name,
          sku: managementInventoryItems.sku,
          barcode: managementInventoryItems.barcode,
        })
        .from(managementInventoryItems)
        .where(
          and(
            eq(managementInventoryItems.organizationId, organizationId),
            eq(managementInventoryItems.active, true),
            ...(authorizedUnitIds
              ? [inArray(managementInventoryItems.unitId, authorizedUnitIds)]
              : []),
          ),
        )
        .orderBy(managementInventoryItems.name),
      this.database.db
        .select({
          id: managementStockLocations.id,
          unitId: managementStockLocations.unitId,
          name: managementStockLocations.name,
        })
        .from(managementStockLocations)
        .where(
          and(
            eq(managementStockLocations.organizationId, organizationId),
            eq(managementStockLocations.active, true),
            ...(authorizedUnitIds
              ? [inArray(managementStockLocations.unitId, authorizedUnitIds)]
              : []),
          ),
        )
        .orderBy(managementStockLocations.name),
    ]);
    const activeReservations = reservations.filter(
      (reservation) =>
        reservation.status === "active" &&
        (!reservation.expiresAt || reservation.expiresAt.getTime() > Date.now()),
    );
    const reservedByItem = new Map<string, number>();
    for (const reservation of activeReservations)
      reservedByItem.set(
        reservation.inventoryItemId,
        (reservedByItem.get(reservation.inventoryItemId) ?? 0) + Number(reservation.quantity),
      );
    const balanceByItem = new Map<string, number>();
    for (const balance of balances)
      balanceByItem.set(
        balance.inventoryItemId,
        (balanceByItem.get(balance.inventoryItemId) ?? 0) + Number(balance.quantity),
      );
    const outstandingByItem = new Map(
      openPurchases.map((row) => [row.inventoryItemId, Number(row.quantity)]),
    );
    const forecasts = items.map((item) => {
      const forecast = forecastInventoryDemand({
        dailyUsage: dailyUsage
          .filter((row) => row.inventoryItemId === item.id)
          .map((row) => ({ date: row.date, quantity: Number(row.quantity) })),
        horizonDays: Math.max(7, item.leadTimeDays + 7),
        currentQuantity: balanceByItem.get(item.id) ?? 0,
        reservedQuantity: reservedByItem.get(item.id) ?? 0,
        outstandingPurchaseQuantity: outstandingByItem.get(item.id) ?? 0,
      });
      return {
        inventoryItemId: item.id,
        horizonDays: Math.max(7, item.leadTimeDays + 7),
        expectedDemand: forecast.forecastQuantity,
        suggestedPurchaseQuantity: forecast.netRequiredQuantity,
        projectedAvailableQuantity: forecast.availableQuantity,
      };
    });
    const supplierMetrics = suppliers.map((supplier) => {
      const orders = purchaseRows.filter((row) => row.supplierId === supplier.id);
      const invoices = invoiceRows.filter((row) => row.supplierId === supplier.id);
      const completed = orders.filter((row) =>
        ["received", "partially_received"].includes(row.status),
      );
      const currentCosts = orders.filter(
        (row) => row.createdAt.getTime() >= Date.now() - 30 * 86_400_000,
      );
      const previousCosts = orders.filter(
        (row) =>
          row.createdAt.getTime() < Date.now() - 30 * 86_400_000 &&
          row.createdAt.getTime() >= Date.now() - 60 * 86_400_000,
      );
      const average = (rows: typeof orders) =>
        rows.length
          ? Math.round(rows.reduce((total, row) => total + row.unitCostCents, 0) / rows.length)
          : null;
      const performance = supplierPerformance({
        orderedQuantity: orders.reduce((total, row) => total + Number(row.quantity), 0),
        receivedQuantity: orders.reduce((total, row) => total + Number(row.receivedQuantity), 0),
        completedOrders: completed.length,
        onTimeOrders: completed.filter(
          (row) => !row.expectedAt || row.updatedAt.getTime() <= row.expectedAt.getTime(),
        ).length,
        invoices: invoices.length,
        divergentInvoices: invoices.filter((invoice) => invoice.status === "divergent").length,
        previousAverageCostCents: average(previousCosts),
        currentAverageCostCents: average(currentCosts),
      });
      return {
        supplierId: supplier.id,
        supplierName: supplier.name,
        fillRatePercent: performance.fillRatePercent,
        onTimePercent: performance.onTimePercent,
        divergencePercent: performance.invoiceDivergencePercent,
        priceVariationPercent: performance.priceVariationPercent,
      };
    });
    return {
      reservations,
      countSchedules,
      productionBatches: productionBatches.map((batch) => ({
        ...batch,
        inputs: productionInputs.filter((input) => input.productionBatchId === batch.id),
      })),
      interunitTransfers: interunitTransfers.map((transfer) => ({
        ...transfer,
        lines: interunitLines.filter((line) => line.transferId === transfer.id),
      })),
      closings,
      organizationUnits: organizationUnits.filter(
        (unit) => authorizedUnitIds === null || authorizedUnitIds.includes(unit.id),
      ),
      interunitCatalog: {
        items: destinationItems,
        locations: destinationLocations,
      },
      forecasts,
      supplierPerformance: supplierMetrics,
    };
  }

  async inventoryDashboard(identityId: string, organizationId: string, unitId: string) {
    const role = await this.requireRole(identityId, organizationId, unitId, INVENTORY_ROLES);
    const scope = and(
      eq(managementStockLocations.organizationId, organizationId),
      eq(managementStockLocations.unitId, unitId),
    );
    const [
      locations,
      items,
      balances,
      lots,
      movements,
      automationRows,
      returnableConfigurations,
      assets,
      reviewRequests,
      transfers,
      transferReceipts,
      locationItemSettings,
      issueRoutes,
      pendingNfeImports,
      pendingReturnableIncidents,
      inventoryOperators,
      planning,
    ] = await Promise.all([
      this.database.db
        .select()
        .from(managementStockLocations)
        .where(scope)
        .orderBy(managementStockLocations.name),
      this.database.db
        .select()
        .from(managementInventoryItems)
        .where(
          and(
            eq(managementInventoryItems.organizationId, organizationId),
            eq(managementInventoryItems.unitId, unitId),
          ),
        )
        .orderBy(managementInventoryItems.name),
      this.database.db
        .select()
        .from(managementStockBalances)
        .where(
          and(
            eq(managementStockBalances.organizationId, organizationId),
            eq(managementStockBalances.unitId, unitId),
          ),
        ),
      this.database.db
        .select()
        .from(managementInventoryLots)
        .where(
          and(
            eq(managementInventoryLots.organizationId, organizationId),
            eq(managementInventoryLots.unitId, unitId),
            eq(managementInventoryLots.active, true),
          ),
        )
        .orderBy(asc(managementInventoryLots.expiresAt), managementInventoryLots.batchCode),
      this.database.db
        .select({
          id: managementInventoryMovements.id,
          locationId: managementInventoryMovements.locationId,
          inventoryItemId: managementInventoryMovements.inventoryItemId,
          lotId: managementInventoryMovements.lotId,
          type: managementInventoryMovements.type,
          quantityDelta: managementInventoryMovements.quantityDelta,
          unitCostCents: managementInventoryMovements.unitCostCents,
          sourceType: managementInventoryMovements.sourceType,
          sourceId: managementInventoryMovements.sourceId,
          actorIdentityId: managementInventoryMovements.actorIdentityId,
          actorName: identities.displayName,
          reason: managementInventoryEvents.reason,
          occurredAt: managementInventoryMovements.occurredAt,
        })
        .from(managementInventoryMovements)
        .leftJoin(
          managementInventoryEventLines,
          and(
            eq(managementInventoryMovements.sourceType, "inventory_event_line"),
            eq(managementInventoryMovements.sourceId, managementInventoryEventLines.id),
          ),
        )
        .leftJoin(
          managementInventoryEvents,
          eq(managementInventoryEventLines.eventId, managementInventoryEvents.id),
        )
        .leftJoin(identities, eq(managementInventoryMovements.actorIdentityId, identities.id))
        .where(
          and(
            eq(managementInventoryMovements.organizationId, organizationId),
            eq(managementInventoryMovements.unitId, unitId),
          ),
        )
        .orderBy(desc(managementInventoryMovements.occurredAt))
        .limit(200),
      this.database.db
        .select({
          pending: sql<number>`count(*) filter (where ${outboxEvents.processedAt} is null)`.mapWith(
            Number,
          ),
          failed:
            sql<number>`count(*) filter (where ${outboxEvents.processedAt} is null and ${outboxEvents.lastError} is not null)`.mapWith(
              Number,
            ),
          lastProcessedAt: sql<Date | null>`max(${outboxEvents.processedAt})`,
        })
        .from(outboxEvents)
        .innerJoin(posOrders, eq(sql`${outboxEvents.aggregateId}::uuid`, posOrders.id))
        .where(
          and(
            eq(outboxEvents.topic, "pos.order.sent"),
            eq(posOrders.organizationId, organizationId),
            eq(posOrders.unitId, unitId),
          ),
        ),
      this.database.db
        .select()
        .from(managementProductReturnables)
        .where(
          and(
            eq(managementProductReturnables.organizationId, organizationId),
            eq(managementProductReturnables.unitId, unitId),
            eq(managementProductReturnables.active, true),
          ),
        ),
      this.database.db
        .select()
        .from(managementInventoryAssets)
        .where(
          and(
            eq(managementInventoryAssets.organizationId, organizationId),
            eq(managementInventoryAssets.unitId, unitId),
          ),
        )
        .orderBy(managementInventoryAssets.assetTag),
      this.database.db
        .select()
        .from(managementInventoryReviewRequests)
        .where(
          and(
            eq(managementInventoryReviewRequests.organizationId, organizationId),
            eq(managementInventoryReviewRequests.unitId, unitId),
            eq(managementInventoryReviewRequests.status, "pending"),
          ),
        )
        .orderBy(desc(managementInventoryReviewRequests.createdAt)),
      this.database.db
        .select()
        .from(managementInventoryTransfers)
        .where(
          and(
            eq(managementInventoryTransfers.organizationId, organizationId),
            eq(managementInventoryTransfers.unitId, unitId),
          ),
        )
        .orderBy(desc(managementInventoryTransfers.createdAt))
        .limit(100),
      this.database.db
        .select()
        .from(managementInventoryTransferReceipts)
        .where(
          and(
            eq(managementInventoryTransferReceipts.organizationId, organizationId),
            eq(managementInventoryTransferReceipts.unitId, unitId),
          ),
        )
        .orderBy(desc(managementInventoryTransferReceipts.receivedAt))
        .limit(200),
      this.database.db
        .select()
        .from(managementStockLocationItemSettings)
        .where(
          and(
            eq(managementStockLocationItemSettings.organizationId, organizationId),
            eq(managementStockLocationItemSettings.unitId, unitId),
          ),
        ),
      this.database.db
        .select()
        .from(managementInventoryIssueRoutes)
        .where(
          and(
            eq(managementInventoryIssueRoutes.organizationId, organizationId),
            eq(managementInventoryIssueRoutes.unitId, unitId),
          ),
        ),
      this.database.db
        .select({ id: managementNfeImports.id, createdAt: managementNfeImports.createdAt })
        .from(managementNfeImports)
        .where(
          and(
            eq(managementNfeImports.organizationId, organizationId),
            eq(managementNfeImports.unitId, unitId),
            inArray(managementNfeImports.status, ["staged", "reviewing", "ready"]),
          ),
        )
        .orderBy(desc(managementNfeImports.createdAt)),
      this.database.db
        .select({
          id: managementReturnableIncidents.id,
          createdAt: managementReturnableIncidents.createdAt,
        })
        .from(managementReturnableIncidents)
        .where(
          and(
            eq(managementReturnableIncidents.organizationId, organizationId),
            eq(managementReturnableIncidents.unitId, unitId),
            eq(managementReturnableIncidents.status, "pending"),
          ),
        )
        .orderBy(desc(managementReturnableIncidents.createdAt)),
      this.database.db
        .select({ id: managementPeople.identityId, name: managementPeople.name })
        .from(managementPeople)
        .where(
          and(
            eq(managementPeople.organizationId, organizationId),
            eq(managementPeople.unitId, unitId),
            eq(managementPeople.active, true),
            sql`${managementPeople.identityId} is not null`,
          ),
        )
        .orderBy(managementPeople.name),
      this.inventoryPlanningSnapshot(identityId, organizationId, unitId),
    ]);
    const automation = automationRows[0] ?? { pending: 0, failed: 0, lastProcessedAt: null };
    const transferActorIds = [
      ...transfers.flatMap((transfer) => [
        transfer.sentByIdentityId,
        transfer.receivedByIdentityId,
        transfer.canceledByIdentityId,
      ]),
      ...transferReceipts.map((receipt) => receipt.receivedByIdentityId),
    ].filter((value): value is string => Boolean(value));
    const transferActors = transferActorIds.length
      ? await this.database.db
          .select({ id: identities.id, name: identities.displayName })
          .from(identities)
          .where(inArray(identities.id, [...new Set(transferActorIds)]))
      : [];
    const transferActorById = new Map(transferActors.map((actor) => [actor.id, actor.name]));
    const returnableByProduct = new Map(
      returnableConfigurations.map((configuration) => [configuration.productId, configuration]),
    );
    const balanceByItem = new Map<string, number>();
    for (const balance of balances)
      balanceByItem.set(
        balance.inventoryItemId,
        (balanceByItem.get(balance.inventoryItemId) ?? 0) + Number(balance.quantity),
      );
    const lowStockActions = items
      .filter(
        (item) => item.active && (balanceByItem.get(item.id) ?? 0) <= Number(item.minimumQuantity),
      )
      .map((item) => ({
        id: item.id,
        type: "low_stock" as const,
        priority: (balanceByItem.get(item.id) ?? 0) <= 0 ? ("high" as const) : ("medium" as const),
        title:
          (balanceByItem.get(item.id) ?? 0) <= 0 ? "Item sem estoque" : "Item abaixo do mínimo",
        detail: `${item.name}: ${balanceByItem.get(item.id) ?? 0} ${item.unit}; mínimo ${item.minimumQuantity}.`,
        createdAt: new Date(),
      }));
    const expiryActions = lots
      .filter(
        (lot) =>
          lot.expiresAt &&
          Number(lot.quantity) > 0 &&
          lot.expiresAt.getTime() <= Date.now() + 7 * 86_400_000,
      )
      .map((lot) => ({
        id: lot.id,
        type: "expiring_lot" as const,
        priority:
          (lot.expiresAt?.getTime() ?? 0) < Date.now() ? ("high" as const) : ("medium" as const),
        title:
          (lot.expiresAt?.getTime() ?? 0) < Date.now()
            ? "Lote vencido"
            : "Lote próximo do vencimento",
        detail: `${items.find((item) => item.id === lot.inventoryItemId)?.name ?? "Item"} · lote ${lot.batchCode}.`,
        createdAt: lot.expiresAt ?? lot.createdAt,
      }));
    const settingByLocationItem = new Map(
      locationItemSettings.map((setting) => [
        `${setting.locationId}:${setting.inventoryItemId}`,
        setting,
      ]),
    );
    const sectorReplenishmentSuggestions = locationItemSettings.flatMap((setting) => {
      const targetBalance = balances.find(
        (balance) =>
          balance.locationId === setting.locationId &&
          balance.inventoryItemId === setting.inventoryItemId,
      );
      const current = Number(targetBalance?.quantity ?? 0);
      const target = Number(setting.targetQuantity);
      if (current >= Number(setting.minimumQuantity) || target <= current) return [];
      const source = balances
        .filter(
          (balance) =>
            balance.inventoryItemId === setting.inventoryItemId &&
            balance.locationId !== setting.locationId,
        )
        .map((balance) => {
          const sourceSetting = settingByLocationItem.get(
            `${balance.locationId}:${balance.inventoryItemId}`,
          );
          const reserve = Number(sourceSetting?.minimumQuantity ?? 0);
          return { balance, surplus: Math.max(0, Number(balance.quantity) - reserve) };
        })
        .sort((left, right) => right.surplus - left.surplus)[0];
      if (!source || source.surplus <= 0) return [];
      const suggestedQuantity = Math.min(target - current, source.surplus);
      return [
        {
          inventoryItemId: setting.inventoryItemId,
          sourceLocationId: source.balance.locationId,
          destinationLocationId: setting.locationId,
          suggestedQuantity: suggestedQuantity.toFixed(3),
          transferUnitLabel: setting.transferUnitLabel,
          unitsPerTransferUnit: setting.unitsPerTransferUnit,
        },
      ];
    });
    const inTransitBalances = [
      ...new Set(transfers.map((transfer) => transfer.inventoryItemId)),
    ].map((inventoryItemId) => ({
      inventoryItemId,
      quantity: transfers
        .filter(
          (transfer) =>
            transfer.inventoryItemId === inventoryItemId &&
            ["in_transit", "partially_received"].includes(transfer.status),
        )
        .reduce(
          (total, transfer) =>
            total +
            Number(transfer.quantity) -
            Number(transfer.quantityReceived) -
            Number(transfer.quantityDivergent),
          0,
        )
        .toFixed(3),
    }));
    return {
      locations,
      items: items.map((item) => {
        const configuration = item.productId ? returnableByProduct.get(item.productId) : undefined;
        return {
          ...item,
          returnableContainerItemId: configuration?.containerInventoryItemId ?? null,
          returnableQuantityPerUnit: configuration?.quantityPerUnit ?? null,
          returnableDepositCents: configuration?.depositCents ?? null,
        };
      }),
      balances: balances.map((balance) => {
        const reservedQuantity = planning.reservations
          .filter(
            (reservation) =>
              reservation.status === "active" &&
              reservation.inventoryItemId === balance.inventoryItemId &&
              reservation.locationId === balance.locationId &&
              (!reservation.expiresAt || reservation.expiresAt.getTime() > Date.now()),
          )
          .reduce((total, reservation) => total + Number(reservation.quantity), 0);
        return {
          ...balance,
          reservedQuantity: reservedQuantity.toFixed(3),
          availableQuantity: (Number(balance.quantity) - reservedQuantity).toFixed(3),
        };
      }),
      lots,
      assets,
      inventoryReviewRequests: reviewRequests,
      transfers: transfers.map((transfer) => ({
        ...transfer,
        sentByName: transferActorById.get(transfer.sentByIdentityId) ?? null,
        receivedByName: transfer.receivedByIdentityId
          ? (transferActorById.get(transfer.receivedByIdentityId) ?? null)
          : null,
        canceledByName: transfer.canceledByIdentityId
          ? (transferActorById.get(transfer.canceledByIdentityId) ?? null)
          : null,
        receipts: transferReceipts
          .filter((receipt) => receipt.transferId === transfer.id)
          .map((receipt) => ({
            ...receipt,
            receivedByName: transferActorById.get(receipt.receivedByIdentityId) ?? null,
          })),
      })),
      inTransitBalances,
      locationItemSettings,
      issueRoutes,
      sectorReplenishmentSuggestions,
      inventoryOperators,
      reservations: planning.reservations,
      countSchedules: planning.countSchedules,
      productionBatches: planning.productionBatches,
      interunitTransfers: planning.interunitTransfers,
      closings: planning.closings,
      organizationUnits: planning.organizationUnits,
      interunitCatalog: planning.interunitCatalog,
      forecasts: planning.forecasts,
      supplierPerformance: planning.supplierPerformance,
      recentMovements: movements,
      automation,
      pendingActions: [
        ...lowStockActions,
        ...expiryActions,
        ...reviewRequests.map((request) => ({
          id: request.id,
          type: "inventory_review" as const,
          priority: "high" as const,
          title: "Aprovar divergência de estoque",
          detail: request.reason,
          createdAt: request.createdAt,
        })),
        ...transfers
          .filter((transfer) => ["in_transit", "partially_received"].includes(transfer.status))
          .map((transfer) => ({
            id: transfer.id,
            type: "transfer_receipt" as const,
            priority: "high" as const,
            title:
              transfer.deadlineAt.getTime() < Date.now()
                ? "Transferência fora do prazo"
                : "Confirmar transferência recebida",
            detail: `${transfer.reason} · ${(
              Number(transfer.quantity) -
                Number(transfer.quantityReceived) -
                Number(transfer.quantityDivergent)
            ).toLocaleString("pt-BR")} em trânsito.`,
            createdAt: transfer.createdAt,
          })),
        ...pendingNfeImports.map((item) => ({
          id: item.id,
          type: "nfe_review" as const,
          priority: "medium" as const,
          title: "Revisar importação de NF-e",
          detail: "A entrada permanece sem alterar o estoque até a confirmação.",
          createdAt: item.createdAt,
        })),
        ...pendingReturnableIncidents.map((item) => ({
          id: item.id,
          type: "returnable_incident" as const,
          priority: "high" as const,
          title: "Revisar ocorrência de vasilhame",
          detail: "Quebra, extravio ou suspeita aguardando decisão.",
          createdAt: item.createdAt,
        })),
        ...planning.countSchedules
          .filter((schedule) => schedule.nextDueAt.getTime() <= Date.now())
          .map((schedule) => ({
            id: schedule.id,
            type: "cycle_count_due" as const,
            priority: schedule.classification === "A" ? ("high" as const) : ("medium" as const),
            title: "Contagem cíclica vencida",
            detail: `Item classe ${schedule.classification}; risco ${schedule.riskScore}/100.`,
            createdAt: schedule.nextDueAt,
          })),
        ...planning.productionBatches
          .filter((batch) => batch.status === "planned")
          .map((batch) => ({
            id: batch.id,
            type: "production_batch" as const,
            priority: "medium" as const,
            title: "Finalizar produção planejada",
            detail: `Lote ${batch.batchCode} aguarda rendimento e consumo reais.`,
            createdAt: batch.createdAt,
          })),
        ...planning.interunitTransfers
          .filter(
            (transfer) =>
              transfer.destinationUnitId === unitId &&
              ["in_transit", "partially_received"].includes(transfer.status),
          )
          .map((transfer) => ({
            id: transfer.id,
            type: "interunit_transfer" as const,
            priority: "high" as const,
            title: "Receber transferência entre unidades",
            detail: transfer.reason,
            createdAt: transfer.sentAt,
          })),
        ...planning.reservations
          .filter(
            (reservation) =>
              reservation.status === "active" &&
              reservation.expiresAt &&
              reservation.expiresAt.getTime() <= Date.now(),
          )
          .map((reservation) => ({
            id: reservation.id,
            type: "expired_reservation" as const,
            priority: "medium" as const,
            title: "Reserva de estoque vencida",
            detail: reservation.reason,
            createdAt: reservation.expiresAt ?? reservation.createdAt,
          })),
        ...(automation.failed > 0
          ? [
              {
                id: "inventory-automation",
                type: "automation_failure" as const,
                priority: "high" as const,
                title: "Baixa automática com falha",
                detail: `${automation.failed} evento(s) aguardando reprocessamento.`,
                createdAt: new Date(),
              },
            ]
          : []),
      ].sort((left, right) => right.createdAt.getTime() - left.createdAt.getTime()),
      capabilities: {
        canApproveInventoryRisk: role === "owner" || role === "manager",
        canResolveTransfers: true,
        canManageAssets: true,
        canManagePlanning: true,
        canCloseInventory: role === "owner" || role === "manager",
        canTransferBetweenUnits: true,
      },
    };
  }

  async returnablesDashboard(identityId: string, organizationId: string, unitId: string) {
    await this.requireRole(identityId, organizationId, unitId, INVENTORY_ROLES);
    const scope = and(
      eq(managementProductReturnables.organizationId, organizationId),
      eq(managementProductReturnables.unitId, unitId),
    );
    const [
      configurations,
      custody,
      custodyByLocation,
      recentMovements,
      incidents,
      physical,
      physicalByLocation,
      fullProductBalances,
      supplierExchanges,
      lossIndicators,
      roleRows,
      agingMovements,
    ] = await Promise.all([
      this.database.db.select().from(managementProductReturnables).where(scope),
      this.database.db
        .select({
          containerInventoryItemId: managementReturnableCustodyMovements.containerInventoryItemId,
          expectedQuantity: sql<string>`coalesce(sum(${managementReturnableCustodyMovements.quantityDelta}), 0)`,
        })
        .from(managementReturnableCustodyMovements)
        .where(
          and(
            eq(managementReturnableCustodyMovements.organizationId, organizationId),
            eq(managementReturnableCustodyMovements.unitId, unitId),
          ),
        )
        .groupBy(managementReturnableCustodyMovements.containerInventoryItemId),
      this.database.db
        .select({
          containerInventoryItemId: managementReturnableCustodyMovements.containerInventoryItemId,
          locationId: managementReturnableCustodyMovements.locationId,
          expectedQuantity: sql<string>`coalesce(sum(${managementReturnableCustodyMovements.quantityDelta}), 0)`,
        })
        .from(managementReturnableCustodyMovements)
        .where(
          and(
            eq(managementReturnableCustodyMovements.organizationId, organizationId),
            eq(managementReturnableCustodyMovements.unitId, unitId),
            sql`${managementReturnableCustodyMovements.locationId} is not null`,
          ),
        )
        .groupBy(
          managementReturnableCustodyMovements.containerInventoryItemId,
          managementReturnableCustodyMovements.locationId,
        ),
      this.database.db
        .select()
        .from(managementReturnableCustodyMovements)
        .where(
          and(
            eq(managementReturnableCustodyMovements.organizationId, organizationId),
            eq(managementReturnableCustodyMovements.unitId, unitId),
          ),
        )
        .orderBy(desc(managementReturnableCustodyMovements.occurredAt))
        .limit(100),
      this.database.db
        .select()
        .from(managementReturnableIncidents)
        .where(
          and(
            eq(managementReturnableIncidents.organizationId, organizationId),
            eq(managementReturnableIncidents.unitId, unitId),
          ),
        )
        .orderBy(desc(managementReturnableIncidents.occurredAt))
        .limit(100),
      this.database.db
        .select({
          containerInventoryItemId: managementStockBalances.inventoryItemId,
          physicalQuantity: sql<string>`coalesce(sum(${managementStockBalances.quantity}), 0)`,
        })
        .from(managementStockBalances)
        .innerJoin(
          managementInventoryItems,
          eq(managementStockBalances.inventoryItemId, managementInventoryItems.id),
        )
        .where(
          and(
            eq(managementStockBalances.organizationId, organizationId),
            eq(managementStockBalances.unitId, unitId),
            eq(managementInventoryItems.kind, "returnable_container"),
          ),
        )
        .groupBy(managementStockBalances.inventoryItemId),
      this.database.db
        .select({
          containerInventoryItemId: managementStockBalances.inventoryItemId,
          locationId: managementStockBalances.locationId,
          physicalQuantity: managementStockBalances.quantity,
        })
        .from(managementStockBalances)
        .innerJoin(
          managementInventoryItems,
          eq(managementStockBalances.inventoryItemId, managementInventoryItems.id),
        )
        .where(
          and(
            eq(managementStockBalances.organizationId, organizationId),
            eq(managementStockBalances.unitId, unitId),
            eq(managementInventoryItems.kind, "returnable_container"),
          ),
        ),
      this.database.db
        .select({
          productId: managementInventoryItems.productId,
          locationId: managementStockBalances.locationId,
          quantity: managementStockBalances.quantity,
        })
        .from(managementStockBalances)
        .innerJoin(
          managementInventoryItems,
          eq(managementStockBalances.inventoryItemId, managementInventoryItems.id),
        )
        .where(
          and(
            eq(managementStockBalances.organizationId, organizationId),
            eq(managementStockBalances.unitId, unitId),
            eq(managementInventoryItems.kind, "resale"),
          ),
        ),
      this.database.db
        .select()
        .from(managementReturnableSupplierExchanges)
        .where(
          and(
            eq(managementReturnableSupplierExchanges.organizationId, organizationId),
            eq(managementReturnableSupplierExchanges.unitId, unitId),
          ),
        )
        .orderBy(desc(managementReturnableSupplierExchanges.sentAt))
        .limit(100),
      this.database.db
        .select({
          type: managementReturnableIncidents.type,
          locationId: managementReturnableIncidents.locationId,
          quantity: sql<string>`sum(${managementReturnableIncidents.quantity})`,
          estimatedCostCents:
            sql<number>`coalesce(sum(${managementReturnableIncidents.estimatedCostCents}), 0)`.mapWith(
              Number,
            ),
          incidentCount: sql<number>`count(*)`.mapWith(Number),
        })
        .from(managementReturnableIncidents)
        .where(
          and(
            eq(managementReturnableIncidents.organizationId, organizationId),
            eq(managementReturnableIncidents.unitId, unitId),
            eq(managementReturnableIncidents.status, "approved"),
            gte(managementReturnableIncidents.occurredAt, sql`now() - interval '90 days'`),
          ),
        )
        .groupBy(managementReturnableIncidents.type, managementReturnableIncidents.locationId),
      this.scope.requireOrganizationRole(identityId, organizationId, [
        "owner",
        "manager",
        "inventory",
      ]),
      this.database.db
        .select({
          containerInventoryItemId: managementReturnableCustodyMovements.containerInventoryItemId,
          quantityDelta: managementReturnableCustodyMovements.quantityDelta,
          context: managementReturnableCustodyMovements.context,
          occurredAt: managementReturnableCustodyMovements.occurredAt,
        })
        .from(managementReturnableCustodyMovements)
        .where(
          and(
            eq(managementReturnableCustodyMovements.organizationId, organizationId),
            eq(managementReturnableCustodyMovements.unitId, unitId),
          ),
        )
        .orderBy(managementReturnableCustodyMovements.occurredAt)
        .limit(10_000),
    ]);
    const roles = new Set(
      roleRows.filter((row) => row.unitId === null || row.unitId === unitId).map((row) => row.role),
    );
    const expectedByContainer = new Map(
      custody.map((row) => [row.containerInventoryItemId, row.expectedQuantity]),
    );
    const physicalByContainer = new Map(
      physical.map((row) => [row.containerInventoryItemId, row.physicalQuantity]),
    );
    const configurationsByProduct = new Map<string, typeof configurations>();
    for (const configuration of configurations)
      configurationsByProduct.set(configuration.productId, [
        ...(configurationsByProduct.get(configuration.productId) ?? []),
        configuration,
      ]);
    const fullContainers = new Map<string, number>();
    for (const balance of fullProductBalances) {
      if (!balance.productId) continue;
      for (const configuration of configurationsByProduct.get(balance.productId) ?? []) {
        const key = `${configuration.containerInventoryItemId}:${balance.locationId}`;
        fullContainers.set(
          key,
          (fullContainers.get(key) ?? 0) +
            Number(balance.quantity) * Number(configuration.quantityPerUnit),
        );
      }
    }
    const agingByContainer = new Map(
      [...new Set(agingMovements.map((movement) => movement.containerInventoryItemId))].map(
        (containerInventoryItemId) => [
          containerInventoryItemId,
          returnableAging(
            agingMovements
              .filter((movement) => movement.containerInventoryItemId === containerInventoryItemId)
              .map((movement) => ({
                quantityDelta: Number(movement.quantityDelta),
                occurredAt: movement.occurredAt,
                depositCents: Number(movement.context.depositCents ?? 0),
              })),
          ),
        ],
      ),
    );
    const containerIds = new Set([
      ...configurations.map((row) => row.containerInventoryItemId),
      ...expectedByContainer.keys(),
      ...physicalByContainer.keys(),
    ]);
    return {
      configurations,
      returnables: [...containerIds].map((containerInventoryItemId) => {
        const expectedQuantity = expectedByContainer.get(containerInventoryItemId) ?? "0.000";
        const aging = agingByContainer.get(containerInventoryItemId);
        return {
          containerInventoryItemId,
          locationId: null,
          expectedQuantity,
          physicalQuantity: physicalByContainer.get(containerInventoryItemId) ?? "0.000",
          divergenceQuantity: milliToQuantity(
            quantityToMilli(physicalByContainer.get(containerInventoryItemId) ?? "0") -
              quantityToMilli(expectedQuantity),
          ),
          oldestOutstandingAt: aging?.oldestOutstandingAt ?? null,
          ageDays: aging?.ageDays ?? 0,
          depositExposureCents: aging?.depositExposureCents ?? 0,
          updatedAt:
            recentMovements.find(
              (movement) => movement.containerInventoryItemId === containerInventoryItemId,
            )?.occurredAt ?? null,
        };
      }),
      recentMovements,
      incidents,
      physicalByLocation,
      custodyByLocation,
      custodySummary: [...expectedByContainer].map(
        ([containerInventoryItemId, expectedQuantity]) => ({
          containerInventoryItemId,
          expectedQuantity,
          ...(agingByContainer.get(containerInventoryItemId) ?? {
            oldestOutstandingAt: null,
            ageDays: 0,
            depositExposureCents: 0,
          }),
        }),
      ),
      fullContainersByLocation: [...fullContainers].map(([key, quantity]) => {
        const [containerInventoryItemId, locationId] = key.split(":");
        return { containerInventoryItemId, locationId, quantity: quantity.toFixed(3) };
      }),
      supplierExchanges,
      lossIndicators,
      capabilities: {
        canConfigure: roles.has("owner") || roles.has("manager") || roles.has("inventory"),
        canConfirmReturnables: roles.has("owner") || roles.has("manager") || roles.has("inventory"),
        canRecordReturnableIncident:
          roles.has("owner") || roles.has("manager") || roles.has("inventory"),
        canApproveReturnableIncident: roles.has("owner") || roles.has("manager"),
      },
    };
  }

  async configureProductReturnable(
    identityId: string,
    organizationId: string,
    unitId: string,
    idempotencyKey: string,
    input: ProductReturnableInput,
  ) {
    await this.requireRole(identityId, organizationId, unitId, INVENTORY_ROLES);
    return this.idempotent(
      identityId,
      organizationId,
      unitId,
      idempotencyKey,
      "product-returnable.configure",
      input,
      async (tx) => {
        await this.requireProduct(tx, organizationId, input.productId);
        await this.requireInventoryItem(
          tx,
          organizationId,
          unitId,
          input.containerInventoryItemId,
          ["returnable_container"],
        );
        const [configuration] = await tx
          .insert(managementProductReturnables)
          .values({
            organizationId,
            unitId,
            productId: input.productId,
            containerInventoryItemId: input.containerInventoryItemId,
            quantityPerUnit: String(input.quantityPerUnit),
            depositCents: input.depositCents,
            active: input.active,
          })
          .onConflictDoUpdate({
            target: [
              managementProductReturnables.organizationId,
              managementProductReturnables.unitId,
              managementProductReturnables.productId,
              managementProductReturnables.containerInventoryItemId,
            ],
            set: {
              quantityPerUnit: String(input.quantityPerUnit),
              depositCents: input.depositCents,
              active: input.active,
              updatedAt: new Date(),
            },
          })
          .returning();
        if (!configuration)
          throw new ConflictException("Não foi possível configurar o retornável.");
        await this.record(
          tx,
          identityId,
          organizationId,
          unitId,
          "management.product-returnable.configured",
          "product_returnable",
          configuration.id,
          { productId: input.productId, containerInventoryItemId: input.containerInventoryItemId },
        );
        return configuration;
      },
    );
  }

  async confirmReturnableCustody(
    identityId: string,
    organizationId: string,
    unitId: string,
    idempotencyKey: string,
    input: ReturnableCustodyConfirmInput,
  ) {
    await this.requireRole(identityId, organizationId, unitId, INVENTORY_ROLES);
    return this.idempotent(
      identityId,
      organizationId,
      unitId,
      idempotencyKey,
      "returnable-custody.confirm",
      input,
      async (tx) => {
        await this.requireInventoryItem(
          tx,
          organizationId,
          unitId,
          input.containerInventoryItemId,
          ["returnable_container"],
        );
        if (input.orderId) await this.requireOrder(tx, organizationId, unitId, input.orderId);
        await tx.execute(
          sql`select pg_advisory_xact_lock(hashtextextended(${`returnable-custody:${organizationId}:${unitId}:${input.containerInventoryItemId}`}, 0))`,
        );
        const filters = [
          eq(managementReturnableCustodyMovements.organizationId, organizationId),
          eq(managementReturnableCustodyMovements.unitId, unitId),
          eq(
            managementReturnableCustodyMovements.containerInventoryItemId,
            input.containerInventoryItemId,
          ),
        ];
        if (input.orderId)
          filters.push(eq(managementReturnableCustodyMovements.orderId, input.orderId));
        const [summary] = await tx
          .select({
            quantity: sql<string>`coalesce(sum(${managementReturnableCustodyMovements.quantityDelta}), 0)`,
          })
          .from(managementReturnableCustodyMovements)
          .where(and(...filters));
        const quantityMilli = quantityToMilli(input.quantity);
        if (quantityMilli > quantityToMilli(summary?.quantity ?? "0"))
          throw new ConflictException({
            code: "RETURNABLE_RETURN_EXCEEDS_CUSTODY",
            message: "O retorno confirmado excede a custódia prevista.",
          });
        const movementId = randomUUID();
        await tx.insert(managementReturnableCustodyMovements).values({
          id: movementId,
          organizationId,
          unitId,
          containerInventoryItemId: input.containerInventoryItemId,
          locationId: input.locationId,
          type: "return",
          quantityDelta: milliToQuantity(-quantityMilli),
          orderId: input.orderId,
          sourceType: "employee_confirmation",
          sourceId: movementId,
          idempotencyKey,
          actorIdentityId: identityId,
          context: { note: input.note ?? null },
        });
        await this.applyStockMovement(tx, organizationId, unitId, {
          locationId: input.locationId,
          inventoryItemId: input.containerInventoryItemId,
          quantityDeltaMilli: quantityMilli,
          type: "returnable_return",
          sourceType: "returnable_custody_movement",
          sourceId: movementId,
          actorIdentityId: identityId,
        });
        await this.record(
          tx,
          identityId,
          organizationId,
          unitId,
          "management.returnable-custody.confirmed",
          "returnable_custody_movement",
          movementId,
          { quantity: milliToQuantity(quantityMilli), orderId: input.orderId ?? null },
        );
        return { movementId, status: "confirmed", quantity: milliToQuantity(quantityMilli) };
      },
    );
  }

  async exchangeReturnablesWithSupplier(
    identityId: string,
    organizationId: string,
    unitId: string,
    idempotencyKey: string,
    input: ReturnableSupplierExchangeInput,
  ) {
    await this.requireRole(identityId, organizationId, unitId, INVENTORY_ROLES);
    return this.idempotent(
      identityId,
      organizationId,
      unitId,
      idempotencyKey,
      "returnable-supplier-exchange",
      input,
      async (tx) => {
        await this.requireInventoryItem(
          tx,
          organizationId,
          unitId,
          input.containerInventoryItemId,
          ["returnable_container"],
        );
        await this.requireSupplier(tx, organizationId, unitId, input.supplierId);
        const movementId = randomUUID();
        const quantityMilli = quantityToMilli(input.quantity);
        const balance = await this.applyStockMovement(tx, organizationId, unitId, {
          locationId: input.locationId,
          inventoryItemId: input.containerInventoryItemId,
          quantityDeltaMilli: -quantityMilli,
          type: "returnable_supplier_exchange",
          sourceType: "supplier_exchange",
          sourceId: movementId,
          actorIdentityId: identityId,
        });
        await tx.insert(managementReturnableSupplierExchanges).values({
          id: movementId,
          organizationId,
          unitId,
          containerInventoryItemId: input.containerInventoryItemId,
          locationId: input.locationId,
          supplierId: input.supplierId,
          quantity: String(input.quantity),
          note: input.note,
          idempotencyKey,
          sentByIdentityId: identityId,
        });
        await this.record(
          tx,
          identityId,
          organizationId,
          unitId,
          "management.returnable.supplier-exchanged",
          "inventory_movement",
          movementId,
          {
            supplierId: input.supplierId,
            quantity: input.quantity,
            note: input.note,
          },
        );
        return {
          exchangeId: movementId,
          movementId,
          status: "in_transit",
          resultingQuantity: milliToQuantity(balance.resultingMilli),
        };
      },
    );
  }

  async resolveReturnableSupplierExchange(
    identityId: string,
    organizationId: string,
    unitId: string,
    exchangeId: string,
    idempotencyKey: string,
    input: ReturnableSupplierExchangeResolutionInput,
  ) {
    await this.requireRole(identityId, organizationId, unitId, INVENTORY_ROLES);
    return this.idempotent(
      identityId,
      organizationId,
      unitId,
      idempotencyKey,
      "returnable-supplier-exchange.resolve",
      { exchangeId, ...input },
      async (tx) => {
        await tx.execute(
          sql`select id from management_returnable_supplier_exchanges where organization_id=${organizationId}::uuid and unit_id=${unitId}::uuid and id=${exchangeId}::uuid for update`,
        );
        const [exchange] = await tx
          .select()
          .from(managementReturnableSupplierExchanges)
          .where(
            and(
              eq(managementReturnableSupplierExchanges.organizationId, organizationId),
              eq(managementReturnableSupplierExchanges.unitId, unitId),
              eq(managementReturnableSupplierExchanges.id, exchangeId),
            ),
          )
          .limit(1);
        if (!exchange)
          throw new NotFoundException({
            code: "RETURNABLE_SUPPLIER_EXCHANGE_NOT_FOUND",
            message: "Envio de vasilhames não encontrado.",
          });
        if (exchange.status !== "in_transit") return exchange;
        const now = new Date();
        if (input.decision === "canceled")
          await this.applyStockMovement(tx, organizationId, unitId, {
            locationId: exchange.locationId,
            inventoryItemId: exchange.containerInventoryItemId,
            quantityDeltaMilli: quantityToMilli(exchange.quantity),
            type: "returnable_supplier_exchange_canceled",
            sourceType: "supplier_exchange_cancellation",
            sourceId: exchange.id,
            actorIdentityId: identityId,
          });
        const [updated] = await tx
          .update(managementReturnableSupplierExchanges)
          .set(
            input.decision === "received"
              ? {
                  status: "received",
                  receivedByIdentityId: identityId,
                  receivedAt: now,
                  note: `${exchange.note}\n${input.note}`,
                  updatedAt: now,
                }
              : {
                  status: "canceled",
                  canceledByIdentityId: identityId,
                  canceledAt: now,
                  note: `${exchange.note}\n${input.note}`,
                  updatedAt: now,
                },
          )
          .where(eq(managementReturnableSupplierExchanges.id, exchange.id))
          .returning();
        await this.record(
          tx,
          identityId,
          organizationId,
          unitId,
          `management.returnable.supplier-exchange-${input.decision}`,
          "returnable_supplier_exchange",
          exchange.id,
          { note: input.note },
        );
        return updated ?? exchange;
      },
    );
  }

  async createReturnableIncident(
    identityId: string,
    organizationId: string,
    unitId: string,
    idempotencyKey: string,
    input: ReturnableIncidentInput,
  ) {
    await this.requireRole(identityId, organizationId, unitId, INVENTORY_ROLES);
    return this.idempotent(
      identityId,
      organizationId,
      unitId,
      idempotencyKey,
      "returnable-incident.create",
      input,
      async (tx) => {
        await this.requireInventoryItem(
          tx,
          organizationId,
          unitId,
          input.containerInventoryItemId,
          ["returnable_container"],
        );
        if (input.orderId) await this.requireOrder(tx, organizationId, unitId, input.orderId);
        if (input.movementId) {
          const [movement] = await tx
            .select({
              containerInventoryItemId:
                managementReturnableCustodyMovements.containerInventoryItemId,
            })
            .from(managementReturnableCustodyMovements)
            .where(
              and(
                eq(managementReturnableCustodyMovements.organizationId, organizationId),
                eq(managementReturnableCustodyMovements.unitId, unitId),
                eq(managementReturnableCustodyMovements.id, input.movementId),
              ),
            )
            .limit(1);
          if (!movement || movement.containerInventoryItemId !== input.containerInventoryItemId)
            throw new NotFoundException({
              code: "RETURNABLE_CUSTODY_NOT_FOUND",
              message: "Custódia não encontrada para este vasilhame.",
            });
        }
        let estimatedCostCents: number | null = null;
        if (input.locationId) {
          const [balance] = await tx
            .select({ averageCostCents: managementStockBalances.averageCostCents })
            .from(managementStockBalances)
            .where(
              and(
                eq(managementStockBalances.organizationId, organizationId),
                eq(managementStockBalances.unitId, unitId),
                eq(managementStockBalances.locationId, input.locationId),
                eq(managementStockBalances.inventoryItemId, input.containerInventoryItemId),
              ),
            )
            .limit(1);
          estimatedCostCents = balance?.averageCostCents
            ? Math.round((balance.averageCostCents * quantityToMilli(input.quantity)) / 1_000)
            : null;
        }
        const incidentId = randomUUID();
        await tx.insert(managementReturnableIncidents).values({
          id: incidentId,
          organizationId,
          unitId,
          containerInventoryItemId: input.containerInventoryItemId,
          locationId: input.locationId,
          custodyMovementId: input.movementId,
          type: input.type,
          quantity: String(input.quantity),
          estimatedCostCents,
          notes: input.note,
          actorIdentityId: identityId,
          context: { orderId: input.orderId ?? null, idempotencyKey },
          evidenceMetadata: { urls: input.evidence },
        });
        await this.record(
          tx,
          identityId,
          organizationId,
          unitId,
          "management.returnable-incident.created",
          "returnable_incident",
          incidentId,
          {
            type: input.type,
            quantity: String(input.quantity),
            evidenceCount: input.evidence.length,
          },
        );
        return { incidentId, status: "pending" };
      },
    );
  }

  async reviewReturnableIncident(
    identityId: string,
    organizationId: string,
    unitId: string,
    incidentId: string,
    idempotencyKey: string,
    input: ReturnableIncidentReviewInput,
  ) {
    await this.requireRole(identityId, organizationId, unitId, ["owner", "manager"]);
    return this.idempotent(
      identityId,
      organizationId,
      unitId,
      idempotencyKey,
      "returnable-incident.review",
      { incidentId, ...input },
      async (tx) => {
        await tx.execute(
          sql`select id from management_returnable_incidents where organization_id=${organizationId}::uuid and unit_id=${unitId}::uuid and id=${incidentId}::uuid for update`,
        );
        const [incident] = await tx
          .select()
          .from(managementReturnableIncidents)
          .where(
            and(
              eq(managementReturnableIncidents.organizationId, organizationId),
              eq(managementReturnableIncidents.unitId, unitId),
              eq(managementReturnableIncidents.id, incidentId),
            ),
          )
          .limit(1);
        if (!incident)
          throw new NotFoundException({
            code: "RETURNABLE_INCIDENT_NOT_FOUND",
            message: "Intercorrência não encontrada.",
          });
        try {
          assertIncidentTransition(incident.status, input.decision);
        } catch {
          throw new ConflictException({
            code: "RETURNABLE_INCIDENT_ALREADY_REVIEWED",
            message: "A intercorrência já foi revisada.",
          });
        }
        if (input.decision === "approved" && incident.actorIdentityId === identityId)
          throw new ForbiddenException({
            code: "RETURNABLE_INCIDENT_DUAL_CONTROL",
            message: "Quem registrou não pode aprovar a própria intercorrência.",
          });
        if (input.decision === "approved") {
          const quantityMilli = quantityToMilli(incident.quantity);
          if (incident.custodyMovementId) {
            const [custody] = await tx
              .select()
              .from(managementReturnableCustodyMovements)
              .where(eq(managementReturnableCustodyMovements.id, incident.custodyMovementId))
              .limit(1);
            if (!custody) throw new ConflictException("A custódia vinculada não existe mais.");
            await tx.execute(
              sql`select pg_advisory_xact_lock(hashtextextended(${`returnable-custody:${organizationId}:${unitId}:${incident.containerInventoryItemId}`}, 0))`,
            );
            const custodyFilters = [
              eq(managementReturnableCustodyMovements.organizationId, organizationId),
              eq(managementReturnableCustodyMovements.unitId, unitId),
              eq(
                managementReturnableCustodyMovements.containerInventoryItemId,
                incident.containerInventoryItemId,
              ),
            ];
            if (custody.orderId)
              custodyFilters.push(
                eq(managementReturnableCustodyMovements.orderId, custody.orderId),
              );
            if (custody.orderItemId)
              custodyFilters.push(
                eq(managementReturnableCustodyMovements.orderItemId, custody.orderItemId),
              );
            const [pending] = await tx
              .select({
                quantity: sql<string>`coalesce(sum(${managementReturnableCustodyMovements.quantityDelta}), 0)`,
              })
              .from(managementReturnableCustodyMovements)
              .where(and(...custodyFilters));
            if (quantityMilli > quantityToMilli(pending?.quantity ?? "0"))
              throw new ConflictException({
                code: "RETURNABLE_INCIDENT_EXCEEDS_CUSTODY",
                message: "A quantidade da intercorrência excede a custódia pendente.",
              });
            await tx.insert(managementReturnableCustodyMovements).values({
              organizationId,
              unitId,
              containerInventoryItemId: incident.containerInventoryItemId,
              locationId: incident.locationId,
              type: "incident",
              quantityDelta: milliToQuantity(-quantityMilli),
              orderId: custody.orderId,
              orderItemId: custody.orderItemId,
              sourceType: "returnable_incident",
              sourceId: incident.id,
              idempotencyKey,
              actorIdentityId: identityId,
              context: { incidentType: incident.type, reviewReason: input.reason },
            });
          } else if (incident.locationId) {
            await this.applyStockMovement(tx, organizationId, unitId, {
              locationId: incident.locationId,
              inventoryItemId: incident.containerInventoryItemId,
              quantityDeltaMilli: -quantityMilli,
              type: "returnable_incident",
              sourceType: "returnable_incident",
              sourceId: incident.id,
              actorIdentityId: identityId,
            });
          }
        }
        await tx
          .update(managementReturnableIncidents)
          .set({
            status: input.decision,
            approverIdentityId: identityId,
            reviewedAt: new Date(),
            reviewReason: input.reason,
            updatedAt: new Date(),
          })
          .where(eq(managementReturnableIncidents.id, incident.id));
        await this.record(
          tx,
          identityId,
          organizationId,
          unitId,
          `management.returnable-incident.${input.decision}`,
          "returnable_incident",
          incident.id,
          { reason: input.reason },
        );
        return { incidentId: incident.id, status: input.decision };
      },
    );
  }

  async createStockLocation(
    identityId: string,
    organizationId: string,
    unitId: string,
    idempotencyKey: string,
    input: StockLocationInput,
  ) {
    await this.requireRole(identityId, organizationId, unitId, INVENTORY_ROLES);
    if (input.responsibleIdentityId)
      await this.scope.requireUnitAccess(input.responsibleIdentityId, organizationId, unitId);
    return this.idempotent(
      identityId,
      organizationId,
      unitId,
      idempotencyKey,
      "stock-location.create",
      input,
      async (tx) => {
        const id = randomUUID();
        const [location] = await tx
          .insert(managementStockLocations)
          .values({ id, organizationId, unitId, ...input, code: input.code.toUpperCase() })
          .returning();
        if (!location) throw new ConflictException("Não foi possível criar o local.");
        await this.record(
          tx,
          identityId,
          organizationId,
          unitId,
          "management.stock-location.created",
          "stock_location",
          id,
          { code: location.code },
        );
        return location;
      },
    );
  }

  async updateStockLocation(
    identityId: string,
    organizationId: string,
    unitId: string,
    locationId: string,
    input: StockLocationUpdateInput,
  ) {
    await this.requireRole(identityId, organizationId, unitId, INVENTORY_ROLES);
    if (input.responsibleIdentityId)
      await this.scope.requireUnitAccess(input.responsibleIdentityId, organizationId, unitId);
    return this.database.db.transaction(async (tx) => {
      const [location] = await tx
        .update(managementStockLocations)
        .set({ ...input, code: input.code?.toUpperCase(), updatedAt: new Date() })
        .where(
          and(
            eq(managementStockLocations.organizationId, organizationId),
            eq(managementStockLocations.unitId, unitId),
            eq(managementStockLocations.id, locationId),
          ),
        )
        .returning();
      if (!location)
        throw new NotFoundException({
          code: "STOCK_LOCATION_NOT_FOUND",
          message: "Local de estoque não encontrado nesta unidade.",
        });
      await this.record(
        tx,
        identityId,
        organizationId,
        unitId,
        "management.stock-location.updated",
        "stock_location",
        locationId,
        { fields: Object.keys(input) },
      );
      return location;
    });
  }

  async configureStockLocationItemSetting(
    identityId: string,
    organizationId: string,
    unitId: string,
    idempotencyKey: string,
    input: StockLocationItemSettingInput,
  ) {
    await this.requireRole(identityId, organizationId, unitId, INVENTORY_ROLES);
    return this.idempotent(
      identityId,
      organizationId,
      unitId,
      idempotencyKey,
      "stock-location-item-setting.configure",
      input,
      async (tx) => {
        await Promise.all([
          this.requireInventoryItem(tx, organizationId, unitId, input.inventoryItemId),
          tx
            .select({ id: managementStockLocations.id })
            .from(managementStockLocations)
            .where(
              and(
                eq(managementStockLocations.organizationId, organizationId),
                eq(managementStockLocations.unitId, unitId),
                eq(managementStockLocations.id, input.locationId),
                eq(managementStockLocations.active, true),
              ),
            )
            .limit(1)
            .then((rows) => {
              if (!rows[0])
                throw new NotFoundException({
                  code: "STOCK_LOCATION_NOT_FOUND",
                  message: "Local de estoque não encontrado nesta unidade.",
                });
            }),
        ]);
        const [setting] = await tx
          .insert(managementStockLocationItemSettings)
          .values({
            organizationId,
            unitId,
            ...input,
            minimumQuantity: String(input.minimumQuantity),
            targetQuantity: String(input.targetQuantity),
            unitsPerTransferUnit: String(input.unitsPerTransferUnit),
          })
          .onConflictDoUpdate({
            target: [
              managementStockLocationItemSettings.organizationId,
              managementStockLocationItemSettings.unitId,
              managementStockLocationItemSettings.locationId,
              managementStockLocationItemSettings.inventoryItemId,
            ],
            set: {
              minimumQuantity: String(input.minimumQuantity),
              targetQuantity: String(input.targetQuantity),
              transferUnitLabel: input.transferUnitLabel,
              unitsPerTransferUnit: String(input.unitsPerTransferUnit),
              updatedAt: new Date(),
            },
          })
          .returning();
        if (!setting) throw new ConflictException("Não foi possível configurar o setor.");
        await this.record(
          tx,
          identityId,
          organizationId,
          unitId,
          "management.inventory.location-item-setting.configured",
          "stock_location_item_setting",
          setting.id,
          { inventoryItemId: input.inventoryItemId, locationId: input.locationId },
        );
        return setting;
      },
    );
  }

  async configureInventoryIssueRoute(
    identityId: string,
    organizationId: string,
    unitId: string,
    idempotencyKey: string,
    input: InventoryIssueRouteInput,
  ) {
    await this.requireRole(identityId, organizationId, unitId, INVENTORY_ROLES);
    return this.idempotent(
      identityId,
      organizationId,
      unitId,
      idempotencyKey,
      "inventory-issue-route.configure",
      input,
      async (tx) => {
        const [product, location, station] = await Promise.all([
          tx
            .select({ id: managementInventoryItems.id })
            .from(managementInventoryItems)
            .where(
              and(
                eq(managementInventoryItems.organizationId, organizationId),
                eq(managementInventoryItems.unitId, unitId),
                eq(managementInventoryItems.productId, input.productId),
                eq(managementInventoryItems.kind, "resale"),
                eq(managementInventoryItems.active, true),
              ),
            )
            .limit(1),
          tx
            .select({ id: managementStockLocations.id })
            .from(managementStockLocations)
            .where(
              and(
                eq(managementStockLocations.organizationId, organizationId),
                eq(managementStockLocations.unitId, unitId),
                eq(managementStockLocations.id, input.locationId),
                eq(managementStockLocations.active, true),
              ),
            )
            .limit(1),
          input.stationId
            ? tx
                .select({ id: posProductionStations.id })
                .from(posProductionStations)
                .where(
                  and(
                    eq(posProductionStations.organizationId, organizationId),
                    eq(posProductionStations.unitId, unitId),
                    eq(posProductionStations.id, input.stationId),
                  ),
                )
                .limit(1)
            : Promise.resolve([{ id: null }]),
        ]);
        if (!product[0])
          throw new NotFoundException({
            code: "RESALE_INVENTORY_ITEM_NOT_FOUND",
            message: "O produto não possui item de revenda ativo nesta unidade.",
          });
        if (!location[0])
          throw new NotFoundException({
            code: "STOCK_LOCATION_NOT_FOUND",
            message: "Local de saída não encontrado nesta unidade.",
          });
        if (!station[0])
          throw new NotFoundException({
            code: "PRODUCTION_STATION_NOT_FOUND",
            message: "Estação não encontrada nesta unidade.",
          });
        await tx.execute(
          sql`select pg_advisory_xact_lock(hashtextextended(${`inventory-route:${organizationId}:${unitId}:${input.productId}:${input.stationId ?? "default"}`}, 0))`,
        );
        const routeFilter = and(
          eq(managementInventoryIssueRoutes.organizationId, organizationId),
          eq(managementInventoryIssueRoutes.unitId, unitId),
          eq(managementInventoryIssueRoutes.productId, input.productId),
          input.stationId
            ? eq(managementInventoryIssueRoutes.stationId, input.stationId)
            : isNull(managementInventoryIssueRoutes.stationId),
        );
        const [existing] = await tx
          .select({ id: managementInventoryIssueRoutes.id })
          .from(managementInventoryIssueRoutes)
          .where(routeFilter)
          .limit(1);
        const [route] = existing
          ? await tx
              .update(managementInventoryIssueRoutes)
              .set({ locationId: input.locationId, active: input.active, updatedAt: new Date() })
              .where(eq(managementInventoryIssueRoutes.id, existing.id))
              .returning()
          : await tx
              .insert(managementInventoryIssueRoutes)
              .values({ organizationId, unitId, ...input })
              .returning();
        if (!route) throw new ConflictException("Não foi possível configurar a rota de saída.");
        await this.record(
          tx,
          identityId,
          organizationId,
          unitId,
          "management.inventory.issue-route.configured",
          "inventory_issue_route",
          route.id,
          {
            productId: input.productId,
            stationId: input.stationId ?? null,
            locationId: input.locationId,
          },
        );
        return route;
      },
    );
  }

  async archiveStockLocation(
    identityId: string,
    organizationId: string,
    unitId: string,
    locationId: string,
  ) {
    await this.requireRole(identityId, organizationId, unitId, INVENTORY_ROLES);
    return this.database.db.transaction(async (tx) => {
      const [nonEmpty, recipe] = await Promise.all([
        tx
          .select({ id: managementStockBalances.id })
          .from(managementStockBalances)
          .where(
            and(
              eq(managementStockBalances.organizationId, organizationId),
              eq(managementStockBalances.unitId, unitId),
              eq(managementStockBalances.locationId, locationId),
              ne(managementStockBalances.quantity, "0"),
            ),
          )
          .limit(1),
        tx
          .select({ id: managementRecipeComponents.id })
          .from(managementRecipeComponents)
          .innerJoin(
            managementRecipeVersions,
            eq(managementRecipeComponents.recipeVersionId, managementRecipeVersions.id),
          )
          .where(
            and(
              eq(managementRecipeComponents.organizationId, organizationId),
              eq(managementRecipeComponents.unitId, unitId),
              eq(managementRecipeComponents.locationId, locationId),
              isNull(managementRecipeVersions.validUntil),
            ),
          )
          .limit(1),
      ]);
      if (nonEmpty.length || recipe.length)
        throw new ConflictException({
          code: "STOCK_LOCATION_IN_USE",
          message: "Zere o saldo e remova o local das fichas técnicas antes de inativar.",
        });
      const [location] = await tx
        .update(managementStockLocations)
        .set({ active: false, updatedAt: new Date() })
        .where(
          and(
            eq(managementStockLocations.organizationId, organizationId),
            eq(managementStockLocations.unitId, unitId),
            eq(managementStockLocations.id, locationId),
          ),
        )
        .returning();
      if (!location)
        throw new NotFoundException({
          code: "STOCK_LOCATION_NOT_FOUND",
          message: "Local de estoque não encontrado nesta unidade.",
        });
      await this.record(
        tx,
        identityId,
        organizationId,
        unitId,
        "management.stock-location.archived",
        "stock_location",
        locationId,
        {},
      );
      return location;
    });
  }

  async createInventoryItem(
    identityId: string,
    organizationId: string,
    unitId: string,
    idempotencyKey: string,
    input: InventoryItemInput,
  ) {
    await this.requireRole(identityId, organizationId, unitId, INVENTORY_ROLES);
    const kind = input.kind ?? "ingredient";
    if (kind === "resale" && !input.productId)
      throw new BadRequestException({
        code: "RESALE_PRODUCT_REQUIRED",
        message: "Item de revenda deve estar vinculado ao produto vendido.",
      });
    if ((kind === "reusable" || kind === "returnable_container") && input.productId)
      throw new BadRequestException({
        code: "INVENTORY_KIND_PRODUCT_FORBIDDEN",
        message: "Reutilizáveis e vasilhames não podem ser o produto vendido.",
      });
    return this.idempotent(
      identityId,
      organizationId,
      unitId,
      idempotencyKey,
      "inventory-item.create",
      input,
      async (tx) => {
        if (input.productId) await this.requireProduct(tx, organizationId, input.productId);
        if (input.preferredSupplierId)
          await this.requireSupplier(tx, organizationId, unitId, input.preferredSupplierId);
        const id = randomUUID();
        const [item] = await tx
          .insert(managementInventoryItems)
          .values({
            id,
            organizationId,
            unitId,
            ...input,
            kind,
            minimumQuantity: String(input.minimumQuantity),
            purchaseToStockFactor: String(input.purchaseToStockFactor),
            reorderQuantity: String(input.reorderQuantity),
          })
          .returning();
        if (!item) throw new ConflictException("Não foi possível criar o insumo.");
        await this.record(
          tx,
          identityId,
          organizationId,
          unitId,
          "management.inventory-item.created",
          "inventory_item",
          id,
          { productId: input.productId ?? null },
        );
        return item;
      },
    );
  }

  async updateInventoryItem(
    identityId: string,
    organizationId: string,
    unitId: string,
    inventoryItemId: string,
    input: InventoryItemUpdateInput,
  ) {
    await this.requireRole(identityId, organizationId, unitId, INVENTORY_ROLES);
    return this.database.db.transaction(async (tx) => {
      const [existing] = await tx
        .select({
          kind: managementInventoryItems.kind,
          productId: managementInventoryItems.productId,
        })
        .from(managementInventoryItems)
        .where(
          and(
            eq(managementInventoryItems.organizationId, organizationId),
            eq(managementInventoryItems.unitId, unitId),
            eq(managementInventoryItems.id, inventoryItemId),
          ),
        )
        .limit(1);
      if (!existing)
        throw new NotFoundException({
          code: "INVENTORY_ITEM_NOT_FOUND",
          message: "Item não encontrado nesta unidade.",
        });
      const resultingKind = input.kind ?? existing.kind;
      const resultingProductId =
        input.productId === undefined ? existing.productId : input.productId;
      if (resultingKind === "resale" && !resultingProductId)
        throw new BadRequestException({
          code: "RESALE_PRODUCT_REQUIRED",
          message: "Item de revenda deve estar vinculado ao produto vendido.",
        });
      if (
        (resultingKind === "reusable" || resultingKind === "returnable_container") &&
        resultingProductId
      )
        throw new BadRequestException({
          code: "INVENTORY_KIND_PRODUCT_FORBIDDEN",
          message: "Reutilizáveis e vasilhames não podem ser o produto vendido.",
        });
      if (input.productId) await this.requireProduct(tx, organizationId, input.productId);
      if (input.preferredSupplierId)
        await this.requireSupplier(tx, organizationId, unitId, input.preferredSupplierId);
      const [item] = await tx
        .update(managementInventoryItems)
        .set({
          ...input,
          minimumQuantity:
            input.minimumQuantity === undefined ? undefined : String(input.minimumQuantity),
          purchaseToStockFactor:
            input.purchaseToStockFactor === undefined
              ? undefined
              : String(input.purchaseToStockFactor),
          reorderQuantity:
            input.reorderQuantity === undefined ? undefined : String(input.reorderQuantity),
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(managementInventoryItems.organizationId, organizationId),
            eq(managementInventoryItems.unitId, unitId),
            eq(managementInventoryItems.id, inventoryItemId),
          ),
        )
        .returning();
      if (!item)
        throw new NotFoundException({
          code: "INVENTORY_ITEM_NOT_FOUND",
          message: "Insumo não encontrado nesta unidade.",
        });
      await this.record(
        tx,
        identityId,
        organizationId,
        unitId,
        "management.inventory-item.updated",
        "inventory_item",
        inventoryItemId,
        { fields: Object.keys(input) },
      );
      return item;
    });
  }

  async archiveInventoryItem(
    identityId: string,
    organizationId: string,
    unitId: string,
    inventoryItemId: string,
  ) {
    await this.requireRole(identityId, organizationId, unitId, INVENTORY_ROLES);
    return this.database.db.transaction(async (tx) => {
      const [nonEmpty, recipe] = await Promise.all([
        tx
          .select({ id: managementStockBalances.id })
          .from(managementStockBalances)
          .where(
            and(
              eq(managementStockBalances.organizationId, organizationId),
              eq(managementStockBalances.unitId, unitId),
              eq(managementStockBalances.inventoryItemId, inventoryItemId),
              ne(managementStockBalances.quantity, "0"),
            ),
          )
          .limit(1),
        tx
          .select({ id: managementRecipeComponents.id })
          .from(managementRecipeComponents)
          .innerJoin(
            managementRecipeVersions,
            eq(managementRecipeComponents.recipeVersionId, managementRecipeVersions.id),
          )
          .where(
            and(
              eq(managementRecipeComponents.organizationId, organizationId),
              eq(managementRecipeComponents.unitId, unitId),
              eq(managementRecipeComponents.inventoryItemId, inventoryItemId),
              isNull(managementRecipeVersions.validUntil),
            ),
          )
          .limit(1),
      ]);
      if (nonEmpty.length || recipe.length)
        throw new ConflictException({
          code: "INVENTORY_ITEM_IN_USE",
          message: "Zere o saldo e remova o insumo das fichas técnicas antes de inativar.",
        });
      const [item] = await tx
        .update(managementInventoryItems)
        .set({ active: false, updatedAt: new Date() })
        .where(
          and(
            eq(managementInventoryItems.organizationId, organizationId),
            eq(managementInventoryItems.unitId, unitId),
            eq(managementInventoryItems.id, inventoryItemId),
          ),
        )
        .returning();
      if (!item)
        throw new NotFoundException({
          code: "INVENTORY_ITEM_NOT_FOUND",
          message: "Insumo não encontrado nesta unidade.",
        });
      await this.record(
        tx,
        identityId,
        organizationId,
        unitId,
        "management.inventory-item.archived",
        "inventory_item",
        inventoryItemId,
        {},
      );
      return item;
    });
  }

  async createInventoryAsset(
    identityId: string,
    organizationId: string,
    unitId: string,
    idempotencyKey: string,
    input: InventoryAssetInput,
  ) {
    await this.requireRole(identityId, organizationId, unitId, INVENTORY_ROLES);
    return this.idempotent(
      identityId,
      organizationId,
      unitId,
      idempotencyKey,
      "inventory-asset.create",
      input,
      async (tx) => {
        await this.requireInventoryItem(tx, organizationId, unitId, input.inventoryItemId, [
          "reusable",
        ]);
        const [location] = await tx
          .select({ id: managementStockLocations.id })
          .from(managementStockLocations)
          .where(
            and(
              eq(managementStockLocations.organizationId, organizationId),
              eq(managementStockLocations.unitId, unitId),
              eq(managementStockLocations.id, input.locationId),
              eq(managementStockLocations.active, true),
            ),
          )
          .limit(1);
        if (!location) throw new NotFoundException("Local de estoque não encontrado.");
        if (input.responsibleIdentityId) {
          const [person] = await tx
            .select({ id: managementPeople.id })
            .from(managementPeople)
            .where(
              and(
                eq(managementPeople.organizationId, organizationId),
                eq(managementPeople.unitId, unitId),
                eq(managementPeople.identityId, input.responsibleIdentityId),
                eq(managementPeople.active, true),
              ),
            )
            .limit(1);
          if (!person) throw new BadRequestException("Responsável não pertence a esta unidade.");
        }
        const [asset] = await tx
          .insert(managementInventoryAssets)
          .values({
            organizationId,
            unitId,
            inventoryItemId: input.inventoryItemId,
            locationId: input.locationId,
            assetTag: input.assetTag.toUpperCase(),
            status: input.status,
            condition: input.condition,
            responsibleIdentityId: input.responsibleIdentityId,
            acquiredAt: input.acquiredAt ? new Date(input.acquiredAt) : undefined,
            lastMaintenanceAt: input.lastMaintenanceAt
              ? new Date(input.lastMaintenanceAt)
              : undefined,
            notes: input.notes,
          })
          .returning();
        if (!asset) throw new ConflictException("Não foi possível cadastrar o ativo.");
        await this.record(
          tx,
          identityId,
          organizationId,
          unitId,
          "management.inventory.asset-created",
          "inventory_asset",
          asset.id,
          { assetTag: asset.assetTag, status: asset.status },
        );
        return asset;
      },
    );
  }

  async updateInventoryAsset(
    identityId: string,
    organizationId: string,
    unitId: string,
    assetId: string,
    input: InventoryAssetUpdateInput,
  ) {
    await this.requireRole(identityId, organizationId, unitId, INVENTORY_ROLES);
    return this.database.db.transaction(async (tx) => {
      if (input.inventoryItemId) {
        const [item] = await tx
          .select({ id: managementInventoryItems.id })
          .from(managementInventoryItems)
          .where(
            and(
              eq(managementInventoryItems.organizationId, organizationId),
              eq(managementInventoryItems.unitId, unitId),
              eq(managementInventoryItems.id, input.inventoryItemId),
              eq(managementInventoryItems.kind, "reusable"),
            ),
          )
          .limit(1);
        if (!item) throw new BadRequestException("O ativo deve usar um item reutilizável.");
      }
      if (input.locationId) {
        const [location] = await tx
          .select({ id: managementStockLocations.id })
          .from(managementStockLocations)
          .where(
            and(
              eq(managementStockLocations.organizationId, organizationId),
              eq(managementStockLocations.unitId, unitId),
              eq(managementStockLocations.id, input.locationId),
              eq(managementStockLocations.active, true),
            ),
          )
          .limit(1);
        if (!location) throw new BadRequestException("Local do ativo não pertence a esta unidade.");
      }
      if (input.responsibleIdentityId) {
        const [person] = await tx
          .select({ id: managementPeople.id, active: managementPeople.active })
          .from(managementPeople)
          .where(
            and(
              eq(managementPeople.organizationId, organizationId),
              eq(managementPeople.unitId, unitId),
              eq(managementPeople.identityId, input.responsibleIdentityId),
              eq(managementPeople.active, true),
            ),
          )
          .limit(1);
        if (!person) throw new BadRequestException("Responsável não pertence a esta unidade.");
      }
      const [asset] = await tx
        .update(managementInventoryAssets)
        .set({
          ...(input.inventoryItemId === undefined
            ? {}
            : { inventoryItemId: input.inventoryItemId }),
          ...(input.locationId === undefined ? {} : { locationId: input.locationId }),
          ...(input.assetTag === undefined ? {} : { assetTag: input.assetTag.toUpperCase() }),
          ...(input.status === undefined ? {} : { status: input.status }),
          ...(input.condition === undefined ? {} : { condition: input.condition }),
          ...(input.responsibleIdentityId === undefined
            ? {}
            : { responsibleIdentityId: input.responsibleIdentityId }),
          ...(input.acquiredAt === undefined ? {} : { acquiredAt: new Date(input.acquiredAt) }),
          ...(input.lastMaintenanceAt === undefined
            ? {}
            : { lastMaintenanceAt: new Date(input.lastMaintenanceAt) }),
          ...(input.notes === undefined ? {} : { notes: input.notes }),
          version: input.version + 1,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(managementInventoryAssets.organizationId, organizationId),
            eq(managementInventoryAssets.unitId, unitId),
            eq(managementInventoryAssets.id, assetId),
            eq(managementInventoryAssets.version, input.version),
          ),
        )
        .returning();
      if (!asset)
        throw new ConflictException({
          code: "INVENTORY_ASSET_VERSION_CONFLICT",
          message: "O ativo foi alterado por outra pessoa. Atualize a tela e tente novamente.",
        });
      await this.record(
        tx,
        identityId,
        organizationId,
        unitId,
        "management.inventory.asset-updated",
        "inventory_asset",
        asset.id,
        { condition: asset.condition, status: asset.status },
      );
      return asset;
    });
  }

  async createInventoryReservation(
    identityId: string,
    organizationId: string,
    unitId: string,
    idempotencyKey: string,
    input: InventoryReservationInput,
  ) {
    await this.requireRole(identityId, organizationId, unitId, INVENTORY_ROLES);
    return this.idempotent(
      identityId,
      organizationId,
      unitId,
      idempotencyKey,
      "inventory-reservation.create",
      input,
      async (tx) => {
        await tx.execute(
          sql`select id from management_stock_balances where organization_id=${organizationId}::uuid and unit_id=${unitId}::uuid and location_id=${input.locationId}::uuid and inventory_item_id=${input.inventoryItemId}::uuid for update`,
        );
        const [balance] = await tx
          .select()
          .from(managementStockBalances)
          .where(
            and(
              eq(managementStockBalances.organizationId, organizationId),
              eq(managementStockBalances.unitId, unitId),
              eq(managementStockBalances.locationId, input.locationId),
              eq(managementStockBalances.inventoryItemId, input.inventoryItemId),
            ),
          )
          .limit(1);
        if (!balance) throw new NotFoundException("Saldo do item e local não encontrado.");
        const [reserved] = await tx
          .select({
            quantity: sql<string>`coalesce(sum(${managementInventoryReservations.quantity}), 0)`,
          })
          .from(managementInventoryReservations)
          .where(
            and(
              eq(managementInventoryReservations.organizationId, organizationId),
              eq(managementInventoryReservations.unitId, unitId),
              eq(managementInventoryReservations.locationId, input.locationId),
              eq(managementInventoryReservations.inventoryItemId, input.inventoryItemId),
              eq(managementInventoryReservations.status, "active"),
              or(
                isNull(managementInventoryReservations.expiresAt),
                sql`${managementInventoryReservations.expiresAt} > now()`,
              ),
            ),
          );
        if (
          quantityToMilli(balance.quantity) - quantityToMilli(reserved?.quantity ?? "0") <
          quantityToMilli(input.quantity)
        )
          throw new ConflictException({
            code: "INVENTORY_RESERVATION_INSUFFICIENT",
            message: "O saldo disponível não cobre esta reserva.",
          });
        const [reservation] = await tx
          .insert(managementInventoryReservations)
          .values({
            organizationId,
            unitId,
            inventoryItemId: input.inventoryItemId,
            locationId: input.locationId,
            quantity: String(input.quantity),
            sourceType: input.sourceType,
            sourceId: input.sourceId,
            reason: input.reason,
            expiresAt: input.expiresAt ? new Date(input.expiresAt) : undefined,
            idempotencyKey,
            actorIdentityId: identityId,
          })
          .returning();
        if (!reservation) throw new ConflictException("Não foi possível criar a reserva.");
        await this.record(
          tx,
          identityId,
          organizationId,
          unitId,
          "management.inventory.reservation-created",
          "inventory_reservation",
          reservation.id,
          input,
        );
        return reservation;
      },
    );
  }

  async resolveInventoryReservation(
    identityId: string,
    organizationId: string,
    unitId: string,
    reservationId: string,
    idempotencyKey: string,
    input: InventoryReservationResolutionInput,
  ) {
    await this.requireRole(identityId, organizationId, unitId, INVENTORY_ROLES);
    return this.idempotent(
      identityId,
      organizationId,
      unitId,
      idempotencyKey,
      "inventory-reservation.resolve",
      { reservationId, ...input },
      async (tx) => {
        await tx.execute(
          sql`select id from management_inventory_reservations where organization_id=${organizationId}::uuid and unit_id=${unitId}::uuid and id=${reservationId}::uuid for update`,
        );
        const [reservation] = await tx
          .select()
          .from(managementInventoryReservations)
          .where(
            and(
              eq(managementInventoryReservations.organizationId, organizationId),
              eq(managementInventoryReservations.unitId, unitId),
              eq(managementInventoryReservations.id, reservationId),
            ),
          )
          .limit(1);
        if (!reservation) throw new NotFoundException("Reserva não encontrada.");
        if (reservation.status !== "active") return reservation;
        if (input.decision === "consumed")
          await this.applyStockMovement(tx, organizationId, unitId, {
            locationId: reservation.locationId,
            inventoryItemId: reservation.inventoryItemId,
            quantityDeltaMilli: -quantityToMilli(reservation.quantity),
            type: "reservation_consumption",
            sourceType: "inventory_reservation",
            sourceId: reservation.id,
            actorIdentityId: identityId,
          });
        const now = new Date();
        const [updated] = await tx
          .update(managementInventoryReservations)
          .set({
            status: input.decision,
            resolvedByIdentityId: identityId,
            resolvedAt: now,
            updatedAt: now,
          })
          .where(eq(managementInventoryReservations.id, reservation.id))
          .returning();
        await this.record(
          tx,
          identityId,
          organizationId,
          unitId,
          `management.inventory.reservation-${input.decision}`,
          "inventory_reservation",
          reservation.id,
          { note: input.note },
        );
        return updated ?? reservation;
      },
    );
  }

  async generateCycleCountPlan(
    identityId: string,
    organizationId: string,
    unitId: string,
    idempotencyKey: string,
  ) {
    await this.requireRole(identityId, organizationId, unitId, INVENTORY_ROLES);
    return this.idempotent(
      identityId,
      organizationId,
      unitId,
      idempotencyKey,
      "inventory-cycle-plan.generate",
      {},
      async (tx) => {
        const [balances, movementCounts, expiryRows, existing] = await Promise.all([
          tx
            .select()
            .from(managementStockBalances)
            .where(
              and(
                eq(managementStockBalances.organizationId, organizationId),
                eq(managementStockBalances.unitId, unitId),
              ),
            ),
          tx
            .select({
              inventoryItemId: managementInventoryMovements.inventoryItemId,
              locationId: managementInventoryMovements.locationId,
              count: sql<number>`count(*)`.mapWith(Number),
            })
            .from(managementInventoryMovements)
            .where(
              and(
                eq(managementInventoryMovements.organizationId, organizationId),
                eq(managementInventoryMovements.unitId, unitId),
                gte(
                  managementInventoryMovements.occurredAt,
                  new Date(Date.now() - 90 * 86_400_000),
                ),
              ),
            )
            .groupBy(
              managementInventoryMovements.inventoryItemId,
              managementInventoryMovements.locationId,
            ),
          tx
            .select({
              inventoryItemId: managementInventoryLots.inventoryItemId,
              locationId: managementInventoryLots.locationId,
              expiresAt: sql<Date | null>`min(${managementInventoryLots.expiresAt})`,
            })
            .from(managementInventoryLots)
            .where(
              and(
                eq(managementInventoryLots.organizationId, organizationId),
                eq(managementInventoryLots.unitId, unitId),
                eq(managementInventoryLots.active, true),
                sql`${managementInventoryLots.quantity} > 0`,
              ),
            )
            .groupBy(managementInventoryLots.inventoryItemId, managementInventoryLots.locationId),
          tx
            .select()
            .from(managementInventoryCountSchedules)
            .where(
              and(
                eq(managementInventoryCountSchedules.organizationId, organizationId),
                eq(managementInventoryCountSchedules.unitId, unitId),
              ),
            ),
        ]);
        const now = new Date();
        const planned = [];
        for (const balance of balances) {
          const key = `${balance.inventoryItemId}:${balance.locationId}`;
          const current = existing.find(
            (row) => `${row.inventoryItemId}:${row.locationId}` === key,
          );
          const expiry = expiryRows.find(
            (row) => `${row.inventoryItemId}:${row.locationId}` === key,
          )?.expiresAt;
          const policy = cycleCountPolicy({
            inventoryValueCents: Math.round(
              Math.abs(Number(balance.quantity)) * (balance.averageCostCents ?? 0),
            ),
            movementCount90Days:
              movementCounts.find((row) => `${row.inventoryItemId}:${row.locationId}` === key)
                ?.count ?? 0,
            divergencePercent: 0,
            expiresWithinDays: expiry
              ? Math.ceil((expiry.getTime() - now.getTime()) / 86_400_000)
              : null,
          });
          const nextDueAt = current?.lastCountedAt
            ? new Date(current.lastCountedAt.getTime() + policy.frequencyDays * 86_400_000)
            : (current?.nextDueAt ?? now);
          const [schedule] = await tx
            .insert(managementInventoryCountSchedules)
            .values({
              organizationId,
              unitId,
              inventoryItemId: balance.inventoryItemId,
              locationId: balance.locationId,
              ...policy,
              nextDueAt,
              lastCountedAt: current?.lastCountedAt,
              updatedByIdentityId: identityId,
            })
            .onConflictDoUpdate({
              target: [
                managementInventoryCountSchedules.organizationId,
                managementInventoryCountSchedules.unitId,
                managementInventoryCountSchedules.inventoryItemId,
                managementInventoryCountSchedules.locationId,
              ],
              set: {
                ...policy,
                nextDueAt,
                active: true,
                updatedByIdentityId: identityId,
                updatedAt: now,
              },
            })
            .returning();
          if (schedule) planned.push(schedule);
        }
        await this.record(
          tx,
          identityId,
          organizationId,
          unitId,
          "management.inventory.cycle-plan-generated",
          "inventory_cycle_plan",
          unitId,
          { schedules: planned.length },
        );
        return { schedules: planned };
      },
    );
  }

  async createProductionBatch(
    identityId: string,
    organizationId: string,
    unitId: string,
    idempotencyKey: string,
    input: ProductionBatchInput,
  ) {
    await this.requireRole(identityId, organizationId, unitId, INVENTORY_ROLES);
    const uniqueInputs = new Set(
      input.inputs.map((line) => `${line.inventoryItemId}:${line.locationId}`),
    );
    if (uniqueInputs.size !== input.inputs.length)
      throw new BadRequestException("Não repita o mesmo insumo, local e lote.");
    return this.idempotent(
      identityId,
      organizationId,
      unitId,
      idempotencyKey,
      "inventory-production.create",
      input,
      async (tx) => {
        await this.requireInventoryItem(tx, organizationId, unitId, input.outputInventoryItemId, [
          "ingredient",
          "prepared",
        ]);
        const batchId = randomUUID();
        const [batch] = await tx
          .insert(managementProductionBatches)
          .values({
            id: batchId,
            organizationId,
            unitId,
            outputInventoryItemId: input.outputInventoryItemId,
            outputLocationId: input.outputLocationId,
            batchCode: input.batchCode,
            plannedQuantity: String(input.plannedQuantity),
            expiresAt: input.expiresAt ? new Date(input.expiresAt) : undefined,
            notes: input.notes,
            idempotencyKey,
            createdByIdentityId: identityId,
          })
          .returning();
        if (!batch) throw new ConflictException("Não foi possível planejar a produção.");
        for (const line of input.inputs) {
          await tx.execute(
            sql`select id from management_stock_balances where organization_id=${organizationId}::uuid and unit_id=${unitId}::uuid and location_id=${line.locationId}::uuid and inventory_item_id=${line.inventoryItemId}::uuid for update`,
          );
          const [stock] = await tx
            .select()
            .from(managementStockBalances)
            .where(
              and(
                eq(managementStockBalances.organizationId, organizationId),
                eq(managementStockBalances.unitId, unitId),
                eq(managementStockBalances.locationId, line.locationId),
                eq(managementStockBalances.inventoryItemId, line.inventoryItemId),
              ),
            )
            .limit(1);
          if (!stock) throw new NotFoundException("Saldo do insumo de produção não encontrado.");
          const [reserved] = await tx
            .select({
              quantity: sql<string>`coalesce(sum(${managementInventoryReservations.quantity}), 0)`,
            })
            .from(managementInventoryReservations)
            .where(
              and(
                eq(managementInventoryReservations.organizationId, organizationId),
                eq(managementInventoryReservations.unitId, unitId),
                eq(managementInventoryReservations.locationId, line.locationId),
                eq(managementInventoryReservations.inventoryItemId, line.inventoryItemId),
                eq(managementInventoryReservations.status, "active"),
              ),
            );
          if (
            quantityToMilli(stock.quantity) - quantityToMilli(reserved?.quantity ?? "0") <
            quantityToMilli(line.plannedQuantity)
          )
            throw new ConflictException({
              code: "PRODUCTION_INPUT_INSUFFICIENT",
              message: "Saldo disponível insuficiente para os insumos planejados.",
            });
          const inputId = randomUUID();
          await tx.insert(managementProductionBatchInputs).values({
            id: inputId,
            organizationId,
            unitId,
            productionBatchId: batch.id,
            inventoryItemId: line.inventoryItemId,
            locationId: line.locationId,
            lotId: line.lotId,
            plannedQuantity: String(line.plannedQuantity),
            unitCostCents: stock.averageCostCents,
          });
          await tx.insert(managementInventoryReservations).values({
            organizationId,
            unitId,
            inventoryItemId: line.inventoryItemId,
            locationId: line.locationId,
            quantity: String(line.plannedQuantity),
            sourceType: "production_batch",
            sourceId: batch.id,
            reason: `Produção ${batch.batchCode}`,
            idempotencyKey: `${idempotencyKey}:${inputId}`,
            actorIdentityId: identityId,
          });
        }
        await this.record(
          tx,
          identityId,
          organizationId,
          unitId,
          "management.inventory.production-planned",
          "production_batch",
          batch.id,
          { batchCode: batch.batchCode },
        );
        return batch;
      },
    );
  }

  async completeProductionBatch(
    identityId: string,
    organizationId: string,
    unitId: string,
    batchId: string,
    idempotencyKey: string,
    input: ProductionBatchCompletionInput,
  ) {
    await this.requireRole(identityId, organizationId, unitId, INVENTORY_ROLES);
    if (new Set(input.inputs.map((line) => line.inputId)).size !== input.inputs.length)
      throw new BadRequestException("Nao repita um insumo na conclusao da producao.");
    return this.idempotent(
      identityId,
      organizationId,
      unitId,
      idempotencyKey,
      "inventory-production.complete",
      { batchId, ...input },
      async (tx) => {
        await tx.execute(
          sql`select id from management_production_batches where organization_id=${organizationId}::uuid and unit_id=${unitId}::uuid and id=${batchId}::uuid for update`,
        );
        const [batch] = await tx
          .select()
          .from(managementProductionBatches)
          .where(
            and(
              eq(managementProductionBatches.organizationId, organizationId),
              eq(managementProductionBatches.unitId, unitId),
              eq(managementProductionBatches.id, batchId),
            ),
          )
          .limit(1);
        if (!batch) throw new NotFoundException("Lote de producao nao encontrado.");
        if (batch.status !== "planned")
          throw new ConflictException({
            code: "PRODUCTION_BATCH_ALREADY_RESOLVED",
            message: "A producao ja foi concluida ou cancelada.",
          });
        const lines = await tx
          .select()
          .from(managementProductionBatchInputs)
          .where(eq(managementProductionBatchInputs.productionBatchId, batch.id));
        if (
          lines.length !== input.inputs.length ||
          input.inputs.some((line) => !lines.some((stored) => stored.id === line.inputId))
        )
          throw new BadRequestException("Informe o consumo real de todos os insumos planejados.");
        let totalCostCents = 0;
        for (const actual of input.inputs) {
          const line = lines.find((stored) => stored.id === actual.inputId);
          if (!line) continue;
          const actualMilli = quantityToMilli(actual.actualQuantity);
          const movement = await this.applyStockMovement(tx, organizationId, unitId, {
            locationId: line.locationId,
            inventoryItemId: line.inventoryItemId,
            lotId: line.lotId,
            quantityDeltaMilli: -actualMilli,
            unitCostCents: line.unitCostCents,
            type: "production_input",
            sourceType: "production_batch_input",
            sourceId: line.id,
            actorIdentityId: identityId,
          });
          totalCostCents += Math.round(
            (actualMilli * (line.unitCostCents ?? movement.averageCostCents ?? 0)) / 1_000,
          );
          await tx
            .update(managementProductionBatchInputs)
            .set({ actualQuantity: String(actual.actualQuantity) })
            .where(eq(managementProductionBatchInputs.id, line.id));
          await tx
            .update(managementInventoryReservations)
            .set({
              status: "consumed",
              resolvedByIdentityId: identityId,
              resolvedAt: new Date(),
              updatedAt: new Date(),
            })
            .where(
              and(
                eq(managementInventoryReservations.organizationId, organizationId),
                eq(managementInventoryReservations.unitId, unitId),
                eq(managementInventoryReservations.sourceType, "production_batch"),
                eq(managementInventoryReservations.sourceId, batch.id),
                eq(managementInventoryReservations.inventoryItemId, line.inventoryItemId),
                eq(managementInventoryReservations.locationId, line.locationId),
                eq(managementInventoryReservations.status, "active"),
              ),
            );
        }
        const actualMilli = quantityToMilli(input.actualQuantity);
        const unitCostCents = Math.round((totalCostCents * 1_000) / actualMilli);
        const lotId = randomUUID();
        await tx.insert(managementInventoryLots).values({
          id: lotId,
          organizationId,
          unitId,
          locationId: batch.outputLocationId,
          inventoryItemId: batch.outputInventoryItemId,
          batchCode: batch.batchCode,
          expiresAt: input.expiresAt ? new Date(input.expiresAt) : batch.expiresAt,
          quantity: "0",
          unitCostCents,
        });
        await this.applyStockMovement(tx, organizationId, unitId, {
          locationId: batch.outputLocationId,
          inventoryItemId: batch.outputInventoryItemId,
          lotId,
          quantityDeltaMilli: actualMilli,
          unitCostCents,
          type: "production_output",
          sourceType: "production_batch",
          sourceId: batch.id,
          actorIdentityId: identityId,
        });
        const now = new Date();
        const [completed] = await tx
          .update(managementProductionBatches)
          .set({
            outputLotId: lotId,
            actualQuantity: String(input.actualQuantity),
            expiresAt: input.expiresAt ? new Date(input.expiresAt) : batch.expiresAt,
            status: "completed",
            completedByIdentityId: identityId,
            completedAt: now,
            updatedAt: now,
          })
          .where(eq(managementProductionBatches.id, batch.id))
          .returning();
        await this.record(
          tx,
          identityId,
          organizationId,
          unitId,
          "management.inventory.production-completed",
          "production_batch",
          batch.id,
          { actualQuantity: input.actualQuantity, unitCostCents },
        );
        return completed ?? batch;
      },
    );
  }

  async cancelProductionBatch(
    identityId: string,
    organizationId: string,
    unitId: string,
    batchId: string,
    idempotencyKey: string,
    input: ProductionBatchCancellationInput,
  ) {
    await this.requireRole(identityId, organizationId, unitId, INVENTORY_ROLES);
    return this.idempotent(
      identityId,
      organizationId,
      unitId,
      idempotencyKey,
      "inventory-production.cancel",
      { batchId, ...input },
      async (tx) => {
        await tx.execute(
          sql`select id from management_production_batches where organization_id=${organizationId}::uuid and unit_id=${unitId}::uuid and id=${batchId}::uuid for update`,
        );
        const [batch] = await tx
          .select()
          .from(managementProductionBatches)
          .where(
            and(
              eq(managementProductionBatches.organizationId, organizationId),
              eq(managementProductionBatches.unitId, unitId),
              eq(managementProductionBatches.id, batchId),
            ),
          )
          .limit(1);
        if (!batch) throw new NotFoundException("Lote de producao nao encontrado.");
        if (batch.status !== "planned") return batch;
        const now = new Date();
        await tx
          .update(managementInventoryReservations)
          .set({
            status: "released",
            resolvedByIdentityId: identityId,
            resolvedAt: now,
            updatedAt: now,
          })
          .where(
            and(
              eq(managementInventoryReservations.organizationId, organizationId),
              eq(managementInventoryReservations.unitId, unitId),
              eq(managementInventoryReservations.sourceType, "production_batch"),
              eq(managementInventoryReservations.sourceId, batch.id),
              eq(managementInventoryReservations.status, "active"),
            ),
          );
        const [canceled] = await tx
          .update(managementProductionBatches)
          .set({
            status: "canceled",
            canceledByIdentityId: identityId,
            canceledAt: now,
            notes: batch.notes ? `${batch.notes}\nCancelamento: ${input.reason}` : input.reason,
            updatedAt: now,
          })
          .where(eq(managementProductionBatches.id, batch.id))
          .returning();
        await this.record(
          tx,
          identityId,
          organizationId,
          unitId,
          "management.inventory.production-canceled",
          "production_batch",
          batch.id,
          { reason: input.reason },
        );
        return canceled ?? batch;
      },
    );
  }

  async createInterunitTransfer(
    identityId: string,
    organizationId: string,
    unitId: string,
    idempotencyKey: string,
    input: InterunitTransferInput,
  ) {
    await this.requireRole(identityId, organizationId, unitId, INVENTORY_ROLES);
    await this.requireRole(identityId, organizationId, input.destinationUnitId, INVENTORY_ROLES);
    if (input.destinationUnitId === unitId)
      throw new BadRequestException("A unidade de destino deve ser diferente da origem.");
    const keys = input.lines.map(
      (line) => `${line.sourceInventoryItemId}:${line.sourceLocationId}`,
    );
    if (new Set(keys).size !== keys.length)
      throw new BadRequestException("Nao repita o mesmo item e local na transferencia.");
    return this.idempotent(
      identityId,
      organizationId,
      unitId,
      idempotencyKey,
      "inventory-interunit-transfer.create",
      input,
      async (tx) => {
        const [transfer] = await tx
          .insert(managementInterunitTransfers)
          .values({
            organizationId,
            sourceUnitId: unitId,
            destinationUnitId: input.destinationUnitId,
            reason: input.reason,
            idempotencyKey,
            sentByIdentityId: identityId,
          })
          .returning();
        if (!transfer) throw new ConflictException("Nao foi possivel criar a transferencia.");
        const createdLines = [];
        for (const line of input.lines) {
          await this.requireInventoryItem(
            tx,
            organizationId,
            input.destinationUnitId,
            line.destinationInventoryItemId,
          );
          const [destinationLocation] = await tx
            .select({ id: managementStockLocations.id })
            .from(managementStockLocations)
            .where(
              and(
                eq(managementStockLocations.organizationId, organizationId),
                eq(managementStockLocations.unitId, input.destinationUnitId),
                eq(managementStockLocations.id, line.destinationLocationId),
                eq(managementStockLocations.active, true),
              ),
            )
            .limit(1);
          if (!destinationLocation)
            throw new NotFoundException("Local de estoque da unidade de destino nao encontrado.");
          let batchCode: string | undefined;
          let expiresAt: Date | undefined;
          if (line.sourceLotId) {
            const [lot] = await tx
              .select()
              .from(managementInventoryLots)
              .where(
                and(
                  eq(managementInventoryLots.organizationId, organizationId),
                  eq(managementInventoryLots.unitId, unitId),
                  eq(managementInventoryLots.id, line.sourceLotId),
                  eq(managementInventoryLots.locationId, line.sourceLocationId),
                  eq(managementInventoryLots.inventoryItemId, line.sourceInventoryItemId),
                  eq(managementInventoryLots.active, true),
                ),
              )
              .limit(1);
            if (!lot) throw new NotFoundException("Lote de origem nao encontrado.");
            batchCode = lot.batchCode;
            expiresAt = lot.expiresAt ?? undefined;
          }
          const lineId = randomUUID();
          const [createdLine] = await tx
            .insert(managementInterunitTransferLines)
            .values({
              id: lineId,
              organizationId,
              sourceUnitId: unitId,
              destinationUnitId: input.destinationUnitId,
              transferId: transfer.id,
              sourceInventoryItemId: line.sourceInventoryItemId,
              destinationInventoryItemId: line.destinationInventoryItemId,
              sourceLocationId: line.sourceLocationId,
              destinationLocationId: line.destinationLocationId,
              sourceLotId: line.sourceLotId,
              quantitySent: String(line.quantity),
              batchCode,
              expiresAt,
            })
            .returning();
          const movement = await this.applyStockMovement(tx, organizationId, unitId, {
            locationId: line.sourceLocationId,
            inventoryItemId: line.sourceInventoryItemId,
            lotId: line.sourceLotId,
            quantityDeltaMilli: -quantityToMilli(line.quantity),
            type: "interunit_transfer_out",
            sourceType: "interunit_transfer_line",
            sourceId: lineId,
            actorIdentityId: identityId,
          });
          await tx
            .update(managementInterunitTransferLines)
            .set({ unitCostCents: movement.averageCostCents })
            .where(eq(managementInterunitTransferLines.id, lineId));
          if (createdLine)
            createdLines.push({ ...createdLine, unitCostCents: movement.averageCostCents });
        }
        await this.record(
          tx,
          identityId,
          organizationId,
          unitId,
          "management.inventory.interunit-transfer-sent",
          "interunit_transfer",
          transfer.id,
          { destinationUnitId: input.destinationUnitId, lineCount: createdLines.length },
        );
        return { ...transfer, lines: createdLines };
      },
    );
  }

  async receiveInterunitTransfer(
    identityId: string,
    organizationId: string,
    unitId: string,
    transferId: string,
    idempotencyKey: string,
    input: InterunitTransferReceiptInput,
  ) {
    const [visible] = await this.database.db
      .select()
      .from(managementInterunitTransfers)
      .where(
        and(
          eq(managementInterunitTransfers.organizationId, organizationId),
          eq(managementInterunitTransfers.destinationUnitId, unitId),
          eq(managementInterunitTransfers.id, transferId),
        ),
      )
      .limit(1);
    if (!visible) throw new NotFoundException("Transferencia nao encontrada para esta unidade.");
    await this.requireRole(identityId, organizationId, visible.sourceUnitId, INVENTORY_ROLES);
    await this.requireRole(identityId, organizationId, unitId, INVENTORY_ROLES);
    if (new Set(input.lines.map((line) => line.lineId)).size !== input.lines.length)
      throw new BadRequestException("Nao repita uma linha no recebimento.");
    return this.idempotent(
      identityId,
      organizationId,
      unitId,
      idempotencyKey,
      "inventory-interunit-transfer.receive",
      { transferId, ...input },
      async (tx) => {
        await tx.execute(
          sql`select id from management_interunit_transfers where organization_id=${organizationId}::uuid and destination_unit_id=${unitId}::uuid and id=${transferId}::uuid for update`,
        );
        const [transfer] = await tx
          .select()
          .from(managementInterunitTransfers)
          .where(eq(managementInterunitTransfers.id, transferId))
          .limit(1);
        if (!transfer) throw new NotFoundException("Transferencia nao encontrada.");
        if (!["in_transit", "partially_received"].includes(transfer.status))
          throw new ConflictException("A transferencia ja foi encerrada.");
        const storedLines = await tx
          .select()
          .from(managementInterunitTransferLines)
          .where(eq(managementInterunitTransferLines.transferId, transfer.id));
        const receiptId = randomUUID();
        for (const received of input.lines) {
          const line = storedLines.find((stored) => stored.id === received.lineId);
          if (!line) throw new BadRequestException("Linha de transferencia invalida.");
          const receivedMilli = quantityToMilli(received.quantity);
          const remainingMilli =
            quantityToMilli(line.quantitySent) - quantityToMilli(line.quantityReceived);
          if (receivedMilli > remainingMilli)
            throw new ConflictException({
              code: "INTERUNIT_RECEIPT_EXCEEDS_REMAINING",
              message: "A quantidade recebida excede o saldo em transito.",
            });
          let destinationLotId: string | undefined;
          if (line.batchCode) {
            const [newLot] = await tx
              .insert(managementInventoryLots)
              .values({
                organizationId,
                unitId,
                locationId: line.destinationLocationId,
                inventoryItemId: line.destinationInventoryItemId,
                batchCode: line.batchCode,
                expiresAt: line.expiresAt,
                quantity: "0",
                unitCostCents: line.unitCostCents,
              })
              .onConflictDoNothing({
                target: [
                  managementInventoryLots.organizationId,
                  managementInventoryLots.unitId,
                  managementInventoryLots.locationId,
                  managementInventoryLots.inventoryItemId,
                  managementInventoryLots.batchCode,
                ],
              })
              .returning({ id: managementInventoryLots.id });
            if (newLot) destinationLotId = newLot.id;
            else {
              const [existingLot] = await tx
                .select({ id: managementInventoryLots.id })
                .from(managementInventoryLots)
                .where(
                  and(
                    eq(managementInventoryLots.organizationId, organizationId),
                    eq(managementInventoryLots.unitId, unitId),
                    eq(managementInventoryLots.locationId, line.destinationLocationId),
                    eq(managementInventoryLots.inventoryItemId, line.destinationInventoryItemId),
                    eq(managementInventoryLots.batchCode, line.batchCode),
                    eq(managementInventoryLots.active, true),
                  ),
                )
                .limit(1);
              destinationLotId = existingLot?.id;
              if (!destinationLotId)
                throw new ConflictException({
                  code: "INTERUNIT_DESTINATION_LOT_INACTIVE",
                  message: "O lote correspondente existe no destino, mas esta inativo.",
                });
            }
          }
          await this.applyStockMovement(tx, organizationId, unitId, {
            locationId: line.destinationLocationId,
            inventoryItemId: line.destinationInventoryItemId,
            lotId: destinationLotId,
            quantityDeltaMilli: receivedMilli,
            unitCostCents: line.unitCostCents,
            type: "interunit_transfer_in",
            sourceType: "interunit_transfer_receipt",
            sourceId: randomUUID(),
            actorIdentityId: identityId,
          });
          line.quantityReceived = milliToQuantity(
            quantityToMilli(line.quantityReceived) + receivedMilli,
          );
          await tx
            .update(managementInterunitTransferLines)
            .set({ quantityReceived: line.quantityReceived })
            .where(eq(managementInterunitTransferLines.id, line.id));
        }
        await tx.insert(managementInterunitTransferReceipts).values({
          id: receiptId,
          organizationId,
          sourceUnitId: transfer.sourceUnitId,
          transferId: transfer.id,
          lines: input.lines.map((line) => ({
            lineId: line.lineId,
            quantity: String(line.quantity),
          })),
          note: input.note,
          idempotencyKey,
          receivedByIdentityId: identityId,
        });
        const completed = storedLines.every(
          (line) => quantityToMilli(line.quantityReceived) === quantityToMilli(line.quantitySent),
        );
        const now = new Date();
        const [updated] = await tx
          .update(managementInterunitTransfers)
          .set({
            status: completed ? "received" : "partially_received",
            lastReceivedByIdentityId: identityId,
            lastReceivedAt: now,
            updatedAt: now,
          })
          .where(eq(managementInterunitTransfers.id, transfer.id))
          .returning();
        await this.record(
          tx,
          identityId,
          organizationId,
          unitId,
          "management.inventory.interunit-transfer-received",
          "interunit_transfer",
          transfer.id,
          { receiptId, completed, note: input.note },
        );
        return updated ?? transfer;
      },
    );
  }

  async cancelInterunitTransfer(
    identityId: string,
    organizationId: string,
    unitId: string,
    transferId: string,
    idempotencyKey: string,
    input: InterunitTransferCancellationInput,
  ) {
    await this.requireRole(identityId, organizationId, unitId, INVENTORY_ROLES);
    return this.idempotent(
      identityId,
      organizationId,
      unitId,
      idempotencyKey,
      "inventory-interunit-transfer.cancel",
      { transferId, ...input },
      async (tx) => {
        await tx.execute(
          sql`select id from management_interunit_transfers where organization_id=${organizationId}::uuid and source_unit_id=${unitId}::uuid and id=${transferId}::uuid for update`,
        );
        const [transfer] = await tx
          .select()
          .from(managementInterunitTransfers)
          .where(
            and(
              eq(managementInterunitTransfers.organizationId, organizationId),
              eq(managementInterunitTransfers.sourceUnitId, unitId),
              eq(managementInterunitTransfers.id, transferId),
            ),
          )
          .limit(1);
        if (!transfer) throw new NotFoundException("Transferencia nao encontrada.");
        if (!["in_transit", "partially_received"].includes(transfer.status)) return transfer;
        const lines = await tx
          .select()
          .from(managementInterunitTransferLines)
          .where(eq(managementInterunitTransferLines.transferId, transfer.id));
        for (const line of lines) {
          const remainingMilli =
            quantityToMilli(line.quantitySent) - quantityToMilli(line.quantityReceived);
          if (remainingMilli <= 0) continue;
          await this.applyStockMovement(tx, organizationId, unitId, {
            locationId: line.sourceLocationId,
            inventoryItemId: line.sourceInventoryItemId,
            lotId: line.sourceLotId,
            quantityDeltaMilli: remainingMilli,
            unitCostCents: line.unitCostCents,
            type: "interunit_transfer_cancel",
            sourceType: "interunit_transfer_cancel",
            sourceId: line.id,
            actorIdentityId: identityId,
          });
        }
        const now = new Date();
        const [canceled] = await tx
          .update(managementInterunitTransfers)
          .set({
            status: "canceled",
            canceledByIdentityId: identityId,
            canceledAt: now,
            cancelReason: input.reason,
            updatedAt: now,
          })
          .where(eq(managementInterunitTransfers.id, transfer.id))
          .returning();
        await this.record(
          tx,
          identityId,
          organizationId,
          unitId,
          "management.inventory.interunit-transfer-canceled",
          "interunit_transfer",
          transfer.id,
          { reason: input.reason },
        );
        return canceled ?? transfer;
      },
    );
  }

  async closeInventoryPeriod(
    identityId: string,
    organizationId: string,
    unitId: string,
    idempotencyKey: string,
    input: InventoryClosingInput,
  ) {
    await this.requireRole(identityId, organizationId, unitId, ["owner", "manager"]);
    if (input.period > new Date().toISOString().slice(0, 7))
      throw new BadRequestException("Nao e possivel fechar um periodo futuro.");
    return this.idempotent(
      identityId,
      organizationId,
      unitId,
      idempotencyKey,
      "inventory-closing.create",
      input,
      async (tx) => {
        await tx.execute(
          sql`select pg_advisory_xact_lock(hashtextextended(${`inventory-closing:${organizationId}:${unitId}:${input.period}:${input.locationId ?? "all"}:${input.shiftReference ?? "all"}`}, 0))`,
        );
        const period = `${input.period}-01`;
        const [existing] = await tx
          .select()
          .from(managementInventoryClosings)
          .where(
            and(
              eq(managementInventoryClosings.organizationId, organizationId),
              eq(managementInventoryClosings.unitId, unitId),
              eq(managementInventoryClosings.period, period),
              input.locationId
                ? eq(managementInventoryClosings.locationId, input.locationId)
                : isNull(managementInventoryClosings.locationId),
              input.shiftReference
                ? eq(managementInventoryClosings.shiftReference, input.shiftReference)
                : isNull(managementInventoryClosings.shiftReference),
            ),
          )
          .limit(1);
        if (existing)
          throw new ConflictException({
            code: "INVENTORY_PERIOD_ALREADY_CLOSED",
            message: "Este periodo ja possui um fechamento imutavel.",
          });
        const [balances, reservations] = await Promise.all([
          tx
            .select()
            .from(managementStockBalances)
            .where(
              and(
                eq(managementStockBalances.organizationId, organizationId),
                eq(managementStockBalances.unitId, unitId),
                input.locationId
                  ? eq(managementStockBalances.locationId, input.locationId)
                  : undefined,
              ),
            ),
          tx
            .select({
              inventoryItemId: managementInventoryReservations.inventoryItemId,
              locationId: managementInventoryReservations.locationId,
              quantity: sql<string>`sum(${managementInventoryReservations.quantity})`.mapWith(
                String,
              ),
            })
            .from(managementInventoryReservations)
            .where(
              and(
                eq(managementInventoryReservations.organizationId, organizationId),
                eq(managementInventoryReservations.unitId, unitId),
                eq(managementInventoryReservations.status, "active"),
                input.locationId
                  ? eq(managementInventoryReservations.locationId, input.locationId)
                  : undefined,
                or(
                  isNull(managementInventoryReservations.expiresAt),
                  sql`${managementInventoryReservations.expiresAt} > now()`,
                ),
              ),
            )
            .groupBy(
              managementInventoryReservations.inventoryItemId,
              managementInventoryReservations.locationId,
            ),
        ]);
        const closingId = randomUUID();
        const lines = balances.map((balance) => {
          const reserved =
            reservations.find(
              (row) =>
                row.inventoryItemId === balance.inventoryItemId &&
                row.locationId === balance.locationId,
            )?.quantity ?? "0";
          return {
            id: randomUUID(),
            organizationId,
            unitId,
            closingId,
            inventoryItemId: balance.inventoryItemId,
            locationId: balance.locationId,
            quantity: balance.quantity,
            reservedQuantity: reserved,
            averageCostCents: balance.averageCostCents,
            valueCents: Math.round(Number(balance.quantity) * (balance.averageCostCents ?? 0)),
          };
        });
        const totalValueCents = lines.reduce((total, line) => total + line.valueCents, 0);
        const totalReservedValueCents = lines.reduce(
          (total, line) =>
            total + Math.round(Number(line.reservedQuantity) * (line.averageCostCents ?? 0)),
          0,
        );
        const [closing] = await tx
          .insert(managementInventoryClosings)
          .values({
            id: closingId,
            organizationId,
            unitId,
            locationId: input.locationId,
            shiftReference: input.shiftReference,
            period,
            totalValueCents,
            totalReservedValueCents,
            lineCount: lines.length,
            notes: input.notes,
            idempotencyKey,
            closedByIdentityId: identityId,
          })
          .returning();
        if (!closing) throw new ConflictException("Nao foi possivel fechar o periodo.");
        if (lines.length) await tx.insert(managementInventoryClosingLines).values(lines);
        await this.record(
          tx,
          identityId,
          organizationId,
          unitId,
          "management.inventory.period-closed",
          "inventory_closing",
          closingId,
          {
            period: input.period,
            locationId: input.locationId ?? null,
            shiftReference: input.shiftReference ?? null,
            totalValueCents,
            lineCount: lines.length,
          },
        );
        return closing;
      },
    );
  }

  async listRecipeConfigurations(identityId: string, organizationId: string, unitId: string) {
    await this.requireRole(identityId, organizationId, unitId, INVENTORY_ROLES);
    const versions = await this.database.db
      .select()
      .from(managementRecipeVersions)
      .where(
        and(
          eq(managementRecipeVersions.organizationId, organizationId),
          eq(managementRecipeVersions.unitId, unitId),
          isNull(managementRecipeVersions.validUntil),
        ),
      )
      .orderBy(managementRecipeVersions.productId);
    if (versions.length === 0) return [];
    const components = await this.database.db
      .select()
      .from(managementRecipeComponents)
      .where(
        and(
          eq(managementRecipeComponents.organizationId, organizationId),
          eq(managementRecipeComponents.unitId, unitId),
          inArray(
            managementRecipeComponents.recipeVersionId,
            versions.map((version) => version.id),
          ),
        ),
      );
    return versions.map((version) => ({
      ...version,
      components: components.filter((component) => component.recipeVersionId === version.id),
    }));
  }

  async configureRecipe(
    identityId: string,
    organizationId: string,
    unitId: string,
    idempotencyKey: string,
    input: RecipeConfigurationInput,
  ) {
    await this.requireRole(identityId, organizationId, unitId, INVENTORY_ROLES);
    const componentKeys = input.components.map(
      (component) => `${component.inventoryItemId}:${component.locationId}`,
    );
    if (new Set(componentKeys).size !== componentKeys.length) {
      throw new BadRequestException({
        code: "RECIPE_COMPONENT_DUPLICATE",
        message: "Cada item e local deve aparecer uma única vez na ficha técnica.",
      });
    }
    return this.idempotent(
      identityId,
      organizationId,
      unitId,
      idempotencyKey,
      "recipe.configure",
      input,
      async (tx) => {
        await tx.execute(
          sql`select pg_advisory_xact_lock(hashtext(${`management-recipe:${organizationId}:${unitId}:${input.productId}`}))`,
        );
        await this.requireProduct(tx, organizationId, input.productId);
        const itemIds = [
          ...new Set(input.components.map((component) => component.inventoryItemId)),
        ];
        const locationIds = [...new Set(input.components.map((component) => component.locationId))];
        const [items, locations] = await Promise.all([
          tx
            .select({ id: managementInventoryItems.id, kind: managementInventoryItems.kind })
            .from(managementInventoryItems)
            .where(
              and(
                eq(managementInventoryItems.organizationId, organizationId),
                eq(managementInventoryItems.unitId, unitId),
                eq(managementInventoryItems.active, true),
                inArray(managementInventoryItems.id, itemIds),
              ),
            ),
          tx
            .select({ id: managementStockLocations.id })
            .from(managementStockLocations)
            .where(
              and(
                eq(managementStockLocations.organizationId, organizationId),
                eq(managementStockLocations.unitId, unitId),
                eq(managementStockLocations.active, true),
                inArray(managementStockLocations.id, locationIds),
              ),
            ),
        ]);
        if (items.length !== itemIds.length || locations.length !== locationIds.length) {
          throw new NotFoundException({
            code: "RECIPE_INVENTORY_SCOPE_INVALID",
            message: "Item ou local de estoque não pertence a esta unidade.",
          });
        }
        if (items.some((item) => item.kind !== "ingredient"))
          throw new ConflictException({
            code: "RECIPE_COMPONENT_KIND_INVALID",
            message: "Fichas técnicas aceitam somente itens do tipo insumo.",
          });
        const [latest] = await tx
          .select({
            version: managementRecipeVersions.version,
            validFrom: managementRecipeVersions.validFrom,
          })
          .from(managementRecipeVersions)
          .where(
            and(
              eq(managementRecipeVersions.organizationId, organizationId),
              eq(managementRecipeVersions.unitId, unitId),
              eq(managementRecipeVersions.productId, input.productId),
            ),
          )
          .orderBy(desc(managementRecipeVersions.version))
          .limit(1);
        const validFrom = new Date(Math.max(Date.now(), (latest?.validFrom.getTime() ?? 0) + 1));
        await tx
          .update(managementRecipeVersions)
          .set({ validUntil: validFrom })
          .where(
            and(
              eq(managementRecipeVersions.organizationId, organizationId),
              eq(managementRecipeVersions.unitId, unitId),
              eq(managementRecipeVersions.productId, input.productId),
              isNull(managementRecipeVersions.validUntil),
            ),
          );
        const recipeVersionId = randomUUID();
        const version = (latest?.version ?? 0) + 1;
        await tx.insert(managementRecipeVersions).values({
          id: recipeVersionId,
          organizationId,
          unitId,
          productId: input.productId,
          version,
          validFrom,
          createdByIdentityId: identityId,
        });
        await tx.insert(managementRecipeComponents).values(
          input.components.map((component) => ({
            id: randomUUID(),
            organizationId,
            unitId,
            recipeVersionId,
            ...component,
          })),
        );
        await this.record(
          tx,
          identityId,
          organizationId,
          unitId,
          "management.recipe.configured",
          "recipe_version",
          recipeVersionId,
          { productId: input.productId, version, componentCount: input.components.length },
        );
        return {
          recipeVersionId,
          productId: input.productId,
          version,
          validFrom: validFrom.toISOString(),
          components: input.components,
        };
      },
    );
  }

  async createSupplier(
    identityId: string,
    organizationId: string,
    unitId: string,
    idempotencyKey: string,
    input: SupplierInput,
  ) {
    await this.requireRole(identityId, organizationId, unitId, [...INVENTORY_ROLES, "finance"]);
    return this.idempotent(
      identityId,
      organizationId,
      unitId,
      idempotencyKey,
      "supplier-create",
      input,
      async (tx) => {
        const id = randomUUID();
        const normalizedDocument = input.document
          ? normalizeBusinessDocument(input.document)
          : null;
        if (input.document && !normalizedDocument)
          throw new BadRequestException({
            code: "INVALID_SUPPLIER_DOCUMENT",
            message: "Documento do fornecedor inválido.",
          });
        const [supplier] = await tx
          .insert(managementSuppliers)
          .values({ id, organizationId, unitId, ...input, normalizedDocument })
          .onConflictDoNothing()
          .returning();
        if (!supplier)
          throw new ConflictException({
            code: "SUPPLIER_DOCUMENT_ALREADY_EXISTS",
            message: "Já existe fornecedor com este documento na unidade.",
          });
        await this.record(
          tx,
          identityId,
          organizationId,
          unitId,
          "management.supplier.created",
          "supplier",
          id,
          { normalizedDocument },
        );
        return supplier;
      },
    );
  }

  async updateSupplier(
    identityId: string,
    organizationId: string,
    unitId: string,
    supplierId: string,
    idempotencyKey: string,
    input: SupplierUpdateInput,
  ) {
    await this.requireRole(identityId, organizationId, unitId, [...INVENTORY_ROLES, "finance"]);
    return this.idempotent(
      identityId,
      organizationId,
      unitId,
      idempotencyKey,
      "supplier-update",
      { supplierId, ...input },
      async (tx) => {
        const [existing] = await tx
          .select()
          .from(managementSuppliers)
          .where(
            and(
              eq(managementSuppliers.organizationId, organizationId),
              eq(managementSuppliers.unitId, unitId),
              eq(managementSuppliers.id, supplierId),
            ),
          )
          .limit(1);
        if (!existing)
          throw new NotFoundException({
            code: "SUPPLIER_NOT_FOUND",
            message: "Fornecedor não encontrado.",
          });
        if (input.version !== existing.version)
          throw new ConflictException({
            code: "SUPPLIER_VERSION_CONFLICT",
            message: "O fornecedor foi alterado por outra operação.",
          });
        const { version: _version, ...changes } = input;
        const normalizedDocument =
          changes.document === undefined ? undefined : normalizeBusinessDocument(changes.document);
        const [supplier] = await tx
          .update(managementSuppliers)
          .set({
            ...changes,
            normalizedDocument,
            version: input.version + 1,
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(managementSuppliers.organizationId, organizationId),
              eq(managementSuppliers.unitId, unitId),
              eq(managementSuppliers.id, supplierId),
              eq(managementSuppliers.version, input.version),
            ),
          )
          .returning();
        if (!supplier)
          throw new ConflictException({
            code: "SUPPLIER_VERSION_CONFLICT",
            message: "O fornecedor foi alterado por outra operação.",
          });
        await this.record(
          tx,
          identityId,
          organizationId,
          unitId,
          "management.supplier.updated",
          "supplier",
          supplierId,
          { fields: Object.keys(changes) },
        );
        return supplier as NonNullable<typeof supplier>;
      },
    );
  }

  async archiveSupplier(
    identityId: string,
    organizationId: string,
    unitId: string,
    supplierId: string,
    idempotencyKey: string,
    input: PurchaseVersionInput,
  ) {
    await this.requireRole(identityId, organizationId, unitId, [...INVENTORY_ROLES, "finance"]);
    return this.idempotent(
      identityId,
      organizationId,
      unitId,
      idempotencyKey,
      "supplier-archive",
      { supplierId, ...input },
      async (tx) => {
        const [supplier] = await tx
          .update(managementSuppliers)
          .set({
            active: false,
            version: input.version + 1,
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(managementSuppliers.organizationId, organizationId),
              eq(managementSuppliers.unitId, unitId),
              eq(managementSuppliers.id, supplierId),
              eq(managementSuppliers.active, true),
              eq(managementSuppliers.version, input.version),
            ),
          )
          .returning();
        if (!supplier) {
          const [existing] = await tx
            .select({ version: managementSuppliers.version })
            .from(managementSuppliers)
            .where(
              and(
                eq(managementSuppliers.organizationId, organizationId),
                eq(managementSuppliers.unitId, unitId),
                eq(managementSuppliers.id, supplierId),
              ),
            )
            .limit(1);
          if (existing)
            throw new ConflictException({
              code: "SUPPLIER_VERSION_CONFLICT",
              message: "O fornecedor foi alterado por outra operação.",
            });
          throw new NotFoundException({
            code: "SUPPLIER_NOT_FOUND",
            message: "Fornecedor ativo não encontrado.",
          });
        }
        await this.record(
          tx,
          identityId,
          organizationId,
          unitId,
          "management.supplier.archived",
          "supplier",
          supplierId,
          {},
        );
        return { supplierId, active: false, version: input.version + 1 };
      },
    );
  }

  async listSuppliers(
    identityId: string,
    organizationId: string,
    unitId: string,
    query: SupplierListQuery = { page: 1, pageSize: 25 },
  ) {
    await this.requireRole(identityId, organizationId, unitId, [...INVENTORY_ROLES, "finance"]);
    const filters = [
      eq(managementSuppliers.organizationId, organizationId),
      eq(managementSuppliers.unitId, unitId),
      query.active === undefined ? undefined : eq(managementSuppliers.active, query.active),
      query.search
        ? or(
            ilike(managementSuppliers.name, `%${query.search}%`),
            ilike(managementSuppliers.document, `%${query.search}%`),
            ilike(managementSuppliers.contactName, `%${query.search}%`),
          )
        : undefined,
    ];
    const where = and(...filters);
    const offset = (query.page - 1) * query.pageSize;
    const [[countRow], suppliers] = await Promise.all([
      this.database.db
        .select({ total: sql<number>`count(*)`.mapWith(Number) })
        .from(managementSuppliers)
        .where(where),
      this.database.db
        .select()
        .from(managementSuppliers)
        .where(where)
        .orderBy(asc(managementSuppliers.name), asc(managementSuppliers.id))
        .limit(query.pageSize)
        .offset(offset),
    ]);
    const total = countRow?.total ?? 0;
    if (!suppliers.length)
      return {
        items: [],
        pagination: {
          page: query.page,
          pageSize: query.pageSize,
          total,
          pageCount: Math.ceil(total / query.pageSize),
        },
      };

    const supplierIds = suppliers.map((supplier) => supplier.id);
    const [orders, invoices] = await Promise.all([
      this.database.db
        .select()
        .from(managementPurchaseOrders)
        .where(
          and(
            eq(managementPurchaseOrders.organizationId, organizationId),
            eq(managementPurchaseOrders.unitId, unitId),
            inArray(managementPurchaseOrders.supplierId, supplierIds),
          ),
        ),
      this.database.db
        .select()
        .from(managementSupplierInvoices)
        .where(
          and(
            eq(managementSupplierInvoices.organizationId, organizationId),
            eq(managementSupplierInvoices.unitId, unitId),
            inArray(managementSupplierInvoices.supplierId, supplierIds),
          ),
        ),
    ]);
    const orderIds = orders.map((order) => order.id);
    const receipts = orderIds.length
      ? await this.database.db
          .select()
          .from(managementPurchaseReceipts)
          .where(
            and(
              eq(managementPurchaseReceipts.organizationId, organizationId),
              eq(managementPurchaseReceipts.unitId, unitId),
              inArray(managementPurchaseReceipts.purchaseOrderId, orderIds),
            ),
          )
      : [];
    const enriched = suppliers.map((supplier) => {
      const supplierOrders = orders.filter((order) => order.supplierId === supplier.id);
      const completed = supplierOrders.filter((order) => order.status === "received");
      const onTime = completed.filter((order) => {
        if (!order.expectedAt) return false;
        const lastReceipt = receipts
          .filter((receipt) => receipt.purchaseOrderId === order.id)
          .sort((a, b) => b.receivedAt.valueOf() - a.receivedAt.valueOf())[0];
        return lastReceipt ? lastReceipt.receivedAt <= order.expectedAt : false;
      }).length;
      const supplierInvoices = invoices.filter((invoice) => invoice.supplierId === supplier.id);
      return {
        ...supplier,
        indicators: {
          orderCount: supplierOrders.length,
          receivedOrderCount: completed.length,
          onTimeRate: completed.some((order) => order.expectedAt)
            ? Math.round((onTime * 10_000) / completed.filter((order) => order.expectedAt).length) /
              100
            : null,
          confirmedSpendCents: supplierInvoices
            .filter((invoice) => invoice.status === "confirmed")
            .reduce((sum, invoice) => sum + invoice.totalCents, 0),
          divergenceRate: supplierInvoices.length
            ? Math.round(
                (supplierInvoices.filter((invoice) => invoice.status === "divergent").length *
                  10_000) /
                  supplierInvoices.length,
              ) / 100
            : 0,
        },
      };
    });
    return {
      items: enriched,
      pagination: {
        page: query.page,
        pageSize: query.pageSize,
        total,
        pageCount: Math.ceil(total / query.pageSize),
      },
    };
  }

  private async inventoryRiskSummary(
    organizationId: string,
    unitId: string,
    input: InventoryEventInput,
  ) {
    const lines = await Promise.all(
      input.lines.map(async (line) => {
        const [balance] = await this.database.db
          .select({
            quantity: managementStockBalances.quantity,
            averageCostCents: managementStockBalances.averageCostCents,
            version: managementStockBalances.version,
          })
          .from(managementStockBalances)
          .where(
            and(
              eq(managementStockBalances.organizationId, organizationId),
              eq(managementStockBalances.unitId, unitId),
              eq(managementStockBalances.locationId, line.locationId),
              eq(managementStockBalances.inventoryItemId, line.inventoryItemId),
            ),
          )
          .limit(1);
        const previousQuantity = Number(balance?.quantity ?? 0);
        const risk = assessInventoryRisk({
          type: input.type,
          previousQuantity,
          requestedQuantity: Number(line.quantity),
          unitCostCents: balance?.averageCostCents ?? null,
        });
        return {
          inventoryItemId: line.inventoryItemId,
          locationId: line.locationId,
          lotId: line.lotId ?? null,
          previousQuantity: previousQuantity.toFixed(3),
          balanceVersion: balance?.version ?? 0,
          delta: risk.delta.toFixed(3),
          percent: Math.round(risk.percent * 10) / 10,
          valueCents: risk.valueCents,
          requiresApproval: risk.requiresApproval,
        };
      }),
    );
    return {
      limits: { percent: 20, valueCents: 10_000 },
      requiresApproval: lines.some((line) => line.requiresApproval),
      lines,
    };
  }

  async recordInventoryEvent(
    identityId: string,
    organizationId: string,
    unitId: string,
    idempotencyKey: string,
    input: InventoryEventInput,
  ) {
    const role = await this.requireRole(identityId, organizationId, unitId, INVENTORY_ROLES);
    const unique = new Set(input.lines.map((line) => `${line.locationId}:${line.inventoryItemId}`));
    if (unique.size !== input.lines.length)
      throw new BadRequestException({
        code: "DUPLICATE_INVENTORY_LINE",
        message: "O mesmo item e local não pode aparecer duas vezes.",
      });
    const [existingRequest] = await this.database.db
      .select()
      .from(managementInventoryReviewRequests)
      .where(
        and(
          eq(managementInventoryReviewRequests.organizationId, organizationId),
          eq(managementInventoryReviewRequests.unitId, unitId),
          eq(managementInventoryReviewRequests.idempotencyKey, idempotencyKey),
        ),
      )
      .limit(1);
    if (existingRequest)
      return {
        requestId: existingRequest.id,
        status: existingRequest.status,
        requiresApproval: true,
        riskSummary: existingRequest.riskSummary,
      };
    const riskSummary = await this.inventoryRiskSummary(organizationId, unitId, input);
    if (role === "inventory" && riskSummary.requiresApproval) {
      return this.idempotent(
        identityId,
        organizationId,
        unitId,
        idempotencyKey,
        "inventory-review-request",
        input,
        async (tx) => {
          const [request] = await tx
            .insert(managementInventoryReviewRequests)
            .values({
              organizationId,
              unitId,
              type: input.type,
              reason: input.reason,
              payload: input,
              riskSummary,
              idempotencyKey,
              requestedByIdentityId: identityId,
            })
            .returning();
          if (!request) throw new ConflictException("Não foi possível solicitar a aprovação.");
          await this.record(
            tx,
            identityId,
            organizationId,
            unitId,
            "management.inventory.review-requested",
            "inventory_review_request",
            request.id,
            riskSummary,
          );
          return {
            requestId: request.id,
            status: request.status,
            requiresApproval: true,
            riskSummary,
          };
        },
      );
    }
    return this.idempotent(
      identityId,
      organizationId,
      unitId,
      idempotencyKey,
      "inventory-event",
      input,
      async (tx) => {
        const eventId = randomUUID();
        await tx.insert(managementInventoryEvents).values({
          id: eventId,
          organizationId,
          unitId,
          type: input.type,
          reason: input.reason,
          idempotencyKey,
          actorIdentityId: identityId,
          occurredAt: input.occurredAt ? new Date(input.occurredAt) : undefined,
        });
        const results: Array<Record<string, unknown>> = [];
        for (const line of input.lines) {
          const [item] = await tx
            .select({
              id: managementInventoryItems.id,
              allowNegative: managementInventoryItems.allowNegative,
            })
            .from(managementInventoryItems)
            .where(
              and(
                eq(managementInventoryItems.organizationId, organizationId),
                eq(managementInventoryItems.unitId, unitId),
                eq(managementInventoryItems.id, line.inventoryItemId),
                eq(managementInventoryItems.active, true),
              ),
            )
            .limit(1);
          if (!item)
            throw new NotFoundException({
              code: "INVENTORY_ITEM_NOT_FOUND",
              message: "Item de estoque não encontrado nesta unidade.",
            });
          const [location] = await tx
            .select({ id: managementStockLocations.id })
            .from(managementStockLocations)
            .where(
              and(
                eq(managementStockLocations.organizationId, organizationId),
                eq(managementStockLocations.unitId, unitId),
                eq(managementStockLocations.id, line.locationId),
                eq(managementStockLocations.active, true),
              ),
            )
            .limit(1);
          if (!location)
            throw new NotFoundException({
              code: "STOCK_LOCATION_NOT_FOUND",
              message: "Local de estoque não encontrado nesta unidade.",
            });
          await tx
            .insert(managementStockBalances)
            .values({
              organizationId,
              unitId,
              locationId: line.locationId,
              inventoryItemId: line.inventoryItemId,
            })
            .onConflictDoNothing({
              target: [
                managementStockBalances.organizationId,
                managementStockBalances.unitId,
                managementStockBalances.locationId,
                managementStockBalances.inventoryItemId,
              ],
            });
          await tx.execute(
            sql`select id from management_stock_balances where organization_id=${organizationId}::uuid and unit_id=${unitId}::uuid and location_id=${line.locationId}::uuid and inventory_item_id=${line.inventoryItemId}::uuid for update`,
          );
          const [balance] = await tx
            .select()
            .from(managementStockBalances)
            .where(
              and(
                eq(managementStockBalances.organizationId, organizationId),
                eq(managementStockBalances.unitId, unitId),
                eq(managementStockBalances.locationId, line.locationId),
                eq(managementStockBalances.inventoryItemId, line.inventoryItemId),
              ),
            )
            .limit(1);
          if (!balance)
            throw new ConflictException({
              code: "BALANCE_LOCK_FAILED",
              message: "Não foi possível bloquear o saldo.",
            });
          if (
            line.expectedPreviousQuantity !== undefined &&
            quantityToMilli(balance.quantity) !== quantityToMilli(line.expectedPreviousQuantity)
          )
            throw new ConflictException({
              code: "INVENTORY_BALANCE_CHANGED",
              message: "O saldo mudou após a contagem. Faça uma nova conferência antes de aprovar.",
            });
          let change = inventoryChange(
            balance.quantity,
            input.type,
            line.quantity,
            item.allowNegative,
          );
          if (line.lotId) {
            await tx.execute(
              sql`select id from management_inventory_lots where organization_id=${organizationId}::uuid and unit_id=${unitId}::uuid and id=${line.lotId}::uuid for update`,
            );
            const [lot] = await tx
              .select()
              .from(managementInventoryLots)
              .where(
                and(
                  eq(managementInventoryLots.organizationId, organizationId),
                  eq(managementInventoryLots.unitId, unitId),
                  eq(managementInventoryLots.id, line.lotId),
                  eq(managementInventoryLots.locationId, line.locationId),
                  eq(managementInventoryLots.inventoryItemId, line.inventoryItemId),
                  eq(managementInventoryLots.active, true),
                ),
              )
              .limit(1);
            if (!lot)
              throw new NotFoundException({
                code: "INVENTORY_LOT_NOT_FOUND",
                message: "Lote não encontrado para este insumo e local.",
              });
            const lotChange = inventoryChange(lot.quantity, input.type, line.quantity, false);
            const resultingBalanceMilli =
              quantityToMilli(balance.quantity) + quantityToMilli(lotChange.quantityDelta);
            if (resultingBalanceMilli < 0)
              throw new ConflictException({
                code: "NEGATIVE_STOCK_NOT_ALLOWED",
                message: "A movimentação deixaria o estoque negativo.",
              });
            change = {
              previousQuantity: balance.quantity,
              quantityDelta: lotChange.quantityDelta,
              resultingQuantity: milliToQuantity(resultingBalanceMilli),
            };
            await tx
              .update(managementInventoryLots)
              .set({ quantity: lotChange.resultingQuantity, updatedAt: new Date() })
              .where(eq(managementInventoryLots.id, lot.id));
          } else {
            const [trackedLot] = await tx
              .select({ id: managementInventoryLots.id })
              .from(managementInventoryLots)
              .where(
                and(
                  eq(managementInventoryLots.organizationId, organizationId),
                  eq(managementInventoryLots.unitId, unitId),
                  eq(managementInventoryLots.locationId, line.locationId),
                  eq(managementInventoryLots.inventoryItemId, line.inventoryItemId),
                  eq(managementInventoryLots.active, true),
                  ne(managementInventoryLots.quantity, "0"),
                ),
              )
              .limit(1);
            if (trackedLot)
              throw new BadRequestException({
                code: "INVENTORY_LOT_REQUIRED",
                message: "Selecione o lote para movimentar este insumo.",
              });
          }
          const lineId = randomUUID();
          await tx.insert(managementInventoryEventLines).values({
            id: lineId,
            organizationId,
            unitId,
            eventId,
            locationId: line.locationId,
            inventoryItemId: line.inventoryItemId,
            lotId: line.lotId,
            ...change,
          });
          await tx.insert(managementInventoryMovements).values({
            organizationId,
            unitId,
            locationId: line.locationId,
            inventoryItemId: line.inventoryItemId,
            lotId: line.lotId,
            type: input.type,
            quantityDelta: change.quantityDelta,
            unitCostCents: balance.averageCostCents,
            sourceType: "inventory_event_line",
            sourceId: lineId,
            actorIdentityId: identityId,
            occurredAt: input.occurredAt ? new Date(input.occurredAt) : undefined,
          });
          await tx
            .update(managementStockBalances)
            .set({
              quantity: change.resultingQuantity,
              version: balance.version + 1,
              updatedAt: new Date(),
            })
            .where(eq(managementStockBalances.id, balance.id));
          if (input.type === "count") {
            const countedAt = input.occurredAt ? new Date(input.occurredAt) : new Date();
            const countedAtIso = countedAt.toISOString();
            await tx
              .update(managementInventoryCountSchedules)
              .set({
                lastCountedAt: countedAt,
                nextDueAt: sql`${countedAtIso}::timestamptz + ${managementInventoryCountSchedules.frequencyDays} * interval '1 day'`,
                updatedByIdentityId: identityId,
                updatedAt: new Date(),
              })
              .where(
                and(
                  eq(managementInventoryCountSchedules.organizationId, organizationId),
                  eq(managementInventoryCountSchedules.unitId, unitId),
                  eq(managementInventoryCountSchedules.locationId, line.locationId),
                  eq(managementInventoryCountSchedules.inventoryItemId, line.inventoryItemId),
                  eq(managementInventoryCountSchedules.active, true),
                ),
              );
          }
          results.push({ lineId, ...change });
        }
        await this.record(
          tx,
          identityId,
          organizationId,
          unitId,
          "management.inventory.event-recorded",
          "inventory_event",
          eventId,
          { type: input.type, lineCount: input.lines.length },
        );
        return { eventId, lines: results };
      },
    );
  }

  async reviewInventoryEvent(
    identityId: string,
    organizationId: string,
    unitId: string,
    requestId: string,
    idempotencyKey: string,
    input: InventoryReviewInput,
  ) {
    await this.requireRole(identityId, organizationId, unitId, ["owner", "manager"]);
    const [request] = await this.database.db
      .select()
      .from(managementInventoryReviewRequests)
      .where(
        and(
          eq(managementInventoryReviewRequests.organizationId, organizationId),
          eq(managementInventoryReviewRequests.unitId, unitId),
          eq(managementInventoryReviewRequests.id, requestId),
        ),
      )
      .limit(1);
    if (!request)
      throw new NotFoundException({
        code: "INVENTORY_REVIEW_NOT_FOUND",
        message: "Solicitação de revisão não encontrada.",
      });
    if (request.requestedByIdentityId === identityId)
      throw new ForbiddenException({
        code: "INVENTORY_REVIEW_DUAL_CONTROL_REQUIRED",
        message: "Quem registrou a divergência não pode aprovar a própria solicitação.",
      });
    if (request.status !== "pending") return request;
    const reviewedAt = new Date();
    if (input.decision === "rejected") {
      const [rejected] = await this.database.db
        .update(managementInventoryReviewRequests)
        .set({
          status: "rejected",
          reviewedByIdentityId: identityId,
          reviewReason: input.reason,
          reviewedAt,
          updatedAt: reviewedAt,
        })
        .where(
          and(
            eq(managementInventoryReviewRequests.id, request.id),
            eq(managementInventoryReviewRequests.status, "pending"),
          ),
        )
        .returning();
      return rejected ?? request;
    }
    const parsed = inventoryEventSchema.parse(request.payload);
    const riskLines = Array.isArray(request.riskSummary.lines)
      ? request.riskSummary.lines.filter(
          (line): line is Record<string, unknown> => typeof line === "object" && line !== null,
        )
      : [];
    const approvedInput: InventoryEventInput = {
      ...parsed,
      lines: parsed.lines.map((line) => ({
        ...line,
        expectedPreviousQuantity: String(
          riskLines.find(
            (risk) =>
              risk.inventoryItemId === line.inventoryItemId && risk.locationId === line.locationId,
          )?.previousQuantity ?? "0.000",
        ),
      })),
    };
    const posted = await this.recordInventoryEvent(
      identityId,
      organizationId,
      unitId,
      `inventory-review-post:${request.id}`,
      approvedInput,
    );
    const eventId =
      "eventId" in posted && typeof posted.eventId === "string" ? posted.eventId : null;
    if (!eventId) throw new ConflictException("Não foi possível publicar a movimentação aprovada.");
    const [updated] = await this.database.db
      .update(managementInventoryReviewRequests)
      .set({
        status: "posted",
        reviewedByIdentityId: identityId,
        reviewReason: input.reason,
        reviewedAt,
        postedEventId: eventId,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(managementInventoryReviewRequests.id, request.id),
          eq(managementInventoryReviewRequests.status, "pending"),
        ),
      )
      .returning();
    if (!updated) {
      const [current] = await this.database.db
        .select()
        .from(managementInventoryReviewRequests)
        .where(eq(managementInventoryReviewRequests.id, request.id))
        .limit(1);
      return current ?? request;
    }
    await this.database.db.insert(auditEvents).values({
      action: "management.inventory.review-posted",
      actorIdentityId: identityId,
      entityId: request.id,
      entityType: "inventory_review_request",
      metadata: { eventId, idempotencyKey, reason: input.reason },
      organizationId,
      unitId,
    });
    return updated;
  }

  async transferInventoryBatch(
    identityId: string,
    organizationId: string,
    unitId: string,
    idempotencyKey: string,
    input: InventoryTransferBatchInput,
  ) {
    await this.requireRole(identityId, organizationId, unitId, INVENTORY_ROLES);
    return this.idempotent(
      identityId,
      organizationId,
      unitId,
      idempotencyKey,
      "inventory-transfer.batch",
      input,
      async (tx) => {
        const locations = await tx
          .select({
            id: managementStockLocations.id,
            transferSlaMinutes: managementStockLocations.transferSlaMinutes,
          })
          .from(managementStockLocations)
          .where(
            and(
              eq(managementStockLocations.organizationId, organizationId),
              eq(managementStockLocations.unitId, unitId),
              eq(managementStockLocations.active, true),
              inArray(managementStockLocations.id, [
                input.sourceLocationId,
                input.destinationLocationId,
              ]),
            ),
          );
        if (locations.length !== 2)
          throw new NotFoundException({
            code: "INVENTORY_TRANSFER_SCOPE_INVALID",
            message: "Origem ou destino não pertence a esta unidade.",
          });
        const destination = locations.find(
          (location) => location.id === input.destinationLocationId,
        );
        if (!destination) throw new ConflictException("Destino da transferência inválido.");
        const eventId = randomUUID();
        const batchId = randomUUID();
        await tx.insert(managementInventoryEvents).values({
          id: eventId,
          organizationId,
          unitId,
          type: "transfer",
          reason: input.reason,
          idempotencyKey,
          actorIdentityId: identityId,
        });
        const transfers = [];
        for (const [index, line] of input.lines.entries()) {
          const item = await this.requireInventoryItem(
            tx,
            organizationId,
            unitId,
            line.inventoryItemId,
          );
          if (!line.lotId) {
            const trackedLots = await tx
              .select({ id: managementInventoryLots.id })
              .from(managementInventoryLots)
              .where(
                and(
                  eq(managementInventoryLots.organizationId, organizationId),
                  eq(managementInventoryLots.unitId, unitId),
                  eq(managementInventoryLots.locationId, input.sourceLocationId),
                  eq(managementInventoryLots.inventoryItemId, line.inventoryItemId),
                  eq(managementInventoryLots.active, true),
                  gt(managementInventoryLots.quantity, "0"),
                ),
              )
              .limit(1);
            if (trackedLots.length)
              throw new BadRequestException({
                code: "INVENTORY_LOT_REQUIRED",
                message: `Selecione o lote para transferir ${item.name}.`,
              });
          }
          const [sourceBalance] = await tx
            .select({ averageCostCents: managementStockBalances.averageCostCents })
            .from(managementStockBalances)
            .where(
              and(
                eq(managementStockBalances.organizationId, organizationId),
                eq(managementStockBalances.unitId, unitId),
                eq(managementStockBalances.locationId, input.sourceLocationId),
                eq(managementStockBalances.inventoryItemId, line.inventoryItemId),
              ),
            )
            .limit(1);
          await tx
            .insert(managementStockBalances)
            .values({
              organizationId,
              unitId,
              locationId: input.destinationLocationId,
              inventoryItemId: line.inventoryItemId,
            })
            .onConflictDoNothing();
          const transferId = randomUUID();
          const eventLineId = randomUUID();
          const quantityMilli = quantityToMilli(line.quantity);
          const movement = await this.applyStockMovement(tx, organizationId, unitId, {
            locationId: input.sourceLocationId,
            inventoryItemId: line.inventoryItemId,
            lotId: line.lotId,
            quantityDeltaMilli: -quantityMilli,
            unitCostCents: sourceBalance?.averageCostCents,
            type: "transfer_out",
            sourceType: "inventory_event_line",
            sourceId: eventLineId,
            actorIdentityId: identityId,
          });
          await tx.insert(managementInventoryEventLines).values({
            id: eventLineId,
            organizationId,
            unitId,
            eventId,
            locationId: input.sourceLocationId,
            inventoryItemId: line.inventoryItemId,
            lotId: line.lotId,
            previousQuantity: milliToQuantity(movement.previousMilli),
            quantityDelta: milliToQuantity(-quantityMilli),
            resultingQuantity: milliToQuantity(movement.resultingMilli),
          });
          const [transfer] = await tx
            .insert(managementInventoryTransfers)
            .values({
              id: transferId,
              organizationId,
              unitId,
              batchId,
              lineNumber: index + 1,
              inventoryItemId: line.inventoryItemId,
              sourceLocationId: input.sourceLocationId,
              destinationLocationId: input.destinationLocationId,
              sourceLotId: line.lotId,
              eventId,
              quantity: String(line.quantity),
              reason: input.reason,
              deadlineAt: new Date(Date.now() + destination.transferSlaMinutes * 60_000),
              idempotencyKey: `${idempotencyKey.slice(0, 90)}:${index + 1}:${batchId}`,
              sentByIdentityId: identityId,
            })
            .returning();
          if (!transfer) throw new ConflictException("Não foi possível enviar a transferência.");
          transfers.push(transfer);
        }
        await this.record(
          tx,
          identityId,
          organizationId,
          unitId,
          "management.inventory.transfer-batch-dispatched",
          "inventory_transfer_batch",
          batchId,
          {
            eventId,
            lineCount: transfers.length,
            sourceLocationId: input.sourceLocationId,
            destinationLocationId: input.destinationLocationId,
          },
        );
        return { batchId, eventId, status: "in_transit", transfers };
      },
    );
  }

  async transferInventory(
    identityId: string,
    organizationId: string,
    unitId: string,
    idempotencyKey: string,
    input: InventoryTransferInput,
  ) {
    await this.requireRole(identityId, organizationId, unitId, INVENTORY_ROLES);
    return this.idempotent(
      identityId,
      organizationId,
      unitId,
      idempotencyKey,
      "inventory-transfer",
      input,
      async (tx) => {
        const [item, locations] = await Promise.all([
          tx
            .select({ id: managementInventoryItems.id })
            .from(managementInventoryItems)
            .where(
              and(
                eq(managementInventoryItems.organizationId, organizationId),
                eq(managementInventoryItems.unitId, unitId),
                eq(managementInventoryItems.id, input.inventoryItemId),
                eq(managementInventoryItems.active, true),
              ),
            )
            .limit(1),
          tx
            .select({ id: managementStockLocations.id })
            .from(managementStockLocations)
            .where(
              and(
                eq(managementStockLocations.organizationId, organizationId),
                eq(managementStockLocations.unitId, unitId),
                eq(managementStockLocations.active, true),
                inArray(managementStockLocations.id, [
                  input.sourceLocationId,
                  input.destinationLocationId,
                ]),
              ),
            ),
        ]);
        if (!item[0] || locations.length !== 2)
          throw new NotFoundException({
            code: "INVENTORY_TRANSFER_SCOPE_INVALID",
            message: "Insumo, origem ou destino não pertence a esta unidade.",
          });

        await tx
          .insert(managementStockBalances)
          .values([
            {
              organizationId,
              unitId,
              locationId: input.sourceLocationId,
              inventoryItemId: input.inventoryItemId,
            },
            {
              organizationId,
              unitId,
              locationId: input.destinationLocationId,
              inventoryItemId: input.inventoryItemId,
            },
          ])
          .onConflictDoNothing();
        await tx.execute(
          sql`select id from management_stock_balances where organization_id=${organizationId}::uuid and unit_id=${unitId}::uuid and inventory_item_id=${input.inventoryItemId}::uuid and location_id in (${input.sourceLocationId}::uuid, ${input.destinationLocationId}::uuid) order by id for update`,
        );
        const balances = await tx
          .select()
          .from(managementStockBalances)
          .where(
            and(
              eq(managementStockBalances.organizationId, organizationId),
              eq(managementStockBalances.unitId, unitId),
              eq(managementStockBalances.inventoryItemId, input.inventoryItemId),
              inArray(managementStockBalances.locationId, [
                input.sourceLocationId,
                input.destinationLocationId,
              ]),
            ),
          );
        const source = balances.find((balance) => balance.locationId === input.sourceLocationId);
        const destination = balances.find(
          (balance) => balance.locationId === input.destinationLocationId,
        );
        if (!source || !destination)
          throw new ConflictException({
            code: "BALANCE_LOCK_FAILED",
            message: "Não foi possível bloquear os saldos da transferência.",
          });
        const quantityMilli = quantityToMilli(input.quantity);
        const sourceMilli = quantityToMilli(source.quantity, "sourceQuantity");
        if (sourceMilli < quantityMilli)
          throw new ConflictException({
            code: "INSUFFICIENT_STOCK",
            message: "O local de origem não possui saldo suficiente.",
          });

        let sourceLotId: string | null = null;
        if (input.lotId) {
          await tx.execute(
            sql`select id from management_inventory_lots where organization_id=${organizationId}::uuid and unit_id=${unitId}::uuid and id=${input.lotId}::uuid for update`,
          );
          const [lot] = await tx
            .select()
            .from(managementInventoryLots)
            .where(
              and(
                eq(managementInventoryLots.organizationId, organizationId),
                eq(managementInventoryLots.unitId, unitId),
                eq(managementInventoryLots.id, input.lotId),
                eq(managementInventoryLots.locationId, input.sourceLocationId),
                eq(managementInventoryLots.inventoryItemId, input.inventoryItemId),
                eq(managementInventoryLots.active, true),
              ),
            )
            .limit(1);
          if (!lot || quantityToMilli(lot.quantity) < quantityMilli)
            throw new ConflictException({
              code: "INVENTORY_LOT_INSUFFICIENT",
              message: "O lote selecionado não possui quantidade suficiente.",
            });
          sourceLotId = lot.id;
          await tx
            .update(managementInventoryLots)
            .set({
              quantity: milliToQuantity(quantityToMilli(lot.quantity) - quantityMilli),
              updatedAt: new Date(),
            })
            .where(eq(managementInventoryLots.id, lot.id));
        } else {
          const trackedLots = await tx
            .select({ id: managementInventoryLots.id })
            .from(managementInventoryLots)
            .where(
              and(
                eq(managementInventoryLots.organizationId, organizationId),
                eq(managementInventoryLots.unitId, unitId),
                eq(managementInventoryLots.locationId, input.sourceLocationId),
                eq(managementInventoryLots.inventoryItemId, input.inventoryItemId),
                eq(managementInventoryLots.active, true),
                ne(managementInventoryLots.quantity, "0"),
              ),
            )
            .limit(1);
          if (trackedLots.length)
            throw new BadRequestException({
              code: "INVENTORY_LOT_REQUIRED",
              message: "Selecione o lote para transferir este insumo.",
            });
        }

        const sourceResult = milliToQuantity(sourceMilli - quantityMilli);
        await tx
          .update(managementStockBalances)
          .set({ quantity: sourceResult, version: source.version + 1, updatedAt: new Date() })
          .where(eq(managementStockBalances.id, source.id));
        const eventId = randomUUID();
        await tx.insert(managementInventoryEvents).values({
          id: eventId,
          organizationId,
          unitId,
          type: "transfer",
          reason: input.reason,
          idempotencyKey,
          actorIdentityId: identityId,
        });
        const sourceLineId = randomUUID();
        await tx.insert(managementInventoryEventLines).values({
          id: sourceLineId,
          organizationId,
          unitId,
          eventId,
          locationId: input.sourceLocationId,
          inventoryItemId: input.inventoryItemId,
          lotId: sourceLotId,
          previousQuantity: source.quantity,
          quantityDelta: milliToQuantity(-quantityMilli),
          resultingQuantity: sourceResult,
        });
        await tx.insert(managementInventoryMovements).values({
          organizationId,
          unitId,
          locationId: input.sourceLocationId,
          inventoryItemId: input.inventoryItemId,
          lotId: sourceLotId,
          type: "transfer_out",
          quantityDelta: milliToQuantity(-quantityMilli),
          unitCostCents: source.averageCostCents,
          sourceType: "inventory_event_line",
          sourceId: sourceLineId,
          actorIdentityId: identityId,
        });
        const transferId = randomUUID();
        await tx.insert(managementInventoryTransfers).values({
          id: transferId,
          organizationId,
          unitId,
          inventoryItemId: input.inventoryItemId,
          sourceLocationId: input.sourceLocationId,
          destinationLocationId: input.destinationLocationId,
          sourceLotId,
          eventId,
          quantity: milliToQuantity(quantityMilli),
          reason: input.reason,
          idempotencyKey,
          sentByIdentityId: identityId,
        });
        await this.record(
          tx,
          identityId,
          organizationId,
          unitId,
          "management.inventory.transfer-dispatched",
          "inventory_transfer",
          transferId,
          { eventId, inventoryItemId: input.inventoryItemId, quantity: input.quantity },
        );
        return { transferId, eventId, sourceResult, status: "in_transit" };
      },
    );
  }

  async resolveInventoryTransfer(
    identityId: string,
    organizationId: string,
    unitId: string,
    transferId: string,
    idempotencyKey: string,
    input: InventoryTransferResolutionInput,
  ) {
    const role = await this.requireRole(identityId, organizationId, unitId, INVENTORY_ROLES);
    return this.idempotent(
      identityId,
      organizationId,
      unitId,
      idempotencyKey,
      "inventory-transfer.resolve",
      { transferId, ...input },
      async (tx) => {
        await tx.execute(
          sql`select id from management_inventory_transfers where organization_id=${organizationId}::uuid and unit_id=${unitId}::uuid and id=${transferId}::uuid for update`,
        );
        const [transfer] = await tx
          .select()
          .from(managementInventoryTransfers)
          .where(
            and(
              eq(managementInventoryTransfers.organizationId, organizationId),
              eq(managementInventoryTransfers.unitId, unitId),
              eq(managementInventoryTransfers.id, transferId),
            ),
          )
          .limit(1);
        if (!transfer)
          throw new NotFoundException({
            code: "INVENTORY_TRANSFER_NOT_FOUND",
            message: "Transferência não encontrada.",
          });
        if (!["in_transit", "partially_received"].includes(transfer.status)) return transfer;
        const [destinationLocation] = await tx
          .select({
            requireDistinctTransferReceiver:
              managementStockLocations.requireDistinctTransferReceiver,
          })
          .from(managementStockLocations)
          .where(
            and(
              eq(managementStockLocations.organizationId, organizationId),
              eq(managementStockLocations.unitId, unitId),
              eq(managementStockLocations.id, transfer.destinationLocationId),
            ),
          )
          .limit(1);
        if (
          destinationLocation?.requireDistinctTransferReceiver &&
          transfer.sentByIdentityId === identityId
        )
          throw new ForbiddenException({
            code: "TRANSFER_DISTINCT_RECEIVER_REQUIRED",
            message: "Outra pessoa deve conferir esta transferência.",
          });
        const sentMilli = quantityToMilli(transfer.quantity);
        const accountedMilli =
          quantityToMilli(transfer.quantityReceived) + quantityToMilli(transfer.quantityDivergent);
        const remainingMilli = sentMilli - accountedMilli;
        const divergentMilli =
          input.decision === "received" ? quantityToMilli(input.quantityDivergent ?? "0") : 0;
        const receivedMilli =
          input.decision === "received"
            ? quantityToMilli(
                input.quantityReceived ??
                  milliToQuantity(Math.max(remainingMilli - divergentMilli, 0)),
              )
            : 0;
        if (receivedMilli + divergentMilli > remainingMilli)
          throw new ConflictException({
            code: "TRANSFER_RECEIPT_EXCEEDS_REMAINING",
            message: "A conferência excede o saldo ainda em trânsito.",
          });
        if (input.decision === "received" && receivedMilli + divergentMilli <= 0)
          throw new BadRequestException({
            code: "TRANSFER_RECEIPT_EMPTY",
            message: "Informe a quantidade recebida ou divergente.",
          });
        if (divergentMilli > 0 && role === "inventory")
          throw new ForbiddenException({
            code: "TRANSFER_DIVERGENCE_MANAGER_REQUIRED",
            message: "Uma pessoa gerente deve confirmar a divergência.",
          });
        const stockDeltaMilli = input.decision === "received" ? receivedMilli : remainingMilli;
        const targetLocationId =
          input.decision === "received"
            ? transfer.destinationLocationId
            : transfer.sourceLocationId;
        await tx.execute(
          sql`select id from management_stock_balances where organization_id=${organizationId}::uuid and unit_id=${unitId}::uuid and location_id=${targetLocationId}::uuid and inventory_item_id=${transfer.inventoryItemId}::uuid for update`,
        );
        const [targetRows, sourceRows] = await Promise.all([
          tx
            .select()
            .from(managementStockBalances)
            .where(
              and(
                eq(managementStockBalances.organizationId, organizationId),
                eq(managementStockBalances.unitId, unitId),
                eq(managementStockBalances.locationId, targetLocationId),
                eq(managementStockBalances.inventoryItemId, transfer.inventoryItemId),
              ),
            )
            .limit(1),
          tx
            .select({ averageCostCents: managementStockBalances.averageCostCents })
            .from(managementStockBalances)
            .where(
              and(
                eq(managementStockBalances.organizationId, organizationId),
                eq(managementStockBalances.unitId, unitId),
                eq(managementStockBalances.locationId, transfer.sourceLocationId),
                eq(managementStockBalances.inventoryItemId, transfer.inventoryItemId),
              ),
            )
            .limit(1),
        ]);
        const targetBalance = targetRows[0];
        const sourceBalance = sourceRows[0];
        if (!targetBalance)
          throw new ConflictException({
            code: "BALANCE_LOCK_FAILED",
            message: "Não foi possível bloquear o saldo da transferência.",
          });
        const resultingQuantity = milliToQuantity(
          quantityToMilli(targetBalance.quantity) + stockDeltaMilli,
        );
        let resolvedLotId: string | null = null;
        if (transfer.sourceLotId && stockDeltaMilli > 0) {
          const [sourceLot] = await tx
            .select()
            .from(managementInventoryLots)
            .where(eq(managementInventoryLots.id, transfer.sourceLotId))
            .limit(1);
          if (!sourceLot)
            throw new ConflictException({
              code: "INVENTORY_TRANSFER_LOT_MISSING",
              message: "O lote de origem da transferência não está mais disponível.",
            });
          if (input.decision === "received") {
            const [destinationLot] = await tx
              .insert(managementInventoryLots)
              .values({
                organizationId,
                unitId,
                locationId: transfer.destinationLocationId,
                inventoryItemId: transfer.inventoryItemId,
                batchCode: sourceLot.batchCode,
                expiresAt: sourceLot.expiresAt,
                quantity: milliToQuantity(stockDeltaMilli),
                unitCostCents: sourceLot.unitCostCents,
              })
              .onConflictDoUpdate({
                target: [
                  managementInventoryLots.organizationId,
                  managementInventoryLots.unitId,
                  managementInventoryLots.locationId,
                  managementInventoryLots.inventoryItemId,
                  managementInventoryLots.batchCode,
                ],
                set: {
                  quantity: sql`${managementInventoryLots.quantity} + ${milliToQuantity(stockDeltaMilli)}::numeric`,
                  active: true,
                  updatedAt: new Date(),
                },
              })
              .returning({ id: managementInventoryLots.id });
            resolvedLotId = destinationLot?.id ?? null;
          } else {
            await tx
              .update(managementInventoryLots)
              .set({
                quantity: sql`${managementInventoryLots.quantity} + ${milliToQuantity(stockDeltaMilli)}::numeric`,
                active: true,
                updatedAt: new Date(),
              })
              .where(eq(managementInventoryLots.id, transfer.sourceLotId));
            resolvedLotId = transfer.sourceLotId;
          }
        }
        if (stockDeltaMilli > 0) {
          await tx
            .update(managementStockBalances)
            .set({
              quantity: resultingQuantity,
              averageCostCents:
                input.decision === "received"
                  ? (sourceBalance?.averageCostCents ?? targetBalance.averageCostCents)
                  : targetBalance.averageCostCents,
              version: targetBalance.version + 1,
              updatedAt: new Date(),
            })
            .where(eq(managementStockBalances.id, targetBalance.id));
          const lineId = randomUUID();
          await tx.insert(managementInventoryEventLines).values({
            id: lineId,
            organizationId,
            unitId,
            eventId: transfer.eventId,
            locationId: targetLocationId,
            inventoryItemId: transfer.inventoryItemId,
            lotId: resolvedLotId,
            previousQuantity: targetBalance.quantity,
            quantityDelta: milliToQuantity(stockDeltaMilli),
            resultingQuantity,
          });
          await tx.insert(managementInventoryMovements).values({
            organizationId,
            unitId,
            locationId: targetLocationId,
            inventoryItemId: transfer.inventoryItemId,
            lotId: resolvedLotId,
            type: input.decision === "received" ? "transfer_in" : "transfer_canceled",
            quantityDelta: milliToQuantity(stockDeltaMilli),
            unitCostCents: sourceBalance?.averageCostCents ?? targetBalance.averageCostCents,
            sourceType: "inventory_event_line",
            sourceId: lineId,
            actorIdentityId: identityId,
          });
        }
        const now = new Date();
        const nextReceivedMilli = quantityToMilli(transfer.quantityReceived) + receivedMilli;
        const nextDivergentMilli = quantityToMilli(transfer.quantityDivergent) + divergentMilli;
        const fullyAccounted = nextReceivedMilli + nextDivergentMilli === sentMilli;
        const nextStatus =
          input.decision === "canceled"
            ? ("canceled" as const)
            : fullyAccounted
              ? nextDivergentMilli > 0
                ? ("divergent" as const)
                : ("received" as const)
              : ("partially_received" as const);
        if (input.decision === "received")
          await tx.insert(managementInventoryTransferReceipts).values({
            organizationId,
            unitId,
            transferId: transfer.id,
            quantityReceived: milliToQuantity(receivedMilli),
            quantityDivergent: milliToQuantity(divergentMilli),
            divergenceReason: input.divergenceReason,
            evidenceMetadata: { urls: input.evidence ?? [] },
            note: input.note,
            idempotencyKey,
            receivedByIdentityId: identityId,
          });
        const [updated] = await tx
          .update(managementInventoryTransfers)
          .set({
            status: nextStatus,
            quantityReceived: milliToQuantity(nextReceivedMilli),
            quantityDivergent: milliToQuantity(nextDivergentMilli),
            destinationLotId: resolvedLotId ?? transfer.destinationLotId,
            receivedByIdentityId:
              input.decision === "received" ? identityId : transfer.receivedByIdentityId,
            receivedAt: input.decision === "received" && fullyAccounted ? now : transfer.receivedAt,
            canceledByIdentityId: input.decision === "canceled" ? identityId : null,
            canceledAt: input.decision === "canceled" ? now : null,
            resolutionNote: input.note,
            updatedAt: now,
          })
          .where(eq(managementInventoryTransfers.id, transfer.id))
          .returning();
        await this.record(
          tx,
          identityId,
          organizationId,
          unitId,
          `management.inventory.transfer-${input.decision}`,
          "inventory_transfer",
          transfer.id,
          {
            note: input.note,
            quantityReceived: milliToQuantity(receivedMilli),
            quantityDivergent: milliToQuantity(divergentMilli),
            status: nextStatus,
          },
        );
        return updated ?? transfer;
      },
    );
  }

  async createInventoryLot(
    identityId: string,
    organizationId: string,
    unitId: string,
    idempotencyKey: string,
    input: InventoryLotInput,
  ) {
    await this.requireRole(identityId, organizationId, unitId, INVENTORY_ROLES);
    return this.idempotent(
      identityId,
      organizationId,
      unitId,
      idempotencyKey,
      "inventory-lot.create",
      input,
      async (tx) => {
        const [item, location] = await Promise.all([
          tx
            .select({ id: managementInventoryItems.id })
            .from(managementInventoryItems)
            .where(
              and(
                eq(managementInventoryItems.organizationId, organizationId),
                eq(managementInventoryItems.unitId, unitId),
                eq(managementInventoryItems.id, input.inventoryItemId),
                eq(managementInventoryItems.active, true),
              ),
            )
            .limit(1),
          tx
            .select({ id: managementStockLocations.id })
            .from(managementStockLocations)
            .where(
              and(
                eq(managementStockLocations.organizationId, organizationId),
                eq(managementStockLocations.unitId, unitId),
                eq(managementStockLocations.id, input.locationId),
                eq(managementStockLocations.active, true),
              ),
            )
            .limit(1),
        ]);
        if (!item[0] || !location[0])
          throw new NotFoundException({
            code: "INVENTORY_LOT_SCOPE_INVALID",
            message: "Insumo ou local não pertence a esta unidade.",
          });
        const [lot] = await tx
          .insert(managementInventoryLots)
          .values({
            organizationId,
            unitId,
            inventoryItemId: input.inventoryItemId,
            locationId: input.locationId,
            batchCode: input.batchCode,
            expiresAt: input.expiresAt ? new Date(input.expiresAt) : undefined,
            quantity: String(input.quantity),
            unitCostCents: input.unitCostCents,
          })
          .returning();
        if (!lot) throw new ConflictException("Não foi possível registrar o lote.");
        await tx
          .insert(managementStockBalances)
          .values({
            organizationId,
            unitId,
            locationId: input.locationId,
            inventoryItemId: input.inventoryItemId,
          })
          .onConflictDoNothing();
        await tx.execute(
          sql`select id from management_stock_balances where organization_id=${organizationId}::uuid and unit_id=${unitId}::uuid and location_id=${input.locationId}::uuid and inventory_item_id=${input.inventoryItemId}::uuid for update`,
        );
        const [balance] = await tx
          .select()
          .from(managementStockBalances)
          .where(
            and(
              eq(managementStockBalances.organizationId, organizationId),
              eq(managementStockBalances.unitId, unitId),
              eq(managementStockBalances.locationId, input.locationId),
              eq(managementStockBalances.inventoryItemId, input.inventoryItemId),
            ),
          )
          .limit(1);
        if (!balance) throw new ConflictException("Não foi possível bloquear o saldo.");
        const previousMilli = quantityToMilli(balance.quantity);
        const quantityMilli = quantityToMilli(input.quantity);
        const resultingQuantity = milliToQuantity(previousMilli + quantityMilli);
        const averageCostCents =
          input.unitCostCents === undefined
            ? balance.averageCostCents
            : Math.round(
                ((balance.averageCostCents ?? input.unitCostCents) * previousMilli +
                  input.unitCostCents * quantityMilli) /
                  (previousMilli + quantityMilli),
              );
        await tx
          .update(managementStockBalances)
          .set({
            quantity: resultingQuantity,
            averageCostCents,
            version: balance.version + 1,
            updatedAt: new Date(),
          })
          .where(eq(managementStockBalances.id, balance.id));
        const eventId = randomUUID();
        const lineId = randomUUID();
        await tx.insert(managementInventoryEvents).values({
          id: eventId,
          organizationId,
          unitId,
          type: "adjustment",
          reason: `Entrada do lote ${input.batchCode}`,
          idempotencyKey,
          actorIdentityId: identityId,
        });
        await tx.insert(managementInventoryEventLines).values({
          id: lineId,
          organizationId,
          unitId,
          eventId,
          locationId: input.locationId,
          inventoryItemId: input.inventoryItemId,
          lotId: lot.id,
          previousQuantity: balance.quantity,
          quantityDelta: milliToQuantity(quantityMilli),
          resultingQuantity,
        });
        await tx.insert(managementInventoryMovements).values({
          organizationId,
          unitId,
          locationId: input.locationId,
          inventoryItemId: input.inventoryItemId,
          lotId: lot.id,
          type: "lot_receipt",
          quantityDelta: milliToQuantity(quantityMilli),
          unitCostCents: input.unitCostCents ?? null,
          sourceType: "inventory_event_line",
          sourceId: lineId,
          actorIdentityId: identityId,
        });
        await this.record(
          tx,
          identityId,
          organizationId,
          unitId,
          "management.inventory-lot.created",
          "inventory_lot",
          lot.id,
          { inventoryItemId: input.inventoryItemId, locationId: input.locationId },
        );
        return lot;
      },
    );
  }

  async updateInventoryLot(
    identityId: string,
    organizationId: string,
    unitId: string,
    lotId: string,
    input: InventoryLotUpdateInput,
  ) {
    await this.requireRole(identityId, organizationId, unitId, INVENTORY_ROLES);
    return this.database.db.transaction(async (tx) => {
      if (input.active === false) {
        const [existing] = await tx
          .select({ quantity: managementInventoryLots.quantity })
          .from(managementInventoryLots)
          .where(
            and(
              eq(managementInventoryLots.organizationId, organizationId),
              eq(managementInventoryLots.unitId, unitId),
              eq(managementInventoryLots.id, lotId),
            ),
          )
          .limit(1);
        if (existing && quantityToMilli(existing.quantity) !== 0)
          throw new ConflictException({
            code: "INVENTORY_LOT_NOT_EMPTY",
            message: "Zere o lote antes de inativá-lo.",
          });
      }
      const [lot] = await tx
        .update(managementInventoryLots)
        .set({
          ...input,
          expiresAt:
            input.expiresAt === undefined
              ? undefined
              : input.expiresAt === null
                ? null
                : new Date(input.expiresAt),
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(managementInventoryLots.organizationId, organizationId),
            eq(managementInventoryLots.unitId, unitId),
            eq(managementInventoryLots.id, lotId),
          ),
        )
        .returning();
      if (!lot)
        throw new NotFoundException({
          code: "INVENTORY_LOT_NOT_FOUND",
          message: "Lote não encontrado nesta unidade.",
        });
      await this.record(
        tx,
        identityId,
        organizationId,
        unitId,
        "management.inventory-lot.updated",
        "inventory_lot",
        lotId,
        { fields: Object.keys(input) },
      );
      return lot;
    });
  }

  async importNfe(
    identityId: string,
    organizationId: string,
    unitId: string,
    idempotencyKey: string,
    input: NfeImportInput,
  ) {
    await this.requireRole(identityId, organizationId, unitId, INVENTORY_ROLES);
    let parsed: ReturnType<typeof parseNfe>;
    try {
      parsed = parseNfe(input.xml);
    } catch (error) {
      if (error instanceof NfeParseError)
        throw new BadRequestException({ code: error.code, message: error.message });
      throw error;
    }
    return this.idempotent(
      identityId,
      organizationId,
      unitId,
      idempotencyKey,
      "nfe-import.create",
      {
        supplierId: input.supplierId ?? null,
        accessKey: parsed.accessKey,
        contentHash: parsed.contentHash,
      },
      async (tx) => {
        const [unit] = await tx
          .select({
            legalEntityId: units.legalEntityId,
            legalDocument: legalEntities.document,
            organizationDocument: organizations.document,
          })
          .from(units)
          .innerJoin(organizations, eq(units.organizationId, organizations.id))
          .leftJoin(legalEntities, eq(units.legalEntityId, legalEntities.id))
          .where(and(eq(units.organizationId, organizationId), eq(units.id, unitId)))
          .limit(1);
        const recipientDocument = unit?.legalEntityId
          ? unit.legalDocument
          : unit?.organizationDocument;
        if (!recipientDocument || recipientDocument.replace(/\D/g, "") !== parsed.recipientDocument)
          throw new ConflictException({
            code: "NFE_RECIPIENT_MISMATCH",
            message: "O destinatário da NF-e não corresponde à entidade legal desta unidade.",
          });
        const supplierFilter = input.supplierId
          ? eq(managementSuppliers.id, input.supplierId)
          : eq(managementSuppliers.normalizedDocument, parsed.issuerDocument);
        const [supplier] = await tx
          .select()
          .from(managementSuppliers)
          .where(
            and(
              eq(managementSuppliers.organizationId, organizationId),
              eq(managementSuppliers.unitId, unitId),
              supplierFilter,
              eq(managementSuppliers.active, true),
            ),
          )
          .limit(1);
        if (!supplier)
          throw new NotFoundException({
            code: "NFE_SUPPLIER_NOT_FOUND",
            message: "Cadastre ou selecione o fornecedor emitente antes de importar.",
          });
        if (supplier.normalizedDocument !== parsed.issuerDocument)
          throw new ConflictException({
            code: "NFE_ISSUER_MISMATCH",
            message: "O emitente da NF-e não corresponde ao fornecedor selecionado.",
          });
        const [duplicate] = await tx
          .select({
            id: managementNfeImports.id,
            accessKey: managementNfeImports.accessKey,
            xmlSha256: managementNfeImports.xmlSha256,
          })
          .from(managementNfeImports)
          .where(
            and(
              eq(managementNfeImports.organizationId, organizationId),
              eq(managementNfeImports.unitId, unitId),
              or(
                eq(managementNfeImports.accessKey, parsed.accessKey),
                eq(managementNfeImports.xmlSha256, parsed.contentHash),
              ),
            ),
          )
          .limit(1);
        if (duplicate)
          throw new ConflictException({
            code:
              duplicate.accessKey === parsed.accessKey
                ? "NFE_ACCESS_KEY_DUPLICATE"
                : "NFE_CONTENT_DUPLICATE",
            message: "Esta NF-e já foi importada nesta unidade.",
            importId: duplicate.id,
          });
        const [aliases, inventoryItems] = await Promise.all([
          tx
            .select({
              inventoryItemId: managementInventorySupplierAliases.inventoryItemId,
              supplierProductCode: managementInventorySupplierAliases.supplierProductCode,
              supplierBarcode: managementInventorySupplierAliases.supplierBarcode,
            })
            .from(managementInventorySupplierAliases)
            .where(
              and(
                eq(managementInventorySupplierAliases.organizationId, organizationId),
                eq(managementInventorySupplierAliases.unitId, unitId),
                eq(managementInventorySupplierAliases.supplierId, supplier.id),
                eq(managementInventorySupplierAliases.active, true),
              ),
            ),
          tx
            .select({ id: managementInventoryItems.id, barcode: managementInventoryItems.barcode })
            .from(managementInventoryItems)
            .where(
              and(
                eq(managementInventoryItems.organizationId, organizationId),
                eq(managementInventoryItems.unitId, unitId),
                eq(managementInventoryItems.active, true),
              ),
            ),
        ]);
        const suggestions = parsed.lines.map((line) => ({
          line,
          match: suggestNfeLineMatch(line, aliases, inventoryItems),
        }));
        const unresolved = suggestions.some(({ match }) => match.matchType !== "supplier_alias");
        const importId = randomUUID();
        await tx.insert(managementNfeImports).values({
          id: importId,
          organizationId,
          unitId,
          supplierId: supplier.id,
          accessKey: parsed.accessKey,
          xmlSha256: parsed.contentHash,
          xmlContent: parsed.xml,
          status: unresolved ? "reviewing" : "ready",
          documentNumber: parsed.documentNumber,
          issuedAt: new Date(`${parsed.issuedAt}T00:00:00.000Z`),
          totalCents: parsed.totalCents,
          idempotencyKey,
          importedByIdentityId: identityId,
          metadata: {
            issuerName: parsed.issuerName,
            issuerDocument: parsed.issuerDocument,
            recipientDocument: parsed.recipientDocument,
          },
        });
        const lines = suggestions.map(({ line, match }) => ({
          id: randomUUID(),
          organizationId,
          unitId,
          nfeImportId: importId,
          lineNumber: line.lineNumber,
          status:
            match.matchType === "supplier_alias"
              ? ("matched" as const)
              : match.matchType === "new"
                ? ("new" as const)
                : ("suggested" as const),
          inventoryItemId: match.inventoryItemId,
          supplierProductCode: line.supplierProductCode,
          gtin: line.barcode,
          description: line.description,
          ncm: line.ncm,
          cfop: line.cfop,
          purchaseUnit: line.unit,
          quantity: line.quantity,
          unitCostCents: line.unitCostCents,
          totalCents: line.totalCents,
          metadata: { matchType: match.matchType, isNew: match.matchType === "new" },
        }));
        await tx.insert(managementNfeImportLines).values(lines);
        await this.record(
          tx,
          identityId,
          organizationId,
          unitId,
          "management.nfe-import.created",
          "nfe_import",
          importId,
          {
            accessKey: parsed.accessKey,
            newItems: lines.filter((line) => line.status === "new").length,
          },
        );
        const lineTotalCents = lines.reduce((sum, line) => sum + line.totalCents, 0);
        return {
          importId,
          status: unresolved ? "reviewing" : "ready",
          supplierId: supplier.id,
          documentNumber: parsed.documentNumber,
          accessKey: parsed.accessKey,
          totalCents: parsed.totalCents,
          lineTotalCents,
          totalDivergenceCents: parsed.totalCents - lineTotalCents,
          lines,
        };
      },
    );
  }

  async reviewNfeImport(
    identityId: string,
    organizationId: string,
    unitId: string,
    importId: string,
    idempotencyKey: string,
    input: NfeImportReviewInput,
  ) {
    await this.requireRole(identityId, organizationId, unitId, INVENTORY_ROLES);
    return this.idempotent(
      identityId,
      organizationId,
      unitId,
      idempotencyKey,
      "nfe-import.review",
      { importId, ...input },
      async (tx) => {
        await tx.execute(
          sql`select id from management_nfe_imports where organization_id=${organizationId}::uuid and unit_id=${unitId}::uuid and id=${importId}::uuid for update`,
        );
        const [nfeImport] = await tx
          .select()
          .from(managementNfeImports)
          .where(
            and(
              eq(managementNfeImports.organizationId, organizationId),
              eq(managementNfeImports.unitId, unitId),
              eq(managementNfeImports.id, importId),
            ),
          )
          .limit(1);
        if (!nfeImport)
          throw new NotFoundException({
            code: "NFE_IMPORT_NOT_FOUND",
            message: "Importação não encontrada.",
          });
        if (nfeImport.status === "confirmed" || nfeImport.status === "canceled")
          throw new ConflictException({
            code: "NFE_IMPORT_NOT_REVIEWABLE",
            message: "A importação não pode mais ser revisada.",
          });
        if (input.supplierId && input.supplierId !== nfeImport.supplierId)
          throw new ConflictException({
            code: "NFE_SUPPLIER_IMMUTABLE",
            message: "Reimporte a NF-e para trocar o fornecedor.",
          });
        const storedLines = await tx
          .select()
          .from(managementNfeImportLines)
          .where(
            and(
              eq(managementNfeImportLines.organizationId, organizationId),
              eq(managementNfeImportLines.unitId, unitId),
              eq(managementNfeImportLines.nfeImportId, importId),
            ),
          );
        if (
          storedLines.length !== input.lines.length ||
          new Set(input.lines.map((line) => line.lineId)).size !== storedLines.length
        )
          throw new BadRequestException({
            code: "NFE_REVIEW_INCOMPLETE",
            message: "Revise todas as linhas da NF-e uma única vez.",
          });
        const byId = new Map(storedLines.map((line) => [line.id, line]));
        for (const review of input.lines) {
          const line = byId.get(review.lineId);
          if (!line)
            throw new BadRequestException({
              code: "NFE_LINE_NOT_FOUND",
              message: "Uma linha não pertence a esta NF-e.",
            });
          if (review.status === "ignored") {
            await tx
              .update(managementNfeImportLines)
              .set({ status: "ignored", inventoryItemId: null, updatedAt: new Date() })
              .where(eq(managementNfeImportLines.id, line.id));
            continue;
          }
          let inventoryItemId = review.inventoryItemId;
          if (review.status === "new" && review.newItem) {
            if (review.newItem.productId)
              await this.requireProduct(tx, organizationId, review.newItem.productId);
            inventoryItemId = undefined;
          }
          if (review.status === "matched" && !inventoryItemId)
            throw new BadRequestException({
              code: "NFE_LINE_ITEM_REQUIRED",
              message: "Selecione o item da linha.",
            });
          const item = inventoryItemId
            ? await this.requireInventoryItem(tx, organizationId, unitId, inventoryItemId)
            : null;
          await tx
            .update(managementNfeImportLines)
            .set({
              status: review.status,
              inventoryItemId: inventoryItemId ?? null,
              purchaseToStockFactor:
                item?.purchaseToStockFactor ??
                String(review.newItem?.purchaseToStockFactor ?? line.purchaseToStockFactor),
              metadata: {
                ...(line.metadata ?? {}),
                isNew: review.status === "new",
                newItem: review.status === "new" ? review.newItem : null,
                reviewedByIdentityId: identityId,
              },
              updatedAt: new Date(),
            })
            .where(eq(managementNfeImportLines.id, line.id));
        }
        await tx
          .update(managementNfeImports)
          .set({ status: "ready", updatedAt: new Date() })
          .where(eq(managementNfeImports.id, importId));
        await this.record(
          tx,
          identityId,
          organizationId,
          unitId,
          "management.nfe-import.reviewed",
          "nfe_import",
          importId,
          {},
        );
        return { importId, status: "ready" };
      },
    );
  }

  async confirmNfeImport(
    identityId: string,
    organizationId: string,
    unitId: string,
    importId: string,
    idempotencyKey: string,
    input: NfeImportConfirmInput,
  ) {
    await this.requireRole(identityId, organizationId, unitId, INVENTORY_ROLES);
    return this.idempotent(
      identityId,
      organizationId,
      unitId,
      idempotencyKey,
      "nfe-import.confirm",
      { importId, ...input },
      async (tx) => {
        await tx.execute(
          sql`select id from management_nfe_imports where organization_id=${organizationId}::uuid and unit_id=${unitId}::uuid and id=${importId}::uuid for update`,
        );
        const [nfeImport] = await tx
          .select()
          .from(managementNfeImports)
          .where(
            and(
              eq(managementNfeImports.organizationId, organizationId),
              eq(managementNfeImports.unitId, unitId),
              eq(managementNfeImports.id, importId),
            ),
          )
          .limit(1);
        if (!nfeImport)
          throw new NotFoundException({
            code: "NFE_IMPORT_NOT_FOUND",
            message: "Importação não encontrada.",
          });
        if (nfeImport.status !== "ready")
          throw new ConflictException({
            code: "NFE_IMPORT_NOT_READY",
            message: "Revise todas as linhas antes de confirmar.",
          });
        const lines = await tx
          .select()
          .from(managementNfeImportLines)
          .where(
            and(
              eq(managementNfeImportLines.organizationId, organizationId),
              eq(managementNfeImportLines.unitId, unitId),
              eq(managementNfeImportLines.nfeImportId, importId),
            ),
          );
        const accepted = lines.filter((line) => line.status !== "ignored");
        if (
          !accepted.length ||
          accepted.some(
            (line) =>
              !["matched", "new"].includes(line.status) ||
              (line.status === "matched" && !line.inventoryItemId) ||
              (line.status === "new" && !(line.metadata as { newItem?: unknown }).newItem) ||
              line.unitCostCents <= 0,
          )
        )
          throw new ConflictException({
            code: "NFE_IMPORT_LINES_INVALID",
            message: "A NF-e possui linhas pendentes, sem item ou com custo inválido.",
          });
        const lineTotalCents = accepted.reduce((sum, line) => sum + line.totalCents, 0);
        const divergenceCents = (nfeImport.totalCents ?? lineTotalCents) - lineTotalCents;
        if (divergenceCents !== 0 && !input.acceptTotalDivergence)
          throw new ConflictException({
            code: "NFE_TOTAL_DIVERGENCE",
            message:
              "O total dos produtos diverge do total da NF-e. Revise frete, impostos e descontos.",
            totalCents: nfeImport.totalCents,
            lineTotalCents,
            divergenceCents,
          });
        const purchaseOrderId = randomUUID();
        const receiptId = randomUUID();
        const receivedAt = input.receivedAt ? new Date(input.receivedAt) : new Date();
        await tx.insert(managementPurchaseOrders).values({
          id: purchaseOrderId,
          organizationId,
          unitId,
          supplierId: nfeImport.supplierId,
          status: "approved",
          totalCents: lineTotalCents,
          idempotencyKey,
          approvedAt: new Date(),
          approvedByIdentityId: identityId,
        });
        await tx.insert(managementPurchaseReceipts).values({
          id: receiptId,
          organizationId,
          unitId,
          purchaseOrderId,
          supplierId: nfeImport.supplierId,
          totalCents: lineTotalCents,
          idempotencyKey,
          receivedByIdentityId: identityId,
          receivedAt,
        });
        for (const line of accepted) {
          let inventoryItemId = line.inventoryItemId;
          if (line.status === "new") {
            const newItem = (
              line.metadata as {
                newItem?: NfeImportReviewInput["lines"][number]["newItem"];
              }
            ).newItem;
            if (!newItem)
              throw new ConflictException({
                code: "NFE_NEW_ITEM_MISSING",
                message: "Revise os dados do novo item.",
              });
            if (newItem.productId) await this.requireProduct(tx, organizationId, newItem.productId);
            inventoryItemId = randomUUID();
            await tx.insert(managementInventoryItems).values({
              id: inventoryItemId,
              organizationId,
              unitId,
              productId: newItem.productId,
              preferredSupplierId: nfeImport.supplierId,
              name: newItem.name,
              kind: newItem.kind,
              sku: newItem.sku,
              barcode: newItem.barcode ?? line.gtin,
              unit: newItem.unit,
              purchaseUnit: newItem.purchaseUnit ?? line.purchaseUnit,
              purchaseToStockFactor: String(newItem.purchaseToStockFactor),
            });
            await tx
              .update(managementNfeImportLines)
              .set({ inventoryItemId, updatedAt: new Date() })
              .where(eq(managementNfeImportLines.id, line.id));
          }
          if (!inventoryItemId) throw new ConflictException("A linha não possui item de estoque.");
          const item = await this.requireInventoryItem(tx, organizationId, unitId, inventoryItemId);
          await tx
            .insert(managementInventorySupplierAliases)
            .values({
              organizationId,
              unitId,
              supplierId: nfeImport.supplierId,
              inventoryItemId,
              supplierProductCode: line.supplierProductCode ?? String(line.lineNumber),
              supplierBarcode: line.gtin,
              supplierDescription: line.description,
              purchaseUnit: line.purchaseUnit,
              purchaseToStockFactor: line.purchaseToStockFactor,
            })
            .onConflictDoUpdate({
              target: [
                managementInventorySupplierAliases.organizationId,
                managementInventorySupplierAliases.unitId,
                managementInventorySupplierAliases.supplierId,
                managementInventorySupplierAliases.supplierProductCode,
              ],
              set: {
                inventoryItemId,
                supplierBarcode: line.gtin,
                supplierDescription: line.description,
                purchaseUnit: line.purchaseUnit,
                purchaseToStockFactor: line.purchaseToStockFactor,
                active: true,
                updatedAt: new Date(),
              },
            });
          const conversion = purchaseStockConversion(
            line.quantity,
            line.purchaseToStockFactor,
            line.unitCostCents,
          );
          const orderItemId = randomUUID();
          const receiptLineId = randomUUID();
          await tx.insert(managementPurchaseOrderItems).values({
            id: orderItemId,
            organizationId,
            unitId,
            purchaseOrderId,
            inventoryItemId,
            quantity: line.quantity,
            receivedQuantity: line.quantity,
            unitCostCents: line.unitCostCents,
            totalCents: line.totalCents,
            purchaseUnit: line.purchaseUnit,
            stockUnit: item.unit,
            purchaseToStockFactor: line.purchaseToStockFactor,
          });
          await tx.insert(managementPurchaseReceiptLines).values({
            id: receiptLineId,
            organizationId,
            unitId,
            receiptId,
            purchaseOrderItemId: orderItemId,
            inventoryItemId,
            locationId: input.locationId,
            quantity: line.quantity,
            stockQuantity: conversion.stockQuantity,
            unitCostCents: line.unitCostCents,
            stockUnitCostCents: conversion.stockUnitCostCents,
            totalCents: line.totalCents,
          });
          await this.applyStockMovement(tx, organizationId, unitId, {
            locationId: input.locationId,
            inventoryItemId,
            quantityDeltaMilli: conversion.stockMilli,
            unitCostCents: conversion.stockUnitCostCents,
            type: "purchase_receipt",
            sourceType: "purchase_receipt_line",
            sourceId: receiptLineId,
            actorIdentityId: identityId,
            occurredAt: receivedAt,
          });
        }
        await tx
          .update(managementPurchaseOrders)
          .set({ status: "received", version: 2, updatedAt: new Date() })
          .where(eq(managementPurchaseOrders.id, purchaseOrderId));
        await tx
          .update(managementNfeImports)
          .set({
            status: "confirmed",
            purchaseOrderId,
            confirmedByIdentityId: identityId,
            confirmedAt: new Date(),
            metadata: {
              ...(nfeImport.metadata ?? {}),
              lineTotalCents,
              divergenceCents,
              divergenceAccepted: input.acceptTotalDivergence,
              divergenceReason: input.divergenceReason ?? null,
            },
            updatedAt: new Date(),
          })
          .where(eq(managementNfeImports.id, importId));
        await this.record(
          tx,
          identityId,
          organizationId,
          unitId,
          "management.nfe-import.confirmed",
          "nfe_import",
          importId,
          { purchaseOrderId, receiptId, lineTotalCents, divergenceCents },
        );
        return {
          importId,
          status: "confirmed",
          purchaseOrderId,
          receiptId,
          lineTotalCents,
          divergenceCents,
        };
      },
    );
  }

  async createPurchaseOrder(
    identityId: string,
    organizationId: string,
    unitId: string,
    idempotencyKey: string,
    input: PurchaseOrderInput,
  ) {
    await this.requireRole(identityId, organizationId, unitId, INVENTORY_ROLES);
    const unique = new Set(input.items.map((item) => item.inventoryItemId));
    if (unique.size !== input.items.length)
      throw new BadRequestException({
        code: "DUPLICATE_PURCHASE_ITEM",
        message: "Cada item deve aparecer uma vez.",
      });
    return this.idempotent(
      identityId,
      organizationId,
      unitId,
      idempotencyKey,
      "purchase-order",
      input,
      async (tx) => {
        const [supplier] = await tx
          .select({ id: managementSuppliers.id })
          .from(managementSuppliers)
          .where(
            and(
              eq(managementSuppliers.organizationId, organizationId),
              eq(managementSuppliers.unitId, unitId),
              eq(managementSuppliers.id, input.supplierId),
              eq(managementSuppliers.active, true),
            ),
          )
          .limit(1);
        if (!supplier)
          throw new NotFoundException({
            code: "SUPPLIER_NOT_FOUND",
            message: "Fornecedor não encontrado nesta unidade.",
          });
        const ids = input.items.map((item) => item.inventoryItemId);
        const items = await tx
          .select({
            id: managementInventoryItems.id,
            stockUnit: managementInventoryItems.unit,
            purchaseUnit: managementInventoryItems.purchaseUnit,
            purchaseToStockFactor: managementInventoryItems.purchaseToStockFactor,
          })
          .from(managementInventoryItems)
          .where(
            and(
              eq(managementInventoryItems.organizationId, organizationId),
              eq(managementInventoryItems.unitId, unitId),
              inArray(managementInventoryItems.id, ids),
              eq(managementInventoryItems.active, true),
            ),
          );
        if (items.length !== ids.length)
          throw new NotFoundException({
            code: "INVENTORY_ITEM_NOT_FOUND",
            message: "Um ou mais itens não pertencem à unidade.",
          });
        const itemById = new Map(items.map((item) => [item.id, item]));
        const totalCents = input.items.reduce(
          (sum, item) =>
            sum +
            purchaseStockConversion(
              item.quantity,
              itemById.get(item.inventoryItemId)?.purchaseToStockFactor ?? "0",
              item.unitCostCents,
            ).totalCents,
          0,
        );
        const purchaseOrderId = randomUUID();
        const [created] = await tx
          .insert(managementPurchaseOrders)
          .values({
            id: purchaseOrderId,
            organizationId,
            unitId,
            supplierId: input.supplierId,
            totalCents,
            idempotencyKey,
            expectedAt: input.expectedAt ? new Date(input.expectedAt) : undefined,
          })
          .returning({ humanNumber: managementPurchaseOrders.humanNumber });
        await tx.insert(managementPurchaseOrderItems).values(
          input.items.map((item) => {
            const snapshot = itemById.get(item.inventoryItemId);
            if (!snapshot)
              throw new NotFoundException({
                code: "INVENTORY_ITEM_NOT_FOUND",
                message: "Item não pertence à unidade.",
              });
            return {
              organizationId,
              unitId,
              purchaseOrderId,
              inventoryItemId: item.inventoryItemId,
              quantity: String(item.quantity),
              unitCostCents: item.unitCostCents,
              totalCents: purchaseStockConversion(
                item.quantity,
                snapshot.purchaseToStockFactor,
                item.unitCostCents,
              ).totalCents,
              purchaseUnit: snapshot.purchaseUnit ?? snapshot.stockUnit,
              stockUnit: snapshot.stockUnit,
              purchaseToStockFactor: snapshot.purchaseToStockFactor,
            };
          }),
        );
        await this.record(
          tx,
          identityId,
          organizationId,
          unitId,
          "management.purchase-order.created",
          "purchase_order",
          purchaseOrderId,
          { supplierId: input.supplierId, totalCents },
        );
        return {
          purchaseOrderId,
          humanNumber: created?.humanNumber ?? null,
          code: created?.humanNumber ? `PUR-${String(created.humanNumber).padStart(6, "0")}` : null,
          status: "draft",
          totalCents,
        };
      },
    );
  }

  async approvePurchaseOrder(
    identityId: string,
    organizationId: string,
    unitId: string,
    purchaseOrderId: string,
    idempotencyKey: string,
    input: PurchaseVersionInput,
  ) {
    await this.requireRole(identityId, organizationId, unitId, ["owner", "manager"]);
    return this.idempotent(
      identityId,
      organizationId,
      unitId,
      idempotencyKey,
      "purchase-order-approve",
      { purchaseOrderId, ...input },
      async (tx) => {
        await tx.execute(
          sql`select id from management_purchase_orders where organization_id=${organizationId}::uuid and unit_id=${unitId}::uuid and id=${purchaseOrderId}::uuid for update`,
        );
        const [order] = await tx
          .select()
          .from(managementPurchaseOrders)
          .where(
            and(
              eq(managementPurchaseOrders.organizationId, organizationId),
              eq(managementPurchaseOrders.unitId, unitId),
              eq(managementPurchaseOrders.id, purchaseOrderId),
            ),
          )
          .limit(1);
        if (!order)
          throw new NotFoundException({
            code: "PURCHASE_ORDER_NOT_FOUND",
            message: "Pedido de compra não encontrado.",
          });
        if (order.version !== input.version)
          throw new ConflictException({
            code: "PURCHASE_ORDER_VERSION_CONFLICT",
            message: "O pedido foi alterado por outra operação.",
          });
        if (order.status !== "draft")
          throw new ConflictException({
            code: "PURCHASE_ORDER_NOT_DRAFT",
            message: "Somente pedidos em rascunho podem ser aprovados.",
          });
        await tx
          .update(managementPurchaseOrders)
          .set({
            status: "approved",
            approvedAt: new Date(),
            approvedByIdentityId: identityId,
            version: input.version + 1,
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(managementPurchaseOrders.organizationId, organizationId),
              eq(managementPurchaseOrders.unitId, unitId),
              eq(managementPurchaseOrders.id, order.id),
              eq(managementPurchaseOrders.version, input.version),
            ),
          )
          .returning({ id: managementPurchaseOrders.id });
        await this.record(
          tx,
          identityId,
          organizationId,
          unitId,
          "management.purchase-order.approved",
          "purchase_order",
          order.id,
          { totalCents: order.totalCents },
        );
        return { purchaseOrderId: order.id, status: "approved", version: input.version + 1 };
      },
    );
  }

  async updatePurchaseOrder(
    identityId: string,
    organizationId: string,
    unitId: string,
    purchaseOrderId: string,
    idempotencyKey: string,
    input: PurchaseOrderUpdateInput,
  ) {
    await this.requireRole(identityId, organizationId, unitId, INVENTORY_ROLES);
    return this.idempotent(
      identityId,
      organizationId,
      unitId,
      idempotencyKey,
      "purchase-order-update",
      { purchaseOrderId, ...input },
      async (tx) => {
        await tx.execute(
          sql`select id from management_purchase_orders where organization_id=${organizationId}::uuid and unit_id=${unitId}::uuid and id=${purchaseOrderId}::uuid for update`,
        );
        const [order] = await tx
          .select()
          .from(managementPurchaseOrders)
          .where(
            and(
              eq(managementPurchaseOrders.organizationId, organizationId),
              eq(managementPurchaseOrders.unitId, unitId),
              eq(managementPurchaseOrders.id, purchaseOrderId),
            ),
          )
          .limit(1);
        if (!order)
          throw new NotFoundException({
            code: "PURCHASE_ORDER_NOT_FOUND",
            message: "Pedido de compra não encontrado.",
          });
        if (order.status !== "draft" && order.status !== "rejected")
          throw new ConflictException({
            code: "PURCHASE_ORDER_NOT_EDITABLE",
            message: "Somente rascunhos ou pedidos devolvidos podem ser editados.",
          });
        const [invoice] = await tx
          .select({ id: managementSupplierInvoices.id })
          .from(managementSupplierInvoices)
          .where(
            and(
              eq(managementSupplierInvoices.organizationId, organizationId),
              eq(managementSupplierInvoices.unitId, unitId),
              eq(managementSupplierInvoices.purchaseOrderId, purchaseOrderId),
            ),
          )
          .limit(1);
        if (invoice)
          throw new ConflictException({
            code: "PURCHASE_ORDER_HAS_INVOICE",
            message: "O pedido com fatura não pode ser editado.",
          });
        if (input.version !== order.version)
          throw new ConflictException({
            code: "PURCHASE_ORDER_VERSION_CONFLICT",
            message: "O pedido foi alterado por outra operação.",
          });
        if (input.supplierId)
          await this.requireSupplier(tx, organizationId, unitId, input.supplierId);
        let totalCents = order.totalCents;
        if (input.items) {
          if (new Set(input.items.map((item) => item.inventoryItemId)).size !== input.items.length)
            throw new BadRequestException({
              code: "DUPLICATE_PURCHASE_ITEM",
              message: "Cada item deve aparecer uma vez.",
            });
          const inventory = await tx
            .select({
              id: managementInventoryItems.id,
              stockUnit: managementInventoryItems.unit,
              purchaseUnit: managementInventoryItems.purchaseUnit,
              purchaseToStockFactor: managementInventoryItems.purchaseToStockFactor,
            })
            .from(managementInventoryItems)
            .where(
              and(
                eq(managementInventoryItems.organizationId, organizationId),
                eq(managementInventoryItems.unitId, unitId),
                inArray(
                  managementInventoryItems.id,
                  input.items.map((item) => item.inventoryItemId),
                ),
                eq(managementInventoryItems.active, true),
              ),
            );
          if (inventory.length !== input.items.length)
            throw new NotFoundException({
              code: "INVENTORY_ITEM_NOT_FOUND",
              message: "Um ou mais itens não pertencem à unidade.",
            });
          const byId = new Map(inventory.map((item) => [item.id, item]));
          totalCents = input.items.reduce(
            (sum, item) =>
              sum +
              purchaseStockConversion(
                item.quantity,
                byId.get(item.inventoryItemId)?.purchaseToStockFactor ?? "0",
                item.unitCostCents,
              ).totalCents,
            0,
          );
          await tx
            .delete(managementPurchaseOrderItems)
            .where(eq(managementPurchaseOrderItems.purchaseOrderId, purchaseOrderId));
          await tx.insert(managementPurchaseOrderItems).values(
            input.items.map((item) => {
              const snapshot = byId.get(item.inventoryItemId);
              if (!snapshot)
                throw new NotFoundException({
                  code: "INVENTORY_ITEM_NOT_FOUND",
                  message: "Item não encontrado.",
                });
              return {
                organizationId,
                unitId,
                purchaseOrderId,
                inventoryItemId: item.inventoryItemId,
                quantity: String(item.quantity),
                unitCostCents: item.unitCostCents,
                totalCents: purchaseStockConversion(
                  item.quantity,
                  snapshot.purchaseToStockFactor,
                  item.unitCostCents,
                ).totalCents,
                purchaseUnit: snapshot.purchaseUnit ?? snapshot.stockUnit,
                stockUnit: snapshot.stockUnit,
                purchaseToStockFactor: snapshot.purchaseToStockFactor,
              };
            }),
          );
        }
        await tx
          .update(managementPurchaseOrders)
          .set({
            supplierId: input.supplierId,
            expectedAt: input.expectedAt ? new Date(input.expectedAt) : undefined,
            totalCents,
            status: "draft",
            rejectedAt: null,
            rejectedByIdentityId: null,
            rejectionReason: null,
            version: input.version + 1,
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(managementPurchaseOrders.organizationId, organizationId),
              eq(managementPurchaseOrders.unitId, unitId),
              eq(managementPurchaseOrders.id, purchaseOrderId),
              eq(managementPurchaseOrders.version, input.version),
            ),
          );
        await this.record(
          tx,
          identityId,
          organizationId,
          unitId,
          "management.purchase-order.updated",
          "purchase_order",
          purchaseOrderId,
          { totalCents, version: input.version + 1 },
        );
        return { purchaseOrderId, status: "draft", totalCents, version: input.version + 1 };
      },
    );
  }

  async cancelPurchaseOrder(
    identityId: string,
    organizationId: string,
    unitId: string,
    purchaseOrderId: string,
    idempotencyKey: string,
    input: PurchaseTransitionInput,
  ) {
    await this.requireRole(identityId, organizationId, unitId, INVENTORY_ROLES);
    return this.transitionPurchase(
      identityId,
      organizationId,
      unitId,
      purchaseOrderId,
      idempotencyKey,
      input,
      "canceled",
    );
  }

  async rejectPurchaseOrder(
    identityId: string,
    organizationId: string,
    unitId: string,
    purchaseOrderId: string,
    idempotencyKey: string,
    input: PurchaseTransitionInput,
  ) {
    await this.requireRole(identityId, organizationId, unitId, ["owner", "manager"]);
    return this.transitionPurchase(
      identityId,
      organizationId,
      unitId,
      purchaseOrderId,
      idempotencyKey,
      input,
      "rejected",
    );
  }

  private transitionPurchase(
    identityId: string,
    organizationId: string,
    unitId: string,
    purchaseOrderId: string,
    idempotencyKey: string,
    input: PurchaseTransitionInput,
    target: "canceled" | "rejected",
  ) {
    return this.idempotent(
      identityId,
      organizationId,
      unitId,
      idempotencyKey,
      `purchase-order-${target}`,
      { purchaseOrderId, ...input },
      async (tx) => {
        await tx.execute(
          sql`select id from management_purchase_orders where organization_id=${organizationId}::uuid and unit_id=${unitId}::uuid and id=${purchaseOrderId}::uuid for update`,
        );
        const [order] = await tx
          .select()
          .from(managementPurchaseOrders)
          .where(
            and(
              eq(managementPurchaseOrders.organizationId, organizationId),
              eq(managementPurchaseOrders.unitId, unitId),
              eq(managementPurchaseOrders.id, purchaseOrderId),
            ),
          )
          .limit(1);
        if (!order)
          throw new NotFoundException({
            code: "PURCHASE_ORDER_NOT_FOUND",
            message: "Pedido de compra não encontrado.",
          });
        if (input.version !== order.version)
          throw new ConflictException({
            code: "PURCHASE_ORDER_VERSION_CONFLICT",
            message: "O pedido foi alterado por outra operação.",
          });
        const allowed =
          target === "rejected" ? ["draft", "approved"] : ["draft", "rejected", "approved"];
        if (!allowed.includes(order.status))
          throw new ConflictException({
            code: "PURCHASE_ORDER_TRANSITION_DENIED",
            message: "O estado atual não permite esta transição.",
          });
        const [invoice] = await tx
          .select({ id: managementSupplierInvoices.id })
          .from(managementSupplierInvoices)
          .where(
            and(
              eq(managementSupplierInvoices.organizationId, organizationId),
              eq(managementSupplierInvoices.unitId, unitId),
              eq(managementSupplierInvoices.purchaseOrderId, purchaseOrderId),
            ),
          )
          .limit(1);
        if (invoice)
          throw new ConflictException({
            code: "PURCHASE_ORDER_HAS_INVOICE",
            message: "O pedido com fatura não pode ser cancelado ou devolvido.",
          });
        const now = new Date();
        await tx
          .update(managementPurchaseOrders)
          .set(
            target === "canceled"
              ? {
                  status: target,
                  canceledAt: now,
                  cancelReason: input.reason,
                  version: input.version + 1,
                  updatedAt: now,
                }
              : {
                  status: target,
                  rejectedAt: now,
                  rejectedByIdentityId: identityId,
                  rejectionReason: input.reason,
                  approvedAt: null,
                  approvedByIdentityId: null,
                  version: input.version + 1,
                  updatedAt: now,
                },
          )
          .where(
            and(
              eq(managementPurchaseOrders.organizationId, organizationId),
              eq(managementPurchaseOrders.unitId, unitId),
              eq(managementPurchaseOrders.id, purchaseOrderId),
              eq(managementPurchaseOrders.version, input.version),
            ),
          );
        await this.record(
          tx,
          identityId,
          organizationId,
          unitId,
          `management.purchase-order.${target}`,
          "purchase_order",
          purchaseOrderId,
          { reason: input.reason },
        );
        return { purchaseOrderId, status: target, version: input.version + 1 };
      },
    );
  }

  async receivePurchaseOrder(
    identityId: string,
    organizationId: string,
    unitId: string,
    purchaseOrderId: string,
    idempotencyKey: string,
    input: PurchaseReceiptInput,
  ) {
    await this.requireRole(identityId, organizationId, unitId, INVENTORY_ROLES);
    const unique = new Set(input.lines.map((line) => line.purchaseOrderItemId));
    if (unique.size !== input.lines.length)
      throw new BadRequestException({
        code: "DUPLICATE_RECEIPT_LINE",
        message: "Cada item do pedido deve aparecer uma vez por recebimento.",
      });
    return this.idempotent(
      identityId,
      organizationId,
      unitId,
      idempotencyKey,
      "purchase-receipt",
      { purchaseOrderId, ...input },
      async (tx) => {
        await tx.execute(
          sql`select id from management_purchase_orders where organization_id=${organizationId}::uuid and unit_id=${unitId}::uuid and id=${purchaseOrderId}::uuid for update`,
        );
        const [order] = await tx
          .select()
          .from(managementPurchaseOrders)
          .where(
            and(
              eq(managementPurchaseOrders.organizationId, organizationId),
              eq(managementPurchaseOrders.unitId, unitId),
              eq(managementPurchaseOrders.id, purchaseOrderId),
            ),
          )
          .limit(1);
        if (!order)
          throw new NotFoundException({
            code: "PURCHASE_ORDER_NOT_FOUND",
            message: "Pedido de compra não encontrado.",
          });
        if (order.status !== "approved" && order.status !== "partially_received")
          throw new ConflictException({
            code: "PURCHASE_ORDER_NOT_RECEIVABLE",
            message: "O pedido não está aprovado ou parcialmente recebido.",
          });
        const orderItems = await tx
          .select()
          .from(managementPurchaseOrderItems)
          .where(
            and(
              eq(managementPurchaseOrderItems.organizationId, organizationId),
              eq(managementPurchaseOrderItems.unitId, unitId),
              eq(managementPurchaseOrderItems.purchaseOrderId, purchaseOrderId),
            ),
          );
        const byId = new Map(orderItems.map((item) => [item.id, item]));
        const receiptId = randomUUID();
        const plan = purchaseReceiptPlan(orderItems, input.lines);
        const totalCents = plan.totalCents;
        if (totalCents <= 0)
          throw new BadRequestException({
            code: "ZERO_RECEIPT",
            message: "O recebimento deve possuir valor positivo.",
          });
        await tx.insert(managementPurchaseReceipts).values({
          id: receiptId,
          organizationId,
          unitId,
          purchaseOrderId,
          supplierId: order.supplierId,
          totalCents,
          idempotencyKey,
          receivedByIdentityId: identityId,
          receivedAt: input.receivedAt ? new Date(input.receivedAt) : undefined,
        });
        const receivedByItem = new Map(
          orderItems.map((item) => [item.id, quantityToMilli(item.receivedQuantity)]),
        );
        for (const line of input.lines) {
          const item = byId.get(line.purchaseOrderItemId);
          if (!item)
            throw new NotFoundException({
              code: "PURCHASE_ORDER_ITEM_NOT_FOUND",
              message: "Item não pertence ao pedido desta unidade.",
            });
          if (line.unitCostCents !== undefined && line.unitCostCents !== item.unitCostCents)
            throw new ConflictException({
              code: "PURCHASE_COST_SNAPSHOT_MISMATCH",
              message: "O custo recebido diverge do custo imutável do pedido.",
            });
          const conversion = purchaseStockConversion(
            line.quantity,
            item.purchaseToStockFactor,
            item.unitCostCents,
          );
          const purchaseQuantityMilli = conversion.purchaseMilli;
          const stockQuantityMilli = conversion.stockMilli;
          const stockUnitCostCents = conversion.stockUnitCostCents;
          const nextReceivedMilli = quantityToMilli(item.receivedQuantity) + purchaseQuantityMilli;
          if (nextReceivedMilli > quantityToMilli(item.quantity))
            throw new ConflictException({
              code: "RECEIPT_EXCEEDS_ORDER",
              message: "O recebimento excede a quantidade comprada.",
            });
          const [location] = await tx
            .select({ id: managementStockLocations.id })
            .from(managementStockLocations)
            .where(
              and(
                eq(managementStockLocations.organizationId, organizationId),
                eq(managementStockLocations.unitId, unitId),
                eq(managementStockLocations.id, line.locationId),
                eq(managementStockLocations.active, true),
              ),
            )
            .limit(1);
          if (!location)
            throw new NotFoundException({
              code: "STOCK_LOCATION_NOT_FOUND",
              message: "Local de estoque não encontrado nesta unidade.",
            });
          await tx
            .insert(managementStockBalances)
            .values({
              organizationId,
              unitId,
              locationId: line.locationId,
              inventoryItemId: item.inventoryItemId,
            })
            .onConflictDoNothing({
              target: [
                managementStockBalances.organizationId,
                managementStockBalances.unitId,
                managementStockBalances.locationId,
                managementStockBalances.inventoryItemId,
              ],
            });
          await tx.execute(
            sql`select id from management_stock_balances where organization_id=${organizationId}::uuid and unit_id=${unitId}::uuid and location_id=${line.locationId}::uuid and inventory_item_id=${item.inventoryItemId}::uuid for update`,
          );
          const [balance] = await tx
            .select()
            .from(managementStockBalances)
            .where(
              and(
                eq(managementStockBalances.organizationId, organizationId),
                eq(managementStockBalances.unitId, unitId),
                eq(managementStockBalances.locationId, line.locationId),
                eq(managementStockBalances.inventoryItemId, item.inventoryItemId),
              ),
            )
            .limit(1);
          if (!balance)
            throw new ConflictException({
              code: "BALANCE_LOCK_FAILED",
              message: "Não foi possível bloquear o saldo.",
            });
          const previousMilli = quantityToMilli(balance.quantity);
          const resultingMilli = previousMilli + stockQuantityMilli;
          const previousCost = balance.averageCostCents ?? stockUnitCostCents;
          const averageCostCents =
            previousMilli > 0
              ? Math.round(
                  (previousMilli * previousCost + stockQuantityMilli * stockUnitCostCents) /
                    resultingMilli,
                )
              : stockUnitCostCents;
          const lineTotalCents = conversion.totalCents;
          const receiptLineId = randomUUID();
          let lotId: string | null = null;
          if (line.batchCode) {
            const [lot] = await tx
              .insert(managementInventoryLots)
              .values({
                organizationId,
                unitId,
                locationId: line.locationId,
                inventoryItemId: item.inventoryItemId,
                batchCode: line.batchCode,
                expiresAt: line.expiresAt ? new Date(line.expiresAt) : undefined,
                quantity: milliToQuantity(stockQuantityMilli),
                unitCostCents: stockUnitCostCents,
              })
              .onConflictDoUpdate({
                target: [
                  managementInventoryLots.organizationId,
                  managementInventoryLots.unitId,
                  managementInventoryLots.locationId,
                  managementInventoryLots.inventoryItemId,
                  managementInventoryLots.batchCode,
                ],
                set: {
                  quantity: sql`${managementInventoryLots.quantity} + ${milliToQuantity(stockQuantityMilli)}`,
                  unitCostCents: stockUnitCostCents,
                  ...(line.expiresAt ? { expiresAt: new Date(line.expiresAt) } : {}),
                  active: true,
                  updatedAt: new Date(),
                },
              })
              .returning({ id: managementInventoryLots.id });
            lotId = lot?.id ?? null;
          }
          await tx.insert(managementPurchaseReceiptLines).values({
            id: receiptLineId,
            organizationId,
            unitId,
            receiptId,
            purchaseOrderItemId: item.id,
            inventoryItemId: item.inventoryItemId,
            locationId: line.locationId,
            quantity: milliToQuantity(purchaseQuantityMilli),
            stockQuantity: milliToQuantity(stockQuantityMilli),
            unitCostCents: item.unitCostCents,
            stockUnitCostCents,
            totalCents: lineTotalCents,
            lotId,
          });
          await tx.insert(managementInventoryMovements).values({
            organizationId,
            unitId,
            locationId: line.locationId,
            inventoryItemId: item.inventoryItemId,
            lotId,
            type: "purchase_receipt",
            quantityDelta: milliToQuantity(stockQuantityMilli),
            unitCostCents: stockUnitCostCents,
            sourceType: "purchase_receipt_line",
            sourceId: receiptLineId,
            actorIdentityId: identityId,
            occurredAt: input.receivedAt ? new Date(input.receivedAt) : undefined,
          });
          await tx
            .update(managementStockBalances)
            .set({
              quantity: milliToQuantity(resultingMilli),
              averageCostCents,
              version: balance.version + 1,
              updatedAt: new Date(),
            })
            .where(eq(managementStockBalances.id, balance.id));
          await tx
            .update(managementPurchaseOrderItems)
            .set({ receivedQuantity: milliToQuantity(nextReceivedMilli), updatedAt: new Date() })
            .where(eq(managementPurchaseOrderItems.id, item.id));
          receivedByItem.set(item.id, nextReceivedMilli);
        }
        const complete = orderItems.every(
          (item) => receivedByItem.get(item.id) === quantityToMilli(item.quantity),
        );
        const status = complete ? "received" : "partially_received";
        await tx
          .update(managementPurchaseOrders)
          .set({ status, version: order.version + 1, updatedAt: new Date() })
          .where(eq(managementPurchaseOrders.id, order.id));
        await this.record(
          tx,
          identityId,
          organizationId,
          unitId,
          "management.purchase-receipt.recorded",
          "purchase_receipt",
          receiptId,
          { purchaseOrderId, totalCents, status },
        );
        return {
          receiptId,
          purchaseOrderId,
          payableId: null,
          financialStatus: "awaiting_invoice_reconciliation",
          totalCents,
          purchaseOrderStatus: status,
        };
      },
    );
  }

  async reversePurchaseReceipt(
    identityId: string,
    organizationId: string,
    unitId: string,
    receiptId: string,
    idempotencyKey: string,
    input: PurchaseReversalInput,
  ) {
    await this.requireRole(identityId, organizationId, unitId, INVENTORY_ROLES);
    return this.idempotent(
      identityId,
      organizationId,
      unitId,
      idempotencyKey,
      "purchase-receipt-reverse",
      { receiptId, ...input },
      async (tx) => {
        await tx.execute(
          sql`select id from management_purchase_receipts where organization_id=${organizationId}::uuid and unit_id=${unitId}::uuid and id=${receiptId}::uuid for update`,
        );
        const [receipt] = await tx
          .select()
          .from(managementPurchaseReceipts)
          .where(
            and(
              eq(managementPurchaseReceipts.organizationId, organizationId),
              eq(managementPurchaseReceipts.unitId, unitId),
              eq(managementPurchaseReceipts.id, receiptId),
            ),
          )
          .limit(1);
        if (!receipt)
          throw new NotFoundException({
            code: "PURCHASE_RECEIPT_NOT_FOUND",
            message: "Recebimento não encontrado.",
          });
        if (receipt.version !== input.version)
          throw new ConflictException({
            code: "PURCHASE_RECEIPT_VERSION_CONFLICT",
            message: "O recebimento foi alterado por outra operação.",
          });
        if (receipt.status !== "posted")
          throw new ConflictException({
            code: "PURCHASE_RECEIPT_ALREADY_REVERSED",
            message: "O recebimento já foi estornado.",
          });
        await tx.execute(
          sql`select id from management_purchase_orders where organization_id=${organizationId}::uuid and unit_id=${unitId}::uuid and id=${receipt.purchaseOrderId}::uuid for update`,
        );
        const [activeInvoice] = await tx
          .select({ id: managementSupplierInvoices.id })
          .from(managementSupplierInvoices)
          .where(
            and(
              eq(managementSupplierInvoices.organizationId, organizationId),
              eq(managementSupplierInvoices.unitId, unitId),
              eq(managementSupplierInvoices.purchaseOrderId, receipt.purchaseOrderId),
              ne(managementSupplierInvoices.status, "reversed"),
              ne(managementSupplierInvoices.status, "canceled"),
            ),
          )
          .limit(1);
        if (activeInvoice)
          throw new ConflictException({
            code: "PURCHASE_RECEIPT_HAS_ACTIVE_INVOICE",
            message: "Cancele a fatura ativa antes de estornar este recebimento.",
          });
        const lines = await tx
          .select()
          .from(managementPurchaseReceiptLines)
          .where(
            and(
              eq(managementPurchaseReceiptLines.organizationId, organizationId),
              eq(managementPurchaseReceiptLines.unitId, unitId),
              eq(managementPurchaseReceiptLines.receiptId, receiptId),
            ),
          );
        const lotIds = lines.flatMap((line) => (line.lotId ? [line.lotId] : []));
        const [consumedLot] = lotIds.length
          ? await tx
              .select({ id: managementInventoryMovements.id })
              .from(managementInventoryMovements)
              .where(
                and(
                  eq(managementInventoryMovements.organizationId, organizationId),
                  eq(managementInventoryMovements.unitId, unitId),
                  inArray(managementInventoryMovements.lotId, lotIds),
                  sql`${managementInventoryMovements.quantityDelta} < 0`,
                ),
              )
              .limit(1)
          : [];
        if (consumedLot)
          throw new ConflictException({
            code: "PURCHASE_RECEIPT_LOT_CONSUMED",
            message: "Um lote deste recebimento já possui consumo e não pode ser estornado.",
          });
        for (const line of lines) {
          await tx.execute(
            sql`select id from management_stock_balances where organization_id=${organizationId}::uuid and unit_id=${unitId}::uuid and location_id=${line.locationId}::uuid and inventory_item_id=${line.inventoryItemId}::uuid for update`,
          );
          const [balance] = await tx
            .select()
            .from(managementStockBalances)
            .where(
              and(
                eq(managementStockBalances.organizationId, organizationId),
                eq(managementStockBalances.unitId, unitId),
                eq(managementStockBalances.locationId, line.locationId),
                eq(managementStockBalances.inventoryItemId, line.inventoryItemId),
              ),
            )
            .limit(1);
          const stockMilli = quantityToMilli(line.stockQuantity);
          const currentMilli = quantityToMilli(balance?.quantity ?? "0");
          if (!balance || currentMilli < stockMilli)
            throw new ConflictException({
              code: "PURCHASE_RECEIPT_STOCK_CONSUMED",
              message: "O estoque deste recebimento já foi consumido.",
            });
          const remainingMilli = currentMilli - stockMilli;
          const remainingValue =
            currentMilli * (balance.averageCostCents ?? line.stockUnitCostCents) -
            stockMilli * line.stockUnitCostCents;
          await tx
            .update(managementStockBalances)
            .set({
              quantity: milliToQuantity(remainingMilli),
              averageCostCents:
                remainingMilli === 0
                  ? null
                  : Math.max(0, Math.round(remainingValue / remainingMilli)),
              version: balance.version + 1,
              updatedAt: new Date(),
            })
            .where(eq(managementStockBalances.id, balance.id));
          if (line.lotId) {
            await tx.execute(
              sql`select id from management_inventory_lots where organization_id=${organizationId}::uuid and unit_id=${unitId}::uuid and id=${line.lotId}::uuid for update`,
            );
            const [lot] = await tx
              .select({
                id: managementInventoryLots.id,
                quantity: managementInventoryLots.quantity,
              })
              .from(managementInventoryLots)
              .where(
                and(
                  eq(managementInventoryLots.organizationId, organizationId),
                  eq(managementInventoryLots.unitId, unitId),
                  eq(managementInventoryLots.id, line.lotId),
                ),
              )
              .limit(1);
            if (!lot || quantityToMilli(lot.quantity) < stockMilli)
              throw new ConflictException({
                code: "PURCHASE_RECEIPT_LOT_CONSUMED",
                message: "O lote deste recebimento já foi consumido.",
              });
            await tx
              .update(managementInventoryLots)
              .set({
                quantity: milliToQuantity(quantityToMilli(lot.quantity) - stockMilli),
                updatedAt: new Date(),
              })
              .where(eq(managementInventoryLots.id, lot.id));
          }
          await tx.insert(managementInventoryMovements).values({
            organizationId,
            unitId,
            locationId: line.locationId,
            inventoryItemId: line.inventoryItemId,
            lotId: line.lotId,
            type: "purchase_receipt_reversal",
            quantityDelta: milliToQuantity(-stockMilli),
            unitCostCents: line.stockUnitCostCents,
            sourceType: "purchase_receipt_reversal",
            sourceId: receiptId,
            actorIdentityId: identityId,
          });
          await tx
            .update(managementPurchaseOrderItems)
            .set({
              receivedQuantity: sql`${managementPurchaseOrderItems.receivedQuantity} - ${line.quantity}`,
              updatedAt: new Date(),
            })
            .where(
              and(
                eq(managementPurchaseOrderItems.organizationId, organizationId),
                eq(managementPurchaseOrderItems.unitId, unitId),
                eq(managementPurchaseOrderItems.id, line.purchaseOrderItemId),
              ),
            );
        }
        const orderItems = await tx
          .select({
            quantity: managementPurchaseOrderItems.quantity,
            receivedQuantity: managementPurchaseOrderItems.receivedQuantity,
          })
          .from(managementPurchaseOrderItems)
          .where(
            and(
              eq(managementPurchaseOrderItems.organizationId, organizationId),
              eq(managementPurchaseOrderItems.unitId, unitId),
              eq(managementPurchaseOrderItems.purchaseOrderId, receipt.purchaseOrderId),
            ),
          );
        const received = orderItems.some((item) => quantityToMilli(item.receivedQuantity) > 0);
        const complete = orderItems.every(
          (item) => quantityToMilli(item.receivedQuantity) === quantityToMilli(item.quantity),
        );
        const purchaseOrderStatus = complete
          ? "received"
          : received
            ? "partially_received"
            : "approved";
        await tx
          .update(managementPurchaseOrders)
          .set({
            status: purchaseOrderStatus,
            version: sql`${managementPurchaseOrders.version} + 1`,
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(managementPurchaseOrders.organizationId, organizationId),
              eq(managementPurchaseOrders.unitId, unitId),
              eq(managementPurchaseOrders.id, receipt.purchaseOrderId),
            ),
          );
        const [reversed] = await tx
          .update(managementPurchaseReceipts)
          .set({
            status: "reversed",
            reversalReason: input.reason,
            reversedAt: new Date(),
            reversedByIdentityId: identityId,
            version: input.version + 1,
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(managementPurchaseReceipts.organizationId, organizationId),
              eq(managementPurchaseReceipts.unitId, unitId),
              eq(managementPurchaseReceipts.id, receiptId),
              eq(managementPurchaseReceipts.status, "posted"),
              eq(managementPurchaseReceipts.version, input.version),
            ),
          )
          .returning({ version: managementPurchaseReceipts.version });
        if (!reversed)
          throw new ConflictException({
            code: "PURCHASE_RECEIPT_VERSION_CONFLICT",
            message: "O recebimento foi alterado por outra operação.",
          });
        await this.record(
          tx,
          identityId,
          organizationId,
          unitId,
          "management.purchase-receipt.reversed",
          "purchase_receipt",
          receiptId,
          {
            purchaseOrderId: receipt.purchaseOrderId,
            reason: input.reason,
            lineCount: lines.length,
          },
        );
        return {
          receiptId,
          status: "reversed",
          version: reversed.version,
          purchaseOrderId: receipt.purchaseOrderId,
          purchaseOrderStatus,
        };
      },
    );
  }

  private async invoiceReconciliation(
    tx: Transaction,
    organizationId: string,
    unitId: string,
    invoice: typeof managementSupplierInvoices.$inferSelect,
    toleranceCents: number,
  ) {
    const [order, orderItems, invoiceLines] = await Promise.all([
      tx
        .select({ totalCents: managementPurchaseOrders.totalCents })
        .from(managementPurchaseOrders)
        .where(
          and(
            eq(managementPurchaseOrders.organizationId, organizationId),
            eq(managementPurchaseOrders.unitId, unitId),
            eq(managementPurchaseOrders.id, invoice.purchaseOrderId),
          ),
        )
        .limit(1),
      tx
        .select()
        .from(managementPurchaseOrderItems)
        .where(
          and(
            eq(managementPurchaseOrderItems.organizationId, organizationId),
            eq(managementPurchaseOrderItems.unitId, unitId),
            eq(managementPurchaseOrderItems.purchaseOrderId, invoice.purchaseOrderId),
          ),
        ),
      tx
        .select()
        .from(managementSupplierInvoiceLines)
        .where(
          and(
            eq(managementSupplierInvoiceLines.organizationId, organizationId),
            eq(managementSupplierInvoiceLines.unitId, unitId),
            eq(managementSupplierInvoiceLines.invoiceId, invoice.id),
          ),
        ),
    ]);
    const purchaseOrder = order[0];
    if (!purchaseOrder)
      throw new NotFoundException({
        code: "PURCHASE_ORDER_NOT_FOUND",
        message: "Pedido de compra não encontrado.",
      });
    const receiptLines = orderItems.length
      ? await tx
          .select({
            purchaseOrderItemId: managementPurchaseReceiptLines.purchaseOrderItemId,
            quantity: managementPurchaseReceiptLines.quantity,
            totalCents: managementPurchaseReceiptLines.totalCents,
          })
          .from(managementPurchaseReceiptLines)
          .innerJoin(
            managementPurchaseReceipts,
            and(
              eq(
                managementPurchaseReceipts.organizationId,
                managementPurchaseReceiptLines.organizationId,
              ),
              eq(managementPurchaseReceipts.unitId, managementPurchaseReceiptLines.unitId),
              eq(managementPurchaseReceipts.id, managementPurchaseReceiptLines.receiptId),
            ),
          )
          .where(
            and(
              eq(managementPurchaseReceiptLines.organizationId, organizationId),
              eq(managementPurchaseReceiptLines.unitId, unitId),
              inArray(
                managementPurchaseReceiptLines.purchaseOrderItemId,
                orderItems.map((item) => item.id),
              ),
              eq(managementPurchaseReceipts.status, "posted"),
            ),
          )
      : [];
    const orderItemIds = new Set(orderItems.map((item) => item.id));
    const receiptByItem = new Map<string, { quantityMilli: number; totalCents: number }>();
    for (const line of receiptLines) {
      if (!orderItemIds.has(line.purchaseOrderItemId)) continue;
      const current = receiptByItem.get(line.purchaseOrderItemId) ?? {
        quantityMilli: 0,
        totalCents: 0,
      };
      current.quantityMilli += quantityToMilli(line.quantity);
      current.totalCents += line.totalCents;
      receiptByItem.set(line.purchaseOrderItemId, current);
    }
    const invoiceByItem = new Map(invoiceLines.map((line) => [line.purchaseOrderItemId, line]));
    const lineReconciliation = purchaseLineReconciliation(
      orderItems.map((item) => {
        const received = receiptByItem.get(item.id);
        const invoiced = invoiceByItem.get(item.id);
        return {
          purchaseOrderItemId: item.id,
          orderedQuantity: item.quantity,
          orderedUnitCostCents: item.unitCostCents,
          orderedCents: item.totalCents,
          receivedQuantity: milliToQuantity(received?.quantityMilli ?? 0),
          receivedCents: received?.totalCents ?? 0,
          invoicedQuantity: invoiced?.quantity ?? "0",
          invoicedUnitCostCents: invoiced?.unitCostCents ?? 0,
          invoicedCents: invoiced?.totalCents ?? 0,
        };
      }),
      toleranceCents,
    );
    const aggregate = calculatePurchaseReconciliation({
      orderedCents: purchaseOrder.totalCents,
      receivedCents: [...receiptByItem.values()].reduce((sum, row) => sum + row.totalCents, 0),
      invoicedCents: invoice.totalCents,
      invoiceLinesCents: invoiceLines.reduce((sum, row) => sum + row.totalCents, 0),
      toleranceCents,
    });
    const matched = aggregate.matched && lineReconciliation.matched;
    return {
      ...aggregate,
      lines: lineReconciliation.lines,
      matched,
      status: matched ? "matched" : "divergent",
    } as const;
  }

  private async confirmInvoiceTx(
    tx: Transaction,
    identityId: string,
    organizationId: string,
    unitId: string,
    invoice: typeof managementSupplierInvoices.$inferSelect,
    reconciliation: ReturnType<typeof calculatePurchaseReconciliation> & {
      lines: ReturnType<typeof purchaseLineReconciliation>["lines"];
    },
    acceptDivergence: boolean,
  ) {
    if (!reconciliation.matched && !acceptDivergence)
      throw new ConflictException({
        code: "PURCHASE_INVOICE_DIVERGENT",
        message: "A fatura possui divergências acima da tolerância.",
      });
    const [existingPayable] = await tx
      .select({ id: managementAccountsPayable.id })
      .from(managementAccountsPayable)
      .where(
        and(
          eq(managementAccountsPayable.organizationId, organizationId),
          eq(managementAccountsPayable.unitId, unitId),
          eq(managementAccountsPayable.supplierInvoiceId, invoice.id),
        ),
      )
      .limit(1);
    if (existingPayable) return { payableId: existingPayable.id, status: "confirmed" as const };
    const receiptIds = await tx
      .select({ id: managementPurchaseReceipts.id })
      .from(managementPurchaseReceipts)
      .where(
        and(
          eq(managementPurchaseReceipts.organizationId, organizationId),
          eq(managementPurchaseReceipts.unitId, unitId),
          eq(managementPurchaseReceipts.purchaseOrderId, invoice.purchaseOrderId),
        ),
      );
    if (receiptIds.length) {
      const [legacyPayable] = await tx
        .select({ id: managementAccountsPayable.id })
        .from(managementAccountsPayable)
        .where(
          and(
            eq(managementAccountsPayable.organizationId, organizationId),
            eq(managementAccountsPayable.unitId, unitId),
            inArray(
              managementAccountsPayable.purchaseReceiptId,
              receiptIds.map((row) => row.id),
            ),
          ),
        )
        .limit(1);
      if (legacyPayable)
        throw new ConflictException({
          code: "LEGACY_RECEIPT_PAYABLE_EXISTS",
          message:
            "Este pedido já possui conta a pagar do fluxo anterior; concilie-a antes de confirmar a fatura.",
        });
    }
    const payableId = randomUUID();
    await tx.insert(managementAccountsPayable).values({
      id: payableId,
      organizationId,
      unitId,
      supplierId: invoice.supplierId,
      supplierInvoiceId: invoice.id,
      description: `Fatura ${invoice.documentNumber}`,
      amountCents: invoice.totalCents,
      competenceDate: invoice.competenceDate,
      dueDate: invoice.dueDate,
      idempotencyKey: `invoice:${invoice.id}`,
    });
    const [confirmed] = await tx
      .update(managementSupplierInvoices)
      .set({
        status: "confirmed",
        reconciliation,
        reconciledAt: new Date(),
        confirmedAt: new Date(),
        confirmedByIdentityId: identityId,
        version: invoice.version + 1,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(managementSupplierInvoices.organizationId, organizationId),
          eq(managementSupplierInvoices.unitId, unitId),
          eq(managementSupplierInvoices.id, invoice.id),
          eq(managementSupplierInvoices.version, invoice.version),
        ),
      )
      .returning({ version: managementSupplierInvoices.version });
    if (!confirmed)
      throw new ConflictException({
        code: "SUPPLIER_INVOICE_VERSION_CONFLICT",
        message: "A fatura foi alterada por outra operação.",
      });
    return { payableId, status: "confirmed" as const, version: confirmed.version };
  }

  async createSupplierInvoice(
    identityId: string,
    organizationId: string,
    unitId: string,
    purchaseOrderId: string,
    idempotencyKey: string,
    input: SupplierInvoiceInput,
  ) {
    await this.requireRole(identityId, organizationId, unitId, [...INVENTORY_ROLES, "finance"]);
    if (input.confirmIfMatched)
      await this.requireRole(identityId, organizationId, unitId, FINANCE_ROLES);
    let parsedNfe: ReturnType<typeof parseNfe> | null = null;
    if (input.xmlContent) {
      if (Buffer.byteLength(input.xmlContent, "utf8") > 2_097_152)
        throw new BadRequestException({
          code: "SUPPLIER_INVOICE_XML_TOO_LARGE",
          message: "O XML da NF-e excede 2 MB.",
        });
      try {
        parsedNfe = parseNfe(input.xmlContent);
      } catch (error) {
        if (error instanceof NfeParseError)
          throw new BadRequestException({ code: error.code, message: error.message });
        throw error;
      }
      const inconsistent =
        parsedNfe.accessKey !== input.accessKey ||
        parsedNfe.documentNumber.replace(/\D/g, "") !== input.documentNumber.replace(/\D/g, "") ||
        parsedNfe.issuedAt !== input.issuedAt ||
        parsedNfe.totalCents !== input.totalCents ||
        parsedNfe.series !== input.series ||
        parsedNfe.model !== input.model ||
        parsedNfe.taxTotalCents !== input.taxTotalCents;
      if (inconsistent)
        throw new BadRequestException({
          code: "SUPPLIER_INVOICE_NFE_MISMATCH",
          message: "Chave, número, emissão, série, modelo, totais ou impostos divergem do XML.",
        });
    }
    return this.idempotent(
      identityId,
      organizationId,
      unitId,
      idempotencyKey,
      "purchase-invoice-create",
      { purchaseOrderId, ...input },
      async (tx) => {
        await tx.execute(
          sql`select id from management_purchase_orders where organization_id=${organizationId}::uuid and unit_id=${unitId}::uuid and id=${purchaseOrderId}::uuid for update`,
        );
        const [order] = await tx
          .select()
          .from(managementPurchaseOrders)
          .where(
            and(
              eq(managementPurchaseOrders.organizationId, organizationId),
              eq(managementPurchaseOrders.unitId, unitId),
              eq(managementPurchaseOrders.id, purchaseOrderId),
            ),
          )
          .limit(1);
        if (!order)
          throw new NotFoundException({
            code: "PURCHASE_ORDER_NOT_FOUND",
            message: "Pedido de compra não encontrado.",
          });
        if (order.status !== "partially_received" && order.status !== "received")
          throw new ConflictException({
            code: "PURCHASE_ORDER_NOT_INVOICEABLE",
            message: "O pedido ainda não pode receber fatura.",
          });
        if (parsedNfe) {
          const [[supplier], [unit]] = await Promise.all([
            tx
              .select({ normalizedDocument: managementSuppliers.normalizedDocument })
              .from(managementSuppliers)
              .where(
                and(
                  eq(managementSuppliers.organizationId, organizationId),
                  eq(managementSuppliers.unitId, unitId),
                  eq(managementSuppliers.id, order.supplierId),
                ),
              )
              .limit(1),
            tx
              .select({
                legalEntityId: units.legalEntityId,
                legalDocument: legalEntities.document,
                organizationDocument: organizations.document,
              })
              .from(units)
              .innerJoin(organizations, eq(units.organizationId, organizations.id))
              .leftJoin(legalEntities, eq(units.legalEntityId, legalEntities.id))
              .where(and(eq(units.organizationId, organizationId), eq(units.id, unitId)))
              .limit(1),
          ]);
          const recipientDocument = unit?.legalEntityId
            ? unit.legalDocument
            : unit?.organizationDocument;
          if (
            !recipientDocument ||
            recipientDocument.replace(/\D/g, "") !== parsedNfe.recipientDocument
          )
            throw new ConflictException({
              code: "NFE_RECIPIENT_MISMATCH",
              message: "O destinatário da NF-e não corresponde à entidade legal desta unidade.",
            });
          if (!supplier?.normalizedDocument)
            throw new ConflictException({
              code: "SUPPLIER_DOCUMENT_REQUIRED_FOR_NFE",
              message: "Cadastre o CNPJ/CPF do fornecedor antes de vincular uma NF-e.",
            });
          if (supplier.normalizedDocument.replace(/\D/g, "") !== parsedNfe.issuerDocument)
            throw new ConflictException({
              code: "SUPPLIER_INVOICE_NFE_ISSUER_MISMATCH",
              message: "O emitente da NF-e não corresponde ao fornecedor do pedido.",
            });
        }
        const normalizedDocumentNumber = normalizeBusinessDocument(input.documentNumber);
        const invoiceLockKey = parsedNfe
          ? `management-invoice-nfe:${parsedNfe.accessKey}`
          : `management-invoice:${organizationId}:${unitId}:${order.supplierId}:${normalizedDocumentNumber}`;
        await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${invoiceLockKey}))`);
        const [duplicate] = await tx
          .select({ id: managementSupplierInvoices.id })
          .from(managementSupplierInvoices)
          .where(
            or(
              parsedNfe ? eq(managementSupplierInvoices.accessKey, parsedNfe.accessKey) : undefined,
              and(
                eq(managementSupplierInvoices.organizationId, organizationId),
                eq(managementSupplierInvoices.unitId, unitId),
                or(
                  eq(managementSupplierInvoices.purchaseOrderId, purchaseOrderId),
                  and(
                    eq(managementSupplierInvoices.supplierId, order.supplierId),
                    eq(
                      managementSupplierInvoices.normalizedDocumentNumber,
                      normalizedDocumentNumber,
                    ),
                  ),
                ),
              ),
            ),
          )
          .limit(1);
        if (duplicate)
          throw new ConflictException({
            code: "SUPPLIER_INVOICE_ALREADY_EXISTS",
            message: "Este pedido já possui uma fatura cadastrada.",
          });
        if (
          new Set(input.lines.map((line) => line.purchaseOrderItemId)).size !== input.lines.length
        )
          throw new BadRequestException({
            code: "DUPLICATE_INVOICE_LINE",
            message: "Cada item do pedido deve aparecer uma vez na fatura.",
          });
        const orderItems = await tx
          .select()
          .from(managementPurchaseOrderItems)
          .where(
            and(
              eq(managementPurchaseOrderItems.organizationId, organizationId),
              eq(managementPurchaseOrderItems.unitId, unitId),
              eq(managementPurchaseOrderItems.purchaseOrderId, purchaseOrderId),
            ),
          );
        const byId = new Map(orderItems.map((item) => [item.id, item]));
        const invoiceId = randomUUID();
        await tx.insert(managementSupplierInvoices).values({
          id: invoiceId,
          organizationId,
          unitId,
          purchaseOrderId,
          supplierId: order.supplierId,
          documentNumber: input.documentNumber,
          normalizedDocumentNumber,
          accessKey: parsedNfe?.accessKey,
          xmlContent: parsedNfe?.xml,
          series: parsedNfe?.series,
          model: parsedNfe?.model,
          taxTotalCents: parsedNfe?.taxTotalCents,
          totalCents: input.totalCents,
          competenceDate: input.competenceDate,
          dueDate: input.dueDate,
          issuedAt: input.issuedAt,
          toleranceCents: input.toleranceCents,
          idempotencyKey,
        });
        await tx.insert(managementSupplierInvoiceLines).values(
          input.lines.map((line) => {
            const item = byId.get(line.purchaseOrderItemId);
            if (!item)
              throw new NotFoundException({
                code: "PURCHASE_ORDER_ITEM_NOT_FOUND",
                message: "Item não pertence ao pedido desta unidade.",
              });
            return {
              organizationId,
              unitId,
              invoiceId,
              purchaseOrderItemId: item.id,
              inventoryItemId: item.inventoryItemId,
              quantity: String(line.quantity),
              unitCostCents: line.unitCostCents,
              totalCents: purchaseStockConversion(
                line.quantity,
                item.purchaseToStockFactor,
                line.unitCostCents,
              ).totalCents,
            };
          }),
        );
        const [invoice] = await tx
          .select()
          .from(managementSupplierInvoices)
          .where(eq(managementSupplierInvoices.id, invoiceId))
          .limit(1);
        if (!invoice)
          throw new ConflictException({
            code: "SUPPLIER_INVOICE_CREATE_FAILED",
            message: "Não foi possível criar a fatura.",
          });
        const reconciliation = await this.invoiceReconciliation(
          tx,
          organizationId,
          unitId,
          invoice,
          input.toleranceCents,
        );
        await tx
          .update(managementSupplierInvoices)
          .set({
            status: reconciliation.status,
            reconciliation,
            reconciledAt: new Date(),
            updatedAt: new Date(),
          })
          .where(eq(managementSupplierInvoices.id, invoiceId));
        const confirmation =
          input.confirmIfMatched && reconciliation.matched
            ? await this.confirmInvoiceTx(
                tx,
                identityId,
                organizationId,
                unitId,
                invoice,
                reconciliation,
                false,
              )
            : { payableId: null, status: reconciliation.status };
        await this.record(
          tx,
          identityId,
          organizationId,
          unitId,
          "management.purchase-invoice.created",
          "supplier_invoice",
          invoiceId,
          { purchaseOrderId, reconciliation, payableId: confirmation.payableId },
        );
        return { invoiceId, purchaseOrderId, reconciliation, ...confirmation };
      },
    );
  }

  async reconcileSupplierInvoice(
    identityId: string,
    organizationId: string,
    unitId: string,
    invoiceId: string,
    idempotencyKey: string,
    input: PurchaseReconciliationInput,
  ) {
    await this.requireRole(identityId, organizationId, unitId, [...INVENTORY_ROLES, "finance"]);
    return this.idempotent(
      identityId,
      organizationId,
      unitId,
      idempotencyKey,
      "purchase-invoice-reconcile",
      { invoiceId, ...input },
      async (tx) => {
        const [invoice] = await tx
          .select()
          .from(managementSupplierInvoices)
          .where(
            and(
              eq(managementSupplierInvoices.organizationId, organizationId),
              eq(managementSupplierInvoices.unitId, unitId),
              eq(managementSupplierInvoices.id, invoiceId),
            ),
          )
          .limit(1);
        if (!invoice)
          throw new NotFoundException({
            code: "SUPPLIER_INVOICE_NOT_FOUND",
            message: "Fatura não encontrada.",
          });
        if (invoice.version !== input.version)
          throw new ConflictException({
            code: "SUPPLIER_INVOICE_VERSION_CONFLICT",
            message: "A fatura foi alterada por outra operação.",
          });
        if (invoice.status === "confirmed")
          throw new ConflictException({
            code: "SUPPLIER_INVOICE_ALREADY_CONFIRMED",
            message: "A fatura já foi confirmada.",
          });
        if (invoice.status === "reversed" || invoice.status === "canceled")
          throw new ConflictException({
            code: "SUPPLIER_INVOICE_NOT_RECONCILABLE",
            message: "A fatura cancelada não pode ser conciliada.",
          });
        const reconciliation = await this.invoiceReconciliation(
          tx,
          organizationId,
          unitId,
          invoice,
          input.toleranceCents,
        );
        const [updated] = await tx
          .update(managementSupplierInvoices)
          .set({
            status: reconciliation.status,
            toleranceCents: input.toleranceCents,
            reconciliation,
            reconciledAt: new Date(),
            version: input.version + 1,
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(managementSupplierInvoices.organizationId, organizationId),
              eq(managementSupplierInvoices.unitId, unitId),
              eq(managementSupplierInvoices.id, invoiceId),
              eq(managementSupplierInvoices.version, input.version),
            ),
          )
          .returning({ version: managementSupplierInvoices.version });
        if (!updated)
          throw new ConflictException({
            code: "SUPPLIER_INVOICE_VERSION_CONFLICT",
            message: "A fatura foi alterada por outra operação.",
          });
        await this.record(
          tx,
          identityId,
          organizationId,
          unitId,
          "management.purchase-invoice.reconciled",
          "supplier_invoice",
          invoiceId,
          reconciliation,
        );
        return { invoiceId, reconciliation, payableId: null, version: updated.version };
      },
    );
  }

  async confirmSupplierInvoice(
    identityId: string,
    organizationId: string,
    unitId: string,
    invoiceId: string,
    idempotencyKey: string,
    input: PurchaseInvoiceConfirmInput,
  ) {
    await this.requireRole(identityId, organizationId, unitId, FINANCE_ROLES);
    return this.idempotent(
      identityId,
      organizationId,
      unitId,
      idempotencyKey,
      "purchase-invoice-confirm",
      { invoiceId, ...input },
      async (tx) => {
        await tx.execute(
          sql`select id from management_supplier_invoices where organization_id=${organizationId}::uuid and unit_id=${unitId}::uuid and id=${invoiceId}::uuid for update`,
        );
        const [invoice] = await tx
          .select()
          .from(managementSupplierInvoices)
          .where(
            and(
              eq(managementSupplierInvoices.organizationId, organizationId),
              eq(managementSupplierInvoices.unitId, unitId),
              eq(managementSupplierInvoices.id, invoiceId),
            ),
          )
          .limit(1);
        if (!invoice)
          throw new NotFoundException({
            code: "SUPPLIER_INVOICE_NOT_FOUND",
            message: "Fatura não encontrada.",
          });
        if (invoice.version !== input.version)
          throw new ConflictException({
            code: "SUPPLIER_INVOICE_VERSION_CONFLICT",
            message: "A fatura foi alterada por outra operação.",
          });
        if (invoice.status === "confirmed")
          throw new ConflictException({
            code: "SUPPLIER_INVOICE_ALREADY_CONFIRMED",
            message: "A fatura já foi confirmada.",
          });
        if (invoice.status === "reversed" || invoice.status === "canceled")
          throw new ConflictException({
            code: "SUPPLIER_INVOICE_NOT_CONFIRMABLE",
            message: "A fatura cancelada não pode ser confirmada.",
          });
        const reconciliation = await this.invoiceReconciliation(
          tx,
          organizationId,
          unitId,
          invoice,
          input.toleranceCents ?? invoice.toleranceCents,
        );
        const confirmation = await this.confirmInvoiceTx(
          tx,
          identityId,
          organizationId,
          unitId,
          invoice,
          reconciliation,
          input.acceptDivergence,
        );
        await this.record(
          tx,
          identityId,
          organizationId,
          unitId,
          "management.purchase-invoice.confirmed",
          "supplier_invoice",
          invoiceId,
          {
            ...reconciliation,
            payableId: confirmation.payableId,
            acceptedDivergence: input.acceptDivergence,
            reason: input.reason,
          },
        );
        return { invoiceId, reconciliation, ...confirmation };
      },
    );
  }

  async cancelSupplierInvoice(
    identityId: string,
    organizationId: string,
    unitId: string,
    invoiceId: string,
    idempotencyKey: string,
    input: PurchaseReversalInput,
  ) {
    await this.requireRole(identityId, organizationId, unitId, FINANCE_ROLES);
    return this.idempotent(
      identityId,
      organizationId,
      unitId,
      idempotencyKey,
      "purchase-invoice-cancel",
      { invoiceId, ...input },
      async (tx) => {
        await tx.execute(
          sql`select id from management_supplier_invoices where organization_id=${organizationId}::uuid and unit_id=${unitId}::uuid and id=${invoiceId}::uuid for update`,
        );
        const [invoice] = await tx
          .select()
          .from(managementSupplierInvoices)
          .where(
            and(
              eq(managementSupplierInvoices.organizationId, organizationId),
              eq(managementSupplierInvoices.unitId, unitId),
              eq(managementSupplierInvoices.id, invoiceId),
            ),
          )
          .limit(1);
        if (!invoice)
          throw new NotFoundException({
            code: "SUPPLIER_INVOICE_NOT_FOUND",
            message: "Fatura não encontrada.",
          });
        if (invoice.version !== input.version)
          throw new ConflictException({
            code: "SUPPLIER_INVOICE_VERSION_CONFLICT",
            message: "A fatura foi alterada por outra operação.",
          });
        if (invoice.status === "reversed" || invoice.status === "canceled")
          throw new ConflictException({
            code: "SUPPLIER_INVOICE_ALREADY_REVERSED",
            message: "A fatura já foi cancelada.",
          });
        await tx.execute(
          sql`select id from management_accounts_payable where organization_id=${organizationId}::uuid and unit_id=${unitId}::uuid and supplier_invoice_id=${invoiceId}::uuid for update`,
        );
        const [payable] = await tx
          .select()
          .from(managementAccountsPayable)
          .where(
            and(
              eq(managementAccountsPayable.organizationId, organizationId),
              eq(managementAccountsPayable.unitId, unitId),
              eq(managementAccountsPayable.supplierInvoiceId, invoiceId),
            ),
          )
          .limit(1);
        if (payable && (payable.paidCents > 0 || payable.status === "paid"))
          throw new ConflictException({
            code: "SUPPLIER_INVOICE_PAYABLE_PAID",
            message: "A fatura possui pagamento e não pode ser cancelada.",
          });
        if (payable)
          await tx
            .update(managementAccountsPayable)
            .set({
              status: "canceled",
              version: payable.version + 1,
              updatedAt: new Date(),
            })
            .where(
              and(
                eq(managementAccountsPayable.organizationId, organizationId),
                eq(managementAccountsPayable.unitId, unitId),
                eq(managementAccountsPayable.id, payable.id),
                eq(managementAccountsPayable.version, payable.version),
              ),
            );
        const [reversed] = await tx
          .update(managementSupplierInvoices)
          .set({
            status: "reversed",
            reversalReason: input.reason,
            reversedAt: new Date(),
            reversedByIdentityId: identityId,
            version: input.version + 1,
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(managementSupplierInvoices.organizationId, organizationId),
              eq(managementSupplierInvoices.unitId, unitId),
              eq(managementSupplierInvoices.id, invoiceId),
              eq(managementSupplierInvoices.version, input.version),
            ),
          )
          .returning({ version: managementSupplierInvoices.version });
        if (!reversed)
          throw new ConflictException({
            code: "SUPPLIER_INVOICE_VERSION_CONFLICT",
            message: "A fatura foi alterada por outra operação.",
          });
        await this.record(
          tx,
          identityId,
          organizationId,
          unitId,
          "management.purchase-invoice.reversed",
          "supplier_invoice",
          invoiceId,
          {
            purchaseOrderId: invoice.purchaseOrderId,
            payableId: payable?.id ?? null,
            reason: input.reason,
          },
        );
        return {
          invoiceId,
          status: "reversed",
          version: reversed.version,
          payableId: payable?.id ?? null,
          payableStatus: payable ? "canceled" : null,
        };
      },
    );
  }

  async listPurchases(
    identityId: string,
    organizationId: string,
    unitId: string,
    query: PurchaseListQuery = { page: 1, pageSize: 25 },
  ) {
    await this.requireRole(identityId, organizationId, unitId, [...INVENTORY_ROLES, "finance"]);
    const roleRows = await this.scope.requireOrganizationRole(identityId, organizationId, [
      "owner",
      "manager",
      "inventory",
      "finance",
    ]);
    const roles = new Set(
      roleRows.filter((row) => row.unitId === null || row.unitId === unitId).map((row) => row.role),
    );
    const managesPurchases = roles.has("owner") || roles.has("manager");
    const search = query.search ? `%${query.search}%` : undefined;
    const filter = and(
      eq(managementPurchaseOrders.organizationId, organizationId),
      eq(managementPurchaseOrders.unitId, unitId),
      query.status ? eq(managementPurchaseOrders.status, query.status) : undefined,
      query.supplierId ? eq(managementPurchaseOrders.supplierId, query.supplierId) : undefined,
      query.from
        ? gte(managementPurchaseOrders.createdAt, new Date(`${query.from}T00:00:00Z`))
        : undefined,
      query.to
        ? lte(managementPurchaseOrders.createdAt, new Date(`${query.to}T23:59:59.999Z`))
        : undefined,
      search
        ? or(
            ilike(managementSuppliers.name, search),
            sql`cast(${managementPurchaseOrders.humanNumber} as text) ilike ${search}`,
            sql`exists (
              select 1
              from management_purchase_order_items purchase_item
              join management_inventory_items inventory_item
                on inventory_item.organization_id = purchase_item.organization_id
               and inventory_item.unit_id = purchase_item.unit_id
               and inventory_item.id = purchase_item.inventory_item_id
              where purchase_item.organization_id = ${organizationId}::uuid
                and purchase_item.unit_id = ${unitId}::uuid
                and purchase_item.purchase_order_id = ${managementPurchaseOrders.id}
                and inventory_item.name ilike ${search}
            )`,
          )
        : undefined,
    );
    const offset = (query.page - 1) * query.pageSize;
    const [
      pageRows,
      orderMetrics,
      receivedMetrics,
      invoiceMetrics,
      suppliers,
      inventoryItems,
      consumptionRows,
      outstandingRows,
    ] = await Promise.all([
      this.database.db
        .select({
          ...getTableColumns(managementPurchaseOrders),
          supplierName: managementSuppliers.name,
        })
        .from(managementPurchaseOrders)
        .innerJoin(
          managementSuppliers,
          and(
            eq(managementSuppliers.organizationId, managementPurchaseOrders.organizationId),
            eq(managementSuppliers.unitId, managementPurchaseOrders.unitId),
            eq(managementSuppliers.id, managementPurchaseOrders.supplierId),
          ),
        )
        .where(filter)
        .orderBy(desc(managementPurchaseOrders.createdAt), desc(managementPurchaseOrders.id))
        .limit(query.pageSize)
        .offset(offset),
      this.database.db
        .select({
          orderCount: sql<number>`count(*)::int`,
          orderedCents: sql<number>`coalesce(sum(${managementPurchaseOrders.totalCents}), 0)::bigint`,
          pendingCount: sql<number>`count(*) filter (where ${managementPurchaseOrders.status} in ('draft', 'rejected', 'approved', 'partially_received'))::int`,
        })
        .from(managementPurchaseOrders)
        .innerJoin(
          managementSuppliers,
          and(
            eq(managementSuppliers.organizationId, managementPurchaseOrders.organizationId),
            eq(managementSuppliers.unitId, managementPurchaseOrders.unitId),
            eq(managementSuppliers.id, managementPurchaseOrders.supplierId),
          ),
        )
        .where(filter),
      this.database.db
        .select({
          receivedCents: sql<number>`coalesce(sum(${managementPurchaseReceipts.totalCents}), 0)::bigint`,
        })
        .from(managementPurchaseReceipts)
        .innerJoin(
          managementPurchaseOrders,
          and(
            eq(managementPurchaseOrders.organizationId, managementPurchaseReceipts.organizationId),
            eq(managementPurchaseOrders.unitId, managementPurchaseReceipts.unitId),
            eq(managementPurchaseOrders.id, managementPurchaseReceipts.purchaseOrderId),
          ),
        )
        .innerJoin(
          managementSuppliers,
          and(
            eq(managementSuppliers.organizationId, managementPurchaseOrders.organizationId),
            eq(managementSuppliers.unitId, managementPurchaseOrders.unitId),
            eq(managementSuppliers.id, managementPurchaseOrders.supplierId),
          ),
        )
        .where(and(filter, eq(managementPurchaseReceipts.status, "posted"))),
      this.database.db
        .select({ divergentInvoiceCount: sql<number>`count(*)::int` })
        .from(managementSupplierInvoices)
        .innerJoin(
          managementPurchaseOrders,
          and(
            eq(managementPurchaseOrders.organizationId, managementSupplierInvoices.organizationId),
            eq(managementPurchaseOrders.unitId, managementSupplierInvoices.unitId),
            eq(managementPurchaseOrders.id, managementSupplierInvoices.purchaseOrderId),
          ),
        )
        .innerJoin(
          managementSuppliers,
          and(
            eq(managementSuppliers.organizationId, managementPurchaseOrders.organizationId),
            eq(managementSuppliers.unitId, managementPurchaseOrders.unitId),
            eq(managementSuppliers.id, managementPurchaseOrders.supplierId),
          ),
        )
        .where(and(filter, eq(managementSupplierInvoices.status, "divergent"))),
      this.database.db
        .select()
        .from(managementSuppliers)
        .where(
          and(
            eq(managementSuppliers.organizationId, organizationId),
            eq(managementSuppliers.unitId, unitId),
          ),
        ),
      this.database.db
        .select({
          ...getTableColumns(managementInventoryItems),
          currentQuantity: sql<string>`coalesce(sum(${managementStockBalances.quantity}), 0)`,
        })
        .from(managementInventoryItems)
        .leftJoin(
          managementStockBalances,
          and(
            eq(managementStockBalances.organizationId, managementInventoryItems.organizationId),
            eq(managementStockBalances.unitId, managementInventoryItems.unitId),
            eq(managementStockBalances.inventoryItemId, managementInventoryItems.id),
          ),
        )
        .where(
          and(
            eq(managementInventoryItems.organizationId, organizationId),
            eq(managementInventoryItems.unitId, unitId),
          ),
        )
        .groupBy(managementInventoryItems.id),
      this.database.db
        .select({
          inventoryItemId: managementInventoryMovements.inventoryItemId,
          consumedQuantity: sql<string>`coalesce(sum(abs(${managementInventoryMovements.quantityDelta})), 0)`,
        })
        .from(managementInventoryMovements)
        .where(
          and(
            eq(managementInventoryMovements.organizationId, organizationId),
            eq(managementInventoryMovements.unitId, unitId),
            eq(managementInventoryMovements.type, "order_consumption"),
            gte(managementInventoryMovements.occurredAt, new Date(Date.now() - 30 * 86_400_000)),
          ),
        )
        .groupBy(managementInventoryMovements.inventoryItemId),
      this.database.db
        .select({
          inventoryItemId: managementPurchaseOrderItems.inventoryItemId,
          outstandingStockQuantity: sql<string>`coalesce(sum((${managementPurchaseOrderItems.quantity} - ${managementPurchaseOrderItems.receivedQuantity}) * ${managementPurchaseOrderItems.purchaseToStockFactor}), 0)`,
        })
        .from(managementPurchaseOrderItems)
        .innerJoin(
          managementPurchaseOrders,
          and(
            eq(
              managementPurchaseOrders.organizationId,
              managementPurchaseOrderItems.organizationId,
            ),
            eq(managementPurchaseOrders.unitId, managementPurchaseOrderItems.unitId),
            eq(managementPurchaseOrders.id, managementPurchaseOrderItems.purchaseOrderId),
          ),
        )
        .where(
          and(
            eq(managementPurchaseOrderItems.organizationId, organizationId),
            eq(managementPurchaseOrderItems.unitId, unitId),
            inArray(managementPurchaseOrders.status, ["approved", "partially_received"]),
          ),
        )
        .groupBy(managementPurchaseOrderItems.inventoryItemId),
    ]);
    const supplierById = new Map(suppliers.map((supplier) => [supplier.id, supplier]));
    const pageOrders = pageRows.map((order) => ({
      ...order,
      code: `PUR-${String(order.humanNumber).padStart(6, "0")}`,
    }));
    const orderIds = pageOrders.map((order) => order.id);
    const [pageItems, pageReceipts, pageInvoices] = orderIds.length
      ? await Promise.all([
          this.database.db
            .select({
              ...getTableColumns(managementPurchaseOrderItems),
              itemName: managementInventoryItems.name,
            })
            .from(managementPurchaseOrderItems)
            .innerJoin(
              managementInventoryItems,
              and(
                eq(
                  managementInventoryItems.organizationId,
                  managementPurchaseOrderItems.organizationId,
                ),
                eq(managementInventoryItems.unitId, managementPurchaseOrderItems.unitId),
                eq(managementInventoryItems.id, managementPurchaseOrderItems.inventoryItemId),
              ),
            )
            .where(
              and(
                eq(managementPurchaseOrderItems.organizationId, organizationId),
                eq(managementPurchaseOrderItems.unitId, unitId),
                inArray(managementPurchaseOrderItems.purchaseOrderId, orderIds),
              ),
            ),
          this.database.db
            .select()
            .from(managementPurchaseReceipts)
            .where(
              and(
                eq(managementPurchaseReceipts.organizationId, organizationId),
                eq(managementPurchaseReceipts.unitId, unitId),
                inArray(managementPurchaseReceipts.purchaseOrderId, orderIds),
              ),
            )
            .orderBy(desc(managementPurchaseReceipts.receivedAt)),
          this.database.db
            .select()
            .from(managementSupplierInvoices)
            .where(
              and(
                eq(managementSupplierInvoices.organizationId, organizationId),
                eq(managementSupplierInvoices.unitId, unitId),
                inArray(managementSupplierInvoices.purchaseOrderId, orderIds),
              ),
            )
            .orderBy(desc(managementSupplierInvoices.createdAt)),
        ])
      : [[], [], []];
    const receiptIds = pageReceipts.map((receipt) => receipt.id);
    const invoiceIds = pageInvoices.map((invoice) => invoice.id);
    const [receiptLines, invoiceLines] = await Promise.all([
      receiptIds.length
        ? this.database.db
            .select()
            .from(managementPurchaseReceiptLines)
            .where(
              and(
                eq(managementPurchaseReceiptLines.organizationId, organizationId),
                eq(managementPurchaseReceiptLines.unitId, unitId),
                inArray(managementPurchaseReceiptLines.receiptId, receiptIds),
              ),
            )
        : Promise.resolve([]),
      invoiceIds.length
        ? this.database.db
            .select()
            .from(managementSupplierInvoiceLines)
            .where(
              and(
                eq(managementSupplierInvoiceLines.organizationId, organizationId),
                eq(managementSupplierInvoiceLines.unitId, unitId),
                inArray(managementSupplierInvoiceLines.invoiceId, invoiceIds),
              ),
            )
        : Promise.resolve([]),
    ]);
    const consumptionByItem = new Map(
      consumptionRows.map((row) => [row.inventoryItemId, Number(row.consumedQuantity)]),
    );
    const outstandingByItem = new Map(
      outstandingRows.map((row) => [row.inventoryItemId, Number(row.outstandingStockQuantity)]),
    );
    const suggestions = inventoryItems.flatMap((item) => {
      if (!item.active) return [];
      const calculation = replenishmentSuggestion({
        currentQuantity: Number(item.currentQuantity),
        minimumQuantity: Number(item.minimumQuantity),
        reorderQuantity: Number(item.reorderQuantity),
        purchaseToStockFactor: Number(item.purchaseToStockFactor),
        leadTimeDays: item.leadTimeDays,
        consumedLast30Days: consumptionByItem.get(item.id) ?? 0,
        outstandingStockQuantity: outstandingByItem.get(item.id) ?? 0,
      });
      if (calculation.purchaseQuantity <= 0) return [];
      return [
        {
          inventoryItemId: item.id,
          itemName: item.name,
          supplierId: item.preferredSupplierId,
          supplierName: item.preferredSupplierId
            ? (supplierById.get(item.preferredSupplierId)?.name ?? null)
            : null,
          currentQuantity: milliToQuantity(quantityToMilli(item.currentQuantity)),
          minimumQuantity: item.minimumQuantity,
          suggestedQuantity: calculation.purchaseQuantity.toFixed(3),
          purchaseUnit: item.purchaseUnit ?? item.unit,
          stockUnit: item.unit,
          purchaseToStockFactor: item.purchaseToStockFactor,
          leadTimeDays: item.leadTimeDays,
          dailyConsumption: calculation.dailyConsumption,
          coverageDays: calculation.coverageDays,
          outstandingStockQuantity: outstandingByItem.get(item.id) ?? 0,
          reason:
            calculation.coverageDays !== null && calculation.coverageDays <= item.leadTimeDays
              ? `Cobertura de ${Math.round(calculation.coverageDays)} dia(s), abaixo do prazo do fornecedor`
              : "Saldo projetado abaixo do mínimo",
        },
      ];
    });
    return {
      orders: pageOrders,
      items: pageItems,
      receipts: pageReceipts,
      receiptLines,
      invoices: pageInvoices,
      invoiceLines,
      metrics: {
        orderCount: Number(orderMetrics[0]?.orderCount ?? 0),
        orderedCents: Number(orderMetrics[0]?.orderedCents ?? 0),
        receivedCents: Number(receivedMetrics[0]?.receivedCents ?? 0),
        pendingCount: Number(orderMetrics[0]?.pendingCount ?? 0),
        divergentInvoiceCount: Number(invoiceMetrics[0]?.divergentInvoiceCount ?? 0),
      },
      suggestions,
      capabilities: {
        canCreate: managesPurchases || roles.has("inventory"),
        canEditDraft: managesPurchases || roles.has("inventory"),
        canApprove: managesPurchases,
        canReceive: managesPurchases || roles.has("inventory"),
        canInvoice: managesPurchases || roles.has("inventory") || roles.has("finance"),
        canReconcile: managesPurchases || roles.has("inventory") || roles.has("finance"),
        canConfirmInvoice: managesPurchases || roles.has("finance"),
        canReverseReceipt: managesPurchases || roles.has("inventory"),
        canCancelInvoice: managesPurchases || roles.has("finance"),
      },
      pagination: {
        page: query.page,
        pageSize: query.pageSize,
        total: Number(orderMetrics[0]?.orderCount ?? 0),
        pageCount: Math.ceil(Number(orderMetrics[0]?.orderCount ?? 0) / query.pageSize),
      },
    };
  }

  async createPayable(
    identityId: string,
    organizationId: string,
    unitId: string,
    idempotencyKey: string,
    input: PayableInput,
  ) {
    await this.requireRole(identityId, organizationId, unitId, FINANCE_ROLES);
    return this.idempotent(
      identityId,
      organizationId,
      unitId,
      idempotencyKey,
      "payable-create",
      input,
      async (tx) => {
        if (input.supplierId) {
          const [supplier] = await tx
            .select({ id: managementSuppliers.id })
            .from(managementSuppliers)
            .where(
              and(
                eq(managementSuppliers.organizationId, organizationId),
                eq(managementSuppliers.unitId, unitId),
                eq(managementSuppliers.id, input.supplierId),
              ),
            )
            .limit(1);
          if (!supplier)
            throw new NotFoundException({
              code: "SUPPLIER_NOT_FOUND",
              message: "Fornecedor não encontrado nesta unidade.",
            });
        }
        const id = randomUUID();
        await tx
          .insert(managementAccountsPayable)
          .values({ id, organizationId, unitId, ...input, idempotencyKey });
        await this.record(
          tx,
          identityId,
          organizationId,
          unitId,
          "management.payable.created",
          "payable",
          id,
          { amountCents: input.amountCents },
        );
        return { payableId: id, status: "open", amountCents: input.amountCents };
      },
    );
  }

  async payPayable(
    identityId: string,
    organizationId: string,
    unitId: string,
    payableId: string,
    idempotencyKey: string,
    input: FinancialPaymentInput,
  ) {
    await this.requireRole(identityId, organizationId, unitId, FINANCE_ROLES);
    if (input.method === "cash")
      await this.requireRole(identityId, organizationId, unitId, CASH_OPERATE_ROLES);
    return this.idempotent(
      identityId,
      organizationId,
      unitId,
      idempotencyKey,
      "payable-payment",
      { payableId, ...input },
      async (tx) => {
        await tx.execute(
          sql`select id from management_accounts_payable where organization_id=${organizationId}::uuid and unit_id=${unitId}::uuid and id=${payableId}::uuid for update`,
        );
        const [payable] = await tx
          .select()
          .from(managementAccountsPayable)
          .where(
            and(
              eq(managementAccountsPayable.organizationId, organizationId),
              eq(managementAccountsPayable.unitId, unitId),
              eq(managementAccountsPayable.id, payableId),
            ),
          )
          .limit(1);
        if (!payable)
          throw new NotFoundException({
            code: "PAYABLE_NOT_FOUND",
            message: "Conta a pagar não encontrada.",
          });
        if (payable.status === "canceled" || payable.status === "paid")
          throw new ConflictException({
            code: "PAYABLE_NOT_OPEN",
            message: "A conta não aceita pagamentos.",
          });
        const cashShift = await this.lockOpenCashShift(tx, organizationId, unitId, {
          cashRegisterId: input.cashRegisterId,
        });
        if (input.method === "cash" && !cashShift)
          throw new BadRequestException({
            code: "CASH_SHIFT_REQUIRED",
            message: "Pagamentos em dinheiro exigem um caixa aberto.",
          });
        if (cashShift && input.method === "cash") {
          const drawer = await this.cashDrawerTotals(tx, organizationId, unitId, cashShift.id);
          assertCashDrawerDebit(
            cashShift.openingCents + drawer.drawerInCents - drawer.drawerOutCents,
            input.amountCents,
          );
        }
        const next = settlement(payable.amountCents, payable.paidCents, input.amountCents);
        const paymentId = randomUUID();
        const occurredAt = input.occurredAt ? new Date(input.occurredAt) : new Date();
        await tx.insert(managementPayablePayments).values({
          id: paymentId,
          organizationId,
          unitId,
          payableId,
          amountCents: input.amountCents,
          method: input.method,
          reference: input.reference,
          idempotencyKey,
          paidByIdentityId: identityId,
          paidAt: occurredAt,
        });
        if (cashShift)
          await tx.insert(managementCashEntries).values({
            organizationId,
            unitId,
            cashShiftId: cashShift.id,
            direction: "out",
            entryType: "payable_payment",
            paymentMethod: input.method,
            affectsDrawer: input.method === "cash",
            amountCents: input.amountCents,
            sourceType: "payable_payment",
            sourceId: paymentId,
            description: payable.description,
            actorIdentityId: identityId,
            occurredAt,
          });
        const status = next.status === "settled" ? "paid" : "partially_paid";
        await tx
          .update(managementAccountsPayable)
          .set({
            paidCents: next.settledCents,
            status,
            version: payable.version + 1,
            updatedAt: new Date(),
          })
          .where(eq(managementAccountsPayable.id, payable.id));
        await this.record(
          tx,
          identityId,
          organizationId,
          unitId,
          "management.payable.paid",
          "payable",
          payable.id,
          {
            paymentId,
            amountCents: input.amountCents,
            method: input.method,
            cashShiftId: cashShift?.id ?? null,
            status,
          },
        );
        return { payableId, paymentId, paidCents: next.settledCents, status };
      },
    );
  }

  async createReceivable(
    identityId: string,
    organizationId: string,
    unitId: string,
    idempotencyKey: string,
    input: ReceivableInput,
  ) {
    await this.requireRole(identityId, organizationId, unitId, FINANCE_ROLES);
    const lineTotal = input.lines.reduce((sum, line) => sum + line.revenueCents, 0);
    if (input.lines.length > 0 && lineTotal !== input.amountCents)
      throw new BadRequestException({
        code: "RECEIVABLE_LINES_TOTAL_MISMATCH",
        message: "A soma das linhas deve ser igual ao valor da conta.",
      });
    return this.idempotent(
      identityId,
      organizationId,
      unitId,
      idempotencyKey,
      "receivable-create",
      input,
      async (tx) => {
        if (input.sourceOrderId)
          await this.requireOrder(tx, organizationId, unitId, input.sourceOrderId);
        for (const line of input.lines)
          if (line.productId) await this.requireProduct(tx, organizationId, line.productId);
        const id = randomUUID();
        await tx.insert(managementAccountsReceivable).values({
          id,
          organizationId,
          unitId,
          sourceOrderId: input.sourceOrderId,
          description: input.description,
          amountCents: input.amountCents,
          competenceDate: input.competenceDate,
          dueDate: input.dueDate,
          idempotencyKey,
        });
        if (input.lines.length > 0)
          await tx.insert(managementReceivableLines).values(
            input.lines.map((line) => ({
              organizationId,
              unitId,
              receivableId: id,
              productId: line.productId,
              description: line.description,
              revenueCents: line.revenueCents,
              costCents: line.costCents ?? null,
            })),
          );
        await this.record(
          tx,
          identityId,
          organizationId,
          unitId,
          "management.receivable.created",
          "receivable",
          id,
          { amountCents: input.amountCents, sourceOrderId: input.sourceOrderId ?? null },
        );
        return { receivableId: id, status: "open", amountCents: input.amountCents };
      },
    );
  }

  async receiveReceivable(
    identityId: string,
    organizationId: string,
    unitId: string,
    receivableId: string,
    idempotencyKey: string,
    input: ReceivablePaymentInput,
  ) {
    await this.requireRole(identityId, organizationId, unitId, CASH_READ_ROLES);
    if (input.method === "cash")
      await this.requireRole(identityId, organizationId, unitId, CASH_OPERATE_ROLES);
    return this.idempotent(
      identityId,
      organizationId,
      unitId,
      idempotencyKey,
      "receivable-payment",
      { receivableId, ...input },
      async (tx) => {
        await tx.execute(
          sql`select id from management_accounts_receivable where organization_id=${organizationId}::uuid and unit_id=${unitId}::uuid and id=${receivableId}::uuid for update`,
        );
        const [receivable] = await tx
          .select()
          .from(managementAccountsReceivable)
          .where(
            and(
              eq(managementAccountsReceivable.organizationId, organizationId),
              eq(managementAccountsReceivable.unitId, unitId),
              eq(managementAccountsReceivable.id, receivableId),
            ),
          )
          .limit(1);
        if (!receivable)
          throw new NotFoundException({
            code: "RECEIVABLE_NOT_FOUND",
            message: "Conta a receber não encontrada.",
          });
        if (receivable.status === "canceled" || receivable.status === "received")
          throw new ConflictException({
            code: "RECEIVABLE_NOT_OPEN",
            message: "A conta não aceita recebimentos.",
          });
        const cashShift = await this.lockOpenCashShift(tx, organizationId, unitId, {
          cashShiftId: input.cashShiftId,
          cashRegisterId: input.cashRegisterId,
        });
        if (input.method === "cash" && !cashShift)
          throw new BadRequestException({
            code: "CASH_SHIFT_REQUIRED",
            message: "Recebimentos em dinheiro exigem um caixa aberto.",
          });
        const next = settlement(
          receivable.amountCents,
          receivable.receivedCents,
          input.amountCents,
        );
        const paymentId = randomUUID();
        const occurredAt = input.occurredAt ? new Date(input.occurredAt) : new Date();
        await tx.insert(managementReceivablePayments).values({
          id: paymentId,
          organizationId,
          unitId,
          receivableId,
          cashShiftId: cashShift?.id,
          amountCents: input.amountCents,
          method: input.method,
          reference: input.reference,
          idempotencyKey,
          receivedByIdentityId: identityId,
          receivedAt: occurredAt,
        });
        if (cashShift)
          await tx.insert(managementCashEntries).values({
            organizationId,
            unitId,
            cashShiftId: cashShift.id,
            direction: "in",
            entryType: "receivable_payment",
            paymentMethod: input.method,
            affectsDrawer: input.method === "cash",
            amountCents: input.amountCents,
            sourceType: "receivable_payment",
            sourceId: paymentId,
            description: receivable.description,
            actorIdentityId: identityId,
            occurredAt,
          });
        const status = next.status === "settled" ? "received" : "partially_received";
        await tx
          .update(managementAccountsReceivable)
          .set({
            receivedCents: next.settledCents,
            status,
            version: receivable.version + 1,
            updatedAt: new Date(),
          })
          .where(eq(managementAccountsReceivable.id, receivable.id));
        await this.record(
          tx,
          identityId,
          organizationId,
          unitId,
          "management.receivable.received",
          "receivable",
          receivable.id,
          {
            paymentId,
            amountCents: input.amountCents,
            method: input.method,
            cashShiftId: cashShift?.id ?? null,
            status,
          },
        );
        return { receivableId, paymentId, receivedCents: next.settledCents, status };
      },
    );
  }

  async financeDashboard(identityId: string, organizationId: string, unitId: string) {
    await this.requireRole(identityId, organizationId, unitId, [...FINANCE_ROLES, "cashier"]);
    const [
      payables,
      payablePayments,
      receivables,
      receivablePayments,
      reconciliationImports,
      reconciliationEntries,
    ] = await Promise.all([
      this.database.db
        .select()
        .from(managementAccountsPayable)
        .where(
          and(
            eq(managementAccountsPayable.organizationId, organizationId),
            eq(managementAccountsPayable.unitId, unitId),
          ),
        )
        .orderBy(managementAccountsPayable.dueDate),
      this.database.db
        .select()
        .from(managementPayablePayments)
        .where(
          and(
            eq(managementPayablePayments.organizationId, organizationId),
            eq(managementPayablePayments.unitId, unitId),
          ),
        )
        .orderBy(desc(managementPayablePayments.paidAt))
        .limit(500),
      this.database.db
        .select()
        .from(managementAccountsReceivable)
        .where(
          and(
            eq(managementAccountsReceivable.organizationId, organizationId),
            eq(managementAccountsReceivable.unitId, unitId),
          ),
        )
        .orderBy(managementAccountsReceivable.dueDate),
      this.database.db
        .select()
        .from(managementReceivablePayments)
        .where(
          and(
            eq(managementReceivablePayments.organizationId, organizationId),
            eq(managementReceivablePayments.unitId, unitId),
          ),
        )
        .orderBy(desc(managementReceivablePayments.receivedAt))
        .limit(500),
      this.database.db
        .select()
        .from(managementReconciliationImports)
        .where(
          and(
            eq(managementReconciliationImports.organizationId, organizationId),
            eq(managementReconciliationImports.unitId, unitId),
          ),
        )
        .orderBy(desc(managementReconciliationImports.importedAt))
        .limit(100),
      this.database.db
        .select()
        .from(managementReconciliationEntries)
        .where(
          and(
            eq(managementReconciliationEntries.organizationId, organizationId),
            eq(managementReconciliationEntries.unitId, unitId),
          ),
        )
        .orderBy(desc(managementReconciliationEntries.createdAt))
        .limit(1_000),
    ]);
    return {
      payables,
      payablePayments,
      receivables,
      receivablePayments,
      reconciliationImports,
      reconciliationEntries,
    };
  }

  async createCashRegister(
    identityId: string,
    organizationId: string,
    unitId: string,
    idempotencyKey: string,
    input: CashRegisterCreateInput,
  ) {
    await this.requireRole(identityId, organizationId, unitId, CASH_REVIEW_ROLES);
    return this.idempotent(
      identityId,
      organizationId,
      unitId,
      idempotencyKey,
      "cash-register-create",
      input,
      async (tx) => {
        await tx.execute(
          sql`select pg_advisory_xact_lock(hashtext(${`cash-register:${organizationId}:${unitId}:${input.name.toLocaleLowerCase("pt-BR")}`}))`,
        );
        const [duplicate] = await tx
          .select({ id: managementCashRegisters.id })
          .from(managementCashRegisters)
          .where(
            and(
              eq(managementCashRegisters.organizationId, organizationId),
              eq(managementCashRegisters.unitId, unitId),
              sql`lower(${managementCashRegisters.name}) = lower(${input.name})`,
            ),
          )
          .limit(1);
        if (duplicate)
          throw new ConflictException({
            code: "CASH_REGISTER_NAME_ALREADY_EXISTS",
            message: "Já existe uma gaveta com este nome.",
          });
        const id = randomUUID();
        await tx.insert(managementCashRegisters).values({
          id,
          organizationId,
          unitId,
          name: input.name,
          createdByIdentityId: identityId,
        });
        await this.record(
          tx,
          identityId,
          organizationId,
          unitId,
          "management.cash-register.created",
          "cash_register",
          id,
          { name: input.name },
        );
        return { id, name: input.name, active: true };
      },
    );
  }

  async updateCashRegister(
    identityId: string,
    organizationId: string,
    unitId: string,
    cashRegisterId: string,
    idempotencyKey: string,
    input: CashRegisterUpdateInput,
  ) {
    await this.requireRole(identityId, organizationId, unitId, CASH_REVIEW_ROLES);
    return this.idempotent(
      identityId,
      organizationId,
      unitId,
      idempotencyKey,
      "cash-register-update",
      { cashRegisterId, ...input },
      async (tx) => {
        await tx.execute(
          sql`select id from management_cash_registers where organization_id=${organizationId}::uuid and unit_id=${unitId}::uuid and id=${cashRegisterId}::uuid for update`,
        );
        const [register] = await tx
          .select()
          .from(managementCashRegisters)
          .where(
            and(
              eq(managementCashRegisters.organizationId, organizationId),
              eq(managementCashRegisters.unitId, unitId),
              eq(managementCashRegisters.id, cashRegisterId),
            ),
          )
          .limit(1);
        if (!register)
          throw new NotFoundException({
            code: "CASH_REGISTER_NOT_FOUND",
            message: "Gaveta não encontrada nesta unidade.",
          });
        if (
          input.name &&
          input.name.toLocaleLowerCase("pt-BR") !== register.name.toLocaleLowerCase("pt-BR")
        ) {
          await tx.execute(
            sql`select pg_advisory_xact_lock(hashtext(${`cash-register:${organizationId}:${unitId}:${input.name.toLocaleLowerCase("pt-BR")}`}))`,
          );
          const [duplicate] = await tx
            .select({ id: managementCashRegisters.id })
            .from(managementCashRegisters)
            .where(
              and(
                eq(managementCashRegisters.organizationId, organizationId),
                eq(managementCashRegisters.unitId, unitId),
                ne(managementCashRegisters.id, cashRegisterId),
                sql`lower(${managementCashRegisters.name}) = lower(${input.name})`,
              ),
            )
            .limit(1);
          if (duplicate)
            throw new ConflictException({
              code: "CASH_REGISTER_NAME_ALREADY_EXISTS",
              message: "Já existe uma gaveta com este nome.",
            });
        }
        if (input.active === false) {
          const [openShift] = await tx
            .select({ id: managementCashShifts.id })
            .from(managementCashShifts)
            .where(
              and(
                eq(managementCashShifts.organizationId, organizationId),
                eq(managementCashShifts.unitId, unitId),
                eq(managementCashShifts.cashRegisterId, cashRegisterId),
                eq(managementCashShifts.status, "open"),
              ),
            )
            .limit(1);
          if (openShift)
            throw new ConflictException({
              code: "CASH_REGISTER_HAS_OPEN_SHIFT",
              message: "Feche o turno antes de desativar esta gaveta.",
            });
        }
        const [updated] = await tx
          .update(managementCashRegisters)
          .set({ ...input, updatedAt: new Date() })
          .where(eq(managementCashRegisters.id, register.id))
          .returning({
            id: managementCashRegisters.id,
            name: managementCashRegisters.name,
            active: managementCashRegisters.active,
          });
        if (!updated) throw new ConflictException({ code: "CASH_REGISTER_UPDATE_FAILED" });
        await this.record(
          tx,
          identityId,
          organizationId,
          unitId,
          "management.cash-register.updated",
          "cash_register",
          register.id,
          { previous: { name: register.name, active: register.active }, current: updated },
        );
        return updated;
      },
    );
  }

  async openCashShift(
    identityId: string,
    organizationId: string,
    unitId: string,
    idempotencyKey: string,
    input: OpenCashShiftInput,
  ) {
    await this.requireRole(identityId, organizationId, unitId, CASH_OPERATE_ROLES);
    return this.idempotent(
      identityId,
      organizationId,
      unitId,
      idempotencyKey,
      "cash-shift-open",
      input,
      async (tx) => {
        let register: typeof managementCashRegisters.$inferSelect;
        if (input.cashRegisterId) {
          register = await this.requireActiveCashRegister(
            tx,
            organizationId,
            unitId,
            input.cashRegisterId,
          );
        } else {
          const registers = await tx
            .select()
            .from(managementCashRegisters)
            .where(
              and(
                eq(managementCashRegisters.organizationId, organizationId),
                eq(managementCashRegisters.unitId, unitId),
                eq(managementCashRegisters.active, true),
              ),
            )
            .orderBy(managementCashRegisters.id)
            .limit(2);
          const selectedRegister = registers[0];
          if (registers.length !== 1 || !selectedRegister)
            throw new ConflictException({
              code: "CASH_REGISTER_REQUIRED",
              message: "Selecione a gaveta para abrir o caixa.",
            });
          register = await this.requireActiveCashRegister(
            tx,
            organizationId,
            unitId,
            selectedRegister.id,
          );
        }
        await tx.execute(
          sql`select pg_advisory_xact_lock(hashtext(${`cash-shift:${organizationId}:${unitId}:${register.id}`}))`,
        );
        const [open] = await tx
          .select({ id: managementCashShifts.id })
          .from(managementCashShifts)
          .where(
            and(
              eq(managementCashShifts.organizationId, organizationId),
              eq(managementCashShifts.unitId, unitId),
              eq(managementCashShifts.cashRegisterId, register.id),
              eq(managementCashShifts.status, "open"),
            ),
          )
          .limit(1);
        if (open)
          throw new ConflictException({
            code: "CASH_SHIFT_ALREADY_OPEN",
            message: "A gaveta já possui um caixa aberto.",
          });
        const id = randomUUID();
        await tx.insert(managementCashShifts).values({
          id,
          organizationId,
          unitId,
          cashRegisterId: register.id,
          operatorIdentityId: identityId,
          currentResponsibleIdentityId: identityId,
          openingCents: input.openingCents,
          openIdempotencyKey: idempotencyKey,
        });
        await this.record(
          tx,
          identityId,
          organizationId,
          unitId,
          "management.cash-shift.opened",
          "cash_shift",
          id,
          { cashRegisterId: register.id, openingCents: input.openingCents },
        );
        return {
          cashShiftId: id,
          cashRegisterId: register.id,
          cashRegisterName: register.name,
          status: "open",
          openingCents: input.openingCents,
        };
      },
    );
  }

  async addCashMovement(
    identityId: string,
    organizationId: string,
    unitId: string,
    cashShiftId: string,
    idempotencyKey: string,
    input: CashMovementInput,
  ) {
    const role = await this.requireRole(identityId, organizationId, unitId, CASH_OPERATE_ROLES);
    return this.idempotent(
      identityId,
      organizationId,
      unitId,
      idempotencyKey,
      "cash-movement",
      { cashShiftId, ...input },
      async (tx) => {
        const settings = await this.cashSettings(tx, organizationId, unitId);
        if (
          requiresCashApproval(role, input.amountCents, settings.movementApprovalThresholdCents)
        ) {
          await this.lockCashShiftById(tx, organizationId, unitId, cashShiftId);
          const approvalId = randomUUID();
          const [approval] = await tx
            .insert(managementCashApprovalRequests)
            .values({
              id: approvalId,
              organizationId,
              unitId,
              kind: input.type,
              cashShiftId,
              amountCents: input.amountCents,
              reason: input.reason,
              requestedByIdentityId: identityId,
              idempotencyKey,
            })
            .returning({ requestedAt: managementCashApprovalRequests.createdAt });
          await this.record(
            tx,
            identityId,
            organizationId,
            unitId,
            "management.cash-approval.requested",
            "cash_approval",
            approvalId,
            { kind: input.type, cashShiftId, amountCents: input.amountCents },
          );
          return {
            approvalId,
            status: "pending",
            kind: input.type,
            cashShiftId,
            amountCents: input.amountCents,
            requestedAt: approval?.requestedAt.toISOString(),
          };
        }
        return this.executeCashMovement(
          tx,
          identityId,
          organizationId,
          unitId,
          cashShiftId,
          idempotencyKey,
          input,
        );
      },
    );
  }

  async transferCash(
    identityId: string,
    organizationId: string,
    unitId: string,
    idempotencyKey: string,
    input: CashTransferInput,
  ) {
    const role = await this.requireRole(identityId, organizationId, unitId, CASH_OPERATE_ROLES);
    return this.idempotent(
      identityId,
      organizationId,
      unitId,
      idempotencyKey,
      "cash-transfer",
      input,
      async (tx) => {
        const settings = await this.cashSettings(tx, organizationId, unitId);
        if (
          requiresCashApproval(role, input.amountCents, settings.movementApprovalThresholdCents)
        ) {
          const lockOrder = cashTransferLockOrder(input.fromCashShiftId, input.toCashShiftId);
          for (const cashShiftId of lockOrder)
            await this.lockCashShiftById(tx, organizationId, unitId, cashShiftId);
          const approvalId = randomUUID();
          const [approval] = await tx
            .insert(managementCashApprovalRequests)
            .values({
              id: approvalId,
              organizationId,
              unitId,
              kind: "transfer",
              cashShiftId: input.fromCashShiftId,
              targetCashShiftId: input.toCashShiftId,
              amountCents: input.amountCents,
              reason: input.reason,
              requestedByIdentityId: identityId,
              idempotencyKey,
            })
            .returning({ requestedAt: managementCashApprovalRequests.createdAt });
          await this.record(
            tx,
            identityId,
            organizationId,
            unitId,
            "management.cash-approval.requested",
            "cash_approval",
            approvalId,
            { kind: "transfer", ...input },
          );
          return {
            approvalId,
            status: "pending",
            kind: "transfer",
            fromCashShiftId: input.fromCashShiftId,
            toCashShiftId: input.toCashShiftId,
            amountCents: input.amountCents,
            requestedAt: approval?.requestedAt.toISOString(),
          };
        }
        return this.executeCashTransfer(
          tx,
          identityId,
          organizationId,
          unitId,
          idempotencyKey,
          input,
        );
      },
    );
  }

  async closeCashShift(
    identityId: string,
    organizationId: string,
    unitId: string,
    cashShiftId: string,
    idempotencyKey: string,
    input: CloseCashShiftInput,
  ) {
    await this.requireRole(identityId, organizationId, unitId, CASH_OPERATE_ROLES);
    return this.idempotent(
      identityId,
      organizationId,
      unitId,
      idempotencyKey,
      "cash-shift-close",
      { cashShiftId, ...input },
      async (tx) => {
        const shift = await this.lockOpenCashShift(tx, organizationId, unitId, { cashShiftId });
        if (!shift) throw new ConflictException({ code: "CASH_SHIFT_CLOSED" });
        const entries = await tx
          .select({
            direction: managementCashEntries.direction,
            paymentMethod: managementCashEntries.paymentMethod,
            affectsDrawer: managementCashEntries.affectsDrawer,
            amountCents: managementCashEntries.amountCents,
          })
          .from(managementCashEntries)
          .where(
            and(
              eq(managementCashEntries.organizationId, organizationId),
              eq(managementCashEntries.unitId, unitId),
              eq(managementCashEntries.cashShiftId, cashShiftId),
            ),
          );
        const drawerInCents = entries
          .filter((entry) => entry.affectsDrawer && entry.direction === "in")
          .reduce((sum, entry) => sum + entry.amountCents, 0);
        const drawerOutCents = entries
          .filter((entry) => entry.affectsDrawer && entry.direction === "out")
          .reduce((sum, entry) => sum + entry.amountCents, 0);
        const expectedByMethod = new Map<(typeof CASH_PAYMENT_METHODS)[number], number>([
          ["cash", shift.openingCents + drawerInCents - drawerOutCents],
        ]);
        for (const entry of entries) {
          if (
            !entry.paymentMethod ||
            entry.paymentMethod === "cash" ||
            entry.direction !== "in" ||
            !CASH_PAYMENT_METHODS.includes(
              entry.paymentMethod as (typeof CASH_PAYMENT_METHODS)[number],
            )
          )
            continue;
          const method = entry.paymentMethod as (typeof CASH_PAYMENT_METHODS)[number];
          expectedByMethod.set(method, (expectedByMethod.get(method) ?? 0) + entry.amountCents);
        }
        const observations =
          input.tenderCounts ??
          (input.countedCents === undefined
            ? []
            : [
                {
                  method: "cash" as const,
                  observedCents: input.countedCents,
                  source: "manual" as const,
                },
              ]);
        const tenderBreakdown = cashTenderConference(expectedByMethod, observations);
        const cashTender = tenderBreakdown.find((tender) => tender.method === "cash");
        if (!cashTender) throw new BadRequestException({ code: "CASH_TENDER_COUNT_REQUIRED" });
        const expectedCents = cashTender.expectedCents;
        const countedCents = cashTender.observedCents;
        const differenceCents = cashTender.differenceCents;
        const reviewRequired = tenderBreakdown.some((tender) => tender.differenceCents !== 0);
        const settings = await this.cashSettings(tx, organizationId, unitId);
        const differenceSeverity = cashDifferenceSeverity(
          tenderBreakdown,
          settings.discrepancyCriticalThresholdCents,
        );
        await tx.insert(managementCashShiftTenderCounts).values(
          tenderBreakdown.map((tender) => ({
            organizationId,
            unitId,
            cashShiftId,
            ...tender,
            recordedByIdentityId: identityId,
          })),
        );
        await tx
          .update(managementCashShifts)
          .set({
            status: "closed",
            expectedCents,
            countedCents,
            differenceCents,
            closedAt: new Date(),
            closedByIdentityId: identityId,
            closeReason: input.closeReason,
            closeIdempotencyKey: idempotencyKey,
            version: shift.version + 1,
            updatedAt: new Date(),
          })
          .where(eq(managementCashShifts.id, shift.id));
        await this.record(
          tx,
          identityId,
          organizationId,
          unitId,
          "management.cash-shift.closed",
          "cash_shift",
          shift.id,
          {
            expectedCents,
            countedCents,
            differenceCents,
            drawerInCents,
            drawerOutCents,
            tenderBreakdown,
            differenceSeverity,
            reviewRequired,
          },
        );
        return {
          cashShiftId,
          status: "closed",
          expectedCents,
          countedCents,
          differenceCents,
          drawerInCents,
          drawerOutCents,
          breakdown: tenderBreakdown.map((tender) => ({
            method: tender.method,
            amountCents: tender.expectedCents,
          })),
          tenderBreakdown,
          differenceSeverity,
          reviewRequired,
        };
      },
    );
  }

  async reviewCashShift(
    identityId: string,
    organizationId: string,
    unitId: string,
    cashShiftId: string,
    idempotencyKey: string,
    input: CashShiftReviewInput,
  ) {
    await this.requireRole(identityId, organizationId, unitId, CASH_REVIEW_ROLES);
    return this.idempotent(
      identityId,
      organizationId,
      unitId,
      idempotencyKey,
      "cash-shift-review",
      { cashShiftId, ...input },
      async (tx) => {
        await tx.execute(
          sql`select id from management_cash_shifts where organization_id=${organizationId}::uuid and unit_id=${unitId}::uuid and id=${cashShiftId}::uuid for update`,
        );
        const [shift] = await tx
          .select()
          .from(managementCashShifts)
          .where(
            and(
              eq(managementCashShifts.organizationId, organizationId),
              eq(managementCashShifts.unitId, unitId),
              eq(managementCashShifts.id, cashShiftId),
            ),
          )
          .limit(1);
        if (!shift)
          throw new NotFoundException({
            code: "CASH_SHIFT_NOT_FOUND",
            message: "Caixa não encontrado nesta unidade.",
          });
        if (shift.status !== "closed")
          throw new ConflictException({
            code: "CASH_SHIFT_NOT_REVIEWABLE",
            message: "Apenas caixas fechados e ainda não revisados podem ser revisados.",
          });
        const tenderBreakdown = await tx
          .select({
            method: managementCashShiftTenderCounts.method,
            expectedCents: managementCashShiftTenderCounts.expectedCents,
            observedCents: managementCashShiftTenderCounts.observedCents,
            differenceCents: managementCashShiftTenderCounts.differenceCents,
            source: managementCashShiftTenderCounts.source,
          })
          .from(managementCashShiftTenderCounts)
          .where(
            and(
              eq(managementCashShiftTenderCounts.organizationId, organizationId),
              eq(managementCashShiftTenderCounts.unitId, unitId),
              eq(managementCashShiftTenderCounts.cashShiftId, cashShiftId),
            ),
          );
        const reviewRequired =
          tenderBreakdown.length > 0
            ? tenderBreakdown.some((tender) => tender.differenceCents !== 0)
            : Boolean(shift.differenceCents);
        if (!reviewRequired)
          throw new ConflictException({
            code: "CASH_SHIFT_REVIEW_NOT_REQUIRED",
            message: "O caixa não possui divergência para revisão.",
          });
        if (
          identityId === shift.operatorIdentityId ||
          identityId === shift.currentResponsibleIdentityId ||
          identityId === shift.closedByIdentityId
        )
          throw new ForbiddenException({
            code: "CASH_SHIFT_REVIEW_DUAL_CONTROL_REQUIRED",
            message: "A revisão deve ser feita por outro gestor.",
          });

        const reviewedAt = new Date();
        await tx
          .update(managementCashShifts)
          .set({
            status: "reviewed",
            reviewedByIdentityId: identityId,
            reviewedAt,
            reviewNote: input.note,
            reviewIdempotencyKey: idempotencyKey,
            version: shift.version + 1,
            updatedAt: reviewedAt,
          })
          .where(eq(managementCashShifts.id, shift.id));
        await this.record(
          tx,
          identityId,
          organizationId,
          unitId,
          "management.cash-shift.reviewed",
          "cash_shift",
          shift.id,
          { differenceCents: shift.differenceCents, tenderBreakdown, note: input.note },
        );
        return {
          cashShiftId,
          status: "reviewed",
          differenceCents: shift.differenceCents,
          tenderBreakdown,
          reviewedAt: reviewedAt.toISOString(),
        };
      },
    );
  }

  async getCashSettings(identityId: string, organizationId: string, unitId: string) {
    await this.requireRole(identityId, organizationId, unitId, CASH_READ_ROLES);
    return this.cashSettings(this.database.db, organizationId, unitId);
  }

  async updateCashSettings(
    identityId: string,
    organizationId: string,
    unitId: string,
    idempotencyKey: string,
    input: CashSettingsInput,
  ) {
    await this.requireRole(identityId, organizationId, unitId, CASH_REVIEW_ROLES);
    return this.idempotent(
      identityId,
      organizationId,
      unitId,
      idempotencyKey,
      "cash-settings-update",
      input,
      async (tx) => {
        const [settings] = await tx
          .insert(managementCashSettings)
          .values({ organizationId, unitId, ...input, updatedByIdentityId: identityId })
          .onConflictDoUpdate({
            target: [managementCashSettings.organizationId, managementCashSettings.unitId],
            set: { ...input, updatedByIdentityId: identityId, updatedAt: new Date() },
          })
          .returning({
            movementApprovalThresholdCents: managementCashSettings.movementApprovalThresholdCents,
            discrepancyCriticalThresholdCents:
              managementCashSettings.discrepancyCriticalThresholdCents,
            maxShiftMinutes: managementCashSettings.maxShiftMinutes,
          });
        if (!settings) throw new ConflictException({ code: "CASH_SETTINGS_UPDATE_FAILED" });
        await this.record(
          tx,
          identityId,
          organizationId,
          unitId,
          "management.cash-settings.updated",
          "cash_settings",
          unitId,
          settings,
        );
        return settings;
      },
    );
  }

  async handoverCashShift(
    identityId: string,
    organizationId: string,
    unitId: string,
    cashShiftId: string,
    idempotencyKey: string,
    input: CashShiftHandoverInput,
  ) {
    const role = await this.requireRole(identityId, organizationId, unitId, CASH_OPERATE_ROLES);
    await this.requireRole(input.toIdentityId, organizationId, unitId, CASH_OPERATE_ROLES);
    if (input.toIdentityId === identityId)
      throw new ConflictException({
        code: "CASH_HANDOVER_SAME_RESPONSIBLE",
        message: "Selecione outro operador para assumir o caixa.",
      });
    return this.idempotent(
      identityId,
      organizationId,
      unitId,
      idempotencyKey,
      "cash-shift-handover",
      { cashShiftId, ...input },
      async (tx) => {
        const shift = await this.lockCashShiftById(tx, organizationId, unitId, cashShiftId);
        if (
          role !== "owner" &&
          role !== "manager" &&
          shift.currentResponsibleIdentityId !== identityId
        )
          throw new ForbiddenException({
            code: "CASH_HANDOVER_RESPONSIBLE_REQUIRED",
            message: "Somente o operador responsável ou um gestor pode transferir o caixa.",
          });
        if (shift.currentResponsibleIdentityId === input.toIdentityId)
          throw new ConflictException({
            code: "CASH_HANDOVER_SAME_RESPONSIBLE",
            message: "O operador selecionado já é o responsável pelo caixa.",
          });
        const responsibilityId = randomUUID();
        const occurredAt = new Date();
        await tx.insert(managementCashShiftResponsibilities).values({
          id: responsibilityId,
          organizationId,
          unitId,
          cashShiftId,
          fromIdentityId: shift.currentResponsibleIdentityId,
          toIdentityId: input.toIdentityId,
          transferredByIdentityId: identityId,
          reason: input.reason,
          occurredAt,
          idempotencyKey,
        });
        await tx
          .update(managementCashShifts)
          .set({
            currentResponsibleIdentityId: input.toIdentityId,
            version: shift.version + 1,
            updatedAt: occurredAt,
          })
          .where(eq(managementCashShifts.id, shift.id));
        await this.record(
          tx,
          identityId,
          organizationId,
          unitId,
          "management.cash-shift.handed-over",
          "cash_shift",
          cashShiftId,
          {
            responsibilityId,
            fromIdentityId: shift.currentResponsibleIdentityId,
            toIdentityId: input.toIdentityId,
            reason: input.reason,
          },
        );
        return {
          cashShiftId,
          currentResponsibleIdentityId: input.toIdentityId,
          occurredAt: occurredAt.toISOString(),
        };
      },
    );
  }

  async listCashApprovals(identityId: string, organizationId: string, unitId: string) {
    await this.requireRole(identityId, organizationId, unitId, CASH_READ_ROLES);
    const approvals = await this.database.db
      .select()
      .from(managementCashApprovalRequests)
      .where(
        and(
          eq(managementCashApprovalRequests.organizationId, organizationId),
          eq(managementCashApprovalRequests.unitId, unitId),
          eq(managementCashApprovalRequests.status, "pending"),
        ),
      )
      .orderBy(asc(managementCashApprovalRequests.createdAt))
      .limit(200);
    const requesterIds = [...new Set(approvals.map((approval) => approval.requestedByIdentityId))];
    const requesterRows =
      requesterIds.length === 0
        ? []
        : await this.database.db
            .select({ id: identities.id, name: identities.displayName })
            .from(identities)
            .where(inArray(identities.id, requesterIds));
    const names = new Map(requesterRows.map((requester) => [requester.id, requester.name]));
    return {
      approvals: approvals.map((approval) => ({
        id: approval.id,
        kind: approval.kind,
        fromCashShiftId: approval.cashShiftId,
        toCashShiftId: approval.targetCashShiftId,
        amountCents: approval.amountCents,
        reason: approval.reason,
        requestedByName: names.get(approval.requestedByIdentityId) ?? "Usuário",
        status: approval.status,
        requestedAt: approval.createdAt,
      })),
    };
  }

  async decideCashApproval(
    identityId: string,
    organizationId: string,
    unitId: string,
    approvalId: string,
    idempotencyKey: string,
    input: CashApprovalDecisionInput,
  ) {
    await this.requireRole(identityId, organizationId, unitId, CASH_REVIEW_ROLES);
    return this.idempotent(
      identityId,
      organizationId,
      unitId,
      idempotencyKey,
      "cash-approval-decision",
      { approvalId, ...input },
      async (tx) => {
        await tx.execute(
          sql`select id from management_cash_approval_requests where organization_id=${organizationId}::uuid and unit_id=${unitId}::uuid and id=${approvalId}::uuid for update`,
        );
        const [approval] = await tx
          .select()
          .from(managementCashApprovalRequests)
          .where(
            and(
              eq(managementCashApprovalRequests.organizationId, organizationId),
              eq(managementCashApprovalRequests.unitId, unitId),
              eq(managementCashApprovalRequests.id, approvalId),
            ),
          )
          .limit(1);
        if (!approval)
          throw new NotFoundException({
            code: "CASH_APPROVAL_NOT_FOUND",
            message: "Solicitação de aprovação não encontrada.",
          });
        if (approval.status !== "pending")
          throw new ConflictException({
            code: "CASH_APPROVAL_ALREADY_DECIDED",
            message: "Esta solicitação já foi decidida.",
          });
        if (approval.requestedByIdentityId === identityId)
          throw new ForbiddenException({
            code: "CASH_APPROVAL_DUAL_CONTROL_REQUIRED",
            message: "O solicitante não pode aprovar a própria operação.",
          });

        const decidedAt = new Date();
        let executedMovementId: string | null = null;
        let executedTransferId: string | null = null;
        if (input.decision === "approve") {
          const executionKey = `cash-approval:${approval.id}`;
          if (approval.kind === "transfer") {
            if (!approval.targetCashShiftId)
              throw new ConflictException({ code: "CASH_APPROVAL_TARGET_MISSING" });
            const executed = await this.executeCashTransfer(
              tx,
              identityId,
              organizationId,
              unitId,
              executionKey,
              {
                fromCashShiftId: approval.cashShiftId,
                toCashShiftId: approval.targetCashShiftId,
                amountCents: approval.amountCents,
                reason: approval.reason,
              },
            );
            executedTransferId = executed.transferId;
          } else {
            const executed = await this.executeCashMovement(
              tx,
              identityId,
              organizationId,
              unitId,
              approval.cashShiftId,
              executionKey,
              {
                type: approval.kind,
                amountCents: approval.amountCents,
                reason: approval.reason,
              },
            );
            executedMovementId = executed.movementId;
          }
        }
        const status = input.decision === "approve" ? ("approved" as const) : ("rejected" as const);
        await tx
          .update(managementCashApprovalRequests)
          .set({
            status,
            decidedByIdentityId: identityId,
            decisionNote: input.note ?? null,
            decidedAt,
            executedMovementId,
            executedTransferId,
            updatedAt: decidedAt,
          })
          .where(eq(managementCashApprovalRequests.id, approval.id));
        await this.record(
          tx,
          identityId,
          organizationId,
          unitId,
          `management.cash-approval.${status}`,
          "cash_approval",
          approval.id,
          { executedMovementId, executedTransferId, note: input.note },
        );
        return {
          approvalId: approval.id,
          status,
          executedMovementId,
          executedTransferId,
          decidedAt: decidedAt.toISOString(),
        };
      },
    );
  }

  async updateCashTerminal(
    identityId: string,
    organizationId: string,
    unitId: string,
    installationId: string,
    idempotencyKey: string,
    input: CashTerminalUpdateInput,
  ) {
    await this.requireRole(identityId, organizationId, unitId, CASH_REVIEW_ROLES);
    return this.idempotent(
      identityId,
      organizationId,
      unitId,
      idempotencyKey,
      "cash-terminal-update",
      { installationId, ...input },
      async (tx) => {
        const [terminal] = await tx
          .select({
            label: posTerminalProfiles.label,
            mode: posTerminalProfiles.mode,
            defaultRoute: posTerminalProfiles.defaultRoute,
          })
          .from(posTerminalProfiles)
          .where(
            and(
              eq(posTerminalProfiles.organizationId, organizationId),
              eq(posTerminalProfiles.unitId, unitId),
              eq(posTerminalProfiles.installationId, installationId),
            ),
          )
          .limit(1);
        if (!terminal)
          throw new NotFoundException({
            code: "CASH_TERMINAL_NOT_FOUND",
            message: "Terminal não encontrado nesta unidade.",
          });
        if (
          input.cashRegisterId &&
          !["cashier", "shared"].includes(terminal.mode) &&
          !["counter", "cash"].includes(terminal.defaultRoute)
        )
          throw new ConflictException({
            code: "CASH_TERMINAL_NOT_ELIGIBLE",
            message: "Este perfil de terminal não opera pagamentos de caixa.",
          });
        if (input.cashRegisterId) {
          await this.requireActiveCashRegister(tx, organizationId, unitId, input.cashRegisterId);
          await tx
            .insert(managementCashRegisterTerminals)
            .values({
              organizationId,
              unitId,
              installationId,
              cashRegisterId: input.cashRegisterId,
              updatedByIdentityId: identityId,
            })
            .onConflictDoUpdate({
              target: [
                managementCashRegisterTerminals.organizationId,
                managementCashRegisterTerminals.unitId,
                managementCashRegisterTerminals.installationId,
              ],
              set: {
                cashRegisterId: input.cashRegisterId,
                updatedByIdentityId: identityId,
                updatedAt: new Date(),
              },
            });
        } else {
          await tx
            .delete(managementCashRegisterTerminals)
            .where(
              and(
                eq(managementCashRegisterTerminals.organizationId, organizationId),
                eq(managementCashRegisterTerminals.unitId, unitId),
                eq(managementCashRegisterTerminals.installationId, installationId),
              ),
            );
        }
        await this.record(
          tx,
          identityId,
          organizationId,
          unitId,
          "management.cash-terminal.updated",
          "cash_terminal",
          installationId,
          { cashRegisterId: input.cashRegisterId },
        );
        return { installationId, label: terminal.label, cashRegisterId: input.cashRegisterId };
      },
    );
  }

  async listCashShifts(identityId: string, organizationId: string, unitId: string) {
    const role = await this.requireRole(identityId, organizationId, unitId, CASH_READ_ROLES);
    const [
      shifts,
      entries,
      openTabs,
      registers,
      terminals,
      tenderCounts,
      approvals,
      adjustments,
      operators,
      settings,
    ] = await Promise.all([
      this.database.db
        .select()
        .from(managementCashShifts)
        .where(
          and(
            eq(managementCashShifts.organizationId, organizationId),
            eq(managementCashShifts.unitId, unitId),
          ),
        )
        .orderBy(desc(managementCashShifts.openedAt))
        .limit(200),
      this.database.db
        .select()
        .from(managementCashEntries)
        .where(
          and(
            eq(managementCashEntries.organizationId, organizationId),
            eq(managementCashEntries.unitId, unitId),
          ),
        )
        .orderBy(desc(managementCashEntries.occurredAt))
        .limit(500),
      this.database.db
        .select({
          id: posTabs.id,
          label: posTabs.label,
          displayNumber: posTabs.displayNumber,
          totalCents: posTabs.totalCents,
        })
        .from(posTabs)
        .where(
          and(
            eq(posTabs.organizationId, organizationId),
            eq(posTabs.unitId, unitId),
            eq(posTabs.status, "open"),
          ),
        )
        .orderBy(asc(posTabs.createdAt))
        .limit(200),
      this.database.db
        .select({
          id: managementCashRegisters.id,
          name: managementCashRegisters.name,
          active: managementCashRegisters.active,
        })
        .from(managementCashRegisters)
        .where(
          and(
            eq(managementCashRegisters.organizationId, organizationId),
            eq(managementCashRegisters.unitId, unitId),
          ),
        )
        .orderBy(asc(managementCashRegisters.name)),
      this.database.db
        .select({
          installationId: posTerminalProfiles.installationId,
          label: posTerminalProfiles.label,
          cashRegisterId: managementCashRegisterTerminals.cashRegisterId,
          lastSeenAt: posPaymentDeviceDiagnostics.lastSeenAt,
        })
        .from(posTerminalProfiles)
        .leftJoin(
          managementCashRegisterTerminals,
          and(
            eq(managementCashRegisterTerminals.organizationId, posTerminalProfiles.organizationId),
            eq(managementCashRegisterTerminals.unitId, posTerminalProfiles.unitId),
            eq(managementCashRegisterTerminals.installationId, posTerminalProfiles.installationId),
          ),
        )
        .leftJoin(
          posPaymentDeviceDiagnostics,
          and(
            eq(posPaymentDeviceDiagnostics.organizationId, posTerminalProfiles.organizationId),
            eq(posPaymentDeviceDiagnostics.unitId, posTerminalProfiles.unitId),
            eq(posPaymentDeviceDiagnostics.installationId, posTerminalProfiles.installationId),
          ),
        )
        .where(
          and(
            eq(posTerminalProfiles.organizationId, organizationId),
            eq(posTerminalProfiles.unitId, unitId),
            or(
              inArray(posTerminalProfiles.mode, ["cashier", "shared"]),
              inArray(posTerminalProfiles.defaultRoute, ["counter", "cash"]),
            ),
          ),
        )
        .orderBy(asc(posTerminalProfiles.label)),
      this.database.db
        .select()
        .from(managementCashShiftTenderCounts)
        .where(
          and(
            eq(managementCashShiftTenderCounts.organizationId, organizationId),
            eq(managementCashShiftTenderCounts.unitId, unitId),
          ),
        ),
      this.database.db
        .select()
        .from(managementCashApprovalRequests)
        .where(
          and(
            eq(managementCashApprovalRequests.organizationId, organizationId),
            eq(managementCashApprovalRequests.unitId, unitId),
            eq(managementCashApprovalRequests.status, "pending"),
          ),
        )
        .orderBy(asc(managementCashApprovalRequests.createdAt))
        .limit(200),
      this.database.db
        .select()
        .from(managementCashAdjustments)
        .where(
          and(
            eq(managementCashAdjustments.organizationId, organizationId),
            eq(managementCashAdjustments.unitId, unitId),
          ),
        )
        .orderBy(desc(managementCashAdjustments.occurredAt))
        .limit(200),
      this.database.db
        .selectDistinct({ identityId: identities.id, name: identities.displayName })
        .from(memberships)
        .innerJoin(identities, eq(identities.id, memberships.identityId))
        .innerJoin(roleBindings, eq(roleBindings.membershipId, memberships.id))
        .where(
          and(
            eq(memberships.organizationId, organizationId),
            eq(memberships.status, "active"),
            inArray(roleBindings.role, [...CASH_OPERATE_ROLES]),
            or(isNull(roleBindings.unitId), eq(roleBindings.unitId, unitId)),
          ),
        )
        .orderBy(identities.displayName),
      this.cashSettings(this.database.db, organizationId, unitId),
    ]);
    const tabPayments =
      openTabs.length === 0
        ? []
        : await this.database.db
            .select({
              tabId: posTabPayments.tabId,
              amountCents: posTabPayments.amountCents,
              reversedCents: sql<number>`coalesce(${posPaymentReversals.amountCents}, 0)`.mapWith(
                Number,
              ),
            })
            .from(posTabPayments)
            .leftJoin(
              posPaymentReversals,
              and(
                eq(posPaymentReversals.organizationId, posTabPayments.organizationId),
                eq(posPaymentReversals.unitId, posTabPayments.unitId),
                eq(posPaymentReversals.paymentId, posTabPayments.id),
                eq(posPaymentReversals.status, "approved"),
              ),
            )
            .where(
              and(
                eq(posTabPayments.organizationId, organizationId),
                eq(posTabPayments.unitId, unitId),
                inArray(
                  posTabPayments.tabId,
                  openTabs.map((tab) => tab.id),
                ),
              ),
            );
    const drawerRows =
      shifts.length === 0
        ? []
        : await this.database.db
            .select({
              cashShiftId: managementCashEntries.cashShiftId,
              drawerInCents: sql<number>`coalesce(sum(case when ${managementCashEntries.affectsDrawer} and ${managementCashEntries.direction} = 'in' then ${managementCashEntries.amountCents} else 0 end), 0)::integer`,
              drawerOutCents: sql<number>`coalesce(sum(case when ${managementCashEntries.affectsDrawer} and ${managementCashEntries.direction} = 'out' then ${managementCashEntries.amountCents} else 0 end), 0)::integer`,
            })
            .from(managementCashEntries)
            .where(
              and(
                eq(managementCashEntries.organizationId, organizationId),
                eq(managementCashEntries.unitId, unitId),
                inArray(
                  managementCashEntries.cashShiftId,
                  shifts.map((shift) => shift.id),
                ),
              ),
            )
            .groupBy(managementCashEntries.cashShiftId);
    const drawerByShift = new Map(
      drawerRows.map((row) => [
        row.cashShiftId,
        {
          drawerInCents: Number(row.drawerInCents),
          drawerOutCents: Number(row.drawerOutCents),
        },
      ]),
    );
    const paidByTab = new Map<string, number>();
    for (const payment of tabPayments)
      paidByTab.set(
        payment.tabId,
        (paidByTab.get(payment.tabId) ?? 0) + payment.amountCents - payment.reversedCents,
      );
    const pendingTabs = openTabs.flatMap((tab) => {
      const paidCents = paidByTab.get(tab.id) ?? 0;
      const remainingCents = Math.max(0, tab.totalCents - paidCents);
      return remainingCents > 0
        ? [
            {
              id: tab.id,
              label:
                tab.label ??
                (tab.displayNumber === null ? "Comanda" : `Comanda ${tab.displayNumber}`),
              totalCents: tab.totalCents,
              paidCents,
              remainingCents,
            },
          ]
        : [];
    });
    const identityIds = [
      ...shifts.flatMap((shift) => [
        shift.operatorIdentityId,
        shift.currentResponsibleIdentityId,
        shift.closedByIdentityId,
        shift.reviewedByIdentityId,
      ]),
      ...entries.map((entry) => entry.actorIdentityId),
      ...approvals.map((approval) => approval.requestedByIdentityId),
      ...adjustments.map((adjustment) => adjustment.actorIdentityId),
    ].filter((id): id is string => id !== null);
    const identityRows =
      identityIds.length === 0
        ? []
        : await this.database.db
            .select({ id: identities.id, name: identities.displayName })
            .from(identities)
            .where(inArray(identities.id, [...new Set(identityIds)]));
    const names = new Map(identityRows.map((identity) => [identity.id, identity.name]));
    const registerNames = new Map(registers.map((register) => [register.id, register.name]));
    const openShiftByRegister = new Map(
      shifts
        .filter((shift) => shift.status === "open")
        .map((shift) => [shift.cashRegisterId, shift.id]),
    );
    const canOperate = role === "owner" || role === "manager" || role === "cashier";
    const tenderByShift = new Map<string, typeof tenderCounts>();
    for (const tender of tenderCounts)
      tenderByShift.set(tender.cashShiftId, [
        ...(tenderByShift.get(tender.cashShiftId) ?? []),
        tender,
      ]);
    const now = Date.now();
    const terminalViews = terminals.map((terminal) => ({
      ...terminal,
      status:
        terminal.lastSeenAt === null
          ? ("unpaired" as const)
          : now - terminal.lastSeenAt.getTime() > 10 * 60_000
            ? ("offline" as const)
            : ("online" as const),
    }));
    const alerts = [
      ...shifts
        .filter(
          (shift) =>
            shift.status === "open" &&
            now - shift.openedAt.getTime() > settings.maxShiftMinutes * 60_000,
        )
        .map((shift) => ({
          code: "CASH_SHIFT_OVERLONG",
          severity: "warning" as const,
          message: "Turno aberto acima do tempo recomendado.",
          cashShiftId: shift.id,
          cashRegisterId: shift.cashRegisterId,
        })),
      ...terminalViews
        .filter((terminal) => terminal.cashRegisterId === null)
        .map((terminal) => ({
          code: "CASH_TERMINAL_UNBOUND",
          severity: "warning" as const,
          message: "Terminal sem gaveta vinculada.",
          installationId: terminal.installationId,
        })),
      ...terminalViews
        .filter((terminal) => terminal.status !== "online")
        .map((terminal) => ({
          code: terminal.status === "offline" ? "CASH_TERMINAL_OFFLINE" : "CASH_TERMINAL_UNPAIRED",
          severity: terminal.status === "offline" ? ("critical" as const) : ("warning" as const),
          message:
            terminal.status === "offline"
              ? "Terminal sem comunicação recente."
              : "Terminal ainda não pareado com um dispositivo.",
          installationId: terminal.installationId,
        })),
      ...approvals.map((approval) => ({
        code: "CASH_APPROVAL_PENDING",
        severity: "warning" as const,
        message: "Operação de caixa aguardando aprovação.",
        cashShiftId: approval.cashShiftId,
      })),
    ];
    return {
      settings,
      alerts,
      operators,
      capabilities: {
        canOpen: canOperate,
        canMove: canOperate,
        canClose: canOperate,
        canReview: role === "owner" || role === "manager",
        canViewExpected: role !== "cashier",
        canManageRegisters: role === "owner" || role === "manager",
        canTransfer: canOperate,
        canManageCashSettings: role === "owner" || role === "manager",
        canManageTerminals: role === "owner" || role === "manager",
        canApproveCashRequests: role === "owner" || role === "manager",
        canHandover: canOperate,
      },
      registers: registers.map((register) => ({
        ...register,
        openShiftId: openShiftByRegister.get(register.id) ?? null,
      })),
      availableTerminals: terminalViews,
      shifts: shifts.map((shift) => ({
        id: shift.id,
        cashRegisterId: shift.cashRegisterId,
        cashRegisterName: registerNames.get(shift.cashRegisterId) ?? "Gaveta",
        status: shift.status,
        currentResponsibleIdentityId: shift.currentResponsibleIdentityId,
        responsibleName: names.get(shift.currentResponsibleIdentityId) ?? "Usuário",
        openingCents: shift.openingCents,
        expectedCents:
          shift.status !== "open"
            ? shift.expectedCents
            : role === "cashier"
              ? null
              : shift.openingCents +
                (drawerByShift.get(shift.id)?.drawerInCents ?? 0) -
                (drawerByShift.get(shift.id)?.drawerOutCents ?? 0),
        countedCents: shift.countedCents,
        differenceCents: shift.differenceCents,
        openedAt: shift.openedAt,
        closedAt: shift.closedAt,
        closeReason: shift.closeReason,
        reviewedAt: shift.reviewedAt,
        reviewNote: shift.reviewNote,
        tenderBreakdown: (tenderByShift.get(shift.id) ?? []).map((tender) => ({
          method: tender.method,
          expectedCents: tender.expectedCents,
          observedCents: tender.observedCents,
          differenceCents: tender.differenceCents,
          source: tender.source,
        })),
        differenceSeverity: cashDifferenceSeverity(
          tenderByShift.get(shift.id) ?? [],
          settings.discrepancyCriticalThresholdCents,
        ),
        operatorName: names.get(shift.operatorIdentityId) ?? "Usuário",
        closedByName: shift.closedByIdentityId
          ? (names.get(shift.closedByIdentityId) ?? "Usuário")
          : null,
        reviewedByName: shift.reviewedByIdentityId
          ? (names.get(shift.reviewedByIdentityId) ?? "Usuário")
          : null,
      })),
      entries: entries.map((entry) => ({
        id: entry.id,
        cashShiftId: entry.cashShiftId,
        direction: entry.direction,
        entryType: entry.entryType,
        paymentMethod: entry.paymentMethod,
        affectsDrawer: entry.affectsDrawer,
        amountCents: entry.amountCents,
        description: entry.description,
        actorName: names.get(entry.actorIdentityId) ?? "Usuário",
        occurredAt: entry.occurredAt,
      })),
      approvals: approvals.map((approval) => ({
        id: approval.id,
        kind: approval.kind,
        fromCashShiftId: approval.cashShiftId,
        toCashShiftId: approval.targetCashShiftId,
        amountCents: approval.amountCents,
        reason: approval.reason,
        requestedByName: names.get(approval.requestedByIdentityId) ?? "Usuário",
        status: approval.status,
        requestedAt: approval.createdAt,
      })),
      adjustments: adjustments.map((adjustment) => ({
        id: adjustment.id,
        cashRegisterId: adjustment.cashRegisterId,
        originalCashShiftId: adjustment.originalCashShiftId,
        direction: adjustment.direction,
        entryType: adjustment.entryType,
        paymentMethod: adjustment.paymentMethod,
        affectsDrawer: adjustment.affectsDrawer,
        amountCents: adjustment.amountCents,
        description: adjustment.description,
        actorName: names.get(adjustment.actorIdentityId) ?? "Usuário",
        occurredAt: adjustment.occurredAt,
      })),
      pendingTabs,
    };
  }

  async cashShiftHistory(
    identityId: string,
    organizationId: string,
    unitId: string,
    query: CashShiftHistoryQuery,
  ) {
    const role = await this.requireRole(identityId, organizationId, unitId, CASH_READ_ROLES);
    const offset = reportPageOffset(query.cursor);
    const [unit] = await this.database.db
      .select({ timezone: units.timezone })
      .from(units)
      .where(and(eq(units.organizationId, organizationId), eq(units.id, unitId)))
      .limit(1);
    if (!unit) throw new NotFoundException({ code: "UNIT_NOT_FOUND" });
    const openedLocalDate = sql<string>`timezone(${unit.timezone}, ${managementCashShifts.openedAt})::date`;
    const filters = [
      eq(managementCashShifts.organizationId, organizationId),
      eq(managementCashShifts.unitId, unitId),
      query.from ? gte(openedLocalDate, query.from) : undefined,
      query.to ? lte(openedLocalDate, query.to) : undefined,
      query.cashRegisterId
        ? eq(managementCashShifts.cashRegisterId, query.cashRegisterId)
        : undefined,
      query.operatorIdentityId
        ? or(
            eq(managementCashShifts.operatorIdentityId, query.operatorIdentityId),
            eq(managementCashShifts.currentResponsibleIdentityId, query.operatorIdentityId),
          )
        : undefined,
      query.status ? eq(managementCashShifts.status, query.status) : undefined,
    ];
    const rows = await this.database.db
      .select()
      .from(managementCashShifts)
      .where(and(...filters))
      .orderBy(desc(managementCashShifts.openedAt), desc(managementCashShifts.id))
      .offset(offset)
      .limit(query.limit + 1);
    const page = rows.slice(0, query.limit);
    const shiftIds = page.map((shift) => shift.id);
    const registerIds = [...new Set(page.map((shift) => shift.cashRegisterId))];
    const identityIds = [
      ...new Set(
        page.flatMap((shift) => [
          shift.operatorIdentityId,
          shift.currentResponsibleIdentityId,
          shift.closedByIdentityId,
          shift.reviewedByIdentityId,
        ]),
      ),
    ].filter((value): value is string => value !== null);
    const [registers, identityRows, tenders, drawerRows] = await Promise.all([
      registerIds.length === 0
        ? []
        : this.database.db
            .select({ id: managementCashRegisters.id, name: managementCashRegisters.name })
            .from(managementCashRegisters)
            .where(inArray(managementCashRegisters.id, registerIds)),
      identityIds.length === 0
        ? []
        : this.database.db
            .select({ id: identities.id, name: identities.displayName })
            .from(identities)
            .where(inArray(identities.id, identityIds)),
      shiftIds.length === 0
        ? []
        : this.database.db
            .select()
            .from(managementCashShiftTenderCounts)
            .where(
              and(
                eq(managementCashShiftTenderCounts.organizationId, organizationId),
                eq(managementCashShiftTenderCounts.unitId, unitId),
                inArray(managementCashShiftTenderCounts.cashShiftId, shiftIds),
              ),
            ),
      shiftIds.length === 0
        ? []
        : this.database.db
            .select({
              cashShiftId: managementCashEntries.cashShiftId,
              drawerInCents: sql<number>`coalesce(sum(case when ${managementCashEntries.affectsDrawer} and ${managementCashEntries.direction} = 'in' then ${managementCashEntries.amountCents} else 0 end), 0)::integer`,
              drawerOutCents: sql<number>`coalesce(sum(case when ${managementCashEntries.affectsDrawer} and ${managementCashEntries.direction} = 'out' then ${managementCashEntries.amountCents} else 0 end), 0)::integer`,
            })
            .from(managementCashEntries)
            .where(inArray(managementCashEntries.cashShiftId, shiftIds))
            .groupBy(managementCashEntries.cashShiftId),
    ]);
    const names = new Map(identityRows.map((identity) => [identity.id, identity.name]));
    const registerNames = new Map(registers.map((register) => [register.id, register.name]));
    const tenderByShift = new Map<string, typeof tenders>();
    for (const tender of tenders)
      tenderByShift.set(tender.cashShiftId, [
        ...(tenderByShift.get(tender.cashShiftId) ?? []),
        tender,
      ]);
    const drawerByShift = new Map(
      drawerRows.map((drawer) => [
        drawer.cashShiftId,
        {
          drawerInCents: Number(drawer.drawerInCents),
          drawerOutCents: Number(drawer.drawerOutCents),
        },
      ]),
    );
    const settings = await this.cashSettings(this.database.db, organizationId, unitId);
    const items = page.map((shift) => {
      const canViewExpected = shift.status !== "open" || role !== "cashier";
      const liveExpected =
        shift.openingCents +
        (drawerByShift.get(shift.id)?.drawerInCents ?? 0) -
        (drawerByShift.get(shift.id)?.drawerOutCents ?? 0);
      const tenderBreakdown = (tenderByShift.get(shift.id) ?? []).map((tender) => ({
        method: tender.method,
        expectedCents: canViewExpected ? tender.expectedCents : null,
        observedCents: tender.observedCents,
        differenceCents: canViewExpected ? tender.differenceCents : null,
        source: tender.source,
      }));
      return {
        id: shift.id,
        cashRegisterId: shift.cashRegisterId,
        cashRegisterName: registerNames.get(shift.cashRegisterId) ?? "Gaveta",
        status: shift.status,
        openingCents: shift.openingCents,
        expectedCents: canViewExpected
          ? shift.status === "open"
            ? liveExpected
            : shift.expectedCents
          : null,
        countedCents: shift.countedCents,
        differenceCents: canViewExpected ? shift.differenceCents : null,
        openedAt: shift.openedAt,
        closedAt: shift.closedAt,
        currentResponsibleIdentityId: shift.currentResponsibleIdentityId,
        operatorName: names.get(shift.operatorIdentityId) ?? "Usuário",
        responsibleName: names.get(shift.currentResponsibleIdentityId) ?? "Usuário",
        closedByName: shift.closedByIdentityId
          ? (names.get(shift.closedByIdentityId) ?? "Usuário")
          : null,
        reviewedByName: shift.reviewedByIdentityId
          ? (names.get(shift.reviewedByIdentityId) ?? "Usuário")
          : null,
        tenderBreakdown,
        differenceSeverity: cashDifferenceSeverity(
          tenderByShift.get(shift.id) ?? [],
          settings.discrepancyCriticalThresholdCents,
        ),
      };
    });
    return {
      items,
      nextCursor: reportNextCursor(offset, items.length, rows.length > query.limit),
    };
  }

  async cashShiftDetail(
    identityId: string,
    organizationId: string,
    unitId: string,
    cashShiftId: string,
  ) {
    const role = await this.requireRole(identityId, organizationId, unitId, CASH_READ_ROLES);
    const [shift] = await this.database.db
      .select()
      .from(managementCashShifts)
      .where(
        and(
          eq(managementCashShifts.organizationId, organizationId),
          eq(managementCashShifts.unitId, unitId),
          eq(managementCashShifts.id, cashShiftId),
        ),
      )
      .limit(1);
    if (!shift)
      throw new NotFoundException({
        code: "CASH_SHIFT_NOT_FOUND",
        message: "Caixa não encontrado nesta unidade.",
      });
    const [entries, tenderCounts, responsibilities, adjustments, register] = await Promise.all([
      this.database.db
        .select()
        .from(managementCashEntries)
        .where(
          and(
            eq(managementCashEntries.organizationId, organizationId),
            eq(managementCashEntries.unitId, unitId),
            eq(managementCashEntries.cashShiftId, cashShiftId),
          ),
        )
        .orderBy(asc(managementCashEntries.occurredAt)),
      this.database.db
        .select()
        .from(managementCashShiftTenderCounts)
        .where(
          and(
            eq(managementCashShiftTenderCounts.organizationId, organizationId),
            eq(managementCashShiftTenderCounts.unitId, unitId),
            eq(managementCashShiftTenderCounts.cashShiftId, cashShiftId),
          ),
        ),
      this.database.db
        .select()
        .from(managementCashShiftResponsibilities)
        .where(
          and(
            eq(managementCashShiftResponsibilities.organizationId, organizationId),
            eq(managementCashShiftResponsibilities.unitId, unitId),
            eq(managementCashShiftResponsibilities.cashShiftId, cashShiftId),
          ),
        )
        .orderBy(asc(managementCashShiftResponsibilities.occurredAt)),
      this.database.db
        .select()
        .from(managementCashAdjustments)
        .where(
          and(
            eq(managementCashAdjustments.organizationId, organizationId),
            eq(managementCashAdjustments.unitId, unitId),
            eq(managementCashAdjustments.originalCashShiftId, cashShiftId),
          ),
        )
        .orderBy(asc(managementCashAdjustments.occurredAt)),
      this.database.db
        .select({ name: managementCashRegisters.name })
        .from(managementCashRegisters)
        .where(eq(managementCashRegisters.id, shift.cashRegisterId))
        .limit(1)
        .then((rows) => rows[0]),
    ]);
    const identityIds = [
      shift.operatorIdentityId,
      shift.currentResponsibleIdentityId,
      shift.closedByIdentityId,
      shift.reviewedByIdentityId,
      ...entries.map((entry) => entry.actorIdentityId),
      ...responsibilities.flatMap((responsibility) => [
        responsibility.fromIdentityId,
        responsibility.toIdentityId,
        responsibility.transferredByIdentityId,
      ]),
      ...adjustments.map((adjustment) => adjustment.actorIdentityId),
    ].filter((value): value is string => value !== null);
    const identityRows = await this.database.db
      .select({ id: identities.id, name: identities.displayName })
      .from(identities)
      .where(inArray(identities.id, [...new Set(identityIds)]));
    const names = new Map(identityRows.map((identity) => [identity.id, identity.name]));
    const canViewExpected = shift.status !== "open" || role !== "cashier";
    const drawer = await this.cashDrawerTotals(
      this.database.db,
      organizationId,
      unitId,
      cashShiftId,
    );
    const settings = await this.cashSettings(this.database.db, organizationId, unitId);
    return {
      shift: {
        id: shift.id,
        cashRegisterId: shift.cashRegisterId,
        cashRegisterName: register?.name ?? "Gaveta",
        status: shift.status,
        openingCents: shift.openingCents,
        expectedCents: canViewExpected
          ? shift.status === "open"
            ? shift.openingCents + drawer.drawerInCents - drawer.drawerOutCents
            : shift.expectedCents
          : null,
        countedCents: shift.countedCents,
        differenceCents: canViewExpected ? shift.differenceCents : null,
        openedAt: shift.openedAt,
        closedAt: shift.closedAt,
        currentResponsibleIdentityId: shift.currentResponsibleIdentityId,
        operatorName: names.get(shift.operatorIdentityId) ?? "Usuário",
        responsibleName: names.get(shift.currentResponsibleIdentityId) ?? "Usuário",
        closedByName: shift.closedByIdentityId
          ? (names.get(shift.closedByIdentityId) ?? "Usuário")
          : null,
        reviewedByName: shift.reviewedByIdentityId
          ? (names.get(shift.reviewedByIdentityId) ?? "Usuário")
          : null,
        differenceSeverity: cashDifferenceSeverity(
          tenderCounts,
          settings.discrepancyCriticalThresholdCents,
        ),
      },
      entries: entries.map((entry) => ({
        id: entry.id,
        cashShiftId: entry.cashShiftId,
        direction: entry.direction,
        entryType: entry.entryType,
        paymentMethod: entry.paymentMethod,
        affectsDrawer: entry.affectsDrawer,
        amountCents: entry.amountCents,
        description: entry.description,
        actorName: names.get(entry.actorIdentityId) ?? "Usuário",
        occurredAt: entry.occurredAt,
      })),
      tenderCounts: tenderCounts.map((tender) => ({
        method: tender.method,
        expectedCents: canViewExpected ? tender.expectedCents : null,
        observedCents: tender.observedCents,
        differenceCents: canViewExpected ? tender.differenceCents : null,
        source: tender.source,
      })),
      responsibilities: responsibilities.map((responsibility) => ({
        id: responsibility.id,
        fromName: names.get(responsibility.fromIdentityId) ?? "Usuário",
        toName: names.get(responsibility.toIdentityId) ?? "Usuário",
        transferredByName: names.get(responsibility.transferredByIdentityId) ?? "Usuário",
        reason: responsibility.reason,
        occurredAt: responsibility.occurredAt,
      })),
      adjustments: adjustments.map((adjustment) => ({
        id: adjustment.id,
        cashRegisterId: adjustment.cashRegisterId,
        originalCashShiftId: adjustment.originalCashShiftId,
        direction: adjustment.direction,
        entryType: adjustment.entryType,
        paymentMethod: adjustment.paymentMethod,
        affectsDrawer: adjustment.affectsDrawer,
        amountCents: adjustment.amountCents,
        description: adjustment.description,
        actorName: names.get(adjustment.actorIdentityId) ?? "Usuário",
        occurredAt: adjustment.occurredAt,
      })),
    };
  }

  async exportCashShifts(
    identityId: string,
    organizationId: string,
    unitId: string,
    query: CashShiftExportQuery,
  ) {
    let cursor: string | undefined;
    const items: Record<string, unknown>[] = [];
    do {
      const page = await this.cashShiftHistory(identityId, organizationId, unitId, {
        cursor,
        limit: 100,
        from: query.from,
        to: query.to,
        cashRegisterId: query.cashRegisterId,
        operatorIdentityId: query.operatorIdentityId,
        status: query.status,
      });
      items.push(
        ...page.items.map((shift) => ({
          caixa: shift.cashRegisterName,
          status: shift.status,
          operador: shift.operatorName,
          responsavel: shift.responsibleName,
          abertura: shift.openedAt.toISOString(),
          fechamento: shift.closedAt?.toISOString() ?? "",
          fundo_centavos: shift.openingCents,
          esperado_centavos: shift.expectedCents,
          contado_centavos: shift.countedCents,
          diferenca_centavos: shift.differenceCents,
          severidade: shift.differenceSeverity,
        })),
      );
      cursor = page.nextCursor ?? undefined;
    } while (cursor && items.length < 10_000);
    const artifact = buildReportArtifact(query.format, items, "Histórico de contas e caixa");
    return {
      filename: `historico-caixa-${new Date().toISOString().slice(0, 10)}.${artifact.extension}`,
      content: artifact.content,
      contentEncoding: artifact.contentEncoding,
      mimeType: artifact.mimeType,
      sha256: artifact.sha256,
    };
  }

  async importReconciliation(
    identityId: string,
    organizationId: string,
    unitId: string,
    idempotencyKey: string,
    input: ReconciliationInput,
  ) {
    await this.requireRole(identityId, organizationId, unitId, FINANCE_ROLES);
    const uniqueKeys = new Set(input.entries.map((entry) => entry.externalKey));
    if (uniqueKeys.size !== input.entries.length) {
      throw new BadRequestException({
        code: "DUPLICATE_RECONCILIATION_KEY",
        message: "Cada chave externa deve aparecer uma única vez no lote.",
      });
    }
    return this.idempotent(
      identityId,
      organizationId,
      unitId,
      idempotencyKey,
      "reconciliation-import",
      input,
      async (tx) => {
        for (const entry of input.entries) {
          if ((entry.status === "matched" || entry.status === "resolved") && !entry.paymentId) {
            throw new BadRequestException({
              code: "RECONCILIATION_PAYMENT_REQUIRED",
              message: "Entradas conciliadas ou resolvidas devem referenciar um pagamento interno.",
            });
          }
          if (!entry.paymentId) continue;
          const table =
            entry.paymentDirection === "payable"
              ? managementPayablePayments
              : managementReceivablePayments;
          const [payment] = await tx
            .select({ id: table.id })
            .from(table)
            .where(
              and(
                eq(table.organizationId, organizationId),
                eq(table.unitId, unitId),
                eq(table.id, entry.paymentId),
              ),
            )
            .limit(1);
          if (!payment) {
            throw new NotFoundException({
              code: "RECONCILIATION_PAYMENT_NOT_FOUND",
              message: "Pagamento interno não encontrado nesta unidade.",
            });
          }
        }
        const importId = randomUUID();
        await tx.insert(managementReconciliationImports).values({
          id: importId,
          organizationId,
          unitId,
          source: input.source,
          fileHash: input.fileHash,
          idempotencyKey,
          importedByIdentityId: identityId,
        });
        await tx.insert(managementReconciliationEntries).values(
          input.entries.map((entry) => ({
            organizationId,
            unitId,
            importId,
            ...entry,
            resolvedByIdentityId: entry.status === "resolved" ? identityId : undefined,
            resolvedAt: entry.status === "resolved" ? new Date() : undefined,
          })),
        );
        await this.record(
          tx,
          identityId,
          organizationId,
          unitId,
          "management.reconciliation.imported",
          "reconciliation_import",
          importId,
          { source: input.source, entryCount: input.entries.length, providerConnected: false },
        );
        return {
          importId,
          source: input.source,
          entryCount: input.entries.length,
          providerConnected: false,
        };
      },
    );
  }

  async reports(
    identityId: string,
    organizationId: string,
    unitId: string,
    period: ReportPeriodInput & {
      family?: string;
      minimumComparableOperatingDays?: number;
    },
  ) {
    const reportRole = await this.requireRole(identityId, organizationId, unitId, FINANCE_ROLES);
    const [unit] = await this.database.db
      .select({ timezone: units.timezone })
      .from(units)
      .where(and(eq(units.organizationId, organizationId), eq(units.id, unitId)))
      .limit(1);
    if (!unit) throw new NotFoundException({ code: "UNIT_NOT_FOUND" });

    const { previousPeriod } = reportPeriodContext(period, period.comparisonMode);
    const comparisonFrom = previousPeriod?.from ?? period.from;
    const payablePaymentDate = sql<string>`timezone(${unit.timezone}, ${managementPayablePayments.paidAt})::date`;
    const receivablePaymentDate = sql<string>`timezone(${unit.timezone}, ${managementReceivablePayments.receivedAt})::date`;
    const closedDate = sql<string>`timezone(${unit.timezone}, ${posTabs.closedAt})::date`;
    const reversalDate = sql<string>`timezone(${unit.timezone}, ${posPaymentReversals.resolvedAt})::date`;
    const inventoryEventDate = sql<string>`timezone(${unit.timezone}, ${managementInventoryEvents.occurredAt})::date`;
    const purchaseCreatedDate = sql<string>`timezone(${unit.timezone}, ${managementPurchaseOrders.createdAt})::date`;
    const receiptReceivedDate = sql<string>`timezone(${unit.timezone}, ${managementPurchaseReceipts.receivedAt})::date`;
    const [
      payablePayments,
      receivablePayments,
      payables,
      receivables,
      dailyChannelSales,
      productSales,
      grossPaymentMethods,
      paymentReversalMethods,
      tabMetricsRows,
      exceptionMetricsRows,
      cancellationReasons,
      inventoryLossRows,
      inventoryBalanceRows,
      purchaseOrderRows,
      purchaseReceiptRows,
    ] = await Promise.all([
      this.database.db
        .select({
          ...getTableColumns(managementPayablePayments),
          localDate: payablePaymentDate.mapWith(String),
        })
        .from(managementPayablePayments)
        .where(
          and(
            eq(managementPayablePayments.organizationId, organizationId),
            eq(managementPayablePayments.unitId, unitId),
            gte(payablePaymentDate, period.from),
            lte(payablePaymentDate, period.to),
          ),
        ),
      this.database.db
        .select({
          ...getTableColumns(managementReceivablePayments),
          localDate: receivablePaymentDate.mapWith(String),
        })
        .from(managementReceivablePayments)
        .where(
          and(
            eq(managementReceivablePayments.organizationId, organizationId),
            eq(managementReceivablePayments.unitId, unitId),
            gte(receivablePaymentDate, period.from),
            lte(receivablePaymentDate, period.to),
          ),
        ),
      this.database.db
        .select()
        .from(managementAccountsPayable)
        .where(
          and(
            eq(managementAccountsPayable.organizationId, organizationId),
            eq(managementAccountsPayable.unitId, unitId),
            gte(managementAccountsPayable.competenceDate, period.from),
            lte(managementAccountsPayable.competenceDate, period.to),
            isNull(managementAccountsPayable.purchaseReceiptId),
          ),
        ),
      this.database.db
        .select()
        .from(managementAccountsReceivable)
        .where(
          and(
            eq(managementAccountsReceivable.organizationId, organizationId),
            eq(managementAccountsReceivable.unitId, unitId),
            gte(managementAccountsReceivable.competenceDate, period.from),
            lte(managementAccountsReceivable.competenceDate, period.to),
          ),
        ),
      this.database.db
        .select({
          date: closedDate.mapWith(String),
          channel: posTabs.fulfillmentType,
          quantity: sql<number>`count(*)::int`.mapWith(Number),
          revenueCents: sql<number>`coalesce(sum(${posTabs.totalCents}), 0)`.mapWith(Number),
        })
        .from(posTabs)
        .where(
          and(
            eq(posTabs.organizationId, organizationId),
            eq(posTabs.unitId, unitId),
            eq(posTabs.status, "closed"),
            gte(closedDate, comparisonFrom),
            lte(closedDate, period.to),
          ),
        )
        // PostgreSQL treats repeated parameterized timezone expressions as distinct
        // ($1 in SELECT, $9 in GROUP BY). Grouping by the projected column avoids
        // that mismatch while keeping the timezone value parameterized.
        .groupBy(sql.raw("1"), posTabs.fulfillmentType)
        .orderBy(sql.raw("1"), posTabs.fulfillmentType),
      this.database.db
        .select({
          productId: posProducts.id,
          productName: posProducts.name,
          categoryId: posCatalogCategories.id,
          categoryName: posCatalogCategories.name,
          quantity: sql<number>`coalesce(sum(${posOrderItems.quantity}), 0)::int`.mapWith(Number),
          revenueCents: sql<number>`coalesce(sum(${posOrderItems.netCents}), 0)`.mapWith(Number),
          costCents:
            sql<number>`coalesce(sum(${posOrderItems.costCents}) filter (where ${posOrderItems.costCents} is not null), 0)`.mapWith(
              Number,
            ),
          missingCostItems:
            sql<number>`count(*) filter (where ${posOrderItems.costCents} is null)::int`.mapWith(
              Number,
            ),
        })
        .from(posOrderItems)
        .innerJoin(
          posOrders,
          and(
            eq(posOrders.organizationId, posOrderItems.organizationId),
            eq(posOrders.unitId, posOrderItems.unitId),
            eq(posOrders.id, posOrderItems.orderId),
          ),
        )
        .innerJoin(
          posTabs,
          and(
            eq(posTabs.organizationId, posOrders.organizationId),
            eq(posTabs.unitId, posOrders.unitId),
            eq(posTabs.id, posOrders.tabId),
          ),
        )
        .innerJoin(
          posProducts,
          and(
            eq(posProducts.organizationId, posOrderItems.organizationId),
            eq(posProducts.id, posOrderItems.productId),
          ),
        )
        .innerJoin(
          posCatalogCategories,
          and(
            eq(posCatalogCategories.organizationId, posProducts.organizationId),
            eq(posCatalogCategories.id, posProducts.categoryId),
          ),
        )
        .where(
          and(
            eq(posOrderItems.organizationId, organizationId),
            eq(posOrderItems.unitId, unitId),
            eq(posTabs.status, "closed"),
            ne(posOrderItems.status, "canceled"),
            gte(closedDate, period.from),
            lte(closedDate, period.to),
          ),
        )
        .groupBy(
          posProducts.id,
          posProducts.name,
          posCatalogCategories.id,
          posCatalogCategories.name,
        )
        .orderBy(desc(sql`sum(${posOrderItems.netCents})`), posProducts.name),
      this.database.db
        .select({
          method: posTabPayments.method,
          quantity: sql<number>`count(*)::int`.mapWith(Number),
          revenueCents: sql<number>`coalesce(sum(${posTabPayments.amountCents}), 0)`.mapWith(
            Number,
          ),
        })
        .from(posTabPayments)
        .innerJoin(
          posTabs,
          and(
            eq(posTabs.organizationId, posTabPayments.organizationId),
            eq(posTabs.unitId, posTabPayments.unitId),
            eq(posTabs.id, posTabPayments.tabId),
          ),
        )
        .where(
          and(
            eq(posTabPayments.organizationId, organizationId),
            eq(posTabPayments.unitId, unitId),
            eq(posTabs.status, "closed"),
            gte(closedDate, period.from),
            lte(closedDate, period.to),
          ),
        )
        .groupBy(posTabPayments.method)
        .orderBy(posTabPayments.method),
      this.database.db
        .select({
          method: posTabPayments.method,
          reversedCents: sql<number>`coalesce(sum(${posPaymentReversals.amountCents}), 0)`.mapWith(
            Number,
          ),
        })
        .from(posPaymentReversals)
        .innerJoin(
          posTabPayments,
          and(
            eq(posTabPayments.organizationId, posPaymentReversals.organizationId),
            eq(posTabPayments.unitId, posPaymentReversals.unitId),
            eq(posTabPayments.id, posPaymentReversals.paymentId),
          ),
        )
        .where(
          and(
            eq(posPaymentReversals.organizationId, organizationId),
            eq(posPaymentReversals.unitId, unitId),
            eq(posPaymentReversals.status, "approved"),
            gte(reversalDate, period.from),
            lte(reversalDate, period.to),
          ),
        )
        .groupBy(posTabPayments.method)
        .orderBy(posTabPayments.method),
      this.database.db
        .select({
          closedTabs: sql<number>`count(*)::int`.mapWith(Number),
          dineInTabs:
            sql<number>`count(*) filter (where ${posTabs.fulfillmentType} = 'dine_in')::int`.mapWith(
              Number,
            ),
          tableTurnovers:
            sql<number>`count(*) filter (where ${posTabs.fulfillmentType} = 'dine_in' and ${posTabs.tableId} is not null)::int`.mapWith(
              Number,
            ),
          guests: sql<number>`coalesce(sum(${posTabs.guestCount}), 0)::int`.mapWith(Number),
          subtotalCents: sql<number>`coalesce(sum(${posTabs.subtotalCents}), 0)`.mapWith(Number),
          discountCents: sql<number>`coalesce(sum(${posTabs.discountCents}), 0)`.mapWith(Number),
          netRevenueCents: sql<number>`coalesce(sum(${posTabs.totalCents}), 0)`.mapWith(Number),
          averageServiceMinutes: sql<
            number | null
          >`avg(extract(epoch from (${posTabs.closedAt} - ${posTabs.createdAt})) / 60.0)`,
        })
        .from(posTabs)
        .where(
          and(
            eq(posTabs.organizationId, organizationId),
            eq(posTabs.unitId, unitId),
            eq(posTabs.status, "closed"),
            gte(closedDate, period.from),
            lte(closedDate, period.to),
          ),
        ),
      this.database.db
        .select({
          canceledItems:
            sql<number>`coalesce(sum(${posOrderItems.quantity}) filter (where ${posOrderItems.status} = 'canceled'), 0)::int`.mapWith(
              Number,
            ),
          canceledValueCents:
            sql<number>`coalesce(sum(${posOrderItems.netCents}) filter (where ${posOrderItems.status} = 'canceled'), 0)`.mapWith(
              Number,
            ),
          discountedItems:
            sql<number>`coalesce(sum(${posOrderItems.quantity}) filter (where ${posOrderItems.discountCents} > 0 and ${posOrderItems.status} <> 'canceled'), 0)::int`.mapWith(
              Number,
            ),
          itemDiscountCents:
            sql<number>`coalesce(sum(${posOrderItems.discountCents}) filter (where ${posOrderItems.status} <> 'canceled'), 0)`.mapWith(
              Number,
            ),
        })
        .from(posOrderItems)
        .innerJoin(
          posOrders,
          and(
            eq(posOrders.organizationId, posOrderItems.organizationId),
            eq(posOrders.unitId, posOrderItems.unitId),
            eq(posOrders.id, posOrderItems.orderId),
          ),
        )
        .innerJoin(
          posTabs,
          and(
            eq(posTabs.organizationId, posOrders.organizationId),
            eq(posTabs.unitId, posOrders.unitId),
            eq(posTabs.id, posOrders.tabId),
          ),
        )
        .where(
          and(
            eq(posOrderItems.organizationId, organizationId),
            eq(posOrderItems.unitId, unitId),
            eq(posTabs.status, "closed"),
            gte(closedDate, period.from),
            lte(closedDate, period.to),
          ),
        ),
      this.database.db
        .select({
          label:
            sql<string>`coalesce(nullif(trim(${posOrderItems.canceledReason}), ''), 'Sem motivo informado')`.mapWith(
              String,
            ),
          quantity: sql<number>`coalesce(sum(${posOrderItems.quantity}), 0)::int`.mapWith(Number),
          amountCents: sql<number>`coalesce(sum(${posOrderItems.netCents}), 0)`.mapWith(Number),
        })
        .from(posOrderItems)
        .innerJoin(
          posOrders,
          and(
            eq(posOrders.organizationId, posOrderItems.organizationId),
            eq(posOrders.unitId, posOrderItems.unitId),
            eq(posOrders.id, posOrderItems.orderId),
          ),
        )
        .innerJoin(
          posTabs,
          and(
            eq(posTabs.organizationId, posOrders.organizationId),
            eq(posTabs.unitId, posOrders.unitId),
            eq(posTabs.id, posOrders.tabId),
          ),
        )
        .where(
          and(
            eq(posOrderItems.organizationId, organizationId),
            eq(posOrderItems.unitId, unitId),
            eq(posOrderItems.status, "canceled"),
            eq(posTabs.status, "closed"),
            gte(closedDate, period.from),
            lte(closedDate, period.to),
          ),
        )
        .groupBy(sql.raw("1"))
        .orderBy(desc(sql`sum(${posOrderItems.netCents})`)),
      this.database.db
        .select({
          lossEvents: sql<number>`count(distinct ${managementInventoryEvents.id})::int`.mapWith(
            Number,
          ),
          lossQuantity:
            sql<number>`coalesce(sum(abs(${managementInventoryEventLines.quantityDelta}::numeric)), 0)::double precision`.mapWith(
              Number,
            ),
        })
        .from(managementInventoryEvents)
        .innerJoin(
          managementInventoryEventLines,
          and(
            eq(
              managementInventoryEventLines.organizationId,
              managementInventoryEvents.organizationId,
            ),
            eq(managementInventoryEventLines.unitId, managementInventoryEvents.unitId),
            eq(managementInventoryEventLines.eventId, managementInventoryEvents.id),
          ),
        )
        .where(
          and(
            eq(managementInventoryEvents.organizationId, organizationId),
            eq(managementInventoryEvents.unitId, unitId),
            eq(managementInventoryEvents.type, "loss"),
            gte(inventoryEventDate, period.from),
            lte(inventoryEventDate, period.to),
          ),
        ),
      this.database.db
        .select({
          itemId: managementInventoryItems.id,
          minimumQuantity: managementInventoryItems.minimumQuantity,
          quantity:
            sql<number>`coalesce(sum(${managementStockBalances.quantity}::numeric), 0)::double precision`.mapWith(
              Number,
            ),
          valueCents:
            sql<number>`coalesce(round(sum(${managementStockBalances.quantity}::numeric * coalesce(${managementStockBalances.averageCostCents}, 0))), 0)::int`.mapWith(
              Number,
            ),
          missingCostBalances:
            sql<number>`count(*) filter (where ${managementStockBalances.quantity}::numeric > 0 and ${managementStockBalances.averageCostCents} is null)::int`.mapWith(
              Number,
            ),
        })
        .from(managementInventoryItems)
        .leftJoin(
          managementStockBalances,
          and(
            eq(managementStockBalances.organizationId, managementInventoryItems.organizationId),
            eq(managementStockBalances.unitId, managementInventoryItems.unitId),
            eq(managementStockBalances.inventoryItemId, managementInventoryItems.id),
          ),
        )
        .where(
          and(
            eq(managementInventoryItems.organizationId, organizationId),
            eq(managementInventoryItems.unitId, unitId),
            eq(managementInventoryItems.active, true),
          ),
        )
        .groupBy(managementInventoryItems.id, managementInventoryItems.minimumQuantity),
      this.database.db
        .select({
          supplierId: managementSuppliers.id,
          supplierName: managementSuppliers.name,
          orderCount: sql<number>`count(*)::int`.mapWith(Number),
          orderedCents:
            sql<number>`coalesce(sum(${managementPurchaseOrders.totalCents}), 0)`.mapWith(Number),
          canceledOrders:
            sql<number>`count(*) filter (where ${managementPurchaseOrders.status} = 'canceled')::int`.mapWith(
              Number,
            ),
        })
        .from(managementPurchaseOrders)
        .innerJoin(
          managementSuppliers,
          and(
            eq(managementSuppliers.organizationId, managementPurchaseOrders.organizationId),
            eq(managementSuppliers.unitId, managementPurchaseOrders.unitId),
            eq(managementSuppliers.id, managementPurchaseOrders.supplierId),
          ),
        )
        .where(
          and(
            eq(managementPurchaseOrders.organizationId, organizationId),
            eq(managementPurchaseOrders.unitId, unitId),
            gte(purchaseCreatedDate, period.from),
            lte(purchaseCreatedDate, period.to),
          ),
        )
        .groupBy(managementSuppliers.id, managementSuppliers.name),
      this.database.db
        .select({
          supplierId: managementSuppliers.id,
          supplierName: managementSuppliers.name,
          receiptCount: sql<number>`count(*)::int`.mapWith(Number),
          receivedCents:
            sql<number>`coalesce(sum(${managementPurchaseReceipts.totalCents}), 0)`.mapWith(Number),
        })
        .from(managementPurchaseReceipts)
        .innerJoin(
          managementSuppliers,
          and(
            eq(managementSuppliers.organizationId, managementPurchaseReceipts.organizationId),
            eq(managementSuppliers.unitId, managementPurchaseReceipts.unitId),
            eq(managementSuppliers.id, managementPurchaseReceipts.supplierId),
          ),
        )
        .where(
          and(
            eq(managementPurchaseReceipts.organizationId, organizationId),
            eq(managementPurchaseReceipts.unitId, unitId),
            eq(managementPurchaseReceipts.status, "posted"),
            gte(receiptReceivedDate, period.from),
            lte(receiptReceivedDate, period.to),
          ),
        )
        .groupBy(managementSuppliers.id, managementSuppliers.name),
    ]);
    type HistoricalMetricRow = {
      periodKey: "current" | "previous";
      closedTabs: number;
      revenueCents: number;
      tableTurnovers: number;
      averageServiceMinutes: number | null;
      canceledValueCents: number;
      itemDiscountCents: number;
      lossQuantity: number;
      lossValueCents: number | null;
      orderedCents: number;
      receivedCents: number;
      productCostCents: number | null;
    };
    type HourlySaleRow = { hour: number; closedTabs: number; revenueCents: number };
    type ShiftRow = {
      key: string;
      label: string;
      closedTabs: number;
      guests: number;
      revenueCents: number;
      averageServiceMinutes: number | null;
    };
    type InventoryAnalysisRow = {
      key: string;
      label: string;
      consumedQuantity: number;
      consumedValueCents: number;
      missingCostMovements: number;
      currentQuantity: number;
    };
    type SupplierPerformanceRow = {
      key: string;
      label: string;
      orderCount: number;
      receiptCount: number;
      onTimeReceipts: number;
      timedReceipts: number;
      averageLeadDays: number | null;
      expectedLineCents: number;
      receivedLineCents: number;
    };
    type MultiunitRow = {
      key: string;
      label: string;
      closedTabs: number;
      revenueCents: number;
      previousRevenueCents: number;
      operatingDays: number;
      previousOperatingDays: number;
      seatCount: number;
      activeEmployees: number;
      openHours: number | null;
    };
    const periodsSql = previousPeriod
      ? sql`(values ('current', ${period.from}::date, ${period.to}::date), ('previous', ${previousPeriod.from}::date, ${previousPeriod.to}::date))`
      : sql`(values ('current', ${period.from}::date, ${period.to}::date))`;
    const [
      historicalMetrics,
      hourlySales,
      shiftRows,
      inventoryAnalysisRows,
      supplierPerformanceRows,
      multiunitRows,
    ] = await Promise.all([
      this.database.db.execute<HistoricalMetricRow>(sql`
        with periods(period_key, from_date, to_date) as ${periodsSql}
        select periods.period_key as "periodKey",
               coalesce(tabs.closed_tabs, 0)::int as "closedTabs",
               coalesce(tabs.revenue_cents, 0)::int as "revenueCents",
               coalesce(tabs.table_turnovers, 0)::int as "tableTurnovers",
               tabs.average_service_minutes::double precision as "averageServiceMinutes",
               coalesce(items.canceled_value_cents, 0)::int as "canceledValueCents",
               coalesce(items.item_discount_cents, 0)::int as "itemDiscountCents",
               coalesce(losses.loss_quantity, 0)::double precision as "lossQuantity",
               case when coalesce(losses.missing_costs, 0) = 0 then coalesce(losses.loss_value_cents, 0)::int end as "lossValueCents",
               coalesce(purchases.ordered_cents, 0)::int as "orderedCents",
               coalesce(receipts.received_cents, 0)::int as "receivedCents",
               case when coalesce(items.missing_costs, 0) = 0 then coalesce(items.product_cost_cents, 0)::int end as "productCostCents"
        from periods
        left join lateral (
          select count(*)::int as closed_tabs,
                 coalesce(sum(total_cents), 0)::bigint as revenue_cents,
                 count(*) filter (where fulfillment_type = 'dine_in' and table_id is not null)::int as table_turnovers,
                 avg(extract(epoch from (closed_at - created_at)) / 60.0) as average_service_minutes
          from pos_tabs
          where organization_id = ${organizationId}::uuid and unit_id = ${unitId}::uuid and status = 'closed'
            and timezone(${unit.timezone}, closed_at)::date between periods.from_date and periods.to_date
        ) tabs on true
        left join lateral (
          select coalesce(sum(order_items.net_cents) filter (where order_items.status = 'canceled'), 0)::bigint as canceled_value_cents,
                 coalesce(sum(order_items.discount_cents) filter (where order_items.status <> 'canceled'), 0)::bigint as item_discount_cents,
                 coalesce(sum(order_items.cost_cents) filter (where order_items.status <> 'canceled'), 0)::bigint as product_cost_cents,
                 count(*) filter (where order_items.status <> 'canceled' and order_items.cost_cents is null)::int as missing_costs
          from pos_order_items order_items
          inner join pos_orders orders on orders.organization_id = order_items.organization_id and orders.unit_id = order_items.unit_id and orders.id = order_items.order_id
          inner join pos_tabs report_tabs on report_tabs.organization_id = orders.organization_id and report_tabs.unit_id = orders.unit_id and report_tabs.id = orders.tab_id
          where order_items.organization_id = ${organizationId}::uuid and order_items.unit_id = ${unitId}::uuid and report_tabs.status = 'closed'
            and timezone(${unit.timezone}, report_tabs.closed_at)::date between periods.from_date and periods.to_date
        ) items on true
        left join lateral (
          select coalesce(sum(abs(quantity_delta::numeric)), 0) as loss_quantity,
                 coalesce(round(sum(abs(quantity_delta::numeric) * unit_cost_cents)), 0)::bigint as loss_value_cents,
                 count(*) filter (where unit_cost_cents is null)::int as missing_costs
          from management_inventory_movements
          where organization_id = ${organizationId}::uuid and unit_id = ${unitId}::uuid and type = 'loss'
            and timezone(${unit.timezone}, occurred_at)::date between periods.from_date and periods.to_date
        ) losses on true
        left join lateral (
          select coalesce(sum(total_cents), 0)::bigint as ordered_cents
          from management_purchase_orders
          where organization_id = ${organizationId}::uuid and unit_id = ${unitId}::uuid
            and timezone(${unit.timezone}, created_at)::date between periods.from_date and periods.to_date
        ) purchases on true
        left join lateral (
          select coalesce(sum(total_cents), 0)::bigint as received_cents
          from management_purchase_receipts
          where organization_id = ${organizationId}::uuid and unit_id = ${unitId}::uuid and status = 'posted'
            and timezone(${unit.timezone}, received_at)::date between periods.from_date and periods.to_date
        ) receipts on true
      `),
      !period.family || period.family === "overview" || period.family === "sales"
        ? this.database.db.execute<HourlySaleRow>(sql`
        select extract(hour from timezone(${unit.timezone}, closed_at))::int as hour,
               count(*)::int as "closedTabs", coalesce(sum(total_cents), 0)::int as "revenueCents"
        from pos_tabs
        where organization_id = ${organizationId}::uuid and unit_id = ${unitId}::uuid and status = 'closed'
          and timezone(${unit.timezone}, closed_at)::date between ${period.from}::date and ${period.to}::date
        group by 1 order by 1
      `)
        : Promise.resolve([] as HourlySaleRow[]),
      !period.family || period.family === "overview" || period.family === "operations"
        ? this.database.db.execute<ShiftRow>(sql`
        select coalesce(shifts.id::text, 'unassigned') as key,
               coalesce(shifts.label, 'Sem turno vinculado') as label,
               count(*)::int as "closedTabs", coalesce(sum(tabs.guest_count), 0)::int as guests,
               coalesce(sum(tabs.total_cents), 0)::int as "revenueCents",
               avg(extract(epoch from (tabs.closed_at - tabs.created_at)) / 60.0)::double precision as "averageServiceMinutes"
        from pos_tabs tabs
        left join pos_operational_shifts shifts on shifts.organization_id = tabs.organization_id and shifts.unit_id = tabs.unit_id and shifts.id = tabs.operational_shift_id
        where tabs.organization_id = ${organizationId}::uuid and tabs.unit_id = ${unitId}::uuid and tabs.status = 'closed'
          and timezone(${unit.timezone}, tabs.closed_at)::date between ${period.from}::date and ${period.to}::date
        group by shifts.id, shifts.label order by sum(tabs.total_cents) desc, label
      `)
        : Promise.resolve([] as ShiftRow[]),
      !period.family ||
      period.family === "overview" ||
      period.family === "inventory" ||
      period.family === "forecast"
        ? this.database.db.execute<InventoryAnalysisRow>(sql`
        with consumption as (
          select inventory_item_id,
                 coalesce(sum(abs(quantity_delta::numeric)), 0)::double precision as consumed_quantity,
                 coalesce(round(sum(abs(quantity_delta::numeric) * unit_cost_cents)), 0)::bigint as consumed_value_cents,
                 count(*) filter (where unit_cost_cents is null)::int as missing_cost_movements
          from management_inventory_movements
          where organization_id = ${organizationId}::uuid and unit_id = ${unitId}::uuid and type = 'order_consumption'
            and timezone(${unit.timezone}, occurred_at)::date between ${period.from}::date and ${period.to}::date
          group by inventory_item_id
        ), balances as (
          select inventory_item_id, coalesce(sum(quantity::numeric), 0)::double precision as current_quantity
          from management_stock_balances where organization_id = ${organizationId}::uuid and unit_id = ${unitId}::uuid group by inventory_item_id
        )
        select items.id::text as key, items.name as label,
               coalesce(consumption.consumed_quantity, 0)::double precision as "consumedQuantity",
               coalesce(consumption.consumed_value_cents, 0)::int as "consumedValueCents",
               coalesce(consumption.missing_cost_movements, 0)::int as "missingCostMovements",
               coalesce(balances.current_quantity, 0)::double precision as "currentQuantity"
        from management_inventory_items items
        left join consumption on consumption.inventory_item_id = items.id
        left join balances on balances.inventory_item_id = items.id
        where items.organization_id = ${organizationId}::uuid and items.unit_id = ${unitId}::uuid and items.active = true
          and (coalesce(consumption.consumed_quantity, 0) > 0 or coalesce(balances.current_quantity, 0) <> 0)
        order by consumption.consumed_value_cents desc nulls last, items.name
      `)
        : Promise.resolve([] as InventoryAnalysisRow[]),
      !period.family || period.family === "overview" || period.family === "purchasing"
        ? this.database.db.execute<SupplierPerformanceRow>(sql`
        with order_stats as (
          select supplier_id, count(*)::int as order_count
          from management_purchase_orders
          where organization_id = ${organizationId}::uuid and unit_id = ${unitId}::uuid
            and timezone(${unit.timezone}, created_at)::date between ${period.from}::date and ${period.to}::date
          group by supplier_id
        ), receipt_stats as (
          select receipts.supplier_id, count(distinct receipts.id)::int as receipt_count,
                 count(distinct receipts.id) filter (where orders.expected_at is not null and receipts.received_at <= orders.expected_at)::int as on_time_receipts,
                 count(distinct receipts.id) filter (where orders.expected_at is not null)::int as timed_receipts,
                 avg(extract(epoch from (receipts.received_at - orders.created_at)) / 86400.0)::double precision as average_lead_days,
                 coalesce(sum(order_items.unit_cost_cents * receipt_lines.quantity::numeric), 0)::bigint as expected_line_cents,
                 coalesce(sum(receipt_lines.total_cents), 0)::bigint as received_line_cents
          from management_purchase_receipts receipts
          inner join management_purchase_orders orders on orders.organization_id = receipts.organization_id and orders.unit_id = receipts.unit_id and orders.id = receipts.purchase_order_id
          left join management_purchase_receipt_lines receipt_lines on receipt_lines.organization_id = receipts.organization_id and receipt_lines.unit_id = receipts.unit_id and receipt_lines.receipt_id = receipts.id
          left join management_purchase_order_items order_items on order_items.organization_id = receipt_lines.organization_id and order_items.unit_id = receipt_lines.unit_id and order_items.id = receipt_lines.purchase_order_item_id
          where receipts.organization_id = ${organizationId}::uuid and receipts.unit_id = ${unitId}::uuid and receipts.status = 'posted'
            and timezone(${unit.timezone}, receipts.received_at)::date between ${period.from}::date and ${period.to}::date
          group by receipts.supplier_id
        )
        select suppliers.id::text as key, suppliers.name as label,
               coalesce(order_stats.order_count, 0)::int as "orderCount",
               coalesce(receipt_stats.receipt_count, 0)::int as "receiptCount",
               coalesce(receipt_stats.on_time_receipts, 0)::int as "onTimeReceipts",
               coalesce(receipt_stats.timed_receipts, 0)::int as "timedReceipts",
               receipt_stats.average_lead_days as "averageLeadDays",
               coalesce(receipt_stats.expected_line_cents, 0)::int as "expectedLineCents",
               coalesce(receipt_stats.received_line_cents, 0)::int as "receivedLineCents"
        from management_suppliers suppliers
        left join order_stats on order_stats.supplier_id = suppliers.id
        left join receipt_stats on receipt_stats.supplier_id = suppliers.id
        where suppliers.organization_id = ${organizationId}::uuid and suppliers.unit_id = ${unitId}::uuid
          and (order_stats.order_count is not null or receipt_stats.receipt_count is not null)
        order by coalesce(receipt_stats.receipt_count, 0) desc, suppliers.name
      `)
        : Promise.resolve([] as SupplierPerformanceRow[]),
      reportRole === "owner" &&
      (!period.family || period.family === "overview" || period.family === "multiunit")
        ? this.database.db.execute<MultiunitRow>(sql`
            select units.id::text as key, units.name as label,
                   count(tabs.id) filter (where timezone(units.timezone, tabs.closed_at)::date between ${period.from}::date and ${period.to}::date)::int as "closedTabs",
                   coalesce(sum(tabs.total_cents) filter (where timezone(units.timezone, tabs.closed_at)::date between ${period.from}::date and ${period.to}::date), 0)::int as "revenueCents",
                   coalesce(sum(tabs.total_cents) filter (where ${previousPeriod !== null} and timezone(units.timezone, tabs.closed_at)::date between ${previousPeriod?.from ?? period.from}::date and ${previousPeriod?.to ?? period.to}::date), 0)::int as "previousRevenueCents",
                   count(distinct timezone(units.timezone, tabs.closed_at)::date) filter (where timezone(units.timezone, tabs.closed_at)::date between ${period.from}::date and ${period.to}::date)::int as "operatingDays",
                   count(distinct timezone(units.timezone, tabs.closed_at)::date) filter (where ${previousPeriod !== null} and timezone(units.timezone, tabs.closed_at)::date between ${previousPeriod?.from ?? period.from}::date and ${previousPeriod?.to ?? period.to}::date)::int as "previousOperatingDays",
                   coalesce((select sum(tables.seats) from pos_dining_tables tables where tables.organization_id = units.organization_id and tables.unit_id = units.id and tables.active = true), 0)::int as "seatCount",
                   coalesce((select count(*) from management_people people where people.organization_id = units.organization_id and people.unit_id = units.id and people.active = true), 0)::int as "activeEmployees",
                   (select round(sum(extract(epoch from (least(coalesce(shifts.closed_at, now()), ((${period.to}::date + 1)::timestamp at time zone units.timezone)) - greatest(shifts.opened_at, (${period.from}::date::timestamp at time zone units.timezone)))) / 3600.0)::numeric, 2)::double precision
                      from management_cash_shifts shifts
                     where shifts.organization_id = units.organization_id and shifts.unit_id = units.id
                       and shifts.opened_at < ((${period.to}::date + 1)::timestamp at time zone units.timezone)
                       and coalesce(shifts.closed_at, now()) >= (${period.from}::date::timestamp at time zone units.timezone)) as "openHours"
            from units
            left join pos_tabs tabs on tabs.organization_id = units.organization_id and tabs.unit_id = units.id and tabs.status = 'closed'
            where units.organization_id = ${organizationId}::uuid and units.active = true
            group by units.id, units.name order by "revenueCents" desc, units.name
          `)
        : Promise.resolve([] as MultiunitRow[]),
    ]);
    const paymentMethodsByMethod = new Map(
      grossPaymentMethods.map((row) => [row.method, { ...row }]),
    );
    for (const reversal of paymentReversalMethods) {
      const current = paymentMethodsByMethod.get(reversal.method) ?? {
        method: reversal.method,
        quantity: 0,
        revenueCents: 0,
      };
      current.revenueCents -= reversal.reversedCents;
      paymentMethodsByMethod.set(reversal.method, current);
    }
    const paymentMethods = [...paymentMethodsByMethod.values()];
    const receivableIds = receivables.map((entry) => entry.id);
    const lines =
      receivableIds.length === 0
        ? []
        : await this.database.db
            .select({
              revenueCents: managementReceivableLines.revenueCents,
              costCents: managementReceivableLines.costCents,
            })
            .from(managementReceivableLines)
            .where(
              and(
                eq(managementReceivableLines.organizationId, organizationId),
                eq(managementReceivableLines.unitId, unitId),
                inArray(managementReceivableLines.receivableId, receivableIds),
              ),
            );
    const coverage = profitabilityCoverage(lines);
    const revenueCents = receivables.reduce((sum, entry) => sum + entry.amountCents, 0);
    const operatingExpensesCents = payables.reduce((sum, entry) => sum + entry.amountCents, 0);
    const cmvCents =
      coverage.coverage === "complete" && coverage.revenueCents === revenueCents
        ? coverage.cmvCents
        : null;
    const grossMarginCents = cmvCents === null ? null : revenueCents - cmvCents;
    const salesAnalytics = buildReportSalesAnalytics(
      period,
      dailyChannelSales,
      productSales,
      paymentMethods,
      period.comparisonMode,
    );
    const sourceDates = [
      ...payablePayments.map((entry) => entry.localDate),
      ...receivablePayments.map((entry) => entry.localDate),
      ...payables.map((entry) => entry.competenceDate),
      ...receivables.map((entry) => entry.competenceDate),
      ...dailyChannelSales.map((entry) => entry.date),
    ].filter((date) => date >= period.from && date <= period.to);
    const paymentRevenueCents = paymentMethods.reduce((sum, entry) => sum + entry.revenueCents, 0);
    const closedTabRevenueCents = salesAnalytics.comparison.revenueCents;
    const salesCoverage = closedTabRevenueCents === paymentRevenueCents ? "complete" : "partial";
    const tabMetrics = tabMetricsRows[0] ?? {
      closedTabs: 0,
      dineInTabs: 0,
      tableTurnovers: 0,
      guests: 0,
      subtotalCents: 0,
      discountCents: 0,
      netRevenueCents: 0,
      averageServiceMinutes: null,
    };
    const exceptionMetrics = exceptionMetricsRows[0] ?? {
      canceledItems: 0,
      canceledValueCents: 0,
      discountedItems: 0,
      itemDiscountCents: 0,
    };
    const inventoryLoss = inventoryLossRows[0] ?? { lossEvents: 0, lossQuantity: 0 };
    const stockoutItems = inventoryBalanceRows.filter((row) => row.quantity <= 0).length;
    const lowStockItems = inventoryBalanceRows.filter(
      (row) => row.quantity > 0 && row.quantity <= Number(row.minimumQuantity),
    ).length;
    const inventoryValueCovered = inventoryBalanceRows.every(
      (row) => row.missingCostBalances === 0,
    );
    const suppliers = new Map<
      string,
      {
        key: string;
        label: string;
        orderCount: number;
        orderedCents: number;
        receiptCount: number;
        receivedCents: number;
      }
    >();
    for (const row of purchaseOrderRows) {
      suppliers.set(row.supplierId, {
        key: row.supplierId,
        label: row.supplierName,
        orderCount: row.orderCount,
        orderedCents: row.orderedCents,
        receiptCount: 0,
        receivedCents: 0,
      });
    }
    for (const row of purchaseReceiptRows) {
      const supplier = suppliers.get(row.supplierId) ?? {
        key: row.supplierId,
        label: row.supplierName,
        orderCount: 0,
        orderedCents: 0,
        receiptCount: 0,
        receivedCents: 0,
      };
      supplier.receiptCount = row.receiptCount;
      supplier.receivedCents = row.receivedCents;
      suppliers.set(row.supplierId, supplier);
    }
    const numberValue = (value: number | string | null | undefined) =>
      value === null || value === undefined ? null : Number(value);
    const historical = (key: "current" | "previous") =>
      historicalMetrics.find((row) => row.periodKey === key);
    const currentHistorical = historical("current");
    const previousHistorical = historical("previous");
    const compared = (key: keyof Omit<HistoricalMetricRow, "periodKey">) =>
      reportMetricComparison(
        numberValue(currentHistorical?.[key]),
        previousPeriod ? numberValue(previousHistorical?.[key]) : null,
      );
    const periodDays =
      Math.round(
        (Date.parse(`${period.to}T00:00:00.000Z`) - Date.parse(`${period.from}T00:00:00.000Z`)) /
          86_400_000,
      ) + 1;
    const coveredInventoryValue = inventoryAnalysisRows.reduce(
      (sum, row) =>
        sum + (Number(row.missingCostMovements) === 0 ? Number(row.consumedValueCents) : 0),
      0,
    );
    let accumulatedInventoryValue = 0;
    const inventoryAnalysis = inventoryAnalysisRows.map((row) => {
      const consumedValueCents =
        Number(row.missingCostMovements) === 0 ? Number(row.consumedValueCents) : null;
      accumulatedInventoryValue += consumedValueCents ?? 0;
      const share =
        coveredInventoryValue > 0 ? accumulatedInventoryValue / coveredInventoryValue : 0;
      const consumedQuantity = Number(row.consumedQuantity);
      return {
        key: row.key,
        label: row.label,
        abcClass:
          consumedValueCents === null || coveredInventoryValue === 0
            ? null
            : share <= 0.8
              ? ("A" as const)
              : share <= 0.95
                ? ("B" as const)
                : ("C" as const),
        consumedQuantity,
        consumedValueCents,
        currentQuantity: Number(row.currentQuantity),
        coverageDays:
          consumedQuantity > 0
            ? Number(((Number(row.currentQuantity) * periodDays) / consumedQuantity).toFixed(1))
            : null,
      };
    });
    const supplierPerformance = supplierPerformanceRows.map((row) => {
      const expected = Number(row.expectedLineCents);
      const received = Number(row.receivedLineCents);
      return {
        key: row.key,
        label: row.label,
        orderCount: Number(row.orderCount),
        receiptCount: Number(row.receiptCount),
        onTimeRatePercent:
          Number(row.timedReceipts) > 0
            ? Number(((Number(row.onTimeReceipts) / Number(row.timedReceipts)) * 100).toFixed(1))
            : null,
        averageLeadDays:
          row.averageLeadDays === null ? null : Number(Number(row.averageLeadDays).toFixed(1)),
        priceVariancePercent:
          expected > 0 ? Number((((received - expected) / expected) * 100).toFixed(2)) : null,
      };
    });
    const productProfitability = productSales.map((row) => {
      const costCents = row.missingCostItems === 0 ? row.costCents : null;
      const margin = costCents === null ? null : row.revenueCents - costCents;
      return {
        key: row.productId,
        label: row.productName,
        quantity: row.quantity,
        revenueCents: row.revenueCents,
        costCents,
        grossMarginCents: margin,
        grossMarginPercent:
          margin === null || row.revenueCents === 0
            ? null
            : Number(((margin / row.revenueCents) * 100).toFixed(2)),
      };
    });
    const missingProductCosts = productSales.reduce((sum, row) => sum + row.missingCostItems, 0);
    const missingCancellationReasons = cancellationReasons
      .filter((row) => row.label === "Sem motivo informado")
      .reduce((sum, row) => sum + row.quantity, 0);
    const missingInventoryCosts = inventoryBalanceRows.reduce(
      (sum, row) => sum + row.missingCostBalances,
      0,
    );
    const supplierDeliveryDatesMissing = supplierPerformanceRows.reduce(
      (sum, row) => sum + Math.max(0, Number(row.receiptCount) - Number(row.timedReceipts)),
      0,
    );
    const paymentMismatch = closedTabRevenueCents === paymentRevenueCents ? 0 : 1;
    const qualityIssues = [
      {
        key: "sold_items_without_cost",
        label: "Itens vendidos sem custo histÃ³rico",
        count: missingProductCosts,
        severity: "critical" as const,
      },
      {
        key: "cancellations_without_reason",
        label: "Cancelamentos sem motivo informado",
        count: missingCancellationReasons,
        severity: "warning" as const,
      },
      {
        key: "balances_without_cost",
        label: "Saldos positivos sem custo mÃ©dio",
        count: missingInventoryCosts,
        severity: "critical" as const,
      },
      {
        key: "receipts_without_expected_date",
        label: "Recebimentos sem prazo esperado",
        count: supplierDeliveryDatesMissing,
        severity: "warning" as const,
      },
      {
        key: "payment_reconciliation",
        label: "DivergÃªncia entre vendas fechadas e pagamentos",
        count: paymentMismatch,
        severity: "critical" as const,
      },
    ].filter((issue) => issue.count > 0);
    const qualityBase = Math.max(
      1,
      tabMetrics.closedTabs +
        productSales.reduce((sum, row) => sum + row.quantity, 0) +
        inventoryBalanceRows.length +
        purchaseReceiptRows.reduce((sum, row) => sum + row.receiptCount, 0),
    );
    const qualityScorePercent = Math.max(
      0,
      Number(
        (
          100 -
          (qualityIssues.reduce((sum, issue) => sum + issue.count, 0) / qualityBase) * 100
        ).toFixed(1),
      ),
    );
    const lossValueCents = numberValue(currentHistorical?.lossValueCents);
    const reportFamilies = buildReportFamilies({
      salesCoverage,
      tabs: {
        ...tabMetrics,
        averageServiceMinutes:
          tabMetrics.averageServiceMinutes === null
            ? null
            : Math.round(Number(tabMetrics.averageServiceMinutes)),
      },
      exceptions: exceptionMetrics,
      cancellationReasons,
      inventory: {
        ...inventoryLoss,
        lossValueCents,
        stockoutItems,
        lowStockItems,
        currentInventoryValueCents: inventoryValueCovered
          ? inventoryBalanceRows.reduce((sum, row) => sum + row.valueCents, 0)
          : null,
      },
      purchasing: {
        orderCount: purchaseOrderRows.reduce((sum, row) => sum + row.orderCount, 0),
        orderedCents: purchaseOrderRows.reduce((sum, row) => sum + row.orderedCents, 0),
        canceledOrders: purchaseOrderRows.reduce((sum, row) => sum + row.canceledOrders, 0),
        receiptCount: purchaseReceiptRows.reduce((sum, row) => sum + row.receiptCount, 0),
        receivedCents: purchaseReceiptRows.reduce((sum, row) => sum + row.receivedCents, 0),
        suppliers: [...suppliers.values()].sort(
          (left, right) =>
            right.orderedCents + right.receivedCents - (left.orderedCents + left.receivedCents) ||
            left.label.localeCompare(right.label),
        ),
      },
      profitability: {
        coverage:
          cmvCents !== null
            ? "complete"
            : coverage.coverage === "unavailable"
              ? "unavailable"
              : "partial",
        grossMarginCents,
        revenueCents,
        products: productProfitability,
      },
      comparisons: {
        sales: {
          revenueCents: compared("revenueCents"),
          closedTabs: compared("closedTabs"),
          averageTicketCents: reportMetricComparison(
            currentHistorical && Number(currentHistorical.closedTabs) > 0
              ? Math.round(
                  Number(currentHistorical.revenueCents) / Number(currentHistorical.closedTabs),
                )
              : null,
            previousHistorical && Number(previousHistorical.closedTabs) > 0
              ? Math.round(
                  Number(previousHistorical.revenueCents) / Number(previousHistorical.closedTabs),
                )
              : null,
          ),
        },
        exceptions: {
          canceledValueCents: compared("canceledValueCents"),
          discountCents: compared("itemDiscountCents"),
        },
        inventory: {
          lossQuantity: compared("lossQuantity"),
          lossValueCents: compared("lossValueCents"),
        },
        purchasing: {
          orderedCents: compared("orderedCents"),
          receivedCents: compared("receivedCents"),
        },
        operations: {
          tableTurnovers: compared("tableTurnovers"),
          averageServiceMinutes: compared("averageServiceMinutes"),
        },
        profitability: {
          grossMarginCents: reportMetricComparison(
            currentHistorical?.productCostCents === null || !currentHistorical
              ? null
              : Number(currentHistorical.revenueCents) - Number(currentHistorical.productCostCents),
            previousHistorical?.productCostCents === null || !previousHistorical
              ? null
              : Number(previousHistorical.revenueCents) -
                  Number(previousHistorical.productCostCents),
          ),
        },
      },
      hourlySales: hourlySales.map((row) => ({
        hour: Number(row.hour),
        closedTabs: Number(row.closedTabs),
        revenueCents: Number(row.revenueCents),
      })),
      shifts: shiftRows.map((row) => ({
        ...row,
        closedTabs: Number(row.closedTabs),
        guests: Number(row.guests),
        revenueCents: Number(row.revenueCents),
        averageServiceMinutes:
          row.averageServiceMinutes === null
            ? null
            : Number(Number(row.averageServiceMinutes).toFixed(1)),
      })),
      inventoryAnalysis,
      supplierPerformance,
      multiunit:
        reportRole === "owner"
          ? multiunitRows.map((row, index) => {
              const seatCount = Number(row.seatCount);
              const activeEmployees = Number(row.activeEmployees);
              const openHours = row.openHours === null ? null : Number(row.openHours);
              const minimumComparableOperatingDays = period.minimumComparableOperatingDays ?? 7;
              const comparableStoreEligible =
                previousPeriod !== null &&
                Number(row.operatingDays) >= minimumComparableOperatingDays &&
                Number(row.previousOperatingDays) >= minimumComparableOperatingDays;
              return {
                key: row.key,
                label: row.label,
                closedTabs: Number(row.closedTabs),
                revenueCents: Number(row.revenueCents),
                averageTicketCents:
                  Number(row.closedTabs) > 0
                    ? Math.round(Number(row.revenueCents) / Number(row.closedTabs))
                    : null,
                changePercent:
                  previousPeriod === null
                    ? null
                    : reportPercentageChange(
                        Number(row.revenueCents),
                        Number(row.previousRevenueCents),
                      ),
                rank: index + 1,
                operatingDays: Number(row.operatingDays),
                minimumComparableOperatingDays,
                comparableStoreEligible,
                revenuePerOperatingDayCents:
                  Number(row.operatingDays) > 0
                    ? Math.round(Number(row.revenueCents) / Number(row.operatingDays))
                    : null,
                seatCount,
                activeEmployees,
                openHours,
                revenuePerSeatCents:
                  seatCount > 0 ? Math.round(Number(row.revenueCents) / seatCount) : null,
                revenuePerOpenHourCents:
                  openHours !== null && openHours > 0
                    ? Math.round(Number(row.revenueCents) / openHours)
                    : null,
                revenuePerEmployeeCents:
                  activeEmployees > 0
                    ? Math.round(Number(row.revenueCents) / activeEmployees)
                    : null,
                organizationRevenueSharePercent:
                  multiunitRows.reduce((sum, item) => sum + Number(item.revenueCents), 0) > 0
                    ? Number(
                        (
                          (Number(row.revenueCents) /
                            multiunitRows.reduce(
                              (sum, item) => sum + Number(item.revenueCents),
                              0,
                            )) *
                          100
                        ).toFixed(2),
                      )
                    : null,
                sameStoreChangePercent: comparableStoreEligible
                  ? reportPercentageChange(
                      Math.round(Number(row.revenueCents) / Number(row.operatingDays)),
                      Math.round(
                        Number(row.previousRevenueCents) / Number(row.previousOperatingDays),
                      ),
                    )
                  : null,
              };
            })
          : null,
      quality: { scorePercent: qualityScorePercent, issues: qualityIssues },
    });
    return {
      period: { from: period.from, to: period.to },
      timezone: unit.timezone,
      previousPeriod: salesAnalytics.previousPeriod,
      meta: {
        generatedAt: new Date().toISOString(),
        dataThrough: sourceDates.sort().at(-1) ?? null,
        sourceCounts: {
          posSales: dailyChannelSales.reduce((sum, entry) => sum + entry.quantity, 0),
          receivablePayments: receivablePayments.length,
          payablePayments: payablePayments.length,
          receivables: receivables.length,
          payables: payables.length,
          costLines: lines.length,
        },
        coverage: {
          sales: salesCoverage,
          cashFlow: "complete",
          costs: coverage.coverage,
        },
      },
      cashFlow: {
        inflowsCents: receivablePayments.reduce((sum, entry) => sum + entry.amountCents, 0),
        outflowsCents: payablePayments.reduce((sum, entry) => sum + entry.amountCents, 0),
        netCents:
          receivablePayments.reduce((sum, entry) => sum + entry.amountCents, 0) -
          payablePayments.reduce((sum, entry) => sum + entry.amountCents, 0),
        basis: "realized_payments_unit_timezone",
      },
      incomeStatement: {
        revenueCents,
        cmvCents,
        grossMarginCents,
        operatingExpensesCents,
        operatingResultCents:
          grossMarginCents === null ? null : grossMarginCents - operatingExpensesCents,
        costCoverage: {
          ...coverage,
          completeForRevenue:
            coverage.coverage === "complete" && coverage.revenueCents === revenueCents,
        },
        basis: "competence",
      },
      comparison: salesAnalytics.comparison,
      dailySeries: salesAnalytics.dailySeries,
      breakdowns: salesAnalytics.breakdowns,
      reportFamilies,
    };
  }

  async peopleCapabilities(identityId: string, organizationId: string, unitId: string) {
    await this.scope.requireUnitAccess(identityId, organizationId, unitId);
    const rows = await this.database.db
      .select({ role: roleBindings.role, unitId: roleBindings.unitId })
      .from(memberships)
      .innerJoin(roleBindings, eq(roleBindings.membershipId, memberships.id))
      .where(
        and(
          eq(memberships.identityId, identityId),
          eq(memberships.organizationId, organizationId),
          eq(memberships.status, "active"),
          or(isNull(roleBindings.unitId), eq(roleBindings.unitId, unitId)),
        ),
      );
    const role = TIME_TRACKING_READ_ROLES.find((candidate) =>
      rows.some((row) => row.role === candidate && (row.unitId === null || row.unitId === unitId)),
    );
    const settings = await this.timeTrackingSettings(this.database.db, organizationId, unitId);
    const deniedByPolicy =
      (role === "manager" && !settings.managerCanView) ||
      (role === "finance" && !settings.financeCanView);
    const canView = Boolean(role) && !deniedByPolicy;
    return {
      canView,
      canManage: canView && (role === "owner" || role === "manager"),
      canConfigure: canView && role === "owner",
      canApproveCommissions: canView && (role === "owner" || role === "manager"),
      canPayCommissions: canView && (role === "owner" || role === "finance"),
      reason: !role ? "ROLE_NOT_ALLOWED" : deniedByPolicy ? "TIME_TRACKING_POLICY_DENIED" : null,
    };
  }

  async getTimeTrackingSettings(identityId: string, organizationId: string, unitId: string) {
    const { role, settings } = await this.requireTimeTrackingReadAccess(
      identityId,
      organizationId,
      unitId,
    );
    const assignments = await this.database.db
      .select({ personId: managementTimeTrackingAssignments.personId })
      .from(managementTimeTrackingAssignments)
      .where(
        and(
          eq(managementTimeTrackingAssignments.organizationId, organizationId),
          eq(managementTimeTrackingAssignments.unitId, unitId),
          eq(managementTimeTrackingAssignments.enabled, true),
        ),
      );
    return {
      settings: role === "owner" ? settings : timeTrackingSettingsWithoutCoordinates(settings),
      selectedPersonIds:
        role === "owner" ? assignments.map((assignment) => assignment.personId) : [],
      capabilities: {
        canConfigure: role === "owner",
        canView: true,
      },
    };
  }

  async timeTrackingSettingsHistory(identityId: string, organizationId: string, unitId: string) {
    await this.requireRole(identityId, organizationId, unitId, ["owner"]);
    const rows = await this.database.db
      .select({
        id: auditEvents.id,
        actorName: identities.displayName,
        occurredAt: auditEvents.occurredAt,
        metadata: auditEvents.metadata,
      })
      .from(auditEvents)
      .leftJoin(identities, eq(identities.id, auditEvents.actorIdentityId))
      .where(
        and(
          eq(auditEvents.organizationId, organizationId),
          eq(auditEvents.unitId, unitId),
          eq(auditEvents.action, "management.time-tracking.settings.updated"),
          eq(auditEvents.entityType, "time_tracking_settings"),
        ),
      )
      .orderBy(desc(auditEvents.occurredAt))
      .limit(50);
    return rows.map((row) => ({
      id: row.id,
      actorName: row.actorName ?? "Sistema",
      occurredAt: row.occurredAt,
      locationChangeReason:
        typeof row.metadata.locationChangeReason === "string"
          ? row.metadata.locationChangeReason
          : null,
      previous: row.metadata.previous ?? null,
      current: row.metadata.current ?? null,
    }));
  }

  async timeTrackingLocationAnomalies(
    identityId: string,
    organizationId: string,
    unitId: string,
    period: ReportPeriodInput,
  ) {
    await this.requireRole(identityId, organizationId, unitId, ["owner"]);
    const [unit] = await this.database.db
      .select({ timezone: units.timezone })
      .from(units)
      .where(and(eq(units.organizationId, organizationId), eq(units.id, unitId)))
      .limit(1);
    if (!unit) throw new NotFoundException({ code: "UNIT_NOT_FOUND" });
    const entryDate = sql<string>`timezone(${unit.timezone}, ${managementTimeEntries.clockedInAt})::date`;
    const entries = await this.database.db
      .select({ entry: managementTimeEntries, personName: managementPeople.name })
      .from(managementTimeEntries)
      .innerJoin(
        managementPeople,
        and(
          eq(managementPeople.organizationId, managementTimeEntries.organizationId),
          eq(managementPeople.unitId, managementTimeEntries.unitId),
          eq(managementPeople.id, managementTimeEntries.personId),
        ),
      )
      .where(
        and(
          eq(managementTimeEntries.organizationId, organizationId),
          eq(managementTimeEntries.unitId, unitId),
          gte(entryDate, period.from),
          lte(entryDate, period.to),
          or(
            sql`jsonb_array_length(${managementTimeEntries.clockInFlags}) > 0`,
            sql`jsonb_array_length(${managementTimeEntries.clockOutFlags}) > 0`,
          ),
        ),
      )
      .orderBy(desc(managementTimeEntries.clockedInAt))
      .limit(500);
    return {
      from: period.from,
      to: period.to,
      points: entries.flatMap(({ entry, personName }) => {
        const points: Array<{
          timeEntryId: string;
          personId: string;
          personName: string;
          event: "clock-in" | "clock-out";
          occurredAt: Date;
          latitude: number;
          longitude: number;
          accuracyMeters: number | null;
          locationLabel: string | null;
          flags: string[];
        }> = [];
        if (
          entry.clockInLatitude !== null &&
          entry.clockInLongitude !== null &&
          entry.clockInFlags.length
        ) {
          points.push({
            timeEntryId: entry.id,
            personId: entry.personId,
            personName,
            event: "clock-in",
            occurredAt: entry.clockedInAt,
            latitude: entry.clockInLatitude,
            longitude: entry.clockInLongitude,
            accuracyMeters: entry.clockInAccuracyMeters,
            locationLabel: entry.clockInGeofenceLabel,
            flags: entry.clockInFlags,
          });
        }
        if (
          entry.clockedOutAt &&
          entry.clockOutLatitude !== null &&
          entry.clockOutLongitude !== null &&
          entry.clockOutFlags.length
        ) {
          points.push({
            timeEntryId: entry.id,
            personId: entry.personId,
            personName,
            event: "clock-out",
            occurredAt: entry.clockedOutAt,
            latitude: entry.clockOutLatitude,
            longitude: entry.clockOutLongitude,
            accuracyMeters: entry.clockOutAccuracyMeters,
            locationLabel: entry.clockOutGeofenceLabel,
            flags: entry.clockOutFlags,
          });
        }
        return points;
      }),
    };
  }

  async peopleDirectory(
    identityId: string,
    organizationId: string,
    unitId: string,
    query: PeopleListQuery,
  ) {
    await this.requireTimeTrackingReadAccess(identityId, organizationId, unitId);
    const filters = [
      eq(managementPeople.organizationId, organizationId),
      eq(managementPeople.unitId, unitId),
    ];
    if (query.status === "active" || query.status === "inactive")
      filters.push(eq(managementPeople.active, query.status === "active"));
    if (query.status === "unlinked") filters.push(isNull(managementPeople.identityId));
    if (query.status === "on_shift")
      filters.push(
        sql<boolean>`exists (
          select 1 from management_time_entries entry
          where entry.organization_id = ${organizationId}::uuid
            and entry.unit_id = ${unitId}::uuid
            and entry.person_id = ${managementPeople.id}
            and entry.clocked_out_at is null
        )`,
      );
    if (query.role) filters.push(ilike(managementPeople.roleLabel, query.role));
    if (query.q) {
      const term = `%${query.q}%`;
      const search = or(
        ilike(managementPeople.name, term),
        ilike(managementPeople.employmentCode, term),
        ilike(managementPeople.roleLabel, term),
      );
      if (search) filters.push(search);
    }
    const where = and(...filters);
    const [items, totalRows] = await Promise.all([
      this.database.db
        .select()
        .from(managementPeople)
        .where(where)
        .orderBy(managementPeople.name, managementPeople.id)
        .limit(query.pageSize)
        .offset((query.page - 1) * query.pageSize),
      this.database.db
        .select({ total: sql<number>`count(*)::int` })
        .from(managementPeople)
        .where(where),
    ]);
    const total = totalRows[0]?.total ?? 0;
    const accessRows = await this.personAccessRows(
      this.database.db,
      organizationId,
      unitId,
      items.map((person) => person.id),
    );
    const accessByPersonId = new Map(accessRows.map((access) => [access.personId, access]));
    return {
      items: items.map((person) => ({
        ...person,
        access: personAccessView(accessByPersonId.get(person.id)),
      })),
      pagination: {
        page: query.page,
        pageSize: query.pageSize,
        total,
        totalPages: Math.ceil(total / query.pageSize),
      },
    };
  }

  async peopleDashboard(identityId: string, organizationId: string, unitId: string) {
    const { role, settings } = await this.requireTimeTrackingReadAccess(
      identityId,
      organizationId,
      unitId,
    );
    const canManage = role === "owner" || role === "manager";
    const canViewCommissions = canManage || role === "finance";
    const [
      people,
      schedules,
      timeEntries,
      breaks,
      assignments,
      accounts,
      corrections,
      rules,
      commissions,
    ] = await Promise.all([
      this.database.db
        .select()
        .from(managementPeople)
        .where(
          and(
            eq(managementPeople.organizationId, organizationId),
            eq(managementPeople.unitId, unitId),
          ),
        )
        .orderBy(managementPeople.name),
      this.database.db
        .select()
        .from(managementSchedules)
        .where(
          and(
            eq(managementSchedules.organizationId, organizationId),
            eq(managementSchedules.unitId, unitId),
            isNull(managementSchedules.canceledAt),
          ),
        )
        .orderBy(desc(managementSchedules.startsAt))
        .limit(500),
      this.database.db
        .select()
        .from(managementTimeEntries)
        .where(
          and(
            eq(managementTimeEntries.organizationId, organizationId),
            eq(managementTimeEntries.unitId, unitId),
          ),
        )
        .orderBy(desc(managementTimeEntries.clockedInAt))
        .limit(500),
      this.database.db
        .select()
        .from(managementTimeEntryBreaks)
        .where(
          and(
            eq(managementTimeEntryBreaks.organizationId, organizationId),
            eq(managementTimeEntryBreaks.unitId, unitId),
          ),
        )
        .orderBy(desc(managementTimeEntryBreaks.startedAt))
        .limit(1_000),
      this.database.db
        .select()
        .from(managementTimeTrackingAssignments)
        .where(
          and(
            eq(managementTimeTrackingAssignments.organizationId, organizationId),
            eq(managementTimeTrackingAssignments.unitId, unitId),
            eq(managementTimeTrackingAssignments.enabled, true),
          ),
        ),
      this.database.db
        .selectDistinct({
          id: identities.id,
          displayName: identities.displayName,
          email: identities.email,
        })
        .from(memberships)
        .innerJoin(identities, eq(identities.id, memberships.identityId))
        .innerJoin(roleBindings, eq(roleBindings.membershipId, memberships.id))
        .where(
          and(
            eq(memberships.organizationId, organizationId),
            eq(memberships.status, "active"),
            or(isNull(roleBindings.unitId), eq(roleBindings.unitId, unitId)),
          ),
        )
        .orderBy(identities.displayName),
      this.database.db
        .select()
        .from(managementTimeCorrections)
        .where(
          and(
            eq(managementTimeCorrections.organizationId, organizationId),
            eq(managementTimeCorrections.unitId, unitId),
            eq(managementTimeCorrections.status, "pending"),
          ),
        )
        .orderBy(desc(managementTimeCorrections.createdAt))
        .limit(500),
      this.database.db
        .select()
        .from(managementCommissionRules)
        .where(
          and(
            eq(managementCommissionRules.organizationId, organizationId),
            eq(managementCommissionRules.unitId, unitId),
          ),
        ),
      this.database.db
        .select()
        .from(managementCommissions)
        .where(
          and(
            eq(managementCommissions.organizationId, organizationId),
            eq(managementCommissions.unitId, unitId),
          ),
        )
        .orderBy(desc(managementCommissions.createdAt))
        .limit(500),
    ]);
    const summaries = summarizeTimeEntries(
      timeEntries,
      breaks,
      schedules,
      new Set(corrections.map((correction) => correction.timeEntryId)),
      new Date(),
      settings,
    );
    const closures = await this.database.db
      .select()
      .from(managementTimeTrackingClosures)
      .where(
        and(
          eq(managementTimeTrackingClosures.organizationId, organizationId),
          eq(managementTimeTrackingClosures.unitId, unitId),
          eq(managementTimeTrackingClosures.status, "closed"),
        ),
      )
      .orderBy(desc(managementTimeTrackingClosures.periodStart));
    const alerts = buildTimeTrackingAlerts(
      people.length ? timeEntries : [],
      schedules,
      summaries,
      settings,
    );
    const accessRows = await this.personAccessRows(
      this.database.db,
      organizationId,
      unitId,
      people.map((person) => person.id),
    );
    const accessByPersonId = new Map(accessRows.map((access) => [access.personId, access]));
    return {
      people: people.map((person) => ({
        ...person,
        access: personAccessView(accessByPersonId.get(person.id)),
      })),
      schedules: canManage ? schedules : [],
      timeEntries: timeEntries.map(timeTrackingEntryForRead),
      breaks: breaks.map(timeTrackingBreakForRead),
      corrections,
      summaries,
      anomalies: summaries.filter((summary) => summary.anomalyCodes.length > 0),
      alerts,
      closures,
      selectedPersonIds: assignments.map((assignment) => assignment.personId),
      accounts,
      commissionRules: canViewCommissions ? rules : [],
      commissions: canViewCommissions ? commissions : [],
      settings: role === "owner" ? settings : timeTrackingSettingsWithoutCoordinates(settings),
      canManage,
    };
  }

  async timeTrackingReport(
    identityId: string,
    organizationId: string,
    unitId: string,
    period: ReportPeriodInput,
  ) {
    const { settings } = await this.requireTimeTrackingReadAccess(
      identityId,
      organizationId,
      unitId,
    );
    const [unit] = await this.database.db
      .select({ timezone: units.timezone })
      .from(units)
      .where(and(eq(units.organizationId, organizationId), eq(units.id, unitId)))
      .limit(1);
    if (!unit) throw new NotFoundException({ code: "UNIT_NOT_FOUND" });
    const entryDate = sql<string>`timezone(${unit.timezone}, ${managementTimeEntries.clockedInAt})::date`;
    const [people, schedules, entries, corrections, receivables] = await Promise.all([
      this.database.db
        .select()
        .from(managementPeople)
        .where(
          and(
            eq(managementPeople.organizationId, organizationId),
            eq(managementPeople.unitId, unitId),
          ),
        ),
      this.database.db
        .select()
        .from(managementSchedules)
        .where(
          and(
            eq(managementSchedules.organizationId, organizationId),
            eq(managementSchedules.unitId, unitId),
            isNull(managementSchedules.canceledAt),
          ),
        ),
      this.database.db
        .select({ ...getTableColumns(managementTimeEntries), localDate: entryDate })
        .from(managementTimeEntries)
        .where(
          and(
            eq(managementTimeEntries.organizationId, organizationId),
            eq(managementTimeEntries.unitId, unitId),
            gte(entryDate, period.from),
            lte(entryDate, period.to),
          ),
        )
        .orderBy(desc(managementTimeEntries.clockedInAt)),
      this.database.db
        .select()
        .from(managementTimeCorrections)
        .where(
          and(
            eq(managementTimeCorrections.organizationId, organizationId),
            eq(managementTimeCorrections.unitId, unitId),
            ne(managementTimeCorrections.status, "rejected"),
          ),
        ),
      this.database.db
        .select({ amountCents: managementAccountsReceivable.amountCents })
        .from(managementAccountsReceivable)
        .where(
          and(
            eq(managementAccountsReceivable.organizationId, organizationId),
            eq(managementAccountsReceivable.unitId, unitId),
            gte(managementAccountsReceivable.competenceDate, period.from),
            lte(managementAccountsReceivable.competenceDate, period.to),
          ),
        ),
    ]);
    const breaks = entries.length
      ? await this.database.db
          .select()
          .from(managementTimeEntryBreaks)
          .where(
            and(
              eq(managementTimeEntryBreaks.organizationId, organizationId),
              eq(managementTimeEntryBreaks.unitId, unitId),
              inArray(
                managementTimeEntryBreaks.timeEntryId,
                entries.map((entry) => entry.id),
              ),
            ),
          )
      : [];
    const summaries = summarizeTimeEntries(
      entries,
      breaks,
      schedules,
      new Set(
        corrections
          .filter((correction) => correction.status === "pending")
          .map((correction) => correction.timeEntryId),
      ),
      new Date(),
      settings,
    );
    const peopleById = new Map(people.map((person) => [person.id, person]));
    const rows = entries.map((entry, index) => {
      const summary = summaries[index];
      if (!summary) throw new Error("TIME_ENTRY_SUMMARY_MISSING");
      const person = peopleById.get(entry.personId) ?? null;
      const hourlyRateCents = person?.hourlyRateCents ?? null;
      const { localDate } = entry;
      const localizedSummary = { ...summary, date: localDate };
      return {
        ...timeTrackingEntryForRead(entry),
        summary: localizedSummary,
        person,
        hourlyRateCents,
        estimatedLaborCostCents:
          hourlyRateCents === null
            ? null
            : Math.round((hourlyRateCents * localizedSummary.workedMinutes) / 60),
      };
    });
    const laborCostCents = rows.reduce(
      (total, row) => total + (row.estimatedLaborCostCents ?? 0),
      0,
    );
    const revenueCents = receivables.reduce((total, row) => total + row.amountCents, 0);
    return {
      from: period.from,
      to: period.to,
      timezone: unit.timezone,
      rows,
      totals: {
        workedMinutes: summaries.reduce((total, row) => total + row.workedMinutes, 0),
        breakMinutes: summaries.reduce((total, row) => total + row.breakMinutes, 0),
        overtimeMinutes: summaries.reduce((total, row) => total + row.overtimeMinutes, 0),
        laborCostCents,
        revenueCents,
        laborCostPercentage: revenueCents > 0 ? laborCostCents / revenueCents : null,
        entries: summaries.length,
        anomalies: summaries.filter((row) => row.anomalyCodes.length > 0).length,
      },
    };
  }

  async personTimeline(
    identityId: string,
    organizationId: string,
    unitId: string,
    personId: string,
    period: ReportPeriodInput,
  ) {
    const report = await this.timeTrackingReport(identityId, organizationId, unitId, period);
    const [person] = await this.database.db
      .select()
      .from(managementPeople)
      .where(
        and(
          eq(managementPeople.organizationId, organizationId),
          eq(managementPeople.unitId, unitId),
          eq(managementPeople.id, personId),
        ),
      )
      .limit(1);
    if (!person) throw new NotFoundException({ code: "PERSON_NOT_FOUND" });
    const rows = report.rows.filter((row) => row.personId === personId);
    const entryIds = rows.map((row) => row.id);
    const scheduleDate = sql<string>`timezone(${report.timezone}, ${managementSchedules.startsAt})::date`;
    const commissionDate = sql<string>`timezone(${report.timezone}, ${managementCommissions.createdAt})::date`;
    const [schedules, corrections, commissions] = await Promise.all([
      this.database.db
        .select()
        .from(managementSchedules)
        .where(
          and(
            eq(managementSchedules.organizationId, organizationId),
            eq(managementSchedules.unitId, unitId),
            eq(managementSchedules.personId, personId),
            isNull(managementSchedules.canceledAt),
            gte(scheduleDate, period.from),
            lte(scheduleDate, period.to),
          ),
        )
        .orderBy(managementSchedules.startsAt),
      entryIds.length
        ? this.database.db
            .select()
            .from(managementTimeCorrections)
            .where(
              and(
                eq(managementTimeCorrections.organizationId, organizationId),
                eq(managementTimeCorrections.unitId, unitId),
                eq(managementTimeCorrections.personId, personId),
                inArray(managementTimeCorrections.timeEntryId, entryIds),
              ),
            )
            .orderBy(desc(managementTimeCorrections.createdAt))
        : Promise.resolve([]),
      this.database.db
        .select()
        .from(managementCommissions)
        .where(
          and(
            eq(managementCommissions.organizationId, organizationId),
            eq(managementCommissions.unitId, unitId),
            eq(managementCommissions.personId, personId),
            gte(commissionDate, period.from),
            lte(commissionDate, period.to),
          ),
        )
        .orderBy(desc(managementCommissions.createdAt)),
    ]);
    return {
      person,
      period: { from: period.from, to: period.to, timezone: report.timezone },
      schedules,
      entries: rows,
      corrections,
      commissions,
      reconciliation: {
        scheduledMinutes: rows.reduce((sum, row) => sum + (row.summary.scheduledMinutes ?? 0), 0),
        workedMinutes: rows.reduce((sum, row) => sum + row.summary.workedMinutes, 0),
        overtimeMinutes: rows.reduce((sum, row) => sum + row.summary.overtimeMinutes, 0),
        lateArrivals: rows.filter((row) => row.summary.anomalyCodes.includes("late_arrival"))
          .length,
      },
      coverage: {
        schedules: "complete",
        timeEntries: "complete",
        laborCost: person.hourlyRateCents === null ? "partial" : "complete",
      },
    };
  }

  async peopleIndicators(
    identityId: string,
    organizationId: string,
    unitId: string,
    period: ReportPeriodInput,
  ) {
    const report = await this.timeTrackingReport(identityId, organizationId, unitId, period);
    const scheduleDate = sql<string>`timezone(${report.timezone}, ${managementSchedules.startsAt})::date`;
    const schedules = await this.database.db
      .select()
      .from(managementSchedules)
      .where(
        and(
          eq(managementSchedules.organizationId, organizationId),
          eq(managementSchedules.unitId, unitId),
          isNull(managementSchedules.canceledAt),
          gte(scheduleDate, period.from),
          lte(scheduleDate, period.to),
        ),
      );
    const completedSchedules = schedules.filter((schedule) => schedule.endsAt <= new Date());
    const absences = completedSchedules.filter(
      (schedule) =>
        !report.rows.some(
          (row) =>
            row.personId === schedule.personId &&
            row.clockedInAt <= schedule.endsAt &&
            (row.clockedOutAt ?? new Date()) >= schedule.startsAt,
        ),
    ).length;
    const peopleWithRate = new Set(
      report.rows.filter((row) => row.hourlyRateCents !== null).map((row) => row.personId),
    );
    const peopleWithEntries = new Set(report.rows.map((row) => row.personId));
    const lateByPerson = new Map<string, number>();
    for (const row of report.rows) {
      if (row.summary.anomalyCodes.includes("late_arrival"))
        lateByPerson.set(row.personId, (lateByPerson.get(row.personId) ?? 0) + 1);
    }
    return {
      period: { from: period.from, to: period.to },
      timezone: report.timezone,
      indicators: {
        scheduledShifts: schedules.length,
        absences,
        lateArrivals: report.rows.filter((row) => row.summary.anomalyCodes.includes("late_arrival"))
          .length,
        recurringLatePeople: [...lateByPerson.values()].filter((count) => count >= 2).length,
        overtimeMinutes: report.totals.overtimeMinutes,
        laborCostCents: report.totals.laborCostCents,
        laborCostPercentage: report.totals.laborCostPercentage,
      },
      coverage: {
        schedules: "complete",
        timeEntries: "complete",
        laborCost: peopleWithRate.size === peopleWithEntries.size ? "complete" : "partial",
        missingHourlyRatePeople: Math.max(0, peopleWithEntries.size - peopleWithRate.size),
      },
    };
  }

  async exportPeople(
    identityId: string,
    organizationId: string,
    unitId: string,
    input: PeopleExportInput,
  ) {
    await this.requireTimeTrackingReadAccess(identityId, organizationId, unitId);
    const people = await this.database.db
      .select()
      .from(managementPeople)
      .where(
        and(
          eq(managementPeople.organizationId, organizationId),
          eq(managementPeople.unitId, unitId),
          inArray(managementPeople.id, input.personIds),
        ),
      )
      .orderBy(managementPeople.name);
    if (people.length !== new Set(input.personIds).size)
      throw new NotFoundException({ code: "PEOPLE_EXPORT_SELECTION_INVALID" });
    if (input.format === "json") return { format: "json" as const, rows: people };
    const cell = (value: unknown) => `"${String(value ?? "").replaceAll('"', '""')}"`;
    const headers = ["id", "name", "employmentCode", "roleLabel", "active", "hiredAt"];
    return {
      format: "csv" as const,
      rowCount: people.length,
      content: [
        headers.join(","),
        ...people.map((person) =>
          [
            person.id,
            person.name,
            person.employmentCode,
            person.roleLabel,
            person.active,
            person.hiredAt,
          ]
            .map(cell)
            .join(","),
        ),
      ].join("\n"),
    };
  }

  async assignPeopleTimeTracking(
    identityId: string,
    organizationId: string,
    unitId: string,
    idempotencyKey: string,
    input: PeopleAssignmentBatchInput,
  ) {
    await this.requireRole(identityId, organizationId, unitId, ["owner"]);
    return this.idempotent(
      identityId,
      organizationId,
      unitId,
      idempotencyKey,
      "time-tracking-assignment.batch",
      input,
      async (tx) => {
        const people = await tx
          .select({
            id: managementPeople.id,
            active: managementPeople.active,
            identityId: managementPeople.identityId,
          })
          .from(managementPeople)
          .where(
            and(
              eq(managementPeople.organizationId, organizationId),
              eq(managementPeople.unitId, unitId),
              inArray(managementPeople.id, input.personIds),
            ),
          );
        if (
          people.length !== new Set(input.personIds).size ||
          (input.enabled && people.some((person) => !person.active || !person.identityId))
        )
          throw new BadRequestException({ code: "TIME_TRACKING_ASSIGNMENT_INVALID_PEOPLE" });
        await tx
          .insert(managementTimeTrackingAssignments)
          .values(
            input.personIds.map((personId) => ({
              organizationId,
              unitId,
              personId,
              enabled: input.enabled,
              updatedByIdentityId: identityId,
            })),
          )
          .onConflictDoUpdate({
            target: [
              managementTimeTrackingAssignments.organizationId,
              managementTimeTrackingAssignments.unitId,
              managementTimeTrackingAssignments.personId,
            ],
            set: { enabled: input.enabled, updatedByIdentityId: identityId, updatedAt: new Date() },
          });
        await this.record(
          tx,
          identityId,
          organizationId,
          unitId,
          "management.time-tracking.assignments-batched",
          "time_tracking_assignment",
          idempotencyKey,
          { personIds: input.personIds, enabled: input.enabled },
        );
        return {
          personIds: input.personIds,
          enabled: input.enabled,
          count: input.personIds.length,
        };
      },
    );
  }

  private async assertTimeTrackingPeriodOpen(
    source: Transaction | Database,
    organizationId: string,
    unitId: string,
    dateValue: Date,
  ) {
    const day = dateValue.toISOString().slice(0, 10);
    const [closure] = await source
      .select({ id: managementTimeTrackingClosures.id })
      .from(managementTimeTrackingClosures)
      .where(
        and(
          eq(managementTimeTrackingClosures.organizationId, organizationId),
          eq(managementTimeTrackingClosures.unitId, unitId),
          eq(managementTimeTrackingClosures.status, "closed"),
          lte(managementTimeTrackingClosures.periodStart, day),
          gte(managementTimeTrackingClosures.periodEnd, day),
        ),
      )
      .limit(1);
    if (closure) {
      throw new ConflictException({
        code: "TIME_TRACKING_PERIOD_CLOSED",
        message: "O período está fechado. Solicite uma correção para alterar este registro.",
      });
    }
  }

  async closeTimeTrackingPeriod(
    identityId: string,
    organizationId: string,
    unitId: string,
    idempotencyKey: string,
    input: TimeTrackingClosureInput,
  ) {
    await this.requireRole(identityId, organizationId, unitId, ["owner"]);
    return this.idempotent(
      identityId,
      organizationId,
      unitId,
      idempotencyKey,
      "time-tracking-period.close",
      input,
      async (tx) => {
        await tx.execute(
          sql`select pg_advisory_xact_lock(hashtextextended(${`time-closure:${organizationId}:${unitId}`}, 0))`,
        );
        const [overlap] = await tx
          .select({ id: managementTimeTrackingClosures.id })
          .from(managementTimeTrackingClosures)
          .where(
            and(
              eq(managementTimeTrackingClosures.organizationId, organizationId),
              eq(managementTimeTrackingClosures.unitId, unitId),
              eq(managementTimeTrackingClosures.status, "closed"),
              lte(managementTimeTrackingClosures.periodStart, input.to),
              gte(managementTimeTrackingClosures.periodEnd, input.from),
            ),
          )
          .limit(1);
        if (overlap) {
          throw new ConflictException({
            code: "TIME_TRACKING_PERIOD_ALREADY_CLOSED",
            message: "Este período já está fechado ou se sobrepõe a outro fechamento.",
          });
        }
        const [reopened] = await tx
          .update(managementTimeTrackingClosures)
          .set({
            status: "closed",
            closedAt: new Date(),
            closedByIdentityId: identityId,
            reason: input.reason,
            idempotencyKey,
            reopenedAt: null,
            reopenedByIdentityId: null,
            reopenReason: null,
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(managementTimeTrackingClosures.organizationId, organizationId),
              eq(managementTimeTrackingClosures.unitId, unitId),
              eq(managementTimeTrackingClosures.periodStart, input.from),
              eq(managementTimeTrackingClosures.periodEnd, input.to),
              eq(managementTimeTrackingClosures.status, "reopened"),
            ),
          )
          .returning();
        if (reopened) {
          await this.record(
            tx,
            identityId,
            organizationId,
            unitId,
            "management.time-tracking.period-closed",
            "time_tracking_closure",
            reopened.id,
            { from: input.from, to: input.to, reason: input.reason ?? null },
          );
          return reopened;
        }
        const [closure] = await tx
          .insert(managementTimeTrackingClosures)
          .values({
            organizationId,
            unitId,
            periodStart: input.from,
            periodEnd: input.to,
            closedByIdentityId: identityId,
            reason: input.reason,
            idempotencyKey,
          })
          .returning();
        if (!closure) throw new Error("TIME_TRACKING_CLOSURE_INSERT_FAILED");
        await this.record(
          tx,
          identityId,
          organizationId,
          unitId,
          "management.time-tracking.period-closed",
          "time_tracking_closure",
          closure.id,
          { from: input.from, to: input.to, reason: input.reason ?? null },
        );
        return closure;
      },
    );
  }

  async reopenTimeTrackingPeriod(
    identityId: string,
    organizationId: string,
    unitId: string,
    closureId: string,
    idempotencyKey: string,
    input: PersonStatusInput,
  ) {
    await this.requireRole(identityId, organizationId, unitId, ["owner"]);
    return this.idempotent(
      identityId,
      organizationId,
      unitId,
      idempotencyKey,
      "time-tracking-period.reopen",
      { closureId, ...input },
      async (tx) => {
        await tx.execute(
          sql`select id from management_time_tracking_closures where organization_id=${organizationId}::uuid and unit_id=${unitId}::uuid and id=${closureId}::uuid for update`,
        );
        const [closure] = await tx
          .update(managementTimeTrackingClosures)
          .set({
            status: "reopened",
            reopenedAt: new Date(),
            reopenedByIdentityId: identityId,
            reopenReason: input.reason,
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(managementTimeTrackingClosures.organizationId, organizationId),
              eq(managementTimeTrackingClosures.unitId, unitId),
              eq(managementTimeTrackingClosures.id, closureId),
              eq(managementTimeTrackingClosures.status, "closed"),
            ),
          )
          .returning();
        if (!closure) throw new ConflictException({ code: "TIME_TRACKING_CLOSURE_NOT_CLOSED" });
        await this.record(
          tx,
          identityId,
          organizationId,
          unitId,
          "management.time-tracking.period-reopened",
          "time_tracking_closure",
          closureId,
          { from: closure.periodStart, to: closure.periodEnd, reason: input.reason },
        );
        return { closureId, status: "reopened" as const };
      },
    );
  }

  async updateTimeTrackingSettings(
    identityId: string,
    organizationId: string,
    unitId: string,
    input: TimeTrackingSettingsInput,
  ) {
    await this.requireRole(identityId, organizationId, unitId, ["owner"]);
    return this.database.db.transaction(async (tx) => {
      const previousSettings = await this.timeTrackingSettings(tx, organizationId, unitId);
      const additionalLocations = input.additionalLocations.map((location) => ({
        ...location,
        id: location.id ?? randomUUID(),
      }));
      if (
        new Set(additionalLocations.map((location) => location.id)).size !==
        additionalLocations.length
      ) {
        throw new BadRequestException({
          code: "TIME_TRACKING_LOCATION_DUPLICATE_ID",
          message: "Cada local permitido deve possuir uma identificação única.",
        });
      }
      const previousLocationPolicy = {
        locationLabel: previousSettings.locationLabel,
        locationAddress: previousSettings.locationAddress,
        latitude: previousSettings.latitude,
        longitude: previousSettings.longitude,
        radiusMeters: previousSettings.radiusMeters,
        accuracyToleranceMeters: previousSettings.accuracyToleranceMeters,
        maxLocationAccuracyMeters: previousSettings.maxLocationAccuracyMeters,
        lowAccuracyPolicy: previousSettings.lowAccuracyPolicy,
        additionalLocations: previousSettings.additionalLocations,
      };
      const nextLocationPolicy = {
        locationLabel: input.locationLabel ?? null,
        locationAddress: input.locationAddress ?? null,
        latitude: input.latitude ?? null,
        longitude: input.longitude ?? null,
        radiusMeters: input.radiusMeters,
        accuracyToleranceMeters: input.accuracyToleranceMeters,
        maxLocationAccuracyMeters: input.maxLocationAccuracyMeters,
        lowAccuracyPolicy: input.lowAccuracyPolicy,
        additionalLocations,
      };
      const previouslyConfigured =
        previousSettings.latitude !== null ||
        previousSettings.longitude !== null ||
        previousSettings.additionalLocations.length > 0;
      if (
        previouslyConfigured &&
        JSON.stringify(previousLocationPolicy) !== JSON.stringify(nextLocationPolicy) &&
        !input.locationChangeReason?.trim()
      ) {
        throw new BadRequestException({
          code: "TIME_TRACKING_LOCATION_CHANGE_REASON_REQUIRED",
          message: "Informe o motivo ao alterar uma localização de ponto já configurada.",
        });
      }
      const activePeople = await tx
        .select({ id: managementPeople.id, identityId: managementPeople.identityId })
        .from(managementPeople)
        .where(
          and(
            eq(managementPeople.organizationId, organizationId),
            eq(managementPeople.unitId, unitId),
            eq(managementPeople.active, true),
          ),
        );
      const activeIds = new Set(activePeople.map((person) => person.id));
      if (
        input.selectedPersonIds.some(
          (personId) =>
            !activeIds.has(personId) ||
            !activePeople.some((person) => person.id === personId && person.identityId),
        )
      ) {
        throw new BadRequestException({
          code: "TIME_TRACKING_PERSON_NOT_ACTIVE",
          message: "A seleção do ponto só pode conter funcionários ativos com conta vinculada.",
        });
      }
      const [settings] = await tx
        .insert(managementTimeTrackingSettings)
        .values({
          organizationId,
          unitId,
          mode: input.mode,
          geofenceEnabled: input.geofenceEnabled,
          locationLabel: input.locationLabel,
          locationAddress: input.locationAddress,
          latitude: input.latitude,
          longitude: input.longitude,
          radiusMeters: input.radiusMeters,
          accuracyToleranceMeters: input.accuracyToleranceMeters,
          maxLocationAccuracyMeters: input.maxLocationAccuracyMeters,
          lowAccuracyPolicy: input.lowAccuracyPolicy,
          additionalLocations,
          managerCanView: input.managerCanView,
          financeCanView: input.financeCanView,
          antiFraudEnabled: input.antiFraudEnabled,
          offlineEnabled: input.offlineEnabled,
          offlineMaxDelayMinutes: input.offlineMaxDelayMinutes,
          offlineRequiresJustification: input.offlineRequiresJustification,
          notificationsEnabled: input.notificationsEnabled,
          emailAlertsEnabled: input.emailAlertsEnabled,
          managerAlertOnAnomaly: input.managerAlertOnAnomaly,
          locationRetentionDays: input.locationRetentionDays,
          lateToleranceMinutes: input.lateToleranceMinutes,
          minimumBreakMinutes: input.minimumBreakMinutes,
          maxOvertimeMinutes: input.maxOvertimeMinutes,
          longShiftAlertMinutes: input.longShiftAlertMinutes,
          reminderBeforeShiftMinutes: input.reminderBeforeShiftMinutes,
          reminderAfterShiftMinutes: input.reminderAfterShiftMinutes,
          updatedByIdentityId: identityId,
        })
        .onConflictDoUpdate({
          target: [
            managementTimeTrackingSettings.organizationId,
            managementTimeTrackingSettings.unitId,
          ],
          set: {
            mode: input.mode,
            geofenceEnabled: input.geofenceEnabled,
            locationLabel: input.locationLabel,
            locationAddress: input.locationAddress,
            latitude: input.latitude,
            longitude: input.longitude,
            radiusMeters: input.radiusMeters,
            accuracyToleranceMeters: input.accuracyToleranceMeters,
            maxLocationAccuracyMeters: input.maxLocationAccuracyMeters,
            lowAccuracyPolicy: input.lowAccuracyPolicy,
            additionalLocations,
            managerCanView: input.managerCanView,
            financeCanView: input.financeCanView,
            antiFraudEnabled: input.antiFraudEnabled,
            offlineEnabled: input.offlineEnabled,
            offlineMaxDelayMinutes: input.offlineMaxDelayMinutes,
            offlineRequiresJustification: input.offlineRequiresJustification,
            notificationsEnabled: input.notificationsEnabled,
            emailAlertsEnabled: input.emailAlertsEnabled,
            managerAlertOnAnomaly: input.managerAlertOnAnomaly,
            locationRetentionDays: input.locationRetentionDays,
            lateToleranceMinutes: input.lateToleranceMinutes,
            minimumBreakMinutes: input.minimumBreakMinutes,
            maxOvertimeMinutes: input.maxOvertimeMinutes,
            longShiftAlertMinutes: input.longShiftAlertMinutes,
            reminderBeforeShiftMinutes: input.reminderBeforeShiftMinutes,
            reminderAfterShiftMinutes: input.reminderAfterShiftMinutes,
            updatedByIdentityId: identityId,
            updatedAt: new Date(),
          },
        })
        .returning();
      await tx
        .delete(managementTimeTrackingAssignments)
        .where(
          and(
            eq(managementTimeTrackingAssignments.organizationId, organizationId),
            eq(managementTimeTrackingAssignments.unitId, unitId),
          ),
        );
      if (input.mode === "selected") {
        await tx.insert(managementTimeTrackingAssignments).values(
          input.selectedPersonIds.map((personId) => ({
            organizationId,
            unitId,
            personId,
            updatedByIdentityId: identityId,
          })),
        );
      }
      await this.record(
        tx,
        identityId,
        organizationId,
        unitId,
        "management.time-tracking.settings.updated",
        "time_tracking_settings",
        settings?.id ?? `${organizationId}:${unitId}`,
        {
          mode: input.mode,
          selectedPersonIds: input.selectedPersonIds,
          locationChangeReason: input.locationChangeReason ?? null,
          previous: {
            ...previousLocationPolicy,
            offlineMaxDelayMinutes: previousSettings.offlineMaxDelayMinutes,
            locationRetentionDays: previousSettings.locationRetentionDays,
          },
          current: {
            ...nextLocationPolicy,
            offlineMaxDelayMinutes: input.offlineMaxDelayMinutes,
            locationRetentionDays: input.locationRetentionDays,
          },
        },
      );
      return { settings, selectedPersonIds: input.selectedPersonIds };
    });
  }

  async requestTimeCorrection(
    identityId: string,
    organizationId: string,
    unitId: string,
    idempotencyKey: string,
    input: TimeCorrectionInput,
  ) {
    await this.scope.requireUnitAccess(identityId, organizationId, unitId);
    return this.idempotent(
      identityId,
      organizationId,
      unitId,
      idempotencyKey,
      "self-time-entry-correction",
      input,
      async (tx) => {
        const person = await this.employeeForIdentity(tx, identityId, organizationId, unitId);
        if (!person) {
          throw new ForbiddenException({
            code: "TIME_TRACKING_EMPLOYEE_NOT_FOUND",
            message: "Sua conta não está vinculada a um funcionário desta unidade.",
          });
        }
        const [entry] = await tx
          .select()
          .from(managementTimeEntries)
          .where(
            and(
              eq(managementTimeEntries.organizationId, organizationId),
              eq(managementTimeEntries.unitId, unitId),
              eq(managementTimeEntries.id, input.timeEntryId),
              eq(managementTimeEntries.personId, person.id),
            ),
          )
          .limit(1);
        if (!entry) throw new NotFoundException({ code: "TIME_ENTRY_NOT_FOUND" });
        const entryDay = entry.clockedInAt.toISOString().slice(0, 10);
        const [closedPeriod] = await tx
          .select({ id: managementTimeTrackingClosures.id })
          .from(managementTimeTrackingClosures)
          .where(
            and(
              eq(managementTimeTrackingClosures.organizationId, organizationId),
              eq(managementTimeTrackingClosures.unitId, unitId),
              eq(managementTimeTrackingClosures.status, "closed"),
              lte(managementTimeTrackingClosures.periodStart, entryDay),
              gte(managementTimeTrackingClosures.periodEnd, entryDay),
            ),
          )
          .limit(1);
        const [pending] = await tx
          .select({ id: managementTimeCorrections.id })
          .from(managementTimeCorrections)
          .where(
            and(
              eq(managementTimeCorrections.organizationId, organizationId),
              eq(managementTimeCorrections.unitId, unitId),
              eq(managementTimeCorrections.timeEntryId, input.timeEntryId),
              eq(managementTimeCorrections.status, "pending"),
            ),
          )
          .limit(1);
        if (pending) {
          throw new ConflictException({
            code: "TIME_CORRECTION_ALREADY_PENDING",
            message: "Já existe uma correção aguardando análise para este turno.",
          });
        }
        const id = randomUUID();
        await tx.insert(managementTimeCorrections).values({
          id,
          organizationId,
          unitId,
          personId: person.id,
          timeEntryId: input.timeEntryId,
          requestedClockedInAt: new Date(input.clockedInAt),
          requestedClockedOutAt: input.clockedOutAt ? new Date(input.clockedOutAt) : null,
          reason: input.reason,
          requestedByIdentityId: identityId,
          requiresSpecialApproval: Boolean(closedPeriod),
        });
        await this.record(
          tx,
          identityId,
          organizationId,
          unitId,
          "management.time-entry.correction-requested",
          "time_entry_correction",
          id,
          { timeEntryId: input.timeEntryId, reason: input.reason },
        );
        return { correctionId: id, status: "pending" };
      },
    );
  }

  async decideTimeCorrection(
    identityId: string,
    organizationId: string,
    unitId: string,
    correctionId: string,
    input: TimeCorrectionDecisionInput,
  ) {
    const role = await this.requireRole(identityId, organizationId, unitId, PEOPLE_ROLES);
    return this.database.db.transaction(async (tx) => {
      await tx.execute(
        sql`select id from management_time_corrections where organization_id=${organizationId}::uuid and unit_id=${unitId}::uuid and id=${correctionId}::uuid for update`,
      );
      const [correction] = await tx
        .select()
        .from(managementTimeCorrections)
        .where(
          and(
            eq(managementTimeCorrections.organizationId, organizationId),
            eq(managementTimeCorrections.unitId, unitId),
            eq(managementTimeCorrections.id, correctionId),
          ),
        )
        .limit(1);
      if (!correction) throw new NotFoundException({ code: "TIME_CORRECTION_NOT_FOUND" });
      if (correction.requiresSpecialApproval && role !== "owner") {
        throw new ForbiddenException({
          code: "TIME_CORRECTION_SPECIAL_APPROVAL_REQUIRED",
          message: "Esta correção pertence a um período fechado e exige aprovação do proprietário.",
        });
      }
      if (correction.status !== "pending") {
        throw new ConflictException({
          code: "TIME_CORRECTION_ALREADY_DECIDED",
          message: "Esta correção já foi analisada.",
        });
      }
      const now = new Date();
      const nextStatus = input.decision === "approve" ? "approved" : "rejected";
      if (input.decision === "approve") {
        await tx.execute(
          sql`select id from management_time_entries where organization_id=${organizationId}::uuid and unit_id=${unitId}::uuid and id=${correction.timeEntryId}::uuid for update`,
        );
        const [entry] = await tx
          .select()
          .from(managementTimeEntries)
          .where(
            and(
              eq(managementTimeEntries.organizationId, organizationId),
              eq(managementTimeEntries.unitId, unitId),
              eq(managementTimeEntries.id, correction.timeEntryId),
            ),
          )
          .limit(1);
        if (!entry) throw new NotFoundException({ code: "TIME_ENTRY_NOT_FOUND" });
        const entryBreaks = await tx
          .select()
          .from(managementTimeEntryBreaks)
          .where(eq(managementTimeEntryBreaks.timeEntryId, entry.id));
        const requestedIn = correction.requestedClockedInAt.getTime();
        const requestedOut = correction.requestedClockedOutAt?.getTime() ?? null;
        if (
          entryBreaks.some(
            (item) =>
              item.startedAt.getTime() < requestedIn ||
              (requestedOut !== null && (item.endedAt?.getTime() ?? Infinity) > requestedOut),
          )
        ) {
          throw new BadRequestException({
            code: "TIME_CORRECTION_BREAK_OUTSIDE_WINDOW",
            message: "A correção não pode deixar uma pausa fora do turno.",
          });
        }
        await tx
          .update(managementTimeEntries)
          .set({
            clockedInAt: correction.requestedClockedInAt,
            clockedOutAt: correction.requestedClockedOutAt,
            updatedAt: now,
          })
          .where(eq(managementTimeEntries.id, entry.id));
      }
      await tx
        .update(managementTimeCorrections)
        .set({
          status: nextStatus,
          reviewedByIdentityId: identityId,
          reviewedAt: now,
          reviewNote: input.reviewNote,
          updatedAt: now,
        })
        .where(eq(managementTimeCorrections.id, correctionId));
      await this.record(
        tx,
        identityId,
        organizationId,
        unitId,
        `management.time-entry.correction-${nextStatus}`,
        "time_entry_correction",
        correctionId,
        { timeEntryId: correction.timeEntryId, reviewNote: input.reviewNote ?? null },
      );
      return { correctionId, status: nextStatus };
    });
  }

  async selfTimeTracking(identityId: string, organizationId: string, unitId: string) {
    await this.scope.requireUnitAccess(identityId, organizationId, unitId);
    const person = await this.employeeForIdentity(
      this.database.db,
      identityId,
      organizationId,
      unitId,
    );
    const settings = await this.timeTrackingSettings(this.database.db, organizationId, unitId);
    if (!person?.active || settings.mode === "off") {
      return {
        enabled: false,
        person: person ?? null,
        settings: timeTrackingSettingsWithoutCoordinates(settings),
        current: null,
        entries: [],
        breaks: [],
      };
    }
    let enabled = settings.mode === "all";
    if (settings.mode === "selected") {
      const [assignment] = await this.database.db
        .select({ enabled: managementTimeTrackingAssignments.enabled })
        .from(managementTimeTrackingAssignments)
        .where(
          and(
            eq(managementTimeTrackingAssignments.organizationId, organizationId),
            eq(managementTimeTrackingAssignments.unitId, unitId),
            eq(managementTimeTrackingAssignments.personId, person.id),
            eq(managementTimeTrackingAssignments.enabled, true),
          ),
        )
        .limit(1);
      enabled = Boolean(assignment);
    }
    if (!enabled)
      return {
        enabled: false,
        person,
        settings: timeTrackingSettingsWithoutCoordinates(settings),
        current: null,
        entries: [],
        breaks: [],
      };
    const entries = await this.database.db
      .select()
      .from(managementTimeEntries)
      .where(
        and(
          eq(managementTimeEntries.organizationId, organizationId),
          eq(managementTimeEntries.unitId, unitId),
          eq(managementTimeEntries.personId, person.id),
        ),
      )
      .orderBy(desc(managementTimeEntries.clockedInAt))
      .limit(100);
    const breaks = entries.length
      ? await this.database.db
          .select()
          .from(managementTimeEntryBreaks)
          .where(
            inArray(
              managementTimeEntryBreaks.timeEntryId,
              entries.map((entry) => entry.id),
            ),
          )
          .orderBy(desc(managementTimeEntryBreaks.startedAt))
      : [];
    const readableEntries = entries.map(timeTrackingEntryForRead);
    return {
      enabled: true,
      person,
      settings: timeTrackingSettingsWithoutCoordinates(settings),
      current: readableEntries.find((entry) => !entry.clockedOutAt) ?? null,
      entries: readableEntries,
      breaks: breaks.map(timeTrackingBreakForRead),
    };
  }

  async selfClockIn(
    identityId: string,
    organizationId: string,
    unitId: string,
    idempotencyKey: string,
    location: SelfClockInInput,
    context: PunchContext = {},
  ) {
    await this.scope.requireUnitAccess(identityId, organizationId, unitId);
    return this.idempotent(
      identityId,
      organizationId,
      unitId,
      idempotencyKey,
      "self-time-entry-clock-in",
      location,
      async (tx) => {
        const linkedPerson = await this.employeeForIdentity(tx, identityId, organizationId, unitId);
        if (linkedPerson)
          await tx.execute(
            sql`select pg_advisory_xact_lock(hashtextextended(${`person-status:${organizationId}:${unitId}:${linkedPerson.id}`}, 0))`,
          );
        const { person, settings } = await this.assertPunchEligibility(
          tx,
          identityId,
          organizationId,
          unitId,
        );
        const geofence = this.assertGeofence(settings, location);
        const timing = resolvePunchTiming(location, settings);
        const [openEntry] = await tx
          .select({ id: managementTimeEntries.id })
          .from(managementTimeEntries)
          .where(
            and(
              eq(managementTimeEntries.organizationId, organizationId),
              eq(managementTimeEntries.unitId, unitId),
              eq(managementTimeEntries.personId, person.id),
              isNull(managementTimeEntries.clockedOutAt),
            ),
          )
          .limit(1);
        if (openEntry) {
          throw new ConflictException({
            code: "TIME_ENTRY_ALREADY_OPEN",
            message: "Você já tem um turno aberto.",
          });
        }
        const id = randomUUID();
        const clockedInAt = timing.occurredAt;
        await this.assertTimeTrackingPeriodOpen(tx, organizationId, unitId, clockedInAt);
        const metadata = punchMetadata(
          timing.capturedAt,
          location,
          context,
          settings.antiFraudEnabled,
          timing.serverAt,
          geofence.flags,
        );
        await tx.insert(managementTimeEntries).values({
          id,
          organizationId,
          unitId,
          personId: person.id,
          clockedInAt,
          source: location.offline ? "self_offline" : "self",
          clockInLatitude: location.latitude,
          clockInLongitude: location.longitude,
          clockInAccuracyMeters: location.accuracyMeters,
          clockInServerAt: metadata.serverAt,
          clockInDeviceId: metadata.deviceId,
          clockInSessionId: metadata.sessionId,
          clockInIpAddress: metadata.ipAddress,
          clockInUserAgent: metadata.userAgent,
          clockInGeofenceLabel: geofence.locationLabel,
          clockInOfflineJustification: location.offlineJustification,
          clockInFlags: metadata.flags,
          idempotencyKey,
          recordedByIdentityId: identityId,
        });
        await this.record(
          tx,
          identityId,
          organizationId,
          unitId,
          "management.time-entry.clocked-in",
          "time_entry",
          id,
          {
            personId: person.id,
            source: location.offline ? "self_offline" : "self",
            locationLabel: geofence.locationLabel,
            distanceMeters: geofence.distanceMeters,
            flags: metadata.flags,
          },
        );
        await this.enqueueTimeTrackingAlert(
          tx,
          organizationId,
          unitId,
          identityId,
          id,
          metadata.flags,
          settings,
        );
        return { timeEntryId: id, personId: person.id, clockedInAt: clockedInAt.toISOString() };
      },
    );
  }

  async selfStartBreak(
    identityId: string,
    organizationId: string,
    unitId: string,
    idempotencyKey: string,
    input: SelfBreakInput,
    context: PunchContext = {},
  ) {
    await this.scope.requireUnitAccess(identityId, organizationId, unitId);
    return this.idempotent(
      identityId,
      organizationId,
      unitId,
      idempotencyKey,
      "self-time-entry-break-start",
      input,
      async (tx) => {
        const { person, settings } = await this.assertPunchEligibility(
          tx,
          identityId,
          organizationId,
          unitId,
        );
        const geofence = this.assertGeofence(settings, input);
        const timing = resolvePunchTiming(input, settings);
        await tx.execute(
          sql`select id from management_time_entries where organization_id=${organizationId}::uuid and unit_id=${unitId}::uuid and person_id=${person.id}::uuid and clocked_out_at is null for update`,
        );
        const [entry] = await tx
          .select()
          .from(managementTimeEntries)
          .where(
            and(
              eq(managementTimeEntries.organizationId, organizationId),
              eq(managementTimeEntries.unitId, unitId),
              eq(managementTimeEntries.personId, person.id),
              isNull(managementTimeEntries.clockedOutAt),
            ),
          )
          .limit(1);
        if (!entry)
          throw new ConflictException({
            code: "TIME_ENTRY_NOT_OPEN",
            message: "Registre sua entrada antes da pausa.",
          });
        const [openBreak] = await tx
          .select({ id: managementTimeEntryBreaks.id })
          .from(managementTimeEntryBreaks)
          .where(
            and(
              eq(managementTimeEntryBreaks.timeEntryId, entry.id),
              isNull(managementTimeEntryBreaks.endedAt),
            ),
          )
          .limit(1);
        if (openBreak)
          throw new ConflictException({
            code: "TIME_BREAK_ALREADY_OPEN",
            message: "Finalize a pausa atual antes de iniciar outra.",
          });
        const id = randomUUID();
        const startedAt = timing.occurredAt;
        const metadata = punchMetadata(
          timing.capturedAt,
          input,
          context,
          settings.antiFraudEnabled,
          timing.serverAt,
          geofence.flags,
        );
        await tx.insert(managementTimeEntryBreaks).values({
          id,
          organizationId,
          unitId,
          timeEntryId: entry.id,
          type: input.type,
          startedAt,
          startLatitude: input.latitude,
          startLongitude: input.longitude,
          startAccuracyMeters: input.accuracyMeters,
          startServerAt: metadata.serverAt,
          startDeviceId: metadata.deviceId,
          startSessionId: metadata.sessionId,
          startIpAddress: metadata.ipAddress,
          startUserAgent: metadata.userAgent,
          startGeofenceLabel: geofence.locationLabel,
          startOfflineJustification: input.offlineJustification,
          startFlags: metadata.flags,
          idempotencyKey,
          recordedByIdentityId: identityId,
        });
        await this.record(
          tx,
          identityId,
          organizationId,
          unitId,
          "management.time-entry.break-started",
          "time_entry_break",
          id,
          {
            timeEntryId: entry.id,
            type: input.type,
            locationLabel: geofence.locationLabel,
            distanceMeters: geofence.distanceMeters,
            flags: metadata.flags,
          },
        );
        return {
          breakId: id,
          timeEntryId: entry.id,
          startedAt: startedAt.toISOString(),
          type: input.type,
        };
      },
    );
  }

  async selfCompleteBreak(
    identityId: string,
    organizationId: string,
    unitId: string,
    breakId: string,
    idempotencyKey: string,
    location: SelfClockOutInput,
    context: PunchContext = {},
  ) {
    await this.scope.requireUnitAccess(identityId, organizationId, unitId);
    return this.idempotent(
      identityId,
      organizationId,
      unitId,
      idempotencyKey,
      "self-time-entry-break-end",
      { breakId, ...location },
      async (tx) => {
        const { person, settings } = await this.assertPunchEligibility(
          tx,
          identityId,
          organizationId,
          unitId,
        );
        const geofence = this.assertGeofence(settings, location);
        const timing = resolvePunchTiming(location, settings);
        await tx.execute(
          sql`select id from management_time_entry_breaks where organization_id=${organizationId}::uuid and unit_id=${unitId}::uuid and id=${breakId}::uuid for update`,
        );
        const [entryBreak] = await tx
          .select({ break: managementTimeEntryBreaks, entry: managementTimeEntries })
          .from(managementTimeEntryBreaks)
          .innerJoin(
            managementTimeEntries,
            eq(managementTimeEntries.id, managementTimeEntryBreaks.timeEntryId),
          )
          .where(
            and(
              eq(managementTimeEntryBreaks.organizationId, organizationId),
              eq(managementTimeEntryBreaks.unitId, unitId),
              eq(managementTimeEntryBreaks.id, breakId),
              eq(managementTimeEntries.personId, person.id),
            ),
          )
          .limit(1);
        if (!entryBreak)
          throw new NotFoundException({
            code: "TIME_BREAK_NOT_FOUND",
            message: "Pausa não encontrada.",
          });
        if (entryBreak.break.endedAt)
          throw new ConflictException({
            code: "TIME_BREAK_ALREADY_CLOSED",
            message: "A pausa já foi finalizada.",
          });
        const endedAt = timing.occurredAt;
        const metadata = punchMetadata(
          timing.capturedAt,
          location,
          context,
          settings.antiFraudEnabled,
          timing.serverAt,
          geofence.flags,
        );
        await tx
          .update(managementTimeEntryBreaks)
          .set({
            endedAt,
            endLatitude: location.latitude,
            endLongitude: location.longitude,
            endAccuracyMeters: location.accuracyMeters,
            endServerAt: metadata.serverAt,
            endDeviceId: metadata.deviceId,
            endSessionId: metadata.sessionId,
            endIpAddress: metadata.ipAddress,
            endUserAgent: metadata.userAgent,
            endGeofenceLabel: geofence.locationLabel,
            endOfflineJustification: location.offlineJustification,
            endFlags: metadata.flags,
            updatedAt: metadata.serverAt,
          })
          .where(eq(managementTimeEntryBreaks.id, breakId));
        await this.record(
          tx,
          identityId,
          organizationId,
          unitId,
          "management.time-entry.break-ended",
          "time_entry_break",
          breakId,
          {
            timeEntryId: entryBreak.entry.id,
            locationLabel: geofence.locationLabel,
            distanceMeters: geofence.distanceMeters,
            flags: metadata.flags,
          },
        );
        return { breakId, timeEntryId: entryBreak.entry.id, endedAt: endedAt.toISOString() };
      },
    );
  }

  async selfClockOut(
    identityId: string,
    organizationId: string,
    unitId: string,
    idempotencyKey: string,
    location: SelfClockOutInput,
    context: PunchContext = {},
  ) {
    await this.scope.requireUnitAccess(identityId, organizationId, unitId);
    return this.idempotent(
      identityId,
      organizationId,
      unitId,
      idempotencyKey,
      "self-time-entry-clock-out",
      location,
      async (tx) => {
        const { person, settings } = await this.assertPunchEligibility(
          tx,
          identityId,
          organizationId,
          unitId,
        );
        const geofence = this.assertGeofence(settings, location);
        const timing = resolvePunchTiming(location, settings);
        await tx.execute(
          sql`select id from management_time_entries where organization_id=${organizationId}::uuid and unit_id=${unitId}::uuid and person_id=${person.id}::uuid and clocked_out_at is null for update`,
        );
        const [entry] = await tx
          .select()
          .from(managementTimeEntries)
          .where(
            and(
              eq(managementTimeEntries.organizationId, organizationId),
              eq(managementTimeEntries.unitId, unitId),
              eq(managementTimeEntries.personId, person.id),
              isNull(managementTimeEntries.clockedOutAt),
            ),
          )
          .limit(1);
        if (!entry)
          throw new ConflictException({
            code: "TIME_ENTRY_NOT_OPEN",
            message: "Não há turno aberto para finalizar.",
          });
        const [openBreak] = await tx
          .select({ id: managementTimeEntryBreaks.id })
          .from(managementTimeEntryBreaks)
          .where(
            and(
              eq(managementTimeEntryBreaks.timeEntryId, entry.id),
              isNull(managementTimeEntryBreaks.endedAt),
            ),
          )
          .limit(1);
        if (openBreak)
          throw new ConflictException({
            code: "TIME_BREAK_OPEN",
            message: "Finalize a pausa antes de encerrar o turno.",
          });
        const clockedOutAt = timing.occurredAt;
        if (clockedOutAt <= entry.clockedInAt) {
          throw new BadRequestException({
            code: "INVALID_TIME_ENTRY_WINDOW",
            message: "A saída deve ser posterior à entrada.",
          });
        }
        const metadata = punchMetadata(
          timing.capturedAt,
          location,
          context,
          settings.antiFraudEnabled,
          timing.serverAt,
          geofence.flags,
        );
        await tx
          .update(managementTimeEntries)
          .set({
            clockedOutAt,
            clockOutLatitude: location.latitude,
            clockOutLongitude: location.longitude,
            clockOutAccuracyMeters: location.accuracyMeters,
            clockOutServerAt: metadata.serverAt,
            clockOutDeviceId: metadata.deviceId,
            clockOutSessionId: metadata.sessionId,
            clockOutIpAddress: metadata.ipAddress,
            clockOutUserAgent: metadata.userAgent,
            clockOutGeofenceLabel: geofence.locationLabel,
            clockOutOfflineJustification: location.offlineJustification,
            clockOutFlags: metadata.flags,
            updatedAt: metadata.serverAt,
          })
          .where(eq(managementTimeEntries.id, entry.id));
        await this.record(
          tx,
          identityId,
          organizationId,
          unitId,
          "management.time-entry.clocked-out",
          "time_entry",
          entry.id,
          {
            personId: person.id,
            locationLabel: geofence.locationLabel,
            distanceMeters: geofence.distanceMeters,
            flags: metadata.flags,
          },
        );
        await this.enqueueTimeTrackingAlert(
          tx,
          organizationId,
          unitId,
          identityId,
          entry.id,
          metadata.flags,
          settings,
        );
        return {
          timeEntryId: entry.id,
          personId: person.id,
          clockedOutAt: clockedOutAt.toISOString(),
        };
      },
    );
  }

  async peopleAccessCenter(identityId: string, organizationId: string, unitId: string) {
    await this.requireRole(identityId, organizationId, unitId, PEOPLE_ROLES);
    if (!this.terminals) {
      throw new ServiceUnavailableException({ code: "TERMINAL_ADMIN_UNAVAILABLE" });
    }
    return { terminals: await this.terminals.listForScope(organizationId, unitId) };
  }

  async revokeManagedTerminal(
    identityId: string,
    organizationId: string,
    unitId: string,
    terminalSessionId: string,
    reason: string,
  ) {
    await this.requireRole(identityId, organizationId, unitId, PEOPLE_ROLES);
    if (!this.terminals) {
      throw new ServiceUnavailableException({ code: "TERMINAL_ADMIN_UNAVAILABLE" });
    }
    return this.terminals.revokeForScope(
      identityId,
      organizationId,
      unitId,
      terminalSessionId,
      reason,
    );
  }

  async personAccessOverview(
    identityId: string,
    organizationId: string,
    unitId: string,
    personId: string,
  ) {
    await this.requireRole(identityId, organizationId, unitId, PEOPLE_ROLES);
    const [person] = await this.database.db
      .select({
        id: managementPeople.id,
        identityId: managementPeople.identityId,
        primaryUnitId: managementPeople.unitId,
      })
      .from(managementPeople)
      .where(
        and(
          eq(managementPeople.id, personId),
          eq(managementPeople.organizationId, organizationId),
          eq(managementPeople.unitId, unitId),
        ),
      )
      .limit(1);
    if (!person) throw new NotFoundException({ code: "PERSON_NOT_FOUND" });

    const [accessRows, organizationUnits, history, offboarding] = await Promise.all([
      this.database.db
        .select({
          access: managementPersonAccess,
          unitName: units.name,
          invitationExpiresAt: membershipInvitations.expiresAt,
        })
        .from(managementPersonAccess)
        .innerJoin(units, eq(units.id, managementPersonAccess.unitId))
        .leftJoin(
          membershipInvitations,
          eq(membershipInvitations.id, managementPersonAccess.invitationId),
        )
        .where(
          and(
            eq(managementPersonAccess.organizationId, organizationId),
            eq(managementPersonAccess.personId, personId),
          ),
        )
        .orderBy(asc(units.name)),
      this.database.db
        .select({ id: units.id, name: units.name, active: units.active })
        .from(units)
        .where(eq(units.organizationId, organizationId))
        .orderBy(asc(units.name)),
      this.database.db
        .select({
          id: auditEvents.id,
          action: auditEvents.action,
          actorName: identities.displayName,
          metadata: auditEvents.metadata,
          occurredAt: auditEvents.occurredAt,
        })
        .from(auditEvents)
        .leftJoin(identities, eq(identities.id, auditEvents.actorIdentityId))
        .where(
          and(
            eq(auditEvents.organizationId, organizationId),
            eq(auditEvents.entityId, personId),
            inArray(auditEvents.entityType, ["person", "person_access"]),
          ),
        )
        .orderBy(desc(auditEvents.occurredAt))
        .limit(50),
      this.personOffboardingFacts(this.database.db, organizationId, personId, person.identityId),
    ]);
    const invitationIds = accessRows
      .map((row) => row.access.invitationId)
      .filter((id): id is string => Boolean(id));
    const deliveries = invitationIds.length
      ? await this.database.db
          .select({
            invitationId: outboxEvents.aggregateId,
            attempts: outboxEvents.attempts,
            processedAt: outboxEvents.processedAt,
            lastError: outboxEvents.lastError,
          })
          .from(outboxEvents)
          .where(
            and(
              eq(outboxEvents.topic, "membership.invited"),
              inArray(outboxEvents.aggregateId, invitationIds),
            ),
          )
      : [];
    const deliveryByInvitation = new Map(
      deliveries.map((delivery) => [delivery.invitationId, delivery]),
    );

    return {
      units: organizationUnits,
      assignments: accessRows.map((row) => {
        const delivery = row.access.invitationId
          ? deliveryByInvitation.get(row.access.invitationId)
          : undefined;
        return {
          unitId: row.access.unitId,
          unitName: row.unitName,
          primary: row.access.unitId === person.primaryUnitId,
          access: personAccessView({
            ...row.access,
            invitationExpiresAt: row.invitationExpiresAt,
          }),
          delivery: delivery
            ? {
                status: delivery.processedAt
                  ? ("sent" as const)
                  : delivery.lastError
                    ? ("failed" as const)
                    : ("queued" as const),
                attempts: delivery.attempts,
                processedAt: delivery.processedAt?.toISOString() ?? null,
                lastError: delivery.lastError,
              }
            : null,
        };
      }),
      history: history.map((event) => ({
        ...event,
        actorName: event.actorName ?? "Sistema",
        occurredAt: event.occurredAt.toISOString(),
      })),
      offboarding,
    };
  }

  async personOffboardingPreflight(
    identityId: string,
    organizationId: string,
    unitId: string,
    personId: string,
  ) {
    await this.requireRole(identityId, organizationId, unitId, PEOPLE_ROLES);
    const [person] = await this.database.db
      .select({ identityId: managementPeople.identityId })
      .from(managementPeople)
      .where(
        and(
          eq(managementPeople.organizationId, organizationId),
          eq(managementPeople.unitId, unitId),
          eq(managementPeople.id, personId),
        ),
      )
      .limit(1);
    if (!person) throw new NotFoundException({ code: "PERSON_NOT_FOUND" });
    return this.personOffboardingFacts(
      this.database.db,
      organizationId,
      personId,
      person.identityId,
    );
  }

  async assignPersonUnitAccess(
    identityId: string,
    organizationId: string,
    unitId: string,
    personId: string,
    input: PersonUnitAccessInput,
  ) {
    await this.requireRole(identityId, organizationId, unitId, PEOPLE_ROLES);
    const targetActorRole = await this.requireRole(
      identityId,
      organizationId,
      input.unitId,
      PEOPLE_ROLES,
    );
    this.assertPersonAccessGrant(targetActorRole, input.role);
    await this.requireSensitiveAccessStepUp(identityId, input.role, input.reauth);
    return this.database.db.transaction(async (tx) => {
      await tx.execute(
        sql`select pg_advisory_xact_lock(hashtextextended(${`person-access:${organizationId}:${input.unitId}:${personId}`}, 0))`,
      );
      const [person] = await tx
        .select({ id: managementPeople.id, identityId: managementPeople.identityId })
        .from(managementPeople)
        .where(
          and(
            eq(managementPeople.id, personId),
            eq(managementPeople.organizationId, organizationId),
            eq(managementPeople.unitId, unitId),
            eq(managementPeople.active, true),
          ),
        )
        .limit(1);
      if (!person?.identityId) {
        throw new ConflictException({
          code: "PERSON_ACCESS_MUST_BE_ACTIVE",
          message: "Aceite o primeiro convite antes de liberar outras unidades.",
        });
      }
      const [[targetUnit], [sourceAccess], [existing]] = await Promise.all([
        tx
          .select({ id: units.id })
          .from(units)
          .where(
            and(
              eq(units.id, input.unitId),
              eq(units.organizationId, organizationId),
              eq(units.active, true),
            ),
          )
          .limit(1),
        tx
          .select()
          .from(managementPersonAccess)
          .where(
            and(
              eq(managementPersonAccess.organizationId, organizationId),
              eq(managementPersonAccess.unitId, unitId),
              eq(managementPersonAccess.personId, personId),
              eq(managementPersonAccess.status, "active"),
              isNotNull(managementPersonAccess.membershipId),
            ),
          )
          .limit(1),
        tx
          .select()
          .from(managementPersonAccess)
          .where(
            and(
              eq(managementPersonAccess.organizationId, organizationId),
              eq(managementPersonAccess.unitId, input.unitId),
              eq(managementPersonAccess.personId, personId),
            ),
          )
          .limit(1),
      ]);
      if (!targetUnit) throw new NotFoundException({ code: "UNIT_NOT_FOUND" });
      if (!sourceAccess?.membershipId) {
        throw new ConflictException({ code: "PERSON_ACCESS_MUST_BE_ACTIVE" });
      }
      if (existing && existing.status !== "terminated" && existing.status !== "canceled") {
        throw new ConflictException({ code: "PERSON_UNIT_ACCESS_ALREADY_EXISTS" });
      }
      const roleBindingId = await this.ensurePersonRoleBinding(
        tx,
        sourceAccess.membershipId,
        input.unitId,
        input.role,
      );
      const changedAt = new Date();
      const values = {
        email: sourceAccess.email,
        role: input.role,
        status: "active" as const,
        invitationId: null,
        membershipId: sourceAccess.membershipId,
        roleBindingId,
        statusChangedAt: changedAt,
        statusChangedByIdentityId: identityId,
        statusChangeReason: input.reason,
        updatedAt: changedAt,
      };
      if (existing) {
        await tx
          .update(managementPersonAccess)
          .set(values)
          .where(
            and(
              eq(managementPersonAccess.personId, personId),
              eq(managementPersonAccess.unitId, input.unitId),
            ),
          );
      } else {
        await tx.insert(managementPersonAccess).values({
          personId,
          organizationId,
          unitId: input.unitId,
          ...values,
        });
      }
      await this.revokeIdentitySessions(tx, person.identityId);
      await this.record(
        tx,
        identityId,
        organizationId,
        input.unitId,
        "management.person.access.unit-assigned",
        "person_access",
        personId,
        { role: input.role, reason: input.reason, sourceUnitId: unitId },
      );
      return { assigned: true, unitId: input.unitId, role: input.role };
    });
  }

  async removePersonUnitAccess(
    identityId: string,
    organizationId: string,
    unitId: string,
    personId: string,
    targetUnitId: string,
    input: PersonUnitAccessRemovalInput,
  ) {
    await this.requireRole(identityId, organizationId, unitId, PEOPLE_ROLES);
    const targetActorRole = await this.requireRole(
      identityId,
      organizationId,
      targetUnitId,
      PEOPLE_ROLES,
    );
    return this.database.db.transaction(async (tx) => {
      await tx.execute(
        sql`select pg_advisory_xact_lock(hashtextextended(${`person-access:${organizationId}:${targetUnitId}:${personId}`}, 0))`,
      );
      const [person] = await tx
        .select({ primaryUnitId: managementPeople.unitId, identityId: managementPeople.identityId })
        .from(managementPeople)
        .where(
          and(
            eq(managementPeople.id, personId),
            eq(managementPeople.organizationId, organizationId),
            eq(managementPeople.unitId, unitId),
          ),
        )
        .limit(1);
      if (!person) throw new NotFoundException({ code: "PERSON_NOT_FOUND" });
      if (person.primaryUnitId === targetUnitId) {
        throw new ConflictException({
          code: "PERSON_PRIMARY_UNIT_ACCESS",
          message: "Suspenda o acesso principal pela ficha da pessoa.",
        });
      }
      const access = await this.lockedPersonAccess(tx, organizationId, targetUnitId, personId);
      this.assertPersonAccessGrant(targetActorRole, access.role);
      await this.requireSensitiveAccessStepUp(identityId, access.role, input.reauth);
      if (access.roleBindingId) {
        await tx.delete(roleBindings).where(eq(roleBindings.id, access.roleBindingId));
      }
      const changedAt = new Date();
      await tx
        .update(managementPersonAccess)
        .set({
          status: "terminated",
          roleBindingId: null,
          statusChangedAt: changedAt,
          statusChangedByIdentityId: identityId,
          statusChangeReason: input.reason,
          updatedAt: changedAt,
        })
        .where(
          and(
            eq(managementPersonAccess.personId, personId),
            eq(managementPersonAccess.unitId, targetUnitId),
          ),
        );
      if (access.membershipId) {
        await tx
          .update(terminalSessions)
          .set({
            activeActorMembershipId: null,
            actorEpoch: sql`${terminalSessions.actorEpoch} + 1`,
            lastActivityAt: null,
            updatedAt: changedAt,
          })
          .where(
            and(
              eq(terminalSessions.organizationId, organizationId),
              eq(terminalSessions.unitId, targetUnitId),
              eq(terminalSessions.activeActorMembershipId, access.membershipId),
              isNull(terminalSessions.revokedAt),
            ),
          );
        await this.disableMembershipWithoutRoles(tx, access.membershipId);
      }
      await this.revokeIdentitySessions(tx, person.identityId);
      await this.record(
        tx,
        identityId,
        organizationId,
        targetUnitId,
        "management.person.access.unit-removed",
        "person_access",
        personId,
        { role: access.role, reason: input.reason, sourceUnitId: unitId },
      );
      return { removed: true, unitId: targetUnitId };
    });
  }

  async createPerson(
    identityId: string,
    organizationId: string,
    unitId: string,
    input: PersonInput,
  ) {
    const actorRole = await this.requireRole(identityId, organizationId, unitId, PEOPLE_ROLES);
    if (input.access) {
      this.assertPersonAccessGrant(actorRole, input.access.role);
      await this.requireSensitiveAccessStepUp(identityId, input.access.role, input.access.reauth);
    }
    if (input.identityId && input.access) {
      throw new BadRequestException({
        code: "PERSON_ACCESS_AMBIGUOUS",
        message: "Use identityId para vínculo existente ou access para convite, não ambos.",
      });
    }
    return this.database.db.transaction(async (tx) => {
      if (input.identityId) {
        const [membership] = await tx
          .select({ id: memberships.id })
          .from(memberships)
          .innerJoin(roleBindings, eq(roleBindings.membershipId, memberships.id))
          .where(
            and(
              eq(memberships.organizationId, organizationId),
              eq(memberships.identityId, input.identityId),
              eq(memberships.status, "active"),
              or(isNull(roleBindings.unitId), eq(roleBindings.unitId, unitId)),
            ),
          )
          .limit(1);
        if (!membership) {
          throw new NotFoundException({
            code: "PERSON_IDENTITY_NOT_IN_UNIT",
            message: "A identidade informada não possui vínculo ativo com esta unidade.",
          });
        }
        const [linked] = await tx
          .select({ id: managementPeople.id })
          .from(managementPeople)
          .where(
            and(
              eq(managementPeople.organizationId, organizationId),
              eq(managementPeople.unitId, unitId),
              eq(managementPeople.identityId, input.identityId),
            ),
          )
          .limit(1);
        if (linked) throw new ConflictException({ code: "PERSON_IDENTITY_ALREADY_LINKED" });
      }
      const { access: accessInput, ...personInput } = input;
      const id = randomUUID();
      const [person] = await tx
        .insert(managementPeople)
        .values({ id, organizationId, unitId, ...personInput })
        .returning();
      if (!person) throw new Error("Person was not created");
      await this.record(
        tx,
        identityId,
        organizationId,
        unitId,
        "management.person.created",
        "person",
        id,
        { identityId: input.identityId ?? null, accessInvited: Boolean(accessInput) },
      );
      const access = accessInput
        ? await this.createPersonAccessInvitation(
            tx,
            identityId,
            organizationId,
            unitId,
            id,
            accessInput,
            false,
          )
        : { status: "none" as const };
      return { ...person, access };
    });
  }

  async invitePersonAccess(
    identityId: string,
    organizationId: string,
    unitId: string,
    personId: string,
    input: PersonAccessInviteInput,
  ) {
    const actorRole = await this.requireRole(identityId, organizationId, unitId, PEOPLE_ROLES);
    this.assertPersonAccessGrant(actorRole, input.role);
    await this.requireSensitiveAccessStepUp(identityId, input.role, input.reauth);
    return this.database.db.transaction(async (tx) => {
      await tx.execute(
        sql`select pg_advisory_xact_lock(hashtextextended(${`person-access:${organizationId}:${unitId}:${personId}`}, 0))`,
      );
      return this.createPersonAccessInvitation(
        tx,
        identityId,
        organizationId,
        unitId,
        personId,
        input,
        false,
      );
    });
  }

  async resendPersonAccess(
    identityId: string,
    organizationId: string,
    unitId: string,
    personId: string,
  ) {
    const actorRole = await this.requireRole(identityId, organizationId, unitId, PEOPLE_ROLES);
    return this.database.db.transaction(async (tx) => {
      await tx.execute(
        sql`select pg_advisory_xact_lock(hashtextextended(${`person-access:${organizationId}:${unitId}:${personId}`}, 0))`,
      );
      const access = await this.lockedPersonAccess(tx, organizationId, unitId, personId);
      this.assertPersonAccessGrant(actorRole, access.role);
      if (access.status !== "pending") {
        throw new ConflictException({ code: "PERSON_ACCESS_NOT_PENDING" });
      }
      return this.createPersonAccessInvitation(
        tx,
        identityId,
        organizationId,
        unitId,
        personId,
        { email: access.email, role: access.role },
        true,
      );
    });
  }

  async cancelPersonAccess(
    identityId: string,
    organizationId: string,
    unitId: string,
    personId: string,
    input: PersonStatusInput,
  ) {
    const actorRole = await this.requireRole(identityId, organizationId, unitId, PEOPLE_ROLES);
    return this.database.db.transaction(async (tx) => {
      const access = await this.lockedPersonAccess(tx, organizationId, unitId, personId);
      this.assertPersonAccessGrant(actorRole, access.role);
      if (access.status !== "pending") {
        throw new ConflictException({ code: "PERSON_ACCESS_NOT_PENDING" });
      }
      if (access.invitationId) {
        await tx
          .update(membershipInvitations)
          .set({ acceptedAt: new Date() })
          .where(
            and(
              eq(membershipInvitations.id, access.invitationId),
              isNull(membershipInvitations.acceptedAt),
            ),
          );
      }
      const changedAt = new Date();
      await tx
        .update(managementPersonAccess)
        .set({
          status: "canceled",
          statusChangedAt: changedAt,
          statusChangedByIdentityId: identityId,
          statusChangeReason: input.reason,
          updatedAt: changedAt,
        })
        .where(
          and(
            eq(managementPersonAccess.organizationId, organizationId),
            eq(managementPersonAccess.unitId, unitId),
            eq(managementPersonAccess.personId, personId),
          ),
        );
      await this.record(
        tx,
        identityId,
        organizationId,
        unitId,
        "management.person.access.canceled",
        "person_access",
        personId,
        { reason: input.reason, invitationId: access.invitationId },
      );
      return { status: "none" as const };
    });
  }

  async updatePersonAccess(
    identityId: string,
    organizationId: string,
    unitId: string,
    personId: string,
    input: PersonAccessRoleUpdateInput,
  ) {
    const actorRole = await this.requireRole(identityId, organizationId, unitId, PEOPLE_ROLES);
    this.assertPersonAccessGrant(actorRole, input.role);
    return this.database.db.transaction(async (tx) => {
      const access = await this.lockedPersonAccess(tx, organizationId, unitId, personId);
      await this.requireSensitiveAccessStepUp(
        identityId,
        SENSITIVE_PERSON_ACCESS_ROLES.has(access.role) ? access.role : input.role,
        input.reauth,
      );
      if (access.status === "canceled" || access.status === "terminated") {
        throw new ConflictException({ code: "PERSON_ACCESS_INACTIVE" });
      }
      let roleBindingId = access.roleBindingId;
      if (access.status === "pending" && access.invitationId) {
        await tx
          .update(membershipInvitations)
          .set({ role: input.role })
          .where(
            and(
              eq(membershipInvitations.id, access.invitationId),
              isNull(membershipInvitations.acceptedAt),
            ),
          );
      }
      if (access.status === "active") {
        if (!access.membershipId) throw new ConflictException({ code: "PERSON_ACCESS_CORRUPT" });
        if (access.roleBindingId) {
          await tx.delete(roleBindings).where(eq(roleBindings.id, access.roleBindingId));
        }
        roleBindingId = await this.ensurePersonRoleBinding(
          tx,
          access.membershipId,
          unitId,
          input.role,
        );
      }
      const changedAt = new Date();
      const [updated] = await tx
        .update(managementPersonAccess)
        .set({
          role: input.role,
          roleBindingId,
          statusChangedAt: changedAt,
          statusChangedByIdentityId: identityId,
          statusChangeReason: input.reason,
          updatedAt: changedAt,
        })
        .where(
          and(
            eq(managementPersonAccess.organizationId, organizationId),
            eq(managementPersonAccess.unitId, unitId),
            eq(managementPersonAccess.personId, personId),
          ),
        )
        .returning();
      const [person] = await tx
        .select({ identityId: managementPeople.identityId })
        .from(managementPeople)
        .where(eq(managementPeople.id, personId))
        .limit(1);
      await this.revokeIdentitySessions(tx, person?.identityId ?? null);
      await this.record(
        tx,
        identityId,
        organizationId,
        unitId,
        "management.person.access.role-changed",
        "person_access",
        personId,
        { previousRole: access.role, role: input.role, reason: input.reason },
      );
      if (!updated) throw new NotFoundException({ code: "PERSON_ACCESS_NOT_FOUND" });
      const [invitation] = updated.invitationId
        ? await tx
            .select({ expiresAt: membershipInvitations.expiresAt })
            .from(membershipInvitations)
            .where(eq(membershipInvitations.id, updated.invitationId))
            .limit(1)
        : [];
      return personAccessView({
        ...updated,
        invitationExpiresAt: invitation?.expiresAt ?? null,
      });
    });
  }

  async suspendPersonAccess(
    identityId: string,
    organizationId: string,
    unitId: string,
    personId: string,
    input: PersonStatusInput,
  ) {
    const actorRole = await this.requireRole(identityId, organizationId, unitId, PEOPLE_ROLES);
    return this.database.db.transaction(async (tx) => {
      const access = await this.lockedPersonAccess(tx, organizationId, unitId, personId);
      this.assertPersonAccessGrant(actorRole, access.role);
      if (access.status !== "active") {
        throw new ConflictException({ code: "PERSON_ACCESS_NOT_ACTIVE" });
      }
      if (access.roleBindingId) {
        await tx.delete(roleBindings).where(eq(roleBindings.id, access.roleBindingId));
      }
      const changedAt = new Date();
      const [updated] = await tx
        .update(managementPersonAccess)
        .set({
          status: "suspended",
          roleBindingId: null,
          statusChangedAt: changedAt,
          statusChangedByIdentityId: identityId,
          statusChangeReason: input.reason,
          updatedAt: changedAt,
        })
        .where(
          and(
            eq(managementPersonAccess.organizationId, organizationId),
            eq(managementPersonAccess.unitId, unitId),
            eq(managementPersonAccess.personId, personId),
          ),
        )
        .returning();
      const [person] = await tx
        .select({ identityId: managementPeople.identityId })
        .from(managementPeople)
        .where(eq(managementPeople.id, personId))
        .limit(1);
      await this.disableMembershipWithoutRoles(tx, access.membershipId);
      await this.revokeIdentitySessions(tx, person?.identityId ?? null);
      await this.record(
        tx,
        identityId,
        organizationId,
        unitId,
        "management.person.access.suspended",
        "person_access",
        personId,
        { reason: input.reason, role: access.role },
      );
      if (!updated) throw new NotFoundException({ code: "PERSON_ACCESS_NOT_FOUND" });
      return personAccessView({ ...updated, invitationExpiresAt: null });
    });
  }

  async reactivatePersonAccess(
    identityId: string,
    organizationId: string,
    unitId: string,
    personId: string,
    input: PersonAccessReactivateInput,
  ) {
    const actorRole = await this.requireRole(identityId, organizationId, unitId, PEOPLE_ROLES);
    return this.database.db.transaction(async (tx) => {
      const access = await this.lockedPersonAccess(tx, organizationId, unitId, personId);
      if (access.status !== "suspended") {
        throw new ConflictException({ code: "PERSON_ACCESS_NOT_SUSPENDED" });
      }
      const targetRole = input.role ?? access.role;
      this.assertPersonAccessGrant(actorRole, targetRole);
      await this.requireSensitiveAccessStepUp(identityId, targetRole, input.reauth);
      if (!access.membershipId) throw new ConflictException({ code: "PERSON_ACCESS_CORRUPT" });
      const [person] = await tx
        .select({ active: managementPeople.active, identityId: managementPeople.identityId })
        .from(managementPeople)
        .where(
          and(
            eq(managementPeople.organizationId, organizationId),
            eq(managementPeople.unitId, unitId),
            eq(managementPeople.id, personId),
          ),
        )
        .limit(1);
      if (!person) throw new NotFoundException({ code: "PERSON_NOT_FOUND" });
      if (!person.active) throw new ConflictException({ code: "PERSON_INACTIVE" });
      await tx
        .update(memberships)
        .set({ status: "active", updatedAt: new Date() })
        .where(eq(memberships.id, access.membershipId));
      const roleBindingId = await this.ensurePersonRoleBinding(
        tx,
        access.membershipId,
        unitId,
        targetRole,
      );
      const changedAt = new Date();
      const [updated] = await tx
        .update(managementPersonAccess)
        .set({
          status: "active",
          role: targetRole,
          roleBindingId,
          statusChangedAt: changedAt,
          statusChangedByIdentityId: identityId,
          statusChangeReason: input.reason,
          updatedAt: changedAt,
        })
        .where(
          and(
            eq(managementPersonAccess.organizationId, organizationId),
            eq(managementPersonAccess.unitId, unitId),
            eq(managementPersonAccess.personId, personId),
          ),
        )
        .returning();
      await this.revokeIdentitySessions(tx, person.identityId);
      await this.record(
        tx,
        identityId,
        organizationId,
        unitId,
        "management.person.access.reactivated",
        "person_access",
        personId,
        { reason: input.reason, role: targetRole },
      );
      if (!updated) throw new NotFoundException({ code: "PERSON_ACCESS_NOT_FOUND" });
      return personAccessView({ ...updated, invitationExpiresAt: null });
    });
  }

  async updatePerson(
    identityId: string,
    organizationId: string,
    unitId: string,
    personId: string,
    input: PersonUpdateInput,
  ) {
    await this.requireRole(identityId, organizationId, unitId, PEOPLE_ROLES);
    return this.database.db.transaction(async (tx) => {
      await tx.execute(
        sql`select pg_advisory_xact_lock(hashtextextended(${`person-status:${organizationId}:${unitId}:${personId}`}, 0))`,
      );
      await tx.execute(
        sql`select id from management_people where organization_id=${organizationId}::uuid and unit_id=${unitId}::uuid and id=${personId}::uuid for update`,
      );
      const [current] = await tx
        .select()
        .from(managementPeople)
        .where(
          and(
            eq(managementPeople.organizationId, organizationId),
            eq(managementPeople.unitId, unitId),
            eq(managementPeople.id, personId),
          ),
        )
        .limit(1);
      if (!current) throw new NotFoundException({ code: "PERSON_NOT_FOUND" });
      if (input.expectedUpdatedAt && current.updatedAt.toISOString() !== input.expectedUpdatedAt) {
        throw new ConflictException({
          code: "PERSON_CHANGED",
          message: "A pessoa foi alterada por outro usuário. Atualize os dados e tente novamente.",
        });
      }
      if (input.identityId) {
        const [membership, linkedPeople] = await Promise.all([
          tx
            .select({ id: memberships.id })
            .from(memberships)
            .innerJoin(roleBindings, eq(roleBindings.membershipId, memberships.id))
            .where(
              and(
                eq(memberships.organizationId, organizationId),
                eq(memberships.identityId, input.identityId),
                eq(memberships.status, "active"),
                or(isNull(roleBindings.unitId), eq(roleBindings.unitId, unitId)),
              ),
            )
            .limit(1),
          tx
            .select({ id: managementPeople.id })
            .from(managementPeople)
            .where(
              and(
                eq(managementPeople.organizationId, organizationId),
                eq(managementPeople.unitId, unitId),
                eq(managementPeople.identityId, input.identityId),
                sql`${managementPeople.id} <> ${personId}::uuid`,
              ),
            )
            .limit(1),
        ]);
        if (!membership) throw new NotFoundException({ code: "PERSON_IDENTITY_NOT_IN_UNIT" });
        if (linkedPeople.length)
          throw new ConflictException({ code: "PERSON_IDENTITY_ALREADY_LINKED" });
      }
      const { expectedUpdatedAt: _, ...changes } = input;
      const [person] = await tx
        .update(managementPeople)
        .set({ ...changes, updatedByIdentityId: identityId, updatedAt: new Date() })
        .where(eq(managementPeople.id, personId))
        .returning();
      if (!person) throw new NotFoundException({ code: "PERSON_NOT_FOUND" });
      await this.record(
        tx,
        identityId,
        organizationId,
        unitId,
        "management.person.updated",
        "person",
        personId,
        { fields: Object.keys(changes) },
      );
      return person;
    });
  }

  async changePersonStatus(
    identityId: string,
    organizationId: string,
    unitId: string,
    personId: string,
    active: boolean,
    input: PersonStatusInput,
  ) {
    const actorRole = await this.requireRole(identityId, organizationId, unitId, PEOPLE_ROLES);
    return this.database.db.transaction(async (tx) => {
      await tx.execute(
        sql`select pg_advisory_xact_lock(hashtextextended(${`person-status:${organizationId}:${unitId}:${personId}`}, 0))`,
      );
      await tx.execute(
        sql`select id from management_people where organization_id=${organizationId}::uuid and unit_id=${unitId}::uuid and id=${personId}::uuid for update`,
      );
      const [person] = await tx
        .select()
        .from(managementPeople)
        .where(
          and(
            eq(managementPeople.organizationId, organizationId),
            eq(managementPeople.unitId, unitId),
            eq(managementPeople.id, personId),
          ),
        )
        .limit(1);
      if (!person) throw new NotFoundException({ code: "PERSON_NOT_FOUND" });
      const accesses = await tx
        .select()
        .from(managementPersonAccess)
        .where(
          and(
            eq(managementPersonAccess.organizationId, organizationId),
            eq(managementPersonAccess.personId, personId),
          ),
        );
      if (!active) {
        if (actorRole !== "owner" && accesses.some((access) => access.unitId !== unitId)) {
          throw new ForbiddenException({
            code: "PERSON_MULTIUNIT_OWNER_REQUIRED",
            message: "Somente o proprietário pode desligar uma pessoa com acesso multiunidade.",
          });
        }
        for (const access of accesses) this.assertPersonAccessGrant(actorRole, access.role);
      }
      if (
        person.active === active &&
        (active || !accesses.length || accesses.every((access) => access.status === "terminated"))
      )
        return person;
      if (!active) {
        const preflight = await this.personOffboardingFacts(
          tx,
          organizationId,
          personId,
          person.identityId,
        );
        if (preflight.counts.openTimeEntries)
          throw new ConflictException({
            code: "PERSON_HAS_OPEN_TIME_ENTRY",
            message: "Encerre o turno aberto antes de inativar a pessoa.",
          });
        if (preflight.counts.openCashShifts)
          throw new ConflictException({
            code: "PERSON_HAS_OPEN_CASH_SHIFT",
            message: "Transfira ou encerre o caixa sob responsabilidade antes do desligamento.",
          });
      }
      const changedAt = new Date();
      const [updated] = await tx
        .update(managementPeople)
        .set({
          active,
          statusChangedAt: changedAt,
          statusChangedByIdentityId: identityId,
          statusChangeReason: input.reason,
          updatedByIdentityId: identityId,
          updatedAt: changedAt,
        })
        .where(eq(managementPeople.id, personId))
        .returning();
      if (!updated) throw new NotFoundException({ code: "PERSON_NOT_FOUND" });
      if (!active) {
        const pendingInvitationIds = accesses
          .filter((access) => access.invitationId && access.status === "pending")
          .map((access) => access.invitationId as string);
        if (pendingInvitationIds.length) {
          await tx
            .update(membershipInvitations)
            .set({ acceptedAt: changedAt })
            .where(
              and(
                inArray(membershipInvitations.id, pendingInvitationIds),
                isNull(membershipInvitations.acceptedAt),
              ),
            );
        }
        const roleBindingIds = accesses
          .map((access) => access.roleBindingId)
          .filter((id): id is string => Boolean(id));
        if (roleBindingIds.length) {
          await tx.delete(roleBindings).where(inArray(roleBindings.id, roleBindingIds));
        }
        if (accesses.length) {
          await tx
            .update(managementPersonAccess)
            .set({
              status: "terminated",
              roleBindingId: null,
              statusChangedAt: changedAt,
              statusChangedByIdentityId: identityId,
              statusChangeReason: input.reason,
              updatedAt: changedAt,
            })
            .where(
              and(
                eq(managementPersonAccess.organizationId, organizationId),
                eq(managementPersonAccess.personId, personId),
              ),
            );
          const membershipIds = [
            ...new Set(
              accesses
                .map((access) => access.membershipId)
                .filter((id): id is string => Boolean(id)),
            ),
          ];
          if (membershipIds.length) {
            await tx
              .update(terminalSessions)
              .set({
                activeActorMembershipId: null,
                actorEpoch: sql`${terminalSessions.actorEpoch} + 1`,
                lastActivityAt: null,
                updatedAt: changedAt,
              })
              .where(
                and(
                  inArray(terminalSessions.activeActorMembershipId, membershipIds),
                  isNull(terminalSessions.revokedAt),
                ),
              );
            for (const membershipId of membershipIds) {
              await this.disableMembershipWithoutRoles(tx, membershipId);
            }
          }
        } else if (person.identityId) {
          const [legacyMembership] = await tx
            .select({ id: memberships.id })
            .from(memberships)
            .where(
              and(
                eq(memberships.organizationId, organizationId),
                eq(memberships.identityId, person.identityId),
              ),
            )
            .limit(1);
          if (legacyMembership) {
            const bindings = await tx
              .select({ id: roleBindings.id, unitId: roleBindings.unitId, role: roleBindings.role })
              .from(roleBindings)
              .where(eq(roleBindings.membershipId, legacyMembership.id));
            if (bindings.some((binding) => binding.unitId === null)) {
              throw new ConflictException({
                code: "PERSON_ACCESS_REVIEW_REQUIRED",
                message: "O usuário possui acesso global; revise o vínculo antes do desligamento.",
              });
            }
            const unitBindingIds = bindings
              .filter((binding) => binding.unitId === unitId)
              .map((binding) => binding.id);
            if (unitBindingIds.length > 1) {
              throw new ConflictException({
                code: "PERSON_ACCESS_REVIEW_REQUIRED",
                message:
                  "O usuário possui mais de um perfil nesta unidade; revise o vínculo antes do desligamento.",
              });
            }
            const unitBinding = bindings.find((binding) => binding.unitId === unitId);
            if (unitBinding) this.assertPersonAccessGrant(actorRole, unitBinding.role);
            if (unitBindingIds.length) {
              await tx.delete(roleBindings).where(inArray(roleBindings.id, unitBindingIds));
            }
            await this.disableMembershipWithoutRoles(tx, legacyMembership.id);
          }
        }
        await this.revokeIdentitySessions(tx, person.identityId);
      }
      await this.record(
        tx,
        identityId,
        organizationId,
        unitId,
        active ? "management.person.reactivated" : "management.person.inactivated",
        "person",
        personId,
        { reason: input.reason, accessAssignmentsTerminated: !active ? accesses.length : 0 },
      );
      return updated;
    });
  }

  private async scheduleConflictIds(
    source: Transaction | Database,
    organizationId: string,
    unitId: string,
    personId: string,
    startsAt: Date,
    endsAt: Date,
    ignoredScheduleId?: string,
  ) {
    const filters = [
      eq(managementSchedules.organizationId, organizationId),
      eq(managementSchedules.unitId, unitId),
      eq(managementSchedules.personId, personId),
      isNull(managementSchedules.canceledAt),
      lt(managementSchedules.startsAt, endsAt),
      gt(managementSchedules.endsAt, startsAt),
    ];
    if (ignoredScheduleId)
      filters.push(sql`${managementSchedules.id} <> ${ignoredScheduleId}::uuid`);
    return source
      .select({ id: managementSchedules.id })
      .from(managementSchedules)
      .where(and(...filters));
  }

  async createSchedule(
    identityId: string,
    organizationId: string,
    unitId: string,
    input: ScheduleInput,
  ) {
    await this.requireRole(identityId, organizationId, unitId, PEOPLE_ROLES);
    return this.database.db.transaction(async (tx) => {
      await tx.execute(
        sql`select pg_advisory_xact_lock(hashtextextended(${`schedule:${organizationId}:${unitId}:${input.personId}`}, 0))`,
      );
      const [person] = await tx
        .select({ id: managementPeople.id })
        .from(managementPeople)
        .where(
          and(
            eq(managementPeople.organizationId, organizationId),
            eq(managementPeople.unitId, unitId),
            eq(managementPeople.id, input.personId),
            eq(managementPeople.active, true),
          ),
        )
        .limit(1);
      if (!person)
        throw new NotFoundException({
          code: "PERSON_NOT_FOUND",
          message: "Pessoa não encontrada nesta unidade.",
        });
      const startsAt = new Date(input.startsAt);
      const endsAt = new Date(input.endsAt);
      if (
        (
          await this.scheduleConflictIds(
            tx,
            organizationId,
            unitId,
            input.personId,
            startsAt,
            endsAt,
          )
        ).length
      )
        throw new ConflictException({
          code: "SCHEDULE_OVERLAP",
          message: "A pessoa já possui escala neste intervalo.",
        });
      const id = randomUUID();
      const [schedule] = await tx
        .insert(managementSchedules)
        .values({
          id,
          organizationId,
          unitId,
          personId: input.personId,
          startsAt,
          endsAt,
          breakMinutes: input.breakMinutes,
          notes: input.notes,
        })
        .returning();
      await this.record(
        tx,
        identityId,
        organizationId,
        unitId,
        "management.schedule.created",
        "schedule",
        id,
        { personId: input.personId },
      );
      return schedule;
    });
  }

  async updateSchedule(
    identityId: string,
    organizationId: string,
    unitId: string,
    scheduleId: string,
    input: ScheduleUpdateInput,
  ) {
    await this.requireRole(identityId, organizationId, unitId, PEOPLE_ROLES);
    return this.database.db.transaction(async (tx) => {
      await tx.execute(
        sql`select id from management_schedules where organization_id=${organizationId}::uuid and unit_id=${unitId}::uuid and id=${scheduleId}::uuid for update`,
      );
      const [current] = await tx
        .select()
        .from(managementSchedules)
        .where(
          and(
            eq(managementSchedules.organizationId, organizationId),
            eq(managementSchedules.unitId, unitId),
            eq(managementSchedules.id, scheduleId),
          ),
        )
        .limit(1);
      if (!current) throw new NotFoundException({ code: "SCHEDULE_NOT_FOUND" });
      if (current.canceledAt)
        throw new ConflictException({
          code: "SCHEDULE_CANCELED",
          message: "Escala cancelada não pode ser editada.",
        });
      if (input.expectedUpdatedAt && current.updatedAt.toISOString() !== input.expectedUpdatedAt)
        throw new ConflictException({ code: "SCHEDULE_CHANGED" });
      await tx.execute(
        sql`select pg_advisory_xact_lock(hashtextextended(${`schedule:${organizationId}:${unitId}:${current.personId}`}, 0))`,
      );
      const startsAt = input.startsAt ? new Date(input.startsAt) : current.startsAt;
      const endsAt = input.endsAt ? new Date(input.endsAt) : current.endsAt;
      if (endsAt <= startsAt) throw new BadRequestException({ code: "INVALID_SCHEDULE_WINDOW" });
      if (
        (
          await this.scheduleConflictIds(
            tx,
            organizationId,
            unitId,
            current.personId,
            startsAt,
            endsAt,
            scheduleId,
          )
        ).length
      )
        throw new ConflictException({ code: "SCHEDULE_OVERLAP" });
      const { expectedUpdatedAt: _, ...changes } = input;
      const [updated] = await tx
        .update(managementSchedules)
        .set({
          ...changes,
          startsAt,
          endsAt,
          updatedAt: new Date(),
        })
        .where(eq(managementSchedules.id, scheduleId))
        .returning();
      if (!updated) throw new NotFoundException({ code: "SCHEDULE_NOT_FOUND" });
      await this.record(
        tx,
        identityId,
        organizationId,
        unitId,
        "management.schedule.updated",
        "schedule",
        scheduleId,
        {
          fields: Object.keys(changes),
        },
      );
      return updated;
    });
  }

  async cancelSchedule(
    identityId: string,
    organizationId: string,
    unitId: string,
    scheduleId: string,
    input: ScheduleCancelInput,
  ) {
    await this.requireRole(identityId, organizationId, unitId, PEOPLE_ROLES);
    return this.database.db.transaction(async (tx) => {
      const now = new Date();
      const [schedule] = await tx
        .update(managementSchedules)
        .set({
          canceledAt: now,
          canceledByIdentityId: identityId,
          cancellationReason: input.reason,
          updatedAt: now,
        })
        .where(
          and(
            eq(managementSchedules.organizationId, organizationId),
            eq(managementSchedules.unitId, unitId),
            eq(managementSchedules.id, scheduleId),
            isNull(managementSchedules.canceledAt),
          ),
        )
        .returning();
      if (!schedule) throw new ConflictException({ code: "SCHEDULE_NOT_ACTIVE" });
      await this.record(
        tx,
        identityId,
        organizationId,
        unitId,
        "management.schedule.canceled",
        "schedule",
        scheduleId,
        {
          reason: input.reason,
        },
      );
      return schedule;
    });
  }

  async previewScheduleBatch(
    identityId: string,
    organizationId: string,
    unitId: string,
    input: ScheduleBatchInput,
    source: Transaction | Database = this.database.db,
  ) {
    await this.requireRole(identityId, organizationId, unitId, PEOPLE_ROLES);
    const personIds = [...new Set(input.schedules.map((schedule) => schedule.personId))];
    const people = await source
      .select({ id: managementPeople.id })
      .from(managementPeople)
      .where(
        and(
          eq(managementPeople.organizationId, organizationId),
          eq(managementPeople.unitId, unitId),
          eq(managementPeople.active, true),
          inArray(managementPeople.id, personIds),
        ),
      );
    const activeIds = new Set(people.map((person) => person.id));
    const conflicts: Array<{ index: number; code: string; conflictingScheduleIds: string[] }> = [];
    for (const [index, schedule] of input.schedules.entries()) {
      if (!activeIds.has(schedule.personId)) {
        conflicts.push({ index, code: "PERSON_NOT_ACTIVE", conflictingScheduleIds: [] });
        continue;
      }
      const startsAt = new Date(schedule.startsAt);
      const endsAt = new Date(schedule.endsAt);
      const databaseConflicts = await this.scheduleConflictIds(
        source,
        organizationId,
        unitId,
        schedule.personId,
        startsAt,
        endsAt,
      );
      const batchConflicts = input.schedules
        .slice(0, index)
        .map((candidate, candidateIndex) => ({ candidate, candidateIndex }))
        .filter(
          ({ candidate }) =>
            candidate.personId === schedule.personId &&
            new Date(candidate.startsAt) < endsAt &&
            new Date(candidate.endsAt) > startsAt,
        );
      if (databaseConflicts.length || batchConflicts.length)
        conflicts.push({
          index,
          code: "SCHEDULE_OVERLAP",
          conflictingScheduleIds: databaseConflicts.map((row) => row.id),
        });
    }
    return { valid: conflicts.length === 0, count: input.schedules.length, conflicts };
  }

  async createScheduleBatch(
    identityId: string,
    organizationId: string,
    unitId: string,
    idempotencyKey: string,
    input: ScheduleBatchInput,
  ) {
    await this.requireRole(identityId, organizationId, unitId, PEOPLE_ROLES);
    return this.idempotent(
      identityId,
      organizationId,
      unitId,
      idempotencyKey,
      "schedule.batch",
      input,
      async (tx) => {
        for (const personId of [...new Set(input.schedules.map((row) => row.personId))].sort())
          await tx.execute(
            sql`select pg_advisory_xact_lock(hashtextextended(${`schedule:${organizationId}:${unitId}:${personId}`}, 0))`,
          );
        const preview = await this.previewScheduleBatch(
          identityId,
          organizationId,
          unitId,
          input,
          tx,
        );
        if (!preview.valid)
          throw new ConflictException({
            code: "SCHEDULE_BATCH_INVALID",
            conflicts: preview.conflicts,
          });
        const schedules = await tx
          .insert(managementSchedules)
          .values(
            input.schedules.map((schedule) => ({
              id: randomUUID(),
              organizationId,
              unitId,
              personId: schedule.personId,
              startsAt: new Date(schedule.startsAt),
              endsAt: new Date(schedule.endsAt),
              breakMinutes: schedule.breakMinutes,
              notes: schedule.notes,
            })),
          )
          .returning();
        await this.record(
          tx,
          identityId,
          organizationId,
          unitId,
          "management.schedule.batch-created",
          "schedule_batch",
          idempotencyKey,
          {
            scheduleIds: schedules.map((schedule) => schedule.id),
          },
        );
        return { schedules, count: schedules.length };
      },
    );
  }

  async createTimeEntry(
    identityId: string,
    organizationId: string,
    unitId: string,
    idempotencyKey: string,
    input: TimeEntryInput,
  ) {
    await this.requireRole(identityId, organizationId, unitId, PEOPLE_ROLES);
    return this.idempotent(
      identityId,
      organizationId,
      unitId,
      idempotencyKey,
      "time-entry",
      input,
      async (tx) => {
        await tx.execute(
          sql`select pg_advisory_xact_lock(hashtextextended(${`person-status:${organizationId}:${unitId}:${input.personId}`}, 0))`,
        );
        const [person] = await tx
          .select({ id: managementPeople.id, active: managementPeople.active })
          .from(managementPeople)
          .where(
            and(
              eq(managementPeople.organizationId, organizationId),
              eq(managementPeople.unitId, unitId),
              eq(managementPeople.id, input.personId),
              eq(managementPeople.active, true),
            ),
          )
          .limit(1);
        if (!person)
          throw new NotFoundException({
            code: "PERSON_NOT_FOUND",
            message: "Pessoa não encontrada nesta unidade.",
          });
        const id = randomUUID();
        const clockedInAt = new Date(input.clockedInAt);
        await this.assertTimeTrackingPeriodOpen(tx, organizationId, unitId, clockedInAt);
        await tx.insert(managementTimeEntries).values({
          id,
          organizationId,
          unitId,
          personId: input.personId,
          clockedInAt,
          clockedOutAt: input.clockedOutAt ? new Date(input.clockedOutAt) : undefined,
          source: input.source,
          idempotencyKey,
          recordedByIdentityId: identityId,
        });
        await this.record(
          tx,
          identityId,
          organizationId,
          unitId,
          "management.time-entry.recorded",
          "time_entry",
          id,
          { personId: input.personId },
        );
        return { timeEntryId: id, personId: input.personId };
      },
    );
  }

  async clockOut(
    identityId: string,
    organizationId: string,
    unitId: string,
    timeEntryId: string,
    idempotencyKey: string,
    input: ClockOutInput,
  ) {
    await this.requireRole(identityId, organizationId, unitId, PEOPLE_ROLES);
    return this.idempotent(
      identityId,
      organizationId,
      unitId,
      idempotencyKey,
      "time-entry-clock-out",
      { timeEntryId, ...input },
      async (tx) => {
        await tx.execute(
          sql`select id from management_time_entries where organization_id=${organizationId}::uuid and unit_id=${unitId}::uuid and id=${timeEntryId}::uuid for update`,
        );
        const [entry] = await tx
          .select()
          .from(managementTimeEntries)
          .where(
            and(
              eq(managementTimeEntries.organizationId, organizationId),
              eq(managementTimeEntries.unitId, unitId),
              eq(managementTimeEntries.id, timeEntryId),
            ),
          )
          .limit(1);
        if (!entry) {
          throw new NotFoundException({
            code: "TIME_ENTRY_NOT_FOUND",
            message: "Registro de ponto não encontrado nesta unidade.",
          });
        }
        if (entry.clockedOutAt) {
          throw new ConflictException({
            code: "TIME_ENTRY_ALREADY_CLOSED",
            message: "O registro de ponto já foi encerrado.",
          });
        }
        const [openBreak] = await tx
          .select({ id: managementTimeEntryBreaks.id })
          .from(managementTimeEntryBreaks)
          .where(
            and(
              eq(managementTimeEntryBreaks.timeEntryId, entry.id),
              isNull(managementTimeEntryBreaks.endedAt),
            ),
          )
          .limit(1);
        if (openBreak) {
          throw new ConflictException({
            code: "TIME_BREAK_OPEN",
            message: "Finalize a pausa antes de encerrar o turno.",
          });
        }
        const clockedOutAt = new Date(input.clockedOutAt);
        if (clockedOutAt <= entry.clockedInAt) {
          throw new BadRequestException({
            code: "INVALID_TIME_ENTRY_WINDOW",
            message: "A saída deve ser posterior à entrada.",
          });
        }
        await tx
          .update(managementTimeEntries)
          .set({ clockedOutAt, updatedAt: new Date() })
          .where(eq(managementTimeEntries.id, entry.id));
        await this.record(
          tx,
          identityId,
          organizationId,
          unitId,
          "management.time-entry.closed",
          "time_entry",
          entry.id,
          { personId: entry.personId, clockedOutAt: clockedOutAt.toISOString() },
        );
        return {
          timeEntryId: entry.id,
          personId: entry.personId,
          clockedOutAt: clockedOutAt.toISOString(),
        };
      },
    );
  }

  async createCommissionRule(
    identityId: string,
    organizationId: string,
    unitId: string,
    input: CommissionRuleInput,
  ) {
    await this.requireRole(identityId, organizationId, unitId, PEOPLE_ROLES);
    return this.database.db.transaction(async (tx) => {
      const id = randomUUID();
      const [rule] = await tx
        .insert(managementCommissionRules)
        .values({ id, organizationId, unitId, ...input })
        .returning();
      await this.record(
        tx,
        identityId,
        organizationId,
        unitId,
        "management.commission-rule.created",
        "commission_rule",
        id,
        { basisPoints: input.basisPoints },
      );
      return rule;
    });
  }

  private async assertCommissionSource(
    tx: Transaction,
    organizationId: string,
    unitId: string,
    input: { personId: string; sourceOrderId?: string | null; baseCents: number },
  ) {
    const [person] = await tx
      .select({ active: managementPeople.active })
      .from(managementPeople)
      .where(
        and(
          eq(managementPeople.organizationId, organizationId),
          eq(managementPeople.unitId, unitId),
          eq(managementPeople.id, input.personId),
        ),
      )
      .limit(1);
    if (!person?.active)
      throw new ConflictException({
        code: "COMMISSION_PERSON_NOT_ACTIVE",
        message: "A comissão exige uma pessoa ativa nesta unidade.",
      });
    if (!input.sourceOrderId) return;
    const [order] = await tx
      .select({
        status: posOrders.status,
        netCents: sql<number>`coalesce(sum(${posOrderItems.netCents}) filter (where ${posOrderItems.canceledAt} is null), 0)::int`,
      })
      .from(posOrders)
      .leftJoin(
        posOrderItems,
        and(
          eq(posOrderItems.organizationId, posOrders.organizationId),
          eq(posOrderItems.unitId, posOrders.unitId),
          eq(posOrderItems.orderId, posOrders.id),
        ),
      )
      .where(
        and(
          eq(posOrders.organizationId, organizationId),
          eq(posOrders.unitId, unitId),
          eq(posOrders.id, input.sourceOrderId),
        ),
      )
      .groupBy(posOrders.status)
      .limit(1);
    if (!order) throw new NotFoundException({ code: "ORDER_NOT_FOUND" });
    if (order.status !== "served")
      throw new ConflictException({
        code: "COMMISSION_ORDER_NOT_SERVED",
        message: "A comissão só pode ser vinculada a pedido servido.",
      });
    if (input.baseCents > order.netCents)
      throw new ConflictException({
        code: "COMMISSION_BASE_EXCEEDS_ORDER",
        message: "A base da comissão excede o valor líquido do pedido.",
      });
  }

  async createCommission(
    identityId: string,
    organizationId: string,
    unitId: string,
    idempotencyKey: string,
    input: CommissionInput,
  ) {
    await this.requireRole(identityId, organizationId, unitId, PEOPLE_ROLES);
    return this.idempotent(
      identityId,
      organizationId,
      unitId,
      idempotencyKey,
      "commission",
      input,
      async (tx) => {
        assertCommissionCents(input.baseCents, "baseCents");
        if (input.amountCents !== undefined) {
          assertCommissionCents(input.amountCents, "amountCents");
        }
        await this.assertCommissionSource(tx, organizationId, unitId, input);
        let amountCents = input.amountCents;
        if (input.ruleId) {
          const [rule] = await tx
            .select()
            .from(managementCommissionRules)
            .where(
              and(
                eq(managementCommissionRules.organizationId, organizationId),
                eq(managementCommissionRules.unitId, unitId),
                eq(managementCommissionRules.id, input.ruleId),
                eq(managementCommissionRules.active, true),
              ),
            )
            .limit(1);
          if (!rule)
            throw new NotFoundException({
              code: "COMMISSION_RULE_NOT_FOUND",
              message: "Regra de comissão não encontrada nesta unidade.",
            });
          const calculated = commissionAmountFromBasisPoints(input.baseCents, rule.basisPoints);
          if (amountCents !== undefined && amountCents !== calculated)
            throw new ConflictException({
              code: "COMMISSION_AMOUNT_MISMATCH",
              message: "O valor informado diverge da regra.",
            });
          amountCents = calculated;
        }
        if (amountCents === undefined)
          throw new BadRequestException({
            code: "COMMISSION_AMOUNT_REQUIRED",
            message: "Informe uma regra ou o valor da comissão.",
          });
        const id = randomUUID();
        await tx.insert(managementCommissions).values({
          id,
          organizationId,
          unitId,
          personId: input.personId,
          ruleId: input.ruleId,
          sourceOrderId: input.sourceOrderId,
          baseCents: input.baseCents,
          amountCents,
          idempotencyKey,
        });
        await this.record(
          tx,
          identityId,
          organizationId,
          unitId,
          "management.commission.created",
          "commission",
          id,
          { personId: input.personId, amountCents },
        );
        return { commissionId: id, amountCents, status: "pending" };
      },
    );
  }

  async transitionCommission(
    identityId: string,
    organizationId: string,
    unitId: string,
    commissionId: string,
    idempotencyKey: string,
    input: CommissionTransitionInput,
  ) {
    const roles = input.action === "pay" ? (["owner", "finance"] as const) : PEOPLE_ROLES;
    await this.requireRole(identityId, organizationId, unitId, roles);
    return this.idempotent(
      identityId,
      organizationId,
      unitId,
      idempotencyKey,
      "commission.transition",
      { commissionId, ...input },
      async (tx) => {
        await tx.execute(
          sql`select id from management_commissions where organization_id=${organizationId}::uuid and unit_id=${unitId}::uuid and id=${commissionId}::uuid for update`,
        );
        const [commission] = await tx
          .select()
          .from(managementCommissions)
          .where(
            and(
              eq(managementCommissions.organizationId, organizationId),
              eq(managementCommissions.unitId, unitId),
              eq(managementCommissions.id, commissionId),
            ),
          )
          .limit(1);
        if (!commission) throw new NotFoundException({ code: "COMMISSION_NOT_FOUND" });
        const nextStatus = {
          approve: "approved",
          reject: "rejected",
          pay: "paid",
          cancel: "canceled",
        }[input.action] as "approved" | "rejected" | "paid" | "canceled";
        if (!commissionTransitionAllowed(commission.status, nextStatus))
          throw new ConflictException({
            code: "INVALID_COMMISSION_TRANSITION",
            message: `Comissão ${commission.status} não pode mudar para ${nextStatus}.`,
          });
        if (nextStatus === "approved") {
          await this.assertCommissionSource(tx, organizationId, unitId, commission);
          if (commission.ruleId) {
            const [rule] = await tx
              .select({ basisPoints: managementCommissionRules.basisPoints })
              .from(managementCommissionRules)
              .where(
                and(
                  eq(managementCommissionRules.organizationId, organizationId),
                  eq(managementCommissionRules.unitId, unitId),
                  eq(managementCommissionRules.id, commission.ruleId),
                  eq(managementCommissionRules.active, true),
                ),
              )
              .limit(1);
            if (!rule) throw new ConflictException({ code: "COMMISSION_RULE_NOT_ACTIVE" });
            if (
              commissionAmountFromBasisPoints(commission.baseCents, rule.basisPoints) !==
              commission.amountCents
            )
              throw new ConflictException({ code: "COMMISSION_AMOUNT_MISMATCH" });
          }
        }
        const now = new Date();
        const lifecycle =
          nextStatus === "paid"
            ? { paidAt: now, paidByIdentityId: identityId, paymentNote: input.note }
            : nextStatus === "canceled"
              ? {
                  canceledAt: now,
                  canceledByIdentityId: identityId,
                  cancellationReason: input.note,
                }
              : {
                  reviewedAt: now,
                  reviewedByIdentityId: identityId,
                  reviewNote: input.note,
                };
        const [updated] = await tx
          .update(managementCommissions)
          .set({ status: nextStatus, ...lifecycle, updatedAt: now })
          .where(eq(managementCommissions.id, commissionId))
          .returning();
        if (!updated) throw new NotFoundException({ code: "COMMISSION_NOT_FOUND" });
        await this.record(
          tx,
          identityId,
          organizationId,
          unitId,
          `management.commission.${nextStatus}`,
          "commission",
          commissionId,
          { previousStatus: commission.status, note: input.note },
        );
        return updated;
      },
    );
  }
}
