// biome-ignore-all lint/a11y/noLabelWithoutControl: shadcn-compatible controls render native form elements nested by these labels
import {
  Badge,
  Button,
  Card,
  EmptyState,
  Icon,
  Input,
  Modal,
  NativeSelect,
  SegmentedTabs,
  Textarea,
} from "@giromesa/ui";
import { type FormEvent, useCallback, useEffect, useState } from "react";
import { ApiClientError, api, type FocusCompanyOnboardingBody } from "../../api";
import { dateLabel, type ManagementScope, RemoteGate, useRemote } from "../../management.shared";
import { formatMoney } from "../../rules";
import {
  type AccountantRequestFilter,
  accountantRequestHref,
  accountantRequestStatusLabel,
  accountantRequestViewFromHash,
  canResolveAccountantRequest,
  type FiscalDashboard,
  type FiscalDocument,
  type FiscalDocumentDetail,
  type FiscalPeriod,
  type FiscalProfile,
  fiscalRejectionGuidance,
  fiscalTone,
  parseAccountantWorkspace,
  parseFiscalDocumentDetail,
  parseFiscalWorkspace,
  validateAccountantAttachment,
} from "./fiscal";
import { fiscalTaxCsvTemplate, parseFiscalTaxCsv } from "./fiscal-csv";
import "./fiscal.css";

const fiscalOrigins = ["0", "1", "2", "3", "4", "5", "6", "7", "8"] as const;
type FiscalSection = "overview" | "setup" | "products" | "documents" | "closing";

const fiscalSections: Array<{ id: FiscalSection; label: string }> = [
  { id: "overview", label: "Resumo" },
  { id: "setup", label: "Cadastro fiscal" },
  { id: "products", label: "Produtos" },
  { id: "documents", label: "Notas fiscais" },
  { id: "closing", label: "Fechamento" },
];

