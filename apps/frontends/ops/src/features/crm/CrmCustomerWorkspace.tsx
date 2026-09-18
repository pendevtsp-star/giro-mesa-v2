// biome-ignore-all lint/a11y/noLabelWithoutControl: controls render native form elements nested by labels
import {
  Badge,
  Button,
  Callout,
  Card,
  EmptyState,
  Icon,
  Input,
  NativeSelect,
  SearchField,
  Textarea,
} from "@giromesa/ui";
import { type FormEvent, useCallback, useEffect, useRef, useState } from "react";
import { api } from "../../api";
import { dateTime, type GrowthScope, RemoteGate, useRemote } from "../../growth.shared";
import {
  type CrmCustomerDetail,
  type CrmCustomerHistoryCursor,
  type CrmCustomerHistoryPage,
  type CrmTimelineEntry,
  parseCrmCustomerDetail,
  parseCrmCustomerHistory,
  parseCrmCustomerPage,
} from "./crm.model";
import { type CrmFeedback, CrmFormPanel, crmCurrency, crmError } from "./crm.ui";

const PAGE_SIZE = 30;
const timelineKinds: Record<string, string> = {
  service: "Atendimento",
  reservation: "Reserva",
  waitlist: "Fila de espera",
  delivery: "Entrega",
  campaign: "Campanha",
  coupon: "Cupom",
  whatsapp: "WhatsApp",
  loyalty: "Fidelidade",
};
const timelineStatuses: Record<string, string> = {
  open: "Em aberto",
  merged: "Unificado",
  closed: "Encerrado",
  canceled: "Cancelado",
  booked: "Agendado",
  confirmed: "Confirmado",
  seated: "Na mesa",
  completed: "Concluído",
  no_show: "Não compareceu",
  waiting: "Aguardando",
  notified: "Avisado",
  left: "Saiu da fila",
  draft: "Rascunho",
  placed: "Recebido",
  preparing: "Em preparo",
  ready: "Pronto",
  dispatched: "Saiu para entrega",
  delivery_failed: "Tentativa sem sucesso",
  returned: "Devolvido à loja",
  pending: "Pendente",
  blocked: "Envio bloqueado",
  holdout: "Grupo de controle",
  queued: "Na fila",
  sent: "Enviado",
  delivered: "Entregue",
  read: "Lido",
  received: "Recebido",
  failed: "Falha no envio",
  skipped: "Não enviado",
  suppressed: "Envio bloqueado",
  redeemed: "Resgatado",
  earn: "Pontos recebidos",
  redeem: "Pontos utilizados",
  expire: "Pontos expirados",
  reverse: "Pontos estornados",
  adjustment: "Ajuste de pontos",
};
const fulfillmentLabels: Record<string, string> = {
  dine_in: "Consumo no local",
  pickup: "Retirada",
  delivery: "Entrega",
};
function openNewCustomerPanel() {
  const summary = document.getElementById("crm-new-customer");
  const panel = summary?.closest("details");
  if (panel) panel.open = true;
  summary?.focus();
}

function timelineEntry(entry: CrmTimelineEntry) {
  return (
    <article key={`${entry.kind}:${entry.id}:${entry.at}`}>
      <span aria-hidden="true" />
      <div>
        <strong>
          {entry.kind === "service" || entry.kind === "delivery"
            ? (fulfillmentLabels[entry.label] ?? "Atendimento")
            : entry.kind === "loyalty" && entry.label === entry.status
              ? (timelineStatuses[entry.status] ?? "Movimentação de pontos")
              : entry.kind === "campaign"
                ? entry.label
                    .replace(/^email · /, "E-mail · ")
                    .replace(/^whatsapp · /, "WhatsApp · ")
                : entry.label}
        </strong>
        <small>
          {timelineKinds[entry.kind] ?? "Atividade"} ·{" "}
          {timelineStatuses[entry.status] ?? "Situação indisponível"} · {dateTime(entry.at)}
        </small>
      </div>
      {entry.amountCents !== null && <strong>{crmCurrency.format(entry.amountCents / 100)}</strong>}
      {entry.amount !== null && <strong>{entry.amount} ponto(s)</strong>}
    </article>
  );
}

