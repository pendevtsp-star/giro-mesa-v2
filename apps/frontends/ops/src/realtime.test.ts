import { afterEach, describe, expect, it, vi } from "vitest";
import { isScopeEvent, realtimeUrl, subscribeScopeRealtime } from "./realtime";

class FakeWebSocket {
  static readonly OPEN = 1;
  static latest: FakeWebSocket | undefined;
  readonly readyState = FakeWebSocket.OPEN;
  private readonly listeners = new Map<string, (event: { data?: unknown }) => void>();

  constructor() {
    FakeWebSocket.latest = this;
  }

  addEventListener(event: string, listener: (event: { data?: unknown }) => void) {
    this.listeners.set(event, listener);
  }

  send() {}

  close() {
    this.listeners.get("close")?.({});
  }

  emit(event: string, data?: unknown) {
    this.listeners.get(event)?.({ data });
  }
}

afterEach(() => {
  FakeWebSocket.latest = undefined;
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("invalidação em tempo real", () => {
  it("converte a origem HTTP e usa o endpoint autenticado correto", () => {
    expect(realtimeUrl("https://api.giromesa.com.br/base")).toBe(
      "wss://api.giromesa.com.br/v1/realtime",
    );
    expect(realtimeUrl("http://localhost:3200")).toBe("ws://localhost:3200/v1/realtime");
    expect(isScopeEvent({ type: "event", topic: "pos.tab_changed" })).toBe(true);
    expect(isScopeEvent({ type: "subscribed" })).toBe(false);
  });

  it("mantém dados desatualizados quando a ressincronização falha", async () => {
    vi.stubGlobal("WebSocket", FakeWebSocket);
    const invalidate = vi.fn().mockRejectedValue(new Error("offline"));
    const freshness = vi.fn();
    const unsubscribe = subscribeScopeRealtime(
      { organizationId: "org-1", unitId: "unit-1" },
      invalidate,
      vi.fn(),
      15_000,
      { shouldInvalidate: () => false, onFreshness: freshness },
    );
    const socket = FakeWebSocket.latest;
    expect(socket).toBeDefined();
    socket?.emit("open");
    socket?.emit("message", JSON.stringify({ type: "subscribed" }));
    socket?.emit("message", JSON.stringify({ type: "event", topic: "pos.tab_changed" }));
    expect(invalidate).not.toHaveBeenCalled();
    socket?.emit("message", JSON.stringify({ type: "event", topic: "system.realtime_resync" }));
    expect(invalidate).toHaveBeenCalledOnce();
    await vi.waitFor(() => {
      expect(freshness.mock.calls.at(-1)?.[0]).toMatchObject({
        transport: "websocket",
        lastConfirmedAt: null,
        stale: true,
      });
    });
    socket?.emit("message", JSON.stringify({ type: "subscribed" }));
    socket?.emit("message", JSON.stringify({ type: "event", topic: "pos.tab_changed" }));
    expect(freshness.mock.calls.at(-1)?.[0]).toMatchObject({
      transport: "websocket",
      lastConfirmedAt: null,
      stale: true,
    });
    unsubscribe();
  });

  it("ignora snapshot de polling anterior a uma ressincronização mais nova", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("WebSocket", FakeWebSocket);
    const resolvers: Array<(value: boolean) => void> = [];
    const invalidate = vi.fn(() => new Promise<boolean>((resolve) => resolvers.push(resolve)));
    const freshness = vi.fn();
    const unsubscribe = subscribeScopeRealtime(
      { organizationId: "org-1", unitId: "unit-1" },
      invalidate,
      vi.fn(),
      15_000,
      { reconnectMs: 1, shouldInvalidate: () => false, onFreshness: freshness },
    );
    const firstSocket = FakeWebSocket.latest;
    firstSocket?.emit("open");
    firstSocket?.emit("message", JSON.stringify({ type: "subscribed" }));
    firstSocket?.emit("close");
    expect(invalidate).toHaveBeenCalledOnce();

    await vi.advanceTimersByTimeAsync(1);
    const secondSocket = FakeWebSocket.latest;
    expect(secondSocket).not.toBe(firstSocket);
    secondSocket?.emit("open");
    secondSocket?.emit("message", JSON.stringify({ type: "subscribed" }));
    secondSocket?.emit(
      "message",
      JSON.stringify({ type: "event", topic: "system.realtime_resync" }),
    );
    expect(invalidate).toHaveBeenCalledTimes(2);

    resolvers[0]?.(true);
    await Promise.resolve();
    await Promise.resolve();
    expect(freshness.mock.calls.at(-1)?.[0]).toMatchObject({
      lastConfirmedAt: null,
      stale: true,
    });

    resolvers[1]?.(false);
    await Promise.resolve();
    await Promise.resolve();
    expect(freshness.mock.calls.at(-1)?.[0]).toMatchObject({
      lastConfirmedAt: null,
      stale: true,
    });
    unsubscribe();
  });

  it("usa polling determinístico quando WebSocket não existe", () => {
    vi.useFakeTimers();
    vi.stubGlobal("WebSocket", undefined);
    const invalidate = vi.fn();
    const status = vi.fn();
    const unsubscribe = subscribeScopeRealtime(
      { organizationId: "org-1", unitId: "unit-1" },
      invalidate,
      status,
      1_000,
    );

    expect(status).toHaveBeenCalledWith("polling");
    vi.advanceTimersByTime(2_100);
    expect(invalidate).toHaveBeenCalledTimes(3);
    unsubscribe();
    vi.advanceTimersByTime(1_000);
    expect(invalidate).toHaveBeenCalledTimes(3);
  });

  it("does not claim polling freshness when invalidation fails", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("WebSocket", undefined);
    const freshness = vi.fn();
    const unsubscribe = subscribeScopeRealtime(
      { organizationId: "org-1", unitId: "unit-1" },
      () => Promise.reject(new Error("offline")),
      vi.fn(),
      1_000,
      { onFreshness: freshness },
    );

    await vi.advanceTimersByTimeAsync(1_100);
    expect(freshness.mock.calls.at(-1)?.[0]).toMatchObject({
      transport: "polling",
      lastConfirmedAt: null,
      stale: true,
    });
    unsubscribe();
  });

  it("confirms polling freshness only after a successful snapshot refresh", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-17T20:00:00.000Z"));
    vi.stubGlobal("WebSocket", undefined);
    const freshness = vi.fn();
    const invalidate = vi.fn().mockResolvedValue(true);
    const unsubscribe = subscribeScopeRealtime(
      { organizationId: "org-1", unitId: "unit-1" },
      invalidate,
      vi.fn(),
      1_000,
      { onFreshness: freshness },
    );

    await vi.runOnlyPendingTimersAsync();
    expect(invalidate).toHaveBeenCalled();
    expect(freshness.mock.calls.at(-1)?.[0]).toMatchObject({
      transport: "polling",
      lastConfirmedAt: expect.any(String),
      stale: false,
    });
    unsubscribe();
  });
});
