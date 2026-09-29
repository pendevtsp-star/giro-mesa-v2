import type { CashData, CashEntry } from "../../management.shared";

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

export function cashHandoverCandidates(
  operators: CashData["operators"],
  responsibleIdentityId: string | null,
  actorIdentityId?: string,
) {
  return operators.filter(
    (operator) =>
      operator.identityId !== responsibleIdentityId && operator.identityId !== actorIdentityId,
  );
}

export function visibleCashAlerts(
  data: Pick<CashData, "alerts" | "capabilities" | "approvals" | "pendingTransfers">,
) {
  const alerts = data.alerts.filter((alert) => {
    if (alert.severity === "critical") return true;
    if (alert.code === "CASH_APPROVAL_PENDING" && data.capabilities.canApproveCashRequests) {
      return !data.approvals.some(
        (approval) =>
          approval.status === "pending" && approval.fromCashShiftId === alert.cashShiftId,
      );
    }
    if (alert.code === "CASH_TRANSFER_PENDING") {
      return !data.pendingTransfers.some(
        (transfer) => transfer.toCashShiftId === alert.cashShiftId,
      );
    }
    return true;
  });
  return [...new Map(alerts.map((alert) => [JSON.stringify(alert), alert])).values()];
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
