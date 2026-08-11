import { describe, expect, it, vi } from "vitest";
import { loadNativeBridge } from "./bridge";

function bridgeEnvironment(windowOverrides: Record<string, unknown> = {}) {
  const appended: Array<{ src: string; dataset: Record<string, string> }> = [];
  const dispatchEvent = vi.fn();
  const createElement = vi.fn(() => ({
    src: "",
    dataset: {} as Record<string, string>,
    addEventListener: vi.fn(),
  }));

  return {
    appended,
    createElement,
    dispatchEvent,
    environment: {
      window: { dispatchEvent, ...windowOverrides },
      document: {
        createElement,
        head: { appendChild: (script: (typeof appended)[number]) => appended.push(script) },
        querySelector: vi.fn(() => null),
      },
      createReadyEvent: () => ({ type: "GiroMesaHybridWebViewReady" }),
    },
  };
}

describe("bootstrap do bridge MAUI", () => {
  it("não solicita o script do bridge em um navegador comum", () => {
    const fixture = bridgeEnvironment({ chrome: {} });

    expect(loadNativeBridge(fixture.environment)).toBe("browser");
    expect(fixture.createElement).not.toHaveBeenCalled();
    expect(fixture.appended).toEqual([]);
  });

  it("carrega o bridge relativo somente quando um transporte nativo existe", () => {
    const fixture = bridgeEnvironment({
      chrome: { webview: { postMessage: vi.fn() } },
    });

    expect(loadNativeBridge(fixture.environment)).toBe("loading");
    expect(fixture.appended).toHaveLength(1);
    expect(fixture.appended[0]).toMatchObject({
      src: "./_framework/hybridwebview.js",
      dataset: { giromesaBridge: "true" },
    });
  });

  it("reaproveita a API já injetada sem criar outro script", () => {
    const fixture = bridgeEnvironment({ HybridWebView: { SendRawMessage: vi.fn() } });

    expect(loadNativeBridge(fixture.environment)).toBe("ready");
    expect(fixture.appended).toEqual([]);
    expect(fixture.dispatchEvent).toHaveBeenCalledWith({
      type: "GiroMesaHybridWebViewReady",
    });
  });
});
