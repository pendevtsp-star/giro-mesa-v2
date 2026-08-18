import { afterEach, describe, expect, it, vi } from "vitest";
import {
  kdsAreaHref,
  kdsStationMenuLabel,
  parseKdsArea,
  readKdsLastOperationalArea,
  resolveKdsAreaPermission,
  saveKdsLastOperationalArea,
} from "./kds.navigation";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("navegação do KDS", () => {
  it("mantém rotas explícitas para praça, passe e configurações", () => {
    expect(kdsAreaHref("station")).toBe("#/kds/station");
    expect(kdsAreaHref("pass")).toBe("#/kds/pass");
    expect(kdsAreaHref("settings")).toBe("#/kds/settings");
    expect(parseKdsArea("#/kds/pass")).toBe("pass");
    expect(parseKdsArea("#/kds/settings?section=terminal")).toBe("settings");
    expect(parseKdsArea("#/kds", "pass")).toBe("pass");
    expect(resolveKdsAreaPermission("settings", false, "pass")).toBe("pass");
    expect(resolveKdsAreaPermission("settings", true, "pass")).toBe("settings");
  });

  it("persiste a última área operacional sem transformar configurações em destino do pai", () => {
    const values = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
    });

    expect(readKdsLastOperationalArea("unit-1")).toBe("station");
    saveKdsLastOperationalArea("unit-1", "pass");
    expect(readKdsLastOperationalArea("unit-1")).toBe("pass");
  });

  it("nomeia a praça somente quando ela está fixada neste terminal", () => {
    const values = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
    });

    expect(kdsStationMenuLabel("unit-1")).toBe("Praça — não fixada");
    values.set("giromesa:kds:unit-1:station-locked", "true");
    values.set("giromesa:kds:unit-1:station-label", "Bar");
    expect(kdsStationMenuLabel("unit-1")).toBe("Praça — Bar");
  });
});
