// biome-ignore-all lint/a11y/noLabelWithoutControl: shadcn-compatible controls render native form elements nested by these labels
import { Badge, Button, Card, EmptyState, Icon, Input, NativeSelect, Textarea } from "@giromesa/ui";
import { type FormEvent, useCallback, useState } from "react";
import { ApiClientError, api, type FocusCompanyOnboardingBody } from "../../api";
import { dateLabel, type ManagementScope, RemoteGate, useRemote } from "../../management.shared";
import { formatMoney } from "../../rules";
import {
  type FiscalDashboard,
  type FiscalPeriod,
  type FiscalProfile,
  fiscalTone,
  parseAccountantWorkspace,
  parseFiscalWorkspace,
} from "./fiscal";
import "./fiscal.css";

const fiscalOrigins = ["0", "1", "2", "3", "4", "5", "6", "7", "8"] as const;

export function RealFiscalPage({ scope }: { scope: ManagementScope }) {
  const [refresh, setRefresh] = useState(0);
  const [documentFilters, setDocumentFilters] = useState<{
    status?: string;
    model?: string;
    from?: string;
    to?: string;
    search?: string;
  }>({});
  const [artifacts, setArtifacts] = useState<
    Record<string, { xmlUrl: string | null; pdfUrl: string | null }>
  >({});
  const [busy, setBusy] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<{ tone: "success" | "danger"; text: string } | null>(
    null,
  );
  const loader = useCallback(async () => {
    const [profile, provider, taxRevisions, catalog, dashboard, documents, periods] =
      await Promise.all([
        api.fiscal.profile(scope.organizationId, scope.unitId),
        api.fiscal.provider(scope.organizationId, scope.unitId),
        api.fiscal.taxRevisions(scope.organizationId, scope.unitId),
        api.pilot.catalog(scope.organizationId, scope.unitId),
        api.fiscal.dashboard(scope.organizationId, scope.unitId),
        api.fiscal.documents(scope.organizationId, scope.unitId, documentFilters),
        api.fiscal.periods(scope.organizationId, scope.unitId),
      ]);
    return { profile, provider, taxRevisions, catalog, dashboard, documents, periods };
  }, [documentFilters, scope.organizationId, scope.unitId]);
  const remote = useRemote(
    { ...scope, refreshToken: (scope.refreshToken ?? 0) + refresh },
    loader,
    parseFiscalWorkspace,
  );

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
        text: error instanceof Error ? error.message : "Não foi possível atualizar a competência.",
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
      setFeedback({ tone: "success", text: "Conexão e tokens da Focus NFe sincronizados." });
      setRefresh((value) => value + 1);
    } catch (error) {
      setFeedback({
        tone: "danger",
        text: error instanceof Error ? error.message : "Não foi possível testar a Focus NFe.",
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
      const response =
        action === "reconcile"
          ? await api.fiscal.reconcileDocument(scope.organizationId, scope.unitId, documentId)
          : await api.fiscal.cancelDocument(
              scope.organizationId,
              scope.unitId,
              documentId,
              justification ?? "",
            );
      const nextArtifacts = fiscalArtifacts(response);
      if (nextArtifacts.xmlUrl || nextArtifacts.pdfUrl) {
        setArtifacts((current) => ({ ...current, [documentId]: nextArtifacts }));
      }
      setFeedback({
        tone: "success",
        text:
          action === "cancel" ? "Cancelamento conciliado." : "Documento atualizado na Focus NFe.",
      });
      setRefresh((value) => value + 1);
    } catch (error) {
      setFeedback({
        tone: "danger",
        text: error instanceof Error ? error.message : "Não foi possível atualizar o documento.",
      });
    } finally {
      setBusy(null);
    }
  }

  return (
    <RemoteGate remote={remote}>
      {(data) => (
        <div className="fiscal-page fiscal-dashboard">
          <nav aria-label="Seções do módulo fiscal" className="fiscal-subnav">
            <a href="#fiscal-overview">Visão geral</a>
            <a href="#fiscal-activation">Ativação</a>
            <a href="#fiscal-configuration">Configuração</a>
            <a href="#fiscal-classification">Classificação</a>
            <a href="#fiscal-documents">Documentos</a>
          </nav>

          <section aria-label="Saúde fiscal" className="fiscal-health-grid" id="fiscal-overview">
            <Card className="fiscal-provider-card" data-status={data.dashboard.provider.status}>
              <div>
                <p className="eyebrow">Emissão fiscal</p>
                <h2>{data.dashboard.provider.name}</h2>
                <p>
                  {data.dashboard.provider.lastSyncAt
                    ? `Última sincronização: ${dateLabel(data.dashboard.provider.lastSyncAt)}`
                    : data.dashboard.provider.nextAction}
                </p>
              </div>
              <div className="fiscal-provider-card__status">
                <Badge tone={fiscalTone(data.dashboard.provider.status)}>
                  {providerLabel(data.dashboard.provider.status)}
                </Badge>
                <small>
                  {data.dashboard.provider.environment === "production"
                    ? "Produção"
                    : data.dashboard.provider.environment === "homologation"
                      ? "Homologação"
                      : "Ambiente não configurado"}
                </small>
                {data.dashboard.provider.companyId ? (
                  <Button
                    disabled={busy !== null}
                    onClick={() => void checkProvider()}
                    size="sm"
                    variant="secondary"
                  >
                    <Icon name="refresh" size={14} />
                    {busy === "provider:check" ? "Testando…" : "Testar conexão"}
                  </Button>
                ) : (
                  <a className="fiscal-inline-action" href="#fiscal-provider-onboarding">
                    Configurar empresa
                  </a>
                )}
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

          <FiscalActivationChecklist
            profile={data.profile}
            provider={data.dashboard.provider}
            products={data.products}
            taxRevisions={data.taxRevisions}
          />

          {feedback && (
            <div className={`fiscal-feedback fiscal-feedback--${feedback.tone}`} role="status">
              {feedback.text}
            </div>
          )}

          <div className="fiscal-columns">
            <Card className="fiscal-section-card">
              <SectionHeading
                eyebrow="Próxima ação"
                title="Pendências"
                badge={`${data.dashboard.pending.length} aberta(s)`}
                tone={data.dashboard.pending.length ? "warning" : "success"}
              />
              {data.dashboard.pending.length ? (
                <div className="fiscal-list">
                  {data.dashboard.pending.map((item) => (
                    <article className="fiscal-list-row" key={item.id}>
                      <Badge tone={fiscalTone(item.severity)}>{severityLabel(item.severity)}</Badge>
                      <div>
                        <strong>{item.title}</strong>
                        <p>{item.detail}</p>
                      </div>
                      <a className="fiscal-row-action" href={pendingActionHref(item.id)}>
                        Resolver
                      </a>
                    </article>
                  ))}
                </div>
              ) : (
                <EmptyState
                  description="Nenhuma exceção fiscal exige ação nesta unidade."
                  icon={<Icon name="check" />}
                  title="Fiscal em dia"
                />
              )}
            </Card>

            <Card className="fiscal-section-card">
              <SectionHeading eyebrow="Competências" title="Fechamento" />
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
                          <Button
                            disabled={
                              busy !== null || (action === "close" && period.blockers.length > 0)
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
                        </div>
                      </article>
                    );
                  })}
                </div>
              ) : (
                <EmptyState
                  description="A API ainda não abriu competências para esta unidade."
                  icon={<Icon name="clock" />}
                  title="Sem competências"
                />
              )}
            </Card>
          </div>

          <FiscalConfiguration
            key={`${scope.organizationId}:${scope.unitId}`}
            onSaved={() => setRefresh((value) => value + 1)}
            profile={data.profile}
            scope={scope}
          />

          <FocusOnboarding
            onActivated={() => setRefresh((value) => value + 1)}
            profile={data.profile}
            provider={data.dashboard.provider}
            scope={scope}
          />

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
              onSaved={() => setRefresh((value) => value + 1)}
              products={data.products}
              scope={scope}
            />
          </Card>

          <Card className="fiscal-section-card" id="fiscal-documents">
            <SectionHeading
              eyebrow="Livro fiscal"
              title="Documentos fiscais"
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
              <NativeSelect aria-label="Filtrar por modelo" name="model">
                <option value="">Todos os modelos</option>
                <option value="nfce">NFC-e</option>
                <option value="nfe">NF-e</option>
                <option value="nfse">NFS-e</option>
              </NativeSelect>
              <NativeSelect aria-label="Filtrar por status" name="status">
                <option value="">Todos os status</option>
                {["pending", "processing", "authorized", "rejected", "contingency", "canceled"].map(
                  (status) => (
                    <option key={status} value={status}>
                      {documentLabel(status)}
                    </option>
                  ),
                )}
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
                        disabled={busy !== null}
                        onClick={() => void changeDocument(document.id, "reconcile")}
                        size="sm"
                        variant="ghost"
                      >
                        {busy === `document:${document.id}:reconcile`
                          ? "Atualizando…"
                          : "Atualizar"}
                      </Button>
                      {document.status === "authorized" && (
                        <Button
                          disabled={busy !== null}
                          onClick={() => void changeDocument(document.id, "cancel")}
                          size="sm"
                          variant="danger"
                        >
                          Cancelar
                        </Button>
                      )}
                      {artifacts[document.id]?.pdfUrl && (
                        <a
                          href={artifacts[document.id]?.pdfUrl ?? undefined}
                          rel="noreferrer"
                          target="_blank"
                        >
                          DANFE
                        </a>
                      )}
                      {artifacts[document.id]?.xmlUrl && (
                        <a
                          href={artifacts[document.id]?.xmlUrl ?? undefined}
                          rel="noreferrer"
                          target="_blank"
                        >
                          XML
                        </a>
                      )}
                    </div>
                  </article>
                ))}
              </div>
            ) : (
              <EmptyState
                description="Nenhum documento retornado para esta unidade."
                icon={<Icon name="list" />}
                title="Sem documentos"
              />
            )}
          </Card>
        </div>
      )}
    </RemoteGate>
  );
}

