import type {
  IntegratedPaymentMethod,
  PaymentAction,
  PaymentAttempt,
  PaymentProvider,
} from "./pos-payments";

export interface ShellPaymentResult {
  success: boolean;
  launched: boolean;
  status: string;
  attemptId: string;
  providerReference: string | null;
  errorCode: string | null;
  requiresReconciliation: boolean;
}

export interface ShellPaymentCapabilities {
  available: boolean;
  configured: boolean;
  homologated: boolean;
  provider: PaymentProvider | null;
  environment: string | null;
  methods: IntegratedPaymentMethod[];
  canStart: boolean;
  canRecover: boolean;
  canCancel: boolean;
  pendingAttemptId: string | null;
  errorCode: string | null;
}

export interface ShellPendingPaymentPairing {
  available: boolean;
  apiBaseUrl: string | null;
  code: string | null;
  errorCode: string | null;
}

export interface ShellPaymentPairingResult {
  success: boolean;
  installationId: string | null;
  provider: PaymentProvider | null;
  available: boolean;
  errorCode: string | null;
}

function read(value: Record<string, unknown>, pascal: string, camel: string) {
  return value[pascal] ?? value[camel];
}

function parseResult(value: unknown, attemptId: string): ShellPaymentResult {
  const row = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  return {
    success: read(row, "Success", "success") === true,
    launched: read(row, "Launched", "launched") === true,
    status: String(read(row, "Status", "status") ?? "unknown"),
    attemptId: String(read(row, "AttemptId", "attemptId") ?? attemptId),
    providerReference:
      typeof read(row, "ProviderReference", "providerReference") === "string"
        ? String(read(row, "ProviderReference", "providerReference"))
        : null,
    errorCode:
      typeof read(row, "ErrorCode", "errorCode") === "string"
        ? String(read(row, "ErrorCode", "errorCode"))
        : null,
    requiresReconciliation: read(row, "RequiresReconciliation", "requiresReconciliation") === true,
  };
}

async function invoke(method: string, args: unknown[], attemptId: string) {
  const bridge = window.HybridWebView?.InvokeDotNet;
  if (!bridge) {
    return parseResult({ errorCode: "PAYMENT_BRIDGE_UNAVAILABLE" }, attemptId);
  }
  try {
    return parseResult(await bridge<unknown>(method, args), attemptId);
  } catch {
    return parseResult({ errorCode: "PAYMENT_BRIDGE_UNAVAILABLE" }, attemptId);
  }
}

export function shellPaymentAvailable() {
  return typeof window.HybridWebView?.InvokeDotNet === "function";
}

export async function getShellPaymentCapabilities(): Promise<ShellPaymentCapabilities> {
  const bridge = window.HybridWebView?.InvokeDotNet;
  if (!bridge) {
    return {
      available: false,
      configured: false,
      homologated: false,
      provider: null,
      environment: null,
      methods: [],
      canStart: false,
      canRecover: false,
      canCancel: false,
      pendingAttemptId: null,
      errorCode: "PAYMENT_BRIDGE_UNAVAILABLE",
    };
  }
  try {
    const result = await bridge<unknown>("GetPaymentCapabilitiesAsync");
    const row = result && typeof result === "object" ? (result as Record<string, unknown>) : {};
    const pendingAttemptId = read(row, "PendingAttemptId", "pendingAttemptId");
    const errorCode = read(row, "ErrorCode", "errorCode");
    const provider = read(row, "Provider", "provider");
    const environment = read(row, "Environment", "environment");
    const methods = read(row, "Methods", "methods");
    return {
      available: read(row, "Available", "available") === true,
      configured: read(row, "Configured", "configured") === true,
      homologated: read(row, "Homologated", "homologated") === true,
      provider:
        typeof provider === "string" &&
        ["rede", "paygo", "stone", "getnet", "cielo", "pagbank"].includes(provider)
          ? (provider as PaymentProvider)
          : null,
      environment: typeof environment === "string" ? environment : null,
      methods: Array.isArray(methods)
        ? methods.filter(
            (method): method is IntegratedPaymentMethod =>
              method === "credit_card" || method === "debit_card" || method === "pix",
          )
        : [],
      canStart: read(row, "CanStart", "canStart") === true,
      canRecover: read(row, "CanRecover", "canRecover") === true,
      canCancel: read(row, "CanCancel", "canCancel") === true,
      pendingAttemptId: typeof pendingAttemptId === "string" ? pendingAttemptId : null,
      errorCode: typeof errorCode === "string" ? errorCode : null,
    };
  } catch {
    return {
      available: false,
      configured: false,
      homologated: false,
      provider: null,
      environment: null,
      methods: [],
      canStart: false,
      canRecover: false,
      canCancel: false,
      pendingAttemptId: null,
      errorCode: "PAYMENT_BRIDGE_UNAVAILABLE",
    };
  }
}

