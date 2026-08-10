import { api } from "./api";

export type RealtimeStatus = "connecting" | "live" | "polling";

export interface RealtimeScope {
  organizationId: string;
  unitId: string;
}

export function realtimeUrl(apiBaseUrl = api.baseUrl): string | null {
  try {
    const url = new URL("/v1/realtime", apiBaseUrl);
    url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
    return url.toString();
  } catch {
    return null;
  }
}

export function isScopeEvent(value: unknown): boolean {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  return (value as Record<string, unknown>).type === "event";
}

export function subscribeScopeRealtime(
  scope: RealtimeScope,
  onInvalidate: () => void,
  onStatus: (status: RealtimeStatus) => void,
  pollingMs = 15_000,
): () => void {
  let disposed = false;
  let socket: WebSocket | null = null;
  let reconnectTimer: ReturnType<typeof globalThis.setTimeout> | undefined;
  let pollingTimer: ReturnType<typeof globalThis.setInterval> | undefined;

  const stopPolling = () => {
    if (pollingTimer !== undefined) globalThis.clearInterval(pollingTimer);
    pollingTimer = undefined;
  };

  const startPolling = () => {
    if (disposed || pollingTimer !== undefined) return;
    onStatus("polling");
    pollingTimer = globalThis.setInterval(onInvalidate, pollingMs);
  };

  const connect = () => {
    const url = realtimeUrl();
    if (disposed || !url || typeof WebSocket === "undefined") {
      startPolling();
      return;
    }
    onStatus("connecting");
    try {
      socket = new WebSocket(url);
    } catch {
      startPolling();
      return;
    }
    socket.addEventListener("open", () => {
      if (disposed) return;
      stopPolling();
      socket?.send(JSON.stringify({ type: "subscribe", ...scope }));
    });
    socket.addEventListener("message", (event) => {
      try {
        const value = JSON.parse(String(event.data)) as unknown;
        if (
          typeof value === "object" &&
          value !== null &&
          (value as Record<string, unknown>).type === "subscribed"
        ) {
          onStatus("live");
        }
        if (isScopeEvent(value)) onInvalidate();
      } catch {
        // Mensagens desconhecidas não invalidam o estado nem derrubam a conexão.
      }
    });
    const fallback = () => {
      if (disposed) return;
      startPolling();
      if (reconnectTimer === undefined) {
        reconnectTimer = globalThis.setTimeout(() => {
          reconnectTimer = undefined;
          connect();
        }, 5_000);
      }
    };
    socket.addEventListener("close", fallback);
    socket.addEventListener("error", fallback);
  };

  connect();
  return () => {
    disposed = true;
    stopPolling();
    if (reconnectTimer !== undefined) globalThis.clearTimeout(reconnectTimer);
    socket?.close(1000, "Escopo alterado");
  };
}
