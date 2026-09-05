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
import { type FormEvent, useEffect, useState } from "react";
import { api } from "../../api";
import { dateTime, type GrowthScope, RemoteGate, useRemote } from "../../growth.shared";
import { type CrmCustomerDetail, parseCrmCustomerDetail, parseCrmCustomerPage } from "./crm.model";
import { type CrmFeedback, CrmFormPanel, crmCurrency, crmError } from "./crm.ui";

const PAGE_SIZE = 30;
function openNewCustomerPanel() {
  const summary = document.getElementById("crm-new-customer");
  const panel = summary?.closest("details");
  if (panel) panel.open = true;
  summary?.focus();
}

function CustomerProfile({ detail }: { detail: CrmCustomerDetail }) {
  const { customer, metrics } = detail;
  return (
    <Card aria-labelledby="crm-profile-title" className="crm-profile">
      <header className="crm-profile__header">
        <div>
          <p className="eyebrow">Cliente 360</p>
          <h2 id="crm-profile-title">{customer.name}</h2>
        </div>
        <div className="crm-profile__badges">
          <Badge tone={detail.consent.email ? "success" : "neutral"}>
            E-mail {detail.consent.email ? "autorizado" : "sem opt-in"}
          </Badge>
          <Badge tone={detail.consent.whatsapp ? "success" : "neutral"}>
            WhatsApp {detail.consent.whatsapp ? "autorizado" : "sem opt-in"}
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
            <small>Saldo persistido do cliente</small>
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
            <dt>Ticket médio</dt>
            <dd>{crmCurrency.format((metrics.averageTicketCents ?? 0) / 100)}</dd>
          </div>
          <div>
            <dt>No-show</dt>
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
      <div className="crm-profile__section">
        <div className="crm-section-heading">
          <div>
            <strong>Timeline operacional</strong>
            <small>{detail.timeline.length} evento(s) persistido(s)</small>
          </div>
        </div>
        {detail.timeline.length === 0 ? (
          <div className="crm-inline-empty">
            <Icon name="clock" size={18} />
            <p>
              Nenhuma reserva, atendimento, entrega, campanha, cupom ou movimento de fidelidade
              vinculado.
            </p>
          </div>
        ) : (
          <div className="crm-timeline">
            {detail.timeline.slice(0, 12).map((entry) => (
              <article key={`${entry.kind}:${entry.id}:${entry.at}`}>
                <span aria-hidden="true" />
                <div>
                  <strong>{entry.label}</strong>
                  <small>
                    {entry.kind} · {entry.status} · {dateTime(entry.at)}
                  </small>
                </div>
                {entry.amountCents !== null && (
                  <strong>{crmCurrency.format(entry.amountCents / 100)}</strong>
                )}
                {entry.amount !== null && <strong>{entry.amount} ponto(s)</strong>}
              </article>
            ))}
          </div>
        )}
      </div>
    </Card>
  );
}

export function CrmCustomerWorkspace({ scope }: { scope: GrowthScope }) {
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
  const [mergeSourceId, setMergeSourceId] = useState("");
  const [mergeReason, setMergeReason] = useState("");
  const [consentCustomerId, setConsentCustomerId] = useState("");
  const [consentDecision, setConsentDecision] = useState<"granted" | "withdrawn">("granted");
  const [consentChannel, setConsentChannel] = useState<"email" | "whatsapp" | "all">("all");
  const [policyVersion, setPolicyVersion] = useState("");
  const rows = customers.state.status === "ready" ? customers.state.data.items : [];
  const selected = rows.find((customer) => customer.id === selectedId) ?? null;
  const selectedDetail =
    detail.state.status === "ready" && detail.state.data?.customer.id === selectedId
      ? detail.state.data
      : null;

  useEffect(() => {
    if (customers.state.status !== "ready") return;
    const firstId = customers.state.data.items[0]?.id ?? "";
    if (!customers.state.data.items.some((customer) => customer.id === selectedId)) {
      setSelectedId(firstId);
      setConsentCustomerId(firstId);
    }
  }, [customers.state, selectedId]);
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
        message: "Cliente cadastrado. Consentimento continua separado.",
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
      setFeedback({ tone: "success", message: "Cliente arquivado com auditoria." });
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
  async function mergeCustomer(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedDetail || !mergeSourceId || mergeReason.trim().length < 3) return;
    setBusy("merge");
    setFeedback(null);
    try {
      await api.growth.mergeCustomer(scope.organizationId, selectedDetail.customer.id, {
        sourceCustomerId: mergeSourceId,
        reason: mergeReason.trim(),
      });
      setMergeSourceId("");
      setMergeReason("");
      setFeedback({ tone: "success", message: "Cadastros mesclados com auditoria." });
      customers.retry();
      detail.retry();
    } catch (error) {
      setFeedback({
        tone: "danger",
        message: crmError(error, "Não foi possível mesclar os clientes."),
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
            ? "Consentimento registrado com trilha de auditoria."
            : "Retirada de consentimento registrada.",
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
                : "Clientes persistidos"}
          </Badge>
          <small>Busca paginada e visão operacional da organização atual.</small>
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
                          {customer.marketingOptIn ? "Opt-in" : "Sem opt-in"}
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
        {selected && selectedDetail ? (
          <CustomerProfile detail={selectedDetail} />
        ) : selected ? (
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
                title="Não foi possível carregar o Cliente 360"
              />
            ) : (
              <div className="remote-state">
                <span className="spinner" aria-hidden="true" />
                <strong>Carregando Cliente 360…</strong>
              </div>
            )}
          </Card>
        ) : (
          <Card className="crm-profile">
            <EmptyState
              description="Escolha um cliente para consultar contato, consentimento e fidelidade."
              icon={<Icon name="user" size={28} />}
              title="Selecione um cliente"
            />
          </Card>
        )}
      </div>
      {selectedDetail && (
        <CrmFormPanel
          description="Edite o cadastro, mescle duplicidades ou arquive com justificativa."
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
                Tags
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
            <form
              className="action-form crm-management-boundary"
              onSubmit={(event) => void mergeCustomer(event)}
            >
              <h3 className="action-form__wide">Mesclar duplicidade</h3>
              <p className="action-form__wide muted">
                O cliente selecionado será mantido; o cadastro de origem será incorporado e
                arquivado.
              </p>
              <label>
                Cadastro de origem
                <NativeSelect
                  onChange={(event) => setMergeSourceId(event.target.value)}
                  required
                  value={mergeSourceId}
                >
                  <option value="">Selecione nesta página</option>
                  {rows
                    .filter((customer) => customer.id !== selectedDetail.customer.id)
                    .map((customer) => (
                      <option key={customer.id} value={customer.id}>
                        {customer.name} · {customer.email ?? customer.phone ?? "sem contato"}
                      </option>
                    ))}
                </NativeSelect>
              </label>
              <label>
                Justificativa
                <Input
                  minLength={3}
                  onChange={(event) => setMergeReason(event.target.value)}
                  required
                  value={mergeReason}
                />
              </label>
              <Button
                disabled={busy === "merge" || !mergeSourceId || mergeReason.trim().length < 3}
                type="submit"
                variant="secondary"
              >
                {busy === "merge" ? "Mesclando…" : "Mesclar cadastros"}
              </Button>
            </form>
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
          description="Cadastro e consentimento permanecem operações separadas."
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
          description="Concessão e retirada ficam na trilha de auditoria."
          title="Consentimento de marketing"
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
                <option value="granted">Conceder</option>
                <option value="withdrawn">Retirar</option>
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