export function RealFiscalPage({
  canCancelDocuments,
  canClosePeriods,
  canConfigure,
  canReopenPeriods,
  companyDefaults,
  scope,
}: {
  canCancelDocuments: boolean;
  canClosePeriods: boolean;
  canConfigure: boolean;
  canReopenPeriods: boolean;
  companyDefaults: { tradeName: string; city: string };
  scope: ManagementScope;
}) {
  const [section, setSection] = useState<FiscalSection>(() => fiscalSectionFromHash());
  const [refresh, setRefresh] = useState(0);
  const [documentFilters, setDocumentFilters] = useState<{
    status?: string;
    model?: string;
    from?: string;
    to?: string;
    search?: string;
  }>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<{ tone: "success" | "danger"; text: string } | null>(
    null,
  );
  const [documentDetail, setDocumentDetail] = useState<
    | { status: "loading"; id: string }
    | { status: "ready"; data: FiscalDocumentDetail }
    | { status: "error"; id: string; message: string }
    | null
  >(null);
  const loader = useCallback(async () => {
    const [
      profile,
      provider,
      taxRevisions,
      catalog,
      dashboard,
      documents,
      periods,
      numberInvalidations,
    ] = await Promise.all([
      api.fiscal.profile(scope.organizationId, scope.unitId),
      api.fiscal.provider(scope.organizationId, scope.unitId),
      api.fiscal.taxRevisions(scope.organizationId, scope.unitId),
      api.pilot.catalog(scope.organizationId, scope.unitId),
      api.fiscal.dashboard(scope.organizationId, scope.unitId),
      api.fiscal.documents(scope.organizationId, scope.unitId, documentFilters),
      api.fiscal.periods(scope.organizationId, scope.unitId),
      api.fiscal.numberInvalidations(scope.organizationId, scope.unitId),
    ]);
    return {
      profile,
      provider,
      taxRevisions,
      catalog,
      dashboard,
      documents,
      periods,
      numberInvalidations,
    };
  }, [documentFilters, scope.organizationId, scope.unitId]);
  const remote = useRemote(
    { ...scope, refreshToken: (scope.refreshToken ?? 0) + refresh },
    loader,
    parseFiscalWorkspace,
  );

  useEffect(() => {
    const syncSection = () => setSection(fiscalSectionFromHash());
    window.addEventListener("hashchange", syncSection);
    return () => window.removeEventListener("hashchange", syncSection);
  }, []);

  useEffect(() => {
    if (canConfigure || section !== "setup") return;
    setSection("overview");
    window.history.replaceState(null, "", fiscalSectionHref("overview"));
  }, [canConfigure, section]);

  function navigateSection(nextSection: FiscalSection) {
    if (nextSection === "setup" && !canConfigure) nextSection = "overview";
    setSection(nextSection);
    const href = fiscalSectionHref(nextSection);
    if (window.location.hash !== href) window.location.hash = href;
  }

  async function openDocument(documentId: string) {
    setDocumentDetail({ status: "loading", id: documentId });
    try {
      const response = await api.fiscal.document(scope.organizationId, scope.unitId, documentId);
      setDocumentDetail({ status: "ready", data: parseFiscalDocumentDetail(response) });
    } catch (error) {
      setDocumentDetail({
        status: "error",
        id: documentId,
        message: customerFiscalError(error, "Não foi possível carregar os detalhes da nota."),
      });
    }
  }

  async function changePeriod(period: FiscalPeriod, action: "close" | "reopen") {
    if (action === "close" && period.blockers.length) return;
    const confirmation =
      action === "close"
        ? `Fechar a competência ${competenceLabel(period.competence)}?`
        : `Reabrir a competência ${competenceLabel(period.competence)}?`;
    if (!window.confirm(confirmation)) return;
    const reason =
      action === "reopen"
        ? window.prompt("Informe o motivo da reabertura para a auditoria:")?.trim()
        : undefined;
    if (action === "reopen" && !reason) return;
    if (action === "reopen" && (reason?.length ?? 0) < 10) {
      setFeedback({ tone: "danger", text: "Informe um motivo com pelo menos 10 caracteres." });
      return;
    }
    setBusy(`${period.competence}:${action}`);
    setFeedback(null);
    try {
      if (action === "close") {
        await api.fiscal.closePeriod(scope.organizationId, scope.unitId, period.competence);
      } else {
        await api.fiscal.reopenPeriod(
          scope.organizationId,
          scope.unitId,
          period.competence,
          reason ?? "",
        );
      }
      setFeedback({
        tone: "success",
        text: action === "close" ? "Competência fechada." : "Competência reaberta.",
      });
      setRefresh((value) => value + 1);
    } catch (error) {
      setFeedback({
        tone: "danger",
        text: customerFiscalError(error, "Não foi possível atualizar a competência."),
      });
    } finally {
      setBusy(null);
    }
  }

  async function checkProvider() {
    setBusy("provider:check");
    setFeedback(null);
    try {
      await api.fiscal.checkProvider(scope.organizationId, scope.unitId);
      setFeedback({ tone: "success", text: "Serviço de emissão atualizado." });
      setRefresh((value) => value + 1);
    } catch (error) {
      setFeedback({
        tone: "danger",
        text: customerFiscalError(error, "Não foi possível verificar o serviço de emissão."),
      });
    } finally {
      setBusy(null);
    }
  }

  async function changeDocument(documentId: string, action: "reconcile" | "cancel") {
    const justification =
      action === "cancel"
        ? window.prompt("Justificativa fiscal do cancelamento (15 a 255 caracteres):")?.trim()
        : undefined;
    if (action === "cancel" && (!justification || justification.length < 15)) {
      setFeedback({
        tone: "danger",
        text: "Informe uma justificativa com pelo menos 15 caracteres.",
      });
      return;
    }
    const actionKey = `document:${documentId}:${action}`;
    setBusy(actionKey);
    setFeedback(null);
    try {
      if (action === "reconcile") {
        await api.fiscal.reconcileDocument(scope.organizationId, scope.unitId, documentId);
      } else {
        await api.fiscal.cancelDocument(
          scope.organizationId,
          scope.unitId,
          documentId,
          justification ?? "",
        );
      }
      setFeedback({
        tone: "success",
        text: action === "cancel" ? "Cancelamento confirmado." : "Situação da nota atualizada.",
      });
      setRefresh((value) => value + 1);
    } catch (error) {
      setFeedback({
        tone: "danger",
        text: customerFiscalError(error, "Não foi possível atualizar a nota fiscal."),
      });
    } finally {
      setBusy(null);
    }
  }

  return (
    <RemoteGate remote={remote}>
      {(data) => (
        <div className="fiscal-page fiscal-dashboard">
          <SegmentedTabs
            active={section === "setup" && !canConfigure ? "overview" : section}
            className="fiscal-subnav"
            items={fiscalSections
              .filter((item) => item.id !== "setup" || canConfigure)
              .map((item) => ({
                ...item,
                count:
                  item.id === "overview"
                    ? data.dashboard.pending.length
                    : item.id === "setup"
                      ? data.dashboard.provider.status === "ready"
                        ? 0
                        : 1
                      : item.id === "products"
                        ? data.products.filter(
                            (product) =>
                              !data.taxRevisions.some(
                                (revision) =>
                                  revision.productId === product.id && revision.status === "active",
                              ),
                          ).length
                        : item.id === "documents"
                          ? data.dashboard.summary.pendingCount +
                            data.dashboard.summary.rejectedCount
                          : data.periods.filter((period) => period.status !== "closed").length,
              }))}
            label="Seções do módulo fiscal"
            onChange={navigateSection}
          />

          {feedback && (
            <div className={`fiscal-feedback fiscal-feedback--${feedback.tone}`} role="status">
              {feedback.text}
            </div>
          )}

          {section === "overview" && (
            <section aria-label="Saúde fiscal" className="fiscal-health-grid" id="fiscal-overview">
              <Card className="fiscal-provider-card" data-status={data.dashboard.provider.status}>
                <div>
                  <p className="eyebrow">Situação atual</p>
                  <h2>Emissão fiscal</h2>
                  <p>
                    {data.dashboard.provider.lastSyncAt
                      ? `Última verificação: ${dateLabel(data.dashboard.provider.lastSyncAt)}`
                      : providerBusinessMessage(data.dashboard.provider.status)}
                  </p>
                </div>
                <div className="fiscal-provider-card__status">
                  <Badge tone={fiscalTone(data.dashboard.provider.status)}>
                    {providerLabel(data.dashboard.provider.status)}
                  </Badge>
                  <small>
                    {data.dashboard.provider.environment === "production"
                      ? "Produção — validade fiscal"
                      : data.dashboard.provider.environment === "homologation"
                        ? "Ambiente de testes"
                        : "Ambiente pendente"}
                  </small>
                  {data.dashboard.provider.registered && canConfigure ? (
                    <Button
                      disabled={busy !== null}
                      onClick={() => void checkProvider()}
                      size="sm"
                      variant="secondary"
                    >
                      <Icon name="refresh" size={14} />
                      {busy === "provider:check" ? "Verificando…" : "Verificar emissão"}
                    </Button>
                  ) : canConfigure ? (
                    <Button onClick={() => navigateSection("setup")} size="sm" variant="ghost">
                      Completar cadastro
                    </Button>
                  ) : null}
                </div>
              </Card>
              <div className="fiscal-metrics">
                <Metric
                  label="Autorizados"
                  value={data.dashboard.summary.authorizedCount}
                  tone="success"
                />
                <Metric
                  label="Pendentes"
                  value={data.dashboard.summary.pendingCount}
                  tone="warning"
                />
                <Metric
                  label="Rejeitados"
                  value={data.dashboard.summary.rejectedCount}
                  tone="danger"
                />
                <Metric
                  label="Total exibido"
                  value={formatMoney(data.dashboard.summary.totalCents)}
                  tone="info"
                />
              </div>
            </section>
          )}

          {section === "overview" && (
            <FiscalActivationChecklist
              canConfigure={canConfigure}
              onNavigate={navigateSection}
              profile={data.profile}
              provider={data.dashboard.provider}
              products={data.products}
              taxRevisions={data.taxRevisions}
            />
          )}

          {section === "overview" && (
            <FiscalPreventiveAlerts
              canConfigure={canConfigure}
              documents={data.documents}
              onNavigate={navigateSection}
              profile={data.profile}
              provider={data.dashboard.provider}
            />
          )}

          <div className="fiscal-columns fiscal-columns--single">
            {section === "overview" && (
              <Card className="fiscal-section-card">
                <SectionHeading
                  eyebrow="Próxima ação"
                  title="Pendências"
                  badge={`${data.dashboard.pending.length} aberta(s)`}
                  tone={data.dashboard.pending.length ? "warning" : "success"}
                />
                {data.dashboard.pending.length ? (
                  <div className="fiscal-list">
                    {data.dashboard.pending.map((item) => {
                      const target = pendingActionSection(item.id);
                      const opensAccountantPortal = item.id === "accountant";
                      return (
                        <article className="fiscal-list-row" key={item.id}>
                          <Badge tone={fiscalTone(item.severity)}>
                            {severityLabel(item.severity)}
                          </Badge>
                          <div>
                            <strong>{item.title}</strong>
                            <p>{item.detail}</p>
                          </div>
                          {target !== "setup" || canConfigure ? (
                            <Button
                              className="fiscal-row-action"
                              onClick={() => {
                                if (opensAccountantPortal) {
                                  window.location.hash = accountantRequestHref(
                                    "open",
                                    1,
                                    "establishment",
                                  );
                                  return;
                                }
                                navigateSection(target);
                              }}
                              size="sm"
                              variant="ghost"
                            >
                              {opensAccountantPortal ? "Abrir no Portal" : "Resolver"}
                            </Button>
                          ) : (
                            <small>Proprietário</small>
                          )}
                        </article>
                      );
                    })}
                  </div>
                ) : (
                  <EmptyState
                    description="Nenhuma exceção fiscal exige ação nesta unidade."
                    icon={<Icon name="check" />}
                    title="Fiscal em dia"
                  />
                )}
              </Card>
            )}

            {section === "closing" && (
              <Card className="fiscal-section-card">
                <SectionHeading eyebrow="Competências" title="Fechamento mensal" />
                {data.periods.length ? (
                  <div className="fiscal-list">
                    {data.periods.map((period) => {
                      const action = period.status === "closed" ? "reopen" : "close";
                      const actionKey = `${period.competence}:${action}`;
                      return (
                        <article className="fiscal-period-row" key={period.competence}>
                          <div>
                            <strong>{competenceLabel(period.competence)}</strong>
                            <span>
                              {formatMoney(period.grossTotalCents)} · {period.authorizedCount}{" "}
                              documento(s)
                            </span>
                            {period.blockers.length > 0 && (
                              <small>{period.blockers.join(" · ")}</small>
                            )}
                          </div>
                          <div className="fiscal-period-row__action">
                            <Badge tone={fiscalTone(period.status)}>
                              {periodLabel(period.status)}
                            </Badge>
                            {((action === "close" && canClosePeriods) ||
                              (action === "reopen" && canReopenPeriods)) && (
                              <Button
                                disabled={
                                  busy !== null ||
                                  (action === "close" && period.blockers.length > 0)
                                }
                                onClick={() => void changePeriod(period, action)}
                                size="sm"
                                variant={action === "reopen" ? "danger" : "secondary"}
                              >
                                {busy === actionKey
                                  ? "Salvando…"
                                  : action === "close"
                                    ? "Fechar"
                                    : "Reabrir"}
                              </Button>
                            )}
                          </div>
                        </article>
                      );
                    })}
                  </div>
                ) : (
                  <EmptyState
                    description="Nenhuma competência mensal está disponível para esta unidade."
                    icon={<Icon name="clock" />}
                    title="Sem competências"
                  />
                )}
              </Card>
            )}
          </div>

          {section === "setup" && canConfigure && (
            <FiscalConfiguration
              key={`${scope.organizationId}:${scope.unitId}`}
              onSaved={() => setRefresh((value) => value + 1)}
              profile={data.profile}
              scope={scope}
            />
          )}

          {section === "setup" && canConfigure && (
            <FocusOnboarding
              companyDefaults={companyDefaults}
              onActivated={() => setRefresh((value) => value + 1)}
              profile={data.profile}
              provider={data.dashboard.provider}
              scope={scope}
            />
          )}

          {section === "products" && (
            <Card className="fiscal-section-card">
              <TaxRevisionForm
                activeProductIds={
                  new Set(
                    data.taxRevisions
                      .filter((revision) => revision.status === "active")
                      .map((revision) => revision.productId),
                  )
                }
                enabled={Boolean(data.profile?.stateCode && data.profile.cityCode)}
                canEdit={canConfigure}
                onSaved={() => setRefresh((value) => value + 1)}
                products={data.products}
                scope={scope}
              />
            </Card>
          )}

          {section === "documents" && (
            <>
              <Card className="fiscal-section-card" id="fiscal-documents">
                <SectionHeading
                  eyebrow="Emissão fiscal"
                  title="Notas fiscais"
                  badge={`${data.documents.length} exibido(s)`}
                />
                <form
                  className="fiscal-document-filters"
                  onSubmit={(event) => {
                    event.preventDefault();
                    const form = new FormData(event.currentTarget);
                    setDocumentFilters(
                      Object.fromEntries(
                        ["status", "model", "from", "to", "search"].flatMap((key) => {
                          const value = String(form.get(key) ?? "").trim();
                          return value ? [[key, value]] : [];
                        }),
                      ) as typeof documentFilters,
                    );
                  }}
                >
                  <Input
                    aria-label="Buscar por chave ou destinatário"
                    name="search"
                    placeholder="Chave ou destinatário"
                    type="search"
                  />
                  <NativeSelect aria-label="Filtrar por status" name="status">
                    <option value="">Todos os status</option>
                    {[
                      "pending",
                      "processing",
                      "authorized",
                      "rejected",
                      "contingency",
                      "canceled",
                    ].map((status) => (
                      <option key={status} value={status}>
                        {documentLabel(status)}
                      </option>
                    ))}
                  </NativeSelect>
                  <Input aria-label="Emitidos a partir de" name="from" type="date" />
                  <Input aria-label="Emitidos até" name="to" type="date" />
                  <Button size="sm" type="submit" variant="secondary">
                    <Icon name="search" size={14} /> Filtrar
                  </Button>
                  <Button
                    onClick={(event) => {
                      event.currentTarget.form?.reset();
                      setDocumentFilters({});
                    }}
                    size="sm"
                    type="button"
                    variant="ghost"
                  >
                    Limpar
                  </Button>
                </form>
                {data.documents.length ? (
                  <div className="fiscal-document-list">
                    {data.documents.map((document) => (
                      <article className="fiscal-document-row" key={document.id}>
                        <div className="fiscal-document-row__identity">
                          <strong>
                            {modelLabel(document.model)} {document.number}
                          </strong>
                          <span>
                            Série {document.series} · {dateLabel(document.issuedAt)}
                          </span>
                        </div>
                        <span>{document.recipientName ?? "Consumidor não identificado"}</span>
                        <strong>{formatMoney(document.totalCents)}</strong>
                        <Badge tone={fiscalTone(document.status)}>
                          {documentLabel(document.status)}
                        </Badge>
                        <div className="fiscal-document-row__actions">
                          <Button
                            onClick={() => void openDocument(document.id)}
                            size="sm"
                            variant="secondary"
                          >
                            Ver detalhes
                          </Button>
                          <Button
                            disabled={busy !== null}
                            onClick={() => void changeDocument(document.id, "reconcile")}
                            size="sm"
                            variant="ghost"
                          >
                            {busy === `document:${document.id}:reconcile`
                              ? "Atualizando…"
                              : "Atualizar"}
                          </Button>
                          {document.status === "authorized" && canCancelDocuments && (
                            <Button
                              disabled={busy !== null}
                              onClick={() => void changeDocument(document.id, "cancel")}
                              size="sm"
                              variant="danger"
                            >
                              Cancelar
                            </Button>
                          )}
                        </div>
                      </article>
                    ))}
                  </div>
                ) : (
                  <EmptyState
                    description="Nenhuma nota fiscal foi encontrada com os filtros informados."
                    icon={<Icon name="list" />}
                    title="Sem notas fiscais"
                  />
                )}
              </Card>
              <NumberInvalidationPanel
                canCreate={canConfigure}
                items={data.numberInvalidations}
                onSaved={() => setRefresh((value) => value + 1)}
                scope={scope}
              />
            </>
          )}
          <FiscalDocumentDetailModal
            onClose={() => setDocumentDetail(null)}
            onRetry={(documentId) => void openDocument(documentId)}
            scope={scope}
            state={documentDetail}
          />
        </div>
      )}
    </RemoteGate>
  );
}

