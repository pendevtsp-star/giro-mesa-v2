import type { PosPrintJob } from "../../api";
import type { PosItem, PosTab, TabPayment } from "../../operations.shared";

export function statementMatchesCurrentAccount(
  job: PosPrintJob,
  tab: PosTab,
  items: PosItem[],
  paidCents: number,
  payments: Pick<TabPayment, "id" | "method" | "netAmountCents" | "reversedCents">[] = [],
) {
  const document = job.payload;
  if (
    document.context.tabId !== tab.id ||
    (Boolean(tab.label) && document.context.label !== tab.label) ||
    document.totals.totalCents !== tab.totalCents ||
    document.totals.subtotalCents !== tab.subtotalCents ||
    document.totals.discountCents !== tab.discountCents ||
    document.totals.serviceChargeCents !== tab.serviceChargeCents ||
    document.totals.tipCents !== tab.tipCents ||
    (document.totals.deliveryFeeCents ?? 0) !== (tab.deliveryFeeCents ?? 0) ||
    document.totals.paidCents !== paidCents
  )
    return false;
  const printedPayments = document.payments ?? [];
  if (
    payments.length !== printedPayments.length ||
    !payments.every((payment) =>
      printedPayments.some(
        (line) =>
          line.id === payment.id &&
          line.method === payment.method &&
          (line.netAmountCents ?? line.amountCents) === payment.netAmountCents &&
          (line.reversedCents ?? 0) === payment.reversedCents,
      ),
    )
  )
    return false;
  const active = items.filter((item) => item.status !== "canceled");
  const printed = document.items.filter((item) => item.status !== "canceled");
  return (
    active.length === printed.length &&
    active.every((item) =>
      printed.some(
        (line) =>
          line.id === item.id &&
          line.productName === item.productName &&
          line.quantity === item.quantity &&
          line.netCents === item.netCents,
      ),
    )
  );
}
