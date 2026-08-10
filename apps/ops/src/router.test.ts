import { describe, expect, it } from "vitest";
import { parseRoute, routeHref } from "./router";

describe("roteamento operacional", () => {
  it("normaliza hashes e evita rotas desconhecidas", () => {
    expect(parseRoute("#/salon")).toBe("salon");
    expect(parseRoute("#cash")).toBe("cash");
    expect(parseRoute("#/unknown")).toBe("dashboard");
    expect(routeHref("kds")).toBe("#/kds");
  });
});