function FiscalDocumentDetailModal({
  onClose,
  onRetry,
  scope,
  state,
}: {
  onClose: () => void;
  onRetry: (documentId: string) => void;
  scope: ManagementScope;
  state:
    | { status: "loading"; id: string }
    | { status: "ready"; data: FiscalDocumentDetail }
    | { status: "error"; id: string; message: string }
    | null;
}) {
  const [downloading, setDownloading] = useState<string | null>(null);
  const document = state?.status === "ready" ? state.data : null;

  async function downloadArtifact(
    documentId: string,
    kind: "authorization_xml" | "cancellation_xml" | "danfe_pdf",
  ) {
    setDownloading(kind);
    try {
      saveDownloadedFile(
        await api.fiscal.documentArtifact(scope.organizationId, scope.unitId, documentId, kind),
      );
    } finally {
      setDownloading(null);
    }
  }
  return (
    <Modal
      description={
        document ? `${modelLabel(document.model)} · ${documentLabel(document.status)}` : undefined
      }
      isOpen={state !== null}
      onClose={onClose}
      size="lg"
      title={document ? `Nota fiscal ${document.number}` : "Detalhes da nota fiscal"}
    >
      {state?.status === "loading" && (
        <div className="remote-state" role="status">
          <span aria-hidden="true" className="spinner" />
          <strong>Carregando detalhes…</strong>
        </div>
      )}
      {state?.status === "error" && (
        <div className="remote-state" role="alert">
          <strong>Falha ao carregar a nota</strong>
          <p>{state.message}</p>
          <Button onClick={() => onRetry(state.id)} size="sm" variant="secondary">
            Tentar novamente
          </Button>
        </div>
      )}
      {document && (
        <div className="fiscal-document-detail">
          <dl className="fiscal-document-detail__summary">
            <div>
              <dt>Emissão</dt>
              <dd>{dateLabel(document.issuedAt)}</dd>
            </div>
            <div>
              <dt>Total</dt>
              <dd>{formatMoney(document.totalCents)}</dd>
            </div>
            <div>
              <dt>Tributos</dt>
              <dd>{formatMoney(document.taxCents)}</dd>
            </div>
            <div>
              <dt>Venda vinculada</dt>
              <dd>{document.tabId || document.orderId ? "Sim" : "Não"}</dd>
            </div>
          </dl>
          {document.tabId && (
            <Button
              onClick={() => {
                window.location.hash = `#/counter?tab=${encodeURIComponent(document.tabId ?? "")}&origem=fiscal`;
              }}
              size="sm"
              variant="secondary"
            >
              Abrir venda no balcão
            </Button>
          )}
          {document.accessKey && (
            <div className="fiscal-document-detail__key">
              <span>Chave de acesso</span>
              <code>{document.accessKey}</code>
            </div>
          )}
          {document.artifacts.length > 0 && (
            <div className="fiscal-form-actions">
              {document.artifacts.map((artifact) => (
                <Button
                  disabled={downloading !== null}
                  key={artifact.kind}
                  onClick={() => void downloadArtifact(document.id, artifact.kind)}
                  size="sm"
                  variant="secondary"
                >
                  <Icon name="download" size={14} />
                  {artifact.kind === "danfe_pdf"
                    ? "Baixar DANFE"
                    : artifact.kind === "cancellation_xml"
                      ? "Baixar XML de cancelamento"
                      : "Baixar XML"}
                </Button>
              ))}
            </div>
          )}
          {document.status === "rejected" && (
            <div className="fiscal-preventive-alert" role="alert">
              <Icon name="alert-circle" size={16} />
              <div>
                <strong>Como resolver</strong>
                <p>{latestRejectionGuidance(document)}</p>
                {latestRejectionGuidance(document).includes("classificação fiscal") && (
                  <Button
                    onClick={() => {
                      window.location.hash = fiscalSectionHref("products");
                    }}
                    size="sm"
                    variant="secondary"
                  >
                    Revisar classificação
                  </Button>
                )}
              </div>
            </div>
          )}
          <section aria-labelledby="fiscal-document-items-title">
            <h3 id="fiscal-document-items-title">Itens da nota</h3>
            {document.items.length ? (
              <div className="fiscal-document-detail__items">
                {document.items.map((item) => (
                  <article key={item.id}>
                    <div>
                      <strong>{item.description}</strong>
                      <span>{formatFiscalQuantity(item.quantityMilli)}</span>
                    </div>
                    <strong>{formatMoney(item.totalCents)}</strong>
                  </article>
                ))}
              </div>
            ) : (
              <p className="fiscal-document-detail__empty">Nenhum item retornado para esta nota.</p>
            )}
          </section>
          <section aria-labelledby="fiscal-document-events-title">
            <h3 id="fiscal-document-events-title">Histórico</h3>
            <ol className="fiscal-document-timeline">
              {document.events.map((event) => (
                <li key={event.id}>
                  <span aria-hidden="true" />
                  <div>
                    <strong>{documentEventLabel(event.type, event.status)}</strong>
                    <small>{dateLabel(event.occurredAt)}</small>
                  </div>
                </li>
              ))}
            </ol>
          </section>
        </div>
      )}
    </Modal>
  );
}

function NumberInvalidationPanel({
  canCreate,
  items,
  onSaved,
  scope,
}: {
  canCreate: boolean;
  items: Array<{
    id: string;
    series: string;
    initialNumber: number;
    finalNumber: number;
    justification: string;
    status: "processing" | "invalidated" | "rejected";
    errorMessage: string | null;
    createdAt: string;
  }>;
  onSaved: () => void;
  scope: ManagementScope;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const body = {
      series: String(form.get("series") ?? "").trim(),
      initialNumber: Number(form.get("initialNumber")),
      finalNumber: Number(form.get("finalNumber")),
      justification: String(form.get("justification") ?? "").trim(),
    };
    if (body.justification.length < 15) {
      setFeedback("Informe uma justificativa com pelo menos 15 caracteres.");
      return;
    }
    setBusy("create");
    setFeedback(null);
    try {
      await api.fiscal.invalidateNumbers(scope.organizationId, scope.unitId, body);
      event.currentTarget.reset();
      setFeedback("Solicitação de inutilização registrada.");
      onSaved();
    } catch (error) {
      setFeedback(customerFiscalError(error, "Não foi possível inutilizar a numeração."));
    } finally {
      setBusy(null);
    }
  }

  async function download(invalidationId: string) {
    setBusy(invalidationId);
    try {
      saveDownloadedFile(
        await api.fiscal.numberInvalidationArtifact(
          scope.organizationId,
          scope.unitId,
          invalidationId,
        ),
      );
    } finally {
      setBusy(null);
    }
  }

  return (
    <Card className="fiscal-section-card fiscal-number-invalidations">
      <SectionHeading
        badge={items.length ? `${items.length} registro(s)` : undefined}
        eyebrow="Numeração fiscal"
        title="Inutilizações"
      />
      <p className="fiscal-muted">
        Use somente para faixas que não foram usadas. A solicitação é enviada à SEFAZ e não pode ser
        desfeita.
      </p>
      {canCreate && (
        <details className="gm-disclosure">
          <summary>Inutilizar uma faixa</summary>
          <form className="gm-disclosure__content gm-form-stack" onSubmit={submit}>
            <div className="gm-form-grid fiscal-profile-grid">
              <label className="gm-form-field">
                <span>Série</span>
                <Input inputMode="numeric" maxLength={3} name="series" pattern="\d{1,3}" required />
              </label>
              <label className="gm-form-field">
                <span>Número inicial</span>
                <Input min={1} name="initialNumber" required type="number" />
              </label>
              <label className="gm-form-field">
                <span>Número final</span>
                <Input min={1} name="finalNumber" required type="number" />
              </label>
              <label className="gm-form-field fiscal-field--wide">
                <span>Justificativa</span>
                <Textarea minLength={15} name="justification" required rows={3} />
              </label>
            </div>
            <Button disabled={busy !== null} type="submit" variant="danger">
              {busy === "create" ? "Enviando…" : "Confirmar inutilização"}
            </Button>
          </form>
        </details>
      )}
      {feedback && (
        <p aria-live="polite" className="fiscal-form-feedback">
          {feedback}
        </p>
      )}
      {items.length > 0 && (
        <div className="fiscal-document-list">
          {items.map((item) => (
            <article className="fiscal-document-row" key={item.id}>
              <div className="fiscal-document-row__identity">
                <strong>
                  Série {item.series} · {item.initialNumber}–{item.finalNumber}
                </strong>
                <span>{dateLabel(item.createdAt)}</span>
              </div>
              <span>{item.justification}</span>
              <Badge
                tone={
                  item.status === "invalidated"
                    ? "success"
                    : item.status === "rejected"
                      ? "danger"
                      : "info"
                }
              >
                {item.status === "invalidated"
                  ? "Inutilizada"
                  : item.status === "rejected"
                    ? "Rejeitada"
                    : "Processando"}
              </Badge>
              {item.status === "invalidated" && (
                <Button
                  disabled={busy !== null}
                  onClick={() => void download(item.id)}
                  size="sm"
                  variant="secondary"
                >
                  <Icon name="download" size={14} /> XML
                </Button>
              )}
            </article>
          ))}
        </div>
      )}
    </Card>
  );
}

function FiscalActivationChecklist({
  canConfigure,
  onNavigate,
  profile,
  provider,
  products,
  taxRevisions,
}: {
  canConfigure: boolean;
  onNavigate: (section: FiscalSection) => void;
  profile: FiscalProfile | null;
  provider: FiscalDashboard["provider"];
  products: Array<{ id: string; name: string; categoryId: string; categoryName: string }>;
  taxRevisions: Array<{ productId: string; status: "draft" | "active" | "revoked" }>;
}) {
  const activeProducts = new Set(
    taxRevisions
      .filter((revision) => revision.status === "active")
      .map((revision) => revision.productId),
  );
  const selectedEnvironmentReady = profile ? provider.environments[profile.environment] : false;
  const steps = [
    {
      label: "Serviço de emissão disponível",
      done: provider.status !== "platform_not_configured",
      section: "setup" as const,
    },
    {
      label: "Dados tributários, UF e município confirmados",
      done: Boolean(profile?.stateCode && profile.cityCode && profile.provider === "focus"),
      section: "setup" as const,
    },
    {
      label: "Empresa habilitada para emissão",
      done: provider.registered,
      section: "setup" as const,
    },
    {
      label: `${profile?.environment === "production" ? "Produção" : "Ambiente de testes"} pronto para emitir`,
      done: selectedEnvironmentReady,
      section: "setup" as const,
    },
    {
      label: "Todos os produtos ativos classificados",
      done: products.length > 0 && products.every((product) => activeProducts.has(product.id)),
      section: "products" as const,
    },
  ];
  const complete = steps.filter((step) => step.done).length;
  return (
    <Card className="fiscal-section-card fiscal-activation" id="fiscal-activation">
      <SectionHeading
        badge={`${complete}/${steps.length} concluídas`}
        eyebrow="Próxima ação"
        title="Preparação para emitir"
        tone={complete === steps.length ? "success" : "warning"}
      />
      <ol className="fiscal-checklist">
        {steps.map((step) => (
          <li className={step.done ? "is-complete" : ""} key={step.label}>
            <Icon name={step.done ? "check" : "clock"} size={16} />
            <span>{step.label}</span>
            {!step.done && canConfigure && (
              <Button onClick={() => onNavigate(step.section)} size="sm" variant="ghost">
                Resolver
              </Button>
            )}
          </li>
        ))}
      </ol>
    </Card>
  );
}

function FiscalPreventiveAlerts({
  canConfigure,
  documents,
  onNavigate,
  profile,
  provider,
}: {
  canConfigure: boolean;
  documents: FiscalDocument[];
  onNavigate: (section: FiscalSection) => void;
  profile: FiscalProfile | null;
  provider: FiscalDashboard["provider"];
}) {
  const certificateDays = provider.certificateValidUntil
    ? Math.ceil((new Date(provider.certificateValidUntil).getTime() - Date.now()) / 86_400_000)
    : null;
  const delayedDocuments = documents.filter(
    (document) =>
      ["pending", "processing", "contingency"].includes(document.status) &&
      Date.now() - new Date(document.issuedAt).getTime() > 10 * 60_000,
  ).length;
  const alerts = [
    ...(certificateDays !== null && certificateDays <= 60
      ? [
          {
            id: "certificate",
            text:
              certificateDays < 0
                ? "Certificado A1 vencido. A emissão pode ser interrompida."
                : `Certificado A1 vence em ${certificateDays} dia(s). ${certificateDays <= 15 ? "Renove agora." : "Programe a renovação."}`,
            section: "setup" as const,
          },
        ]
      : []),
    ...(profile?.environment === "production" && !provider.environments.production
      ? [
          {
            id: "production",
            text: "Produção selecionada, mas a empresa ainda não está pronta para emitir.",
            section: "setup" as const,
          },
        ]
      : []),
    ...(delayedDocuments
      ? [
          {
            id: "delayed",
            text: `${delayedDocuments} nota(s) aguardam retorno há mais de 10 minutos.`,
            section: "documents" as const,
          },
        ]
      : []),
  ];
  if (!alerts.length) return null;
  return (
    <Card className="fiscal-section-card fiscal-preventive-alerts">
      <SectionHeading
        badge={`${alerts.length} alerta(s)`}
        eyebrow="Prevenção"
        title="Alertas fiscais"
        tone="warning"
      />
      <div className="fiscal-list">
        {alerts.map((alert) => (
          <article className="fiscal-list-row" key={alert.id}>
            <Icon name="alert-circle" size={16} />
            <span>{alert.text}</span>
            {alert.section !== "setup" || canConfigure ? (
              <Button onClick={() => onNavigate(alert.section)} size="sm" variant="ghost">
                Ver
              </Button>
            ) : (
              <small>Avise o proprietário</small>
            )}
          </article>
        ))}
      </div>
    </Card>
  );
}

