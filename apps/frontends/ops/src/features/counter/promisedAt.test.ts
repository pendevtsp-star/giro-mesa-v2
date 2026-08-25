import { describe, expect, it } from "vitest";
import { promisedAtToIso, quickOrderPromisedAtToIso, splitPromisedAt } from "./promisedAt";

describe("promisedAt", () => {
  it("converte o input nativo e mantém compatibilidade com data brasileira", () => {
    const iso = promisedAtToIso("2026-08-16", "19:30");
    expect(splitPromisedAt(iso)).toEqual({ date: "2026-08-16", time: "19:30" });
    expect(promisedAtToIso("16/08/2026", "19:30")).toBe(iso);
    expect(() => promisedAtToIso("2026-02-31", "19:30")).toThrow("data e hora válidas");
    expect(() => promisedAtToIso("31/02/2026", "19:30")).toThrow("data e hora válidas");
  });

  it("exige data e hora completas e prazo atual ou futuro apenas na abertura rápida", () => {
    const now = new Date(2026, 7, 16, 19, 30, 45).getTime();
    expect(() => quickOrderPromisedAtToIso("2026-08-16", "19:28", now)).toThrow(
      "agora ou no futuro",
    );
    expect(quickOrderPromisedAtToIso("2026-08-16", "19:30", now)).toBe(
      promisedAtToIso("2026-08-16", "19:30"),
    );
    expect(() => quickOrderPromisedAtToIso("2026-08-16", "", now)).toThrow("data e hora válidas");
    expect(promisedAtToIso("2026-08-16", "19:28")).toBeTruthy();
  });
});
