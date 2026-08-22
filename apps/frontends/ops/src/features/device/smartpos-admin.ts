import { apiRequest } from "../../api";
import type { IntegratedPaymentMethod, PaymentProvider } from "../counter/pos-payments";

export interface SmartPosPairing {
  pairingId: string;
  code: string;
  qrPayload: string;
  expiresAt: string;
}

export interface SmartPosDiagnostics {
  manufacturer: string;
  model: string;
  androidVersion: string;
  firmwareVersion: string;
  appVersion: string;
  packageName: string;
  signingCertificateSha256: string;
}

export interface SmartPosAdminCapabilities {
  installationId: string;
  available: boolean;
  status: "disabled" | "pending" | "homologated" | "suspended";
  provider: PaymentProvider | null;
  methods: IntegratedPaymentMethod[];
  maxInstallments: number;
  supports: { cancel: boolean; recover: boolean; reversal: boolean };
  reason: string | null;
  certificationId: string | null;
  diagnosticsMatch: boolean;
  killSwitch: { enabled: boolean; reason: string | null };
}

export interface SmartPosDevice {
  installationId: string;
  label: string;
  enrolledAt: string;
  revokedAt: string | null;
  lastSeenAt: string | null;
  reportedDiagnostics: SmartPosDiagnostics | null;
  capabilities: SmartPosAdminCapabilities;
  certification: {
    id: string;
    provider: PaymentProvider;
    status: "approved" | "suspended";
    killSwitchEnabled: boolean;
    killSwitchReason: string | null;
  } | null;
}

export type SmartPosIncidentKind =
  | "unknown_attempt"
  | "stale_processing"
  | "offline_device"
  | "reconciliation_divergence";

export interface SmartPosHealth {
  generatedAt: string;
  summary: {
    unknownAttempts: number;
    staleProcessingAttempts: number;
    offlineDevices: number;
    reconciliationDivergences: number;
  };
  incidents: Array<{
    kind: SmartPosIncidentKind;
    severity: "warning" | "critical";
    entityId: string;
    label: string;
    occurredAt: string;
  }>;
}

export type SmartPosReconciliationStatus =
  | "pending"
  | "matched"
  | "divergent"
  | "settled"
  | "reversed";

export interface SmartPosReconciliation {
  entries: Array<{
    id: string;
    paymentId: string;
    provider: PaymentProvider;
    providerSettlementId: string;
    providerReference: string;
    grossCents: number;
    feeCents: number;
    netCents: number;
    expectedSettlementAt: string;
    settledAt: string | null;
    status: SmartPosReconciliationStatus;
    source: "api" | "webhook" | "import";
    createdAt: string;
    updatedAt: string;
  }>;
  summary: { grossCents: number; feeCents: number; netCents: number; divergences: number };
}

export interface SmartPosHomologationChecklist {
  debitApproved: boolean;
  creditApproved: boolean;
  installmentsApproved: boolean;
  pixApproved: boolean;
  declinedHandled: boolean;
  canceledHandled: boolean;
  networkRecoveryHandled: boolean;
  reversalApproved: boolean;
  receiptValidated: boolean;
}

export interface SmartPosHomologationRun {
  id: string;
  certificationId: string;
  installationId: string;
  terminalSerialHash: string;
  environment: "sandbox" | "homologation" | "production";
  checklist: SmartPosHomologationChecklist;
  evidenceReference: string;
  notes: string | null;
  passed: boolean;
  recordedByIdentityId: string;
  createdAt: string;
}

export interface SmartPosHomologationInput {
  certificationId: string;
  installationId: string;
  terminalSerialHash: string;
  environment: SmartPosHomologationRun["environment"];
  checklist: SmartPosHomologationChecklist;
  evidenceReference: string;
  notes?: string;
}

const providers: PaymentProvider[] = ["rede", "paygo", "stone", "getnet", "cielo", "pagbank"];
const methods: IntegratedPaymentMethod[] = ["credit_card", "debit_card", "pix"];
const capabilityStatuses = ["disabled", "pending", "homologated", "suspended"] as const;
const incidentKinds = [
  "unknown_attempt",
  "stale_processing",
  "offline_device",
  "reconciliation_divergence",
] as const;
const reconciliationStatuses = ["pending", "matched", "divergent", "settled", "reversed"] as const;
const sources = ["api", "webhook", "import"] as const;
const environments = ["sandbox", "homologation", "production"] as const;

