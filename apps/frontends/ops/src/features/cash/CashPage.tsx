import { Button, Card } from "@giromesa/ui";
import { type FormEvent, useState } from "react";
import { api } from "../../api";
import {
  currencyToCents,
  dateLabel,
  type ManagementScope,
  operationalKey,
  parseCash,
  RemoteGate,
  useRemote,
} from "../../management.shared";
import { formatMoney } from "../../rules";

export function RealCashPage({ scope }: { scope: ManagementScope }) {
  const remote = useRemote(scope, api.management.cashShifts, parseCash);
  const [opening, setOpening] = useState("");
  const [actionError, setActionError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [movementType, setMovementType] = useState<"supply" | "withdrawal">("withdrawal");
  const [movementAmount, setMovementAmount] = useState("");
  const [movementReason, setMovementReason] = useState("");
  const [counted, setCounted] = useState("");
  const [closeReason, setCloseReason] = useState("");
  async function openShift(event: FormEvent) {
    event.preventDefault();
    const cents = currencyToCents(opening);
    if (!Number.isFinite(cents) || cents < 0) {
      setActionError("Informe um fundo de caixa válido.");
      return;
    }
    setSubmitting(true);
    setActionError("");
    try {
      await api.management.openCashShift(scope.organizationId, scope.unitId, cents);
      setOpening("");
      remote.retry();
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "Não foi possível abrir o caixa.");
    } finally {
      setSubmitting(false);
    }
  }
  async function addMovement(event: FormEvent<HTMLFormElement>, shiftId: string) {
    event.preventDefault();
    const amountCents = currencyToCents(movementAmount);
    if (amountCents <= 0 || movementReason.trim().length < 3) {
      setActionError("Informe valor e motivo do movimento.");
      return;
    }
    setSubmitting(true);
    setActionError("");
    try {
      await api.management.addCashMovement(
        scope.organizationId,
        scope.unitId,
        shiftId,
        { type: movementType, amountCents, reason: movementReason.trim() },
        operationalKey("cash-movement"),
      );
      setMovementAmount("");
      setMovementReason("");
      remote.retry();
    } catch (error) {
      setActionError(
        error instanceof Error ? error.message : "Não foi possível registrar o movimento.",
      );
    } finally {
      setSubmitting(false);
    }
  }
  async function closeShift(event: FormEvent<HTMLFormElement>, shiftId: string) {
    event.preventDefault();
    const countedCents = currencyToCents(counted);
    if (countedCents < 0) {
      setActionError("Informe o valor contado no caixa.");
      return;
    }
    setSubmitting(true);
    setActionError("");
    try {
      await api.management.closeCashShift(
        scope.organizationId,
        scope.unitId,
        shiftId,
        { countedCents, closeReason: closeReason.trim() || undefined },
        operationalKey("cash-close"),
      );
      setCounted("");
      setCloseReason("");
      remote.retry();
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "Não foi possível fechar o caixa.");
    } finally {
      setSubmitting(false);
    }
  }
  return (
    <RemoteGate remote={remote}>
      {(data) => {
        const open = data.shifts.find((shift) => shift.status === "open");
        if (!open) {
          return (
            <Card className="remote-state">
              <strong>Nenhum turno de caixa aberto</strong>
              <p>Informe o fundo inicial para abrir o caixa desta unidade.</p>
              <form className="inline-action-form" onSubmit={openShift}>
                <label>
                  Fundo de caixa (R$)
                  <input
                    inputMode="decimal"
                    onChange={(event) => setOpening(event.target.value)}
                    placeholder="0,00"
                    required
                    value={opening}
                  />
                </label>
                {actionError && (
                  <p className="auth-message auth-message--error" role="alert">
                    {actionError}
                  </p>
                )}
                <Button disabled={submitting} type="submit">
                  {submitting ? "Abrindo…" : "Abrir caixa"}
                </Button>
              </form>
            </Card>
          );
        }
        return (
          <div className="growth-stack">
            {actionError && (
              <p className="auth-message auth-message--error" role="alert">
                {actionError}
              </p>
            )}
            <div className="metrics-grid metrics-grid--three">
              <Card className="metric-card">
                <p>Status</p>
                <strong>Aberto</strong>
                <small>Desde {dateLabel(open.openedAt)}</small>
              </Card>
              <Card className="metric-card">
                <p>Fundo inicial</p>
                <strong>{formatMoney(open.openingCents)}</strong>
                <small>Valor informado na abertura</small>
              </Card>
              <Card className="metric-card">
                <p>Movimentos</p>
                <strong>{data.movements.length}</strong>
                <small>Suprimentos e sangrias registrados</small>
              </Card>
            </div>
            <div className="quick-actions-grid">
              <details className="action-panel">
                <summary>
                  <span>
                    <strong>Registrar movimento</strong>
                    <small>Suprimento ou sangria com motivo auditável.</small>
                  </span>
                  <span aria-hidden="true">+</span>
                </summary>
                <form
                  className="action-form"
                  onSubmit={(event) => void addMovement(event, open.id)}
                >
                  <label>
                    Tipo
                    <select
                      onChange={(event) =>
                        setMovementType(event.target.value as "supply" | "withdrawal")
                      }
                      value={movementType}
                    >
                      <option value="withdrawal">Sangria</option>
                      <option value="supply">Suprimento</option>
                    </select>
                  </label>
                  <label>
                    Valor
                    <input
                      inputMode="decimal"
                      onChange={(event) => setMovementAmount(event.target.value)}
                      placeholder="0,00"
                      required
                      value={movementAmount}
                    />
                  </label>
                  <label className="action-form__wide">
                    Motivo
                    <input
                      minLength={3}
                      onChange={(event) => setMovementReason(event.target.value)}
                      required
                      value={movementReason}
                    />
                  </label>
                  <Button disabled={submitting} type="submit">
                    Registrar movimento
                  </Button>
                </form>
              </details>
              <details className="action-panel action-panel--danger">
                <summary>
                  <span>
                    <strong>Fechar caixa</strong>
                    <small>Compare o valor contado com o esperado.</small>
                  </span>
                  <span aria-hidden="true">+</span>
                </summary>
                <form className="action-form" onSubmit={(event) => void closeShift(event, open.id)}>
                  <label>
                    Valor contado
                    <input
                      inputMode="decimal"
                      onChange={(event) => setCounted(event.target.value)}
                      placeholder="0,00"
                      required
                      value={counted}
                    />
                  </label>
                  <label>
                    Observação
                    <input
                      onChange={(event) => setCloseReason(event.target.value)}
                      value={closeReason}
                    />
                  </label>
                  <Button disabled={submitting} type="submit" variant="danger">
                    Conferir e fechar
                  </Button>
                </form>
              </details>
            </div>
          </div>
        );
      }}
    </RemoteGate>
  );
}
