import { type DeliveryAddressInput, deliveryAddressSchema } from "@giromesa/contracts";
import {
  Badge,
  Button,
  Card,
  EmptyState,
  Icon,
  Input,
  Label,
  Modal,
  NativeSelect,
  SearchField,
} from "@giromesa/ui";
import { type FormEvent, useCallback, useEffect, useId, useRef, useState } from "react";
import { api } from "../../api";
import { parseDeliveryZones } from "../../growth.shared";
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
import { profiles } from "../../profiles";
import { formatMoney } from "../../rules";
import {
  DeliveryAddressFields,
  emptyDeliveryAddress,
  formatDeliveryAddress,
} from "../delivery/DeliveryAddressFields";
import { TabWorkspace } from "./CounterWorkspace";
import { isValidOperationalPhone } from "./contact";
import { counterShortcutAction } from "./counter-shortcuts";
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
  waiting: "Pós-preparo",
  delivered: "Entregues",
  late: "Atrasados",
};

const counterQueueStages = ["new", "production", "ready", "waiting", "delivered", "late"] as const;
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
  {
    id: "pickup",
    label: "Retirada",
    icon: "purchases",
    fulfillment: "pickup" as const,
  },
  {
    id: "dine_in",
    label: "Balcão local",
    icon: "counter",
    fulfillment: "dine_in" as const,
  },
  {
    id: "delivery",
    label: "Delivery",
    icon: "delivery",
    fulfillment: "delivery" as const,
  },
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
  fulfillment: "pickup" | "dine_in" | "delivery" = "pickup",
) {
  const digits = phone.replace(/\D/g, "");
  if (digits.length < 8) return null;
  const fullPhone = digits.length <= 11 ? `55${digits}` : digits;
  const namePart = customerName ? `Olá, ${customerName}!` : "Olá!";
  const orderPart = label ? ` (pedido ${label})` : "";
  const message =
    fulfillment === "delivery"
      ? "está pronto e aguarda saída para entrega."
      : fulfillment === "dine_in"
        ? "está pronto para consumo no local."
        : "está pronto para retirada. Aguardamos você!";
  const text = `${namePart} Seu pedido${orderPart} ${message}`;
  return `https://wa.me/${fullPhone}?text=${encodeURIComponent(text)}`;
}

export interface CounterQueueResponse {
  items: Array<ReturnType<typeof parseTab> & { queueStage: Exclude<CounterQueueStage, "all"> }>;
  counts: Record<CounterQueueStage, number> & { readyForHandoff: number };
  pagination: { page: number; limit: number; total: number; totalPages: number };
}

export function isValidCounterPhone(value: string) {
  return isValidOperationalPhone(value);
}

export function counterTabIdFromHash(hash: string): string | null {
  const query = hash.split("?")[1];
  const tabId = query ? new URLSearchParams(query).get("tab")?.trim() : undefined;
  return tabId || null;
}

export function counterPaymentAttemptIdFromHash(hash: string): string | null {
  const query = hash.split("?")[1];
  const attemptId = query ? new URLSearchParams(query).get("paymentAttempt")?.trim() : undefined;
  return attemptId || null;
}

export function counterActionFromHash(hash: string): "new" | null {
  const query = hash.split("?")[1];
  return query && new URLSearchParams(query).get("action") === "new" ? "new" : null;
}

type CounterCustomer = {
  id: string;
  name: string;
  phone: string | null;
  email?: string | null;
  defaultDeliveryAddress?: DeliveryAddressInput | null;
};

export function parseCounterCustomers(value: unknown): CounterCustomer[] {
  return records(record(value).items).map((customer) => ({
    id: text(customer.id),
    name: text(customer.name),
    phone: typeof customer.phone === "string" ? customer.phone : null,
    defaultDeliveryAddress:
      customer.defaultDeliveryAddress == null
        ? null
        : deliveryAddressSchema.parse(customer.defaultDeliveryAddress),
  }));
}

export function counterCustomerOptionValue(
  customer: Pick<CounterCustomer, "name" | "phone" | "email">,
) {
  const contact = customer.phone ?? customer.email;
  return contact ? `${customer.name} · ${contact}` : customer.name;
}