function object(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`Resposta inválida de ${label}.`);
  }
  return value as Record<string, unknown>;
}

function text(value: unknown, field: string) {
  if (typeof value !== "string" || !value.trim()) throw new Error(`Campo ${field} inválido.`);
  return value;
}

function nullableText(value: unknown, field: string): string | null {
  if (value === null) return null;
  return text(value, field);
}

function boolean(value: unknown, field: string) {
  if (typeof value !== "boolean") throw new Error(`Campo ${field} inválido.`);
  return value;
}

function integer(value: unknown, field: string) {
  if (!Number.isInteger(value) || Number(value) < 0) throw new Error(`Campo ${field} inválido.`);
  return Number(value);
}

function positiveInteger(value: unknown, field: string) {
  const parsed = integer(value, field);
  if (parsed === 0) throw new Error(`Campo ${field} inválido.`);
  return parsed;
}

function enumValue<const Values extends readonly string[]>(
  value: unknown,
  values: Values,
  field: string,
): Values[number] {
  if (typeof value !== "string" || !values.includes(value)) {
    throw new Error(`Campo ${field} inválido.`);
  }
  return value as Values[number];
}

function provider(value: unknown, field: string) {
  return enumValue(value, providers, field);
}

function array(value: unknown, field: string): unknown[] {
  if (!Array.isArray(value)) throw new Error(`Campo ${field} inválido.`);
  return value;
}

function parseChecklist(value: unknown): SmartPosHomologationChecklist {
  const row = object(value, "checklist de homologação");
  return {
    debitApproved: boolean(row.debitApproved, "debitApproved"),
    creditApproved: boolean(row.creditApproved, "creditApproved"),
    installmentsApproved: boolean(row.installmentsApproved, "installmentsApproved"),
    pixApproved: boolean(row.pixApproved, "pixApproved"),
    declinedHandled: boolean(row.declinedHandled, "declinedHandled"),
    canceledHandled: boolean(row.canceledHandled, "canceledHandled"),
    networkRecoveryHandled: boolean(row.networkRecoveryHandled, "networkRecoveryHandled"),
    reversalApproved: boolean(row.reversalApproved, "reversalApproved"),
    receiptValidated: boolean(row.receiptValidated, "receiptValidated"),
  };
}

function parseCapabilities(value: unknown): SmartPosAdminCapabilities {
  const row = object(value, "capacidades SmartPOS");
  const supports = object(row.supports, "suportes SmartPOS");
  const killSwitch = object(row.killSwitch, "kill switch SmartPOS");
  return {
    installationId: text(row.installationId, "installationId"),
    available: boolean(row.available, "available"),
    status: enumValue(row.status, capabilityStatuses, "status"),
    provider: row.provider === null ? null : provider(row.provider, "provider"),
    methods: array(row.methods, "methods").map((method) => enumValue(method, methods, "method")),
    maxInstallments: positiveInteger(row.maxInstallments, "maxInstallments"),
    supports: {
      cancel: boolean(supports.cancel, "supports.cancel"),
      recover: boolean(supports.recover, "supports.recover"),
      reversal: boolean(supports.reversal, "supports.reversal"),
    },
    reason: nullableText(row.reason, "reason"),
    certificationId: nullableText(row.certificationId, "certificationId"),
    diagnosticsMatch: boolean(row.diagnosticsMatch, "diagnosticsMatch"),
    killSwitch: {
      enabled: boolean(killSwitch.enabled, "killSwitch.enabled"),
      reason: nullableText(killSwitch.reason, "killSwitch.reason"),
    },
  };
}

