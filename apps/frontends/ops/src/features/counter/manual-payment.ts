import { formatMoney } from "../../rules";

export type ManualPaymentMethod = "cash" | "credit_card" | "debit_card" | "pix" | "other";

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