function CustomerHistory({ detail, scope }: { detail: CrmCustomerDetail; scope: GrowthScope }) {
  const [page, setPage] = useState<CrmCustomerHistoryPage>({ items: [], nextCursor: null });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const requestVersion = useRef(0);
  const load = useCallback(
    async (cursor: CrmCustomerHistoryCursor | null) => {
      const version = ++requestVersion.current;
      setLoading(true);
      setError("");
      try {
        const next = parseCrmCustomerHistory(
          await api.growth.customerHistory(scope.organizationId, detail.customer.id, {
            limit: 12,
            ...(cursor
              ? { cursorAt: cursor.at, cursorKind: cursor.kind, cursorId: cursor.id }
              : {}),
          }),
        );
        if (requestVersion.current !== version) return;
        setPage((previous) => ({
          items: cursor ? [...previous.items, ...next.items] : next.items,
          nextCursor: next.nextCursor,
        }));
      } catch (cause) {
        if (requestVersion.current === version)
          setError(crmError(cause, "Não foi possível carregar o histórico. Tente novamente."));
      } finally {
        if (requestVersion.current === version) setLoading(false);
      }
    },
    [scope.organizationId, detail],
  );
  useEffect(() => {
    setPage({ items: [], nextCursor: null });
    void load(null);
    return () => {
      requestVersion.current += 1;
    };
  }, [load]);

  return (
    <section className="crm-profile__section" aria-labelledby="crm-history-title">
      <div className="crm-section-heading">
        <div>
          <strong id="crm-history-title">Histórico do cliente</strong>
          <small role="status">{page.items.length} evento(s) carregado(s)</small>
        </div>
      </div>
      {page.items.length > 0 && (
        <div id="crm-customer-history" className="crm-timeline">
          {page.items.map(timelineEntry)}
        </div>
      )}
      {!loading && !error && page.items.length === 0 && (
        <div className="crm-inline-empty">
          <Icon name="clock" size={18} />
          <p>
            Nenhuma reserva, atendimento, entrega, campanha, cupom ou movimento de fidelidade
            vinculado.
          </p>
        </div>
      )}
      {error && <Callout tone="danger">{error}</Callout>}
      {(loading || error || page.nextCursor) && (
        <Button
          aria-controls={page.items.length ? "crm-customer-history" : undefined}
          disabled={loading}
          onClick={() => void load(page.nextCursor)}
          size="sm"
          variant="secondary"
        >
          {loading
            ? "Carregando histórico…"
            : error
              ? "Tentar novamente"
              : "Carregar eventos anteriores"}
        </Button>
      )}
      {!loading && !error && page.items.length > 0 && !page.nextCursor && (
        <small className="muted">Todos os eventos disponíveis foram carregados.</small>
      )}
    </section>
  );
}

