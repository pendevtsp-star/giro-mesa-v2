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
import { type FormEvent, useEffect, useMemo, useRef, useState } from "react";
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
  type CrmLoyaltyProgram,
  parseCrmCampaignDeliveries,
  parseCrmCampaignReview,
  parseCrmCampaigns,
  parseCrmCoupons,
  parseCrmLoyaltyProgram,
  parseCrmSegments,
} from "./crm.model";
import { type CrmFeedback, CrmFormPanel, crmCurrency, crmError, crmFailureMessage } from "./crm.ui";

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
const deliveryStatuses: Record<string, string> = {
  pending: "Pendente",
  blocked: "Envio bloqueado",
  sent: "Enviada",
  failed: "Falha no envio",
  skipped: "Não enviada",
  holdout: "Grupo de controle",
};

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
    known[campaign.status as keyof typeof known] ?? {
      label: "Situação indisponível",
      tone: "warning",
    }
  );
}
function segmentLabel(kind: string): string {
  const labels: Record<string, string> = {
    marketing_opt_in: "Com autorização para campanhas",
    birthday_month: "Aniversariantes do mês",
    inactive_days: "Clientes inativos",
    minimum_visits: "Frequência mínima",
    minimum_spend_cents: "Gasto mínimo",
    no_show_count: "Histórico de faltas",
    all: "Todos os clientes",
  };
  return labels[kind] ?? "Grupo de clientes";
}

type LoyaltyProgramInput = Parameters<typeof api.growth.createLoyaltyProgram>[1];

export function CrmLoyaltyProgramForm({
  program,
  disabled,
  saving,
  onSave,
}: {
  program: CrmLoyaltyProgram | null;
  disabled: boolean;
  saving: boolean;
  onSave: (input: LoyaltyProgramInput) => Promise<void>;
}) {
  const [mode, setMode] = useState<"points" | "cashback">(program?.mode ?? "points");
  const [rate, setRate] = useState(program ? String(program.rate).replace(".", ",") : "");
  const [minimum, setMinimum] = useState(
    ((program?.minimumOrderCents ?? 0) / 100).toFixed(2).replace(".", ","),
  );
  const [expiry, setExpiry] = useState(String(program?.expiresAfterDays ?? ""));
  const [active, setActive] = useState(program?.active ?? true);
  const parsedRate = Number(rate.replace(",", "."));
  const minimumOrderCents = moneyToCents(minimum);
  const expiresAfterDays = expiry.trim() ? Number(expiry) : undefined;
  const invalid =
    !Number.isFinite(parsedRate) ||
    parsedRate <= 0 ||
    parsedRate > 10_000 ||
    !minimum.trim() ||
    !Number.isSafeInteger(minimumOrderCents) ||
    minimumOrderCents < 0 ||
    (expiresAfterDays !== undefined &&
      (!Number.isInteger(expiresAfterDays) || expiresAfterDays < 1 || expiresAfterDays > 3650));
  return (
    <form
      className="action-form"
      onSubmit={(event) => {
        event.preventDefault();
        if (disabled || invalid) return;
        void onSave({ mode, rate: parsedRate, minimumOrderCents, expiresAfterDays, active });
      }}
    >
      <div className="action-form__wide">
        <Badge tone={program?.active ? "success" : "neutral"}>
          {program
            ? program.active
              ? "Programa ativo"
              : "Programa desativado"
            : "Nenhum programa configurado"}
        </Badge>
      </div>
      <label>
        Modalidade
        <NativeSelect
          disabled={disabled}
          onChange={(event) => setMode(event.target.value as "points" | "cashback")}
          value={mode}
        >
          <option value="points">Pontos</option>
          <option value="cashback">Crédito de volta</option>
        </NativeSelect>
      </label>
      <label>
        {mode === "points" ? "Pontos por R$ 1,00" : "Crédito de volta (%)"}
        <Input
          disabled={disabled}
          inputMode="decimal"
          onChange={(event) => setRate(event.target.value)}
          required
          value={rate}
        />
      </label>
      <label>
        Pedido mínimo
        <Input
          disabled={disabled}
          inputMode="decimal"
          onChange={(event) => setMinimum(event.target.value)}
          required
          value={minimum}
          data-currency="brl"
        />
      </label>
      <label>
        Validade do saldo (dias)
        <Input
          disabled={disabled}
          type="number"
          min="1"
          max="3650"
          onChange={(event) => setExpiry(event.target.value)}
          value={expiry}
          placeholder="Sem prazo de validade"
        />
      </label>
      <label className="crm-confirmation action-form__wide">
        <Checkbox
          checked={active}
          disabled={disabled}
          onChange={(event) => setActive(event.target.checked)}
        />
        Programa ativo
      </label>
      <Button disabled={disabled || invalid} type="submit">
        {saving ? "Salvando…" : "Salvar programa"}
      </Button>
    </form>
  );
}

