import { describe, expect, it } from "vitest";
import { amountPerPerson } from "./AccountSplitModal";

describe("consulta de valor por pessoa", () => {
  it("distribui todos os centavos sem alterar o saldo consultado", () => {
    for (const [balance, people] of [
      [1000, 3],
      [5, 4],
      [12000, 3],
      [5000, 1],
    ] as const) {
      const result = amountPerPerson(balance, people);
      if (!result) throw new Error("Expected a valid calculation");
      expect(result.cents * people + result.extraPeople).toBe(balance);
    }
    expect(amountPerPerson(1000, 3)).toEqual({ cents: 333, extraPeople: 1 });
    expect(amountPerPerson(12000, 3)).toEqual({ cents: 4000, extraPeople: 0 });
  });
  it("rejeita valores inválidos e quantidades fracionárias", () => {
    for (const value of [-1, 0, 1.5, Number.NaN, Number.POSITIVE_INFINITY, 2 ** 53]) {
      expect(amountPerPerson(value, 2)).toBeNull();
      expect(amountPerPerson(1000, value)).toBeNull();
    }
    expect(amountPerPerson(1, 2)).toBeNull();
  });
});
