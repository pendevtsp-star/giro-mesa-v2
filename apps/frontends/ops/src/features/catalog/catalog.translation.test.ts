import { describe, expect, it } from "vitest";
import { autoTranslateProduct } from "./catalog.translation";

describe("tradução automática do catálogo", () => {
  it("prioriza frases culinárias completas e preserva as descrições atuais", () => {
    expect(
      autoTranslateProduct("Risoto do Cerrado", "Arroz arbóreo com castanhas de baru"),
    ).toEqual({
      en: {
        name: "Cerrado Wild Mushroom & Baru Risotto",
        description: "Arborio rice with Baru nuts",
      },
      es: {
        name: "Risotto del Cerrado con Setas y Barú",
        description: "Arroz arbóreo con Nueces de Barú",
      },
    });
  });

  it("traduz palavras isoladas e mantém pontuação e capitalização", () => {
    expect(autoTranslateProduct("Frango grelhado com arroz", "Peixe, camarão e salada.")).toEqual({
      en: {
        name: "Chicken grilled with rice",
        description: "Fish, shrimp and salad.",
      },
      es: {
        name: "Pollo a la parrilla con arroz",
        description: "Pescado, camarón y ensalada.",
      },
    });
  });

  it("mantém o fallback de descrição quando ela não foi informada", () => {
    expect(autoTranslateProduct("Pudim")).toEqual({
      en: { name: "Flan", description: "Delicious flan freshly prepared." },
      es: { name: "Flan", description: "Delicioso plato de flan recién preparado." },
    });
  });
});
