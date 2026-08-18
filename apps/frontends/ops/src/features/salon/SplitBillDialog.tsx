import { Button, Icon, Modal } from "@giromesa/ui";
import { useMemo, useState } from "react";
import { formatMoney } from "../../rules";

export type PaymentMethod = "pix" | "credit" | "debit" | "cash" | "voucher";

export type RegisteredPayment = {
  id: string;
  payerName: string;
  amountCents: number;
  method: PaymentMethod;
  timestamp: string;
};

export type BillItem = {
  id: string;
  name: string;
  quantity: number;
  unitPriceCents: number;
  totalPriceCents: number;
};

export function SplitBillDialog({
  isOpen,
  onClose,
  tableLabel,
  tabTotalCents,
  items = [],
  onPaymentConfirmed,
}: {
  isOpen: boolean;
  onClose: () => void;
  tableLabel: string;
  tabTotalCents: number;
  items?: BillItem[];
  onPaymentConfirmed?: (payments: RegisteredPayment[]) => void;
}) {
  const [splitMode, setSplitMode] = useState<"equal" | "items">("equal");
  const [peopleCount, setPeopleCount] = useState(2);
  const [includeServiceFee, setIncludeServiceFee] = useState(true);
  const [serviceFeeRate] = useState(0.1); // 10%
  const [payments, setPayments] = useState<RegisteredPayment[]>([]);
  const payers = Array.from({ length: peopleCount }, (_, index) => ({
    id: `payer-${index + 1}`,
    index,
    label: `Pessoa ${index + 1}`,
  }));

  // Item assignment state for "by items" mode
  const [activePayerIndex, setActivePayerIndex] = useState(0);
  const [itemAssignments, setItemAssignments] = useState<Record<string, number>>({}); // itemId -> payerIndex

  // Form for adding payments
  const [selectedMethod, setSelectedMethod] = useState<PaymentMethod>("pix");
  const [customAmount, setCustomAmount] = useState("");
  const [payerNameInput, setPayerNameInput] = useState("");

  const serviceFeeCents = includeServiceFee ? Math.round(tabTotalCents * serviceFeeRate) : 0;
  const grandTotalCents = tabTotalCents + serviceFeeCents;

  const totalPaidCents = useMemo(
    () => payments.reduce((sum, p) => sum + p.amountCents, 0),
    [payments],
  );
  const remainingCents = Math.max(0, grandTotalCents - totalPaidCents);

  // Equal split calculation
  const perPersonCents = Math.ceil(grandTotalCents / Math.max(1, peopleCount));

  // Item split calculations
  const payerTotals = useMemo(() => {
    const totals: number[] = Array.from({ length: peopleCount }, () => 0);
    for (const item of items) {
      const assignedTo = itemAssignments[item.id] ?? 0;
      if (assignedTo < peopleCount) {
        totals[assignedTo] = (totals[assignedTo] ?? 0) + item.totalPriceCents;
      }
    }
    return totals.map((subtotal) => {
      const fee = includeServiceFee ? Math.round(subtotal * serviceFeeRate) : 0;
      return subtotal + fee;
    });
  }, [items, itemAssignments, peopleCount, includeServiceFee, serviceFeeRate]);

  function handleAddPayment(amount: number, name?: string) {
    if (amount <= 0) return;
    const newPayment: RegisteredPayment = {
      id: crypto.randomUUID(),
      payerName: name || `Pagador ${payments.length + 1}`,
      amountCents: Math.min(amount, remainingCents),
      method: selectedMethod,
      timestamp: new Date().toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" }),
    };
    setPayments((curr) => [...curr, newPayment]);
    setCustomAmount("");
    setPayerNameInput("");
  }

  function handleRemovePayment(id: string) {
    setPayments((curr) => curr.filter((p) => p.id !== id));
  }

  const methodLabels: Record<PaymentMethod, string> = {
    pix: "Pix",
    credit: "Crédito",
    debit: "Débito",
    cash: "Dinheiro",
    voucher: "Voucher / VR",
  };

  return (
    <Modal
      className="split-bill-modal"
      isOpen={isOpen}
      onClose={onClose}
      size="lg"
      title={`Divisão de Conta — ${tableLabel}`}
    >
      <div className="split-bill-container">
        {/* Header Summary */}
        <div className="split-bill-summary-bar">
          <div className="split-bill-stat">
            <small>Consumo</small>
            <strong>{formatMoney(tabTotalCents)}</strong>
          </div>
          <div className="split-bill-stat">
            <small>Serviço ({Math.round(serviceFeeRate * 100)}%)</small>
            <strong>{includeServiceFee ? formatMoney(serviceFeeCents) : "Isento"}</strong>
          </div>
          <div className="split-bill-stat split-bill-stat--total">
            <small>Total com taxa</small>
            <strong>{formatMoney(grandTotalCents)}</strong>
          </div>
          <div
            className={`split-bill-stat ${remainingCents === 0 ? "split-bill-stat--paid" : "split-bill-stat--due"}`}
          >
            <small>{remainingCents === 0 ? "Status" : "Restante a pagar"}</small>
            <strong>{remainingCents === 0 ? "Quitada" : formatMoney(remainingCents)}</strong>
          </div>
        </div>

        {/* Progress bar */}
        <div className="split-bill-progress">
          <div
            className="split-bill-progress__fill"
            style={{
              width: `${Math.min(100, Math.round((totalPaidCents / grandTotalCents) * 100))}%`,
            }}
          />
        </div>

        {/* Controls */}
        <div className="split-bill-controls">
          <div className="split-bill-toggle-group">
            <button
              className={`split-bill-toggle-btn ${splitMode === "equal" ? "active" : ""}`}
              onClick={() => setSplitMode("equal")}
              type="button"
            >
              <Icon name="user" size={14} />
              <span>Divisão Igualitária</span>
            </button>
            <button
              className={`split-bill-toggle-btn ${splitMode === "items" ? "active" : ""}`}
              onClick={() => setSplitMode("items")}
              type="button"
            >
              <Icon name="list" size={14} />
              <span>Por Itens Consumidos</span>
            </button>
          </div>

          <div className="split-bill-service-toggle">
            <label className="split-bill-checkbox">
              <input
                checked={includeServiceFee}
                onChange={(e) => setIncludeServiceFee(e.target.checked)}
                type="checkbox"
              />
              <span>Incluir taxa de serviço (10%)</span>
            </label>
          </div>
        </div>

        {/* Mode: Equal Split */}
        {splitMode === "equal" && (
          <div className="split-bill-equal-section">
            <div className="split-bill-stepper">
              <span>Dividir entre:</span>
              <div className="split-bill-stepper__btns">
                {[2, 3, 4, 5, 6, 8, 10].map((num) => (
                  <button
                    className={`split-bill-pill ${peopleCount === num ? "active" : ""}`}
                    key={num}
                    onClick={() => setPeopleCount(num)}
                    type="button"
                  >
                    {num} pessoas
                  </button>
                ))}
              </div>
            </div>

            <div className="split-bill-card-highlight">
              <div className="split-bill-card-highlight__content">
                <small>Valor sugerido por pessoa ({peopleCount} pagantes)</small>
                <strong>{formatMoney(perPersonCents)}</strong>
              </div>
              <Button
                disabled={remainingCents === 0}
                onClick={() => handleAddPayment(perPersonCents, `Pessoa ${payments.length + 1}`)}
                size="sm"
                variant="secondary"
              >
                Pagar 1 cota ({formatMoney(perPersonCents)})
              </Button>
            </div>
          </div>
        )}

        {/* Mode: Item Split */}
        {splitMode === "items" && (
          <div className="split-bill-items-section">
            <div className="split-bill-payers-bar">
              {payers.map((payer) => (
                <button
                  className={`split-bill-payer-tab ${activePayerIndex === payer.index ? "active" : ""}`}
                  key={payer.id}
                  onClick={() => setActivePayerIndex(payer.index)}
                  type="button"
                >
                  <strong>{payer.label}</strong>
                  <small>{formatMoney(payerTotals[payer.index] ?? 0)}</small>
                </button>
              ))}
              <Button
                onClick={() => setPeopleCount((c) => Math.min(12, c + 1))}
                size="sm"
                variant="ghost"
              >
                + Pessoa
              </Button>
            </div>

            <div className="split-bill-items-assignment-list">
              {items.length === 0 ? (
                <p className="split-bill-empty-items">
                  Nenhum item individual registrado nesta comanda ainda.
                </p>
              ) : (
                items.map((item) => {
                  const assignedTo = itemAssignments[item.id] ?? 0;
                  return (
                    <div className="split-bill-item-row" key={item.id}>
                      <div className="split-bill-item-row__info">
                        <strong>
                          {item.quantity}x {item.name}
                        </strong>
                        <small>{formatMoney(item.totalPriceCents)}</small>
                      </div>
                      <div className="split-bill-item-row__assignee">
                        <span>Atribuído a:</span>
                        <select
                          aria-label={`Atribuir ${item.name}`}
                          onChange={(e) =>
                            setItemAssignments((curr) => ({
                              ...curr,
                              [item.id]: Number(e.target.value),
                            }))
                          }
                          value={assignedTo}
                        >
                          {payers.map((payer) => (
                            <option key={payer.id} value={payer.index}>
                              {payer.label}
                            </option>
                          ))}
                        </select>
                      </div>
                    </div>
                  );
                })
              )}
            </div>

            <div className="split-bill-payer-action">
              <Button
                disabled={remainingCents === 0 || (payerTotals[activePayerIndex] ?? 0) === 0}
                onClick={() =>
                  handleAddPayment(
                    payerTotals[activePayerIndex] ?? 0,
                    `Pessoa ${activePayerIndex + 1}`,
                  )
                }
                size="sm"
                variant="primary"
              >
                Pagar conta da Pessoa {activePayerIndex + 1} (
                {formatMoney(payerTotals[activePayerIndex] ?? 0)})
              </Button>
            </div>
          </div>
        )}

        {/* Payment Entry Form */}
        <div className="split-bill-payment-entry">
          <h4>Registrar Pagamento</h4>
          <div className="split-bill-payment-grid">
            <label>
              Método
              <select
                aria-label="Método de pagamento"
                onChange={(e) => setSelectedMethod(e.target.value as PaymentMethod)}
                value={selectedMethod}
              >
                <option value="pix">Pix</option>
                <option value="credit">Cartão de Crédito</option>
                <option value="debit">Cartão de Débito</option>
                <option value="cash">Dinheiro</option>
                <option value="voucher">Voucher / Vale-Refeição</option>
              </select>
            </label>

            <label>
              Identificação (opcional)
              <input
                onChange={(e) => setPayerNameInput(e.target.value)}
                placeholder="Ex.: João Pix"
                value={payerNameInput}
              />
            </label>

            <label>
              Valor (R$)
              <input
                onChange={(e) => setCustomAmount(e.target.value)}
                placeholder={`Restante: ${formatMoney(remainingCents)}`}
                type="number"
                value={customAmount}
              />
            </label>

            <Button
              disabled={remainingCents === 0}
              onClick={() => {
                const parsedVal = customAmount
                  ? Math.round(Number(customAmount) * 100)
                  : remainingCents;
                handleAddPayment(parsedVal, payerNameInput);
              }}
              size="sm"
              variant="secondary"
            >
              Confirmar Parcial
            </Button>
          </div>
        </div>

        {/* Registered Payments List */}
        {payments.length > 0 && (
          <div className="split-bill-history">
            <h4>Pagamentos Registrados ({payments.length})</h4>
            <div className="split-bill-history__list">
              {payments.map((p) => (
                <div className="split-bill-history__row" key={p.id}>
                  <div className="split-bill-history__info">
                    <Icon name="check" size={14} />
                    <strong>{p.payerName}</strong>
                    <span className="split-bill-badge">{methodLabels[p.method]}</span>
                    <small>{p.timestamp}</small>
                  </div>
                  <div className="split-bill-history__actions">
                    <strong>{formatMoney(p.amountCents)}</strong>
                    <button
                      aria-label="Remover pagamento"
                      className="split-bill-remove-btn"
                      onClick={() => handleRemovePayment(p.id)}
                      type="button"
                    >
                      <Icon name="x" size={12} />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Modal Actions */}
        <div className="split-bill-footer-actions">
          <Button onClick={onClose} variant="ghost">
            Fechar
          </Button>
          <Button
            disabled={payments.length === 0}
            onClick={() => {
              onPaymentConfirmed?.(payments);
              onClose();
            }}
            variant="primary"
          >
            {remainingCents === 0 ? "Concluir Fechamento" : "Salvar Pagamentos Parciais"}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
