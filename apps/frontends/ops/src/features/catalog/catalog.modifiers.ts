export type ModifierOptionDraft = { id: string; name: string; price: string };

export function modifierPriceToCents(value: string): number | null {
  const text = value.trim();
  if (!/^(?:\d+|\d{1,3}(?:\.\d{3})+)(?:,\d{1,2})?$/.test(text)) return null;
  const [whole, fraction = ""] = text.replaceAll(".", "").split(",");
  const cents = Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
  return Number.isSafeInteger(cents) && cents <= 2_147_483_647 ? cents : null;
}

export function validateModifierDraft(
  name: string,
  minimum: string,
  maximum: string,
  rows: ModifierOptionDraft[],
) {
  const min = Number(minimum);
  const max = Number(maximum);
  const names = rows.map((row) => row.name.trim().normalize("NFC").toLocaleLowerCase("pt-BR"));
  const rowErrors = rows.map((row, index) => ({
    name: !names[index]
      ? "Informe o nome da opção."
      : row.name.trim().length > 120
        ? "Use até 120 caracteres."
        : names.some((other, otherIndex) => otherIndex !== index && other === names[index])
          ? "Já existe uma opção com esse nome."
          : "",
    price:
      modifierPriceToCents(row.price) === null
        ? "Informe um preço válido em reais, como 4,50."
        : "",
  }));
  const nameError = !name.trim()
    ? "Informe o nome do grupo."
    : name.trim().length > 120
      ? "Use até 120 caracteres."
      : "";
  const limitsError =
    !minimum.trim() ||
    !maximum.trim() ||
    !Number.isInteger(min) ||
    !Number.isInteger(max) ||
    min < 0 ||
    max < 1 ||
    min > 50 ||
    max > 50
      ? "Informe escolhas inteiras: mínima de 0 a 50 e máxima de 1 a 50."
      : min > max
        ? "A escolha mínima não pode superar a máxima."
        : "";
  const optionsError =
    rows.length === 0
      ? "Adicione pelo menos uma opção."
      : rows.length > 100
        ? "Use até 100 opções por grupo."
        : "";
  const valid =
    !nameError &&
    !limitsError &&
    !optionsError &&
    rowErrors.every((error) => !error.name && !error.price);
  const summary = limitsError
    ? ""
    : min === 0
      ? `O cliente pode escolher até ${max} ${max === 1 ? "opção" : "opções"}.`
      : min === max
        ? `O cliente deve escolher ${min} ${min === 1 ? "opção" : "opções"}.`
        : `O cliente deve escolher de ${min} a ${max} opções.`;
  return {
    valid,
    nameError,
    limitsError,
    optionsError,
    rowErrors,
    summary,
    body: {
      name: name.trim(),
      minimumSelections: min,
      maximumSelections: max,
      options: rows.map((row, sortOrder) => ({
        name: row.name.trim(),
        priceDeltaCents: modifierPriceToCents(row.price) ?? 0,
        sortOrder,
      })),
    },
  };
}
