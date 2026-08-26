// biome-ignore-all lint/a11y/noLabelWithoutControl: native controls are intentionally nested by their labels
import { Button, Card, EmptyState, Input, NativeSelect } from "@giromesa/ui";
import { type FormEvent, useMemo, useState } from "react";
import { ApiClientError, api, type FinanceFilters } from "../../api";
import {
  currencyToCents,
  dateLabel,
  type FinancialEntry,
  type ManagementScope,
  operationalKey,
  parseCash,
  parseFinance,
  RemoteGate,
  useRemote,
} from "../../management.shared";
import { formatMoney } from "../../rules";
import {
  financeStatusLabel,
  parseReconciliationFile,
  paymentMethodLabel,
  type ReconciliationImportEntry,
} from "./finance";
import "./finance.css";

type FinanceTab = "agenda" | "reconciliation" | "projection" | "settings";
type Direction = "payable" | "receivable";

const paymentMethods = ["pix", "cash", "credit_card", "debit_card", "bank_transfer", "other"];

function formText(form: FormData, name: string) {
  return String(form.get(name) ?? "").trim();
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Não foi possível concluir a operação.";
}

function downloadArtifact(value: unknown) {
  const artifact = value as {
    filename?: string;
    content?: string;
    contentEncoding?: string;
    mimeType?: string;
  };
  if (!artifact.content) throw new Error("A API não retornou o arquivo.");
  const bytes =
    artifact.contentEncoding === "base64"
      ? Uint8Array.from(atob(artifact.content), (character) => character.charCodeAt(0))
      : artifact.content;
  const url = URL.createObjectURL(new Blob([bytes], { type: artifact.mimeType }));
  const link = document.createElement("a");
  link.href = url;
  link.download = artifact.filename ?? "agenda-financeira.csv";
  link.click();
  URL.revokeObjectURL(url);
}

