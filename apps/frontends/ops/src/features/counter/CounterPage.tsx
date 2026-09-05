import {
  Badge,
  Button,
  Card,
  EmptyState,
  Input,
  Label,
  NativeSelect,
  SearchField,
} from "@giromesa/ui";
import { type FormEvent, useEffect, useId, useState } from "react";
import { api } from "../../api";
import { type Customer, parseCustomerPage } from "../../growth.shared";
import { pilotMutation } from "../../operational-dispatch";
import {
  InvalidPilotPayloadError,
  type PilotScope,
  number as parseNumber,
  parsePilotFloor,
  parseTab,
  RemoteGate,
  record,
  records,
  text,
  useRemote,
} from "../../operations.shared";
import { formatMoney } from "../../rules";

import { TabWorkspace } from "./CounterWorkspace";
import { quickOrderPromisedAtToIso } from "./promisedAt";

export type CounterQueueStage =
  | "all"
  | "new"
  | "production"
  | "ready"
  | "waiting"
  | "delivered"
  | "late";

const counterQueueLabels: Record<CounterQueueStage, string> = {
  all: "Em andamento",
  new: "Novos",
  production: "Em produção",
  ready: "Prontos",
  waiting: "Aguardando",
  delivered: "Entregues",
  late: "Atrasados",
};

const counterQueueStages = ["new", "production", "ready", "waiting", "delivered", "late"] as const;
const counterPhonePattern = /^\+?[0-9 ()-]{8,30}$/;
const counterStageOrder: CounterQueueStage[] = [
  "all",
  "late",
  "ready",
  "waiting",
  "production",
  "new",
  "delivered",
];

export const COUNTER_PRESETS = [
  { id: "pickup", label: "🛍️ Retirada", fulfillment: "pickup" as const, defaultMinutes: 20 },
  {
    id: "dine_in",
    label: "☕ Balcão Local",
    fulfillment: "dine_in" as const,
    defaultMinutes: null,
  },
  { id: "delivery", label: "🛵 Delivery", fulfillment: "delivery" as const, defaultMinutes: 45 },
] as const;

export const PROMISED_MINUTES_PRESETS = [15, 30, 45, 60] as const;

export function calculatePromisedPreset(minutes: number) {
  const target = new Date(Date.now() + minutes * 60 * 1000);
  const year = target.getFullYear();
  const month = String(target.getMonth() + 1).padStart(2, "0");
  const day = String(target.getDate()).padStart(2, "0");
  const hours = String(target.getHours()).padStart(2, "0");
  const mins = String(target.getMinutes()).padStart(2, "0");
  return {
    date: `${year}-${month}-${day}`,
    time: `${hours}:${mins}`,
  };
}

export function buildWhatsAppReadyLink(
  phone: string,
  customerName?: string | null,
  label?: string | null,
) {
  const digits = phone.replace(/\D/g, "");
  if (digits.length < 8) return null;
  const fullPhone = digits.length <= 11 ? `55${digits}` : digits;
  const namePart = customerName ? `Olá, ${customerName}!` : "Olá!";
  const orderPart = label ? ` (pedido ${label})` : "";
  const text = `${namePart} Seu pedido${orderPart} no GiroMesa está pronto para retirada. Aguardamos você!`;
  return `https://wa.me/${fullPhone}?text=${encodeURIComponent(text)}`;
}

export interface CounterQueueResponse {
  items: Array<ReturnType<typeof parseTab> & { queueStage: Exclude<CounterQueueStage, "all"> }>;
  counts: Record<CounterQueueStage, number>;
  pagination: { page: number; limit: number; total: number; totalPages: number };
}

export function isValidCounterPhone(value: string) {
  return value.trim().length === 0 || counterPhonePattern.test(value.trim());
}

export function counterTabIdFromHash(hash: string): string | null {
  const query = hash.split("?")[1];
  const tabId = query ? new URLSearchParams(query).get("tab")?.trim() : undefined;
  return tabId || null;
}

export function counterCustomerOptionValue(customer: Pick<Customer, "name" | "phone" | "email">) {
  const contact = customer.phone ?? customer.email;
  return contact ? `${customer.name} · ${contact}` : customer.name;
}

