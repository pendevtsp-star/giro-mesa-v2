import { apiRequest } from "../../api";

export type IntegratedPaymentMethod = "credit_card" | "debit_card" | "pix";
export type PaymentProvider = "rede" | "paygo" | "stone" | "getnet" | "cielo" | "pagbank";
export type PaymentAttemptStatus =
  | "created"
  | "processing"
  | "approved"
  | "declined"
  | "canceled"
  | "unknown"
  | "reversed";

export interface PaymentCapabilities {
  installationId: string;
  available: boolean;
  status: "disabled" | "pending" | "homologated" | "suspended";
  provider: PaymentProvider | null;
  methods: IntegratedPaymentMethod[];
  maxInstallments: number;
  supports: { cancel: boolean; recover: boolean; reversal: boolean };
  reason: string | null;
}

export interface PaymentAttempt {
  id: string;
  tabId: string;
  installationId: string;
  provider: PaymentProvider;
  method: IntegratedPaymentMethod;
  amountCents: number;
  installments: number;
  status: PaymentAttemptStatus;
  providerReference: string | null;
  failureCode: string | null;
  failureMessage: string | null;
  expiresAt: string;
  processingAt: string | null;
  resolvedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface PaymentAction {
  type: "start" | "recover" | "cancel";
  attemptId: string;
  provider: PaymentProvider;
}

type AttemptActionResponse = { attempt: PaymentAttempt; action: PaymentAction | null };

const methods: IntegratedPaymentMethod[] = ["credit_card", "debit_card", "pix"];
const providers: PaymentProvider[] = ["rede", "paygo", "stone", "getnet", "cielo", "pagbank"];
const statuses: PaymentAttemptStatus[] = [
  "created",
  "processing",
  "approved",
  "declined",
  "canceled",
  "unknown",
  "reversed",
];

function object(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`Resposta inválida de ${label}.`);
  }
  return value as Record<string, unknown>;
}

function text(value: unknown, field: string): string {
  if (typeof value !== "string" || !value) throw new Error(`Campo ${field} inválido.`);
  return value;
}

function nullableText(value: unknown): string | null {
  return typeof value === "string" && value ? value : null;
}

function provider(value: unknown): PaymentProvider {
  if (!providers.includes(value as PaymentProvider))
    throw new Error("Provedor de pagamento inválido.");
  return value as PaymentProvider;
}

export function parsePaymentCapabilities(value: unknown): PaymentCapabilities {
  const row = object(value, "capacidades de pagamento");
  const parsedMethods = Array.isArray(row.methods)
    ? row.methods.filter((item): item is IntegratedPaymentMethod =>
        methods.includes(item as IntegratedPaymentMethod),
      )
    : [];
  const state = row.status;
  if (!(["disabled", "pending", "homologated", "suspended"] as const).includes(state as never)) {
    throw new Error("Estado da integração de pagamento inválido.");
  }
  const supports = object(row.supports, "recursos do pagamento");
  return {
    installationId: text(row.installationId, "installationId"),
    available: row.available === true,
    status: state as PaymentCapabilities["status"],
    provider: row.provider === null ? null : provider(row.provider),
    methods: parsedMethods,
    maxInstallments:
      Number.isInteger(row.maxInstallments) && Number(row.maxInstallments) > 0
        ? Math.min(24, Number(row.maxInstallments))
        : 1,
    supports: {
      cancel: supports.cancel === true,
      recover: supports.recover === true,
      reversal: supports.reversal === true,
    },
    reason: nullableText(row.reason),
  };
}