function CustomerProfile({ detail, scope }: { detail: CrmCustomerDetail; scope: GrowthScope }) {
  const { customer, metrics } = detail;
  return (
    <Card aria-labelledby="crm-profile-title" className="crm-profile">
      <header className="crm-profile__header">
        <div>
          <p className="eyebrow">Perfil do cliente</p>
          <h2 id="crm-profile-title">{customer.name}</h2>
        </div>
        <div className="crm-profile__badges">
          <Badge tone={detail.consent.email ? "success" : "neutral"}>
            E-mail {detail.consent.email ? "autorizado" : "sem autorização"}
          </Badge>
          <Badge tone={detail.consent.whatsapp ? "success" : "neutral"}>
            WhatsApp {detail.consent.whatsapp ? "autorizado" : "sem autorização"}
          </Badge>
        </div>
      </header>
      <section className="crm-contact-grid" aria-label="Dados de contato">
        <div>
          <span>E-mail</span>
          {customer.email ? (
            <a href={`mailto:${customer.email}`}>{customer.email}</a>
          ) : (
            <strong>Não informado</strong>
          )}
        </div>
        <div>
          <span>Telefone</span>
          {customer.phone ? (
            <a href={`tel:${customer.phone}`}>{customer.phone}</a>
          ) : (
            <strong>Não informado</strong>
          )}
        </div>
        <div>
          <span>Nascimento</span>
          <strong>
            {customer.birthDate
              ? customer.birthDate.split("-").reverse().join("/")
              : "Não informado"}
          </strong>
        </div>
        <div>
          <span>Cliente desde</span>
          <strong>{customer.createdAt ? dateTime(customer.createdAt) : "Não informado"}</strong>
        </div>
      </section>
      <div className="crm-profile__section">
        <div className="crm-section-heading">
          <div>
            <strong>Fidelidade</strong>
            <small>Saldo de pontos do cliente</small>
          </div>
          <strong className="crm-balance">{detail.loyalty.balance} ponto(s)</strong>
        </div>
      </div>
      <div className="crm-profile__section">
        <div className="crm-section-heading">
          <div>
            <strong>Relacionamento</strong>
            <small>Indicadores calculados automaticamente</small>
          </div>
        </div>
        <dl className="crm-metrics">
          <div>
            <dt>Visitas</dt>
            <dd>{metrics.visits ?? 0}</dd>
          </div>
          <div>
            <dt>Gasto total</dt>
            <dd>{crmCurrency.format((metrics.totalSpentCents ?? 0) / 100)}</dd>
          </div>
          <div>
            <dt>Gasto médio</dt>
            <dd>{crmCurrency.format((metrics.averageTicketCents ?? 0) / 100)}</dd>
          </div>
          <div>
            <dt>Faltas</dt>
            <dd>{metrics.noShows ?? 0}</dd>
          </div>
          <div>
            <dt>Última visita</dt>
            <dd>{metrics.lastVisitAt ? dateTime(metrics.lastVisitAt) : "Sem visita concluída"}</dd>
          </div>
        </dl>
      </div>
      {(customer.notes || customer.tags.length > 0) && (
        <div className="crm-profile__section">
          <div className="crm-section-heading">
            <strong>Preferências e observações</strong>
          </div>
          {customer.notes && <p className="crm-notes">{customer.notes}</p>}
          {customer.tags.length > 0 && (
            <div className="crm-tag-list">
              {customer.tags.map((tag) => (
                <Badge key={tag} tone="info">
                  {tag}
                </Badge>
              ))}
            </div>
          )}
        </div>
      )}
      <CustomerHistory
        key={`${scope.organizationId}:${scope.unitId}:${customer.id}`}
        detail={detail}
        scope={scope}
      />
    </Card>
  );
}

export function canMergeCustomers(targetId: string, sourceId: string, reason: string) {
  return Boolean(targetId && sourceId && targetId !== sourceId && reason.trim().length >= 3);
}

