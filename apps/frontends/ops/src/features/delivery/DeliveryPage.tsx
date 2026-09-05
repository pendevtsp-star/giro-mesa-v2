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
  SearchField,
  SegmentedTabs,
} from "@giromesa/ui";
import { type FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { api } from "../../api";
import {
  type DeliveryCourier,
  type DeliveryNotification,
  type DeliveryOrder,
  type DeliveryOrderStatus,
  type DeliveryZone,
  dateTime,
  type GrowthScope,
  isDeliverySlaOverdue,
  mergeDeliveryOrders,
  moneyToCents,
  mutationKey,
  parseDeliveryCourierMutation,
  parseDeliveryCouriers,
  parseDeliveryNotificationMutation,
  parseDeliveryOrderMutation,
  parseDeliveryOrders,
  parseDeliveryZones,
  RemoteGate,
  useRemote,
} from "../../growth.shared";
import {
  type RealtimeFreshness,
  type RealtimeStatus,
  type ScopeRealtimeEvent,
  subscribeScopeRealtime,
} from "../../realtime";
import { formatMoney } from "../../rules";

type Tab = "orders" | "zones";
type Filter = "all" | "late" | "scheduled";
type Column = "received" | "preparing" | "ready" | "dispatched";
type TransitionStatus = Exclude<DeliveryOrderStatus, "draft">;

const columns: Array<{ id: Column; label: string }> = [
  { id: "received", label: "Recebidos" },
  { id: "preparing", label: "Em preparo" },
  { id: "ready", label: "Prontos" },
  { id: "dispatched", label: "Em rota" },
];

function columnFor(status: DeliveryOrderStatus): Column | null {
  if (status === "draft" || status === "placed") return "received";
  if (status === "confirmed" || status === "preparing") return "preparing";
  if (status === "ready") return "ready";
  return status === "dispatched" ? "dispatched" : null;
}

function orderId(order: DeliveryOrder) {
  return order.publicProtocol ?? order.orderRef.slice(0, 8).toUpperCase();
}

export function buildDeliveryWhatsAppLink(
  phone: string,
  customerName?: string | null,
  orderRef?: string | null,
) {
  const digits = phone.replace(/\D/g, "");
  if (digits.length < 8) return null;
  const fullPhone = digits.length <= 11 ? `55${digits}` : digits;
  const greeting = customerName ? `Olá, ${customerName}!` : "Olá!";
  const refText = orderRef ? ` do pedido #${orderRef}` : "";
  const message = `${greeting} GiroMesa Delivery informando sobre o andamento${refText}. Em caso de dúvidas, estamos à disposição!`;
  return `https://wa.me/${fullPhone}?text=${encodeURIComponent(message)}`;
}

export function buildCourierWhatsAppLink(phone: string, courierName?: string | null) {
  const digits = phone.replace(/\D/g, "");
  if (digits.length < 8) return null;
  const fullPhone = digits.length <= 11 ? `55${digits}` : digits;
  const greeting = courierName ? `Olá, ${courierName}!` : "Olá!";
  const message = `${greeting} GiroMesa Central de Entregas chamando.`;
  return `https://wa.me/${fullPhone}?text=${encodeURIComponent(message)}`;
}

function withDeliveryNotification(order: DeliveryOrder, notification: DeliveryNotification) {
  return {
    ...order,
    notifications: [
      notification,
      ...order.notifications.filter((current) => current.id !== notification.id),
    ],
  };
}

function nextAction(
  order: DeliveryOrder,
): { label: string; status?: TransitionStatus; dispatch?: true } | null {
  switch (order.status) {
    case "draft":
      return { label: "Registrar pedido", status: "placed" };
    case "placed":
      return { label: "Confirmar", status: "confirmed" };
    case "confirmed":
      return { label: "Iniciar preparo", status: "preparing" };
    case "preparing":
      return { label: "Marcar pronto", status: "ready" };
    case "ready":
      return order.fulfillment === "delivery"
        ? { label: "Despachar", dispatch: true }
        : { label: "Concluir retirada", status: "completed" };
    case "dispatched":
      return { label: "Concluir entrega", status: "completed" };
    default:
      return null;
  }
}

function isScheduled(order: DeliveryOrder) {
  return Boolean(order.scheduledFor);
}

function isLate(order: DeliveryOrder) {
  return isDeliverySlaOverdue(order);
}

function address(order: DeliveryOrder) {
  if (!order.address)
    return order.fulfillment === "pickup" ? "Retirada no balcão" : "Endereço não informado";
  const value = [
    [order.address.street, order.address.number].filter(Boolean).join(", "),
    order.address.complement,
    order.address.neighborhood,
    [order.address.city, order.address.state].filter(Boolean).join(" - "),
    order.address.postalCode ? `CEP ${order.address.postalCode}` : undefined,
  ].filter((field): field is string => Boolean(field));
  return value.length ? value.join(", ") : "Endereço informado";
}

function useOnline() {
  const [online, setOnline] = useState(() => typeof navigator === "undefined" || navigator.onLine);
  useEffect(() => {
    const sync = () => setOnline(navigator.onLine);
    window.addEventListener("online", sync);
    window.addEventListener("offline", sync);
    return () => {
      window.removeEventListener("online", sync);
      window.removeEventListener("offline", sync);
    };
  }, []);
  return online;
}

const deliveryTopics = new Set([
  "growth.delivery_order_created",
  "growth.delivery_order_changed",
  "growth.delivery_dispatched",
  "growth.delivery_courier_assigned",
  "growth.delivery_courier_status_changed",
  "growth.delivery_courier_position_changed",
  "growth.delivery_notification_requested",
]);

function eventLabel(topic?: string) {
  return (
    {
      "growth.delivery_order_created": "Pedido registrado",
      "growth.delivery_order_changed": "Pedido atualizado",
      "growth.delivery_dispatched": "Pedido despachado",
      "growth.delivery_courier_assigned": "Entregador atribuído",
      "growth.delivery_courier_status_changed": "Status do entregador atualizado",
      "growth.delivery_courier_position_changed": "Nova posição do entregador",
      "growth.delivery_notification_requested": "Notificação solicitada",
    }[topic ?? ""] ?? "Atualização de delivery"
  );
}

function useDeliveryRealtime(
  scope: GrowthScope,
  onInvalidate: () => Promise<boolean>,
  onEvent: (event: ScopeRealtimeEvent) => void,
) {
  const invalidateRef = useRef(onInvalidate);
  const eventRef = useRef(onEvent);
  const [status, setStatus] = useState<RealtimeStatus>("connecting");
  const [freshness, setFreshness] = useState<RealtimeFreshness | null>(null);
  invalidateRef.current = onInvalidate;
  eventRef.current = onEvent;
  useEffect(
    () =>
      subscribeScopeRealtime(
        { organizationId: scope.organizationId, unitId: scope.unitId },
        () => invalidateRef.current(),
        setStatus,
        30_000,
        {
          onFreshness: setFreshness,
          onEvent: (event) => {
            if (deliveryTopics.has(event.topic ?? "")) eventRef.current(event);
          },
          shouldInvalidate: (event) => deliveryTopics.has(event.topic ?? ""),
        },
      ),
    [scope.organizationId, scope.unitId],
  );
  return { freshness, status };
}

export function RealDeliveryPage({ scope, canManage }: { scope: GrowthScope; canManage: boolean }) {
  const orders = useRemote(
    scope,
    () => api.growth.deliveryOrders(scope.organizationId, scope.unitId, { limit: 200 }),
    parseDeliveryOrders,
  );
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const serverFilters = {
    query: debouncedSearch || undefined,
    scheduled: filter === "scheduled" ? true : undefined,
    sla: filter === "late" ? ("overdue" as const) : undefined,
    limit: 200,
  };
  const filteredOrders = useRemote(
    scope,
    () => api.growth.deliveryOrders(scope.organizationId, scope.unitId, serverFilters),
    parseDeliveryOrders,
  );
  const zones = useRemote(
    scope,
    () => api.growth.deliveryZones(scope.organizationId, scope.unitId),
    parseDeliveryZones,
  );
  const couriers = useRemote(
    scope,
    () => api.growth.deliveryCouriers(scope.organizationId, scope.unitId),
    parseDeliveryCouriers,
  );
  const [tab, setTab] = useState<Tab>("orders");
  const [busy, setBusy] = useState("");
  const [notice, setNotice] = useState<{ text: string; error?: boolean } | null>(null);
  const [selected, setSelected] = useState<DeliveryOrder | null>(null);
  const [courierId, setCourierId] = useState("");
  const [creatingCourier, setCreatingCourier] = useState(false);
  const [editingZone, setEditingZone] = useState<DeliveryZone | "new" | null>(null);
  const [syncWarning, setSyncWarning] = useState("");
  const [lastSyncedAt, setLastSyncedAt] = useState<string | null>(null);
  const [realtimeEvents, setRealtimeEvents] = useState<ScopeRealtimeEvent[]>([]);
  const online = useOnline();

  const hasServerFilter = Boolean(debouncedSearch || filter !== "all");
  const serverFilterKey = `${filter}:${debouncedSearch}`;
  const displayedOrders = hasServerFilter ? filteredOrders : orders;

  const realtime = useDeliveryRealtime(
    scope,
    async () => {
      try {
        const next = parseDeliveryOrders(
          await api.growth.deliveryOrders(scope.organizationId, scope.unitId, { limit: 200 }),
        );
        orders.update(() => next);
        if (hasServerFilter) {
          const matching = parseDeliveryOrders(
            await api.growth.deliveryOrders(scope.organizationId, scope.unitId, serverFilters),
          );
          filteredOrders.update(() => matching);
        }
        setLastSyncedAt(new Date().toISOString());
        setSyncWarning("");
        return true;
      } catch {
        setSyncWarning("Tempo real indisponível. Exibindo a última lista confirmada.");
        return false;
      }
    },
    (event) => {
      setRealtimeEvents((current) => [event, ...current].slice(0, 4));
    },
  );

  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedSearch(search.trim()), 350);
    return () => window.clearTimeout(timer);
  }, [search]);

  useEffect(() => {
    if (serverFilterKey !== "all:") filteredOrders.retry();
  }, [filteredOrders.retry, serverFilterKey]);

  useEffect(() => {
    if (orders.state.status !== "ready") return;
    const readyOrders = orders.state.data;
    const refresh = async () => {
      const latest = readyOrders.reduce<string | null>(
        (value, order) => (!value || order.updatedAt > value ? order.updatedAt : value),
        null,
      );
      const updatedSince = latest
        ? new Date(new Date(latest).getTime() - 1_000).toISOString()
        : undefined;
      try {
        const updates = parseDeliveryOrders(
          await api.growth.deliveryOrders(scope.organizationId, scope.unitId, {
            updatedSince,
            limit: 200,
          }),
        );
        orders.update((current) => mergeDeliveryOrders(current, updates));
        if (hasServerFilter) filteredOrders.refreshSilently();
        setLastSyncedAt(new Date().toISOString());
        setSyncWarning("");
      } catch {
        setSyncWarning("Atualização automática indisponível. Exibindo a última lista confirmada.");
      }
    };
    setLastSyncedAt(new Date().toISOString());
    const timer = window.setInterval(() => void refresh(), 30_000);
    return () => window.clearInterval(timer);
  }, [
    hasServerFilter,
    orders.state,
    orders.update,
    filteredOrders.refreshSilently,
    scope.organizationId,
    scope.unitId,
  ]);
  useEffect(() => setCourierId(selected?.courierId ?? ""), [selected]);

  const visibleOrders = useMemo(() => {
    if (displayedOrders.state.status !== "ready") return [];
    return displayedOrders.state.data.filter((order) => {
      if (!columnFor(order.status)) return false;
      return filter !== "late" || isLate(order);
    });
  }, [displayedOrders.state, filter]);

  const [mobileColumn, setMobileColumn] = useState<Column | "all">("all");

  const summary = useMemo(
    () =>
      columns.map((column) => {
        const columnOrders =
          orders.state.status === "ready"
            ? orders.state.data.filter((order) => columnFor(order.status) === column.id)
            : [];
        return {
          ...column,
          count: columnOrders.length,
          totalCents: columnOrders.reduce((sum, order) => sum + order.totalCents, 0),
          lateCount: columnOrders.filter(isLate).length,
        };
      }),
    [orders.state],
  );

  const totalVolumeCents = useMemo(
    () => summary.reduce((sum, col) => sum + col.totalCents, 0),
    [summary],
  );

  async function transition(order: DeliveryOrder) {
    const action = nextAction(order);
    if (!action?.status) return;
    const nextStatus = action.status;
    setBusy(order.id);
    setNotice(null);
    try {
      await api.growth.transitionDelivery(scope.organizationId, order.id, nextStatus);
      orders.update((rows) =>
        rows.map((row) => (row.id === order.id ? { ...row, status: nextStatus } : row)),
      );
      filteredOrders.update((rows) =>
        rows.map((row) => (row.id === order.id ? { ...row, status: nextStatus } : row)),
      );
      setSelected(null);
      setNotice({ text: `Pedido ${orderId(order)} atualizado.` });
    } catch (error) {
      setNotice({
        error: true,
        text: error instanceof Error ? error.message : "A atualização não foi confirmada.",
      });
    } finally {
      setBusy("");
    }
  }

  async function dispatch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selected || !courierId) return;
    const assignedCourier =
      couriers.state.status === "ready"
        ? couriers.state.data.find((item) => item.id === courierId)
        : undefined;
    if (!assignedCourier) return;
    setBusy(selected.id);
    setNotice(null);
    try {
      const assigned = parseDeliveryOrderMutation(
        await api.growth.assignDeliveryCourier(scope.organizationId, selected.id, {
          courierId,
          idempotencyKey: mutationKey("delivery-dispatch"),
        }),
      ).order;
      const dispatched = parseDeliveryOrders([
        await api.growth.transitionDelivery(scope.organizationId, selected.id, "dispatched"),
      ])[0];
      if (!dispatched) throw new Error("O despacho do pedido não foi confirmado.");
      orders.update((rows) =>
        rows.map((row) => (row.id === selected.id ? { ...assigned, ...dispatched } : row)),
      );
      filteredOrders.update((rows) =>
        rows.map((row) => (row.id === selected.id ? { ...assigned, ...dispatched } : row)),
      );
      setNotice({ text: `Pedido ${orderId(selected)} despachado.` });
      setSelected(null);
    } catch (error) {
      setNotice({
        error: true,
        text: error instanceof Error ? error.message : "O despacho não foi confirmado.",
      });
    } finally {
      setBusy("");
    }
  }

  async function setZoneActive(zone: DeliveryZone) {
    setBusy(zone.id);
    setNotice(null);
    try {
      const updated = parseDeliveryZones([
        await api.growth.updateDeliveryZone(scope.organizationId, zone.id, {
          active: !zone.active,
        }),
      ])[0];
      if (!updated) throw new Error("A alteração da zona não foi confirmada.");
      zones.update((rows) => rows.map((row) => (row.id === zone.id ? updated : row)));
      setNotice({ text: `Zona ${updated.active ? "ativada" : "desativada"}.` });
    } catch (error) {
      setNotice({
        error: true,
        text: error instanceof Error ? error.message : "A zona não foi atualizada.",
      });
    } finally {
      setBusy("");
    }
  }

  async function setCourierStatus(courier: DeliveryCourier) {
    if (courier.status !== "available" && courier.status !== "offline") return;
    setBusy(courier.id);
    setNotice(null);
    try {
      const updated = parseDeliveryCourierMutation(
        await api.growth.updateDeliveryCourierStatus(scope.organizationId, courier.id, {
          status: courier.status === "available" ? "offline" : "available",
          idempotencyKey: mutationKey("delivery-courier-status"),
        }),
      ).courier;
      couriers.update((rows) => rows.map((row) => (row.id === updated.id ? updated : row)));
      setNotice({
        text: `${updated.name} está ${updated.status === "available" ? "disponível" : "offline"}.`,
      });
    } catch (error) {
      setNotice({
        error: true,
        text: error instanceof Error ? error.message : "O status do entregador não foi atualizado.",
      });
    } finally {
      setBusy("");
    }
  }

  async function createCourier(values: { name: string; reference: string; phone?: string }) {
    setBusy("courier-editor");
    setNotice(null);
    try {
      const created = parseDeliveryCourierMutation(
        await api.growth.createDeliveryCourier(scope.organizationId, {
          unitId: scope.unitId,
          ...values,
          idempotencyKey: mutationKey("delivery-courier-create"),
        }),
      ).courier;
      couriers.update((rows) => [...rows, created]);
      setNotice({ text: `${created.name} cadastrado como disponível.` });
    } finally {
      setBusy("");
    }
  }

  async function requestNotification(
    order: DeliveryOrder,
    audience: "operations" | "customer" = "operations",
    type: "status_update" | "courier_assigned" | "courier_arriving" = "status_update",
  ) {
    setBusy(order.id);
    setNotice(null);
    try {
      const { notification } = parseDeliveryNotificationMutation(
        await api.growth.requestDeliveryNotification(scope.organizationId, order.id, {
          audience,
          type,
          idempotencyKey: mutationKey("delivery-notification"),
        }),
      );
      orders.update((rows) =>
        rows.map((current) =>
          current.id === order.id ? withDeliveryNotification(current, notification) : current,
        ),
      );
      filteredOrders.update((rows) =>
        rows.map((current) =>
          current.id === order.id ? withDeliveryNotification(current, notification) : current,
        ),
      );
      setSelected((current) =>
        current?.id === order.id ? withDeliveryNotification(current, notification) : current,
      );
      setNotice({
        text: `Notificação (${audience === "customer" ? "Cliente" : "Operação"}) registrada como pendente do provedor.`,
      });
    } catch (error) {
      setNotice({
        error: true,
        text:
          error instanceof Error
            ? error.message
            : "A solicitação de notificação não foi confirmada.",
      });
    } finally {
      setBusy("");
    }
  }

  async function saveZone(values: ZoneValues) {
    const currentZone = editingZone && editingZone !== "new" ? editingZone : null;
    if (
      values.feeCents < 0 ||
      values.minimumOrderCents < 0 ||
      values.estimatedDeliveryMinutes < 5 ||
      values.estimatedDeliveryMinutes > 240 ||
      (values.radiusKm !== undefined && values.radiusKm <= 0) ||
      (!currentZone && values.radiusKm === undefined)
    )
      throw new Error("Revise taxa, pedido mínimo e raio declarado.");
    setBusy("zone-editor");
    try {
      const zoneValues = {
        name: values.name,
        feeCents: values.feeCents,
        minimumOrderCents: values.minimumOrderCents,
        estimatedDeliveryMinutes: values.estimatedDeliveryMinutes,
        active: values.active,
        ...(values.radiusKm === undefined
          ? {}
          : { geometry: { type: "unit-radius", radiusKm: values.radiusKm } }),
      };
      const response = currentZone
        ? await api.growth.updateDeliveryZone(scope.organizationId, currentZone.id, zoneValues)
        : await api.growth.createDeliveryZone(scope.organizationId, {
            unitId: scope.unitId,
            ...zoneValues,
            geometry: { type: "unit-radius", radiusKm: values.radiusKm },
          });
      const updated = parseDeliveryZones([response])[0];
      if (!updated) throw new Error("A zona salva não foi confirmada.");
      zones.update((rows) =>
        currentZone
          ? rows.map((row) => (row.id === updated.id ? updated : row))
          : [...rows, updated],
      );
      setNotice({ text: currentZone ? "Zona atualizada." : "Zona criada." });
    } finally {
      setBusy("");
    }
  }

  return (
    <div className="delivery-page">
      <div className="delivery-page__toolbar gm-toolbar">
        <SegmentedTabs
          active={tab}
          items={[
            { id: "orders", label: "Pedidos" },
            { id: "zones", label: "Zonas" },
          ]}
          label="Área do delivery"
          onChange={setTab}
        />
        {tab === "zones" && canManage && (
          <Button onClick={() => setEditingZone("new")} size="sm">
            <Icon name="plus" size={15} /> Nova zona
          </Button>
        )}
      </div>
      {notice && (
        <p
          className={`delivery-notice${notice.error ? " delivery-notice--error" : ""}`}
          role={notice.error ? "alert" : "status"}
        >
          {notice.text}
        </p>
      )}
      {tab === "orders" ? (
        <section className="delivery-operations" aria-label="Pedidos de delivery">
          {!online && (
            <p className="delivery-connection" role="status">
              Sem conexão. Os pedidos podem estar desatualizados até a rede voltar.
            </p>
          )}
          {displayedOrders.state.status === "loading" ? (
            <Loading label="Carregando pedidos persistidos…" />
          ) : displayedOrders.state.status === "error" ? (
            <Failure
              message={displayedOrders.state.message}
              onRetry={displayedOrders.retry}
              title="Pedidos indisponíveis"
            />
          ) : (
            <>
              <div className="delivery-sync" role="status">
                <span>
                  {lastSyncedAt ? `Sincronizado ${dateTime(lastSyncedAt)}` : "Sincronizando…"}
                </span>
                <span>
                  {realtime.status === "live"
                    ? "Tempo real ativo"
                    : realtime.status === "polling"
                      ? "Atualização a cada 30 s"
                      : "Conectando em tempo real…"}
                </span>
                {realtime.freshness?.stale && <span>Sincronização pendente</span>}
                {syncWarning && <span>{syncWarning}</span>}
              </div>
              <Card
                className="delivery-realtime-notices"
                aria-label="Atualizações auditáveis do delivery"
              >
                <div>
                  <strong>Atualizações recentes</strong>
                  <span>Eventos recebidos nesta sessão</span>
                </div>
                {realtimeEvents.length === 0 ? (
                  <p>Nenhum evento de delivery recebido.</p>
                ) : (
                  <ol>
                    {realtimeEvents.map((event, index) => (
                      <li
                        key={`${event.aggregateId ?? event.topic ?? "delivery"}-${event.createdAt ?? index}`}
                      >
                        <span>{eventLabel(event.topic)}</span>
                        <time dateTime={event.createdAt}>
                          {event.createdAt ? dateTime(event.createdAt) : "Agora"}
                        </time>
                      </li>
                    ))}
                  </ol>
                )}
              </Card>
              {canManage && couriers.state.status === "ready" && (
                <Card className="delivery-couriers" aria-label="Disponibilidade dos entregadores">
                  <div className="delivery-couriers__header">
                    <div>
                      <strong>🛵 Central de Entregadores</strong>
                      <span className="delivery-couriers__stats">
                        {couriers.state.data.filter((c) => c.status === "available").length}{" "}
                        disponíveis ·{" "}
                        {couriers.state.data.filter((c) => c.status === "delivering").length} em
                        entrega · {couriers.state.data.length} total
                      </span>
                    </div>
                    <Button onClick={() => setCreatingCourier(true)} size="sm" variant="secondary">
                      + Cadastrar entregador
                    </Button>
                  </div>
                  {couriers.state.data.length === 0 ? (
                    <p className="delivery-couriers__empty">
                      Nenhum entregador cadastrado nesta unidade.
                    </p>
                  ) : (
                    <div className="delivery-couriers__grid">
                      {couriers.state.data.map((courier) => {
                        const whatsAppLink = courier.phone
                          ? buildCourierWhatsAppLink(courier.phone, courier.name)
                          : null;
                        return (
                          <div className="delivery-courier-card" key={courier.id}>
                            <div className="delivery-courier-card__info">
                              <div className="delivery-courier-card__name-line">
                                <strong>{courier.name}</strong>
                                <Badge
                                  tone={
                                    courier.status === "available"
                                      ? "success"
                                      : courier.status === "delivering"
                                        ? "warning"
                                        : "neutral"
                                  }
                                >
                                  {courier.status === "available"
                                    ? "Disponível"
                                    : courier.status === "delivering"
                                      ? "Em entrega"
                                      : "Offline"}
                                </Badge>
                              </div>
                              <small className="delivery-courier-card__ref">
                                {courier.reference}
                              </small>
                              {courier.phone && (
                                <span className="delivery-courier-card__phone">
                                  {courier.phone}
                                </span>
                              )}
                            </div>
                            <div className="delivery-courier-card__actions">
                              {whatsAppLink && (
                                <a
                                  className="delivery-courier-wa-btn"
                                  href={whatsAppLink}
                                  rel="noopener noreferrer"
                                  target="_blank"
                                  title="Chamar entregador no WhatsApp"
                                >
                                  💬 WhatsApp
                                </a>
                              )}
                              <Button
                                disabled={
                                  busy === courier.id ||
                                  (courier.status !== "available" && courier.status !== "offline")
                                }
                                onClick={() => void setCourierStatus(courier)}
                                size="sm"
                                variant="secondary"
                              >
                                {courier.status === "available"
                                  ? "Ficar offline"
                                  : courier.status === "offline"
                                    ? "Ficar disponível"
                                    : courier.status === "assigned"
                                      ? "Atribuído"
                                      : "Em entrega"}
                              </Button>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </Card>
              )}
              <section className="delivery-summary" aria-label="Resumo dos pedidos em operação">
                {summary.map((item) => (
                  <span className="delivery-summary-pill" key={item.id}>
                    <div className="delivery-summary-pill__top">
                      <strong>{item.count}</strong>
                      <span className="delivery-summary-pill__amount">
                        {formatMoney(item.totalCents)}
                      </span>
                    </div>
                    <div className="delivery-summary-pill__label-line">
                      <small>{item.label}</small>
                      {item.lateCount > 0 && <Badge tone="danger">⚠️ {item.lateCount}</Badge>}
                    </div>
                  </span>
                ))}
                <span className="delivery-summary-pill delivery-summary-pill--total">
                  <div className="delivery-summary-pill__top">
                    <strong>{visibleOrders.length}</strong>
                    <span className="delivery-summary-pill__amount">
                      {formatMoney(totalVolumeCents)}
                    </span>
                  </div>
                  <div className="delivery-summary-pill__label-line">
                    <small>Total em operação</small>
                  </div>
                </span>
              </section>
              <div className="delivery-operations__filters">
                <SegmentedTabs
                  active={filter}
                  items={[
                    { id: "all", label: "Todos" },
                    { id: "late", label: "Atrasados" },
                    { id: "scheduled", label: "Agendados" },
                  ]}
                  label="Filtrar pedidos"
                  onChange={setFilter}
                />
                <SearchField
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder="Protocolo, cliente ou telefone"
                  value={search}
                />
              </div>
              {visibleOrders.length === 0 ? (
                <EmptyState
                  icon={<Icon name="delivery" size={28} />}
                  title="Nenhum pedido nesta visão"
                  description="Pedidos ativos aparecerão aqui quando forem registrados na unidade."
                />
              ) : (
                <>
                  <div className="delivery-board-real">
                    {columns.map((column) => {
                      const colSummary = summary.find((item) => item.id === column.id);
                      return (
                        <section className="delivery-board-real__column" key={column.id}>
                          <header className="delivery-board-real__col-header">
                            <div className="delivery-board-real__col-title-line">
                              <h2>{column.label}</h2>
                              <Badge tone={column.id === "dispatched" ? "success" : "info"}>
                                {colSummary?.count ?? 0}
                              </Badge>
                            </div>
                            <div className="delivery-board-real__col-meta-line">
                              <span className="delivery-board-real__col-total">
                                {formatMoney(colSummary?.totalCents ?? 0)}
                              </span>
                              {(colSummary?.lateCount ?? 0) > 0 && (
                                <span className="delivery-board-real__col-late-pill">
                                  ⚠️ {colSummary?.lateCount} atrasado(s)
                                </span>
                              )}
                            </div>
                          </header>
                          {visibleOrders
                            .filter((order) => columnFor(order.status) === column.id)
                            .map((order) => (
                              <OrderCard
                                busy={busy === order.id}
                                key={order.id}
                                onAdvance={() =>
                                  nextAction(order)?.dispatch
                                    ? setSelected(order)
                                    : void transition(order)
                                }
                                onOpen={() => setSelected(order)}
                                order={order}
                              />
                            ))}
                        </section>
                      );
                    })}
                  </div>
                  <div className="delivery-list-real">
                    <div className="delivery-mobile-column-tabs">
                      <button
                        className={`delivery-col-tab ${mobileColumn === "all" ? "delivery-col-tab--active" : ""}`}
                        onClick={() => setMobileColumn("all")}
                        type="button"
                      >
                        Todos ({visibleOrders.length})
                      </button>
                      {columns.map((col) => {
                        const colCount = summary.find((item) => item.id === col.id)?.count ?? 0;
                        return (
                          <button
                            className={`delivery-col-tab ${mobileColumn === col.id ? "delivery-col-tab--active" : ""}`}
                            key={col.id}
                            onClick={() => setMobileColumn(col.id)}
                            type="button"
                          >
                            {col.label} ({colCount})
                          </button>
                        );
                      })}
                    </div>
                    {visibleOrders
                      .filter(
                        (order) =>
                          mobileColumn === "all" || columnFor(order.status) === mobileColumn,
                      )
                      .map((order) => (
                        <OrderCard
                          busy={busy === order.id}
                          key={order.id}
                          onAdvance={() =>
                            nextAction(order)?.dispatch
                              ? setSelected(order)
                              : void transition(order)
                          }
                          onOpen={() => setSelected(order)}
                          order={order}
                        />
                      ))}
                  </div>
                </>
              )}
            </>
          )}
        </section>
      ) : (
        <Zones
          canManage={canManage}
          busy={busy}
          onEdit={setEditingZone}
          onToggle={(zone) => void setZoneActive(zone)}
          remote={zones}
          scope={scope}
        />
      )}
      <OrderModal
        busy={busy === selected?.id}
        couriers={couriers.state.status === "ready" ? couriers.state.data : []}
        couriersLoading={couriers.state.status === "loading"}
        courierId={courierId}
        onClose={() => setSelected(null)}
        onCourierChange={setCourierId}
        onDispatch={dispatch}
        onRequestNotification={(audience, type) =>
          selected && void requestNotification(selected, audience, type)
        }
        onTransition={() => selected && void transition(selected)}
        order={selected}
      />
      {editingZone !== null && (
        <ZoneModal
          busy={busy === "zone-editor"}
          onClose={() => setEditingZone(null)}
          onSubmit={saveZone}
          zone={editingZone === "new" ? null : editingZone}
        />
      )}
      {creatingCourier && (
        <CourierModal
          busy={busy === "courier-editor"}
          onClose={() => setCreatingCourier(false)}
          onSubmit={createCourier}
        />
      )}
    </div>
  );
}

function Loading({ label }: { label: string }) {
  return (
    <Card className="remote-state" role="status">
      <span aria-hidden="true" className="spinner" />
      <strong>{label}</strong>
    </Card>
  );
}
function Failure({
  title,
  message,
  onRetry,
}: {
  title: string;
  message: string;
  onRetry: () => void;
}) {
  return (
    <Card className="remote-state" role="alert">
      <strong>{title}</strong>
      <p>{message}</p>
      <Button onClick={onRetry} size="sm" variant="secondary">
        Tentar novamente
      </Button>
    </Card>
  );
}

function OrderCard({
  order,
  busy,
  onOpen,
  onAdvance,
}: {
  order: DeliveryOrder;
  busy: boolean;
  onOpen: () => void;
  onAdvance: () => void;
}) {
  const action = nextAction(order);
  const late = isLate(order);
  const scheduled = isScheduled(order);
  const whatsApp = order.customerPhone
    ? buildDeliveryWhatsAppLink(order.customerPhone, order.customerName, orderId(order))
    : null;
  const neighborhood =
    order.address?.neighborhood ?? (order.fulfillment === "pickup" ? "Retirada Balcão" : null);

  return (
    <article className={`delivery-order-card${late ? " delivery-order-card--late" : ""}`}>
      <div className="delivery-order-card__header">
        <div className="delivery-order-card__id-group">
          <span className="delivery-order-card__protocol">#{orderId(order)}</span>
          <Badge tone={order.fulfillment === "delivery" ? "info" : "neutral"}>
            {order.fulfillment === "delivery" ? "🛵 Entrega" : "🛍️ Retirada"}
          </Badge>
        </div>
        <div className="delivery-order-card__badges">
          {late && <Badge tone="danger">⚠️ Atrasado</Badge>}
          {scheduled && <Badge tone="neutral">📅 Agendado</Badge>}
          {order.promisedAt && !late && (
            <span className="delivery-sla-chip">
              ⏱️{" "}
              {new Date(order.promisedAt).toLocaleTimeString("pt-BR", {
                hour: "2-digit",
                minute: "2-digit",
              })}
            </span>
          )}
        </div>
      </div>

      <button
        aria-label={`Abrir detalhes do pedido ${orderId(order)}`}
        className="delivery-order-card__body-btn"
        onClick={onOpen}
        type="button"
      >
        <div className="delivery-order-card__customer">
          <strong>{order.customerName ?? "Cliente não informado"}</strong>
          {order.customerPhone && (
            <span className="delivery-order-card__phone">{order.customerPhone}</span>
          )}
        </div>

        {neighborhood && (
          <div className="delivery-order-card__location">
            <span>📍 {neighborhood}</span>
          </div>
        )}

        {order.courierReference && (
          <div className="delivery-order-card__courier-tag">
            <span>🛵 {order.courierReference}</span>
            {order.courierStatus && <small>({order.courierStatus})</small>}
          </div>
        )}
      </button>

      <div className="delivery-order-card__footer">
        <strong className="delivery-order-card__total">{formatMoney(order.totalCents)}</strong>
        <div className="delivery-order-card__actions">
          {whatsApp && (
            <a
              className="delivery-whatsapp-btn"
              href={whatsApp}
              rel="noopener noreferrer"
              target="_blank"
              title="Abrir WhatsApp com o cliente"
            >
              💬 WhatsApp
            </a>
          )}
          {action && (
            <Button
              disabled={busy}
              onClick={onAdvance}
              size="sm"
              variant={
                order.status === "dispatched" || order.status === "ready" ? "primary" : "secondary"
              }
            >
              {busy ? "Atualizando…" : action.label}
            </Button>
          )}
          <Button onClick={onOpen} size="sm" variant="ghost">
            Ver
          </Button>
        </div>
      </div>
    </article>
  );
}

function DeliveryCoverageSimulator({
  zones,
  scope,
}: {
  zones: DeliveryZone[];
  scope: GrowthScope;
}) {
  const [selectedZoneId, setSelectedZoneId] = useState<string>("auto");
  const [street, setStreet] = useState("Av. Paulista");
  const [number, setNumber] = useState("1000");
  const [neighborhood, setNeighborhood] = useState("Bela Vista");
  const [city, setCity] = useState("São Paulo");
  const [state, setState] = useState("SP");
  const [postalCode, setPostalCode] = useState("01310-100");
  const [latitude, setLatitude] = useState("-23.561414");
  const [longitude, setLongitude] = useState("-46.655881");
  const [simulating, setSimulating] = useState(false);
  const [simResult, setSimResult] = useState<{
    covered: boolean;
    zoneName?: string;
    feeCents?: number;
    estimatedMinutes?: number;
    minimumOrderCents?: number;
    message?: string;
  } | null>(null);

  async function handleSimulate(event: FormEvent) {
    event.preventDefault();
    const lat = Number(latitude);
    const lng = Number(longitude);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      setSimResult({ covered: false, message: "Coordenadas (latitude e longitude) inválidas." });
      return;
    }
    const activeZones = zones.filter((z) => z.active);
    if (activeZones.length === 0) {
      setSimResult({ covered: false, message: "Não há zonas de entrega ativas para simulação." });
      return;
    }
    const targetZones =
      selectedZoneId === "auto" ? activeZones : activeZones.filter((z) => z.id === selectedZoneId);

    if (targetZones.length === 0) {
      setSimResult({ covered: false, message: "Zona selecionada não encontrada ou inativa." });
      return;
    }

    setSimulating(true);
    setSimResult(null);

    const addressPayload = {
      street: street.trim(),
      number: number.trim(),
      neighborhood: neighborhood.trim(),
      city: city.trim(),
      state: state.trim().toUpperCase(),
      postalCode: postalCode.trim(),
      latitude: lat,
      longitude: lng,
    };

    try {
      let foundCoveredZone: DeliveryZone | null = null;
      for (const zone of targetZones) {
        const response = (await api.growth.validateDeliveryZoneAddress(
          scope.organizationId,
          zone.id,
          addressPayload,
        )) as { covered: boolean; validationStatus: string };
        if (response?.covered) {
          foundCoveredZone = zone;
          break;
        }
      }

      if (foundCoveredZone) {
        setSimResult({
          covered: true,
          zoneName: foundCoveredZone.name,
          feeCents: foundCoveredZone.feeCents,
          estimatedMinutes: foundCoveredZone.estimatedDeliveryMinutes,
          minimumOrderCents: foundCoveredZone.minimumOrderCents,
        });
      } else {
        setSimResult({
          covered: false,
          message: "Endereço fora do raio de cobertura das zonas testadas.",
        });
      }
    } catch (err) {
      setSimResult({
        covered: false,
        message: err instanceof Error ? err.message : "Não foi possível validar o endereço.",
      });
    } finally {
      setSimulating(false);
    }
  }

  return (
    <Card
      className="delivery-coverage-simulator"
      aria-label="Simulador de cobertura e taxa de entrega"
    >
      <div className="delivery-coverage-simulator__header">
        <div>
          <h3>📍 Simulador de Cobertura e Taxa</h3>
          <p>Validação em tempo real com as zonas operacionais configuradas.</p>
        </div>
      </div>
      <form onSubmit={handleSimulate} className="delivery-coverage-simulator__form">
        <div className="delivery-coverage-simulator__fields">
          <label className="gm-form-field">
            <span>Zona a testar</span>
            <NativeSelect
              value={selectedZoneId}
              onChange={(e) => setSelectedZoneId(e.target.value)}
            >
              <option value="auto">Todas as zonas ativas (busca automática)</option>
              {zones
                .filter((z) => z.active)
                .map((z) => (
                  <option key={z.id} value={z.id}>
                    {z.name} ({formatMoney(z.feeCents)})
                  </option>
                ))}
            </NativeSelect>
          </label>
          <label className="gm-form-field">
            <span>CEP</span>
            <Input
              value={postalCode}
              onChange={(e) => setPostalCode(e.target.value)}
              placeholder="00000-000"
              required
            />
          </label>
          <label className="gm-form-field">
            <span>Logradouro</span>
            <Input
              value={street}
              onChange={(e) => setStreet(e.target.value)}
              placeholder="Rua, Av..."
              required
            />
          </label>
          <label className="gm-form-field">
            <span>Número</span>
            <Input
              value={number}
              onChange={(e) => setNumber(e.target.value)}
              placeholder="123"
              required
            />
          </label>
          <label className="gm-form-field">
            <span>Bairro</span>
            <Input
              value={neighborhood}
              onChange={(e) => setNeighborhood(e.target.value)}
              placeholder="Bairro"
              required
            />
          </label>
          <label className="gm-form-field">
            <span>Cidade</span>
            <Input
              value={city}
              onChange={(e) => setCity(e.target.value)}
              placeholder="Cidade"
              required
            />
          </label>
          <label className="gm-form-field">
            <span>UF</span>
            <Input
              value={state}
              onChange={(e) => setState(e.target.value)}
              maxLength={2}
              placeholder="SP"
              required
            />
          </label>
          <label className="gm-form-field">
            <span>Latitude</span>
            <Input
              value={latitude}
              onChange={(e) => setLatitude(e.target.value)}
              placeholder="-23.56..."
              required
            />
          </label>
          <label className="gm-form-field">
            <span>Longitude</span>
            <Input
              value={longitude}
              onChange={(e) => setLongitude(e.target.value)}
              placeholder="-46.65..."
              required
            />
          </label>
        </div>
        <div className="delivery-coverage-simulator__actions">
          <Button type="submit" disabled={simulating}>
            {simulating ? "Consultando backend…" : "🔍 Testar Cobertura e Taxa"}
          </Button>
        </div>
      </form>

      {simResult && (
        <div
          className={`delivery-coverage-result ${simResult.covered ? "delivery-coverage-result--success" : "delivery-coverage-result--failure"}`}
          role="status"
        >
          {simResult.covered ? (
            <div className="delivery-coverage-result__content">
              <strong>✅ Endereço Atendido pela Zona {simResult.zoneName}</strong>
              <div className="delivery-coverage-result__metrics">
                <span>
                  Taxa de Entrega: <strong>{formatMoney(simResult.feeCents ?? 0)}</strong>
                </span>
                <span>
                  Tempo Estimado: <strong>{simResult.estimatedMinutes} min</strong>
                </span>
                <span>
                  Pedido Mínimo: <strong>{formatMoney(simResult.minimumOrderCents ?? 0)}</strong>
                </span>
              </div>
            </div>
          ) : (
            <div className="delivery-coverage-result__content">
              <strong>⚠️ Não Atendido</strong>
              <p>
                {simResult.message ??
                  "O endereço informado não está coberto por nenhuma zona ativa no momento."}
              </p>
            </div>
          )}
        </div>
      )}
    </Card>
  );
}

function Zones({
  canManage,
  busy,
  onEdit,
  onToggle,
  remote,
  scope,
}: {
  canManage: boolean;
  busy: string;
  onEdit: (zone: DeliveryZone | "new") => void;
  onToggle: (zone: DeliveryZone) => void;
  remote: ReturnType<typeof useRemote<DeliveryZone[]>>;
  scope: GrowthScope;
}) {
  return (
    <section className="delivery-zones" aria-label="Zonas de entrega">
      <Card className="delivery-zones__notice" role="note">
        <Badge tone="info">Cobertura declarada</Badge>
        <p>
          Configure regiões e raios que a operação consegue atender. Utilize o simulador abaixo para
          testar endereços reais diretamente com o backend.
        </p>
      </Card>
      <RemoteGate remote={remote}>
        {(zones) => (
          <>
            <DeliveryCoverageSimulator zones={zones} scope={scope} />
            {zones.length === 0 ? (
              <EmptyState
                action={
                  canManage ? (
                    <Button onClick={() => onEdit("new")} size="sm">
                      <Icon name="plus" size={15} /> Criar zona
                    </Button>
                  ) : undefined
                }
                icon={<Icon name="delivery" size={28} />}
                title="Nenhuma zona configurada"
                description="A entrega própria exige uma zona, taxa e pedido mínimo persistidos."
              />
            ) : (
              <div className="delivery-zones__grid">
                {zones.map((zone) => (
                  <Card className="delivery-zone-real" key={zone.id}>
                    <div className="delivery-zone-real__heading">
                      <div>
                        <h2>{zone.name}</h2>
                        <small>Região declarada</small>
                      </div>
                      <Badge tone={zone.active ? "success" : "neutral"}>
                        {zone.active ? "Ativa" : "Inativa"}
                      </Badge>
                    </div>
                    <dl>
                      <div>
                        <dt>Taxa</dt>
                        <dd>{formatMoney(zone.feeCents)}</dd>
                      </div>
                      <div>
                        <dt>Pedido mínimo</dt>
                        <dd>{formatMoney(zone.minimumOrderCents)}</dd>
                      </div>
                      <div>
                        <dt>Previsão</dt>
                        <dd>{zone.estimatedDeliveryMinutes} min</dd>
                      </div>
                      <div>
                        <dt>Alcance</dt>
                        <dd>
                          {typeof zone.geometry.radiusKm === "number"
                            ? `Raio declarado: ${zone.geometry.radiusKm} km`
                            : "Cobertura declarada"}
                        </dd>
                      </div>
                    </dl>
                    {canManage && (
                      <div className="delivery-zone-real__actions">
                        <Button onClick={() => onEdit(zone)} size="sm" variant="secondary">
                          Editar
                        </Button>
                        <Button
                          disabled={busy === zone.id}
                          onClick={() => onToggle(zone)}
                          size="sm"
                          variant="ghost"
                        >
                          {busy === zone.id ? "Salvando…" : zone.active ? "Desativar" : "Ativar"}
                        </Button>
                      </div>
                    )}
                  </Card>
                ))}
              </div>
            )}
          </>
        )}
      </RemoteGate>
    </section>
  );
}

function OrderModal({
  order,
  busy,
  couriers,
  couriersLoading,
  courierId,
  onClose,
  onCourierChange,
  onDispatch,
  onRequestNotification,
  onTransition,
}: {
  order: DeliveryOrder | null;
  busy: boolean;
  couriers: DeliveryCourier[];
  couriersLoading: boolean;
  courierId: string;
  onClose: () => void;
  onCourierChange: (value: string) => void;
  onDispatch: (event: FormEvent<HTMLFormElement>) => void;
  onRequestNotification: (
    audience: "operations" | "customer",
    type: "status_update" | "courier_assigned" | "courier_arriving",
  ) => void;
  onTransition: () => void;
}) {
  const action = order ? nextAction(order) : null;
  const [notifAudience, setNotifAudience] = useState<"operations" | "customer">("operations");
  const [notifType, setNotifType] = useState<
    "status_update" | "courier_assigned" | "courier_arriving"
  >("status_update");
  return (
    <Modal
      isOpen={order !== null}
      onClose={onClose}
      size="md"
      title={order ? `Pedido ${orderId(order)}` : "Pedido"}
    >
      {order && (
        <div className="delivery-detail">
          <div className="delivery-detail__summary">
            <Badge tone={order.status === "dispatched" ? "success" : "info"}>{order.status}</Badge>
            <strong>{formatMoney(order.totalCents)}</strong>
          </div>
          <dl>
            <div>
              <dt>Cliente</dt>
              <dd>{order.customerName ?? "Não informado"}</dd>
            </div>
            <div>
              <dt>Telefone</dt>
              <dd>{order.customerPhone ?? "Não informado"}</dd>
            </div>
            <div>
              <dt>Endereço</dt>
              <dd>{address(order)}</dd>
            </div>
            <div>
              <dt>Zona</dt>
              <dd>{order.zoneName ?? "Não informada"}</dd>
            </div>
            <div>
              <dt>Entregador</dt>
              <dd>{order.courierReference ?? "A atribuir"}</dd>
            </div>
            {order.courierStatus && (
              <div>
                <dt>Status do entregador</dt>
                <dd>{order.courierStatus}</dd>
              </div>
            )}
            <div>
              <dt>Pagamento</dt>
              <dd>{order.paymentStatus === "paid" ? "Pago" : "Aguardando pagamento"}</dd>
            </div>
            <div>
              <dt>Agendamento</dt>
              <dd>{order.scheduledFor ? dateTime(order.scheduledFor) : "Não agendado"}</dd>
            </div>
            {order.promisedAt && (
              <div>
                <dt>Prometido para</dt>
                <dd>{dateTime(order.promisedAt)}</dd>
              </div>
            )}
            {order.address?.latitude !== undefined && order.address.longitude !== undefined && (
              <div>
                <dt>Coordenadas</dt>
                <dd>{`${order.address.latitude.toFixed(6)}, ${order.address.longitude.toFixed(6)}`}</dd>
              </div>
            )}
            {order.lastPosition && (
              <div>
                <dt>Última posição</dt>
                <dd>{`${order.lastPosition.latitude.toFixed(6)}, ${order.lastPosition.longitude.toFixed(6)} · ${dateTime(order.lastPosition.at)}`}</dd>
              </div>
            )}
          </dl>
          <div className="delivery-detail__totals">
            <span>
              Produtos <strong>{formatMoney(order.subtotalCents)}</strong>
            </span>
            <span>
              Taxa <strong>{formatMoney(order.deliveryFeeCents)}</strong>
            </span>
            <span>
              Total <strong>{formatMoney(order.totalCents)}</strong>
            </span>
          </div>
          <section className="delivery-history" aria-labelledby="delivery-history-title">
            <h3 id="delivery-history-title">Histórico</h3>
            {order.history.length === 0 ? (
              <p>Sem transições registradas para este pedido.</p>
            ) : (
              <ol>
                {order.history.map((entry) => (
                  <li key={entry.id}>
                    <time dateTime={entry.occurredAt}>{dateTime(entry.occurredAt)}</time>
                    <span>{`${entry.fromStatus ? `${entry.fromStatus} → ` : ""}${entry.toStatus}`}</span>
                  </li>
                ))}
              </ol>
            )}
          </section>
          <section
            className="delivery-notifications"
            aria-labelledby="delivery-notifications-title"
          >
            <h3 id="delivery-notifications-title">Notificações</h3>
            {order.notifications.length === 0 ? (
              <p>Nenhuma notificação registrada.</p>
            ) : (
              <ol>
                {order.notifications.map((notification) => (
                  <li key={notification.id}>
                    <span>{`${notification.audience === "operations" ? "Operação" : "Cliente"} · ${notification.type}`}</span>
                    <small>Pendente do provedor — não enviada</small>
                    <time dateTime={notification.createdAt}>
                      {dateTime(notification.createdAt)}
                    </time>
                  </li>
                ))}
              </ol>
            )}
          </section>
          <div className="delivery-notification-trigger">
            <div className="delivery-notification-trigger__fields">
              <label className="gm-form-field">
                <span>Destinatário da notificação</span>
                <NativeSelect
                  onChange={(e) => setNotifAudience(e.target.value as typeof notifAudience)}
                  value={notifAudience}
                >
                  <option value="operations">Equipe Operacional</option>
                  <option value="customer">Cliente (SMS/Push)</option>
                </NativeSelect>
              </label>
              <label className="gm-form-field">
                <span>Tipo do aviso</span>
                <NativeSelect
                  onChange={(e) => setNotifType(e.target.value as typeof notifType)}
                  value={notifType}
                >
                  <option value="status_update">Atualização de status</option>
                  <option value="courier_assigned">Entregador atribuído</option>
                  <option value="courier_arriving">Entregador chegando</option>
                </NativeSelect>
              </label>
            </div>
            <Button
              disabled={busy}
              onClick={() => onRequestNotification(notifAudience, notifType)}
              size="sm"
              variant="secondary"
            >
              Solicitar notificação
            </Button>
          </div>
          {action?.dispatch ? (
            <form className="gm-form-stack" onSubmit={onDispatch}>
              <label className="gm-form-field">
                <span>Entregador disponível</span>
                <NativeSelect
                  onChange={(event) => onCourierChange(event.target.value)}
                  required
                  value={courierId}
                >
                  <option value="">
                    {couriersLoading ? "Carregando entregadores…" : "Selecione um entregador"}
                  </option>
                  {couriers
                    .filter(
                      (courier) => courier.status === "available" || courier.id === order.courierId,
                    )
                    .map((courier) => (
                      <option key={courier.id} value={courier.id}>
                        {`${courier.name} · ${courier.reference}`}
                      </option>
                    ))}
                </NativeSelect>
              </label>
              {couriers.length === 0 && !couriersLoading && (
                <p className="delivery-notice delivery-notice--error" role="status">
                  Nenhum entregador disponível para atribuição.
                </p>
              )}
              <Button disabled={busy || !courierId} type="submit">
                {busy ? "Despachando…" : "Atribuir e despachar"}
              </Button>
            </form>
          ) : (
            action && (
              <Button disabled={busy} onClick={onTransition}>
                {busy ? "Atualizando…" : action.label}
              </Button>
            )
          )}
        </div>
      )}
    </Modal>
  );
}

function CourierModal({
  busy,
  onClose,
  onSubmit,
}: {
  busy: boolean;
  onClose: () => void;
  onSubmit: (values: { name: string; reference: string; phone?: string }) => Promise<void>;
}) {
  const [name, setName] = useState("");
  const [reference, setReference] = useState("");
  const [phone, setPhone] = useState("");
  const [error, setError] = useState("");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (name.trim().length < 2 || reference.trim().length < 2) {
      setError("Informe nome e referência com pelo menos 2 caracteres.");
      return;
    }
    try {
      await onSubmit({
        name: name.trim(),
        reference: reference.trim(),
        ...(phone.trim() ? { phone: phone.trim() } : {}),
      });
      onClose();
    } catch (reason) {
      setError(
        reason instanceof Error ? reason.message : "Não foi possível cadastrar o entregador.",
      );
    }
  }

  return (
    <Modal isOpen onClose={onClose} size="sm" title="Cadastrar entregador">
      <form className="gm-form-stack" onSubmit={(event) => void submit(event)}>
        <label className="gm-form-field">
          <span>Nome</span>
          <Input
            autoComplete="name"
            minLength={2}
            onChange={(event) => setName(event.target.value)}
            required
            value={name}
          />
        </label>
        <label className="gm-form-field">
          <span>Referência operacional</span>
          <Input
            minLength={2}
            onChange={(event) => setReference(event.target.value)}
            required
            value={reference}
          />
        </label>
        <label className="gm-form-field">
          <span>Telefone (opcional)</span>
          <Input
            autoComplete="tel"
            inputMode="tel"
            onChange={(event) => setPhone(event.target.value)}
            type="tel"
            value={phone}
          />
        </label>
        {error && (
          <p className="delivery-notice delivery-notice--error" role="alert">
            {error}
          </p>
        )}
        <div className="delivery-zone-real__actions">
          <Button onClick={onClose} variant="ghost">
            Cancelar
          </Button>
          <Button
            disabled={busy || name.trim().length < 2 || reference.trim().length < 2}
            type="submit"
          >
            {busy ? "Cadastrando…" : "Cadastrar entregador"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

type ZoneValues = {
  name: string;
  feeCents: number;
  minimumOrderCents: number;
  estimatedDeliveryMinutes: number;
  active: boolean;
  radiusKm?: number;
};
function ZoneModal({
  zone,
  busy,
  onClose,
  onSubmit,
}: {
  zone: DeliveryZone | null;
  busy: boolean;
  onClose: () => void;
  onSubmit: (values: ZoneValues) => Promise<void>;
}) {
  const [name, setName] = useState("");
  const [fee, setFee] = useState("0,00");
  const [minimum, setMinimum] = useState("0,00");
  const [estimatedDeliveryMinutes, setEstimatedDeliveryMinutes] = useState("45");
  const [radius, setRadius] = useState("5");
  const [active, setActive] = useState(true);
  const [error, setError] = useState("");
  const radiusEditable = !zone || zone.geometry.type === "unit-radius";
  useEffect(() => {
    setName(zone?.name ?? "");
    setFee(zone ? String(zone.feeCents / 100).replace(".", ",") : "0,00");
    setMinimum(zone ? String(zone.minimumOrderCents / 100).replace(".", ",") : "0,00");
    setEstimatedDeliveryMinutes(zone ? String(zone.estimatedDeliveryMinutes) : "45");
    setRadius(typeof zone?.geometry.radiusKm === "number" ? String(zone.geometry.radiusKm) : "5");
    setActive(zone?.active ?? true);
    setError("");
  }, [zone]);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const parsedFee = moneyToCents(fee);
    const parsedMinimum = moneyToCents(minimum);
    const parsedMinutes = Number(estimatedDeliveryMinutes);
    if (
      name.trim().length < 2 ||
      !Number.isFinite(parsedFee) ||
      parsedFee < 0 ||
      !Number.isFinite(parsedMinimum) ||
      parsedMinimum < 0 ||
      !Number.isInteger(parsedMinutes) ||
      parsedMinutes < 5 ||
      parsedMinutes > 240
    ) {
      setError("Informe região, valores não negativos e uma previsão entre 5 e 240 minutos.");
      return;
    }
    try {
      await onSubmit({
        name: name.trim(),
        feeCents: parsedFee,
        minimumOrderCents: parsedMinimum,
        estimatedDeliveryMinutes: parsedMinutes,
        active,
        ...(radiusEditable ? { radiusKm: Number(radius) } : {}),
      });
      onClose();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Não foi possível salvar a zona.");
    }
  }
  return (
    <Modal
      isOpen
      onClose={onClose}
      size="sm"
      title={zone ? "Editar zona de entrega" : "Nova zona de entrega"}
    >
      <form className="gm-form-stack" onSubmit={(event) => void submit(event)}>
        <label className="gm-form-field">
          <span>Região declarada</span>
          <Input
            minLength={2}
            onChange={(event) => setName(event.target.value)}
            required
            value={name}
          />
        </label>
        {radiusEditable && (
          <label className="gm-form-field">
            <span>Raio declarado (km)</span>
            <Input
              min={0.1}
              onChange={(event) => setRadius(event.target.value)}
              required
              step="0.1"
              type="number"
              value={radius}
            />
          </label>
        )}
        <label className="gm-form-field">
          <span>Taxa (R$)</span>
          <Input
            inputMode="decimal"
            data-currency="brl"
            onChange={(event) => setFee(event.target.value)}
            required
            value={fee}
          />
        </label>
        <label className="gm-form-field">
          <span>Pedido mínimo (R$)</span>
          <Input
            inputMode="decimal"
            data-currency="brl"
            onChange={(event) => setMinimum(event.target.value)}
            required
            value={minimum}
          />
        </label>
        <label className="gm-form-field">
          <span>Previsão de entrega (min)</span>
          <Input
            max={240}
            min={5}
            onChange={(event) => setEstimatedDeliveryMinutes(event.target.value)}
            required
            type="number"
            value={estimatedDeliveryMinutes}
          />
          <small>Informe entre 5 e 240 minutos.</small>
        </label>
        <label className="delivery-zone-real__toggle">
          <input
            checked={active}
            onChange={(event) => setActive(event.target.checked)}
            type="checkbox"
          />
          <span>Zona ativa para novos pedidos</span>
        </label>
        {error && (
          <p className="delivery-notice delivery-notice--error" role="alert">
            {error}
          </p>
        )}
        <div className="delivery-zone-real__actions">
          <Button onClick={onClose} variant="ghost">
            Cancelar
          </Button>
          <Button disabled={busy || name.trim().length < 2} type="submit">
            {busy ? "Salvando…" : "Salvar zona"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
