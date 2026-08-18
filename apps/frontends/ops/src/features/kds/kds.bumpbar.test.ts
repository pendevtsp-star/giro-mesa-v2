import { describe, expect, it, vi } from "vitest";
import { DEFAULT_KDS_BUMP_BAR_MAP, kdsBumpActionForKey, readKdsBumpBarMap } from "./kds.bumpbar";

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
});
