import {
  boolean,
  integer,
  optionalRows,
  optionalString,
  record,
  requiredString,
  rows,
} from "../../management.shared";

export type SettlementStatus = "closed" | "approved" | "paid" | "canceled";
export type LossStatus = "pending" | "approved" | "rejected" | "reversed";

export interface SettlementConfiguration {
  serviceChargeEnabled: boolean;
  defaultServiceChargeBasisPoints: number;
  serviceChargeApplication: "manual" | "suggest_dine_in";
  attributionMode: "final_responsible" | "order_creator";
  transferMode: "move_to_final" | "preserve_origin";
  serviceBase: "gross" | "net_after_discounts";
  eligibleTabs: "closed" | "fully_paid";
  serviceDistribution: "individual_sales" | "equal_pool";
  serviceTeamShareBasisPoints: number;
  partnershipBase: "gross" | "net" | "received" | "net_excluding_service";
  tierApplication: "all_revenue" | "progressive";
  discountTreatment: "deduct" | "ignore";
  cancellationTreatment: "exclude" | "deduct";
  refundTreatment: "deduct" | "informational";
  periodMode: "calendar_month" | "custom";
  customPeriodStartDay: number;
  aggregateAcrossUnits: boolean;
}

export interface PartnershipTier {
  minimumCents: number;
  maximumCents: number | null;
  rewardType: "percentage" | "fixed";
  rewardValue: number;
}

export interface PartnershipPlan {
  id: string | null;
  name: string;
  effectiveFrom: string;
  active: boolean;
  tiers: PartnershipTier[];
}

export interface SettlementCapabilities {
  canRead: boolean;
  canConfigure: boolean;
  canRecordLoss: boolean;
  canReviewLoss: boolean;
  canGenerate: boolean;
  canApprove: boolean;
  canPay: boolean;
  canCancel: boolean;
  canExport: boolean;
}

export interface OperationalLoss {
  id: string;
  tabId: string;
  tabLabel: string;
  type: "unpaid_tab" | "refund" | "chargeback" | "other";
  reason: string;
  amountCents: number;
  serviceChargeCents: number;
  status: LossStatus;
  responsibleName: string | null;
  createdAt: string;
}

export interface LossCandidate {
  tabId: string;
  label: string;
  responsibleName: string | null;
  totalCents: number;
  unpaidCents: number;
}

export interface SettlementLine {
  personId: string | null;
  personIdentityId: string;
  personName: string;
  roleLabel: string | null;
  eligibleForPayment: boolean;
  tabCount: number;
  orderCount: number;
  grossSalesCents: number;
  discountCents: number;
  canceledCents: number;
  receivedCents: number;
  serviceChargeCents: number;
  serviceShareCents: number;
  tipCents: number;
  partnershipBaseCents: number;
  partnershipCents: number;
  operationalLossCents: number;
  payableCents: number;
}

export interface WaiterSettlement {
  id: string | null;
  periodFrom: string;
  periodTo: string;
  status: SettlementStatus | "preview";
  unassignedGrossCents: number;
  operationalLossCents: number;
  createdAt: string | null;
  warnings: string[];
  lines: SettlementLine[];
}

export interface OperationalShift {
  id: string;
  label: string;
  status: "active" | "closed";
  startsAt: string;
  closedAt: string | null;
}

export interface WaiterSettlementsOverview {
  configuration: SettlementConfiguration;
  partnershipPlan: PartnershipPlan | null;
  operationalShifts: OperationalShift[];
  operationalLosses: OperationalLoss[];
  settlements: WaiterSettlement[];
  capabilities: SettlementCapabilities;
}