export function CrmCustomerMergeForm({
  scope,
  targetId,
  onMerged,
}: {
  scope: GrowthScope;
  targetId: string;
  onMerged: () => void;
}) {
  const [query, setQuery] = useState("");
  const [appliedQuery, setAppliedQuery] = useState("");
  const [offset, setOffset] = useState(0);
  const [sourceId, setSourceId] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const active = useRef(true);
  const lookupKey = `${appliedQuery}:${offset}`;
  const sources = useRemote(
    scope,
    () =>
      api.growth
        .customerPage(scope.organizationId, {
          q: appliedQuery || undefined,
          limit: PAGE_SIZE,
          offset,
        })
        .catch((cause) => {
          throw new Error(
            crmError(cause, "Não foi possível buscar cadastros de origem. Tente novamente."),
          );
        }),
    (value) => ({ key: lookupKey, page: parseCrmCustomerPage(value) }),
    lookupKey,
  );
  const page =
    sources.state.status === "ready" && sources.state.data.key === lookupKey
      ? sources.state.data.page
      : null;
  const source = page?.items.find((customer) => customer.id === sourceId);
  const searching = !page || sources.refreshing;
  const canMerge =
    !busy &&
    !searching &&
    !sources.refreshError &&
    Boolean(source) &&
    canMergeCustomers(targetId, sourceId, reason);

  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
    };
  }, []);

  function changePage(nextOffset: number) {
    setSourceId("");
    setOffset(nextOffset);
  }

  async function merge(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canMerge) return;
    setBusy(true);
    setError("");
    try {
      await api.growth.mergeCustomer(scope.organizationId, targetId, {
        sourceCustomerId: sourceId,
        reason: reason.trim(),
      });
      if (!active.current) return;
      setSourceId("");
      setReason("");
      sources.retry();
      onMerged();
    } catch (cause) {
      if (active.current) setError(crmError(cause, "Não foi possível unificar os cadastros."));
    } finally {
      if (active.current) setBusy(false);
    }
  }

  return (
    <section
      className="crm-management-boundary crm-merge-management"
      aria-labelledby="crm-merge-title"
    >
      <h3 id="crm-merge-title">Unificar cadastros duplicados</h3>
      <p className="muted">
        O cliente selecionado será mantido; o cadastro de origem será incorporado e arquivado.
      </p>
      <form
        className="crm-search crm-merge-search"
        onSubmit={(event) => {
          event.preventDefault();
          setAppliedQuery(query.trim());
          changePage(0);
        }}
      >
        <label>
          Buscar cadastro de origem
          <Input
            value={query}
            disabled={busy}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Nome, e-mail ou telefone em todos os clientes"
          />
        </label>
        <Button type="submit" size="sm" variant="secondary" disabled={busy}>
          Buscar duplicados
        </Button>
      </form>
      <RemoteGate remote={sources}>
        {() => (
          <>
            {sources.refreshError && (
              <Callout tone="danger">
                Não foi possível atualizar a busca.{" "}
                <Button size="sm" variant="secondary" onClick={sources.retry}>
                  Tentar novamente
                </Button>
              </Callout>
            )}
            <form className="action-form" onSubmit={(event) => void merge(event)}>
              <label className="action-form__wide">
                Cadastro de origem
                <NativeSelect
                  required
                  disabled={busy || searching || Boolean(sources.refreshError)}
                  value={sourceId}
                  onChange={(event) => setSourceId(event.target.value)}
                >
                  <option value="">
                    {searching ? "Buscando cadastros…" : "Selecione o cadastro a incorporar"}
                  </option>
                  {page?.items
                    .filter((customer) => customer.id !== targetId)
                    .map((customer) => (
                      <option key={customer.id} value={customer.id}>
                        {customer.name} · {customer.email ?? customer.phone ?? "sem contato"}
                      </option>
                    ))}
                </NativeSelect>
              </label>
              {page && !searching && (
                <p className="action-form__wide muted" role="status">
                  {page.items.some((customer) => customer.id !== targetId)
                    ? "Busque pelo nome ou contato, ou avance para consultar outros cadastros."
                    : "Nenhum outro cadastro nesta página. Altere a busca ou consulte a próxima página."}
                </p>
              )}
              {page && page.total > page.limit && (
                <nav
                  className="crm-pagination action-form__wide"
                  aria-label="Páginas de cadastros de origem"
                >
                  <Button
                    size="sm"
                    variant="secondary"
                    disabled={busy || searching || page.offset === 0}
                    onClick={() => changePage(Math.max(0, page.offset - page.limit))}
                  >
                    Anterior
                  </Button>
                  <small>
                    {page.offset + 1}–{Math.min(page.offset + page.items.length, page.total)} de{" "}
                    {page.total}
                  </small>
                  <Button
                    size="sm"
                    variant="secondary"
                    disabled={busy || searching || page.offset + page.items.length >= page.total}
                    onClick={() => changePage(page.offset + page.limit)}
                  >
                    Próxima
                  </Button>
                </nav>
              )}
              <label className="action-form__wide">
                Justificativa
                <Input
                  minLength={3}
                  required
                  disabled={busy}
                  value={reason}
                  onChange={(event) => setReason(event.target.value)}
                />
              </label>
              {error && (
                <div className="action-form__wide">
                  <Callout tone="danger">{error}</Callout>
                </div>
              )}
              <Button type="submit" variant="secondary" disabled={!canMerge}>
                {busy ? "Unificando…" : "Unificar cadastros"}
              </Button>
            </form>
          </>
        )}
      </RemoteGate>
    </section>
  );
}

