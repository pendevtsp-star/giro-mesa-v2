import { Button, Card, EmptyState } from "@giromesa/ui";
import { type FormEvent, useState } from "react";
import { api } from "../../api";
import {
  currencyToCents,
  dateLabel,
  type ManagementScope,
  operationalKey,
  parseFinance,
  RemoteGate,
  useRemote,
} from "../../management.shared";
import { formatMoney } from "../../rules";

export function RealFinancePage({ scope }: { scope: ManagementScope }) {
  const remote = useRemote(scope, api.management.finance, parseFinance);
  const [description, setDescription] = useState("");
  const [amount, setAmount] = useState("");
  const [competenceDate, setCompetenceDate] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [feedback, setFeedback] = useState("");
  const [receivableDescription, setReceivableDescription] = useState("");
  const [receivableAmount, setReceivableAmount] = useState("");
  const [receivableCompetenceDate, setReceivableCompetenceDate] = useState("");
  const [receivableDueDate, setReceivableDueDate] = useState("");
  const [settlementId, setSettlementId] = useState("");
  const [settlementDirection, setSettlementDirection] = useState<"payable" | "receivable">(
    "payable",
  );
  const [settlementAmount, setSettlementAmount] = useState("");
  const [settlementMethod, setSettlementMethod] = useState("");
  const [settlementReference, setSettlementReference] = useState("");
  async function createPayable(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const amountCents = currencyToCents(amount);
    if (amountCents <= 0) {
      setFeedback("Informe um valor maior que zero.");
      return;
    }
    setSubmitting(true);
    setFeedback("");
    try {
      await api.management.createPayable(
        scope.organizationId,
        scope.unitId,
        { description: description.trim(), amountCents, competenceDate, dueDate },
        operationalKey("payable"),
      );
      setDescription("");
      setAmount("");
      setCompetenceDate("");
      setDueDate("");
      setFeedback("Conta a pagar registrada.");
      remote.retry();
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : "Não foi possível criar o lançamento.");
    } finally {
      setSubmitting(false);
    }
  }
  async function createReceivable(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const amountCents = currencyToCents(receivableAmount);
    if (amountCents <= 0) return setFeedback("Informe um valor a receber maior que zero.");
    setSubmitting(true);
    setFeedback("");
    try {
      await api.management.createReceivable(
        scope.organizationId,
        scope.unitId,
        {
          description: receivableDescription.trim(),
          amountCents,
          competenceDate: receivableCompetenceDate,
          dueDate: receivableDueDate,
        },
        operationalKey("receivable"),
      );
      setReceivableDescription("");
      setReceivableAmount("");
      setFeedback("Conta a receber registrada.");
      remote.retry();
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : "Não foi possível criar o recebível.");
    } finally {
      setSubmitting(false);
    }
  }
  async function settleEntry(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const amountCents = currencyToCents(settlementAmount);
    if (amountCents <= 0) return setFeedback("Informe um valor de liquidação maior que zero.");
    setSubmitting(true);
    setFeedback("");
    const body = {
      amountCents,
      method: settlementMethod.trim(),
      reference: settlementReference.trim() || undefined,
    };
    try {
      if (settlementDirection === "payable") {
        await api.management.payPayable(
          scope.organizationId,
          scope.unitId,
          settlementId,
          body,
          operationalKey("payable-payment"),
        );
      } else {
        await api.management.receiveReceivable(
          scope.organizationId,
          scope.unitId,
          settlementId,
          body,
          operationalKey("receivable-payment"),
        );
      }
      setSettlementAmount("");
      setSettlementReference("");
      setFeedback("Liquidação registrada.");
      remote.retry();
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : "Não foi possível liquidar a conta.");
    } finally {
      setSubmitting(false);
    }
  }
  return (
    <RemoteGate remote={remote}>
      {(data) => {
        const payable = data.entries
          .filter((entry) => entry.direction === "payable")
          .reduce((sum, entry) => sum + Math.max(0, entry.amountCents - entry.settledCents), 0);
        const receivable = data.entries
          .filter((entry) => entry.direction === "receivable")
          .reduce((sum, entry) => sum + Math.max(0, entry.amountCents - entry.settledCents), 0);
        return (
          <div className="growth-stack">
            <details className="action-panel">
              <summary>
                <span>
                  <strong>Nova conta a pagar</strong>
                  <small>Registre competência, vencimento e valor.</small>
                </span>
                <span aria-hidden="true">+</span>
              </summary>
              <form className="action-form" onSubmit={(event) => void createPayable(event)}>
                <label className="action-form__wide">
                  Descrição
                  <input
                    minLength={3}
                    onChange={(event) => setDescription(event.target.value)}
                    required
                    value={description}
                  />
                </label>
                <label>
                  Valor
                  <input
                    inputMode="decimal"
                    onChange={(event) => setAmount(event.target.value)}
                    placeholder="0,00"
                    required
                    value={amount}
                  />
                </label>
                <label>
                  Competência
                  <input
                    onChange={(event) => setCompetenceDate(event.target.value)}
                    required
                    type="date"
                    value={competenceDate}
                  />
                </label>
                <label>
                  Vencimento
                  <input
                    onChange={(event) => setDueDate(event.target.value)}
                    required
                    type="date"
                    value={dueDate}
                  />
                </label>
                <Button disabled={submitting || description.trim().length < 3} type="submit">
                  {submitting ? "Salvando…" : "Registrar conta"}
                </Button>
              </form>
            </details>
            <div className="quick-actions-grid">
              <details className="action-panel">
                <summary>
                  <span>
                    <strong>Nova conta a receber</strong>
                    <small>Registre receita prevista e vencimento.</small>
                  </span>
                  <span aria-hidden="true">+</span>
                </summary>
                <form className="action-form" onSubmit={(event) => void createReceivable(event)}>
                  <label className="action-form__wide">
                    Descrição
                    <input
                      minLength={3}
                      onChange={(event) => setReceivableDescription(event.target.value)}
                      required
                      value={receivableDescription}
                    />
                  </label>
                  <label>
                    Valor
                    <input
                      inputMode="decimal"
                      onChange={(event) => setReceivableAmount(event.target.value)}
                      required
                      value={receivableAmount}
                    />
                  </label>
                  <label>
                    Competência
                    <input
                      onChange={(event) => setReceivableCompetenceDate(event.target.value)}
                      required
                      type="date"
                      value={receivableCompetenceDate}
                    />
                  </label>
                  <label>
                    Vencimento
                    <input
                      onChange={(event) => setReceivableDueDate(event.target.value)}
                      required
                      type="date"
                      value={receivableDueDate}
                    />
                  </label>
                  <Button
                    disabled={submitting || receivableDescription.trim().length < 3}
                    type="submit"
                  >
                    Registrar recebível
                  </Button>
                </form>
              </details>
              <details className="action-panel">
                <summary>
                  <span>
                    <strong>Liquidar conta</strong>
                    <small>Registre pagamento ou recebimento confirmado.</small>
                  </span>
                  <span aria-hidden="true">+</span>
                </summary>
                <form className="action-form" onSubmit={(event) => void settleEntry(event)}>
                  <label className="action-form__wide">
                    Conta
                    <select
                      onChange={(event) => {
                        const [direction, id] = event.target.value.split(":");
                        setSettlementDirection(direction as "payable" | "receivable");
                        setSettlementId(id ?? "");
                      }}
                      required
                      value={settlementId ? `${settlementDirection}:${settlementId}` : ""}
                    >
                      <option value="">Selecione</option>
                      {data.entries
                        .filter((entry) => entry.amountCents > entry.settledCents)
                        .map((entry) => (
                          <option
                            key={`${entry.direction}:${entry.id}`}
                            value={`${entry.direction}:${entry.id}`}
                          >
                            {entry.direction === "payable" ? "Pagar" : "Receber"} ·{" "}
                            {entry.description}
                          </option>
                        ))}
                    </select>
                  </label>
                  <label>
                    Valor
                    <input
                      inputMode="decimal"
                      onChange={(event) => setSettlementAmount(event.target.value)}
                      required
                      value={settlementAmount}
                    />
                  </label>
                  <label>
                    Método
                    <input
                      minLength={2}
                      onChange={(event) => setSettlementMethod(event.target.value)}
                      placeholder="Pix, dinheiro, cartão"
                      required
                      value={settlementMethod}
                    />
                  </label>
                  <label className="action-form__wide">
                    Referência
                    <input
                      onChange={(event) => setSettlementReference(event.target.value)}
                      value={settlementReference}
                    />
                  </label>
                  <Button
                    disabled={submitting || !settlementId || settlementMethod.trim().length < 2}
                    type="submit"
                  >
                    Confirmar liquidação
                  </Button>
                </form>
              </details>
            </div>
            {feedback && (
              <p className="form-feedback" role="status">
                {feedback}
              </p>
            )}
            <div className="metrics-grid metrics-grid--three">
              <Card className="metric-card">
                <p>A pagar</p>
                <strong>{formatMoney(payable)}</strong>
                <small>Saldo pendente real</small>
              </Card>
              <Card className="metric-card">
                <p>A receber</p>
                <strong>{formatMoney(receivable)}</strong>
                <small>Saldo pendente real</small>
              </Card>
              <Card className="metric-card">
                <p>Conciliações</p>
                <strong>{data.reconciliationEntries.length}</strong>
                <small>{data.reconciliationImports.length} importação(ões)</small>
              </Card>
            </div>
            <Card className="finance-entries">
              <div className="card-header">
                <div>
                  <p className="eyebrow">Agenda</p>
                  <h2>Lançamentos</h2>
                </div>
              </div>
              {data.entries.length ? (
                data.entries.map((entry) => (
                  <div className="finance-row" key={`${entry.direction}-${entry.id}`}>
                    <span
                      className={`action-icon ${entry.direction === "payable" ? "action-icon--warning" : ""}`}
                    >
                      {entry.direction === "payable" ? "↓" : "↑"}
                    </span>
                    <span>
                      <strong>{entry.description}</strong>
                      <small>
                        Vencimento {dateLabel(entry.dueDate)} · {entry.status}
                      </small>
                    </span>
                    <strong className={entry.direction === "payable" ? "negative" : "positive"}>
                      {entry.direction === "payable" ? "−" : "+"}
                      {formatMoney(entry.amountCents - entry.settledCents)}
                    </strong>
                  </div>
                ))
              ) : (
                <EmptyState
                  description="Não há contas a pagar ou receber nesta unidade."
                  icon="$"
                  title="Financeiro sem lançamentos"
                />
              )}
            </Card>
          </div>
        );
      }}
    </RemoteGate>
  );
}