export async function consumePendingShellPaymentPairing(): Promise<ShellPendingPaymentPairing> {
  const bridge = window.HybridWebView?.InvokeDotNet;
  if (!bridge) {
    return {
      available: false,
      apiBaseUrl: null,
      code: null,
      errorCode: "PAYMENT_PAIRING_BRIDGE_UNAVAILABLE",
    };
  }
  try {
    const result = await bridge<unknown>("ConsumePendingPaymentPairingAsync");
    const row = result && typeof result === "object" ? (result as Record<string, unknown>) : {};
    const apiBaseUrl = read(row, "ApiBaseUrl", "apiBaseUrl");
    const code = read(row, "Code", "code");
    const errorCode = read(row, "ErrorCode", "errorCode");
    return {
      available: read(row, "Available", "available") === true,
      apiBaseUrl: typeof apiBaseUrl === "string" ? apiBaseUrl : null,
      code: typeof code === "string" ? code : null,
      errorCode: typeof errorCode === "string" ? errorCode : null,
    };
  } catch {
    return {
      available: false,
      apiBaseUrl: null,
      code: null,
      errorCode: "PAYMENT_PAIRING_BRIDGE_UNAVAILABLE",
    };
  }
}

export async function redeemShellPaymentPairing(
  apiBaseUrl: string,
  code: string,
): Promise<ShellPaymentPairingResult> {
  const bridge = window.HybridWebView?.InvokeDotNet;
  if (!bridge) {
    return {
      success: false,
      installationId: null,
      provider: null,
      available: false,
      errorCode: "PAYMENT_PAIRING_BRIDGE_UNAVAILABLE",
    };
  }
  try {
    const result = await bridge<unknown>("RedeemPaymentPairingAsync", [apiBaseUrl, code]);
    const row = result && typeof result === "object" ? (result as Record<string, unknown>) : {};
    const returnedInstallationId = read(row, "InstallationId", "installationId");
    const returnedProvider = read(row, "Provider", "provider");
    const errorCode = read(row, "ErrorCode", "errorCode");
    return {
      success: read(row, "Success", "success") === true,
      installationId: typeof returnedInstallationId === "string" ? returnedInstallationId : null,
      provider:
        typeof returnedProvider === "string" &&
        ["rede", "paygo", "stone", "getnet", "cielo", "pagbank"].includes(returnedProvider)
          ? (returnedProvider as PaymentProvider)
          : null,
      available: read(row, "Available", "available") === true,
      errorCode: typeof errorCode === "string" ? errorCode : null,
    };
  } catch {
    return {
      success: false,
      installationId: null,
      provider: null,
      available: false,
      errorCode: "PAYMENT_PAIRING_BRIDGE_UNAVAILABLE",
    };
  }
}

export function startShellPayment(attempt: PaymentAttempt, action: PaymentAction) {
  return invoke("StartPaymentAsync", [action.attemptId], attempt.id);
}

export function recoverShellPayment(attemptId: string) {
  return invoke("RecoverPaymentAsync", [attemptId], attemptId);
}

export function cancelShellPayment(attemptId: string) {
  return invoke("CancelPaymentAsync", [attemptId], attemptId);
}