function FiscalConfiguration({
  profile,
  scope,
  onSaved,
}: {
  profile: FiscalProfile | null;
  scope: ManagementScope;
  onSaved: () => void;
}) {
  const [draft, setDraft] = useState(profile);
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);

  if (!draft) {
    return (
      <Card className="fiscal-section-card">
        <SectionHeading eyebrow="Cadastro fiscal" title="Dados tributários" tone="warning" />
        <EmptyState
          description="A unidade não possui uma empresa vinculada. Informe este cadastro ao suporte GiroMesa."
          icon={<Icon name="alert-circle" />}
          title="Vínculo empresarial pendente"
        />
      </Card>
    );
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!draft) return;
    setBusy(true);
    setFeedback(null);
    try {
      await api.fiscal.updateProfile(scope.organizationId, scope.unitId, {
        ...draft,
        provider: "focus",
        municipalRegistration: draft.municipalRegistration || undefined,
        cnae: draft.cnae || undefined,
        series: Object.fromEntries(Object.entries(draft.series).filter(([, value]) => value)),
      });
      setFeedback("Dados tributários atualizados.");
      onSaved();
    } catch (error) {
      setFeedback(customerFiscalError(error, "Não foi possível salvar os dados tributários."));
    } finally {
      setBusy(false);
    }
  }

  const update = <K extends keyof FiscalProfile>(key: K, value: FiscalProfile[K]) =>
    setDraft((current) => (current ? { ...current, [key]: value } : current));

  return (
    <Card className="fiscal-section-card fiscal-configuration" id="fiscal-configuration">
      <SectionHeading eyebrow="Cadastro fiscal" title="Dados tributários" />
      <form className="gm-form-stack" onSubmit={save}>
        <div className="gm-form-grid fiscal-profile-grid">
          <label className="gm-form-field">
            <span>Regime tributário</span>
            <NativeSelect
              className="gm-control"
              onChange={(event) =>
                update("taxRegime", event.target.value as FiscalProfile["taxRegime"])
              }
              value={draft.taxRegime}
            >
              <option value="simples_nacional">Simples Nacional</option>
              <option value="simples_excesso">Simples — excesso</option>
              <option value="lucro_presumido">Lucro presumido</option>
              <option value="lucro_real">Lucro real</option>
            </NativeSelect>
          </label>
          <label className="gm-form-field">
            <span>CRT</span>
            <NativeSelect
              className="gm-control"
              onChange={(event) => update("crt", event.target.value)}
              value={draft.crt}
            >
              {["1", "2", "3", "4"].map((value) => (
                <option key={value} value={value}>
                  {value}
                </option>
              ))}
            </NativeSelect>
          </label>
          <label className="gm-form-field">
            <span>UF</span>
            <Input
              className="gm-control"
              maxLength={2}
              onChange={(event) => update("stateCode", event.target.value.toUpperCase())}
              pattern="[A-Z]{2}"
              required
              value={draft.stateCode}
            />
          </label>
          <label className="gm-form-field">
            <span>Código do município</span>
            <Input
              className="gm-control"
              inputMode="numeric"
              maxLength={7}
              onChange={(event) => update("cityCode", event.target.value)}
              pattern="\d{7}"
              required
              value={draft.cityCode}
            />
          </label>
          <label className="gm-form-field">
            <span>Tipo de emissão</span>
            <NativeSelect
              className="gm-control"
              onChange={(event) => {
                const environment = event.target.value as FiscalProfile["environment"];
                if (
                  environment === "production" &&
                  !window.confirm(
                    "Mudar para produção? As próximas notas emitidas terão validade fiscal.",
                  )
                ) {
                  event.target.value = draft.environment;
                  return;
                }
                update("environment", environment);
              }}
              value={draft.environment}
            >
              <option value="homologation">Testes — sem validade fiscal</option>
              <option value="production">Produção — com validade fiscal</option>
            </NativeSelect>
          </label>
        </div>
        {draft.environment === "production" && (
          <p className="fiscal-preventive-alert" role="status">
            <Icon name="alert-circle" size={16} />
            Em produção, as notas emitidas possuem validade fiscal. Confira os dados antes de
            salvar.
          </p>
        )}
        <details className="gm-disclosure">
          <summary>Inscrições e séries</summary>
          <div className="gm-disclosure__content gm-form-grid fiscal-profile-grid">
            <label className="gm-form-field">
              <span>Inscrição municipal</span>
              <Input
                className="gm-control"
                maxLength={30}
                onChange={(event) => update("municipalRegistration", event.target.value)}
                value={draft.municipalRegistration ?? ""}
              />
            </label>
            <label className="gm-form-field">
              <span>CNAE</span>
              <Input
                className="gm-control"
                inputMode="numeric"
                maxLength={7}
                onChange={(event) => update("cnae", event.target.value)}
                pattern="\d{7}"
                value={draft.cnae ?? ""}
              />
            </label>
            <label className="gm-form-field">
              <span>Série NFC-e</span>
              <Input
                className="gm-control"
                maxLength={20}
                onChange={(event) =>
                  setDraft((current) =>
                    current
                      ? { ...current, series: { ...current.series, nfce: event.target.value } }
                      : current,
                  )
                }
                value={draft.series.nfce}
              />
            </label>
          </div>
        </details>
        {feedback && (
          <p aria-live="polite" className="fiscal-form-feedback">
            {feedback}
          </p>
        )}
        <Button disabled={busy} type="submit">
          {!busy && <Icon name="check" size={16} />}
          {busy ? "Salvando…" : "Salvar dados fiscais"}
        </Button>
      </form>
    </Card>
  );
}