export function counterCustomerFromOption(customers: CounterCustomer[], value: string) {
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
      readyForHandoff: parseNumber(counts.readyForHandoff),
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

export function counterStageCount(
  counts: CounterQueueResponse["counts"],
  stage: CounterQueueStage,
) {
  return stage === "ready" ? counts.readyForHandoff : counts[stage];
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
  const [paymentAttemptId, setPaymentAttemptId] = useState<string | null>(() =>
    typeof window === "undefined" ? null : counterPaymentAttemptIdFromHash(window.location.hash),
  );
  const panelRef = useRef<HTMLElement>(null);
  const overviewRef = useRef<HTMLElement>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const quickOpenFormRef = useRef<HTMLFormElement>(null);
  const newOrderChooserRef = useRef<HTMLDivElement>(null);
  const newOrderButtonRef = useRef<HTMLButtonElement>(null);
  const newOrderReturnFocusRef = useRef<HTMLElement | null>(null);
  const focusNewOrderFormRef = useRef(false);
  const scheduleRef = useRef<HTMLDetailsElement>(null);
  const queueScrollRef = useRef({ x: 0, y: 0 });
  const restoringOverviewRef = useRef(false);

  function selectTab(tabId: string | null, trigger?: HTMLElement) {
    setNewOrderFormVisible(false);
    if (tabId) {
      returnFocusRef.current = trigger ?? null;
      queueScrollRef.current = { x: window.scrollX, y: window.scrollY };
    } else {
      restoringOverviewRef.current = true;
    }
    const url = new URL(window.location.href);
    const [route = "#/counter", query = ""] = url.hash.split("?");
    const params = new URLSearchParams(query);
    if (tabId) params.set("tab", tabId);
    else params.delete("tab");
    params.delete("paymentAttempt");
    url.hash = params.size ? `${route}?${params}` : route;
    window.history.replaceState(window.history.state, "", url);
    setSelected(tabId);
    setPaymentAttemptId(null);
  }

  const [label, setLabel] = useState("");
  const [customerSearch, setCustomerSearch] = useState("");
  const [debouncedCustomerSearch, setDebouncedCustomerSearch] = useState("");
  const [selectedCustomerId, setSelectedCustomerId] = useState<string | null>(null);
  const [customerName, setCustomerName] = useState("");
  const [customerPhone, setCustomerPhone] = useState("");
  const [readyNotificationConsent, setReadyNotificationConsent] = useState(false);
  const [deliveryAddress, setDeliveryAddress] =
    useState<DeliveryAddressInput>(emptyDeliveryAddress);
  const [deliveryZoneId, setDeliveryZoneId] = useState("");
  const [saveCustomer, setSaveCustomer] = useState(false);
  const [saveCustomerAddress, setSaveCustomerAddress] = useState(false);
  const customerSaveKey = useRef<string | null>(null);
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
  const [newOrderRequested, setNewOrderRequested] = useState(() =>
    typeof window === "undefined" ? false : counterActionFromHash(window.location.hash) === "new",
  );
  const [guests, setGuests] = useState(1);
  const [busy, setBusy] = useState(false);
  const [newOrderChooserOpen, setNewOrderChooserOpen] = useState(false);
  const [newOrderFormVisible, setNewOrderFormVisible] = useState(false);
  function closeNewOrder() {
    if (busy) return;
    setNewOrderFormVisible(false);
    window.requestAnimationFrame(() => {
      const target = newOrderReturnFocusRef.current;
      (target?.isConnected
        ? target
        : (newOrderButtonRef.current ?? closeButtonRef.current ?? overviewRef.current)
      )?.focus();
    });
  }
  const canOpenOrder = profiles
    .find((profile) => profile.id === scope.profileId)
    ?.permissions.includes("counter.operate");
  const [feedback, setFeedback] = useState("");
  const [promisedAtError, setPromisedAtError] = useState("");
  const [phoneError, setPhoneError] = useState("");
  const customerOptionsId = useId();
  const zones = useRemote(
    scope,
    () =>
      fulfillmentType === "delivery"
        ? api.growth.deliveryZones(scope.organizationId, scope.unitId)
        : Promise.resolve([]),
    parseDeliveryZones,
    fulfillmentType,
  );
  const activeZones =
    zones.state.status === "ready" ? zones.state.data.filter((zone) => zone.active) : [];
  const effectiveZoneId =
    deliveryZoneId || (activeZones.length === 1 ? (activeZones[0]?.id ?? "") : "");
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
      setSelected(tabId);
      setPaymentAttemptId(counterPaymentAttemptIdFromHash(window.location.hash));
      const isNewOrder = counterActionFromHash(window.location.hash) === "new";
      setNewOrderRequested(isNewOrder);
    };
    syncSelectedTab();
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
  const chooseNewOrder = useCallback(
    (type: "dine_in" | "pickup" | "delivery") => {
      if (busy || !canOpenOrder || queue.state.status !== "ready") return;
      setFulfillmentType(type);
      setNewOrderFormVisible(true);
      focusNewOrderFormRef.current = true;
      setNewOrderChooserOpen(false);
    },
    [busy, canOpenOrder, queue.state.status],
  );
  useEffect(() => {
    if (embedded) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (busy || !canOpenOrder || queue.state.status !== "ready") return;
      if (newOrderChooserOpen) {
        const target = event.target;
        if (
          event.defaultPrevented ||
          event.repeat ||
          event.isComposing ||
          event.altKey ||
          event.ctrlKey ||
          event.metaKey ||
          event.shiftKey ||
          !(target instanceof Element) ||
          target.closest("dialog") !== newOrderChooserRef.current?.closest("dialog") ||
          target.closest("input, textarea, select, [contenteditable='true']")
        )
          return;
        const type =
          event.key === "1"
            ? "dine_in"
            : event.key === "2"
              ? "pickup"
              : event.key === "3"
                ? "delivery"
                : null;
        if (!type) return;
        event.preventDefault();
        chooseNewOrder(type);
        return;
      }
      if (
        counterShortcutAction(event) !== "new" ||
        document.querySelector("dialog[open], [role='dialog'][aria-modal='true']") ||
        panelRef.current?.querySelector('[aria-busy="true"]')
      )
        return;
      event.preventDefault();
      if (!newOrderFormVisible) {
        newOrderReturnFocusRef.current =
          document.activeElement instanceof HTMLElement ? document.activeElement : null;
      }
      setNewOrderChooserOpen(true);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [
    busy,
    canOpenOrder,
    chooseNewOrder,
    embedded,
    newOrderChooserOpen,
    newOrderFormVisible,
    queue.state.status,
  ]);
  useEffect(() => {
    if (newOrderChooserOpen || !newOrderFormVisible || !focusNewOrderFormRef.current) return;
    const frame = window.requestAnimationFrame(() => {
      focusNewOrderFormRef.current = false;
      quickOpenFormRef.current?.querySelector<HTMLElement>("input:not([disabled])")?.focus();
    });
    return () => window.cancelAnimationFrame(frame);
  }, [newOrderChooserOpen, newOrderFormVisible]);
  useEffect(() => {
    if (!newOrderRequested || embedded || queue.state.status !== "ready") return;
    const frame = window.requestAnimationFrame(() => {
      if (canOpenOrder) setNewOrderChooserOpen(true);
      const url = new URL(window.location.href);
      const [route = "#/counter", query = ""] = url.hash.split("?");
      const params = new URLSearchParams(query);
      params.delete("action");
      url.hash = params.size ? `${route}?${params}` : route;
      window.history.replaceState(window.history.state, "", url);
      setNewOrderRequested(false);
    });
    return () => window.cancelAnimationFrame(frame);
  }, [canOpenOrder, embedded, newOrderRequested, queue.state.status]);
  const floor = useRemote(
    scope,
    () => scope.load("floor", undefined, () => api.pilot.floor(scope.organizationId, scope.unitId)),
    parsePilotFloor,
  );
  useEffect(() => {
    if (queue.state.status !== "ready") return;
    if (selected) {
      panelRef.current?.scrollTo({ top: 0 });
      closeButtonRef.current?.focus();
    } else if (restoringOverviewRef.current) {
      restoringOverviewRef.current = false;
      const trigger = returnFocusRef.current;
      (trigger?.isConnected ? trigger : overviewRef.current)?.focus({ preventScroll: true });
      window.scrollTo(queueScrollRef.current.x, queueScrollRef.current.y);
    }
  }, [selected, queue.state.status]);
  useEffect(() => {
    const panel = panelRef.current;
    if (!selected || !panel) return;
    const resize = () =>
      panel.style.setProperty(
        "--counter-panel-top",
        `${Math.max(16, panel.getBoundingClientRect().top)}px`,
      );
    resize();
    window.addEventListener("resize", resize);
    window.addEventListener("scroll", resize, { passive: true });
    return () => {
      window.removeEventListener("resize", resize);
      window.removeEventListener("scroll", resize);
    };
  }, [selected]);
  const customers = useRemote(
    scope,
    () =>
      api.growth.operationalCustomers(scope.organizationId, scope.unitId, {
        q: (selectedCustomerId ? customerName : debouncedCustomerSearch) || undefined,
        limit: 20,
      }),
    parseCounterCustomers,
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
            if (scheduleRef.current) {
              scheduleRef.current.closest(".counter-open-advanced")?.setAttribute("open", "");
              scheduleRef.current.open = true;
              scheduleRef.current.querySelector("input")?.focus();
            }
            return;
          }
          setBusy(true);
          try {
            const address =
              fulfillmentType === "delivery"
                ? deliveryAddressSchema.parse(deliveryAddress)
                : undefined;
            if (address && !effectiveZoneId)
              throw new Error("Selecione uma zona de entrega antes de abrir o pedido.");
            let customerId = selectedCustomerId;
            if (customerId && address && saveCustomerAddress) {
              await api.growth.updateOperationalCustomerAddress(
                scope.organizationId,
                scope.unitId,
                customerId,
                address,
              );
            }
            if (saveCustomer && !customerId) {
              customerSaveKey.current ??= crypto.randomUUID();
              const result = record(
                await api.growth.createOperationalCustomer(scope.organizationId, scope.unitId, {
                  name: customerName.trim(),
                  phone: customerPhone.trim() || undefined,
                  defaultDeliveryAddress: address,
                  idempotencyKey: customerSaveKey.current,
                }),
              );
              customerId = text(record(result.customer).id);
              setSelectedCustomerId(customerId);
              setSaveCustomer(false);
            }
            const body = {
              label: label.trim() || undefined,
              guestCount: guests,
              customerId: customerId ?? undefined,
              customerName: customerName.trim() || undefined,
              customerPhone: customerPhone.trim() || undefined,
              readyNotificationConsent: hasValidCustomerPhone && readyNotificationConsent,
              deliveryAddress: address ? formatDeliveryAddress(address) : undefined,
              deliveryAddressDetails: address,
              deliveryZoneId: address ? effectiveZoneId : undefined,
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
            selectTab(tab.id);
            setLabel("");
            setCustomerSearch("");
            setSelectedCustomerId(null);
            setCustomerName("");
            setCustomerPhone("");
            setPhoneError("");
            setReadyNotificationConsent(false);
            setDeliveryAddress(emptyDeliveryAddress);
            setDeliveryZoneId("");
            setSaveCustomer(false);
            setSaveCustomerAddress(false);
            customerSaveKey.current = null;
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
          setPromisedDate("");
          setPromisedTime("");
          setPromisedAtError("");
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
              className={
                embedded ? "counter-overview-actions" : "page-heading counter-page-heading"
              }
            >
              {!embedded && <h1>Balcão e retirada</h1>}
              {!selected && canOpenOrder && (
                <Button
                  aria-haspopup="dialog"
                  aria-keyshortcuts={embedded ? undefined : "Alt+n"}
                  disabled={busy}
                  ref={newOrderButtonRef}
                  onClick={(event) => {
                    newOrderReturnFocusRef.current = event.currentTarget;
                    setNewOrderChooserOpen(true);
                  }}
                  type="button"
                >
                  <Icon name="plus" size={16} /> Novo pedido
                  {!embedded && (
                    <span className="counter-shortcut-hint" aria-hidden="true">
                      Alt N
                    </span>
                  )}
                </Button>
              )}
            </div>
            <Modal
              isOpen={newOrderChooserOpen}
              onClose={() => setNewOrderChooserOpen(false)}
              title="Novo pedido"
              size="sm"
            >
              <div className="gm-form-stack" ref={newOrderChooserRef}>
                <p>Escolha o tipo ou pressione 1, 2 ou 3.</p>
                {(["dine_in", "pickup", "delivery"] as const).map((type, index) => (
                  <Button
                    aria-keyshortcuts={String(index + 1)}
                    disabled={busy || !canOpenOrder}
                    key={type}
                    onClick={() => chooseNewOrder(type)}
                    type="button"
                    variant="secondary"
                  >
                    {index + 1} ·{" "}
                    {type === "dine_in" ? "Local" : type === "pickup" ? "Retirada" : "Delivery"}
                  </Button>
                ))}
              </div>
            </Modal>
            <Modal
              isOpen={newOrderFormVisible}
              onClose={closeNewOrder}
              closeDisabled={busy}
              title="Novo pedido"
              size="xl"
              contentClassName="counter-operation counter-new-order"
            >
              <div className="counter-quick-open-header">
                <div className="counter-quick-presets">
                  {COUNTER_PRESETS.map((preset) => (
                    <Button
                      className={
                        fulfillmentType === preset.fulfillment ? "counter-preset-btn--active" : ""
                      }
                      key={preset.id}
                      aria-pressed={fulfillmentType === preset.fulfillment}
                      onClick={() => applyPreset(preset)}
                      size="sm"
                      type="button"
                      variant={fulfillmentType === preset.fulfillment ? "primary" : "secondary"}
                    >
                      <Icon name={preset.icon} size={16} />
                      {preset.label}
                    </Button>
                  ))}
                </div>
              </div>
              <form
                className="inline-form counter-open-form"
                onSubmit={(event) => void open(event)}
                ref={quickOpenFormRef}
              >
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
                            setDeliveryAddress(
                              customer.defaultDeliveryAddress ?? emptyDeliveryAddress,
                            );
                            setSaveCustomer(false);
                            setSaveCustomerAddress(false);
                            setPhoneError("");
                            setReadyNotificationConsent(false);
                          }}
                          placeholder="Nome ou telefone"
                          type="search"
                          value={customerSearch}
                        />
                      </Label>
                      <datalist id={customerOptionsId}>
                        {customerOptions.map((customer) => (
                          <option key={customer.id} value={counterCustomerOptionValue(customer)} />
                        ))}
                      </datalist>
                      {selectedCustomer ? (
                        <small role="status">Cliente vinculado</small>
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
                        customerSaveKey.current = null;
                        setSelectedCustomerId(null);
                      }}
                      placeholder={saveCustomer ? "Nome do novo cliente" : "Opcional"}
                      required={saveCustomer}
                      value={customerName}
                    />
                  </Label>
                </div>
                {!selectedCustomerId && (
                  <Label className="counter-save-customer">
                    <input
                      type="checkbox"
                      checked={saveCustomer}
                      onChange={(event) => setSaveCustomer(event.target.checked)}
                    />
                    Salvar como novo cliente
                  </Label>
                )}
                <details
                  className="counter-open-advanced"
                  open={fulfillmentType === "delivery" || saveCustomer}
                >
                  <summary>
                    {fulfillmentType === "delivery" ? "Contato e entrega" : "Dados do pedido"}
                    <Icon name="chevron-down" size={16} />
                  </summary>
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
                            customerSaveKey.current = null;
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
                    <Label className="counter-notification-consent">
                      <input
                        className="accent-primary"
                        checked={readyNotificationConsent}
                        disabled={!hasValidCustomerPhone}
                        onChange={(event) => setReadyNotificationConsent(event.target.checked)}
                        type="checkbox"
                      />
                      Cliente autorizou aviso de pedido pronto
                    </Label>
                    {fulfillmentType !== "dine_in" && (
                      <details className="counter-schedule gm-disclosure" ref={scheduleRef}>
                        <summary>
                          Agendar pedido · opcional
                          <Icon name="chevron-down" size={16} />
                        </summary>
                        <fieldset
                          aria-describedby={
                            promisedAtError ? "counter-promised-at-error" : undefined
                          }
                          className="promised-at-field"
                        >
                          <div className="promised-at-field__legend-row">
                            <legend className="gm-sr-only">Horário combinado</legend>
                            <div className="counter-minute-chips">
                              {PROMISED_MINUTES_PRESETS.map((mins) => (
                                <Button
                                  key={mins}
                                  onClick={() => applyMinutes(mins)}
                                  size="sm"
                                  type="button"
                                  variant="secondary"
                                >
                                  <Icon name="plus" size={12} />
                                  {mins} min
                                </Button>
                              ))}
                            </div>
                            {(promisedDate || promisedTime) && (
                              <Button
                                variant="ghost"
                                size="sm"
                                type="button"
                                onClick={() => {
                                  setPromisedDate("");
                                  setPromisedTime("");
                                  setPromisedAtError("");
                                }}
                              >
                                Limpar horário
                              </Button>
                            )}
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
                      </details>
                    )}
                    {fulfillmentType === "delivery" && (
                      <div className="inline-form__wide counter-delivery-fields">
                        <DeliveryAddressFields
                          value={deliveryAddress}
                          onChange={(address) => {
                            setDeliveryAddress(address);
                            customerSaveKey.current = null;
                          }}
                        />
                        {selectedCustomerId && (
                          <Label className="counter-save-customer">
                            <input
                              type="checkbox"
                              checked={saveCustomerAddress}
                              onChange={(event) => setSaveCustomerAddress(event.target.checked)}
                            />
                            Atualizar endereço no cadastro do cliente
                          </Label>
                        )}
                        <Label className="gm-form-field counter-delivery-zone">
                          Zona de entrega
                          <NativeSelect
                            required
                            value={effectiveZoneId}
                            onChange={(event) => setDeliveryZoneId(event.target.value)}
                          >
                            <option value="">Selecione a zona</option>
                            {activeZones.map((zone) => (
                              <option key={zone.id} value={zone.id}>
                                {zone.name} · {formatMoney(zone.feeCents)}
                              </option>
                            ))}
                          </NativeSelect>
                        </Label>
                        {zones.state.status === "loading" ? (
                          <small role="status">Carregando zonas…</small>
                        ) : zones.state.status === "error" ? (
                          <p role="alert">{zones.state.message}</p>
                        ) : activeZones.length === 0 ? (
                          <p role="alert">Cadastre uma zona ativa em Entregas para continuar.</p>
                        ) : null}
                      </div>
                    )}
                    <Label className="grid gap-1.5">
                      Referência interna
                      <Input
                        onChange={(event) => setLabel(event.target.value)}
                        placeholder="Opcional"
                        value={label}
                      />
                    </Label>
                    <Label className="grid gap-1.5 counter-guests-field">
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
                <div className="counter-new-order-actions">
                  <Button disabled={busy} onClick={closeNewOrder} type="button" variant="secondary">
                    Cancelar
                  </Button>
                  <Button disabled={busy || guests < 1} type="submit">
                    {busy ? "Abrindo…" : "Abrir e pedir"}
                  </Button>
                </div>
                {feedback && (
                  <p className="counter-form-error" role="alert">
                    {feedback}
                  </p>
                )}
              </form>
            </Modal>
            <div
              className={`ops-layout counter-operation ${selected ? "counter-operation--selected" : "counter-operation--idle"} ${embedded ? "counter-page--embedded" : ""}`}
            >
              <section
                aria-label="Visão geral do balcão"
                className="ops-board"
                ref={overviewRef}
                tabIndex={-1}
              >
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
                    <strong>{counterQueue.counts.readyForHandoff}</strong>
                  </div>
                  {counterQueue.counts.late > 0 && (
                    <div className="counter-metric-pill counter-metric-pill--late">
                      <span>Atrasados</span>
                      <strong>{counterQueue.counts.late}</strong>
                    </div>
                  )}
                  <div className="counter-metric-pill counter-metric-pill--total">
                    <span>Valor dos pedidos nesta página</span>
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
                        <small>{counterStageCount(counterQueue.counts, stage)}</small>
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
                            tab.fulfillmentType,
                          )
                        : null;
                    return (
                      <article
                        className={`counter-queue-card ${selected === tab.id ? "counter-queue-card--selected" : ""}`}
                        key={tab.id}
                      >
                        <button
                          aria-controls={selected === tab.id ? "counter-order-panel" : undefined}
                          aria-expanded={selected === tab.id}
                          className="counter-queue-card__select-btn"
                          onClick={(event) => selectTab(tab.id, event.currentTarget)}
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
                              {tab.customerName !== tab.label ? tab.customerName : null}
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
                                  {stage === "late" && <Icon name="alert-circle" size={14} />}
                                  {stage === "late" ? "Atrasado · " : "Prazo: "}
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
                              <Icon name="crm" size={16} /> Avisar no WhatsApp
                            </a>
                          )}
                          <Button
                            aria-controls={selected === tab.id ? "counter-order-panel" : undefined}
                            aria-expanded={selected === tab.id}
                            onClick={(event) => selectTab(tab.id, event.currentTarget)}
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
                          : "Use Novo pedido para iniciar um atendimento."
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
                <aside
                  aria-label="Pedido do balcão"
                  className="ops-panel counter-ops-panel--active"
                  id="counter-order-panel"
                  ref={panelRef}
                  onKeyDown={(event) => {
                    if (event.key !== "Escape" || event.defaultPrevented) return;
                    const target = event.target as HTMLElement;
                    if (
                      target.closest("input, textarea, select") ||
                      document.querySelector("dialog[open]") ||
                      panelRef.current?.querySelector(".workspace-tabs__more[open]")
                    )
                      return;
                    event.stopPropagation();
                    selectTab(null);
                  }}
                >
                  <Button
                    className="counter-workspace-close"
                    onClick={() => selectTab(null)}
                    ref={closeButtonRef}
                    type="button"
                    variant="secondary"
                  >
                    <Icon name="x" size={16} /> Voltar para a fila
                  </Button>
                  <TabWorkspace
                    keyboardShortcuts={!embedded}
                    initialPaymentAttemptId={paymentAttemptId}
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
