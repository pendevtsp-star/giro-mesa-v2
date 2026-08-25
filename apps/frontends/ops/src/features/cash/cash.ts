import type { CashEntry } from "../../management.shared";

const entryLabels: Record<string, string> = {
  pos_payment: "Venda do atendimento",
  receivable_payment: "Conta recebida",
  payable_payment: "Conta paga",
  supply: "Suprimento",
  withdrawal: "Sangria",
  transfer_in: "Transferência recebida",
  transfer_out: "Transferência enviada",
  refund: "Estorno",
  reversal: "Reversão",
};

const methodLabels: Record<string, string> = {
  cash: "Dinheiro",
  pix: "Pix",
  credit_card: "Cartão de crédito",
  debit_card: "Cartão de débito",
  bank_transfer: "Transferência",
  other: "Outro",
};

export function cashEntryLabel(entryType: string) {
  return entryLabels[entryType] ?? "Lançamento";
}

export function paymentMethodLabel(method: string | null) {
  return method ? (methodLabels[method] ?? method) : "Sem método";
}

export function summarizeCashEntries(entries: CashEntry[]) {
  const summary = { drawerInCents: 0, drawerOutCents: 0, byMethod: new Map<string, number>() };
  for (const entry of entries) {
    if (entry.affectsDrawer) {
      if (entry.direction === "in") summary.drawerInCents += entry.amountCents;
      else summary.drawerOutCents += entry.amountCents;
    }
    if (entry.paymentMethod) {
      summary.byMethod.set(
        entry.paymentMethod,
        (summary.byMethod.get(entry.paymentMethod) ?? 0) +
          (entry.direction === "in" ? entry.amountCents : -entry.amountCents),
      );
    }
  }
  return summary;
}