function FocusOnboarding({
  companyDefaults,
  onActivated,
  profile,
  provider,
  scope,
}: {
  companyDefaults: { tradeName: string; city: string };
  onActivated: () => void;
  profile: FiscalProfile | null;
  provider: FiscalDashboard["provider"];
  scope: ManagementScope;
}) {
  const [certificateBase64, setCertificateBase64] = useState("");
  const [certificateName, setCertificateName] = useState("");
  const [busy, setBusy] = useState<"validate" | "activate" | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [editing, setEditing] = useState(!provider.registered);
  const [step, setStep] = useState<1 | 2 | 3>(1);

  function validateStep(form: HTMLFormElement | null, selector: string) {
    const controls = Array.from(
      form?.querySelectorAll<HTMLInputElement>(`${selector} input`) ?? [],
    );
    const invalid = controls.find((control) => !control.checkValidity());
    if (!invalid) return true;
    invalid.reportValidity();
    return false;
  }

  function reviewRegistration(form: HTMLFormElement | null) {
    if (!validateStep(form, '[data-onboarding-step="certificate"]')) return;
    if (!certificateBase64) {
      setFeedback("Selecione o certificado A1 em formato PFX ou P12.");
      return;
    }
    setFeedback(null);
    setStep(3);
  }

  async function certificateChanged(file: File | undefined) {
    setFeedback(null);
    setCertificateBase64("");
    setCertificateName("");
    if (!file) return;
    if (file.size > 8 * 1024 * 1024) {
      setFeedback("O certificado deve ter no máximo 8 MB.");
      return;
    }
    try {
      setCertificateBase64(await fileBase64(file));
      setCertificateName(file.name);
    } catch {
      setFeedback("Não foi possível ler o certificado selecionado.");
    }
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formElement = event.currentTarget;
    const submitter = (event.nativeEvent as SubmitEvent).submitter as HTMLButtonElement | null;
    const action = submitter?.value === "validate" ? "validate" : "activate";
    if (!profile) return;
    if (!certificateBase64) {
      setFeedback("Selecione o certificado A1 em formato PFX ou P12.");
      setStep(2);
      return;
    }
    const form = new FormData(formElement);
    const optional = (name: string) => String(form.get(name) ?? "").trim() || undefined;
    const body: FocusCompanyOnboardingBody = {
      tradeName: String(form.get("tradeName") ?? "").trim(),
      stateRegistration: String(form.get("stateRegistration") ?? "").trim(),
      email: String(form.get("email") ?? "").trim(),
      phone: String(form.get("phone") ?? "").replace(/\D/g, ""),
      street: String(form.get("street") ?? "").trim(),
      number: Number(form.get("number")),
      complement: optional("complement"),
      district: String(form.get("district") ?? "").trim(),
      city: String(form.get("city") ?? "").trim(),
      postalCode: String(form.get("postalCode") ?? "").replace(/\D/g, ""),
      accountantDocument: optional("accountantDocument")?.replace(/\D/g, ""),
      certificateBase64,
      certificatePassword: String(form.get("certificatePassword") ?? ""),
      enableNfce: true,
      enableNfe: false,
      enableNfse: false,
      cscProduction: optional("cscProduction"),
      cscProductionId: optional("cscProductionId"),
      cscHomologation: optional("cscHomologation"),
      cscHomologationId: optional("cscHomologationId"),
    };
    setBusy(action);
    setFeedback(null);
    try {
      if (action === "validate") {
        await api.fiscal.validateProvider(scope.organizationId, scope.unitId, body);
        setFeedback("Dados e certificado verificados. A empresa está pronta para ser ativada.");
      } else {
        await api.fiscal.activateProvider(scope.organizationId, scope.unitId, body);
        setFeedback("Emissão fiscal ativada para esta empresa.");
        setCertificateBase64("");
        setCertificateName("");
        setEditing(false);
        setStep(1);
        formElement.reset();
        onActivated();
      }
    } catch (error) {
      setFeedback(customerFiscalError(error, "Não foi possível concluir o cadastro fiscal."));
    } finally {
      setBusy(null);
    }
  }

  return (
    <Card className="fiscal-section-card fiscal-onboarding" id="fiscal-provider-onboarding">
      <SectionHeading
        badge={providerLabel(provider.status)}
        eyebrow="Cadastro fiscal"
        title="Dados fiscais da empresa"
        tone={fiscalTone(provider.status)}
      />
      {!profile ? (
        <EmptyState
          description="A unidade precisa estar vinculada a uma empresa antes da ativação fiscal."
          icon={<Icon name="alert-circle" />}
          title="Dados tributários necessários"
        />
      ) : provider.registered && !editing ? (
        <div className="fiscal-connected-provider">
          <div>
            <strong>Emissão fiscal ativada</strong>
            <span>
              {provider.environments.homologation
                ? "Ambiente de testes pronto"
                : "Ambiente de testes pendente"}
              {" · "}
              {provider.environments.production ? "Produção pronta" : "Produção pendente"}
            </span>
            {provider.certificateValidUntil && (
              <small>Certificado válido até {dateLabel(provider.certificateValidUntil)}</small>
            )}
          </div>
          <Button onClick={() => setEditing(true)} size="sm" variant="secondary">
            Atualizar dados ou certificado
          </Button>
        </div>
      ) : !provider.environments.homologation && provider.status === "platform_not_configured" ? (
        <EmptyState
          description="A ativação depende de uma configuração do GiroMesa. Entre em contato com o suporte para continuar."
          icon={<Icon name="alert-circle" />}
          title="Serviço de emissão indisponível"
        />
      ) : (
        <form className="gm-form-stack" onSubmit={submit}>
          <p className="fiscal-security-note">
            O certificado é utilizado para ativar a emissão desta empresa. A senha não é armazenada
            pelo GiroMesa.
          </p>
          <ol aria-label="Etapas da ativação fiscal" className="fiscal-onboarding-progress">
            {(["Empresa", "Certificado", "Revisão"] as const).map((label, index) => {
              const itemStep = (index + 1) as 1 | 2 | 3;
              return (
                <li aria-current={step === itemStep ? "step" : undefined} key={label}>
                  <span>{itemStep}</span>
                  {label}
                </li>
              );
            })}
          </ol>
          <div data-onboarding-step="company" hidden={step !== 1}>
            <div className="gm-form-grid fiscal-onboarding-grid">
              <label className="gm-form-field">
                <span>Nome fantasia</span>
                <Input
                  defaultValue={companyDefaults.tradeName}
                  maxLength={120}
                  name="tradeName"
                  required
                />
              </label>
              <label className="gm-form-field">
                <span>Inscrição estadual</span>
                <Input maxLength={30} name="stateRegistration" required />
              </label>
              <label className="gm-form-field">
                <span>E-mail fiscal</span>
                <Input maxLength={160} name="email" required type="email" />
              </label>
              <label className="gm-form-field">
                <span>Telefone</span>
                <Input inputMode="tel" maxLength={15} name="phone" required />
              </label>
              <label className="gm-form-field fiscal-field--wide">
                <span>Logradouro</span>
                <Input maxLength={160} name="street" required />
              </label>
              <label className="gm-form-field">
                <span>Número</span>
                <Input min={1} name="number" required type="number" />
              </label>
              <label className="gm-form-field">
                <span>Complemento</span>
                <Input maxLength={120} name="complement" />
              </label>
              <label className="gm-form-field">
                <span>Bairro</span>
                <Input maxLength={120} name="district" required />
              </label>
              <label className="gm-form-field">
                <span>Município</span>
                <Input defaultValue={companyDefaults.city} maxLength={120} name="city" required />
              </label>
              <label className="gm-form-field">
                <span>CEP</span>
                <Input inputMode="numeric" maxLength={9} name="postalCode" required />
              </label>
              <label className="gm-form-field">
                <span>CPF/CNPJ da contabilidade</span>
                <Input inputMode="numeric" maxLength={18} name="accountantDocument" />
              </label>
            </div>
            <div className="fiscal-form-actions">
              <Button
                onClick={(event) => {
                  if (validateStep(event.currentTarget.form, '[data-onboarding-step="company"]')) {
                    setStep(2);
                  }
                }}
                type="button"
              >
                Continuar para certificado
              </Button>
            </div>
          </div>
          <div data-onboarding-step="certificate" hidden={step !== 2}>
            <div className="gm-form-grid fiscal-onboarding-grid">
              <label className="gm-form-field fiscal-field--wide">
                <span>Certificado A1 (.pfx ou .p12)</span>
                <Input
                  accept=".pfx,.p12,application/x-pkcs12"
                  onChange={(event) => void certificateChanged(event.target.files?.[0])}
                  required={!certificateBase64}
                  type="file"
                />
                {certificateName && <small>Arquivo pronto: {certificateName}</small>}
              </label>
              <label className="gm-form-field">
                <span>Senha do certificado</span>
                <Input
                  autoComplete="new-password"
                  maxLength={256}
                  name="certificatePassword"
                  required
                  type="password"
                />
              </label>
            </div>
            <div className="fiscal-document-types" role="note">
              <strong>Documento emitido: NFC-e (modelo 65)</strong>
              <span>As vendas finalizadas no GiroMesa serão enviadas automaticamente.</span>
            </div>
            <details className="gm-disclosure" open={!provider.registered}>
              <summary>CSC da NFC-e</summary>
              <div className="gm-disclosure__content gm-form-grid fiscal-onboarding-grid">
                <label className="gm-form-field">
                  <span>CSC de homologação</span>
                  <Input maxLength={128} name="cscHomologation" />
                </label>
                <label className="gm-form-field">
                  <span>ID do CSC de homologação</span>
                  <Input inputMode="numeric" maxLength={6} name="cscHomologationId" />
                </label>
                <label className="gm-form-field">
                  <span>CSC de produção</span>
                  <Input maxLength={128} name="cscProduction" />
                </label>
                <label className="gm-form-field">
                  <span>ID do CSC de produção</span>
                  <Input inputMode="numeric" maxLength={6} name="cscProductionId" />
                </label>
              </div>
            </details>
            <div className="fiscal-form-actions">
              <Button onClick={() => setStep(1)} type="button" variant="ghost">
                Voltar
              </Button>
              <Button
                onClick={(event) => reviewRegistration(event.currentTarget.form)}
                type="button"
              >
                Revisar ativação
              </Button>
            </div>
          </div>
          {feedback && (
            <p aria-live="polite" className="fiscal-form-feedback">
              {feedback}
            </p>
          )}
          <div className="fiscal-onboarding-review" hidden={step !== 3}>
            <div>
              <Icon name="check" size={18} />
              <div>
                <strong>Dados prontos para verificação</strong>
                <p>
                  Empresa preenchida · certificado {certificateName || "selecionado"} ·{" "}
                  {profile.environment === "production" ? "produção" : "ambiente de testes"}
                </p>
              </div>
            </div>
            <div className="fiscal-form-actions">
              <Button onClick={() => setStep(2)} type="button" variant="ghost">
                Voltar
              </Button>
              {provider.registered && (
                <Button onClick={() => setEditing(false)} type="button" variant="ghost">
                  Cancelar
                </Button>
              )}
              <Button
                disabled={busy !== null}
                name="action"
                type="submit"
                value="validate"
                variant="secondary"
              >
                {busy === "validate" ? "Verificando…" : "Verificar dados"}
              </Button>
              <Button disabled={busy !== null} name="action" type="submit" value="activate">
                <Icon name="check" size={16} />
                {busy === "activate"
                  ? "Ativando…"
                  : provider.registered
                    ? "Atualizar dados fiscais"
                    : "Ativar emissão fiscal"}
              </Button>
            </div>
          </div>
        </form>
      )}
    </Card>
  );
}

