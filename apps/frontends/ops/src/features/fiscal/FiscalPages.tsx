import { Badge, Button, Card, EmptyState, Icon } from "@giromesa/ui";
import { type FormEvent, useCallback, useState } from "react";
import { ApiClientError, api } from "../../api";
import { dateLabel, type ManagementScope, RemoteGate, useRemote } from "../../management.shared";
import { formatMoney } from "../../rules";
import {
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
  const [busy, setBusy] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<{ tone: "success" | "danger"; text: string } | null>(
    null,
  );
  const loader = useCallback(async () => {
    const [profile, taxRevisions, catalog, dashboard, documents, periods] = await Promise.all([
      api.fiscal.profile(scope.organizationId, scope.unitId),
      api.fiscal.taxRevisions(scope.organizationId, scope.unitId),
      api.pilot.catalog(scope.organizationId, scope.unitId),
      api.fiscal.dashboard(scope.organizationId, scope.unitId),
      api.fiscal.documents(scope.organizationId, scope.unitId),
      api.fiscal.periods(scope.organizationId, scope.unitId),
    ]);
    return { profile, taxRevisions, catalog, dashboard, documents, periods };
  }, [scope.organizationId, scope.unitId]);
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

  return (
    <RemoteGate remote={remote}>
      {(data) => (
        <div className="fiscal-page fiscal-dashboard">
          <section aria-label="Saúde fiscal" className="fiscal-health-grid">
            <Card className="fiscal-provider-card" data-status={data.dashboard.provider.status}>
              <div>
                <p className="eyebrow">Emissão fiscal</p>
                <h2>{data.dashboard.provider.name}</h2>
                <p>
                  {data.dashboard.provider.lastSyncAt
                    ? `Última sincronização: ${dateLabel(data.dashboard.provider.lastSyncAt)}`
                    : "Telemetria do provedor não informada pela API"}
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
            products={data.products}
            scope={scope}
            taxRevisions={data.taxRevisions}
          />

          <Card className="fiscal-section-card">
            <SectionHeading
              eyebrow="Livro fiscal"
              title="Documentos recentes"
              badge={`${data.documents.length} exibido(s)`}
            />
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

function FiscalConfiguration({
  profile,
  products,
  scope,
  taxRevisions,
  onSaved,
}: {
  profile: FiscalProfile | null;
  products: Array<{ id: string; name: string }>;
  scope: ManagementScope;
  taxRevisions: Array<{
    productId: string;
    status: "draft" | "active" | "revoked";
  }>;
  onSaved: () => void;
}) {
  const [draft, setDraft] = useState(profile);
  const [configurationSaved, setConfigurationSaved] = useState(
    Boolean(profile?.stateCode && profile?.cityCode),
  );
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);
  const active = taxRevisions.filter((revision) => revision.status === "active").length;
  const pending = taxRevisions.filter((revision) => revision.status === "draft").length;

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
      setConfigurationSaved(true);
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
    <Card className="fiscal-section-card fiscal-configuration">
      <SectionHeading
        badge={`${active} ativa(s) · ${pending} rascunho(s)`}
        eyebrow="Configuração"
        title="Perfil e classificações"
        tone={pending ? "warning" : "success"}
      />
      <form className="gm-form-stack" onSubmit={save}>
        <div className="gm-form-grid fiscal-profile-grid">
          <label className="gm-form-field">
            <span>Regime tributário</span>
            <select
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
            </select>
          </label>
          <label className="gm-form-field">
            <span>CRT</span>
            <select
              className="gm-control"
              onChange={(event) => update("crt", event.target.value)}
              value={draft.crt}
            >
              {["1", "2", "3", "4"].map((value) => (
                <option key={value} value={value}>
                  {value}
                </option>
              ))}
            </select>
          </label>
          <label className="gm-form-field">
            <span>UF</span>
            <input
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
            <input
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
            <select
              className="gm-control"
              onChange={(event) =>
                update("environment", event.target.value as FiscalProfile["environment"])
              }
              value={draft.environment}
            >
              <option value="homologation">Homologação</option>
              <option value="production">Produção</option>
            </select>
          </label>
          <label className="gm-form-field">
            <span>Provedor</span>
            <select
              className="gm-control"
              onChange={(event) =>
                update("provider", event.target.value === "focus" ? "focus" : null)
              }
              value={draft.provider ?? ""}
            >
              <option value="">Não configurado</option>
              <option value="focus">Focus NFe</option>
            </select>
          </label>
        </div>
        <details className="gm-disclosure">
          <summary>Inscrições e séries</summary>
          <div className="gm-disclosure__content gm-form-grid fiscal-profile-grid">
            <label className="gm-form-field">
              <span>Inscrição municipal</span>
              <input
                className="gm-control"
                maxLength={30}
                onChange={(event) => update("municipalRegistration", event.target.value)}
                value={draft.municipalRegistration ?? ""}
              />
            </label>
            <label className="gm-form-field">
              <span>CNAE</span>
              <input
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
                <input
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
      <TaxRevisionForm
        activeProductIds={
          new Set(
            taxRevisions
              .filter((revision) => revision.status === "active")
              .map((revision) => revision.productId),
          )
        }
        enabled={configurationSaved}
        onSaved={onSaved}
        products={products}
        scope={scope}
      />
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
  const [productId, setProductId] = useState("");
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
      !productId ||
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
      await api.fiscal.createTaxRevision(scope.organizationId, scope.unitId, {
        productId,
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
      setProductId("");
      setNcm("");
      setCfop("");
      setOrigin("");
      setCsosn("");
      setCstIcms("");
      setFeedback("Classificação fiscal ativada.");
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
    <section aria-labelledby="tax-revision-title" className="tax-revision-section">
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
          <div className="gm-form-grid fiscal-profile-grid">
            <label className="gm-form-field">
              <span>Produto</span>
              <select
                className="gm-control"
                disabled={!enabled}
                onChange={(event) => setProductId(event.target.value)}
                required
                value={productId}
              >
                <option value="">Selecione sem classificação</option>
                {pendingProducts.map((product) => (
                  <option key={product.id} value={product.id}>
                    {product.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="gm-form-field">
              <span>NCM (8 dígitos)</span>
              <input
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
              <input
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
              <select
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
              </select>
            </label>
            <label className="gm-form-field">
              <span>CSOSN (opcional)</span>
              <input
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
              <input
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
              <input
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
              <select
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
              </select>
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
                  <input
                    className="gm-control"
                    maxLength={120}
                    onChange={(event) => setTitle(event.target.value)}
                    required
                    value={title}
                  />
                </label>
                <label className="gm-form-field">
                  <span>Detalhes</span>
                  <textarea
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
                  <input
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
        unknown: "Sem telemetria",
        not_configured: "Não configurado",
      } as Record<string, string>
    )[value] ?? value
  );
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