function parseDiagnostics(value: unknown): SmartPosDiagnostics | null {
  if (value === null) return null;
  const row = object(value, "diagnóstico SmartPOS");
  return {
    manufacturer: text(row.manufacturer, "manufacturer"),
    model: text(row.model, "model"),
    androidVersion: text(row.androidVersion, "androidVersion"),
    firmwareVersion: text(row.firmwareVersion, "firmwareVersion"),
    appVersion: text(row.appVersion, "appVersion"),
    packageName: text(row.packageName, "packageName"),
    signingCertificateSha256: text(row.signingCertificateSha256, "signingCertificateSha256"),
  };
}

function parseDevice(value: unknown): SmartPosDevice {
  const row = object(value, "dispositivo SmartPOS");
  const certification =
    row.certification === null ? null : object(row.certification, "certificação");
  return {
    installationId: text(row.installationId, "installationId"),
    label: text(row.label, "label"),
    enrolledAt: text(row.enrolledAt, "enrolledAt"),
    revokedAt: nullableText(row.revokedAt, "revokedAt"),
    lastSeenAt: nullableText(row.lastSeenAt, "lastSeenAt"),
    reportedDiagnostics: parseDiagnostics(row.reportedDiagnostics),
    capabilities: parseCapabilities(row.capabilities),
    certification: certification
      ? {
          id: text(certification.id, "certification.id"),
          provider: provider(certification.provider, "certification.provider"),
          status: enumValue(
            certification.status,
            ["approved", "suspended"],
            "certification.status",
          ),
          killSwitchEnabled: boolean(
            certification.killSwitchEnabled,
            "certification.killSwitchEnabled",
          ),
          killSwitchReason: nullableText(
            certification.killSwitchReason,
            "certification.killSwitchReason",
          ),
        }
      : null,
  };
}

function parseHomologationRun(value: unknown): SmartPosHomologationRun {
  const row = object(value, "execução de homologação");
  return {
    id: text(row.id, "id"),
    certificationId: text(row.certificationId, "certificationId"),
    installationId: text(row.installationId, "installationId"),
    terminalSerialHash: text(row.terminalSerialHash, "terminalSerialHash"),
    environment: enumValue(row.environment, environments, "environment"),
    checklist: parseChecklist(row.checklist),
    evidenceReference: text(row.evidenceReference, "evidenceReference"),
    notes: nullableText(row.notes, "notes"),
    passed: boolean(row.passed, "passed"),
    recordedByIdentityId: text(row.recordedByIdentityId, "recordedByIdentityId"),
    createdAt: text(row.createdAt, "createdAt"),
  };
}

export function parseSmartPosPairing(value: unknown): SmartPosPairing {
  const row = object(value, "pareamento SmartPOS");
  const code = text(row.code, "code");
  if (!/^[A-Z0-9]{8}$/.test(code)) throw new Error("Campo code inválido.");
  return {
    pairingId: text(row.pairingId, "pairingId"),
    code,
    qrPayload: text(row.qrPayload, "qrPayload"),
    expiresAt: text(row.expiresAt, "expiresAt"),
  };
}

export function parseSmartPosDevices(value: unknown): SmartPosDevice[] {
  const row = object(value, "dispositivos SmartPOS");
  return array(row.devices, "devices").map(parseDevice);
}

export function parseSmartPosHealth(value: unknown): SmartPosHealth {
  const row = object(value, "saúde SmartPOS");
  const summary = object(row.summary, "resumo de saúde SmartPOS");
  return {
    generatedAt: text(row.generatedAt, "generatedAt"),
    summary: {
      unknownAttempts: integer(summary.unknownAttempts, "unknownAttempts"),
      staleProcessingAttempts: integer(summary.staleProcessingAttempts, "staleProcessingAttempts"),
      offlineDevices: integer(summary.offlineDevices, "offlineDevices"),
      reconciliationDivergences: integer(
        summary.reconciliationDivergences,
        "reconciliationDivergences",
      ),
    },
    incidents: array(row.incidents, "incidents").map((value) => {
      const incident = object(value, "incidente SmartPOS");
      return {
        kind: enumValue(incident.kind, incidentKinds, "kind"),
        severity: enumValue(incident.severity, ["warning", "critical"], "severity"),
        entityId: text(incident.entityId, "entityId"),
        label: text(incident.label, "label"),
        occurredAt: text(incident.occurredAt, "occurredAt"),
      };
    }),
  };
}