function TaxRevisionForm({
  activeProductIds,
  canEdit,
  enabled,
  onSaved,
  products,
  scope,
}: {
  activeProductIds: Set<string>;
  canEdit: boolean;
  enabled: boolean;
  onSaved: () => void;
  products: Array<{ id: string; name: string; categoryId: string; categoryName: string }>;
  scope: ManagementScope;
}) {
  const pendingProducts = products.filter((product) => !activeProductIds.has(product.id));
  const [productIds, setProductIds] = useState<string[]>([]);
  const [productSearch, setProductSearch] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [ncm, setNcm] = useState("");
  const [cfop, setCfop] = useState("");
  const [origin, setOrigin] = useState("");
  const [csosn, setCsosn] = useState("");
  const [cstIcms, setCstIcms] = useState("");
  const [cstPis, setCstPis] = useState("");
  const [cstCofins, setCstCofins] = useState("");
  const [cstIbsCbs, setCstIbsCbs] = useState("");
  const [cClassTrib, setCClassTrib] = useState("");
  const [effectiveFrom, setEffectiveFrom] = useState(todayInput);
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);
  const categories = Array.from(
    new Map(pendingProducts.map((product) => [product.categoryId, product.categoryName])),
  ).sort((left, right) => left[1].localeCompare(right[1], "pt-BR"));
  const visibleProducts = pendingProducts.filter(
    (product) =>
      (!categoryId || product.categoryId === categoryId) &&
      (!productSearch ||
        product.name.toLocaleLowerCase("pt-BR").includes(productSearch.toLocaleLowerCase("pt-BR"))),
  );

  function exportTemplate() {
    downloadTextFile(
      "classificacao-fiscal.csv",
      fiscalTaxCsvTemplate(pendingProducts, effectiveFrom),
    );
  }

  async function importCsv(file: File | undefined) {
    if (!file) return;
    if (file.size > 2 * 1024 * 1024) {
      setFeedback("O CSV deve ter no máximo 2 MB.");
      return;
    }
    setBusy(true);
    setFeedback(null);
    try {
      const rows = parseFiscalTaxCsv(
        await file.text(),
        new Set(pendingProducts.map((item) => item.id)),
      );
      await api.fiscal.importTaxRevisions(scope.organizationId, scope.unitId, { rows });
      setFeedback(`${rows.length} classificação(ões) importada(s).`);
      onSaved();
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : "Não foi possível importar o CSV.");
    } finally {
      setBusy(false);
    }
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (
      !enabled ||
      productIds.length === 0 ||
      !/^\d{8}$/.test(ncm) ||
      !/^\d{4}$/.test(cfop) ||
      !/^[0-8]$/.test(origin) ||
      (!/^\d{3}$/.test(csosn) && !/^\d{2,3}$/.test(cstIcms)) ||
      !/^\d{2}$/.test(cstPis) ||
      !/^\d{2}$/.test(cstCofins) ||
      Boolean(cstIbsCbs) !== Boolean(cClassTrib) ||
      (cstIbsCbs !== "" && !/^\d{3}$/.test(cstIbsCbs)) ||
      (cClassTrib !== "" && !/^\d{6}$/.test(cClassTrib))
    ) {
      setFeedback(
        "Preencha os códigos nos formatos indicados. CST IBS/CBS e cClassTrib devem ser informados em conjunto.",
      );
      return;
    }
    setBusy(true);
    setFeedback(null);
    try {
      await api.fiscal.createTaxRevisionsBulk(scope.organizationId, scope.unitId, {
        productIds,
        status: "active",
        effectiveFrom,
        classification: {
          ncm,
          cfop,
          origin: Number(origin),
          ...(csosn ? { csosn } : {}),
          ...(cstIcms ? { cstIcms } : {}),
          cstPis,
          cstCofins,
          ...(cstIbsCbs ? { cstIbsCbs } : {}),
          ...(cClassTrib ? { cClassTrib } : {}),
        },
      });
      setProductIds([]);
      setNcm("");
      setCfop("");
      setOrigin("");
      setCsosn("");
      setCstIcms("");
      setCstPis("");
      setCstCofins("");
      setCstIbsCbs("");
      setCClassTrib("");
      setFeedback(`${productIds.length} classificação(ões) fiscal(is) ativada(s).`);
      onSaved();
    } catch (error) {
      setFeedback(customerFiscalError(error, "Não foi possível salvar a classificação."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section
      aria-labelledby="tax-revision-title"
      className="tax-revision-section"
      id="fiscal-classification"
    >
      <div>
        <p className="eyebrow">Produtos pendentes</p>
        <h3 id="tax-revision-title">Classificação dos produtos</h3>
        <p className="tax-revision-note">
          Confirme os códigos com o contador antes de ativar. O GiroMesa não sugere enquadramento
          tributário.
        </p>
        <details className="gm-disclosure fiscal-tax-help">
          <summary>Entenda os campos fiscais</summary>
          <div className="gm-disclosure__content">
            <p>
              NCM identifica o produto, CFOP descreve a operação e a origem informa onde a
              mercadoria foi produzida. CSOSN é usado no Simples Nacional; CST ICMS, nos demais
              regimes. CST IBS/CBS e cClassTrib são códigos da reforma tributária e devem ser
              confirmados em conjunto com o contador.
            </p>
          </div>
        </details>
      </div>
      {pendingProducts.length ? (
        canEdit ? (
          <form className="gm-form-stack" onSubmit={submit}>
            <div className="fiscal-classification-toolbar">
              <span>{productIds.length} produto(s) selecionado(s)</span>
              <div>
                <Button onClick={exportTemplate} size="sm" type="button" variant="secondary">
                  Exportar modelo CSV
                </Button>
                <Button
                  disabled={!enabled}
                  onClick={() =>
                    setProductIds(
                      productIds.length
                        ? []
                        : visibleProducts.slice(0, 100).map((product) => product.id),
                    )
                  }
                  size="sm"
                  type="button"
                  variant="ghost"
                >
                  {productIds.length ? "Limpar seleção" : "Selecionar exibidos"}
                </Button>
              </div>
            </div>
            <div className="fiscal-product-filters">
              <Input
                aria-label="Buscar produto"
                onChange={(event) => setProductSearch(event.target.value)}
                placeholder="Buscar produto"
                type="search"
                value={productSearch}
              />
              <NativeSelect
                aria-label="Filtrar produtos por categoria"
                onChange={(event) => setCategoryId(event.target.value)}
                value={categoryId}
              >
                <option value="">Todas as categorias</option>
                {categories.map(([id, name]) => (
                  <option key={id} value={id}>
                    {name}
                  </option>
                ))}
              </NativeSelect>
              <label className="fiscal-csv-import">
                <span>Importar CSV preenchido</span>
                <Input
                  accept=".csv,text/csv"
                  disabled={!enabled || busy}
                  onChange={(event) => {
                    void importCsv(event.target.files?.[0]);
                    event.target.value = "";
                  }}
                  type="file"
                />
              </label>
            </div>
            <div className="gm-form-grid fiscal-profile-grid">
              <fieldset className="fiscal-product-picker" disabled={!enabled}>
                <legend>Produtos</legend>
                <div className="fiscal-product-picker__list">
                  {visibleProducts.slice(0, 100).map((product) => (
                    <label key={product.id}>
                      <input
                        checked={productIds.includes(product.id)}
                        onChange={(event) =>
                          setProductIds((current) =>
                            event.target.checked
                              ? [...current, product.id]
                              : current.filter((id) => id !== product.id),
                          )
                        }
                        type="checkbox"
                      />
                      <span>{product.name}</span>
                      <small>{product.categoryName}</small>
                    </label>
                  ))}
                  {!visibleProducts.length && <span>Nenhum produto encontrado.</span>}
                </div>
                {visibleProducts.length > 100 && (
                  <small>
                    Refine a busca para ver os demais {visibleProducts.length - 100} produtos.
                  </small>
                )}
              </fieldset>
              <label className="gm-form-field">
                <span>NCM (8 dígitos)</span>
                <Input
                  className="gm-control"
                  disabled={!enabled}
                  inputMode="numeric"
                  maxLength={8}
                  onChange={(event) => setNcm(event.target.value)}
                  pattern="\d{8}"
                  required
                  value={ncm}
                />
              </label>
              <label className="gm-form-field">
                <span>CFOP (4 dígitos)</span>
                <Input
                  className="gm-control"
                  disabled={!enabled}
                  inputMode="numeric"
                  maxLength={4}
                  onChange={(event) => setCfop(event.target.value)}
                  pattern="\d{4}"
                  required
                  value={cfop}
                />
              </label>
              <label className="gm-form-field">
                <span>Origem</span>
                <NativeSelect
                  className="gm-control"
                  disabled={!enabled}
                  onChange={(event) => setOrigin(event.target.value)}
                  required
                  value={origin}
                >
                  <option value="">Selecione de 0 a 8</option>
                  {fiscalOrigins.map((value) => (
                    <option key={value} value={value}>
                      {value}
                    </option>
                  ))}
                </NativeSelect>
              </label>
              <label className="gm-form-field">
                <span>CSOSN (opcional)</span>
                <Input
                  className="gm-control"
                  disabled={!enabled}
                  inputMode="numeric"
                  maxLength={3}
                  onChange={(event) => setCsosn(event.target.value)}
                  pattern="\d{3}"
                  value={csosn}
                />
              </label>
              <label className="gm-form-field">
                <span>CST ICMS (opcional)</span>
                <Input
                  className="gm-control"
                  disabled={!enabled}
                  maxLength={3}
                  minLength={2}
                  onChange={(event) => setCstIcms(event.target.value)}
                  value={cstIcms}
                />
              </label>
              <label className="gm-form-field">
                <span>CST PIS (2 dígitos)</span>
                <Input
                  className="gm-control"
                  disabled={!enabled}
                  inputMode="numeric"
                  maxLength={2}
                  onChange={(event) => setCstPis(event.target.value)}
                  pattern="\d{2}"
                  required
                  value={cstPis}
                />
              </label>
              <label className="gm-form-field">
                <span>CST COFINS (2 dígitos)</span>
                <Input
                  className="gm-control"
                  disabled={!enabled}
                  inputMode="numeric"
                  maxLength={2}
                  onChange={(event) => setCstCofins(event.target.value)}
                  pattern="\d{2}"
                  required
                  value={cstCofins}
                />
              </label>
              <label className="gm-form-field">
                <span>CST IBS/CBS (opcional, 3 dígitos)</span>
                <Input
                  className="gm-control"
                  disabled={!enabled}
                  inputMode="numeric"
                  maxLength={3}
                  onChange={(event) => setCstIbsCbs(event.target.value)}
                  pattern="\d{3}"
                  value={cstIbsCbs}
                />
              </label>
              <label className="gm-form-field">
                <span>cClassTrib (opcional, 6 dígitos)</span>
                <Input
                  className="gm-control"
                  disabled={!enabled}
                  inputMode="numeric"
                  maxLength={6}
                  onChange={(event) => setCClassTrib(event.target.value)}
                  pattern="\d{6}"
                  value={cClassTrib}
                />
              </label>
              <label className="gm-form-field">
                <span>Vigência inicial</span>
                <Input
                  className="gm-control"
                  disabled={!enabled}
                  onChange={(event) => setEffectiveFrom(event.target.value)}
                  required
                  type="date"
                  value={effectiveFrom}
                />
              </label>
            </div>
            {!enabled && (
              <p className="fiscal-form-feedback">
                Salve UF e código do município no perfil fiscal antes de classificar produtos.
              </p>
            )}
            {feedback && (
              <p aria-live="polite" className="fiscal-form-feedback">
                {feedback}
              </p>
            )}
            <Button disabled={!enabled || busy} type="submit">
              {!busy && <Icon name="plus" size={16} />}
              {busy ? "Salvando…" : "Salvar classificação"}
            </Button>
          </form>
        ) : (
          <div className="fiscal-readonly-pending">
            <p>
              {pendingProducts.length} produto(s) aguardam classificação fiscal pelo proprietário.
            </p>
            <div className="fiscal-product-picker__list">
              {pendingProducts.slice(0, 20).map((product) => (
                <span key={product.id}>{product.name}</span>
              ))}
            </div>
          </div>
        )
      ) : (
        <EmptyState
          description="Todos os produtos ativos possuem revisão fiscal ativa."
          icon={<Icon name="check" />}
          title="Classificações em dia"
        />
      )}
    </section>
  );
}

export function RealAccountantPage({
  audience,
  scope,
}: {
  audience: "accountant" | "establishment";
  scope: ManagementScope;
}) {
  const [competence, setCompetence] = useState(currentCompetence);
  const [requestFilter, setRequestFilter] = useState<AccountantRequestFilter>(
    () =>
      accountantRequestViewFromHash(typeof window === "undefined" ? "" : window.location.hash)
        .filter,
  );
  const [requestPage, setRequestPage] = useState(
    () =>
      accountantRequestViewFromHash(typeof window === "undefined" ? "" : window.location.hash).page,
  );
  const [targetAudienceOnly, setTargetAudienceOnly] = useState(
    () =>
      accountantRequestViewFromHash(typeof window === "undefined" ? "" : window.location.hash)
        .targetAudience === audience,
  );
  const [refresh, setRefresh] = useState(0);
  const [busy, setBusy] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<{
    tone: "success" | "danger";
    text: string;
  } | null>(null);
  const [title, setTitle] = useState("");
  const [detail, setDetail] = useState("");
  const [dueAt, setDueAt] = useState("");
  const [resolvingId, setResolvingId] = useState<string | null>(null);
  const [resolution, setResolution] = useState("");
  useEffect(() => {
    const restoreRequestView = () => {
      const view = accountantRequestViewFromHash(window.location.hash);
      setRequestFilter(view.filter);
      setRequestPage(view.page);
      setTargetAudienceOnly(view.targetAudience === audience);
    };
    window.addEventListener("hashchange", restoreRequestView);
    return () => window.removeEventListener("hashchange", restoreRequestView);
  }, [audience]);
  const loader = useCallback(async () => {
    const [periods, accountingPackage, requests] = await Promise.all([
      api.fiscal.periods(scope.organizationId, scope.unitId),
      api.fiscal
        .accountingPackage(scope.organizationId, scope.unitId, competence)
        .catch((error: unknown) => {
          if (error instanceof ApiClientError && error.status === 404) return null;
          throw error;
        }),
      api.fiscal.accountantRequests(scope.organizationId, scope.unitId, {
        ...(requestFilter === "resolved"
          ? { status: "resolved" as const }
          : requestFilter === "open" || requestFilter === "overdue"
            ? { status: "open" as const }
            : {}),
        ...(requestFilter === "overdue" ? { overdue: true } : {}),
        ...(targetAudienceOnly ? { targetAudience: audience } : {}),
        page: requestPage,
        pageSize: 25,
      }),
    ]);
    return { periods, accountingPackage, requests };
  }, [
    audience,
    competence,
    requestFilter,
    requestPage,
    scope.organizationId,
    scope.unitId,
    targetAudienceOnly,
  ]);
  const remote = useRemote(
    { ...scope, refreshToken: (scope.refreshToken ?? 0) + refresh },
    loader,
    parseAccountantWorkspace,
  );

  function changeRequestView(
    filter: AccountantRequestFilter,
    page: number,
    audienceOnly = targetAudienceOnly,
  ) {
    setRequestFilter(filter);
    setRequestPage(page);
    setTargetAudienceOnly(audienceOnly);
    window.history.replaceState(
      null,
      "",
      accountantRequestHref(filter, page, audienceOnly ? audience : undefined),
    );
    setRefresh((value) => value + 1);
  }

  async function submitRequest(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!title.trim() || !detail.trim()) {
      setFeedback({ tone: "danger", text: "Informe assunto e detalhes da solicitação." });
      return;
    }
    setBusy("create");
    setFeedback(null);
    try {
      await api.fiscal.createAccountantRequest(scope.organizationId, scope.unitId, {
        competence,
        title: title.trim(),
        description: detail.trim(),
        ...(dueAt ? { dueDate: dueAt } : {}),
      });
      setTitle("");
      setDetail("");
      setDueAt("");
      setFeedback({ tone: "success", text: "Solicitação registrada." });
      setRefresh((value) => value + 1);
    } catch (error) {
      setFeedback({
        tone: "danger",
        text: customerFiscalError(error, "Não foi possível registrar a solicitação."),
      });
    } finally {
      setBusy(null);
    }
  }

  async function downloadPackage() {
    setBusy("download");
    setFeedback(null);
    try {
      saveDownloadedFile(
        await api.fiscal.accountingPackageContent(scope.organizationId, scope.unitId, competence),
      );
    } catch (error) {
      setFeedback({
        tone: "danger",
        text: customerFiscalError(error, "Não foi possível baixar o pacote contábil."),
      });
    } finally {
      setBusy(null);
    }
  }

  async function resolveRequest(event: FormEvent<HTMLFormElement>, requestId: string) {
    event.preventDefault();
    const currentRequest =
      remote.state.status === "ready"
        ? remote.state.data.requests.find((request) => request.id === requestId)
        : null;
    if (!currentRequest || !canResolveAccountantRequest(currentRequest, audience)) {
      setFeedback({ tone: "danger", text: "Esta solicitação aguarda resposta da outra parte." });
      return;
    }
    const answer = resolution.trim();
    if (answer.length < 3) {
      setFeedback({ tone: "danger", text: "Informe uma resposta com pelo menos 3 caracteres." });
      return;
    }
    setBusy(`resolve:${requestId}`);
    setFeedback(null);
    try {
      await api.fiscal.resolveAccountantRequest(scope.organizationId, scope.unitId, requestId, {
        resolution: answer,
      });
      remote.update((current) => ({
        ...current,
        requests: current.requests.map((request) =>
          request.id === requestId
            ? { ...request, status: "resolved", resolution: answer }
            : request,
        ),
      }));
      setResolution("");
      setResolvingId(null);
      setFeedback({ tone: "success", text: "Resposta registrada e solicitação resolvida." });
      setRefresh((value) => value + 1);
    } catch (error) {
      setFeedback({
        tone: "danger",
        text: customerFiscalError(error, "Não foi possível resolver a solicitação."),
      });
    } finally {
      setBusy(null);
    }
  }

  async function uploadAttachment(requestId: string, file: File, input: HTMLInputElement) {
    const validation = validateAccountantAttachment(file);
    if (!validation.valid) {
      setFeedback({ tone: "danger", text: validation.message });
      input.value = "";
      return;
    }
    setBusy(`attachment:${requestId}`);
    setFeedback(null);
    try {
      await api.fiscal.createAttachment(scope.organizationId, scope.unitId, requestId, {
        fileName: file.name,
        contentType: validation.contentType,
        contentBase64: await fileContentBase64(file),
      });
      input.value = "";
      setFeedback({ tone: "success", text: "Anexo enviado com segurança." });
      setRefresh((value) => value + 1);
    } catch (error) {
      setFeedback({
        tone: "danger",
        text: customerFiscalError(error, "Não foi possível enviar o anexo."),
      });
    } finally {
      setBusy(null);
    }
  }

  async function downloadAttachment(requestId: string, attachmentId: string) {
    setBusy(`attachment:${attachmentId}:download`);
    setFeedback(null);
    try {
      saveDownloadedFile(
        await api.fiscal.downloadAttachment(
          scope.organizationId,
          scope.unitId,
          requestId,
          attachmentId,
        ),
      );
    } catch (error) {
      setFeedback({
        tone: "danger",
        text: customerFiscalError(error, "Não foi possível baixar o anexo."),
      });
    } finally {
      setBusy(null);
    }
  }

  return (
    <RemoteGate remote={remote}>
      {(data) => (
        <div className="fiscal-page accountant-page">
          <Card className="accountant-toolbar min-[481px]:flex-row">
            <div className="accountant-toolbar__copy">
              <p className="eyebrow">Escopo contábil</p>
              <h2>Competência</h2>
              <p className="fiscal-muted">
                O pacote segue o período selecionado. As solicitações reúnem todas as competências.
              </p>
            </div>
            <label>
              <span>Período</span>
              <NativeSelect
                className="gm-control gm-control--compact gm-control--strong"
                onChange={(event) => {
                  setCompetence(event.target.value);
                  setRefresh((value) => value + 1);
                }}
                value={competence}
              >
                {data.periods.length ? (
                  data.periods.map((period) => (
                    <option key={period.competence} value={period.competence}>
                      {competenceLabel(period.competence)}
                    </option>
                  ))
                ) : (
                  <option value={competence}>{competenceLabel(competence)}</option>
                )}
              </NativeSelect>
            </label>
          </Card>

          {(remote.updating || remote.refreshError || feedback) && (
            <div
              aria-live="polite"
              className={`accountant-status${feedback?.tone === "danger" || remote.refreshError ? " accountant-status--danger" : ""}`}
              role={feedback?.tone === "danger" || remote.refreshError ? "alert" : "status"}
            >
              <span>
                {remote.updating
                  ? "Atualizando dados confirmados…"
                  : remote.refreshError
                    ? "Não foi possível atualizar. Os últimos dados confirmados continuam visíveis."
                    : feedback?.text}
              </span>
              {remote.refreshError && (
                <Button disabled={remote.updating} onClick={remote.retry} size="sm" variant="ghost">
                  Tentar novamente
                </Button>
              )}
            </div>
          )}

          <div className="fiscal-columns">
            <Card className="fiscal-section-card accountant-panel accountant-package">
              <SectionHeading eyebrow="Entrega mensal" title="Pacote contábil" />
              {data.accountingPackage ? (
                <>
                  <div className="accountant-package__summary">
                    <div>
                      <strong>{competenceLabel(data.accountingPackage.competence)}</strong>
                      <span>
                        {data.accountingPackage.generatedAt
                          ? `Gerado em ${dateLabel(data.accountingPackage.generatedAt)}`
                          : "Ainda não gerado"}
                      </span>
                    </div>
                    <Badge tone={fiscalTone(data.accountingPackage.status)}>
                      {packageLabel(data.accountingPackage.status)}
                    </Badge>
                  </div>
                  <ul className="accountant-file-list">
                    {data.accountingPackage.files.map((file) => (
                      <li key={file.name}>
                        <span>{file.name}</span>
                        <small>Incluído no pacote</small>
                      </li>
                    ))}
                  </ul>
                  {data.accountingPackage.status === "ready" ? (
                    <Button disabled={busy !== null} onClick={() => void downloadPackage()}>
                      <Icon name="download" size={16} />
                      {busy === "download" ? "Preparando…" : "Baixar pacote ZIP"}
                    </Button>
                  ) : (
                    <p className="fiscal-muted">
                      O download será liberado somente após o fechamento e a geração confirmada pelo
                      servidor.
                    </p>
                  )}
                </>
              ) : (
                <EmptyState
                  description="A unidade ainda não fechou este período. O download será liberado após a confirmação."
                  icon={<Icon name="download" />}
                  title="Pacote indisponível"
                />
              )}
            </Card>

            <Card className="fiscal-section-card accountant-panel accountant-request-composer">
              <SectionHeading eyebrow="Comunicação" title="Nova solicitação" />
              <form className="gm-form-stack accountant-request-form" onSubmit={submitRequest}>
                <label className="gm-form-field">
                  <span>Assunto</span>
                  <Input
                    className="gm-control"
                    maxLength={120}
                    onChange={(event) => setTitle(event.target.value)}
                    required
                    value={title}
                  />
                </label>
                <label className="gm-form-field">
                  <span>Detalhes</span>
                  <Textarea
                    className="gm-control gm-control--textarea"
                    maxLength={1000}
                    onChange={(event) => setDetail(event.target.value)}
                    required
                    rows={3}
                    value={detail}
                  />
                </label>
                <label className="gm-form-field">
                  <span>Prazo desejado</span>
                  <Input
                    className="gm-control"
                    min={todayInput()}
                    onChange={(event) => setDueAt(event.target.value)}
                    type="date"
                    value={dueAt}
                  />
                </label>
                <Button disabled={busy !== null} type="submit">
                  {busy !== "create" && <Icon name="plus" size={16} />}
                  {busy === "create" ? "Enviando…" : "Registrar solicitação"}
                </Button>
              </form>
            </Card>
          </div>

          <Card className="fiscal-section-card accountant-panel accountant-requests">
            <SegmentedTabs
              active={requestFilter}
              className="accountant-request-filters"
              items={[
                { id: "all", label: "Todas" },
                { id: "open", label: "Abertas" },
                { id: "overdue", label: "Vencidas" },
                { id: "resolved", label: "Resolvidas" },
              ]}
              label="Filtrar solicitações"
              onChange={(value) => changeRequestView(value as AccountantRequestFilter, 1, false)}
            />
            {targetAudienceOnly && (
              <div className="accountant-audience-filter" role="status">
                <span>Exibindo somente solicitações que aguardam sua resposta.</span>
                <Button
                  onClick={() => changeRequestView(requestFilter, 1, false)}
                  size="sm"
                  variant="ghost"
                >
                  Ver todas
                </Button>
              </div>
            )}
            <SectionHeading
              eyebrow="Acompanhamento"
              title="Solicitações"
              badge={requestCountLabel(data.pagination?.total ?? data.requests.length)}
            />
            {data.requests.length ? (
              <div className="fiscal-list">
                {data.requests.map((request) => (
                  <article className="accountant-request-row" key={request.id}>
                    <div className="accountant-request-row__content">
                      <strong>{request.title}</strong>
                      <p>{request.detail}</p>
                      <small>
                        {competenceLabel(request.competence)} · {dateLabel(request.createdAt)}
                        {request.dueAt ? ` · prazo ${dateLabel(request.dueAt)}` : ""}
                        {request.requestedBy ? ` · por ${request.requestedBy}` : ""}
                      </small>
                      {request.resolution && (
                        <div className="accountant-request-answer">
                          <strong>Resposta</strong>
                          <p>{request.resolution}</p>
                          {(request.resolvedBy || request.resolvedAt) && (
                            <small>
                              {request.resolvedBy
                                ? `Por ${request.resolvedBy}`
                                : "Resposta registrada"}
                              {request.resolvedAt ? ` · ${dateLabel(request.resolvedAt)}` : ""}
                            </small>
                          )}
                        </div>
                      )}
                      <details className="gm-disclosure accountant-request-attachments">
                        <summary>
                          Anexos
                          {request.attachments.length ? ` (${request.attachments.length})` : ""}
                        </summary>
                        <div className="accountant-request-attachments__content">
                          {request.attachments.length ? (
                            <ul>
                              {request.attachments.map((attachment) => (
                                <li key={attachment.id}>
                                  <span>
                                    <strong>{attachment.fileName}</strong>
                                    <small>{fileSizeLabel(attachment.sizeBytes)}</small>
                                  </span>
                                  <Button
                                    disabled={busy !== null}
                                    onClick={() =>
                                      void downloadAttachment(request.id, attachment.id)
                                    }
                                    size="sm"
                                    variant="ghost"
                                  >
                                    <Icon name="download" size={14} />
                                    {busy === `attachment:${attachment.id}:download`
                                      ? "Baixando…"
                                      : "Baixar"}
                                  </Button>
                                </li>
                              ))}
                            </ul>
                          ) : (
                            <small>Nenhum arquivo anexado.</small>
                          )}
                          {request.status === "open" && (
                            <label className="gm-form-field accountant-attachment-input">
                              <span>Adicionar anexo</span>
                              <Input
                                accept=".pdf,.xml,.csv,.jpg,.jpeg,.png"
                                aria-describedby={`attachment-help-${request.id}`}
                                className="gm-control"
                                disabled={busy !== null}
                                onChange={(event) => {
                                  const file = event.currentTarget.files?.[0];
                                  if (file)
                                    void uploadAttachment(request.id, file, event.currentTarget);
                                }}
                                type="file"
                              />
                              <small id={`attachment-help-${request.id}`}>
                                PDF, XML, CSV, JPG ou PNG de até 3 MB.
                              </small>
                            </label>
                          )}
                        </div>
                      </details>
                    </div>
                    <div className="accountant-request-row__actions">
                      <Badge tone={fiscalTone(request.status)}>
                        {accountantRequestStatusLabel(request)}
                      </Badge>
                      {canResolveAccountantRequest(request, audience) && (
                        <Button
                          aria-controls={`resolve-accountant-request-${request.id}`}
                          aria-expanded={resolvingId === request.id}
                          disabled={busy !== null}
                          onClick={() => {
                            const opening = resolvingId !== request.id;
                            setResolvingId(opening ? request.id : null);
                            setResolution("");
                            setFeedback(null);
                          }}
                          size="sm"
                          variant="secondary"
                        >
                          {resolvingId === request.id
                            ? "Cancelar resposta"
                            : "Responder e resolver"}
                        </Button>
                      )}
                    </div>
                    {resolvingId === request.id &&
                      canResolveAccountantRequest(request, audience) && (
                        <form
                          className="accountant-request-resolution gm-form-stack"
                          id={`resolve-accountant-request-${request.id}`}
                          onSubmit={(event) => void resolveRequest(event, request.id)}
                        >
                          <label className="gm-form-field">
                            <span>Resposta</span>
                            <Textarea
                              autoFocus
                              className="gm-control gm-control--textarea"
                              maxLength={5000}
                              onChange={(event) => setResolution(event.target.value)}
                              required
                              rows={3}
                              value={resolution}
                            />
                          </label>
                          <Button disabled={busy !== null} type="submit">
                            {busy === `resolve:${request.id}`
                              ? "Registrando…"
                              : "Registrar resposta"}
                          </Button>
                        </form>
                      )}
                  </article>
                ))}
              </div>
            ) : (
              <EmptyState
                description={accountantEmptyDescription(requestFilter)}
                icon={<Icon name="check" />}
                title="Sem solicitações"
              />
            )}
            {data.pagination && data.pagination.total > data.pagination.pageSize && (
              <nav aria-label="Páginas de solicitações" className="accountant-pagination">
                <Button
                  disabled={data.pagination.page <= 1 || remote.updating}
                  onClick={() => {
                    changeRequestView(
                      requestFilter,
                      Math.max(1, data.pagination?.page ? data.pagination.page - 1 : 1),
                    );
                  }}
                  size="sm"
                  variant="secondary"
                >
                  Anterior
                </Button>
                <span>
                  Página {data.pagination.page} de{" "}
                  {Math.ceil(data.pagination.total / data.pagination.pageSize)}
                </span>
                <Button
                  disabled={
                    data.pagination.page * data.pagination.pageSize >= data.pagination.total ||
                    remote.updating
                  }
                  onClick={() => {
                    changeRequestView(
                      requestFilter,
                      data.pagination?.page ? data.pagination.page + 1 : 1,
                    );
                  }}
                  size="sm"
                  variant="secondary"
                >
                  Próxima
                </Button>
              </nav>
            )}
          </Card>
        </div>
      )}
    </RemoteGate>
  );
}