export function parsePaymentAttempt(value: unknown): PaymentAttempt {
  const row = object(value, "tentativa de pagamento");
  if (!methods.includes(row.method as IntegratedPaymentMethod)) {
    throw new Error("Método de pagamento inválido.");
  }
  if (!statuses.includes(row.status as PaymentAttemptStatus)) {
    throw new Error("Estado da tentativa de pagamento inválido.");
  }
  const amountCents = Number(row.amountCents);
  const installments = Number(row.installments);
  if (!Number.isInteger(amountCents) || amountCents <= 0) throw new Error("Valor inválido.");
  if (!Number.isInteger(installments) || installments < 1 || installments > 24) {
    throw new Error("Parcelamento inválido.");
  }
  return {
    id: text(row.id, "id"),
    tabId: text(row.tabId, "tabId"),
    installationId: text(row.installationId, "installationId"),
    provider: provider(row.provider),
    method: row.method as IntegratedPaymentMethod,
    amountCents,
    installments,
    status: row.status as PaymentAttemptStatus,
    providerReference: nullableText(row.providerReference),
    failureCode: nullableText(row.failureCode),
    failureMessage: nullableText(row.failureMessage),
    expiresAt: text(row.expiresAt, "expiresAt"),
    processingAt: nullableText(row.processingAt),
    resolvedAt: nullableText(row.resolvedAt),
    createdAt: text(row.createdAt, "createdAt"),
    updatedAt: text(row.updatedAt, "updatedAt"),
  };
}

function parseAction(value: unknown): PaymentAction | null {
  if (value === null || value === undefined) return null;
  const row = object(value, "ação de pagamento");
  if (!(["start", "recover", "cancel"] as const).includes(row.type as never)) {
    throw new Error("Ação de pagamento inválida.");
  }
  return {
    type: row.type as PaymentAction["type"],
    attemptId: text(row.attemptId, "attemptId"),
    provider: provider(row.provider),
  };
}

function parseAttemptAction(value: unknown): AttemptActionResponse {
  const row = object(value, "pagamento");
  return { attempt: parsePaymentAttempt(row.attempt), action: parseAction(row.action) };
}

function root(organizationId: string, unitId: string) {
  return `/v1/organizations/${encodeURIComponent(organizationId)}/units/${encodeURIComponent(unitId)}/pilot`;
}

export const posPayments = {
  capabilities: async (organizationId: string, unitId: string, installationId: string) =>
    parsePaymentCapabilities(
      await apiRequest<unknown>(
        `${root(organizationId, unitId)}/installations/${encodeURIComponent(installationId)}/payment-capabilities`,
      ),
    ),
  create: async (
    organizationId: string,
    unitId: string,
    tabId: string,
    input: {
      method: IntegratedPaymentMethod;
      amountCents: number;
      installments: number;
      installationId: string;
    },
    idempotencyKey: string,
  ) =>
    parseAttemptAction(
      await apiRequest<unknown>(
        `${root(organizationId, unitId)}/tabs/${encodeURIComponent(tabId)}/payment-attempts`,
        {
          method: "POST",
          headers: { "Idempotency-Key": idempotencyKey },
          body: JSON.stringify(input),
        },
      ),
    ),
  get: async (organizationId: string, unitId: string, attemptId: string) => {
    const row = object(
      await apiRequest<unknown>(
        `${root(organizationId, unitId)}/payment-attempts/${encodeURIComponent(attemptId)}`,
      ),
      "pagamento",
    );
    return parsePaymentAttempt(row.attempt);
  },
  recover: async (
    organizationId: string,
    unitId: string,
    attemptId: string,
    idempotencyKey: string,
  ) =>
    parseAttemptAction(
      await apiRequest<unknown>(
        `${root(organizationId, unitId)}/payment-attempts/${encodeURIComponent(attemptId)}/recover`,
        { method: "POST", headers: { "Idempotency-Key": idempotencyKey } },
      ),
    ),
  cancel: async (
    organizationId: string,
    unitId: string,
    attemptId: string,
    idempotencyKey: string,
  ) =>
    parseAttemptAction(
      await apiRequest<unknown>(
        `${root(organizationId, unitId)}/payment-attempts/${encodeURIComponent(attemptId)}/cancel`,
        { method: "POST", headers: { "Idempotency-Key": idempotencyKey } },
      ),
    ),
};
