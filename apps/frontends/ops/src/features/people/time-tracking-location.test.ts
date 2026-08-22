import { describe, expect, it } from "vitest";
import { hasAcceptableLocationAccuracy, parseLocationNumber } from "./time-tracking-location";

describe("localização do ponto", () => {
  it("não transforma campos vazios em coordenadas 0,0", () => {
    expect(parseLocationNumber("")).toBeNull();
    expect(parseLocationNumber("  ")).toBeNull();
    expect(parseLocationNumber("-23.55052")).toBe(-23.55052);
  });

  it("rejeita uma posição aproximada demais para configurar o local", () => {
    expect(
      hasAcceptableLocationAccuracy(
        { latitude: -23.55, longitude: -46.63, accuracyMeters: 2_035_986 },
        100,
      ),
    ).toBe(false);
    expect(
      hasAcceptableLocationAccuracy(
        { latitude: -23.55, longitude: -46.63, accuracyMeters: 25 },
        100,
      ),
    ).toBe(true);
  });
});