function Metric({ label, value, tone }: { label: string; value: number | string; tone: string }) {
  return (
    <Card className={`fiscal-metric fiscal-metric--${tone}`}>
      <span>{label}</span>
      <strong>{value}</strong>
    </Card>
  );
}

function SectionHeading({
  eyebrow,
  title,
  badge,
  tone = "neutral",
}: {
  eyebrow: string;
  title: string;
  badge?: string;
  tone?: "neutral" | "info" | "success" | "warning" | "danger";
}) {
  return (
    <div className="fiscal-section-heading">
      <div>
        <p className="eyebrow">{eyebrow}</p>
        <h2>{title}</h2>
      </div>
      {badge && <Badge tone={tone}>{badge}</Badge>}
    </div>
  );
}

function currentCompetence() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

function competenceLabel(value: string) {
  const [year, month] = value.split("-").map(Number);
  return new Intl.DateTimeFormat("pt-BR", { month: "long", year: "numeric" }).format(
    new Date(year ?? 0, (month ?? 1) - 1, 1),
  );
}

function providerLabel(value: string) {
  return (
    (
      {
        platform_not_configured: "Serviço indisponível",
        profile_required: "Cadastro incompleto",
        company_required: "Ativação pendente",
        credentials_missing: "Atenção necessária",
        ready: "Pronto para emitir",
        error: "Atenção necessária",
      } as Record<string, string>
    )[value] ?? value
  );
}