export function parseSmartPosReconciliation(value: unknown): SmartPosReconciliation {
  const row = object(value, "conciliação SmartPOS");
  const summary = object(row.summary, "resumo de conciliação");
  return {
    entries: array(row.entries, "entries").map((value) => {
      const entry = object(value, "item de conciliação");
      return {
        id: text(entry.id, "id"),
        paymentId: text(entry.paymentId, "paymentId"),
        provider: provider(entry.provider, "provider"),
        providerSettlementId: text(entry.providerSettlementId, "providerSettlementId"),
        providerReference: text(entry.providerReference, "providerReference"),
        grossCents: positiveInteger(entry.grossCents, "grossCents"),
        feeCents: integer(entry.feeCents, "feeCents"),
        netCents: integer(entry.netCents, "netCents"),
        expectedSettlementAt: text(entry.expectedSettlementAt, "expectedSettlementAt"),
        settledAt: nullableText(entry.settledAt, "settledAt"),
        status: enumValue(entry.status, reconciliationStatuses, "status"),
        source: enumValue(entry.source, sources, "source"),
        createdAt: text(entry.createdAt, "createdAt"),
        updatedAt: text(entry.updatedAt, "updatedAt"),
      };
    }),
    summary: {
      grossCents: integer(summary.grossCents, "summary.grossCents"),
      feeCents: integer(summary.feeCents, "summary.feeCents"),
      netCents: integer(summary.netCents, "summary.netCents"),
      divergences: integer(summary.divergences, "summary.divergences"),
    },
  };
}

export function parseSmartPosHomologationRuns(value: unknown): SmartPosHomologationRun[] {
  const row = object(value, "homologações SmartPOS");
  return array(row.runs, "runs").map(parseHomologationRun);
}

function parseHomologationMutation(value: unknown) {
  const row = object(value, "homologação SmartPOS");
  return parseHomologationRun(row.run);
}

function root(organizationId: string, unitId: string) {
  return `/v1/organizations/${encodeURIComponent(organizationId)}/units/${encodeURIComponent(unitId)}/pilot`;
}

export const smartPosAdmin = {
  createPairing: async (
    organizationId: string,
    unitId: string,
    input: { label: string; expiresInSeconds?: number },
  ) =>
    parseSmartPosPairing(
      await apiRequest<unknown>(`${root(organizationId, unitId)}/payment-devices/pairing-codes`, {
        method: "POST",
        body: JSON.stringify(input),
      }),
    ),
  devices: async (organizationId: string, unitId: string) =>
    parseSmartPosDevices(
      await apiRequest<unknown>(`${root(organizationId, unitId)}/payment-devices`),
    ),
  health: async (organizationId: string, unitId: string) =>
    parseSmartPosHealth(
      await apiRequest<unknown>(`${root(organizationId, unitId)}/payment-operations/health`),
    ),
  reconciliation: async (
    organizationId: string,
    unitId: string,
    filters: { status?: SmartPosReconciliationStatus; limit?: number } = {},
  ) => {
    const query = new URLSearchParams();
    if (filters.status) query.set("status", filters.status);
    if (filters.limit) query.set("limit", String(filters.limit));
    const suffix = query.size ? `?${query.toString()}` : "";
    return parseSmartPosReconciliation(
      await apiRequest<unknown>(`${root(organizationId, unitId)}/payment-reconciliation${suffix}`),
    );
  },
  homologationRuns: async (organizationId: string, unitId: string) =>
    parseSmartPosHomologationRuns(
      await apiRequest<unknown>(`${root(organizationId, unitId)}/payment-homologation-runs`),
    ),
  recordHomologation: async (
    organizationId: string,
    unitId: string,
    input: SmartPosHomologationInput,
  ) =>
    parseHomologationMutation(
      await apiRequest<unknown>(`${root(organizationId, unitId)}/payment-homologation-runs`, {
        method: "POST",
        body: JSON.stringify(input),
      }),
    ),
};
