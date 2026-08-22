import { describe, expect, it, vi } from "vitest";
import {
  DEFAULT_KDS_BUMP_BAR_MAP,
  kdsBumpActionForKey,
  kdsBumpKeyLabel,
  readKdsBumpBarMap,
} from "./kds.bumpbar";

describe("KDS bump bar", () => {
  it("normalizes HID keys and rejects duplicate persisted mappings", () => {
    expect(kdsBumpActionForKey(DEFAULT_KDS_BUMP_BAR_MAP, "P")).toBe("print");
    vi.stubGlobal("localStorage", {
      getItem: () => JSON.stringify({ previous: "1", next: "1" }),
      setItem: vi.fn(),
    });
    expect(readKdsBumpBarMap("terminal")).toEqual(DEFAULT_KDS_BUMP_BAR_MAP);
    vi.unstubAllGlobals();
  });

  it("traduz as teclas exibidas sem alterar o código HID", () => {
    expect(kdsBumpKeyLabel(DEFAULT_KDS_BUMP_BAR_MAP.previous)).toBe("← Esquerda");
    expect(kdsBumpKeyLabel(DEFAULT_KDS_BUMP_BAR_MAP.next)).toBe("→ Direita");
    expect(kdsBumpKeyLabel(DEFAULT_KDS_BUMP_BAR_MAP.print)).toBe("P");
    expect(DEFAULT_KDS_BUMP_BAR_MAP.previous).toBe("ArrowLeft");
  });
});