function providerBusinessMessage(value: FiscalDashboard["provider"]["status"]) {
  return (
    {
      platform_not_configured: "A ativação depende do suporte GiroMesa.",
      profile_required: "Complete os dados fiscais da empresa.",
      company_required: "Verifique os dados e ative a emissão fiscal.",
      credentials_missing: "Revise o certificado e o ambiente de emissão.",
      ready: "A empresa está pronta para emitir notas fiscais.",
      error: "A emissão precisa de atenção antes da próxima nota.",
    } satisfies Record<FiscalDashboard["provider"]["status"], string>
  )[value];
}

function fiscalSectionFromHash(hash = typeof window === "undefined" ? "" : window.location.hash) {
  const query = hash.split("?")[1] ?? "";
  const value = new URLSearchParams(query).get("secao");
  return fiscalSections.some((section) => section.id === value)
    ? (value as FiscalSection)
    : "overview";
}

function fiscalSectionHref(section: FiscalSection) {
  return `#/fiscal?secao=${section}`;
}

function pendingActionSection(value: string): FiscalSection {
  if (value.includes("classification")) return "products";
  if (value.includes("document")) return "documents";
  if (value.includes("period") || value.includes("closing")) return "closing";
  if (value.includes("profile") || value.includes("provider") || value.includes("company")) {
    return "setup";
  }
  return "overview";
}

function customerFiscalError(error: unknown, fallback: string) {
  if (!(error instanceof ApiClientError) || !error.requestId) return fallback;
  return `${fallback} Informe o código ${error.requestId} ao suporte.`;
}

function latestRejectionGuidance(document: FiscalDocumentDetail) {
  const rejection = [...document.events]
    .reverse()
    .find((event) => event.status === "rejected" || event.type.includes("rejected"));
  return fiscalRejectionGuidance(rejection?.code ?? null, rejection?.message ?? null);
}

function documentEventLabel(type: string, status: string | null) {
  if (status === "authorized") return "Nota autorizada";
  if (status === "rejected") return "Autorização rejeitada";
  if (status === "canceled") return "Nota cancelada";
  if (type.includes("cancel")) return "Cancelamento solicitado";
  if (type.includes("reconcil")) return "Situação atualizada";
  return "Nota enviada para autorização";
}

function formatFiscalQuantity(quantityMilli: number) {
  return new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 3 }).format(quantityMilli / 1_000);
}

function downloadTextFile(filename: string, contents: string) {
  const url = URL.createObjectURL(new Blob([contents], { type: "text/csv;charset=utf-8" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

function saveDownloadedFile(file: { blob: Blob; filename: string | null }) {
  const url = URL.createObjectURL(file.blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = file.filename ?? "arquivo-fiscal";
  link.click();
  URL.revokeObjectURL(url);
}

function fileBase64(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error);
    reader.onload = () => {
      const result = typeof reader.result === "string" ? reader.result : "";
      const separator = result.indexOf(",");
      separator >= 0 ? resolve(result.slice(separator + 1)) : reject(new Error("Arquivo inválido"));
    };
    reader.readAsDataURL(file);
  });
}

function modelLabel(value: string) {
  return ({ nfce: "NFC-e", nfe: "NF-e", nfse: "NFS-e" } as Record<string, string>)[value] ?? value;
}

function severityLabel(value: string) {
  return (
    ({ info: "Informação", warning: "Atenção", critical: "Crítico" } as Record<string, string>)[
      value
    ] ?? value
  );
}

function periodLabel(value: string) {
  return (
    ({ open: "Aberta", reviewing: "Em conferência", closed: "Fechada" } as Record<string, string>)[
      value
    ] ?? value
  );
}

function documentLabel(value: string) {
  return (
    (
      {
        pending: "Pendente",
        authorized: "Autorizado",
        rejected: "Rejeitado",
        processing: "Processando",
        canceled: "Cancelado",
        contingency: "Contingência",
      } as Record<string, string>
    )[value] ?? value
  );
}

function packageLabel(value: string) {
  return (
    (
      {
        pending: "Gerando",
        ready: "Disponível",
        failed: "Falhou",
      } as Record<string, string>
    )[value] ?? value
  );
}

function requestCountLabel(count: number) {
  return count === 1 ? "1 solicitação" : `${count} solicitações`;
}

function accountantEmptyDescription(filter: AccountantRequestFilter) {
  if (filter === "open") return "Nenhuma solicitação aberta foi encontrada.";
  if (filter === "overdue") return "Nenhuma solicitação vencida exige atenção.";
  if (filter === "resolved") return "Nenhuma solicitação foi resolvida ainda.";
  return "Nenhuma solicitação foi registrada.";
}

function fileContentBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Não foi possível ler o arquivo."));
    reader.onload = () => {
      const result = typeof reader.result === "string" ? reader.result : "";
      const separator = result.indexOf(",");
      if (separator < 0) reject(new Error("Não foi possível ler o arquivo."));
      else resolve(result.slice(separator + 1));
    };
    reader.readAsDataURL(file);
  });
}

function fileSizeLabel(bytes: number) {
  return bytes < 1024 ? `${bytes} B` : `${Math.ceil(bytes / 1024)} KB`;
}

function todayInput() {
  const today = new Date();
  return `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
}
