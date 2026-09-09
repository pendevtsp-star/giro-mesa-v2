import { type CashHistoryItem, dateLabel } from "../../management.shared";
import { formatMoney } from "../../rules";
import { paymentMethodLabel } from "./cash";

type ReceiptSnapshot = Pick<
  CashHistoryItem,
  | "id"
  | "unitName"
  | "cashRegisterName"
  | "operatorName"
  | "responsibleName"
  | "closedByName"
  | "openingCents"
  | "expectedCents"
  | "countedCents"
  | "differenceCents"
  | "openedAt"
  | "closedAt"
>;

export function CashClosureReceipt({
  shift,
  breakdown,
}: {
  shift: ReceiptSnapshot;
  breakdown: Array<{ method: string; amountCents: number }>;
}) {
  return (
    <div className="cash-slip-receipt" id={`cash-closure-slip-${shift.id}`}>
      <div className="cash-slip-receipt__header">
        <h3>{shift.unitName}</h3>
        <p>Relatório de Encerramento de Turno</p>
        <small>Turno: {shift.id}</small>
      </div>
      <div className="cash-slip-receipt__section">
        <p>
          <strong>Gaveta:</strong> {shift.cashRegisterName}
        </p>
        <p>
          <strong>Operador:</strong> {shift.operatorName ?? "Operador identificado"}
        </p>
        <p>
          <strong>Responsável:</strong> {shift.responsibleName ?? "Operador identificado"}
        </p>
        <p>
          <strong>Fechado por:</strong> {shift.closedByName ?? "Operador identificado"}
        </p>
        <p>
          <strong>Abertura:</strong> {dateLabel(shift.openedAt)}
        </p>
        <p>
          <strong>Encerramento:</strong> {dateLabel(shift.closedAt)}
        </p>
      </div>
      <div className="cash-slip-receipt__divider" />
      <div className="cash-slip-receipt__values">
        <div className="cash-slip-row">
          <span>Fundo inicial:</span>
          <strong>{formatMoney(shift.openingCents)}</strong>
        </div>
        <div className="cash-slip-row">
          <span>Total contado:</span>
          <strong>{formatMoney(shift.countedCents ?? 0)}</strong>
        </div>
        <div className="cash-slip-row">
          <span>Total esperado:</span>
          <strong>{formatMoney(shift.expectedCents ?? 0)}</strong>
        </div>
        <div className="cash-slip-row cash-slip-row--highlight">
          <span>Diferença apurada:</span>
          <strong>{formatMoney(shift.differenceCents ?? 0)}</strong>
        </div>
      </div>
      {breakdown.length > 0 && (
        <>
          <div className="cash-slip-receipt__divider" />
          <div className="cash-slip-receipt__section">
            <strong>Lançamentos por forma de pagamento:</strong>
            {breakdown.map((item) => (
              <div className="cash-slip-row" key={item.method}>
                <span>{paymentMethodLabel(item.method)}:</span>
                <strong>{formatMoney(item.amountCents)}</strong>
              </div>
            ))}
          </div>
        </>
      )}
      <div className="cash-slip-receipt__divider" />
      <div className="cash-slip-receipt__signatures">
        <div className="cash-slip-sign-line">
          <span>Assinatura do operador de caixa</span>
        </div>
        <div className="cash-slip-sign-line">
          <span>Assinatura do gerente responsável</span>
        </div>
      </div>
    </div>
  );
}