export function counterCustomerFromOption(customers: Customer[], value: string) {
  const normalizedValue = value.trim().toLocaleLowerCase("pt-BR");
  if (!normalizedValue) return null;
  return (
    customers.find(
      (customer) =>
        counterCustomerOptionValue(customer).toLocaleLowerCase("pt-BR") === normalizedValue,
    ) ?? null
  );
}

export function parseCounterQueue(value: unknown): CounterQueueResponse {
  const payload = record(value);
  const counts = record(payload.counts);
  const pagination = record(payload.pagination);
  return {
    items: records(payload.items).map((row) => {
      const queueStage = text(row.queueStage);
      if (!counterQueueStages.includes(queueStage as (typeof counterQueueStages)[number])) {
        throw new InvalidPilotPayloadError();
      }
      return {
        ...parseTab(row),
        queueStage: queueStage as Exclude<CounterQueueStage, "all">,
      };
    }),
    counts: {
      all: parseNumber(counts.all),
      new: parseNumber(counts.new),
      production: parseNumber(counts.production),
      ready: parseNumber(counts.ready),
      waiting: parseNumber(counts.waiting),
      delivered: parseNumber(counts.delivered),
      late: parseNumber(counts.late),
    },
    pagination: {
      page: parseNumber(pagination.page),
      limit: parseNumber(pagination.limit),
      total: parseNumber(pagination.total),
      totalPages: parseNumber(pagination.totalPages),
    },
  };
}

