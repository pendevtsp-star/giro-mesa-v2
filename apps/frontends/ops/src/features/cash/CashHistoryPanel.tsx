// biome-ignore-all lint/a11y/noLabelWithoutControl: shadcn-compatible controls render native form elements nested by these labels
import { Badge, Button, Card, EmptyState, Input, NativeSelect } from "@giromesa/ui";
import { type FormEvent, useEffect, useState } from "react";
import { api } from "../../api";
import {
  type CashData,
  type CashHistoryItem,
  type CashShiftDetail,
  dateLabel,
  type ManagementScope,
  parseCashHistory,
  parseCashShiftDetail,
} from "../../management.shared";
import { formatMoney } from "../../rules";
import { cashEntryLabel, paymentMethodLabel } from "./cash";

type Filters = {
  from?: string;
  to?: string;
  cashRegisterId?: string;
  operatorIdentityId?: string;
  status?: string;
};

function saveFile(file: { blob: Blob; filename: string | null }, fallback: string) {
  const url = URL.createObjectURL(file.blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = file.filename ?? fallback;
  link.click();
  URL.revokeObjectURL(url);
}

function differenceTone(item: CashHistoryItem) {
  return item.differenceSeverity === "critical"
    ? "danger"
    : item.differenceSeverity === "warning"
      ? "warning"
      : "neutral";
}

export function CashHistoryPanel({ data, scope }: { data: CashData; scope: ManagementScope }) {
  const [draft, setDraft] = useState<Filters>({});
  const [filters, setFilters] = useState<Filters>({});
  const [items, setItems] = useState<CashHistoryItem[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [detail, setDetail] = useState<CashShiftDetail | null>(null);
  const [busy, setBusy] = useState("");
  const [message, setMessage] = useState("");

  useEffect(() => {
    let active = true;
    setBusy("history");
    setMessage("");
    api.management
      .cashShiftHistory(scope.organizationId, scope.unitId, { ...filters, limit: 25 })
      .then(parseCashHistory)
      .then((page) => {
        if (!active) return;
        setItems(page.items);
        setNextCursor(page.nextCursor);
      })
      .catch((error: unknown) => {
        if (active)
          setMessage(
            error instanceof Error ? error.message : "Não foi possível carregar o histórico.",
          );
      })
      .finally(() => {
        if (active) setBusy("");
      });
    return () => {
      active = false;
    };
  }, [filters, scope.organizationId, scope.unitId]);

  function search(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setDetail(null);
    setFilters({ ...draft });
  }

  async function loadMore() {
    if (!nextCursor) return;
    setBusy("more");
    setMessage("");
    try {
      const page = parseCashHistory(
        await api.management.cashShiftHistory(scope.organizationId, scope.unitId, {
          ...filters,
          cursor: nextCursor,
          limit: 25,
        }),
      );
      setItems((current) => [...current, ...page.items]);
      setNextCursor(page.nextCursor);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Não foi possível carregar mais turnos.");
    } finally {
      setBusy("");
    }
  }

  async function showDetail(cashShiftId: string) {
    setBusy(`detail:${cashShiftId}`);
    setMessage("");
    try {
      setDetail(
        parseCashShiftDetail(
          await api.management.cashShiftDetail(scope.organizationId, scope.unitId, cashShiftId),
        ),
      );
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Não foi possível abrir o turno.");
    } finally {
      setBusy("");
    }
  }

  async function exportHistory(format: "csv" | "pdf") {
    setBusy(`export:${format}`);
    setMessage("");
    try {
      const file = await api.management.exportCashShiftHistory(scope.organizationId, scope.unitId, {
        ...filters,
        format,
      });
      saveFile(file, `caixas.${format}`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Não foi possível exportar o histórico.");
    } finally {
      setBusy("");
    }
  }

  return (
    <Card className="cash-history">
      <div className="card-header">
        <div>
          <p className="eyebrow">Auditoria</p>
          <h2>Histórico de turnos</h2>
        </div>
        <span className="cash-history__exports">
          <Button
            disabled={Boolean(busy)}
            onClick={() => void exportHistory("csv")}
            size="sm"
            type="button"
            variant="secondary"
          >
            CSV
          </Button>
          <Button
            disabled={Boolean(busy)}
            onClick={() => void exportHistory("pdf")}
            size="sm"
            type="button"
            variant="secondary"
          >
            PDF
          </Button>
        </span>
      </div>
      <form className="cash-history__filters" onSubmit={search}>
        <label>
          De
          <Input
            onChange={(event) => setDraft((current) => ({ ...current, from: event.target.value }))}
            type="date"
            value={draft.from ?? ""}
          />
        </label>
        <label>
          Até
          <Input
            onChange={(event) => setDraft((current) => ({ ...current, to: event.target.value }))}
            type="date"
            value={draft.to ?? ""}
          />
        </label>
        <label>
          Gaveta
          <NativeSelect
            onChange={(event) =>
              setDraft((current) => ({ ...current, cashRegisterId: event.target.value }))
            }
            value={draft.cashRegisterId ?? ""}
          >
            <option value="">Todas</option>
            {data.registers.map((cashRegister) => (
              <option key={cashRegister.id} value={cashRegister.id}>
                {cashRegister.name}
              </option>
            ))}
          </NativeSelect>
        </label>
        <label>
          Operador
          <NativeSelect
            onChange={(event) =>
              setDraft((current) => ({ ...current, operatorIdentityId: event.target.value }))
            }
            value={draft.operatorIdentityId ?? ""}
          >
            <option value="">Todos</option>
            {data.operators.map((operator) => (
              <option key={operator.identityId} value={operator.identityId}>
                {operator.name}
              </option>
            ))}
          </NativeSelect>
        </label>
        <label>
          Situação
          <NativeSelect
            onChange={(event) =>
              setDraft((current) => ({ ...current, status: event.target.value }))
            }
            value={draft.status ?? ""}
          >
            <option value="">Todas</option>
            <option value="open">Aberto</option>
            <option value="closed">Fechado</option>
            <option value="reviewed">Revisado</option>
          </NativeSelect>
        </label>
        <Button disabled={busy === "history"} type="submit">
          Filtrar
        </Button>
      </form>
      {message && (
        <p className="auth-message auth-message--error" role="alert">
          {message}
        </p>
      )}
      {items.length > 0 ? (
        <div className="cash-entry-list">
          {items.map((shift) => (
            <div className="cash-entry" key={shift.id}>
              <Badge tone={differenceTone(shift)}>
                {shift.status === "reviewed"
                  ? "Revisado"
                  : shift.status === "open"
                    ? "Aberto"
                    : "Fechado"}
              </Badge>
              <span>
                <strong>
                  {shift.cashRegisterName} · {shift.operatorName ?? "Operador"}
                </strong>
                <small>
                  {dateLabel(shift.openedAt)} → {dateLabel(shift.closedAt)} · responsável{" "}
                  {shift.responsibleName ?? shift.operatorName ?? "identificado"}
                </small>
              </span>
              <span className="cash-history__result">
                <strong>{formatMoney(shift.differenceCents ?? 0)}</strong>
                <Button
                  disabled={Boolean(busy)}
                  onClick={() => void showDetail(shift.id)}
                  size="sm"
                  type="button"
                  variant="ghost"
                >
                  Detalhes
                </Button>
              </span>
            </div>
          ))}
        </div>
      ) : busy === "history" ? (
        <p>Carregando histórico…</p>
      ) : (
        <EmptyState
          description="Revise os filtros informados."
          icon="$"
          title="Nenhum turno encontrado"
        />
      )}
      {nextCursor && (
        <Button
          disabled={Boolean(busy)}
          onClick={() => void loadMore()}
          type="button"
          variant="secondary"
        >
          {busy === "more" ? "Carregando…" : "Carregar mais"}
        </Button>
      )}
      {detail && (
        <div className="cash-history__detail">
          <div className="card-header">
            <div>
              <p className="eyebrow">Detalhe auditável</p>
              <h3>{detail.shift.cashRegisterName}</h3>
            </div>
            <Button onClick={() => setDetail(null)} size="sm" type="button" variant="ghost">
              Fechar
            </Button>
          </div>
          {detail.tenderCounts.length > 0 && (
            <div className="cash-methods">
              {detail.tenderCounts.map((count) => (
                <span key={count.method}>
                  <small>{paymentMethodLabel(count.method)}</small>
                  <strong>{formatMoney(count.observedCents)}</strong>
                  <small>
                    Esperado {formatMoney(count.expectedCents)} · diferença{" "}
                    {formatMoney(count.differenceCents)}
                  </small>
                </span>
              ))}
            </div>
          )}
          {[...detail.entries, ...detail.adjustments].map((entry) => (
            <div
              className="cash-entry"
              key={`${"cashShiftId" in entry ? "entry" : "adjustment"}:${entry.id}`}
            >
              <span aria-hidden="true">{entry.direction === "in" ? "↑" : "↓"}</span>
              <span>
                <strong>{cashEntryLabel(entry.entryType)}</strong>
                <small>
                  {entry.description ?? paymentMethodLabel(entry.paymentMethod)} ·{" "}
                  {dateLabel(entry.occurredAt)}
                </small>
              </span>
              <strong>{formatMoney(entry.amountCents)}</strong>
            </div>
          ))}
          {detail.responsibilities.map((change) => (
            <p className="cash-responsibility" key={change.id}>
              <strong>
                {change.fromName} → {change.toName}
              </strong>
              <small>
                {change.reason} · {change.transferredByName} · {dateLabel(change.occurredAt)}
              </small>
            </p>
          ))}
        </div>
      )}
    </Card>
  );
}
