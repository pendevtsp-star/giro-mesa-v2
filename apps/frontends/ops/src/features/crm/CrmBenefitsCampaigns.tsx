// biome-ignore-all lint/a11y/noLabelWithoutControl: controls render native form elements nested by labels
import {
  Badge,
  Button,
  Callout,
  Card,
  Checkbox,
  EmptyState,
  Icon,
  Input,
  NativeSelect,
  Textarea,
} from "@giromesa/ui";
import { type FormEvent, useMemo, useState } from "react";
import { api } from "../../api";
import {
  dateTime,
  type GrowthScope,
  moneyToCents,
  RemoteGate,
  useRemote,
} from "../../growth.shared";
import {
  type CrmCampaign,
  type CrmCampaignDeliveries,
  type CrmCampaignPreview,
  parseCrmCampaignDeliveries,
  parseCrmCampaignPreview,
  parseCrmCampaigns,
  parseCrmCoupons,
  parseCrmSegments,
} from "./crm.model";
import { type CrmFeedback, CrmFormPanel, crmCurrency, crmError } from "./crm.ui";

type SegmentKind =
  | "all"
  | "marketing_opt_in"
  | "birthday_month"
  | "inactive_days"
  | "minimum_visits"
  | "minimum_spend_cents"
  | "no_show_count";
const months = Array.from({ length: 12 }, (_, index) => ({
  value: index + 1,
  label: new Intl.DateTimeFormat("pt-BR", { month: "long" }).format(new Date(2026, index, 1)),
}));

function campaignStatus(campaign: CrmCampaign): {
  label: string;
  tone: "neutral" | "success" | "warning" | "danger" | "info";
} {
  const known = {
    sent: { label: "Enviada", tone: "success" },
    queued: { label: "Na fila", tone: "info" },
    blocked: { label: "Bloqueada", tone: "danger" },
    failed: { label: "Falhou", tone: "danger" },
    canceled: { label: "Cancelada", tone: "neutral" },
    sending: { label: "Enviando", tone: "info" },
    draft: { label: "Rascunho", tone: "neutral" },
  } as const;
  return (
    known[campaign.status as keyof typeof known] ?? { label: campaign.status, tone: "warning" }
  );
}
function segmentLabel(kind: string): string {
  const labels: Record<string, string> = {
    marketing_opt_in: "Marketing autorizado",
    birthday_month: "Aniversariantes do mês",
    inactive_days: "Clientes inativos",
    minimum_visits: "Frequência mínima",
    minimum_spend_cents: "Gasto mínimo",
    no_show_count: "Histórico de no-show",
    all: "Todos os clientes",
  };
  return labels[kind] ?? kind;
}