function localDate(value: Date) {
  return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, "0")}-${String(value.getDate()).padStart(2, "0")}`;
}

export function defaultSettlementPeriod(
  configuration: SettlementConfiguration,
  today = new Date(),
) {
  const startDay = configuration.periodMode === "custom" ? configuration.customPeriodStartDay : 1;
  const startMonth = today.getDate() < startDay ? today.getMonth() - 1 : today.getMonth();
  return {
    from: localDate(new Date(today.getFullYear(), startMonth, startDay)),
    to: localDate(today),
  };
}

function oneOf<T extends string>(value: unknown, allowed: readonly T[]): T {
  const parsed = requiredString(value);
  if (!allowed.includes(parsed as T)) throw new Error("A API retornou uma opção inválida.");
  return parsed as T;
}

export function parseSettlementConfiguration(value: unknown): SettlementConfiguration {
  const item = record(value);
  return {
    serviceChargeEnabled:
      item.serviceChargeEnabled === undefined ? false : boolean(item.serviceChargeEnabled),
    defaultServiceChargeBasisPoints:
      item.defaultServiceChargeBasisPoints === undefined
        ? 0
        : integer(item.defaultServiceChargeBasisPoints),
    serviceChargeApplication:
      item.serviceChargeApplication === undefined
        ? "manual"
        : oneOf(item.serviceChargeApplication, ["manual", "suggest_dine_in"]),
    attributionMode: oneOf(item.attributionMode, ["final_responsible", "order_creator"]),
    transferMode: oneOf(item.transferMode, ["move_to_final", "preserve_origin"]),
    serviceBase: oneOf(item.serviceBase, ["gross", "net_after_discounts"]),
    eligibleTabs: oneOf(item.eligibleTabs, ["closed", "fully_paid"]),
    serviceDistribution: oneOf(item.serviceDistribution, ["individual_sales", "equal_pool"]),
    serviceTeamShareBasisPoints: integer(item.serviceTeamShareBasisPoints),
    partnershipBase: oneOf(item.partnershipBase, [
      "gross",
      "net",
      "received",
      "net_excluding_service",
    ]),
    tierApplication: oneOf(item.tierApplication, ["all_revenue", "progressive"]),
    discountTreatment: oneOf(item.discountTreatment, ["deduct", "ignore"]),
    cancellationTreatment: oneOf(item.cancellationTreatment, ["exclude", "deduct"]),
    refundTreatment: oneOf(item.refundTreatment, ["deduct", "informational"]),
    periodMode: oneOf(item.periodMode, ["calendar_month", "custom"]),
    customPeriodStartDay: integer(item.customPeriodStartDay),
    aggregateAcrossUnits: boolean(item.aggregateAcrossUnits),
  };
}

function parseTier(value: unknown): PartnershipTier {
  const item = record(value);
  return {
    minimumCents: integer(item.minimumCents),
    maximumCents: item.maximumCents === null ? null : integer(item.maximumCents),
    rewardType: oneOf(item.rewardType, ["percentage", "fixed"]),
    rewardValue: integer(item.rewardValue),
  };
}

function parsePartnershipPlan(value: unknown): PartnershipPlan {
  const item = record(value);
  return {
    id: optionalString(item.id),
    name: requiredString(item.name),
    effectiveFrom: requiredString(item.effectiveFrom),
    active: item.active === undefined ? true : boolean(item.active),
    tiers: rows(item, "tiers").map(parseTier),
  };
}

function parseLoss(value: unknown): OperationalLoss {
  const item = record(value);
  return {
    id: requiredString(item.id),
    tabId: requiredString(item.tabId),
    tabLabel: optionalString(item.tabLabel) ?? requiredString(item.tabId),
    type: oneOf(item.type, ["unpaid_tab", "refund", "chargeback", "other"]),
    reason: requiredString(item.reason),
    amountCents: integer(item.amountCents),
    serviceChargeCents:
      item.serviceChargeCents === undefined ? 0 : integer(item.serviceChargeCents),
    status: oneOf(item.status, ["pending", "approved", "rejected", "reversed"]),
    responsibleName: optionalString(item.responsibleName),
    createdAt: requiredString(item.createdAt),
  };
}

function parseSettlementLine(value: unknown): SettlementLine {
  const item = record(value);
  return {
    personId: optionalString(item.personId),
    personIdentityId: requiredString(item.personIdentityId),
    personName:
      optionalString(item.personName) ??
      optionalString(item.name) ??
      requiredString(item.personIdentityId),
    roleLabel: optionalString(item.roleLabel),
    eligibleForPayment: boolean(item.eligibleForPayment),
    tabCount: integer(item.tabCount),
    orderCount: integer(item.orderCount),
    grossSalesCents: integer(item.grossSalesCents),
    discountCents: integer(item.discountCents),
    canceledCents: integer(item.canceledCents),
    receivedCents: integer(item.receivedCents),
    serviceChargeCents: integer(item.serviceChargeCents),
    serviceShareCents: integer(item.serviceShareCents),
    tipCents: integer(item.tipCents),
    partnershipBaseCents: integer(item.partnershipBaseCents),
    partnershipCents: integer(item.partnershipCents),
    operationalLossCents: integer(item.operationalLossCents),
    payableCents: integer(item.payableCents),
  };
}

export function parseSettlement(value: unknown, preview = false): WaiterSettlement {
  const item = record(value);
  return {
    id: optionalString(item.id),
    periodFrom: requiredString(item.periodFrom),
    periodTo: requiredString(item.periodTo),
    status: preview ? "preview" : oneOf(item.status, ["closed", "approved", "paid", "canceled"]),
    unassignedGrossCents: integer(item.unassignedGrossCents),
    operationalLossCents: integer(item.operationalLossCents),
    createdAt: optionalString(item.createdAt),
    warnings: Array.isArray(item.warnings)
      ? item.warnings.filter((warning): warning is string => typeof warning === "string")
      : [],
    lines: optionalRows(item, "lines").map(parseSettlementLine),
  };
}

export function parseWaiterSettlementsOverview(value: unknown): WaiterSettlementsOverview {
  const payload = record(value);
  const capabilities = record(payload.capabilities);
  const plan = payload.partnershipPlan ?? payload.activePartnershipPlan;
  return {
    configuration: parseSettlementConfiguration(payload.configuration ?? payload.settings),
    partnershipPlan: plan === null || plan === undefined ? null : parsePartnershipPlan(plan),
    operationalShifts: optionalRows(payload, "operationalShifts").map((shift) => ({
      id: requiredString(shift.id),
      label: requiredString(shift.label),
      status: oneOf(shift.status, ["active", "closed"]),
      startsAt: requiredString(shift.startsAt),
      closedAt: optionalString(shift.closedAt),
    })),
    operationalLosses: optionalRows(payload, "operationalLosses").map(parseLoss),
    settlements: optionalRows(payload, "settlements").map((item) => parseSettlement(item)),
    capabilities: {
      canRead: boolean(capabilities.canRead),
      canConfigure: boolean(capabilities.canConfigure),
      canRecordLoss: boolean(capabilities.canRecordLoss),
      canReviewLoss: boolean(capabilities.canReviewLoss),
      canGenerate: boolean(capabilities.canGenerate),
      canApprove: boolean(capabilities.canApprove),
      canPay: boolean(capabilities.canPay),
      canCancel: boolean(capabilities.canCancel),
      canExport: boolean(capabilities.canExport),
    },
  };
}

export function parseLossCandidates(value: unknown): LossCandidate[] {
  const payload = record(value);
  return rows(payload, "candidates").map((candidate) => ({
    tabId: requiredString(candidate.tabId),
    label:
      optionalString(candidate.label) ??
      optionalString(candidate.displayNumber) ??
      requiredString(candidate.tabId),
    responsibleName: optionalString(candidate.responsibleName),
    totalCents: integer(candidate.totalCents),
    unpaidCents: integer(candidate.remainingCents),
  }));
}
