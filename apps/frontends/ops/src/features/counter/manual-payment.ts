import { formatMoney } from "../../rules";

export type ManualPaymentMethod = "cash" | "credit_card" | "debit_card" | "pix" | "other";

export function manualPaymentValues(
  method: ManualPaymentMethod,
  receivedCents: number | null,
  availableCents: number,
) {
  const valid =
    receivedCents !== null &&
    Number.isSafeInteger(receivedCents) &&
    receivedCents > 0 &&
    Number.isSafeInteger(availableCents) &&
    availableCents > 0 &&
    (method === "cash" || receivedCents <= availableCents);
  const amountCents = valid ? Math.min(receivedCents, availableCents) : null;
  return {
    valid,
    amountCents,
    changeCents: valid && method === "cash" ? receivedCents - (amountCents ?? 0) : 0,
    remainingCents: valid ? availableCents - (amountCents ?? 0) : availableCents,
  };
}

export function manualPaymentSuccessMessage(
  method: ManualPaymentMethod,
  amountCents: number,
  remainingCents: number,
  changeCents: number,
) {
  if (method === "cash") {
    return `Pagamento registrado · troco ${formatMoney(changeCents)}.`;
  }
  return amountCents >= remainingCents ? "Pagamento concluído." : "Pagamento parcial registrado.";
}