export function CrmBenefitsCampaigns({ scope }: { scope: GrowthScope }) {
  const coupons = useRemote(scope, () => api.growth.coupons(scope.organizationId), parseCrmCoupons);
  const segments = useRemote(
    scope,
    () => api.growth.segments(scope.organizationId),
    parseCrmSegments,
  );
  const campaigns = useRemote(
    scope,
    () => api.growth.campaigns(scope.organizationId),
    parseCrmCampaigns,
  );
  const [busy, setBusy] = useState("");
  const [feedback, setFeedback] = useState<CrmFeedback | null>(null);
  const [campaignName, setCampaignName] = useState("");
  const [campaignChannel, setCampaignChannel] = useState<"email" | "whatsapp">("email");
  const [campaignSubject, setCampaignSubject] = useState("");
  const [campaignContent, setCampaignContent] = useState("");
  const [campaignVariantB, setCampaignVariantB] = useState("");
  const [attributionWindowDays, setAttributionWindowDays] = useState("7");
  const [holdoutPercentage, setHoldoutPercentage] = useState("0");
  const [campaignSegmentId, setCampaignSegmentId] = useState("");
  const [loyaltyMode, setLoyaltyMode] = useState<"points" | "cashback">("points");
  const [loyaltyRate, setLoyaltyRate] = useState("");
  const [loyaltyMinimum, setLoyaltyMinimum] = useState("0");
  const [couponCode, setCouponCode] = useState("");
  const [couponType, setCouponType] = useState<"fixed" | "percentage">("fixed");
  const [couponValue, setCouponValue] = useState("");
  const [segmentName, setSegmentName] = useState("");
  const [segmentKind, setSegmentKind] = useState<SegmentKind>("marketing_opt_in");
  const [birthdayMonth, setBirthdayMonth] = useState(String(new Date().getMonth() + 1));
  const [segmentThreshold, setSegmentThreshold] = useState("");
  const [preview, setPreview] = useState<CrmCampaignPreview | null>(null);
  const [deliveries, setDeliveries] = useState<CrmCampaignDeliveries | null>(null);
  const [reviewedId, setReviewedId] = useState("");
  const [queueConfirmed, setQueueConfirmed] = useState(false);
  const [cancelReason, setCancelReason] = useState("");

  const segmentNames = useMemo(
    () =>
      new Map(
        segments.state.status === "ready"
          ? segments.state.data.map((segment) => [segment.id, segment.name])
          : [],
      ),
    [segments.state],
  );
  const reviewed =
    campaigns.state.status === "ready"
      ? (campaigns.state.data.find((campaign) => campaign.id === reviewedId) ?? null)
      : null;
  const parsedCoupon = Number(couponValue.replace(",", "."));
  const couponInvalid =
    !Number.isFinite(parsedCoupon) ||
    parsedCoupon <= 0 ||
    (couponType === "percentage" && parsedCoupon > 100);
  const needsThreshold = [
    "inactive_days",
    "minimum_visits",
    "minimum_spend_cents",
    "no_show_count",
  ].includes(segmentKind);
  const parsedThreshold =
    segmentKind === "minimum_spend_cents"
      ? moneyToCents(segmentThreshold)
      : Number(segmentThreshold);
  const thresholdInvalid =
    needsThreshold && (!Number.isInteger(parsedThreshold) || parsedThreshold <= 0);
  const canQueue =
    Boolean(reviewed && preview) &&
    ["draft", "blocked"].includes(reviewed?.status ?? "") &&
    preview?.provider.ready === true &&
    preview.eligibleRecipients > 0 &&
    !preview.exceedsRecipientLimit;
  const canCancel = Boolean(reviewed && !["sending", "sent", "canceled"].includes(reviewed.status));
  const refreshing = coupons.refreshing || segments.refreshing || campaigns.refreshing;
  const refreshError = coupons.refreshError ?? segments.refreshError ?? campaigns.refreshError;

  async function createCampaign(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy("campaign");
    setFeedback(null);
    try {
      await api.growth.createCampaign(scope.organizationId, {
        unitId: scope.unitId,
        segmentId: campaignSegmentId || undefined,
        name: campaignName.trim(),
        channel: campaignChannel,
        subject: campaignChannel === "email" ? campaignSubject.trim() : undefined,
        content: campaignContent.trim(),
        variantBContent: campaignVariantB.trim() || undefined,
        attributionWindowDays: Number(attributionWindowDays),
        holdoutPercentage: Number(holdoutPercentage),
      });
      setCampaignName("");
      setCampaignSubject("");
      setCampaignContent("");
      setCampaignVariantB("");
      setCampaignSegmentId("");
      setFeedback({
        tone: "success",
        message: "Campanha salva como rascunho. Nenhum envio foi iniciado.",
      });
      campaigns.retry();
    } catch (error) {
      setFeedback({
        tone: "danger",
        message: crmError(error, "Não foi possível criar a campanha."),
      });
    } finally {
      setBusy("");
    }
  }
  async function loadReview(id: string) {
    setReviewedId(id);
    setPreview(null);
    setDeliveries(null);
    setQueueConfirmed(false);
    setCancelReason("");
    setBusy("review");
    setFeedback(null);
    try {
      const [previewPayload, deliveryPayload] = await Promise.all([
        api.growth.campaignPreview(scope.organizationId, id),
        api.growth.campaignDeliveries(scope.organizationId, id),
      ]);
      setPreview(parseCrmCampaignPreview(previewPayload));
      setDeliveries(parseCrmCampaignDeliveries(deliveryPayload));
    } catch (error) {
      setFeedback({
        tone: "danger",
        message: crmError(error, "Não foi possível revisar a campanha."),
      });
    } finally {
      setBusy("");
    }
  }
  async function queueCampaign() {
    if (!reviewed || !preview || !queueConfirmed) return;
    setBusy("queue");
    setFeedback(null);
    try {
      await api.growth.queueCampaign(scope.organizationId, reviewed.id);
      setQueueConfirmed(false);
      campaigns.retry();
      await loadReview(reviewed.id);
      setFeedback({
        tone: "success",
        message: "Campanha enfileirada. Entregas continuam confirmadas pelo status persistido.",
      });
    } catch (error) {
      setFeedback({
        tone: "danger",
        message: crmError(error, "Não foi possível enfileirar a campanha."),
      });
    } finally {
      setBusy("");
    }
  }
  async function cancelCampaign() {
    if (!reviewed || cancelReason.trim().length < 3) return;
    setBusy("cancel");
    setFeedback(null);
    try {
      await api.growth.cancelCampaign(scope.organizationId, reviewed.id, {
        reason: cancelReason.trim(),
      });
      setCancelReason("");
      setQueueConfirmed(false);
      campaigns.retry();
      await loadReview(reviewed.id);
      setFeedback({ tone: "success", message: "Campanha cancelada com auditoria." });
    } catch (error) {
      setFeedback({
        tone: "danger",
        message: crmError(error, "Não foi possível cancelar a campanha."),
      });
    } finally {
      setBusy("");
    }
  }
  async function createLoyalty(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy("loyalty");
    setFeedback(null);
    try {
      await api.growth.createLoyaltyProgram(scope.organizationId, {
        mode: loyaltyMode,
        rate: Number(loyaltyRate.replace(",", ".")),
        minimumOrderCents: moneyToCents(loyaltyMinimum),
        active: true,
      });
      setFeedback({ tone: "success", message: "Programa de fidelidade configurado." });
    } catch (error) {
      setFeedback({
        tone: "danger",
        message: crmError(error, "Não foi possível configurar fidelidade."),
      });
    } finally {
      setBusy("");
    }
  }
  async function createCoupon(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy("coupon");
    setFeedback(null);
    try {
      await api.growth.createCoupon(scope.organizationId, {
        unitId: scope.unitId,
        code: couponCode.trim().toUpperCase(),
        type: couponType,
        value: couponType === "fixed" ? moneyToCents(couponValue) : Math.round(parsedCoupon * 100),
        minimumOrderCents: 0,
        channels: ["direct"],
        unitIds: [scope.unitId],
        perCustomerLimit: 1,
        active: true,
      });
      setCouponCode("");
      setCouponValue("");
      setFeedback({ tone: "success", message: "Cupom criado para esta unidade." });
      coupons.retry();
    } catch (error) {
      setFeedback({ tone: "danger", message: crmError(error, "Não foi possível criar o cupom.") });
    } finally {
      setBusy("");
    }
  }
  async function toggleCoupon(id: string, active: boolean) {
    setBusy(`coupon:${id}`);
    setFeedback(null);
    try {
      await api.growth.updateCoupon(scope.organizationId, id, { active: !active });
      setFeedback({ tone: "success", message: active ? "Cupom desativado." : "Cupom reativado." });
      coupons.retry();
    } catch (error) {
      setFeedback({
        tone: "danger",
        message: crmError(error, "Não foi possível atualizar o cupom."),
      });
    } finally {
      setBusy("");
    }
  }
  async function createSegment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy("segment");
    setFeedback(null);
    try {
      const threshold = Number(segmentThreshold.replace(",", "."));
      const filters =
        segmentKind === "birthday_month"
          ? { kind: segmentKind, month: Number(birthdayMonth) }
          : segmentKind === "inactive_days"
            ? { kind: segmentKind, days: threshold }
            : segmentKind === "minimum_visits"
              ? { kind: segmentKind, visits: threshold }
              : segmentKind === "minimum_spend_cents"
                ? { kind: segmentKind, amountCents: moneyToCents(segmentThreshold) }
                : segmentKind === "no_show_count"
                  ? { kind: segmentKind, count: threshold }
                  : { kind: segmentKind };
      await api.growth.createSegment(scope.organizationId, {
        name: segmentName.trim(),
        filters,
        active: true,
      });
      setSegmentName("");
      setSegmentThreshold("");
      setFeedback({ tone: "success", message: "Segmento salvo para uso em campanhas." });
      segments.retry();
    } catch (error) {
      setFeedback({
        tone: "danger",
        message: crmError(error, "Não foi possível criar o segmento."),
      });
    } finally {
      setBusy("");
    }
  }

  return (
    <section className="growth-stack" aria-labelledby="crm-benefits-heading">
      <div className="crm-observability gm-observability-row" aria-live="polite">
        <div>
          <Badge tone={refreshError ? "warning" : refreshing ? "info" : "success"}>
            {refreshError
              ? "Relacionamento pode estar desatualizado"
              : refreshing
                ? "Sincronizando relacionamento"
                : "Relacionamento persistido"}
          </Badge>
          <small>Fidelidade, benefícios, audiências e campanhas.</small>
        </div>
        <Button
          disabled={refreshing}
          onClick={() => {
            coupons.retry();
            segments.retry();
            campaigns.retry();
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
      <CrmFormPanel
        description="Selecione a audiência e salve o rascunho. Nenhum envio é presumido."
        title="Nova campanha"
      >
        <form className="action-form" onSubmit={(event) => void createCampaign(event)}>
          <label>
            Nome interno
            <Input
              minLength={2}
              onChange={(event) => setCampaignName(event.target.value)}
              required
              value={campaignName}
            />
          </label>
          <label>
            Segmento
            <NativeSelect
              onChange={(event) => setCampaignSegmentId(event.target.value)}
              value={campaignSegmentId}
            >
              <option value="">Marketing autorizado (padrão)</option>
              {segments.state.status === "ready" &&
                segments.state.data
                  .filter((segment) => segment.active)
                  .map((segment) => (
                    <option key={segment.id} value={segment.id}>
                      {segment.name}
                    </option>
                  ))}
            </NativeSelect>
          </label>
          <label>
            Canal
            <NativeSelect
              onChange={(event) => setCampaignChannel(event.target.value as "email" | "whatsapp")}
              value={campaignChannel}
            >
              <option value="email">E-mail</option>
              <option value="whatsapp">WhatsApp</option>
            </NativeSelect>
          </label>
          {campaignChannel === "email" && (
            <label>
              Assunto
              <Input
                minLength={2}
                onChange={(event) => setCampaignSubject(event.target.value)}
                required
                value={campaignSubject}
              />
            </label>
          )}
          <label className="action-form__wide">
            Conteúdo
            <Textarea
              maxLength={5000}
              minLength={2}
              onChange={(event) => setCampaignContent(event.target.value)}
              required
              rows={4}
              value={campaignContent}
            />
          </label>
          <label className="action-form__wide">
            Variação B (opcional)
            <Textarea
              maxLength={5000}
              onChange={(event) => setCampaignVariantB(event.target.value)}
              placeholder="Quando preenchida, divide a audiência entre A e B de forma estável."
              rows={4}
              value={campaignVariantB}
            />
          </label>
          <label>
            Janela de atribuição (dias)
            <Input
              type="number"
              min="1"
              max="90"
              value={attributionWindowDays}
              onChange={(event) => setAttributionWindowDays(event.target.value)}
            />
          </label>
          <label>
            Grupo de controle (%)
            <Input
              type="number"
              min="0"
              max="50"
              value={holdoutPercentage}
              onChange={(event) => setHoldoutPercentage(event.target.value)}
            />
          </label>
          <Button
            disabled={
              busy === "campaign" ||
              campaignName.trim().length < 2 ||
              campaignContent.trim().length < 2 ||
              (campaignChannel === "email" && campaignSubject.trim().length < 2)
            }
            type="submit"
          >
            {busy === "campaign" ? "Salvando…" : "Salvar rascunho"}
          </Button>
        </form>
      </CrmFormPanel>
      <div className="quick-actions-grid">
        <CrmFormPanel
          description="Configure pontos ou cashback da organização."
          title="Programa de fidelidade"
        >
          <form className="action-form" onSubmit={(event) => void createLoyalty(event)}>
            <label>
              Modalidade
              <NativeSelect
                onChange={(event) => setLoyaltyMode(event.target.value as "points" | "cashback")}
                value={loyaltyMode}
              >
                <option value="points">Pontos</option>
                <option value="cashback">Cashback</option>
              </NativeSelect>
            </label>
            <label>
              Taxa
              <Input
                inputMode="decimal"
                onChange={(event) => setLoyaltyRate(event.target.value)}
                required
                value={loyaltyRate}
              />
            </label>
            <label>
              Pedido mínimo
              <Input
                inputMode="decimal"
                onChange={(event) => setLoyaltyMinimum(event.target.value)}
                required
                value={loyaltyMinimum}
                data-currency="brl"
              />
            </label>
            <Button
              disabled={
                busy === "loyalty" ||
                Number(loyaltyRate.replace(",", ".")) <= 0 ||
                moneyToCents(loyaltyMinimum) < 0
              }
              type="submit"
            >
              {busy === "loyalty" ? "Salvando…" : "Salvar programa"}
            </Button>
          </form>
        </CrmFormPanel>
        <CrmFormPanel description="Crie benefício limitado à unidade atual." title="Novo cupom">
          <form className="action-form" onSubmit={(event) => void createCoupon(event)}>
            <label>
              Código
              <Input
                minLength={3}
                onChange={(event) =>
                  setCouponCode(event.target.value.replace(/[^A-Za-z0-9_-]/g, ""))
                }
                required
                value={couponCode}
              />
            </label>
            <label>
              Tipo
              <NativeSelect
                onChange={(event) => setCouponType(event.target.value as "fixed" | "percentage")}
                value={couponType}
              >
                <option value="fixed">Valor fixo</option>
                <option value="percentage">Percentual</option>
              </NativeSelect>
            </label>
            <label>
              {couponType === "fixed" ? "Valor" : "Percentual"}
              <Input
                aria-invalid={couponValue.length > 0 && couponInvalid}
                inputMode="decimal"
                data-currency={couponType === "fixed" ? "brl" : undefined}
                onChange={(event) => setCouponValue(event.target.value)}
                required
                value={couponValue}
              />
              {couponValue.length > 0 && couponInvalid && (
                <small className="crm-field-error" role="alert">
                  Informe valor maior que zero; percentual deve ser no máximo 100.
                </small>
              )}
            </label>
            <Button
              disabled={busy === "coupon" || couponCode.length < 3 || couponInvalid}
              type="submit"
            >
              {busy === "coupon" ? "Criando…" : "Criar cupom"}
            </Button>
          </form>
        </CrmFormPanel>
        <CrmFormPanel
          description="Defina uma audiência persistida para campanhas."
          title="Novo segmento"
        >
          <form className="action-form" onSubmit={(event) => void createSegment(event)}>
            <label>
              Nome
              <Input
                minLength={2}
                onChange={(event) => setSegmentName(event.target.value)}
                required
                value={segmentName}
              />
            </label>
            <label>
              Filtro
              <NativeSelect
                onChange={(event) => setSegmentKind(event.target.value as SegmentKind)}
                value={segmentKind}
              >
                <option value="marketing_opt_in">Marketing autorizado</option>
                <option value="birthday_month">Aniversariantes do mês</option>
                <option value="inactive_days">Inativos há X dias</option>
                <option value="minimum_visits">Mínimo de visitas</option>
                <option value="minimum_spend_cents">Gasto mínimo</option>
                <option value="no_show_count">Mínimo de no-shows</option>
                <option value="all">Todos os clientes</option>
              </NativeSelect>
            </label>
            {segmentKind === "birthday_month" && (
              <label>
                Mês
                <NativeSelect
                  onChange={(event) => setBirthdayMonth(event.target.value)}
                  value={birthdayMonth}
                >
                  {months.map((month) => (
                    <option key={month.value} value={month.value}>
                      {month.label}
                    </option>
                  ))}
                </NativeSelect>
              </label>
            )}
            {needsThreshold && (
              <label>
                {segmentKind === "inactive_days"
                  ? "Dias sem visita"
                  : segmentKind === "minimum_visits"
                    ? "Quantidade de visitas"
                    : segmentKind === "minimum_spend_cents"
                      ? "Gasto mínimo"
                      : "Quantidade de no-shows"}
                <Input
                  aria-invalid={segmentThreshold.length > 0 && thresholdInvalid}
                  inputMode="decimal"
                  data-currency={segmentKind === "minimum_spend_cents" ? "brl" : undefined}
                  onChange={(event) => setSegmentThreshold(event.target.value)}
                  required
                  value={segmentThreshold}
                />
                {segmentThreshold.length > 0 && thresholdInvalid && (
                  <small className="crm-field-error" role="alert">
                    Informe um valor maior que zero.
                  </small>
                )}
              </label>
            )}
            <Button
              disabled={busy === "segment" || segmentName.trim().length < 2 || thresholdInvalid}
              type="submit"
            >
              {busy === "segment" ? "Salvando…" : "Salvar segmento"}
            </Button>
          </form>
        </CrmFormPanel>
      </div>
      <div className="crm-assets-grid">
        <Card>
          <div className="section-title">
            <div>
              <p className="eyebrow">Benefícios</p>
              <h2 id="crm-benefits-heading">Cupons</h2>
            </div>
            {coupons.state.status === "ready" && (
              <Badge tone="neutral">{coupons.state.data.length}</Badge>
            )}
          </div>
          <RemoteGate remote={coupons}>
            {(rows) =>
              rows.length === 0 ? (
                <EmptyState
                  description="Crie um cupom para a unidade atual."
                  icon={<Icon name="catalog" size={26} />}
                  title="Sem cupons"
                />
              ) : (
                <div className="data-list">
                  {rows.map((coupon) => (
                    <article className="data-row" key={coupon.id}>
                      <div>
                        <strong>{coupon.code}</strong>
                        <small>
                          {coupon.type === "fixed"
                            ? crmCurrency.format(coupon.value / 100)
                            : `${String(coupon.value / 100)}%`}
                          {` · limite ${coupon.perCustomerLimit} por cliente`}
                        </small>
                      </div>
                      <div className="data-row__end">
                        <Badge tone={coupon.active ? "success" : "neutral"}>
                          {coupon.active ? "Ativo" : "Inativo"}
                        </Badge>
                        <Button
                          disabled={busy === `coupon:${coupon.id}`}
                          onClick={() => void toggleCoupon(coupon.id, coupon.active)}
                          size="sm"
                          variant="secondary"
                        >
                          {coupon.active ? "Desativar" : "Reativar"}
                        </Button>
                      </div>
                    </article>
                  ))}
                </div>
              )
            }
          </RemoteGate>
        </Card>
        <Card>
          <div className="section-title">
            <div>
              <p className="eyebrow">Audiências</p>
              <h2>Segmentos</h2>
            </div>
            {segments.state.status === "ready" && (
              <Badge tone="neutral">{segments.state.data.length}</Badge>
            )}
          </div>
          <RemoteGate remote={segments}>
            {(rows) =>
              rows.length === 0 ? (
                <EmptyState
                  description="Crie uma audiência antes de direcionar campanhas."
                  icon={<Icon name="people" size={26} />}
                  title="Sem segmentos"
                />
              ) : (
                <div className="data-list">
                  {rows.map((segment) => (
                    <article className="data-row" key={segment.id}>
                      <div>
                        <strong>{segment.name}</strong>
                        <small>{segmentLabel(segment.kind)}</small>
                      </div>
                      <Badge tone={segment.active ? "success" : "neutral"}>
                        {segment.active ? "Ativo" : "Inativo"}
                      </Badge>
                    </article>
                  ))}
                </div>
              )
            }
          </RemoteGate>
        </Card>
        <Card>
          <div className="section-title">
            <div>
              <p className="eyebrow">Comunicação</p>
              <h2>Campanhas</h2>
            </div>
            {campaigns.state.status === "ready" && (
              <Badge tone="neutral">{campaigns.state.data.length}</Badge>
            )}
          </div>
          <p className="muted">
            Revise audiência e provedor antes de enfileirar; entrega só conta quando persistida.
          </p>
          <RemoteGate remote={campaigns}>
            {(rows) =>
              rows.length === 0 ? (
                <EmptyState
                  description="Nenhuma campanha foi criada para esta organização."
                  icon={<Icon name="alerts" size={26} />}
                  title="Sem campanhas"
                />
              ) : (
                <div className="data-list">
                  {rows.map((campaign) => {
                    const status = campaignStatus(campaign);
                    const audience = campaign.segmentId
                      ? (segmentNames.get(campaign.segmentId) ?? "Segmento associado")
                      : "Marketing autorizado";
                    return (
                      <article className="data-row" key={campaign.id}>
                        <div>
                          <strong>{campaign.name}</strong>
                          <small>{`${campaign.channel === "email" ? "E-mail" : "WhatsApp"} · ${audience}`}</small>
                        </div>
                        <div className="data-row__end">
                          <Badge tone={status.tone}>{status.label}</Badge>
                          <Button
                            disabled={busy === "review"}
                            onClick={() => void loadReview(campaign.id)}
                            size="sm"
                            variant="secondary"
                          >
                            {reviewedId === campaign.id ? "Atualizar revisão" : "Revisar"}
                          </Button>
                        </div>
                      </article>
                    );
                  })}
                </div>
              )
            }
          </RemoteGate>
        </Card>
      </div>
      {reviewedId && (
        <Card aria-labelledby="crm-campaign-review-title" className="crm-campaign-review">
          <div className="section-title">
            <div>
              <p className="eyebrow">Prévia e entregas</p>
              <h2 id="crm-campaign-review-title">{reviewed?.name ?? "Revisão da campanha"}</h2>
            </div>
            <Button
              onClick={() => {
                setReviewedId("");
                setPreview(null);
                setDeliveries(null);
              }}
              size="sm"
              variant="ghost"
            >
              Fechar
            </Button>
          </div>
          {busy === "review" && !preview ? (
            <div className="remote-state" role="status">
              <span className="spinner" aria-hidden="true" />
              <strong>Calculando audiência e entregas persistidas…</strong>
            </div>
          ) : preview && reviewed ? (
            <>
              <dl className="crm-campaign-metrics">
                <div>
                  <dt>Clientes ativos</dt>
                  <dd>{preview.activeCustomers}</dd>
                </div>
                <div>
                  <dt>Elegíveis</dt>
                  <dd>{preview.eligibleRecipients}</dd>
                </div>
                <div>
                  <dt>Excluídos</dt>
                  <dd>{preview.excludedRecipients}</dd>
                </div>
                <div>
                  <dt>Limite</dt>
                  <dd>{preview.recipientLimit}</dd>
                </div>
              </dl>
              {!preview.provider.ready ? (
                <Callout tone="warning">
                  {preview.provider.unavailableCode === "CAMPAIGN_CHANNEL_NOT_HOMOLOGATED"
                    ? "WhatsApp ainda não está homologado; o envio permanece bloqueado."
                    : "O provedor deste canal não está configurado; o envio permanece bloqueado."}
                </Callout>
              ) : preview.exceedsRecipientLimit ? (
                <Callout tone="danger">
                  A audiência excede o limite de {preview.recipientLimit} destinatários. Refine o
                  segmento.
                </Callout>
              ) : preview.eligibleRecipients === 0 ? (
                <Callout tone="warning">
                  Nenhum destinatário elegível após consentimentos e contatos válidos.
                </Callout>
              ) : (
                <Callout tone="success">
                  Provedor disponível e audiência dentro do limite operacional.
                </Callout>
              )}
              {["draft", "blocked"].includes(reviewed.status) && (
                <div className="crm-campaign-actions">
                  <label className="crm-confirmation">
                    <Checkbox
                      checked={queueConfirmed}
                      disabled={!canQueue}
                      onChange={(event) => setQueueConfirmed(event.target.checked)}
                    />
                    Confirmo o envio para {preview.eligibleRecipients} destinatário(s) elegível(is).
                  </label>
                  <Button
                    disabled={!canQueue || !queueConfirmed || busy === "queue"}
                    onClick={() => void queueCampaign()}
                  >
                    {busy === "queue" ? "Enfileirando…" : "Enfileirar campanha"}
                  </Button>
                </div>
              )}
              {canCancel && (
                <div className="crm-campaign-cancel">
                  <label>
                    Motivo do cancelamento
                    <Input
                      minLength={3}
                      onChange={(event) => setCancelReason(event.target.value)}
                      placeholder="Registre o motivo para auditoria"
                      value={cancelReason}
                    />
                  </label>
                  <Button
                    disabled={cancelReason.trim().length < 3 || busy === "cancel"}
                    onClick={() => void cancelCampaign()}
                    variant="danger"
                  >
                    {busy === "cancel" ? "Cancelando…" : "Cancelar campanha"}
                  </Button>
                </div>
              )}
              <div className="crm-profile__section">
                {deliveries ? (
                  <dl className="crm-campaign-metrics" aria-label="Atribuição da campanha">
                    <div>
                      <dt>Entregues</dt>
                      <dd>{deliveries.attribution.delivered}</dd>
                    </div>
                    <div>
                      <dt>Lidas</dt>
                      <dd>{deliveries.attribution.read}</dd>
                    </div>
                    <div>
                      <dt>Respostas</dt>
                      <dd>{deliveries.attribution.replied}</dd>
                    </div>
                    <div>
                      <dt>Pedidos</dt>
                      <dd>{deliveries.attribution.orders}</dd>
                    </div>
                    <div>
                      <dt>Cupons</dt>
                      <dd>{deliveries.attribution.coupons}</dd>
                    </div>
                    <div>
                      <dt>Receita atribuída</dt>
                      <dd>{crmCurrency.format(deliveries.attribution.revenueCents / 100)}</dd>
                    </div>
                  </dl>
                ) : null}
                {deliveries?.experiments.length ? (
                  <fieldset className="crm-experiment-grid">
                    <legend>Resultado por variação</legend>
                    {deliveries.experiments.map((experiment) => (
                      <article key={experiment.variant}>
                        <strong>
                          {experiment.variant === "control"
                            ? "Controle"
                            : `Variação ${experiment.variant.toUpperCase()}`}
                        </strong>
                        <small>{experiment.recipients} destinatário(s)</small>
                        <span>
                          {experiment.orders} pedido(s) ·{" "}
                          {crmCurrency.format(experiment.revenueCents / 100)}
                        </span>
                      </article>
                    ))}
                  </fieldset>
                ) : null}
                <div className="crm-section-heading">
                  <div>
                    <strong>Entregas</strong>
                    <small>{deliveries?.deliveries.length ?? 0} registro(s) recente(s)</small>
                  </div>
                  <div className="crm-delivery-counts">
                    {deliveries &&
                      Object.entries(deliveries.counts).map(([status, total]) => (
                        <Badge
                          key={status}
                          tone={
                            status === "sent"
                              ? "success"
                              : status === "failed"
                                ? "danger"
                                : "neutral"
                          }
                        >
                          {status}: {total}
                        </Badge>
                      ))}
                  </div>
                </div>
                {!deliveries || deliveries.deliveries.length === 0 ? (
                  <div className="crm-inline-empty">
                    <Icon name="alerts" size={18} />
                    <p>Nenhuma entrega foi materializada para esta campanha.</p>
                  </div>
                ) : (
                  <div className="data-list">
                    {deliveries.deliveries.slice(0, 20).map((delivery) => (
                      <article className="data-row" key={delivery.id}>
                        <div>
                          <strong>{delivery.customerName}</strong>
                          <small>
                            {delivery.sentAt
                              ? dateTime(delivery.sentAt)
                              : dateTime(delivery.createdAt)}
                            {` · ${delivery.experimentVariant === "control" ? "controle" : `variação ${delivery.experimentVariant.toUpperCase()}`}`}
                            {delivery.errorCode ? ` · ${delivery.errorCode}` : ""}
                          </small>
                        </div>
                        <Badge
                          tone={
                            delivery.status === "sent"
                              ? "success"
                              : delivery.status === "failed"
                                ? "danger"
                                : "neutral"
                          }
                        >
                          {delivery.status}
                        </Badge>
                      </article>
                    ))}
                  </div>
                )}
              </div>
            </>
          ) : (
            <Callout tone="danger">
              Não foi possível obter a prévia. Atualize a revisão antes do envio.
            </Callout>
          )}
        </Card>
      )}
    </section>
  );
}