async function sha256(file: File) {
  const digest = await crypto.subtle.digest("SHA-256", await file.arrayBuffer());
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function RealFinancePage({ scope }: { scope: ManagementScope }) {
  const [filters, setFilters] = useState<FinanceFilters>({ page: 1, pageSize: 25 });
  const loader = useMemo(
    () => (organizationId: string, unitId: string) =>
      api.management.finance(organizationId, unitId, filters),
    [filters],
  );
  const remote = useRemote(scope, loader, parseFinance);
  const cashRemote = useRemote(scope, api.management.cashShifts, parseCash);
  const [tab, setTab] = useState<FinanceTab>("agenda");
  const [selectedKey, setSelectedKey] = useState("");
  const [createDirection, setCreateDirection] = useState<Direction>("payable");
  const [settlementAmount, setSettlementAmount] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [feedback, setFeedback] = useState("");
  const [reversalReason, setReversalReason] = useState("");
  const [approvalNote, setApprovalNote] = useState("");
  const [importFile, setImportFile] = useState<File | null>(null);
  const [importEntries, setImportEntries] = useState<ReconciliationImportEntry[]>([]);
  const [resolutionEntryId, setResolutionEntryId] = useState("");
  const [resolutionPayment, setResolutionPayment] = useState("");
  const [resolutionNote, setResolutionNote] = useState("");

  async function run(label: string, action: () => Promise<unknown>, success: string) {
    setBusy(label);
    setFeedback("");
    try {
      await action();
      setFeedback(success);
      remote.retry();
    } catch (error) {
      setFeedback(errorMessage(error));
      throw error;
    } finally {
      setBusy(null);
    }
  }

  async function createEntry(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const target = event.currentTarget;
    const form = new FormData(target);
    const amountCents = currencyToCents(formText(form, "amount"));
    const installments = Number(formText(form, "installments") || 1);
    const attachmentUrl = formText(form, "attachmentUrl");
    const body = {
      description: formText(form, "description"),
      amountCents,
      competenceDate: formText(form, "competenceDate"),
      dueDate: formText(form, "dueDate"),
      category: formText(form, "category") || undefined,
      costCenter: formText(form, "costCenter") || undefined,
      documentNumber: formText(form, "documentNumber") || undefined,
      notes: formText(form, "notes") || undefined,
      attachments: attachmentUrl
        ? [{ name: formText(form, "attachmentName") || "Anexo", url: attachmentUrl }]
        : [],
      recurrence:
        installments > 1
          ? { installments, intervalMonths: Number(formText(form, "intervalMonths") || 1) }
          : undefined,
    };
    if (amountCents <= 0) return setFeedback("Informe um valor maior que zero.");
    try {
      await run(
        "create",
        () =>
          createDirection === "payable"
            ? api.management.createPayable(
                scope.organizationId,
                scope.unitId,
                body,
                operationalKey("payable"),
              )
            : api.management.createReceivable(
                scope.organizationId,
                scope.unitId,
                body,
                operationalKey("receivable"),
              ),
        installments > 1 ? `${installments} parcelas registradas.` : "Lançamento registrado.",
      );
      target.reset();
    } catch {
      // run already exposes the actionable error
    }
  }

  function applyFilters(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setFilters({
      direction: (formText(form, "direction") || "all") as FinanceFilters["direction"],
      status: (formText(form, "status") || "all") as FinanceFilters["status"],
      search: formText(form, "search"),
      from: formText(form, "from") || undefined,
      to: formText(form, "to") || undefined,
      page: 1,
      pageSize: 25,
    });
    setSelectedKey("");
  }

  async function settleEntry(event: FormEvent<HTMLFormElement>, entry: FinancialEntry) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const amountCents = currencyToCents(settlementAmount);
    const method = formText(form, "method");
    const reference = formText(form, "reference") || undefined;
    const cashRegisterId = formText(form, "cashRegisterId") || undefined;
    const occurredAt = formText(form, "occurredAt");
    const matchingApproval =
      remote.state.status === "ready"
        ? remote.state.data.approvals.find(
            (approval) =>
              approval.status === "approved" &&
              approval.entryId === entry.id &&
              approval.amountCents === amountCents &&
              approval.method === method &&
              (approval.reference ?? undefined) === reference &&
              (approval.cashRegisterId ?? undefined) === cashRegisterId,
          )?.id
        : undefined;
    const body = {
      amountCents,
      method,
      reference,
      cashRegisterId,
      occurredAt: occurredAt ? new Date(occurredAt).toISOString() : undefined,
      approvalRequestId: matchingApproval,
    };
    if (amountCents <= 0 || amountCents > entry.amountCents - entry.settledCents)
      return setFeedback("A liquidação deve ser maior que zero e não pode superar o saldo.");
    setBusy("settle");
    setFeedback("");
    try {
      if (entry.direction === "payable")
        await api.management.payPayable(
          scope.organizationId,
          scope.unitId,
          entry.id,
          body,
          operationalKey("payable-payment"),
        );
      else
        await api.management.receiveReceivable(
          scope.organizationId,
          scope.unitId,
          entry.id,
          body,
          operationalKey("receivable-payment"),
        );
      setSettlementAmount("");
      setFeedback("Liquidação registrada.");
      remote.retry();
    } catch (error) {
      if (error instanceof ApiClientError && error.code === "FINANCE_APPROVAL_REQUIRED") {
        try {
          await api.management.requestFinanceApproval(
            scope.organizationId,
            scope.unitId,
            {
              ...body,
              approvalRequestId: undefined,
              direction: entry.direction,
              entryId: entry.id,
            },
            operationalKey("finance-approval"),
          );
          setFeedback("Solicitação enviada para aprovação. A liquidação ainda não foi realizada.");
          remote.retry();
        } catch (approvalError) {
          setFeedback(errorMessage(approvalError));
        }
      } else setFeedback(errorMessage(error));
    } finally {
      setBusy(null);
    }
  }

  async function updateEntry(event: FormEvent<HTMLFormElement>, entry: FinancialEntry) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    try {
      await run(
        "update",
        () =>
          api.management.updateFinanceEntry(
            scope.organizationId,
            scope.unitId,
            entry.direction,
            entry.id,
            {
              version: entry.version,
              description: formText(form, "description"),
              amountCents: currencyToCents(formText(form, "amount")),
              competenceDate: formText(form, "competenceDate"),
              dueDate: formText(form, "dueDate"),
              category: formText(form, "category") || undefined,
              costCenter: formText(form, "costCenter") || undefined,
              documentNumber: formText(form, "documentNumber") || undefined,
              notes: formText(form, "notes") || undefined,
            },
            operationalKey("finance-update"),
          ),
        "Lançamento atualizado.",
      );
    } catch {
      // run already exposes the actionable error
    }
  }

  async function importReconciliation() {
    if (!importFile || !importEntries.length) return;
    try {
      await run(
        "import",
        async () =>
          api.management.importFinanceReconciliation(
            scope.organizationId,
            scope.unitId,
            { source: "imported", fileHash: await sha256(importFile), entries: importEntries },
            operationalKey("reconciliation-import"),
          ),
        `${importEntries.length} transação(ões) importada(s) para conferência.`,
      );
      setImportFile(null);
      setImportEntries([]);
    } catch {
      // run already exposes the actionable error
    }
  }

  return (
    <RemoteGate remote={remote}>
      {(data) => {
        const selected =
          data.entries.find((entry) => `${entry.direction}:${entry.id}` === selectedKey) ?? null;
        const openCashRegisters =
          cashRemote.state.status === "ready"
            ? cashRemote.state.data.registers.filter((cashRegister) => cashRegister.openShiftId)
            : [];
        const postedPayments = data.entries.flatMap((entry) =>
          entry.payments
            .filter((payment) => payment.status === "posted")
            .map((payment) => ({
              ...payment,
              direction: entry.direction,
              description: entry.description,
            })),
        );
        const unresolved = data.reconciliationEntries.filter((entry) =>
          ["unmatched", "divergent"].includes(entry.status),
        );
        return (
          <div className="finance-page">
            <div className="finance-toolbar">
              <div>
                <p className="eyebrow">Controle financeiro operacional</p>
                <h2>Agenda e conciliação</h2>
              </div>
              <div className="finance-toolbar__actions">
                {(["csv", "pdf"] as const).map((format) => (
                  <Button
                    disabled={busy !== null}
                    key={format}
                    onClick={() =>
                      void run(
                        `export-${format}`,
                        async () =>
                          downloadArtifact(
                            await api.management.exportFinance(scope.organizationId, scope.unitId, {
                              direction: filters.direction,
                              status: filters.status,
                              search: filters.search,
                              from: filters.from,
                              to: filters.to,
                              format,
                            }),
                          ),
                        `Arquivo ${format.toUpperCase()} gerado.`,
                      ).catch(() => undefined)
                    }
                    size="sm"
                    variant="secondary"
                  >
                    Exportar {format.toUpperCase()}
                  </Button>
                ))}
              </div>
            </div>

            <section className="finance-metrics" aria-label="Resumo financeiro">
              <Card className="finance-metric">
                <span>A pagar</span>
                <strong>{formatMoney(data.summary.payableCents)}</strong>
                <small>Saldo pendente</small>
              </Card>
              <Card className="finance-metric">
                <span>A receber</span>
                <strong>{formatMoney(data.summary.receivableCents)}</strong>
                <small>Saldo pendente</small>
              </Card>
              <Card
                className={`finance-metric ${data.summary.projectedBalanceCents < 0 ? "finance-metric--danger" : ""}`}
              >
                <span>Saldo projetado</span>
                <strong>{formatMoney(data.summary.projectedBalanceCents)}</strong>
                <small>Contas cadastradas</small>
              </Card>
              <Card className="finance-metric">
                <span>Atenções</span>
                <strong>{data.summary.overdueCount + data.summary.dueTodayCount}</strong>
                <small>
                  {data.summary.overdueCount} vencida(s) · {data.summary.dueTodayCount} hoje
                </small>
              </Card>
            </section>

            <div className="finance-tabs" role="tablist" aria-label="Áreas do financeiro">
              {(
                [
                  ["agenda", "Agenda"],
                  ["reconciliation", `Conciliação (${data.summary.unresolvedReconciliations})`],
                  ["projection", "Projeção"],
                  ["settings", "Configurações"],
                ] as const
              ).map(([value, label]) => (
                <button
                  aria-selected={tab === value}
                  key={value}
                  onClick={() => setTab(value)}
                  role="tab"
                  type="button"
                >
                  {label}
                </button>
              ))}
            </div>

            {feedback && (
              <p className="finance-feedback" role="status">
                {feedback}
              </p>
            )}

            {tab === "agenda" && (
              <div className="finance-agenda">
                <div className="finance-main">
                  <form className="finance-filters" onSubmit={applyFilters}>
                    <label className="finance-filter-search">
                      Buscar
                      <Input
                        defaultValue={filters.search}
                        name="search"
                        placeholder="Descrição, documento, categoria..."
                      />
                    </label>
                    <label>
                      Tipo
                      <NativeSelect defaultValue={filters.direction ?? "all"} name="direction">
                        <option value="all">Todos</option>
                        <option value="payable">A pagar</option>
                        <option value="receivable">A receber</option>
                      </NativeSelect>
                    </label>
                    <label>
                      Status
                      <NativeSelect defaultValue={filters.status ?? "all"} name="status">
                        <option value="all">Todos</option>
                        <option value="open">Em aberto</option>
                        <option value="partial">Parcial</option>
                        <option value="settled">Liquidado</option>
                        <option value="overdue">Vencido</option>
                        <option value="due_soon">Próximos</option>
                        <option value="canceled">Cancelado</option>
                      </NativeSelect>
                    </label>
                    <label>
                      De
                      <Input defaultValue={filters.from} name="from" type="date" />
                    </label>
                    <label>
                      Até
                      <Input defaultValue={filters.to} name="to" type="date" />
                    </label>
                    <Button size="sm" type="submit">
                      Filtrar
                    </Button>
                  </form>

                  <Card className="finance-list-card">
                    <div className="finance-section-heading">
                      <div>
                        <p className="eyebrow">Agenda</p>
                        <h3>{data.pagination.total} lançamento(s)</h3>
                      </div>
                      <span>{data.summary.dueSoonCount} próximo(s)</span>
                    </div>
                    {data.entries.length ? (
                      <div className="finance-list">
                        {data.entries.map((entry) => {
                          const balance = entry.amountCents - entry.settledCents;
                          const key = `${entry.direction}:${entry.id}`;
                          return (
                            <button
                              className={`finance-entry ${selectedKey === key ? "finance-entry--selected" : ""}`}
                              key={key}
                              onClick={() => {
                                setSelectedKey(key);
                                setSettlementAmount((balance / 100).toFixed(2).replace(".", ","));
                              }}
                              type="button"
                            >
                              <span
                                className={`finance-direction finance-direction--${entry.direction}`}
                                aria-hidden="true"
                              >
                                {entry.direction === "payable" ? "↓" : "↑"}
                              </span>
                              <span className="finance-entry__body">
                                <strong>{entry.description}</strong>
                                <small>
                                  {dateLabel(entry.dueDate)} · {financeStatusLabel(entry.status)}
                                  {entry.installmentCount
                                    ? ` · ${entry.installmentNumber}/${entry.installmentCount}`
                                    : ""}
                                </small>
                                <small>
                                  {[entry.category, entry.costCenter, entry.documentNumber]
                                    .filter(Boolean)
                                    .join(" · ")}
                                </small>
                              </span>
                              <span
                                className={`finance-entry__amount ${entry.direction === "payable" ? "negative" : "positive"}`}
                              >
                                <strong>
                                  {entry.direction === "payable" ? "−" : "+"}
                                  {formatMoney(balance)}
                                </strong>
                                <small>de {formatMoney(entry.amountCents)}</small>
                              </span>
                            </button>
                          );
                        })}
                      </div>
                    ) : (
                      <EmptyState
                        description="Ajuste os filtros ou registre o primeiro lançamento."
                        icon="$"
                        title="Nenhum lançamento encontrado"
                      />
                    )}
                    {data.pagination.pageCount > 1 && (
                      <div className="finance-pagination">
                        <Button
                          disabled={(filters.page ?? 1) <= 1}
                          onClick={() =>
                            setFilters((current) => ({
                              ...current,
                              page: Math.max(1, (current.page ?? 1) - 1),
                            }))
                          }
                          size="sm"
                          variant="secondary"
                        >
                          Anterior
                        </Button>
                        <span>
                          Página {data.pagination.page} de {data.pagination.pageCount}
                        </span>
                        <Button
                          disabled={data.pagination.page >= data.pagination.pageCount}
                          onClick={() =>
                            setFilters((current) => ({ ...current, page: (current.page ?? 1) + 1 }))
                          }
                          size="sm"
                          variant="secondary"
                        >
                          Próxima
                        </Button>
                      </div>
                    )}
                  </Card>
                </div>

                <aside className="finance-side">
                  {data.capabilities.canManage && (
                    <details className="finance-panel" open={!selected}>
                      <summary>
                        <span>
                          <strong>Novo lançamento</strong>
                          <small>Cadastre uma conta única ou parcelada</small>
                        </span>
                        <span className="finance-disclosure-icon" aria-hidden="true" />
                      </summary>
                      <form className="finance-form" onSubmit={(event) => void createEntry(event)}>
                        <label>
                          Tipo
                          <NativeSelect
                            onChange={(event) =>
                              setCreateDirection(event.target.value as Direction)
                            }
                            value={createDirection}
                          >
                            <option value="payable">Conta a pagar</option>
                            <option value="receivable">Conta a receber</option>
                          </NativeSelect>
                        </label>
                        <label>
                          Valor da parcela
                          <Input inputMode="decimal" name="amount" placeholder="0,00" required />
                        </label>
                        <label className="finance-wide">
                          Descrição
                          <Input
                            autoComplete="off"
                            minLength={3}
                            name="description"
                            placeholder="Ex.: aluguel de agosto"
                            required
                          />
                        </label>
                        <label>
                          Competência
                          <Input name="competenceDate" required type="date" />
                        </label>
                        <label>
                          Primeiro vencimento
                          <Input name="dueDate" required type="date" />
                        </label>
                        <label>
                          Parcelas
                          <Input
                            defaultValue="1"
                            max="60"
                            min="1"
                            name="installments"
                            type="number"
                          />
                        </label>
                        <label>
                          Intervalo em meses
                          <Input
                            defaultValue="1"
                            max="12"
                            min="1"
                            name="intervalMonths"
                            type="number"
                          />
                        </label>
                        <details className="finance-form-options finance-wide">
                          <summary>
                            <span>
                              <strong>Mais informações</strong>
                              <small>Categoria, documento, observações e anexo</small>
                            </span>
                            <span className="finance-disclosure-icon" aria-hidden="true" />
                          </summary>
                          <div className="finance-form-options__grid">
                            <label>
                              Categoria
                              <Input name="category" />
                            </label>
                            <label>
                              Centro de custo
                              <Input name="costCenter" />
                            </label>
                            <label>
                              Documento
                              <Input name="documentNumber" />
                            </label>
                            <label>
                              Observações
                              <Input name="notes" />
                            </label>
                            <label>
                              Nome do anexo
                              <Input name="attachmentName" placeholder="Ex.: nota fiscal" />
                            </label>
                            <label>
                              URL do anexo
                              <Input name="attachmentUrl" type="url" />
                            </label>
                          </div>
                        </details>
                        <div className="finance-form__footer finance-wide">
                          <small>Revise os dados antes de registrar.</small>
                          <Button disabled={busy !== null} type="submit">
                            {busy === "create" ? "Registrando…" : "Registrar lançamento"}
                          </Button>
                        </div>
                      </form>
                    </details>
                  )}

                  {selected ? (
                    <EntryPanel
                      approvalNote={approvalNote}
                      busy={busy}
                      entry={selected}
                      onApprovalNote={setApprovalNote}
                      onCancel={(reason) =>
                        void run(
                          "cancel",
                          () =>
                            api.management.cancelFinanceEntry(
                              scope.organizationId,
                              scope.unitId,
                              selected.direction,
                              selected.id,
                              { version: selected.version, reason },
                              operationalKey("finance-cancel"),
                            ),
                          "Lançamento cancelado.",
                        ).catch(() => undefined)
                      }
                      onDecision={(approvalId, decision) =>
                        void run(
                          "approval",
                          () =>
                            api.management.decideFinanceApproval(
                              scope.organizationId,
                              scope.unitId,
                              approvalId,
                              { decision, note: approvalNote || undefined },
                              operationalKey("finance-approval-decision"),
                            ),
                          decision === "approve"
                            ? "Liquidação aprovada."
                            : "Solicitação rejeitada.",
                        ).catch(() => undefined)
                      }
                      onReverse={(paymentId) =>
                        void run(
                          "reverse",
                          () =>
                            api.management.reverseFinancePayment(
                              scope.organizationId,
                              scope.unitId,
                              selected.direction,
                              paymentId,
                              { reason: reversalReason },
                              operationalKey("finance-reversal"),
                            ),
                          "Liquidação estornada.",
                        ).catch(() => undefined)
                      }
                      onReversalReason={setReversalReason}
                      onSettle={(event) => void settleEntry(event, selected)}
                      onSettlementAmount={setSettlementAmount}
                      onUpdate={(event) => void updateEntry(event, selected)}
                      openCashRegisters={openCashRegisters}
                      approvals={data.approvals.filter(
                        (approval) => approval.entryId === selected.id,
                      )}
                      reversalReason={reversalReason}
                      settlementAmount={settlementAmount}
                    />
                  ) : (
                    <Card className="finance-selection">
                      <p className="eyebrow">Detalhes</p>
                      <strong>Selecione um lançamento</strong>
                      <small>Liquide, edite, cancele ou consulte seu histórico.</small>
                    </Card>
                  )}
                </aside>
              </div>
            )}

            {tab === "reconciliation" && (
              <div className="finance-reconciliation-grid">
                <Card>
                  <div className="finance-section-heading">
                    <div>
                      <p className="eyebrow">Importação manual</p>
                      <h3>Extrato CSV ou OFX</h3>
                    </div>
                    <span>Sem conexão bancária</span>
                  </div>
                  <p className="finance-help">
                    CSV: referência/id e valor são obrigatórios; taxa, líquido e direção são
                    opcionais. Revise os dados antes de importar.
                  </p>
                  <label className="finance-file">
                    Arquivo
                    <input
                      accept=".csv,.ofx,text/csv,application/x-ofx"
                      onChange={(event) => {
                        const file = event.target.files?.[0] ?? null;
                        setImportFile(file);
                        setImportEntries([]);
                        if (file)
                          void file
                            .text()
                            .then((content) =>
                              setImportEntries(parseReconciliationFile(file.name, content)),
                            )
                            .catch((error) => setFeedback(errorMessage(error)));
                      }}
                      type="file"
                    />
                  </label>
                  {importEntries.length > 0 && (
                    <div className="finance-preview">
                      <strong>{importEntries.length} transação(ões)</strong>
                      <span>
                        Entradas{" "}
                        {
                          importEntries.filter((entry) => entry.paymentDirection === "receivable")
                            .length
                        }{" "}
                        · Saídas{" "}
                        {
                          importEntries.filter((entry) => entry.paymentDirection === "payable")
                            .length
                        }
                      </span>
                    </div>
                  )}
                  <Button
                    disabled={!importFile || !importEntries.length || busy !== null}
                    onClick={() => void importReconciliation()}
                  >
                    Importar para conferência
                  </Button>
                </Card>
                <Card>
                  <div className="finance-section-heading">
                    <div>
                      <p className="eyebrow">Pendências</p>
                      <h3>{unresolved.length} transação(ões)</h3>
                    </div>
                  </div>
                  {unresolved.length ? (
                    <form
                      className="finance-form"
                      onSubmit={(event) => {
                        event.preventDefault();
                        const reconciliation = unresolved.find(
                          (entry) => entry.id === resolutionEntryId,
                        );
                        const [direction, paymentId] = resolutionPayment.split(":");
                        if (!reconciliation || !paymentId) return;
                        void run(
                          "resolve",
                          () =>
                            api.management.resolveFinanceReconciliation(
                              scope.organizationId,
                              scope.unitId,
                              reconciliation.id,
                              {
                                paymentDirection: direction as Direction,
                                paymentId,
                                note: resolutionNote,
                                version: reconciliation.version,
                              },
                              operationalKey("reconciliation-resolve"),
                            ),
                          "Conciliação resolvida.",
                        )
                          .then(() => {
                            setResolutionEntryId("");
                            setResolutionPayment("");
                            setResolutionNote("");
                          })
                          .catch(() => undefined);
                      }}
                    >
                      <label className="finance-wide">
                        Transação
                        <NativeSelect
                          onChange={(event) => setResolutionEntryId(event.target.value)}
                          required
                          value={resolutionEntryId}
                        >
                          <option value="">Selecione</option>
                          {unresolved.map((entry) => (
                            <option key={entry.id} value={entry.id}>
                              {entry.externalKey} · {formatMoney(entry.netCents)} · {entry.status}
                            </option>
                          ))}
                        </NativeSelect>
                      </label>
                      <label className="finance-wide">
                        Liquidação interna
                        <NativeSelect
                          onChange={(event) => setResolutionPayment(event.target.value)}
                          required
                          value={resolutionPayment}
                        >
                          <option value="">Selecione</option>
                          {postedPayments.map((payment) => (
                            <option key={payment.id} value={`${payment.direction}:${payment.id}`}>
                              {payment.description} · {formatMoney(payment.amountCents)} ·{" "}
                              {paymentMethodLabel(payment.method)}
                            </option>
                          ))}
                        </NativeSelect>
                      </label>
                      <label className="finance-wide">
                        Justificativa
                        <Input
                          minLength={3}
                          onChange={(event) => setResolutionNote(event.target.value)}
                          required
                          value={resolutionNote}
                        />
                      </label>
                      <Button
                        className="finance-wide"
                        disabled={busy !== null || !resolutionPayment}
                        type="submit"
                      >
                        Confirmar vínculo
                      </Button>
                    </form>
                  ) : (
                    <EmptyState
                      description="As transações importadas não possuem divergências pendentes."
                      icon="✓"
                      title="Conciliação em dia"
                    />
                  )}
                </Card>
              </div>
            )}

            {tab === "projection" && (
              <Card>
                <div className="finance-section-heading">
                  <div>
                    <p className="eyebrow">Fluxo previsto</p>
                    <h3>Projeção por vencimento</h3>
                  </div>
                  <span>Base: contas cadastradas</span>
                </div>
                {data.projection.length ? (
                  <div className="finance-projection">
                    <table>
                      <thead>
                        <tr>
                          <th>Data</th>
                          <th>Entradas</th>
                          <th>Saídas</th>
                          <th>Acumulado</th>
                        </tr>
                      </thead>
                      <tbody>
                        {data.projection.map((item) => (
                          <tr key={item.date}>
                            <td>{dateLabel(item.date)}</td>
                            <td className="positive">{formatMoney(item.receivableCents)}</td>
                            <td className="negative">{formatMoney(item.payableCents)}</td>
                            <td>
                              <strong>{formatMoney(item.balanceCents)}</strong>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <EmptyState
                    description="Registre contas futuras para visualizar o fluxo projetado."
                    icon="↗"
                    title="Sem projeção disponível"
                  />
                )}
              </Card>
            )}

            {tab === "settings" && (
              <SettingsPanel
                busy={busy}
                canConfigure={data.capabilities.canConfigure}
                onSave={(settings) =>
                  void run(
                    "settings",
                    () =>
                      api.management.updateFinanceSettings(
                        scope.organizationId,
                        scope.unitId,
                        settings,
                        operationalKey("finance-settings"),
                      ),
                    "Configurações salvas.",
                  ).catch(() => undefined)
                }
                settings={data.settings}
              />
            )}
          </div>
        );
      }}
    </RemoteGate>
  );
}

function EntryPanel({
  entry,
  busy,
  settlementAmount,
  onSettlementAmount,
  openCashRegisters,
  onSettle,
  onUpdate,
  onCancel,
  reversalReason,
  onReversalReason,
  onReverse,
  approvals,
  approvalNote,
  onApprovalNote,
  onDecision,
}: {
  entry: FinancialEntry;
  busy: string | null;
  settlementAmount: string;
  onSettlementAmount: (value: string) => void;
  openCashRegisters: Array<{ id: string; name: string }>;
  onSettle: (event: FormEvent<HTMLFormElement>) => void;
  onUpdate: (event: FormEvent<HTMLFormElement>) => void;
  onCancel: (reason: string) => void;
  reversalReason: string;
  onReversalReason: (value: string) => void;
  onReverse: (paymentId: string) => void;
  approvals: Array<{
    id: string;
    status: "pending" | "approved";
    amountCents: number;
    method: string;
  }>;
  approvalNote: string;
  onApprovalNote: (value: string) => void;
  onDecision: (approvalId: string, decision: "approve" | "reject") => void;
}) {
  const [cashMethod, setCashMethod] = useState(false);
  const [cancelReason, setCancelReason] = useState("");
  const balance = entry.amountCents - entry.settledCents;
  return (
    <Card className="finance-entry-panel">
      <div className="finance-section-heading">
        <div>
          <p className="eyebrow">
            {entry.direction === "payable" ? "Conta a pagar" : "Conta a receber"}
          </p>
          <h3>{entry.description}</h3>
        </div>
        <strong>{formatMoney(balance)}</strong>
      </div>
      <dl className="finance-details">
        <div>
          <dt>Competência</dt>
          <dd>{dateLabel(entry.competenceDate)}</dd>
        </div>
        <div>
          <dt>Vencimento</dt>
          <dd>{dateLabel(entry.dueDate)}</dd>
        </div>
        <div>
          <dt>Status</dt>
          <dd>{financeStatusLabel(entry.status)}</dd>
        </div>
        <div>
          <dt>Documento</dt>
          <dd>{entry.documentNumber ?? "—"}</dd>
        </div>
      </dl>
      {entry.attachments.length > 0 && (
        <div className="finance-attachments">
          {entry.attachments.map((attachment) => (
            <a href={attachment.url} key={attachment.url} rel="noreferrer" target="_blank">
              {attachment.name}
            </a>
          ))}
        </div>
      )}
      {balance > 0 && entry.status !== "canceled" && (
        <details className="finance-subpanel" open>
          <summary>Registrar liquidação</summary>
          <form className="finance-form" onSubmit={onSettle}>
            <label>
              Valor
              <Input
                inputMode="decimal"
                onChange={(event) => onSettlementAmount(event.target.value)}
                required
                value={settlementAmount}
              />
            </label>
            <label>
              Método
              <NativeSelect
                name="method"
                onChange={(event) => setCashMethod(event.target.value === "cash")}
                required
              >
                {paymentMethods.map((method) => (
                  <option key={method} value={method}>
                    {paymentMethodLabel(method)}
                  </option>
                ))}
              </NativeSelect>
            </label>
            {cashMethod && (
              <label className="finance-wide">
                Gaveta
                <NativeSelect name="cashRegisterId" required>
                  <option value="">Selecione</option>
                  {openCashRegisters.map((cashRegister) => (
                    <option key={cashRegister.id} value={cashRegister.id}>
                      {cashRegister.name}
                    </option>
                  ))}
                </NativeSelect>
              </label>
            )}
            <label>
              Data e hora
              <Input name="occurredAt" type="datetime-local" />
            </label>
            <label>
              Referência
              <Input name="reference" />
            </label>
            <Button className="finance-wide" disabled={busy !== null} type="submit">
              {busy === "settle" ? "Confirmando…" : "Confirmar liquidação"}
            </Button>
          </form>
        </details>
      )}
      {approvals.length > 0 && (
        <details className="finance-subpanel" open>
          <summary>Aprovações</summary>
          <label>
            Nota da decisão
            <Input onChange={(event) => onApprovalNote(event.target.value)} value={approvalNote} />
          </label>
          {approvals.map((approval) => (
            <div className="finance-approval" key={approval.id}>
              <span>
                <strong>{formatMoney(approval.amountCents)}</strong>
                <small>
                  {paymentMethodLabel(approval.method)} ·{" "}
                  {approval.status === "pending" ? "Aguardando" : "Aprovada"}
                </small>
              </span>
              {approval.status === "pending" && (
                <span>
                  <Button
                    disabled={busy !== null}
                    onClick={() => onDecision(approval.id, "approve")}
                    size="sm"
                  >
                    Aprovar
                  </Button>
                  <Button
                    disabled={busy !== null || approvalNote.trim().length < 3}
                    onClick={() => onDecision(approval.id, "reject")}
                    size="sm"
                    variant="danger"
                  >
                    Rejeitar
                  </Button>
                </span>
              )}
            </div>
          ))}
        </details>
      )}
      {entry.payments.length > 0 && (
        <details className="finance-subpanel">
          <summary>Histórico de liquidações ({entry.payments.length})</summary>
          <label>
            Motivo do estorno
            <Input
              minLength={3}
              onChange={(event) => onReversalReason(event.target.value)}
              value={reversalReason}
            />
          </label>
          {entry.payments.map((payment) => (
            <div className="finance-payment" key={payment.id}>
              <span>
                <strong>{formatMoney(payment.amountCents)}</strong>
                <small>
                  {paymentMethodLabel(payment.method)} ·{" "}
                  {new Date(payment.occurredAt).toLocaleString("pt-BR")} ·{" "}
                  {payment.status === "posted" ? "Confirmada" : "Estornada"}
                </small>
              </span>
              {payment.status === "posted" && (
                <Button
                  disabled={busy !== null || reversalReason.trim().length < 3}
                  onClick={() => onReverse(payment.id)}
                  size="sm"
                  variant="danger"
                >
                  Estornar
                </Button>
              )}
            </div>
          ))}
        </details>
      )}
      {entry.status === "open" && entry.settledCents === 0 && (
        <details className="finance-subpanel">
          <summary>Editar lançamento</summary>
          <form className="finance-form" onSubmit={onUpdate}>
            <label className="finance-wide">
              Descrição
              <Input defaultValue={entry.description} minLength={3} name="description" required />
            </label>
            <label>
              Valor
              <Input
                defaultValue={(entry.amountCents / 100).toFixed(2).replace(".", ",")}
                name="amount"
                required
              />
            </label>
            <label>
              Categoria
              <Input defaultValue={entry.category ?? ""} name="category" />
            </label>
            <label>
              Centro de custo
              <Input defaultValue={entry.costCenter ?? ""} name="costCenter" />
            </label>
            <label>
              Documento
              <Input defaultValue={entry.documentNumber ?? ""} name="documentNumber" />
            </label>
            <label>
              Competência
              <Input
                defaultValue={entry.competenceDate}
                name="competenceDate"
                required
                type="date"
              />
            </label>
            <label>
              Vencimento
              <Input defaultValue={entry.dueDate} name="dueDate" required type="date" />
            </label>
            <label className="finance-wide">
              Observações
              <Input defaultValue={entry.notes ?? ""} name="notes" />
            </label>
            <Button
              className="finance-wide"
              disabled={busy !== null}
              type="submit"
              variant="secondary"
            >
              Salvar alterações
            </Button>
          </form>
          <div className="finance-danger">
            <label>
              Motivo do cancelamento
              <Input
                minLength={3}
                onChange={(event) => setCancelReason(event.target.value)}
                value={cancelReason}
              />
            </label>
            <Button
              disabled={busy !== null || cancelReason.trim().length < 3}
              onClick={() => onCancel(cancelReason)}
              variant="danger"
            >
              Cancelar lançamento
            </Button>
          </div>
        </details>
      )}
    </Card>
  );
}

function SettingsPanel({
  settings,
  canConfigure,
  busy,
  onSave,
}: {
  settings: {
    paymentApprovalThresholdCents: number | null;
    requireDistinctApprover: boolean;
    dueSoonDays: number;
  };
  canConfigure: boolean;
  busy: string | null;
  onSave: (value: {
    paymentApprovalThresholdCents: number | null;
    requireDistinctApprover: boolean;
    dueSoonDays: number;
  }) => void;
}) {
  return (
    <Card className="finance-settings">
      <div className="finance-section-heading">
        <div>
          <p className="eyebrow">Políticas</p>
          <h3>Aprovação e vencimentos</h3>
        </div>
      </div>
      <form
        className="finance-form"
        onSubmit={(event) => {
          event.preventDefault();
          const form = new FormData(event.currentTarget);
          const threshold = formText(form, "threshold");
          onSave({
            paymentApprovalThresholdCents: threshold ? currencyToCents(threshold) : null,
            requireDistinctApprover: form.get("distinct") === "on",
            dueSoonDays: Number(formText(form, "dueSoonDays")),
          });
        }}
      >
        <label>
          Valor que exige aprovação
          <Input
            defaultValue={
              settings.paymentApprovalThresholdCents === null
                ? ""
                : (settings.paymentApprovalThresholdCents / 100).toFixed(2).replace(".", ",")
            }
            disabled={!canConfigure}
            inputMode="decimal"
            name="threshold"
            placeholder="Sem limite"
          />
        </label>
        <label>
          Dias para considerar próximo
          <Input
            defaultValue={settings.dueSoonDays}
            disabled={!canConfigure}
            max="90"
            min="1"
            name="dueSoonDays"
            required
            type="number"
          />
        </label>
        <label className="finance-check finance-wide">
          <input
            defaultChecked={settings.requireDistinctApprover}
            disabled={!canConfigure}
            name="distinct"
            type="checkbox"
          />
          <span>
            <strong>Exigir aprovador diferente</strong>
            <small>Quem solicita uma liquidação acima do limite não pode aprová-la.</small>
          </span>
        </label>
        {canConfigure ? (
          <Button className="finance-wide" disabled={busy !== null} type="submit">
            Salvar configurações
          </Button>
        ) : (
          <p className="finance-help finance-wide">
            Somente proprietário ou gerente pode alterar estas políticas.
          </p>
        )}
      </form>
    </Card>
  );
}