export function CrmCampaignMessagePreview({ campaign }: { campaign: CrmCampaign }) {
  return (
    <section className="crm-profile__section" aria-label="Mensagem salva da campanha">
      <div className="crm-section-heading">
        <strong>Mensagem salva</strong>
      </div>
      {campaign.channel === "email" && (
        <p>
          <strong>Assunto:</strong> {campaign.subject ?? "Não informado"}
        </p>
      )}
      {campaign.variantBContent && <strong>Variação A</strong>}
      <p className="crm-notes">{campaign.content}</p>
      {campaign.variantBContent && (
        <>
          <strong>Variação B</strong>
          <p className="crm-notes">{campaign.variantBContent}</p>
        </>
      )}
      <p className="muted">
        Resultados acompanhados por {campaign.attributionWindowDays} dia(s). Grupo de controle:{" "}
        {campaign.holdoutPercentage}%.
      </p>
    </section>
  );
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
  const loyalty = useRemote(
    scope,
    () => api.growth.loyaltyProgram(scope.organizationId),
    parseCrmLoyaltyProgram,
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
  const [reviewLoading, setReviewLoading] = useState(false);
  const [reviewAction, setReviewAction] = useState<"queue" | "cancel" | null>(null);
  const [loadingMoreDeliveries, setLoadingMoreDeliveries] = useState(false);
  const [reviewScope, setReviewScope] = useState("");
  const reviewRequest = useRef(0);
  const scopeKey = `${scope.organizationId}:${scope.unitId}`;
  const currentScope = useRef(scopeKey);
  currentScope.current = scopeKey;
  useEffect(() => {
    void scopeKey;
    return () => {
      reviewRequest.current += 1;
    };
  }, [scopeKey]);

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
    reviewScope === scopeKey && deliveries?.campaign.id === reviewedId ? deliveries.campaign : null;
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
    !reviewLoading &&
    !loadingMoreDeliveries &&
    !reviewAction &&
    preview?.campaignId === reviewed?.id &&
    preview?.channel === reviewed?.channel &&
    (reviewed?.channel !== "email" || Boolean(reviewed.subject)) &&
    ["draft", "blocked"].includes(reviewed?.status ?? "") &&
    preview?.provider.ready === true &&
    preview.eligibleRecipients > 0 &&
    !preview.exceedsRecipientLimit;
  const canCancel = Boolean(reviewed && !["sending", "sent", "canceled"].includes(reviewed.status));
  const refreshing =
    coupons.refreshing || segments.refreshing || campaigns.refreshing || loyalty.refreshing;
  const refreshError =
    coupons.refreshError ?? segments.refreshError ?? campaigns.refreshError ?? loyalty.refreshError;

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
    const request = ++reviewRequest.current;
    setReviewedId(id);
    setReviewScope(scopeKey);
    setPreview(null);
    setDeliveries(null);
    setLoadingMoreDeliveries(false);
    setQueueConfirmed(false);
    setCancelReason("");
    setReviewLoading(true);
    setFeedback(null);
    try {
      const [previewPayload, deliveryPayload] = await Promise.all([
        api.growth.campaignPreview(scope.organizationId, id),
        api.growth.campaignDeliveries(scope.organizationId, id, { limit: 20 }),
      ]);
      const next = parseCrmCampaignReview(id, previewPayload, deliveryPayload);
      if (request !== reviewRequest.current || currentScope.current !== scopeKey) return false;
      setPreview(next.preview);
      setDeliveries(next.deliveries);
      return true;
    } catch (error) {
      if (request !== reviewRequest.current || currentScope.current !== scopeKey) return false;
      setFeedback({
        tone: "danger",
        message: crmError(error, "Não foi possível revisar a campanha."),
      });
      return false;
    } finally {
      if (request === reviewRequest.current) setReviewLoading(false);
    }
  }
  async function loadMoreDeliveries() {
    if (
      !deliveries ||
      deliveries.nextOffset === null ||
      loadingMoreDeliveries ||
      reviewLoading ||
      reviewAction
    )
      return;
    const request = reviewRequest.current;
    const offset = deliveries.nextOffset;
    setLoadingMoreDeliveries(true);
    setFeedback(null);
    try {
      const page = parseCrmCampaignDeliveries(
        await api.growth.campaignDeliveries(scope.organizationId, reviewedId, {
          limit: 20,
          offset,
        }),
      );
      if (request !== reviewRequest.current || currentScope.current !== scopeKey) return;
      if (
        page.campaign.id !== reviewedId ||
        page.campaign.channel !== deliveries.campaign.channel ||
        page.offset !== offset
      )
        throw new Error(
          "Não foi possível confirmar a próxima página de entregas. Atualize a revisão.",
        );
      setDeliveries((current) => {
        if (!current) return current;
        const loadedIds = new Set(current.deliveries.map((delivery) => delivery.id));
        return {
          ...page,
          deliveries: [
            ...current.deliveries,
            ...page.deliveries.filter((delivery) => !loadedIds.has(delivery.id)),
          ],
        };
      });
      setQueueConfirmed(false);
    } catch (error) {
      if (request !== reviewRequest.current || currentScope.current !== scopeKey) return;
      setFeedback({
        tone: "danger",
        message: crmError(error, "Não foi possível carregar mais entregas."),
      });
    } finally {
      if (request === reviewRequest.current) setLoadingMoreDeliveries(false);
    }
  }
  async function queueCampaign() {
    if (!reviewed || !preview || !queueConfirmed || !canQueue) return;
    const request = reviewRequest.current;
    setReviewAction("queue");
    setFeedback(null);
    try {
      await api.growth.queueCampaign(scope.organizationId, reviewed.id);
      if (request !== reviewRequest.current || currentScope.current !== scopeKey) return;
      setQueueConfirmed(false);
      campaigns.retry();
      if (!(await loadReview(reviewed.id))) return;
      setFeedback({
        tone: "success",
        message: "Campanha na fila de envio. Acompanhe abaixo a confirmação das entregas.",
      });
    } catch (error) {
      if (request !== reviewRequest.current || currentScope.current !== scopeKey) return;
      setFeedback({
        tone: "danger",
        message: crmError(error, "Não foi possível iniciar o envio da campanha."),
      });
    } finally {
      setReviewAction(null);
    }
  }
  async function cancelCampaign() {
    if (
      !reviewed ||
      reviewLoading ||
      loadingMoreDeliveries ||
      reviewAction ||
      cancelReason.trim().length < 3
    )
      return;
    const request = reviewRequest.current;
    setReviewAction("cancel");
    setFeedback(null);
    try {
      await api.growth.cancelCampaign(scope.organizationId, reviewed.id, {
        reason: cancelReason.trim(),
      });
      if (request !== reviewRequest.current || currentScope.current !== scopeKey) return;
      setCancelReason("");
      setQueueConfirmed(false);
      campaigns.retry();
      if (!(await loadReview(reviewed.id))) return;
      setFeedback({
        tone: "success",
        message: "Campanha cancelada. A justificativa foi registrada.",
      });
    } catch (error) {
      if (request !== reviewRequest.current || currentScope.current !== scopeKey) return;
      setFeedback({
        tone: "danger",
        message: crmError(error, "Não foi possível cancelar a campanha."),
      });
    } finally {
      setReviewAction(null);
    }
  }
  async function createLoyalty(input: LoyaltyProgramInput) {
    if (
      loyalty.state.status !== "ready" ||
      loyalty.refreshing ||
      loyalty.refreshError ||
      busy === "loyalty"
    )
      return;
    setBusy("loyalty");
    setFeedback(null);
    try {
      const saved = parseCrmLoyaltyProgram(
        await api.growth.createLoyaltyProgram(scope.organizationId, input),
      );
      if (!saved)
        throw new Error("Não foi possível confirmar os dados salvos. Atualize o programa.");
      if (currentScope.current !== scopeKey) return;
      loyalty.update(() => saved);
      setFeedback({ tone: "success", message: "Programa de fidelidade configurado." });
    } catch (error) {
      if (currentScope.current !== scopeKey) return;
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
      setFeedback({ tone: "success", message: "Grupo de clientes salvo para uso em campanhas." });
      segments.retry();
    } catch (error) {
      setFeedback({
        tone: "danger",
        message: crmError(error, "Não foi possível criar o grupo de clientes."),
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
                : "Benefícios e campanhas atualizados"}
          </Badge>
          <small>Fidelidade, benefícios, grupos de clientes e campanhas.</small>
        </div>
        <Button
          disabled={refreshing}
          onClick={() => {
            coupons.retry();
            segments.retry();
            campaigns.retry();
            loyalty.retry();
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
        description="Selecione o público e salve o rascunho para revisar antes do envio."
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
            Grupo de clientes
            <NativeSelect
              onChange={(event) => setCampaignSegmentId(event.target.value)}
              value={campaignSegmentId}
            >
              <option value="">Clientes com autorização</option>
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
          <details
            className="gm-disclosure action-form__wide"
            onInvalidCapture={(event) => {
              event.currentTarget.open = true;
            }}
          >
            <summary>Comparar mensagens e acompanhar resultados</summary>
            <div className="gm-disclosure__content gm-form-grid gm-form-grid--split">
              <label className="action-form__wide">
                Variação B (opcional)
                <Textarea
                  maxLength={5000}
                  onChange={(event) => setCampaignVariantB(event.target.value)}
                  placeholder="Mensagem alternativa para comparar resultados entre dois grupos de clientes."
                  rows={4}
                  value={campaignVariantB}
                />
              </label>
              <label>
                Prazo para acompanhar resultados (dias)
                <Input
                  type="number"
                  min="1"
                  max="90"
                  required
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
                  required
                  value={holdoutPercentage}
                  onChange={(event) => setHoldoutPercentage(event.target.value)}
                />
              </label>
            </div>
          </details>
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
          description="Configure pontos ou crédito de volta para seus clientes."
          title="Programa de fidelidade"
        >
          <RemoteGate remote={loyalty}>
            {(program) => (
              <>
                {loyalty.refreshError && (
                  <Callout tone="warning">
                    Não foi possível atualizar o programa. Atualize os dados antes de salvar
                    alterações.
                  </Callout>
                )}
                <CrmLoyaltyProgramForm
                  key={`${scope.organizationId}:${program?.id ?? "new"}`}
                  program={program}
                  disabled={
                    busy === "loyalty" || loyalty.refreshing || Boolean(loyalty.refreshError)
                  }
                  saving={busy === "loyalty"}
                  onSave={createLoyalty}
                />
              </>
            )}
          </RemoteGate>
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
          description="Defina um grupo de clientes para suas campanhas."
          title="Novo grupo de clientes"
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
                <option value="marketing_opt_in">Com autorização para campanhas</option>
                <option value="birthday_month">Aniversariantes do mês</option>
                <option value="inactive_days">Inativos há X dias</option>
                <option value="minimum_visits">Mínimo de visitas</option>
                <option value="minimum_spend_cents">Gasto mínimo</option>
                <option value="no_show_count">Mínimo de faltas</option>
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
                      : "Quantidade de faltas"}
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
              {busy === "segment" ? "Salvando…" : "Salvar grupo"}
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
              <p className="eyebrow">Público</p>
              <h2>Grupos de clientes</h2>
            </div>
            {segments.state.status === "ready" && (
              <Badge tone="neutral">{segments.state.data.length}</Badge>
            )}
          </div>
          <RemoteGate remote={segments}>
            {(rows) =>
              rows.length === 0 ? (
                <EmptyState
                  description="Crie um grupo para direcionar suas campanhas."
                  icon={<Icon name="people" size={26} />}
                  title="Sem grupos de clientes"
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
            Revise os destinatários e a disponibilidade do canal antes de iniciar o envio.
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
                      ? (segmentNames.get(campaign.segmentId) ?? "Grupo associado")
                      : "Com autorização para campanhas";
                    return (
                      <article className="data-row" key={campaign.id}>
                        <div>
                          <strong>{campaign.name}</strong>
                          <small>{`${campaign.channel === "email" ? "E-mail" : "WhatsApp"} · ${audience}`}</small>
                        </div>
                        <div className="data-row__end">
                          <Badge tone={status.tone}>{status.label}</Badge>
                          <Button
                            disabled={Boolean(reviewAction)}
                            onClick={() => void loadReview(campaign.id)}
                            size="sm"
                            variant="secondary"
                          >
                            {reviewedId === campaign.id && reviewLoading
                              ? "Consultando…"
                              : reviewedId === campaign.id
                                ? "Atualizar revisão"
                                : "Revisar"}
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
      {reviewedId && reviewScope === scopeKey && (
        <Card aria-labelledby="crm-campaign-review-title" className="crm-campaign-review">
          <div className="section-title">
            <div>
              <p className="eyebrow">Prévia e entregas</p>
              <h2 id="crm-campaign-review-title">{reviewed?.name ?? "Revisão da campanha"}</h2>
            </div>
            <Button
              onClick={() => {
                reviewRequest.current += 1;
                setReviewedId("");
                setPreview(null);
                setDeliveries(null);
                setQueueConfirmed(false);
                setReviewLoading(false);
              }}
              size="sm"
              variant="ghost"
            >
              Fechar
            </Button>
          </div>
          {reviewLoading ? (
            <div className="remote-state" role="status">
              <span className="spinner" aria-hidden="true" />
              <strong>Consultando destinatários e entregas…</strong>
            </div>
          ) : preview && reviewed ? (
            <>
              <CrmCampaignMessagePreview campaign={reviewed} />
              <dl className="crm-campaign-metrics">
                <div>
                  <dt>Clientes ativos</dt>
                  <dd>{preview.activeCustomers}</dd>
                </div>
                <div>
                  <dt>Podem receber</dt>
                  <dd>{preview.eligibleRecipients}</dd>
                </div>
                <div>
                  <dt>Fora do envio</dt>
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
                    ? "O envio de campanhas pelo WhatsApp ainda não foi liberado. Solicite a ativação ao responsável pelo sistema."
                    : "Este canal ainda não está disponível para envio. Solicite a configuração ao responsável pelo sistema."}
                </Callout>
              ) : preview.exceedsRecipientLimit ? (
                <Callout tone="danger">
                  O público excede o limite de {preview.recipientLimit} destinatários. Escolha um
                  grupo menor.
                </Callout>
              ) : preview.eligibleRecipients === 0 ? (
                <Callout tone="warning">
                  Nenhum cliente deste grupo tem autorização e contato válido para receber a
                  campanha.
                </Callout>
              ) : (
                <Callout tone="success">
                  Canal disponível e quantidade de destinatários dentro do limite de envio.
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
                    Confirmo o envio para {preview.eligibleRecipients} destinatário(s).
                  </label>
                  <Button
                    disabled={!canQueue || !queueConfirmed}
                    onClick={() => void queueCampaign()}
                  >
                    {reviewAction === "queue" ? "Adicionando à fila…" : "Iniciar envio"}
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
                      placeholder="Informe por que a campanha será cancelada"
                      value={cancelReason}
                    />
                  </label>
                  <Button
                    disabled={
                      cancelReason.trim().length < 3 ||
                      loadingMoreDeliveries ||
                      Boolean(reviewAction)
                    }
                    onClick={() => void cancelCampaign()}
                    variant="danger"
                  >
                    {reviewAction === "cancel" ? "Cancelando…" : "Cancelar campanha"}
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
                      <dt>Receita atribuída líquida</dt>
                      <dd>{crmCurrency.format(deliveries.attribution.revenueCents / 100)}</dd>
                    </div>
                    <div>
                      <dt>Custo histórico</dt>
                      <dd>
                        {deliveries.attribution.costCents === null
                          ? "—"
                          : crmCurrency.format(deliveries.attribution.costCents / 100)}
                      </dd>
                    </div>
                    <div>
                      <dt>Margem bruta atribuída</dt>
                      <dd>
                        {deliveries.attribution.grossMarginCents === null
                          ? "—"
                          : crmCurrency.format(deliveries.attribution.grossMarginCents / 100)}
                      </dd>
                    </div>
                  </dl>
                ) : null}
                {deliveries?.attribution.incompleteCostOrders ? (
                  <Callout tone="warning">
                    Margem indisponível em {deliveries.attribution.incompleteCostOrders} pedido(s):
                    falta custo histórico ou o recebimento não concilia com os itens.
                  </Callout>
                ) : deliveries?.attribution.costedOrders ? (
                  <Callout tone="info">
                    Margem bruta usa o custo histórico proporcional ao recebimento líquido; não
                    inclui custo do canal ou da criação da campanha.
                  </Callout>
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
                    <small>
                      {deliveries?.deliveries.length ?? 0} de {deliveries?.total ?? 0} registro(s)
                      carregado(s)
                    </small>
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
                          {deliveryStatuses[status] ?? "Situação indisponível"}: {total}
                        </Badge>
                      ))}
                  </div>
                </div>
                {!deliveries || deliveries.deliveries.length === 0 ? (
                  <div className="crm-inline-empty">
                    <Icon name="alerts" size={18} />
                    <p>Nenhuma entrega registrada para esta campanha.</p>
                  </div>
                ) : (
                  <div className="data-list">
                    {deliveries.deliveries.map((delivery) => (
                      <article className="data-row" key={delivery.id}>
                        <div>
                          <strong>{delivery.customerName}</strong>
                          <small>
                            {delivery.sentAt
                              ? dateTime(delivery.sentAt)
                              : dateTime(delivery.createdAt)}
                            {` · ${delivery.experimentVariant === "control" ? "controle" : `variação ${delivery.experimentVariant.toUpperCase()}`}`}
                            {delivery.errorCode
                              ? ` · ${crmFailureMessage(delivery.errorCode, "Não foi possível entregar a mensagem. Verifique o contato e tente novamente.")}`
                              : ""}
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
                          {deliveryStatuses[delivery.status] ?? "Situação indisponível"}
                        </Badge>
                      </article>
                    ))}
                    {deliveries.nextOffset !== null && (
                      <Button
                        disabled={loadingMoreDeliveries || Boolean(reviewAction)}
                        size="sm"
                        variant="secondary"
                        onClick={() => void loadMoreDeliveries()}
                      >
                        {loadingMoreDeliveries ? "Carregando…" : "Ver mais entregas"}
                      </Button>
                    )}
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
