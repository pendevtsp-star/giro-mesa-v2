import { describe, expect, it } from "vitest";
import { modifierPriceToCents, validateModifierDraft } from "./catalog.modifiers";

describe("cadastro de adicionais", () => {
  it("converte reais sem perder centavos e rejeita entradas ambíguas ou inválidas", () => {
    for (const [input, expected] of [
      ["4,50", 450],
      ["4", 400],
      ["0,00", 0],
      ["1.234,56", 123456],
      ["0,29", 29],
    ] as const) {
      expect(modifierPriceToCents(input)).toBe(expected);
    }
    for (const input of ["", "-1", "4.50", "4,501", "abc", "1e3", "99999999999"]) {
      expect(modifierPriceToCents(input)).toBeNull();
    }
  });

  it("valida nomes, duplicatas e limites sem descartar linhas e prepara o payload", () => {
    const rows = [
      { id: "a", name: " Bacon ", price: "4,50" },
      { id: "b", name: "Molho", price: "0,00" },
    ];
    const valid = validateModifierDraft(" Extras ", "0", "2", rows);
    expect(valid.valid).toBe(true);
    expect(valid.summary).toBe("O cliente pode escolher até 2 opções.");
    expect(valid.body.options).toEqual([
      { name: "Bacon", priceDeltaCents: 450, sortOrder: 0 },
      { name: "Molho", priceDeltaCents: 0, sortOrder: 1 },
    ]);
    expect(validateModifierDraft("Extras", "1", "1", rows).summary).toBe(
      "O cliente deve escolher 1 opção.",
    );
    expect(validateModifierDraft("Extras", "2", "1", rows).valid).toBe(false);
    expect(validateModifierDraft("Extras", "", "1", rows).valid).toBe(false);
    expect(validateModifierDraft("Extras", "0.5", "2", rows).valid).toBe(false);
    expect(validateModifierDraft("Extras", "0", "51", rows).valid).toBe(false);
    expect(validateModifierDraft("Extras", "0", "1", []).valid).toBe(false);
    expect(validateModifierDraft("", "0", "1", rows).nameError).not.toBe("");
    expect(
      validateModifierDraft("Extras", "0", "2", [
        { id: "a", name: " Bacon ", price: "4,50" },
        { id: "b", name: "bacon", price: "0,00" },
      ]).rowErrors.every((error) => error.name),
    ).toBe(true);
    expect(
      validateModifierDraft("Extras", "0", "1", [{ id: "a", name: " ", price: "inválido" }])
        .rowErrors[0],
    ).toEqual({
      name: "Informe o nome da opção.",
      price: "Informe um preço válido em reais, como 4,50.",
    });
  });
});
