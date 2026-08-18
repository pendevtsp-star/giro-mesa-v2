import { afterEach, describe, expect, it, vi } from "vitest";
import { isScopeEvent, realtimeUrl, subscribeScopeRealtime } from "./realtime";

afterEach(() => {
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
