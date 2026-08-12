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

export interface ShellKdsAcknowledgementResult {
  success: boolean;
  errorCode?: string;
}

interface HybridWebViewApi {
  SendRawMessage(message: string): void;
  InvokeDotNet?<T>(method: string, args?: unknown[]): Promise<T>;
}

type BridgeScript = {
  src: string;
  dataset: Record<string, string>;
  addEventListener(type: "load" | "error", listener: () => void, options?: { once: boolean }): void;
};

type BridgeWindow = {
  HybridWebView?: HybridWebViewApi;
  chrome?: { webview?: { postMessage?: (message: string) => void } };
  webkit?: {
    messageHandlers?: { webwindowinterop?: { postMessage?: (message: string) => void } };
  };
  hybridWebViewHost?: { sendMessage?: (message: string) => void };
  dispatchEvent(event: unknown): void;
};

type NativeBridgeEnvironment = {
  window: BridgeWindow;
  document: {
    createElement(tagName: "script"): BridgeScript;
    head: { appendChild(script: BridgeScript): void };
    querySelector(selector: string): BridgeScript | null;
  };
  createReadyEvent(): unknown;
};

declare global {
  interface Window {
    HybridWebView?: HybridWebViewApi;
  }
}

const standaloneDeviceKey = "giromesa.ops.device-id";

export function loadNativeBridge(
  environment: NativeBridgeEnvironment = {
    window: window as unknown as BridgeWindow,
    document: document as unknown as NativeBridgeEnvironment["document"],
    createReadyEvent: () => new Event("GiroMesaHybridWebViewReady"),
  },
): "browser" | "loading" | "ready" {
  const host = environment.window;
  if (host.HybridWebView) {
    environment.window.dispatchEvent(environment.createReadyEvent());
    return "ready";
  }

  if (!hasNativeBridgeTransport(host)) return "browser";
  if (environment.document.querySelector('script[data-giromesa-bridge="true"]')) return "loading";

  const bridgeScript = environment.document.createElement("script");
  bridgeScript.src = "./_framework/hybridwebview.js";
  bridgeScript.dataset.giromesaBridge = "true";
  bridgeScript.addEventListener(
    "load",
    () => environment.window.dispatchEvent(environment.createReadyEvent()),
    { once: true },
  );
  environment.document.head.appendChild(bridgeScript);
  return "loading";
}

function hasNativeBridgeTransport(host: BridgeWindow): boolean {
  return Boolean(
    host.chrome?.webview?.postMessage ||
      host.webkit?.messageHandlers?.webwindowinterop?.postMessage ||
      host.hybridWebViewHost?.sendMessage,
  );
}

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

export async function acknowledgeShellKdsDispatch(
  effectId: string,
  deliveryKey: string,
): Promise<ShellKdsAcknowledgementResult | null> {
  const invoke = window.HybridWebView?.InvokeDotNet;
  if (!invoke) return null;

  try {
    const result = await invoke<Record<string, unknown>>("AcknowledgeKdsDispatchAsync", [
      effectId,
      deliveryKey,
    ]);
    return {
      success: readBoolean(result, "Success", "success"),
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
