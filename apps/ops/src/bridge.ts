import type { OperationalCommandInput } from "@giromesa/contracts";

export interface DeviceContext {
  embedded: boolean;
  deviceId: string;
  deviceName: string;
  platform: string;
  hubUrl?: string;
}

export interface ShellCommandResult {
  success: boolean;
  duplicate: boolean;
  errorCode?: string;
  result?: unknown;
}

export interface ShellOperationalStateResult {
  success: boolean;
  payload?: unknown;
  errorCode?: string;
}

interface HybridWebViewApi {
  SendRawMessage(message: string): void;
  InvokeDotNet?<T>(method: string, args?: unknown[]): Promise<T>;
}

declare global {
  interface Window {
    HybridWebView?: HybridWebViewApi;
  }
}

const standaloneDeviceKey = "giromesa.ops.device-id";

export function connectShell(onContext: (context: DeviceContext) => void): () => void {
  const onMessage = (event: Event) => {
    const raw = (event as CustomEvent<{ message?: string }>).detail?.message;
    const context = parseShellContext(raw);
    if (context) onContext(context);
  };
  window.addEventListener("HybridWebViewMessageReceived", onMessage);
  const announceReady = () => {
    try {
      window.HybridWebView?.SendRawMessage(JSON.stringify({ type: "shell.ready" }));
    } catch {
      onContext(standaloneContext());
    }
  };
  window.addEventListener("GiroMesaHybridWebViewReady", announceReady);
  if (window.HybridWebView) announceReady();
  else onContext(standaloneContext());
  return () => {
    window.removeEventListener("HybridWebViewMessageReceived", onMessage);
    window.removeEventListener("GiroMesaHybridWebViewReady", announceReady);
  };
}

export function parseShellContext(raw?: string): DeviceContext | null {
  if (!raw) return null;
  try {
    const message = JSON.parse(raw) as {
      type?: string;
      payload?: Record<string, unknown>;
    };
    if (message.type !== "shell.context" || !message.payload) return null;
    const deviceId = readString(message.payload, "DeviceId", "deviceId");
    if (!deviceId) return null;
    return {
      embedded: true,
      deviceId,
      deviceName: readString(message.payload, "DeviceName", "deviceName") ?? "Terminal GiroMesa",
      platform: readString(message.payload, "Platform", "platform") ?? "unknown",
      hubUrl: readString(message.payload, "HubUrl", "hubUrl") ?? undefined,
    };
  } catch {
    return null;
  }
}

export async function sendShellCommand(
  organizationId: string,
  unitId: string,
  actorId: string,
  command: OperationalCommandInput,
): Promise<ShellCommandResult | null> {
  const invoke = window.HybridWebView?.InvokeDotNet;
  if (!invoke) return null;

  try {
    const result = await invoke<Record<string, unknown>>("SendCommandAsync", [
      organizationId,
      unitId,
      actorId,
      JSON.stringify(command),
    ]);
    return {
      success: readBoolean(result, "Success", "success"),
      duplicate: readBoolean(result, "Duplicate", "duplicate"),
      errorCode: readString(result, "ErrorCode", "errorCode") ?? undefined,
      result: readUnknown(result, "Result", "result"),
    };
  } catch {
    return { success: false, duplicate: false, errorCode: "SHELL_BRIDGE_UNAVAILABLE" };
  }
}

export async function loadShellOperationalState(
  resource: "catalog" | "floor" | "tabs" | "tab" | "kds" | "reconciliation",
  resourceId?: string,
): Promise<ShellOperationalStateResult | null> {
  const invoke = window.HybridWebView?.InvokeDotNet;
  if (!invoke) return null;

  try {
    const result = await invoke<Record<string, unknown>>("GetOperationalStateAsync", [
      resource,
      resourceId ?? null,
    ]);
    return {
      success: readBoolean(result, "Success", "success"),
      payload: readUnknown(result, "Payload", "payload"),
      errorCode: readString(result, "ErrorCode", "errorCode") ?? undefined,
    };
  } catch {
    return { success: false, errorCode: "SHELL_BRIDGE_UNAVAILABLE" };
  }
}

function standaloneContext(): DeviceContext {
  let deviceId = localStorage.getItem(standaloneDeviceKey);
  if (!deviceId) {
    deviceId = crypto.randomUUID();
    localStorage.setItem(standaloneDeviceKey, deviceId);
  }
  return {
    embedded: false,
    deviceId,
    deviceName: "Navegador atual",
    platform: navigator.platform || "web",
  };
}

function readString(source: Record<string, unknown>, ...keys: string[]): string | null {
  for (const key of keys) {
    if (typeof source[key] === "string" && source[key]) return source[key];
  }
  return null;
}

function readBoolean(source: Record<string, unknown>, ...keys: string[]): boolean {
  for (const key of keys) {
    if (typeof source[key] === "boolean") return source[key];
  }
  return false;
}

function readUnknown(source: Record<string, unknown>, ...keys: string[]): unknown {
  for (const key of keys) {
    if (key in source && source[key] !== null && source[key] !== undefined) return source[key];
  }
  return undefined;
}
