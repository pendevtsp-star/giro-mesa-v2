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
    expect(invalidate).toHaveBeenCalledTimes(2);
    unsubscribe();
    vi.advanceTimersByTime(1_000);
    expect(invalidate).toHaveBeenCalledTimes(2);
  });
});
