import { api } from "./api";

export type RealtimeStatus = "connecting" | "live" | "polling";

export interface RealtimeScope {
  organizationId: string;
  unitId: string;
}

export interface RealtimeFreshness {
  transport: "websocket" | "polling";
  lastConfirmedAt: string | null;
  ageMs: number | null;
  stale: boolean;
}

export interface ScopeRealtimeEvent {
  type: "event";
  topic?: string;
  aggregateType?: string;
  aggregateId?: string;
  payload?: Record<string, unknown>;
  createdAt?: string;
}

export interface RealtimeOptions {
  handshakeTimeoutMs?: number;
  heartbeatMs?: number;
  heartbeatTimeoutMs?: number;
  reconnectMs?: number;
  staleAfterMs?: number;
  onFreshness?: (freshness: RealtimeFreshness) => void;
  shouldInvalidate?: (event: ScopeRealtimeEvent) => boolean;
  onEvent?: (event: ScopeRealtimeEvent) => void;
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

function scopeEvent(value: unknown): ScopeRealtimeEvent | null {
  return isScopeEvent(value) ? (value as ScopeRealtimeEvent) : null;
}

export function subscribeScopeRealtime(
  scope: RealtimeScope,
  onInvalidate: () => unknown | Promise<unknown>,
  onStatus: (status: RealtimeStatus) => void,
  pollingMs = 15_000,
  options: RealtimeOptions = {},
): () => void {
  const handshakeTimeoutMs = options.handshakeTimeoutMs ?? 5_000;
  const heartbeatMs = options.heartbeatMs ?? 20_000;
  const heartbeatTimeoutMs = options.heartbeatTimeoutMs ?? 5_000;
  const reconnectMs = options.reconnectMs ?? 5_000;
  const staleAfterMs = options.staleAfterMs ?? Math.max(pollingMs * 2, 30_000);
  let disposed = false;
  let socket: WebSocket | null = null;
  let subscribed = false;
  let lastConfirmedAt: number | null = null;
  let reconnectTimer: ReturnType<typeof globalThis.setTimeout> | undefined;
  let pollingTimer: ReturnType<typeof globalThis.setInterval> | undefined;
  let handshakeTimer: ReturnType<typeof globalThis.setTimeout> | undefined;
  let heartbeatTimer: ReturnType<typeof globalThis.setInterval> | undefined;
  let heartbeatAckTimer: ReturnType<typeof globalThis.setTimeout> | undefined;

  const freshness = (transport: RealtimeFreshness["transport"]) => {
    const ageMs = lastConfirmedAt === null ? null : Math.max(0, Date.now() - lastConfirmedAt);
    options.onFreshness?.({
      transport,
      lastConfirmedAt: lastConfirmedAt === null ? null : new Date(lastConfirmedAt).toISOString(),
      ageMs,
      stale: ageMs === null || ageMs > staleAfterMs,
    });
  };

  const clearSocketTimers = () => {
    if (handshakeTimer !== undefined) globalThis.clearTimeout(handshakeTimer);
    if (heartbeatTimer !== undefined) globalThis.clearInterval(heartbeatTimer);
    if (heartbeatAckTimer !== undefined) globalThis.clearTimeout(heartbeatAckTimer);
    handshakeTimer = undefined;
    heartbeatTimer = undefined;
    heartbeatAckTimer = undefined;
  };

  const stopPolling = () => {
    if (pollingTimer !== undefined) globalThis.clearInterval(pollingTimer);
    pollingTimer = undefined;
  };

  const startPolling = () => {
    if (disposed || pollingTimer !== undefined) return;
    subscribed = false;
    clearSocketTimers();
    onStatus("polling");
    freshness("polling");
    const poll = async () => {
      try {
        const confirmed = await onInvalidate();
        if (confirmed === true) lastConfirmedAt = Date.now();
      } catch {
        // O polling só confirma freshness quando o recarregamento informa sucesso.
      } finally {
        freshness("polling");
      }
    };
    void poll();
    pollingTimer = globalThis.setInterval(() => void poll(), pollingMs);
  };

  const connect = () => {
    const url = realtimeUrl();
    if (disposed || !url || typeof WebSocket === "undefined") {
      startPolling();
      return;
    }
    onStatus("connecting");
    let fallbackStarted = false;
    const fallback = () => {
      if (disposed || fallbackStarted) return;
      fallbackStarted = true;
      clearSocketTimers();
      startPolling();
      if (reconnectTimer === undefined) {
        reconnectTimer = globalThis.setTimeout(() => {
          reconnectTimer = undefined;
          connect();
        }, reconnectMs);
      }
    };
    try {
      socket = new WebSocket(url);
    } catch {
      fallback();
      return;
    }
    handshakeTimer = globalThis.setTimeout(() => {
      socket?.close(4000, "Timeout de conexão");
      fallback();
    }, handshakeTimeoutMs);
    const sendSubscription = () => {
      if (socket?.readyState !== WebSocket.OPEN) {
        fallback();
        return;
      }
      socket.send(JSON.stringify({ type: "subscribe", ...scope }));
      if (heartbeatAckTimer !== undefined) globalThis.clearTimeout(heartbeatAckTimer);
      heartbeatAckTimer = globalThis.setTimeout(() => {
        socket?.close(4000, "Heartbeat sem confirmação");
        fallback();
      }, heartbeatTimeoutMs);
    };
    socket.addEventListener("open", () => {
      if (disposed) return;
      sendSubscription();
    });
    socket.addEventListener("message", (event) => {
      try {
        const value = JSON.parse(String(event.data)) as unknown;
        if (
          typeof value === "object" &&
          value !== null &&
          (value as Record<string, unknown>).type === "subscribed"
        ) {
          subscribed = true;
          fallbackStarted = false;
          stopPolling();
          if (handshakeTimer !== undefined) globalThis.clearTimeout(handshakeTimer);
          if (heartbeatAckTimer !== undefined) globalThis.clearTimeout(heartbeatAckTimer);
          handshakeTimer = undefined;
          heartbeatAckTimer = undefined;
          lastConfirmedAt = Date.now();
          onStatus("live");
          freshness("websocket");
          if (heartbeatTimer === undefined) {
            heartbeatTimer = globalThis.setInterval(sendSubscription, heartbeatMs);
          }
          return;
        }
        const scopedEvent = scopeEvent(value);
        if (subscribed && scopedEvent) {
          lastConfirmedAt = Date.now();
          freshness("websocket");
          options.onEvent?.(scopedEvent);
          if (options.shouldInvalidate?.(scopedEvent) ?? true) onInvalidate();
        }
      } catch {
        // Mensagens desconhecidas não invalidam o estado nem derrubam a conexão.
      }
    });
    socket.addEventListener("close", fallback);
    socket.addEventListener("error", fallback);
  };

  connect();
  return () => {
    disposed = true;
    stopPolling();
    clearSocketTimers();
    if (reconnectTimer !== undefined) globalThis.clearTimeout(reconnectTimer);
    socket?.close(1000, "Escopo alterado");
  };
}