export function CrmCustomerWorkspace({
  scope,
  focusedCustomerId,
}: {
  scope: GrowthScope;
  focusedCustomerId?: string;
}) {
  const [query, setQuery] = useState("");
  const [appliedQuery, setAppliedQuery] = useState("");
  const [offset, setOffset] = useState(0);
  const [selectedId, setSelectedId] = useState("");
  const customers = useRemote(
    scope,
    () =>
      api.growth.customerPage(scope.organizationId, {
        q: appliedQuery || undefined,
        limit: PAGE_SIZE,
        offset,
      }),
    parseCrmCustomerPage,
    `${appliedQuery}:${offset}`,
  );
  const detail = useRemote(
    scope,
    () =>
      selectedId
        ? api.growth.customerDetail(scope.organizationId, selectedId)
        : Promise.resolve(null),
    parseCrmCustomerDetail,
    selectedId,
  );
  const [busy, setBusy] = useState("");
  const [feedback, setFeedback] = useState<CrmFeedback | null>(null);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [birthDate, setBirthDate] = useState("");
  const [editName, setEditName] = useState("");
  const [editEmail, setEditEmail] = useState("");
  const [editPhone, setEditPhone] = useState("");
  const [editBirthDate, setEditBirthDate] = useState("");
  const [editNotes, setEditNotes] = useState("");
  const [editTags, setEditTags] = useState("");
  const [archiveReason, setArchiveReason] = useState("");
  const [consentCustomerId, setConsentCustomerId] = useState("");
  const [consentDecision, setConsentDecision] = useState<"granted" | "withdrawn">("granted");
  const [consentChannel, setConsentChannel] = useState<"email" | "whatsapp" | "all">("all");
  const [policyVersion, setPolicyVersion] = useState("");
  const rows = customers.state.status === "ready" ? customers.state.data.items : [];
  const selectedDetail =
    detail.state.status === "ready" && detail.state.data?.customer.id === selectedId
      ? detail.state.data
      : null;

  useEffect(() => {
    if (!focusedCustomerId) return;
    setSelectedId(focusedCustomerId);
    setConsentCustomerId(focusedCustomerId);
  }, [focusedCustomerId]);

  useEffect(() => {
    if (customers.state.status !== "ready") return;
    if (focusedCustomerId && selectedId === focusedCustomerId) return;
    const firstId = customers.state.data.items[0]?.id ?? "";
    if (!customers.state.data.items.some((customer) => customer.id === selectedId)) {
      setSelectedId(firstId);
      setConsentCustomerId(firstId);
    }
  }, [customers.state, selectedId, focusedCustomerId]);
  useEffect(() => {
    if (!selectedDetail) return;
    setEditName(selectedDetail.customer.name);
    setEditEmail(selectedDetail.customer.email ?? "");
    setEditPhone(selectedDetail.customer.phone ?? "");
    setEditBirthDate(selectedDetail.customer.birthDate ?? "");
    setEditNotes(selectedDetail.customer.notes ?? "");
    setEditTags(selectedDetail.customer.tags.join(", "));
  }, [selectedDetail]);

  function selectCustomer(id: string) {
    setSelectedId(id);
    setConsentCustomerId(id);
  }
  function search(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setOffset(0);
    setAppliedQuery(query.trim());
  }
  async function createCustomer(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy("create");
    setFeedback(null);
    try {
      await api.growth.createCustomer(scope.organizationId, {
        defaultUnitId: scope.unitId,
        name: name.trim(),
        email: email.trim() || undefined,
        phone: phone.trim() || undefined,
        birthDate: birthDate || undefined,
      });
      setName("");
      setEmail("");
      setPhone("");
      setBirthDate("");
      setFeedback({
        tone: "success",
        message:
          "Cliente cadastrado. A autorização para campanhas deve ser registrada separadamente.",
      });
      customers.retry();
    } catch (error) {
      setFeedback({
        tone: "danger",
        message: crmError(error, "Não foi possível cadastrar o cliente."),
      });
    } finally {
      setBusy("");
    }
  }
  async function updateCustomer(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedDetail) return;
    setBusy("update");
    setFeedback(null);
    try {
      await api.growth.updateCustomer(scope.organizationId, selectedDetail.customer.id, {
        name: editName.trim(),
        email: editEmail.trim() || null,
        phone: editPhone.trim() || null,
        birthDate: editBirthDate || null,
        notes: editNotes.trim() || null,
        tags: editTags
          .split(",")
          .map((tag) => tag.trim())
          .filter(Boolean),
      });
      setFeedback({ tone: "success", message: "Cadastro do cliente atualizado." });
      customers.retry();
      detail.retry();
    } catch (error) {
      setFeedback({
        tone: "danger",
        message: crmError(error, "Não foi possível atualizar o cliente."),
      });
    } finally {
      setBusy("");
    }
  }
  async function archiveCustomer(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedDetail || archiveReason.trim().length < 3) return;
    setBusy("archive");
    setFeedback(null);
    try {
      await api.growth.archiveCustomer(scope.organizationId, selectedDetail.customer.id, {
        reason: archiveReason.trim(),
      });
      setArchiveReason("");
      setSelectedId("");
      setConsentCustomerId("");
      setFeedback({
        tone: "success",
        message: "Cliente arquivado. A justificativa foi registrada.",
      });
      customers.retry();
    } catch (error) {
      setFeedback({
        tone: "danger",
        message: crmError(error, "Não foi possível arquivar o cliente."),
      });
    } finally {
      setBusy("");
    }
  }
  async function recordConsent(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy("consent");
    setFeedback(null);
    try {
      await api.growth.recordConsent(scope.organizationId, consentCustomerId, {
        decision: consentDecision,
        purpose: "marketing",
        channel: consentChannel,
        source: "ops-crm",
        legalBasis: "consent",
        policyVersion: policyVersion.trim(),
      });
      setFeedback({
        tone: "success",
        message:
          consentDecision === "granted"
            ? "Autorização para campanhas registrada."
            : "Retirada da autorização registrada.",
      });
      customers.retry();
      detail.retry();
    } catch (error) {
      setFeedback({
        tone: "danger",
        message: crmError(error, "Não foi possível registrar a decisão."),
      });
    } finally {
      setBusy("");
    }
  }

  return (
    <section className="growth-stack" aria-labelledby="crm-customers-heading">
      <div className="crm-observability gm-observability-row" aria-live="polite">
        <div>
          <Badge
            tone={
              customers.refreshError || detail.refreshError
                ? "warning"
                : customers.refreshing || detail.refreshing
                  ? "info"
                  : "success"
            }
          >
            {customers.refreshError || detail.refreshError
              ? "Clientes podem estar desatualizados"
              : customers.refreshing || detail.refreshing
                ? "Sincronizando clientes"
                : "Clientes atualizados"}
          </Badge>
          <small>Consulte os clientes e suas autorizações para campanhas.</small>
        </div>
        <Button
          disabled={customers.refreshing || detail.refreshing}
          onClick={() => {
            customers.retry();
            detail.retry();
          }}
          size="sm"
          variant="secondary"
        >
          <Icon name="refresh" size={15} /> Atualizar
        </Button>
      </div>
      {feedback && (
        <div aria-live="polite" role={feedback.tone === "danger" ? "alert" : "status"}>
          <Callout tone={feedback.tone}>{feedback.message}</Callout>
        </div>
      )}
      <div className="crm-workspace">
        <Card aria-labelledby="crm-customers-heading" className="crm-directory">
          <header className="crm-directory__header">
            <div>
              <p className="eyebrow">Relacionamento</p>
              <h2 id="crm-customers-heading">Clientes</h2>
            </div>
            {customers.state.status === "ready" && (
              <Badge tone="neutral">{customers.state.data.total} cadastrado(s)</Badge>
            )}
          </header>
          <form className="crm-search" onSubmit={search}>
            <SearchField
              aria-label="Buscar cliente por nome, e-mail ou telefone"
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Buscar nome, e-mail ou telefone"
              value={query}
            />
            <Button size="sm" type="submit">
              Buscar
            </Button>
          </form>
          <RemoteGate remote={customers}>
            {(page) =>
              page.items.length === 0 ? (
                <EmptyState
                  action={
                    appliedQuery ? (
                      <Button
                        onClick={() => {
                          setQuery("");
                          setAppliedQuery("");
                          setOffset(0);
                        }}
                        size="sm"
                        variant="secondary"
                      >
                        Limpar busca
                      </Button>
                    ) : (
                      <Button onClick={openNewCustomerPanel} size="sm">
                        Cadastrar cliente
                      </Button>
                    )
                  }
                  description={
                    appliedQuery
                      ? "Tente outro nome, e-mail ou telefone."
                      : "Cadastre o primeiro cliente para iniciar o relacionamento."
                  }
                  icon={<Icon name={appliedQuery ? "search" : "crm"} size={28} />}
                  title={appliedQuery ? "Nenhum cliente encontrado" : "Sem clientes"}
                />
              ) : (
                <>
                  <section aria-label="Resultados de clientes" className="crm-customer-list">
                    {page.items.map((customer) => (
                      <button
                        aria-pressed={customer.id === selectedId}
                        className="crm-customer-row"
                        key={customer.id}
                        onClick={() => selectCustomer(customer.id)}
                        type="button"
                      >
                        <span className="crm-customer-row__identity">
                          <strong>{customer.name}</strong>
                          <small>{customer.email ?? customer.phone ?? "Sem contato"}</small>
                        </span>
                        <Badge tone={customer.marketingOptIn ? "success" : "neutral"}>
                          {customer.marketingOptIn ? "Com autorização" : "Sem autorização"}
                        </Badge>
                      </button>
                    ))}
                  </section>
                  {page.total > page.limit && (
                    <nav aria-label="Paginação de clientes" className="crm-pagination">
                      <Button
                        disabled={page.offset === 0 || customers.refreshing}
                        onClick={() => setOffset(Math.max(0, page.offset - page.limit))}
                        size="sm"
                        variant="secondary"
                      >
                        Anterior
                      </Button>
                      <small>
                        {page.offset + 1}–{Math.min(page.offset + page.items.length, page.total)} de{" "}
                        {page.total}
                      </small>
                      <Button
                        disabled={
                          page.offset + page.items.length >= page.total || customers.refreshing
                        }
                        onClick={() => setOffset(page.offset + page.limit)}
                        size="sm"
                        variant="secondary"
                      >
                        Próxima
                      </Button>
                    </nav>
                  )}
                </>
              )
            }
          </RemoteGate>
        </Card>
        {selectedDetail ? (
          <CustomerProfile detail={selectedDetail} scope={scope} />
        ) : selectedId ? (
          <Card className="crm-profile" role={detail.refreshError ? "alert" : "status"}>
            {detail.refreshError ? (
              <EmptyState
                action={
                  <Button onClick={detail.retry} size="sm" variant="secondary">
                    Tentar novamente
                  </Button>
                }
                description={detail.refreshError}
                icon={<Icon name="alert-circle" size={28} />}
                title="Não foi possível carregar o perfil do cliente"
              />
            ) : (
              <div className="remote-state">
                <span className="spinner" aria-hidden="true" />
                <strong>Carregando perfil do cliente…</strong>
              </div>
            )}
          </Card>
        ) : (
          <Card className="crm-profile">
            <EmptyState
              description="Escolha um cliente para consultar contato, autorizações e fidelidade."
              icon={<Icon name="user" size={28} />}
              title="Selecione um cliente"
            />
          </Card>
        )}
      </div>
      {selectedDetail && (
        <CrmFormPanel
          description="Edite o cadastro, unifique duplicados ou arquive com justificativa."
          title={`Gerenciar ${selectedDetail.customer.name}`}
        >
          <div className="crm-customer-management">
            <form className="action-form" onSubmit={(event) => void updateCustomer(event)}>
              <h3 className="action-form__wide">Dados do cliente</h3>
              <label>
                Nome
                <Input
                  minLength={2}
                  onChange={(event) => setEditName(event.target.value)}
                  required
                  value={editName}
                />
              </label>
              <label>
                E-mail
                <Input
                  onChange={(event) => setEditEmail(event.target.value)}
                  type="email"
                  value={editEmail}
                />
              </label>
              <label>
                Telefone
                <Input
                  minLength={8}
                  onChange={(event) => setEditPhone(event.target.value)}
                  type="tel"
                  value={editPhone}
                />
              </label>
              <label>
                Data de nascimento
                <Input
                  onChange={(event) => setEditBirthDate(event.target.value)}
                  type="date"
                  value={editBirthDate}
                />
              </label>
              <label className="action-form__wide">
                Marcadores
                <Input
                  maxLength={400}
                  onChange={(event) => setEditTags(event.target.value)}
                  placeholder="Ex.: vegetariano, aniversário"
                  value={editTags}
                />
              </label>
              <label className="action-form__wide">
                Observações
                <Textarea
                  maxLength={1000}
                  onChange={(event) => setEditNotes(event.target.value)}
                  rows={3}
                  value={editNotes}
                />
              </label>
              <Button disabled={busy === "update" || editName.trim().length < 2} type="submit">
                {busy === "update" ? "Salvando…" : "Salvar alterações"}
              </Button>
            </form>
            <CrmCustomerMergeForm
              key={`${scope.organizationId}:${scope.unitId}:${selectedDetail.customer.id}`}
              scope={scope}
              targetId={selectedDetail.customer.id}
              onMerged={() => {
                setFeedback({
                  tone: "success",
                  message: "Cadastros unificados. A justificativa foi registrada.",
                });
                customers.retry();
                detail.retry();
              }}
            />
            <form
              className="action-form crm-management-boundary"
              onSubmit={(event) => void archiveCustomer(event)}
            >
              <h3 className="action-form__wide">Arquivar cliente</h3>
              <label className="action-form__wide">
                Motivo do arquivamento
                <Input
                  minLength={3}
                  onChange={(event) => setArchiveReason(event.target.value)}
                  required
                  value={archiveReason}
                />
              </label>
              <Button
                disabled={busy === "archive" || archiveReason.trim().length < 3}
                type="submit"
                variant="danger"
              >
                {busy === "archive" ? "Arquivando…" : "Arquivar cliente"}
              </Button>
            </form>
          </div>
        </CrmFormPanel>
      )}
      <div className="crm-action-grid">
        <CrmFormPanel
          description="Cadastrar um cliente não autoriza o envio de campanhas."
          id="crm-new-customer"
          title="Novo cliente"
        >
          <form className="action-form" onSubmit={(event) => void createCustomer(event)}>
            <label>
              Nome
              <Input
                minLength={2}
                onChange={(event) => setName(event.target.value)}
                required
                value={name}
              />
            </label>
            <label>
              E-mail
              <Input
                onChange={(event) => setEmail(event.target.value)}
                type="email"
                value={email}
              />
            </label>
            <label>
              Telefone
              <Input
                minLength={8}
                onChange={(event) => setPhone(event.target.value)}
                type="tel"
                value={phone}
              />
            </label>
            <label>
              Data de nascimento
              <Input
                onChange={(event) => setBirthDate(event.target.value)}
                type="date"
                value={birthDate}
              />
            </label>
            <Button disabled={busy === "create" || name.trim().length < 2} type="submit">
              {busy === "create" ? "Salvando…" : "Cadastrar cliente"}
            </Button>
          </form>
        </CrmFormPanel>
        <CrmFormPanel
          description="Registre a autorização do cliente ou sua retirada para cada canal."
          title="Autorização para campanhas"
        >
          <form className="action-form" onSubmit={(event) => void recordConsent(event)}>
            <label className="action-form__wide">
              Cliente
              <NativeSelect
                onChange={(event) => setConsentCustomerId(event.target.value)}
                required
                value={consentCustomerId}
              >
                <option value="">Selecione</option>
                {rows.map((customer) => (
                  <option key={customer.id} value={customer.id}>
                    {customer.name}
                  </option>
                ))}
              </NativeSelect>
            </label>
            <label>
              Decisão
              <NativeSelect
                onChange={(event) =>
                  setConsentDecision(event.target.value as "granted" | "withdrawn")
                }
                value={consentDecision}
              >
                <option value="granted">Registrar autorização</option>
                <option value="withdrawn">Retirar autorização</option>
              </NativeSelect>
            </label>
            <label>
              Canal
              <NativeSelect
                onChange={(event) =>
                  setConsentChannel(event.target.value as "email" | "whatsapp" | "all")
                }
                value={consentChannel}
              >
                <option value="all">E-mail e WhatsApp</option>
                <option value="email">E-mail</option>
                <option value="whatsapp">WhatsApp</option>
              </NativeSelect>
            </label>
            <label className="action-form__wide">
              Versão da política aceita
              <Input
                maxLength={40}
                onChange={(event) => setPolicyVersion(event.target.value)}
                placeholder="Ex.: privacidade-2026-08"
                required
                value={policyVersion}
              />
            </label>
            <Button
              disabled={busy === "consent" || !consentCustomerId || !policyVersion.trim()}
              type="submit"
            >
              {busy === "consent" ? "Registrando…" : "Registrar decisão"}
            </Button>
          </form>
        </CrmFormPanel>
      </div>
    </section>
  );
}
