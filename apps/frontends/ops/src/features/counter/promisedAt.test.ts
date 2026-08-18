import { describe, expect, it } from "vitest";
import { promisedAtToIso, splitPromisedAt } from "./promisedAt";

describe("promisedAt", () => {
  it("converte o input nativo e mantém compatibilidade com data brasileira", () => {
    const iso = promisedAtToIso("2026-08-16", "19:30");
    expect(splitPromisedAt(iso)).toEqual({ date: "2026-08-16", time: "19:30" });
    expect(promisedAtToIso("16/08/2026", "19:30")).toBe(iso);
    expect(() => promisedAtToIso("2026-02-31", "19:30")).toThrow("data e hora válidas");
    expect(() => promisedAtToIso("31/02/2026", "19:30")).toThrow("data e hora válidas");
  });
});