export function RealCounterPage({
  scope,
  embedded = false,
}: {
  scope: PilotScope;
  embedded?: boolean;
}) {
  const [selected, setSelected] = useState<string | null>(() =>
    typeof window === "undefined" ? null : counterTabIdFromHash(window.location.hash),
  );
  const [label, setLabel] = useState("");
  const [customerSearch, setCustomerSearch] = useState("");
  const [debouncedCustomerSearch, setDebouncedCustomerSearch] = useState("");
  const [selectedCustomerId, setSelectedCustomerId] = useState<string | null>(null);
  const [customerName, setCustomerName] = useState("");
  const [customerPhone, setCustomerPhone] = useState("");
  const [readyNotificationConsent, setReadyNotificationConsent] = useState(false);
  const [deliveryAddress, setDeliveryAddress] = useState("");
  const [fulfillmentType, setFulfillmentType] = useState<"dine_in" | "pickup" | "delivery">(
    "pickup",
  );
  const [promisedDate, setPromisedDate] = useState("");
  const [promisedTime, setPromisedTime] = useState("");
  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [channelFilter, setChannelFilter] = useState<"all" | "dine_in" | "pickup" | "delivery">(
    "all",
  );
  const [stageFilter, setStageFilter] = useState<CounterQueueStage>("all");
  const [page, setPage] = useState(1);
  const [guests, setGuests] = useState(1);
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState("");
  const [promisedAtError, setPromisedAtError] = useState("");
  const [phoneError, setPhoneError] = useState("");
  const customerOptionsId = useId();
  const hasValidCustomerPhone =
    customerPhone.trim().length > 0 && isValidCounterPhone(customerPhone);
  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedQuery(query.trim()), 350);
    return () => window.clearTimeout(timer);
  }, [query]);
  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedCustomerSearch(customerSearch.trim()), 250);
    return () => window.clearTimeout(timer);
  }, [customerSearch]);
  useEffect(() => {
    const syncSelectedTab = () => {
      const tabId = counterTabIdFromHash(window.location.hash);
      if (tabId) setSelected(tabId);
    };
    window.addEventListener("hashchange", syncSelectedTab);
    return () => window.removeEventListener("hashchange", syncSelectedTab);
  }, []);
  const queue = useRemote(
    scope,
    () =>
      api.pilot.counterQueue(scope.organizationId, scope.unitId, {
        stage: stageFilter,
        channel: channelFilter,
        query: debouncedQuery,
        page,
        limit: 50,
      }),
    parseCounterQueue,
    `${stageFilter}:${channelFilter}:${debouncedQuery}:${page}`,
  );
  const floor = useRemote(
    scope,
    () => scope.load("floor", undefined, () => api.pilot.floor(scope.organizationId, scope.unitId)),
    parsePilotFloor,
  );
  const customers = useRemote(
    scope,
    () =>
      api.growth.customerPage(scope.organizationId, {
        q: debouncedCustomerSearch || undefined,
        limit: 20,
      }),
    parseCustomerPage,
    debouncedCustomerSearch,
  );
  const customerOptions = customers.state.status === "ready" ? customers.state.data : null;
  const selectedCustomer =
    customerOptions?.find((customer) => customer.id === selectedCustomerId) ?? null;
  return (
    <RemoteGate remote={queue}>
      {(counterQueue) => {
        const hasQueueFilters =
          stageFilter !== "all" || channelFilter !== "all" || query.trim().length > 0;
        const queueUpdating = queue.refreshing || query.trim() !== debouncedQuery;
        async function open(event: FormEvent) {
          event.preventDefault();
          setFeedback("");
          setPromisedAtError("");
          setPhoneError("");
          if (!isValidCounterPhone(customerPhone)) {
            setPhoneError("Informe um telefone válido com DDD.");
            return;
          }
          let promisedAt: string | null;
          try {
            promisedAt = quickOrderPromisedAtToIso(promisedDate, promisedTime);
          } catch (error) {
            setPromisedAtError(error instanceof Error ? error.message : "Informe um prazo válido.");
            return;
          }
          setBusy(true);
          try {
            const body = {
              label: label.trim() || undefined,
              guestCount: guests,
              customerId: selectedCustomerId ?? undefined,
              customerName: customerName.trim() || undefined,
              customerPhone: customerPhone.trim() || undefined,
              readyNotificationConsent: hasValidCustomerPhone && readyNotificationConsent,
              deliveryAddress:
                fulfillmentType === "delivery" ? deliveryAddress.trim() || undefined : undefined,
              fulfillmentType,
              promisedAt: promisedAt ?? undefined,
            };
            const value = record(
              await scope.dispatch(
                "pos.tab.open_requested",
                pilotMutation("open-tab", { body }),
                (key) => api.pilot.openTab(scope.organizationId, scope.unitId, body, key),
              ),
            );
            const tab = parseTab(record(value.tab));
            setSelected(tab.id);
            setLabel("");
            setCustomerSearch("");
            setSelectedCustomerId(null);
            setCustomerName("");
            setCustomerPhone("");
            setPhoneError("");
            setReadyNotificationConsent(false);
            setDeliveryAddress("");
            setPromisedDate("");
            setPromisedTime("");
            queue.retry();
          } catch (error) {
            setFeedback(
              error instanceof Error ? error.message : "Não foi possível abrir a comanda.",
            );
          } finally {
            setBusy(false);
          }
        }
        function applyPreset(preset: (typeof COUNTER_PRESETS)[number]) {
          setFulfillmentType(preset.fulfillment);
          setGuests(1);
          if (preset.defaultMinutes) {
            const { date, time } = calculatePromisedPreset(preset.defaultMinutes);
            setPromisedDate(date);
            setPromisedTime(time);
            setPromisedAtError("");
          } else {
            setPromisedDate("");
            setPromisedTime("");
          }
        }

        function applyMinutes(minutes: number) {
          const { date, time } = calculatePromisedPreset(minutes);
          setPromisedDate(date);
          setPromisedTime(time);
          setPromisedAtError("");
        }

        return (
          <div className="counter-operation-container">
            <div
              className={`ops-layout counter-operation ${selected ? "counter-operation--selected" : "counter-operation--idle"} ${embedded ? "counter-page--embedded" : ""}`}
            >
              <section className="ops-board">
                <Card className="counter-quick-open-card">
                  <div className="counter-quick-open-header">
                    <div>
                      <p className="eyebrow">Ponto de Atendimento</p>
                      <h2>Nova comanda rápida</h2>
                    </div>
                    <div className="counter-quick-presets">
                      {COUNTER_PRESETS.map((preset) => (
                        <Button
                          className={
                            fulfillmentType === preset.fulfillment
                              ? "counter-preset-btn--active"
                              : ""
                          }
                          key={preset.id}
                          onClick={() => applyPreset(preset)}
                          size="sm"
                          type="button"
                          variant={fulfillmentType === preset.fulfillment ? "primary" : "secondary"}
                        >
                          {preset.label}
                        </Button>
                      ))}
                    </div>
                  </div>
                  <form
                    className="inline-form counter-open-form"
                    onSubmit={(event) => void open(event)}
                  >
                    <Label className="grid gap-1.5">
                      Atendimento
                      <NativeSelect
                        onChange={(event) =>
                          setFulfillmentType(event.target.value as typeof fulfillmentType)
                        }
                        value={fulfillmentType}
                      >
                        <option value="pickup">Retirada</option>
                        <option value="dine_in">Consumo no local</option>
                        <option value="delivery">Delivery</option>
                      </NativeSelect>
                    </Label>
                    <div className="counter-field gap-3">
                      {customerOptions ? (
                        <>
                          <Label className="grid gap-1.5">
                            Buscar cliente cadastrado
                            <Input
                              autoComplete="off"
                              list={customerOptionsId}
                              onChange={(event) => {
                                const value = event.target.value;
                                const customer = counterCustomerFromOption(customerOptions, value);
                                setCustomerSearch(value);
                                setSelectedCustomerId(customer?.id ?? null);
                                if (!customer) return;
                                setCustomerName(customer.name);
                                setCustomerPhone(customer.phone ?? "");
                                setPhoneError("");
                                setReadyNotificationConsent(false);
                              }}
                              placeholder="Nome, telefone ou e-mail"
                              type="search"
                              value={customerSearch}
                            />
                          </Label>
                          <datalist id={customerOptionsId}>
                            {customerOptions.map((customer) => (
                              <option
                                key={customer.id}
                                value={counterCustomerOptionValue(customer)}
                              />
                            ))}
                          </datalist>
                          {selectedCustomer ? (
                            <small role="status">
                              Cadastro vinculado ao CRM. Nome e telefone serão preservados como
                              snapshot desta comanda.
                            </small>
                          ) : customerOptions.length === 0 ? (
                            <small>Nenhum cliente cadastrado. Preencha os dados manualmente.</small>
                          ) : null}
                        </>
                      ) : customers.state.status === "loading" ? (
                        <small role="status">Carregando clientes cadastrados…</small>
                      ) : (
                        <small role="alert">
                          Clientes indisponíveis. Você ainda pode preencher os dados manualmente.
                          <Button onClick={customers.retry} size="sm" type="button" variant="ghost">
                            Tentar novamente
                          </Button>
                        </small>
                      )}
                      <Label className="grid gap-1.5">
                        Nome do cliente
                        <Input
                          onChange={(event) => {
                            setCustomerName(event.target.value);
                            setSelectedCustomerId(null);
                          }}
                          placeholder="Opcional — número automático"
                          value={customerName}
                        />
                      </Label>
                    </div>
                    <details
                      className="counter-open-advanced"
                      open={fulfillmentType === "delivery"}
                    >
                      <summary>Prazo e identificação</summary>
                      <div>
                        <div className="counter-field">
                          <Label className="grid gap-1.5">
                            Telefone
                            <Input
                              aria-describedby={phoneError ? "counter-phone-error" : undefined}
                              aria-invalid={Boolean(phoneError)}
                              inputMode="tel"
                              onBlur={() =>
                                setPhoneError(
                                  isValidCounterPhone(customerPhone)
                                    ? ""
                                    : "Informe um telefone válido com DDD.",
                                )
                              }
                              onChange={(event) => {
                                const nextPhone = event.target.value;
                                setCustomerPhone(nextPhone);
                                setSelectedCustomerId(null);
                                setPhoneError("");
                                if (!nextPhone.trim() || !isValidCounterPhone(nextPhone)) {
                                  setReadyNotificationConsent(false);
                                }
                              }}
                              onInvalid={() => setPhoneError("Informe um telefone válido com DDD.")}
                              pattern="\\+?[0-9 ()-]{8,30}"
                              type="tel"
                              value={customerPhone}
                            />
                          </Label>
                          {phoneError && (
                            <small className="counter-field-error" id="counter-phone-error">
                              {phoneError}
                            </small>
                          )}
                        </div>
                        <Label className="items-start rounded-md border border-border bg-muted p-3 leading-snug">
                          <input
                            className="accent-primary"
                            checked={readyNotificationConsent}
                            disabled={!hasValidCustomerPhone}
                            onChange={(event) => setReadyNotificationConsent(event.target.checked)}
                            type="checkbox"
                          />
                          Cliente autorizou receber o aviso de pedido pronto
                        </Label>
                        {fulfillmentType !== "dine_in" && (
                          <fieldset
                            aria-describedby={
                              promisedAtError ? "counter-promised-at-error" : undefined
                            }
                            className="promised-at-field"
                          >
                            <div className="promised-at-field__legend-row">
                              <legend>Prometido para</legend>
                              <div className="counter-minute-chips">
                                <span>Atalhos:</span>
                                {PROMISED_MINUTES_PRESETS.map((mins) => (
                                  <Button
                                    key={mins}
                                    onClick={() => applyMinutes(mins)}
                                    size="sm"
                                    type="button"
                                    variant="secondary"
                                  >
                                    +{mins} min
                                  </Button>
                                ))}
                              </div>
                            </div>
                            <Label className="grid gap-1.5">
                              <span>Data</span>
                              <Input
                                aria-invalid={Boolean(promisedAtError)}
                                onChange={(event) => {
                                  setPromisedDate(event.target.value);
                                  setPromisedAtError("");
                                }}
                                type="date"
                                value={promisedDate}
                              />
                            </Label>
                            <Label className="grid gap-1.5">
                              <span>Hora</span>
                              <Input
                                aria-invalid={Boolean(promisedAtError)}
                                lang="pt-BR"
                                onChange={(event) => {
                                  setPromisedTime(event.target.value);
                                  setPromisedAtError("");
                                }}
                                type="time"
                                value={promisedTime}
                              />
                            </Label>
                            {promisedAtError && (
                              <small className="counter-field-error" id="counter-promised-at-error">
                                {promisedAtError}
                              </small>
                            )}
                          </fieldset>
                        )}
                        {fulfillmentType === "delivery" && (
                          <Label className="inline-form__wide grid gap-1.5">
                            Endereço
                            <Input
                              onChange={(event) => setDeliveryAddress(event.target.value)}
                              required
                              value={deliveryAddress}
                            />
                          </Label>
                        )}
                        <Label className="grid gap-1.5">
                          Referência interna
                          <Input
                            onChange={(event) => setLabel(event.target.value)}
                            placeholder="Opcional"
                            value={label}
                          />
                        </Label>
                        <Label className="grid gap-1.5">
                          Pessoas
                          <Input
                            min={1}
                            onChange={(event) => setGuests(Number(event.target.value))}
                            type="number"
                            value={guests}
                          />
                        </Label>
                      </div>
                    </details>
                    <Button disabled={busy || guests < 1} type="submit">
                      {busy ? "Abrindo…" : "Abrir e pedir"}
                    </Button>
                    {feedback && (
                      <p className="counter-form-error" role="alert">
                        {feedback}
                      </p>
                    )}
                  </form>
                </Card>
                {/* COCKPIT DE MÉTRICAS DA FILA */}
                <div className="counter-metrics-bar">
                  <div className="counter-metric-pill">
                    <span>Em fila</span>
                    <strong>{counterQueue.counts.all}</strong>
                  </div>
                  <div className="counter-metric-pill counter-metric-pill--prod">
                    <span>Em preparo</span>
                    <strong>{counterQueue.counts.production}</strong>
                  </div>
                  <div className="counter-metric-pill counter-metric-pill--ready">
                    <span>Prontos p/ entrega</span>
                    <strong>{counterQueue.counts.ready}</strong>
                  </div>
                  {counterQueue.counts.late > 0 && (
                    <div className="counter-metric-pill counter-metric-pill--late">
                      <span>Atrasados</span>
                      <strong>{counterQueue.counts.late}</strong>
                    </div>
                  )}
                  <div className="counter-metric-pill counter-metric-pill--total">
                    <span>Total estimado</span>
                    <strong>
                      {formatMoney(
                        counterQueue.items.reduce((sum, item) => sum + item.totalCents, 0),
                      )}
                    </strong>
                  </div>
                </div>

                <Card className="counter-queue-tools">
                  <div
                    aria-live={queue.refreshError ? "assertive" : "off"}
                    className="gm-observability-row counter-sync-status"
                    role={queue.refreshError ? "alert" : "status"}
                  >
                    <span>
                      <Badge tone={queue.refreshError ? "warning" : "success"}>
                        {queue.refreshError
                          ? "Dados desatualizados"
                          : queueUpdating
                            ? "Atualizando fila"
                            : "Operação atualizada"}
                      </Badge>
                      <small>
                        {queue.refreshError ??
                          (queue.lastSuccessfulAt
                            ? `Última confirmação às ${new Date(queue.lastSuccessfulAt).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}`
                            : "Aguardando primeira confirmação")}
                      </small>
                    </span>
                    <Button
                      disabled={queueUpdating}
                      onClick={() => void queue.refresh()}
                      size="sm"
                      type="button"
                      variant="ghost"
                    >
                      {queueUpdating ? "Atualizando…" : "Atualizar"}
                    </Button>
                  </div>
                  <SearchField
                    aria-label="Buscar atendimento"
                    onChange={(event) => {
                      setQuery(event.target.value);
                      setPage(1);
                    }}
                    placeholder="Buscar cliente, número ou telefone"
                    value={query}
                  />
                  <fieldset className="counter-stage-filter">
                    <legend className="gm-sr-only">Etapas do balcão</legend>
                    {counterStageOrder.map((stage) => (
                      <Button
                        aria-pressed={stageFilter === stage}
                        data-stage={stage}
                        key={stage}
                        onClick={() => {
                          setStageFilter(stage);
                          setPage(1);
                        }}
                        type="button"
                        variant="ghost"
                      >
                        <span>{counterQueueLabels[stage]}</span>
                        <small>{counterQueue.counts[stage]}</small>
                      </Button>
                    ))}
                  </fieldset>
                  <fieldset className="segmented counter-channel-filter">
                    <legend className="gm-sr-only">Canal de atendimento</legend>
                    {(["all", "pickup", "dine_in", "delivery"] as const).map((channel) => (
                      <Button
                        aria-pressed={channelFilter === channel}
                        key={channel}
                        onClick={() => {
                          setChannelFilter(channel);
                          setPage(1);
                        }}
                        type="button"
                        variant="ghost"
                      >
                        {channel === "all"
                          ? "Todos"
                          : channel === "pickup"
                            ? "Retirada"
                            : channel === "delivery"
                              ? "Delivery"
                              : "Local"}
                      </Button>
                    ))}
                  </fieldset>
                </Card>

                <div aria-busy={queueUpdating} className="counter-queue-list">
                  {counterQueue.items.map((tab) => {
                    const stage = tab.queueStage;
                    const whatsAppLink =
                      tab.customerPhone && stage === "ready"
                        ? buildWhatsAppReadyLink(
                            tab.customerPhone,
                            tab.customerName,
                            tab.label ??
                              (tab.displayNumber ? `Balcão ${tab.displayNumber}` : undefined),
                          )
                        : null;
                    return (
                      <article
                        className={`counter-queue-card ${selected === tab.id ? "counter-queue-card--selected" : ""}`}
                        key={tab.id}
                      >
                        <button
                          className="counter-queue-card__select-btn"
                          onClick={() => setSelected(tab.id)}
                          type="button"
                        >
                          <div className="counter-queue-card__top">
                            <div className="counter-queue-card__title-line">
                              <strong>
                                {tab.label ??
                                  (tab.displayNumber
                                    ? `Balcão ${tab.displayNumber}`
                                    : "Atendimento do balcão")}
                              </strong>
                              <Badge
                                tone={
                                  stage === "late"
                                    ? "danger"
                                    : stage === "ready" || stage === "delivered"
                                      ? "success"
                                      : stage === "production"
                                        ? "info"
                                        : "neutral"
                                }
                              >
                                {counterQueueLabels[stage]}
                              </Badge>
                            </div>
                            <strong className="counter-queue-card__amount">
                              {formatMoney(tab.totalCents)}
                            </strong>
                          </div>

                          <div className="counter-queue-card__details">
                            <span className="counter-queue-card__customer">
                              {tab.customerName ?? `${tab.guestCount} pessoa(s)`}
                              {tab.customerPhone && (
                                <small className="counter-queue-card__phone">
                                  {tab.customerPhone}
                                </small>
                              )}
                            </span>
                            <div className="counter-queue-card__tags">
                              <span className="counter-channel-tag">
                                {tab.fulfillmentType === "pickup"
                                  ? "Retirada"
                                  : tab.fulfillmentType === "delivery"
                                    ? "Delivery"
                                    : "Local"}
                              </span>
                              {tab.promisedAt && (
                                <span
                                  className={`counter-sla-tag ${stage === "late" ? "counter-sla-tag--late" : ""}`}
                                >
                                  {stage === "late" ? "⚠️ Atrasado · " : "Prazo: "}
                                  {new Date(tab.promisedAt).toLocaleTimeString("pt-BR", {
                                    hour: "2-digit",
                                    minute: "2-digit",
                                  })}
                                </span>
                              )}
                            </div>
                          </div>
                        </button>

                        <div className="counter-queue-card__actions">
                          {whatsAppLink && (
                            <a
                              className="button button--sm button--secondary counter-btn-whatsapp"
                              href={whatsAppLink}
                              rel="noopener noreferrer"
                              target="_blank"
                            >
                              💬 Avisar no WhatsApp
                            </a>
                          )}
                          <Button
                            onClick={() => setSelected(tab.id)}
                            size="sm"
                            type="button"
                            variant={selected === tab.id ? "primary" : "secondary"}
                          >
                            {selected === tab.id ? "Em atendimento" : "Ver pedido"}
                          </Button>
                        </div>
                      </article>
                    );
                  })}
                </div>
                {counterQueue.items.length === 0 && (
                  <Card className="counter-queue-empty">
                    <EmptyState
                      action={
                        hasQueueFilters ? (
                          <Button
                            onClick={() => {
                              setStageFilter("all");
                              setChannelFilter("all");
                              setQuery("");
                              setPage(1);
                            }}
                            size="sm"
                            type="button"
                            variant="secondary"
                          >
                            Limpar filtros
                          </Button>
                        ) : undefined
                      }
                      description={
                        hasQueueFilters
                          ? "Ajuste a etapa, o canal ou a busca para ver outras comandas."
                          : "Abra a primeira comanda rápida acima."
                      }
                      icon="☰"
                      title={hasQueueFilters ? "Nenhuma comanda encontrada" : "Fila vazia"}
                    />
                  </Card>
                )}
                {counterQueue.pagination.totalPages > 1 && (
                  <nav aria-label="Páginas da fila" className="counter-pagination">
                    <Button
                      disabled={queueUpdating || counterQueue.pagination.page <= 1}
                      onClick={() => setPage((current) => Math.max(1, current - 1))}
                      size="sm"
                      type="button"
                      variant="secondary"
                    >
                      Anterior
                    </Button>
                    <span>
                      Página {counterQueue.pagination.page} de {counterQueue.pagination.totalPages}
                    </span>
                    <Button
                      disabled={
                        queueUpdating ||
                        counterQueue.pagination.page >= counterQueue.pagination.totalPages
                      }
                      onClick={() => setPage((current) => current + 1)}
                      size="sm"
                      type="button"
                      variant="secondary"
                    >
                      Próxima
                    </Button>
                  </nav>
                )}
              </section>
              {selected && (
                <aside className="ops-panel counter-ops-panel--active">
                  <Button
                    className="counter-workspace-close"
                    onClick={() => setSelected(null)}
                    type="button"
                    variant="ghost"
                  >
                    ← Voltar para a fila
                  </Button>
                  <TabWorkspace
                    key={selected}
                    scope={scope}
                    tabId={selected}
                    floor={floor.state.status === "ready" ? floor.state.data : undefined}
                    onChanged={queue.retry}
                  />
                </aside>
              )}
            </div>
          </div>
        );
      }}
    </RemoteGate>
  );
}