function FiscalActivationChecklist({
  profile,
  provider,
  products,
  taxRevisions,
}: {
  profile: FiscalProfile | null;
  provider: FiscalDashboard["provider"];
  products: Array<{ id: string; name: string }>;
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
      label: "Conta Focus NFe do GiroMesa configurada no ambiente",
      done: provider.status !== "platform_not_configured",
      href: "#fiscal-provider-onboarding",
    },
    {
      label: "Perfil fiscal, UF e município confirmados",
      done: Boolean(profile?.stateCode && profile.cityCode && profile.provider === "focus"),
      href: "#fiscal-configuration",
    },
    {
      label: "Empresa emitente vinculada à conta GiroMesa",
      done: Boolean(provider.companyId),
      href: "#fiscal-provider-onboarding",
    },
    {
      label: `Token de ${profile?.environment === "production" ? "produção" : "homologação"} sincronizado`,
      done: selectedEnvironmentReady,
      href: "#fiscal-provider-onboarding",
    },
    {
      label: "Todos os produtos ativos classificados",
      done: products.length > 0 && products.every((product) => activeProducts.has(product.id)),
      href: "#fiscal-classification",
    },
  ];
  const complete = steps.filter((step) => step.done).length;
  const certificateDays = provider.certificateValidUntil
    ? Math.ceil((new Date(provider.certificateValidUntil).getTime() - Date.now()) / 86_400_000)
    : null;

  return (
    <Card className="fiscal-section-card fiscal-activation" id="fiscal-activation">
      <SectionHeading
        badge={`${complete}/${steps.length} concluídas`}
        eyebrow="Próxima ação"
        title="Ativação fiscal"
        tone={complete === steps.length ? "success" : "warning"}
      />
      <ol className="fiscal-checklist">
        {steps.map((step) => (
          <li className={step.done ? "is-complete" : ""} key={step.label}>
            <Icon name={step.done ? "check" : "clock"} size={16} />
            <span>{step.label}</span>
            {!step.done && <a href={step.href}>Resolver</a>}
          </li>
        ))}
      </ol>
      {certificateDays !== null && certificateDays <= 45 && (
        <p className="fiscal-preventive-alert" role="alert">
          <Icon name="alert-circle" size={16} />
          {certificateDays < 0
            ? "O certificado A1 está vencido. Atualize-o antes de emitir."
            : `O certificado A1 vence em ${certificateDays} dia(s). Programe a renovação.`}
        </p>
      )}
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
        <SectionHeading eyebrow="Configuração" title="Perfil fiscal" tone="warning" />
        <EmptyState
          description="A unidade ainda não possui perfil fiscal. Vincule primeiro a entidade legal no onboarding para liberar a configuração segura."
          icon={<Icon name="alert-circle" />}
          title="Perfil fiscal pendente"
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
        municipalRegistration: draft.municipalRegistration || undefined,
        cnae: draft.cnae || undefined,
        series: Object.fromEntries(Object.entries(draft.series).filter(([, value]) => value)),
      });
      setFeedback("Perfil fiscal atualizado.");
      onSaved();
    } catch (error) {
      setFeedback(
        error instanceof Error ? error.message : "Não foi possível salvar o perfil fiscal.",
      );
    } finally {
      setBusy(false);
    }
  }

  const update = <K extends keyof FiscalProfile>(key: K, value: FiscalProfile[K]) =>
    setDraft((current) => (current ? { ...current, [key]: value } : current));

  return (
    <Card className="fiscal-section-card fiscal-configuration" id="fiscal-configuration">
      <SectionHeading eyebrow="Configuração" title="Perfil fiscal" />
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
            <span>Ambiente</span>
            <NativeSelect
              className="gm-control"
              onChange={(event) =>
                update("environment", event.target.value as FiscalProfile["environment"])
              }
              value={draft.environment}
            >
              <option value="homologation">Homologação</option>
              <option value="production">Produção</option>
            </NativeSelect>
          </label>
          <label className="gm-form-field">
            <span>Provedor</span>
            <NativeSelect
              className="gm-control"
              onChange={(event) =>
                update("provider", event.target.value === "focus" ? "focus" : null)
              }
              value={draft.provider ?? ""}
            >
              <option value="">Não configurado</option>
              <option value="focus">Focus NFe</option>
            </NativeSelect>
          </label>
        </div>
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
            {(["nfce", "nfe", "nfse"] as const).map((model) => (
              <label className="gm-form-field" key={model}>
                <span>Série {model.toUpperCase()}</span>
                <Input
                  className="gm-control"
                  maxLength={20}
                  onChange={(event) =>
                    setDraft((current) =>
                      current
                        ? { ...current, series: { ...current.series, [model]: event.target.value } }
                        : current,
                    )
                  }
                  value={draft.series[model]}
                />
              </label>
            ))}
          </div>
        </details>
        {feedback && (
          <p aria-live="polite" className="fiscal-form-feedback">
            {feedback}
          </p>
        )}
        <Button disabled={busy} type="submit">
          {!busy && <Icon name="check" size={16} />}
          {busy ? "Salvando…" : "Salvar perfil fiscal"}
        </Button>
      </form>
    </Card>
  );
}

