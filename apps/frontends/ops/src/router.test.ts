import { describe, expect, it } from "vitest";
import { parseRoute, routeHref } from "./router";

describe("roteamento operacional", () => {
  it("normaliza hashes e evita rotas desconhecidas", () => {
    expect(parseRoute("#/salon")).toBe("salon");
    expect(parseRoute("#cash")).toBe("cash");
    expect(parseRoute("#/reports")).toBe("reports");
    expect(parseRoute("#/fiscal")).toBe("fiscal");
    expect(parseRoute("#/accountant")).toBe("accountant");
    expect(parseRoute("#/waiter-settlements")).toBe("waiter-settlements");
    expect(parseRoute("#/counter?display=tab-123")).toBe("counter");
    expect(parseRoute("#/unknown")).toBe("dashboard");
    expect(routeHref("kds")).toBe("#/kds");
  });
});
