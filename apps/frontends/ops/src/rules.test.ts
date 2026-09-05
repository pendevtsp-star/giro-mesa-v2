import { describe, expect, it } from "vitest";
import type { CartItem, Profile } from "./domain";
import { profiles } from "./profiles";
import { calculateCartTotal, canAccess, isValidTerminalPin, nextTicketStatus } from "./rules";

const waiter: Profile = {
  id: "waiter",
  name: "Lia",
  shortName: "LM",
  role: "Garçom",
  description: "Atendimento",
  permissions: ["dashboard.view", "salon.operate"],
};

describe("regras operacionais", () => {
  it("limita rotas por permissão", () => {
    expect(canAccess(waiter, "salon")).toBe(true);
    expect(canAccess(waiter, "finance")).toBe(false);
    expect(canAccess(waiter, "reports")).toBe(false);
    expect(
      canAccess({ ...waiter, id: "finance", permissions: ["finance.manage"] }, "reports"),
    ).toBe(true);
    expect(
      canAccess({ ...waiter, id: "accountant", permissions: ["accounting.view"] }, "accountant"),
    ).toBe(true);
    expect(canAccess(waiter, "fiscal")).toBe(false);
    expect(canAccess(waiter, "billing")).toBe(false);
    expect(canAccess(waiter, "table-qrs")).toBe(false);
    const owner = profiles.find((profile) => profile.id === "owner");
    const manager = profiles.find((profile) => profile.id === "manager");
    expect(owner && canAccess(owner, "billing")).toBe(true);
    expect(manager && canAccess(manager, "billing")).toBe(false);
    expect(owner && canAccess(owner, "table-qrs")).toBe(true);
    expect(manager && canAccess(manager, "table-qrs")).toBe(true);
  });

  it("calcula quantidade, produto e modificador em centavos", () => {
    const items: CartItem[] = [
      {
        id: "1",
        productId: "p1",
        name: "Prato",
        quantity: 2,
        unitPriceCents: 2500,
        modifier: { id: "m1", name: "Extra", priceCents: 300 },
      },
    ];
    expect(calculateCartTotal(items)).toBe(5600);
  });

  it("mantém transição de KDS monotônica e PIN de quatro dígitos", () => {
    expect(nextTicketStatus("new")).toBe("preparing");
    expect(nextTicketStatus("preparing")).toBe("ready");
    expect(nextTicketStatus("ready")).toBe("ready");
    expect(isValidTerminalPin("0427")).toBe(true);
    expect(isValidTerminalPin("42ab")).toBe(false);
  });
});