function FocusOnboarding({
  onActivated,
  profile,
  provider,
  scope,
}: {
  onActivated: () => void;
  profile: FiscalProfile | null;
  provider: FiscalDashboard["provider"];
  scope: ManagementScope;
}) {
  const [certificateBase64, setCertificateBase64] = useState("");
  const [certificateName, setCertificateName] = useState("");
  const [busy, setBusy] = useState<"validate" | "activate" | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [editing, setEditing] = useState(!provider.companyId);

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
      enableNfce: form.has("enableNfce"),
      enableNfe: form.has("enableNfe"),
      enableNfse: form.has("enableNfse"),
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
        setFeedback("Dados e certificado validados pela Focus NFe sem criar a empresa.");
      } else {
        await api.fiscal.activateProvider(scope.organizationId, scope.unitId, body);
        setFeedback("Empresa vinculada à conta GiroMesa e tokens sincronizados.");
        setCertificateBase64("");
        setCertificateName("");
        formElement.reset();
        onActivated();
      }
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : "Não foi possível concluir o cadastro.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <Card className="fiscal-section-card fiscal-onboarding" id="fiscal-provider-onboarding">
      <SectionHeading
        badge={providerLabel(provider.status)}
        eyebrow="Focus NFe"
        title="Empresa emitente"
        tone={fiscalTone(provider.status)}
      />
      {!profile ? (
        <EmptyState
          description="Salve o perfil fiscal antes de enviar o cadastro da empresa."
          icon={<Icon name="alert-circle" />}
          title="Perfil fiscal necessário"
        />
      ) : provider.companyId && !editing ? (
        <div className="fiscal-connected-provider">
          <div>
            <strong>Empresa vinculada</strong>
            <span>
              {provider.environments.homologation ? "Homologação ativa" : "Homologação pendente"}
              {" · "}
              {provider.environments.production ? "Produção ativa" : "Produção pendente"}
            </span>
            {provider.certificateValidUntil && (
              <small>Certificado válido até {dateLabel(provider.certificateValidUntil)}</small>
            )}
          </div>
          <Button onClick={() => setEditing(true)} size="sm" variant="secondary">
            Atualizar cadastro ou certificado
          </Button>
        </div>
      ) : !provider.environments.homologation && provider.status === "platform_not_configured" ? (
        <EmptyState
          description="A equipe GiroMesa deve configurar FOCUS_NFE_PRIMARY_TOKEN e FISCAL_CREDENTIALS_ENCRYPTION_KEY na API."
          icon={<Icon name="alert-circle" />}
          title="Conta principal ainda não conectada"
        />
      ) : (
        <form className="gm-form-stack" onSubmit={submit}>
          <p className="fiscal-security-note">
            O certificado e a senha seguem diretamente para a Focus NFe e não são armazenados pelo
            GiroMesa. Apenas os tokens da empresa retornados pelo provedor ficam cifrados por
            unidade.
          </p>
          <div className="gm-form-grid fiscal-onboarding-grid">
            <label className="gm-form-field">
              <span>Nome fantasia</span>
              <Input maxLength={120} name="tradeName" required />
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
              <Input maxLength={120} name="city" required />
            </label>
            <label className="gm-form-field">
              <span>CEP</span>
              <Input inputMode="numeric" maxLength={9} name="postalCode" required />
            </label>
            <label className="gm-form-field">
              <span>CPF/CNPJ da contabilidade</span>
              <Input inputMode="numeric" maxLength={18} name="accountantDocument" />
            </label>
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
          <fieldset className="fiscal-document-types">
            <legend>Documentos habilitados</legend>
            <label>
              <input defaultChecked name="enableNfce" type="checkbox" /> NFC-e
            </label>
            <label>
              <input name="enableNfe" type="checkbox" /> NF-e
            </label>
            <label>
              <input name="enableNfse" type="checkbox" /> NFS-e
            </label>
          </fieldset>
          <details className="gm-disclosure" open={!provider.companyId}>
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
          {feedback && (
            <p aria-live="polite" className="fiscal-form-feedback">
              {feedback}
            </p>
          )}
          <div className="fiscal-form-actions">
            {provider.companyId && (
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
              {busy === "validate" ? "Validando…" : "Validar sem cadastrar"}
            </Button>
            <Button disabled={busy !== null} name="action" type="submit" value="activate">
              <Icon name="check" size={16} />
              {busy === "activate"
                ? "Cadastrando…"
                : provider.companyId
                  ? "Atualizar empresa"
                  : "Cadastrar na Focus NFe"}
            </Button>
          </div>
        </form>
      )}
    </Card>
  );
}

