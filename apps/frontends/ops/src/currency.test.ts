import { describe, expect, it } from "vitest";
import { currencyToCents, formatCurrencyInput } from "./management.shared";

describe("entrada monetária brasileira", () => {
  it("formata dígitos como reais e preserva centavos inteiros", () => {
    expect(formatCurrencyInput("123456")).toBe("1.234,56");
    expect(currencyToCents(formatCurrencyInput("123456"))).toBe(123_456);
  });
});