function TaxRevisionForm({
  activeProductIds,
  enabled,
  onSaved,
  products,
  scope,
}: {
  activeProductIds: Set<string>;
  enabled: boolean;
  onSaved: () => void;
  products: Array<{ id: string; name: string }>;
  scope: ManagementScope;
}) {
  const pendingProducts = products.filter((product) => !activeProductIds.has(product.id));
  const [productIds, setProductIds] = useState<string[]>([]);
  const [ncm, setNcm] = useState("");
  const [cfop, setCfop] = useState("");
  const [origin, setOrigin] = useState("");
  const [csosn, setCsosn] = useState("");
  const [cstIcms, setCstIcms] = useState("");
  const [effectiveFrom, setEffectiveFrom] = useState(todayInput);
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (
      !enabled ||
      productIds.length === 0 ||
      !/^\d{8}$/.test(ncm) ||
      !/^\d{4}$/.test(cfop) ||
      !/^[0-8]$/.test(origin)
    ) {
      setFeedback("Preencha produto, NCM, CFOP e origem nos formatos indicados.");
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
        },
      });
      setProductIds([]);
      setNcm("");
      setCfop("");
      setOrigin("");
      setCsosn("");
      setCstIcms("");
      setFeedback(`${productIds.length} classificação(ões) fiscal(is) ativada(s).`);
      onSaved();
    } catch (error) {
      setFeedback(
        error instanceof Error ? error.message : "Não foi possível ativar a classificação.",
      );
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
        <h3 id="tax-revision-title">Nova classificação fiscal</h3>
        <p className="tax-revision-note">
          Confirme os códigos com o contador antes de ativar. O GiroMesa não sugere enquadramento
          tributário.
        </p>
      </div>
      {pendingProducts.length ? (
        <form className="gm-form-stack" onSubmit={submit}>
          <div className="fiscal-classification-toolbar">
            <span>{productIds.length} produto(s) selecionado(s)</span>
            <Button
              disabled={!enabled}
              onClick={() =>
                setProductIds(
                  productIds.length
                    ? []
                    : pendingProducts.slice(0, 100).map((product) => product.id),
                )
              }
              size="sm"
              type="button"
              variant="ghost"
            >
              {productIds.length ? "Limpar seleção" : "Selecionar pendentes"}
            </Button>
          </div>
          <div className="gm-form-grid fiscal-profile-grid">
            <label className="gm-form-field">
              <span>Produtos</span>
              <NativeSelect
                className="gm-control"
                disabled={!enabled}
                multiple
                onChange={(event) =>
                  setProductIds(Array.from(event.target.selectedOptions, (option) => option.value))
                }
                required
                size={Math.min(6, Math.max(3, pendingProducts.length))}
                value={productIds}
              >
                {pendingProducts.map((product) => (
                  <option key={product.id} value={product.id}>
                    {product.name}
                  </option>
                ))}
              </NativeSelect>
              <small>Use Ctrl ou Shift para selecionar vários produtos com a mesma regra.</small>
            </label>
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
            {busy ? "Ativando…" : "Ativar classificação"}
          </Button>
        </form>
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

export function RealAccountantPage({ scope }: { scope: ManagementScope }) {
  const [competence, setCompetence] = useState(currentCompetence);
  const [refresh, setRefresh] = useState(0);
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [detail, setDetail] = useState("");
  const [dueAt, setDueAt] = useState("");
  const loader = useCallback(async () => {
    const [periods, accountingPackage, requests] = await Promise.all([
      api.fiscal.periods(scope.organizationId, scope.unitId),
      api.fiscal
        .accountingPackage(scope.organizationId, scope.unitId, competence)
        .catch((error: unknown) => {
          if (error instanceof ApiClientError && error.status === 404) return null;
          throw error;
        }),
      api.fiscal.accountantRequests(scope.organizationId, scope.unitId, competence),
    ]);
    return { periods, accountingPackage, requests };
  }, [competence, scope.organizationId, scope.unitId]);
  const remote = useRemote(
    { ...scope, refreshToken: (scope.refreshToken ?? 0) + refresh },
    loader,
    parseAccountantWorkspace,
  );

  async function submitRequest(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!title.trim() || !detail.trim()) {
      setFeedback("Informe assunto e detalhes da solicitação.");
      return;
    }
    setBusy(true);
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
      setFeedback("Solicitação registrada.");
      setRefresh((value) => value + 1);
    } catch (error) {
      setFeedback(
        error instanceof Error ? error.message : "Não foi possível registrar a solicitação.",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <RemoteGate remote={remote}>
      {(data) => (
        <div className="fiscal-page accountant-page">
          <Card className="accountant-toolbar">
            <div className="accountant-toolbar__copy">
              <p className="eyebrow">Escopo contábil</p>
              <h2>Competência</h2>
              <p className="fiscal-muted">Pacotes e solicitações seguem o período selecionado.</p>
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
                        <small>{fileSize(file.sizeBytes)}</small>
                      </li>
                    ))}
                  </ul>
                  {data.accountingPackage.status === "ready" ? (
                    <Button onClick={() => downloadAccountingPackage(data.accountingPackage)}>
                      <Icon name="download" size={16} />
                      Baixar pacote JSON
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
                    min={new Date().toISOString().slice(0, 10)}
                    onChange={(event) => setDueAt(event.target.value)}
                    type="date"
                    value={dueAt}
                  />
                </label>
                {feedback && (
                  <p aria-live="polite" className="fiscal-form-feedback">
                    {feedback}
                  </p>
                )}
                <Button disabled={busy} type="submit">
                  {!busy && <Icon name="plus" size={16} />}
                  {busy ? "Enviando…" : "Registrar solicitação"}
                </Button>
              </form>
            </Card>
          </div>

          <Card className="fiscal-section-card accountant-panel accountant-requests">
            <SectionHeading
              eyebrow="Acompanhamento"
              title="Solicitações"
              badge={`${data.requests.length} registro(s)`}
            />
            {data.requests.length ? (
              <div className="fiscal-list">
                {data.requests.map((request) => (
                  <article className="accountant-request-row" key={request.id}>
                    <div>
                      <strong>{request.title}</strong>
                      <p>{request.detail}</p>
                      <small>
                        {competenceLabel(request.competence)} · {dateLabel(request.createdAt)}
                        {request.dueAt ? ` · prazo ${dateLabel(request.dueAt)}` : ""}
                      </small>
                    </div>
                    <Badge tone={fiscalTone(request.status)}>{requestLabel(request.status)}</Badge>
                  </article>
                ))}
              </div>
            ) : (
              <EmptyState
                description="Nenhuma pendência foi registrada nesta competência."
                icon={<Icon name="check" />}
                title="Sem solicitações"
              />
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
        platform_not_configured: "Conta pendente",
        profile_required: "Perfil pendente",
        company_required: "Empresa pendente",
        credentials_missing: "Token pendente",
        ready: "Pronto",
        error: "Falha na conexão",
      } as Record<string, string>
    )[value] ?? value
  );
}

function pendingActionHref(value: string) {
  if (value.includes("classification")) return "#fiscal-classification";
  if (value.includes("profile")) return "#fiscal-configuration";
  if (value.includes("provider") || value.includes("company")) {
    return "#fiscal-provider-onboarding";
  }
  if (value.includes("document")) return "#fiscal-documents";
  return "#fiscal-activation";
}

function fiscalArtifacts(value: unknown) {
  if (!value || typeof value !== "object") return { xmlUrl: null, pdfUrl: null };
  const payload = value as Record<string, unknown>;
  const artifacts =
    payload.artifacts && typeof payload.artifacts === "object" && !Array.isArray(payload.artifacts)
      ? (payload.artifacts as Record<string, unknown>)
      : payload;
  return {
    xmlUrl: safeFocusUrl(artifacts.xmlUrl ?? artifacts.caminho_xml_nota_fiscal),
    pdfUrl: safeFocusUrl(artifacts.pdfUrl ?? artifacts.caminho_danfe),
  };
}

function safeFocusUrl(value: unknown) {
  if (typeof value !== "string") return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" &&
      (url.hostname === "focusnfe.com.br" || url.hostname.endsWith(".focusnfe.com.br"))
      ? url.toString()
      : null;
  } catch {
    return null;
  }
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

function requestLabel(value: string) {
  return ({ open: "Aberta", resolved: "Resolvida" } as Record<string, string>)[value] ?? value;
}

function fileSize(bytes: number) {
  return bytes < 1024 * 1024
    ? `${Math.max(1, Math.round(bytes / 1024))} KB`
    : `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function todayInput() {
  const today = new Date();
  return `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
}

function downloadAccountingPackage(
  accountingPackage: {
    competence: string;
    payload: Record<string, unknown>;
  } | null,
) {
  if (!accountingPackage) return;
  const url = URL.createObjectURL(
    new Blob([JSON.stringify(accountingPackage.payload, null, 2)], { type: "application/json" }),
  );
  const link = document.createElement("a");
  link.href = url;
  link.download = `pacote-contabil-${accountingPackage.competence}.json`;
  link.click();
  URL.revokeObjectURL(url);
}
