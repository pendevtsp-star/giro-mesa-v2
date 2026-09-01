import { Button, Card } from "@giromesa/ui";
import { useCallback, useEffect, useRef, useState } from "react";
import type { ProfileId } from "./domain";
import { shouldShowRefreshProgress } from "./remote-refresh";

export interface GrowthScope {
  organizationId: string;
  unitId: string;
  profileId: ProfileId;
  refreshToken: number;
}

export type Row = Record<string, unknown>;
export type RemoteState<T> =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; data: T };

export class InvalidGrowthPayloadError extends Error {
  constructor() {
    super("A API retornou dados de relacionamento em formato inesperado.");
    this.name = "InvalidGrowthPayloadError";
  }
}

export function record(value: unknown): Row {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    throw new InvalidGrowthPayloadError();
  return value as Row;
}

export function records(value: unknown): Row[] {
  if (!Array.isArray(value)) throw new InvalidGrowthPayloadError();
  return value.map(record);
}

export function text(value: unknown): string {
  if (typeof value !== "string" || value.trim() === "") throw new InvalidGrowthPayloadError();
  return value;
}

export function optionalText(value: unknown): string | null {
  return value === null || value === undefined ? null : text(value);
}

export function number(value: unknown): number {
  const parsed =
    typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  if (!Number.isFinite(parsed)) throw new InvalidGrowthPayloadError();
  return parsed;
}

export function bool(value: unknown): boolean {
  if (typeof value !== "boolean") throw new InvalidGrowthPayloadError();
  return value;
}

export interface DeliveryZone {
  id: string;
  name: string;
  feeCents: number;
  minimumOrderCents: number;
  estimatedDeliveryMinutes: number;
  geometry: Row;
  active: boolean;
}

export function parseDeliveryZones(value: unknown): DeliveryZone[] {
  return records(value).map((row) => ({
    id: text(row.id),
    name: text(row.name),
    feeCents: number(row.feeCents),
    minimumOrderCents: number(row.minimumOrderCents),
    estimatedDeliveryMinutes: number(row.estimatedDeliveryMinutes),
    geometry: record(row.geometry),
    active: bool(row.active),
  }));
}

export type DeliveryOrderStatus =
  | "draft"
  | "placed"
  | "confirmed"
  | "preparing"
  | "ready"
  | "dispatched"
  | "completed"
  | "canceled";

export interface DeliveryOrder {
  id: string;
  orderRef: string;
  publicProtocol: string | null;
  customerName: string | null;
  customerPhone: string | null;
  fulfillment: "delivery" | "pickup";
  status: DeliveryOrderStatus;
  subtotalCents: number;
  deliveryFeeCents: number;
  totalCents: number;
  paymentMethod: string;
  paymentStatus: string;
  address: DeliveryAddress | null;
  scheduledFor: string | null;
  promisedAt: string | null;
  createdAt: string;
  updatedAt: string;
  zoneName: string | null;
  history: DeliveryHistoryEntry[];
  courierId: string | null;
  courierReference: string | null;
  courierStatus: string | null;
  lastPosition: DeliveryPosition | null;
  notifications: DeliveryNotification[];
}

export interface DeliveryHistoryEntry {
  id: string;
  fromStatus: DeliveryOrderStatus | null;
  toStatus: DeliveryOrderStatus;
  occurredAt: string;
  actorIdentityId: string | null;
}

export interface DeliveryPosition {
  latitude: number;
  longitude: number;
  at: string;
}

export interface DeliveryNotification {
  id: string;
  audience: "operations" | "customer";
  type: "status_update" | "courier_assigned" | "courier_arriving";
  status: "pending_provider";
  createdAt: string;
}

export interface DeliveryCourier {
  id: string;
  name: string;
  reference: string;
  phone: string | null;
  status: "available" | "assigned" | "delivering" | "offline";
}

export interface DeliveryAddress {
  street?: string;
  number?: string;
  complement?: string;
  neighborhood?: string;
  city?: string;
  state?: string;
  postalCode?: string;
  latitude?: number;
  longitude?: number;
}

const deliveryOrderStatuses: ReadonlySet<string> = new Set([
  "draft",
  "placed",
  "confirmed",
  "preparing",
  "ready",
  "dispatched",
  "completed",
  "canceled",
]);

function deliveryStatus(value: unknown): DeliveryOrderStatus {
  const status = text(value);
  if (!deliveryOrderStatuses.has(status)) throw new InvalidGrowthPayloadError();
  return status as DeliveryOrderStatus;
}

function optionalNumber(value: unknown): number | undefined {
  return value === null || value === undefined ? undefined : number(value);
}

function address(value: unknown): DeliveryAddress | null {
  if (value === null || value === undefined) return null;
  const row = record(value);
  return {
    street: optionalText(row.street) ?? undefined,
    number: optionalText(row.number) ?? undefined,
    complement: optionalText(row.complement) ?? undefined,
    neighborhood: optionalText(row.neighborhood) ?? undefined,
    city: optionalText(row.city) ?? undefined,
    state: optionalText(row.state) ?? undefined,
    postalCode: optionalText(row.postalCode) ?? undefined,
    latitude: optionalNumber(row.latitude),
    longitude: optionalNumber(row.longitude),
  };
}

function history(value: unknown): DeliveryHistoryEntry[] {
  if (value === null || value === undefined) return [];
  return records(value).map((row) => ({
    id: text(row.id),
    fromStatus:
      row.fromStatus === null || row.fromStatus === undefined
        ? null
        : deliveryStatus(row.fromStatus),
    toStatus: deliveryStatus(row.toStatus),
    occurredAt: text(row.occurredAt),
    actorIdentityId: optionalText(row.actorIdentityId),
  }));
}

function position(value: unknown): DeliveryPosition | null {
  if (value === null || value === undefined) return null;
  const row = record(value);
  return { latitude: number(row.latitude), longitude: number(row.longitude), at: text(row.at) };
}

function deliveryNotifications(value: unknown): DeliveryNotification[] {
  return records(value).map((row) => {
    const audience = text(row.audience);
    const type = text(row.type);
    const status = text(row.status);
    if (audience !== "operations" && audience !== "customer") throw new InvalidGrowthPayloadError();
    if (!["status_update", "courier_assigned", "courier_arriving"].includes(type))
      throw new InvalidGrowthPayloadError();
    if (status !== "pending_provider") throw new InvalidGrowthPayloadError();
    return {
      id: text(row.id),
      audience,
      type: type as DeliveryNotification["type"],
      status: "pending_provider",
      createdAt: text(row.createdAt),
    };
  });
}

export function parseDeliveryOrders(value: unknown): DeliveryOrder[] {
  return records(value).map((row) => {
    const fulfillment = text(row.fulfillment);
    if (fulfillment !== "delivery" && fulfillment !== "pickup")
      throw new InvalidGrowthPayloadError();
    return {
      id: text(row.id),
      orderRef: text(row.orderRef),
      publicProtocol: optionalText(row.publicProtocol),
      customerName: optionalText(row.customerName),
      customerPhone: optionalText(row.customerPhone),
      fulfillment,
      status: deliveryStatus(row.status),
      subtotalCents: number(row.subtotalCents),
      deliveryFeeCents: number(row.deliveryFeeCents),
      totalCents: number(row.totalCents),
      paymentMethod: text(row.paymentMethod),
      paymentStatus: text(row.paymentStatus),
      address: address(row.address),
      scheduledFor: optionalText(row.scheduledFor),
      promisedAt: optionalText(row.promisedAt),
      createdAt: text(row.createdAt),
      updatedAt: text(row.updatedAt),
      zoneName: optionalText(row.zoneName),
      history: history(row.history),
      courierId: optionalText(row.courierId),
      courierReference: optionalText(row.courierReference),
      courierStatus: optionalText(row.courierStatus),
      lastPosition: position(row.lastPosition),
      notifications: deliveryNotifications(row.notifications),
    };
  });
}

export function parseDeliveryCouriers(value: unknown): DeliveryCourier[] {
  return records(value).map((row) => {
    const status = text(row.status);
    if (!["available", "assigned", "delivering", "offline"].includes(status))
      throw new InvalidGrowthPayloadError();
    return {
      id: text(row.id),
      name: text(row.name),
      reference: text(row.reference),
      phone: optionalText(row.phone),
      status: status as DeliveryCourier["status"],
    };
  });
}

function deliveryMutation(
  value: unknown,
  key: string,
): { duplicate: boolean; payload: Record<string, unknown> } {
  const row = record(value);
  return { duplicate: bool(row.duplicate), payload: record(row[key]) };
}

export function parseDeliveryCourierMutation(value: unknown): {
  duplicate: boolean;
  courier: DeliveryCourier;
} {
  const mutation = deliveryMutation(value, "courier");
  const courier = parseDeliveryCouriers([mutation.payload])[0];
  if (!courier) throw new InvalidGrowthPayloadError();
  return { duplicate: mutation.duplicate, courier };
}

export function parseDeliveryOrderMutation(value: unknown): {
  duplicate: boolean;
  order: DeliveryOrder;
} {
  const mutation = deliveryMutation(value, "order");
  const order = parseDeliveryOrders([mutation.payload])[0];
  if (!order) throw new InvalidGrowthPayloadError();
  return { duplicate: mutation.duplicate, order };
}

export function parseDeliveryNotificationMutation(value: unknown): {
  duplicate: boolean;
  notification: DeliveryNotification;
} {
  const mutation = deliveryMutation(value, "notification");
  const notification = deliveryNotifications([mutation.payload])[0];
  if (!notification) throw new InvalidGrowthPayloadError();
  return { duplicate: mutation.duplicate, notification };
}

export function mergeDeliveryOrders(
  current: DeliveryOrder[],
  updates: DeliveryOrder[],
): DeliveryOrder[] {
  const byId = new Map(current.map((order) => [order.id, order]));
  for (const order of updates) byId.set(order.id, order);
  return [...byId.values()].sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
}

export function isDeliverySlaOverdue(
  order: Pick<DeliveryOrder, "promisedAt" | "status">,
  now = Date.now(),
): boolean {
  if (order.status === "completed" || order.status === "canceled" || !order.promisedAt)
    return false;
  const promisedAt = new Date(order.promisedAt).getTime();
  return Number.isFinite(promisedAt) && promisedAt < now;
}

export interface Reservation {
  id: string;
  customerId: string | null;
  guestName: string;
  guestPhone: string | null;
  partySize: number;
  scheduledAt: string;
  durationMinutes: number;
  status: string;
  notes: string | null;
  updatedAt: string;
}

export interface WaitlistEntry {
  id: string;
  customerId: string | null;
  guestName: string;
  guestPhone: string | null;
  partySize: number;
  quotedWaitMinutes: number | null;
  status: string;
  joinedAt: string;
  updatedAt: string;
}

export function parseReservations(value: unknown): Reservation[] {
  return records(value).map((row) => ({
    id: text(row.id),
    customerId: optionalText(row.customerId),
    guestName: text(row.guestName),
    guestPhone: optionalText(row.guestPhone),
    partySize: number(row.partySize),
    scheduledAt: text(row.scheduledAt),
    durationMinutes: number(row.durationMinutes),
    status: text(row.status),
    notes: optionalText(row.notes),
    updatedAt: optionalText(row.updatedAt) ?? text(row.scheduledAt),
  }));
}

export function parseWaitlist(value: unknown): WaitlistEntry[] {
  return records(value).map((row) => ({
    id: text(row.id),
    customerId: optionalText(row.customerId),
    guestName: text(row.guestName),
    guestPhone: optionalText(row.guestPhone),
    partySize: number(row.partySize),
    quotedWaitMinutes: row.quotedWaitMinutes === null ? null : number(row.quotedWaitMinutes),
    status: text(row.status),
    joinedAt: text(row.joinedAt),
    updatedAt: optionalText(row.updatedAt) ?? text(row.joinedAt),
  }));
}

export interface Customer {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  marketingOptIn: boolean;
}

export interface Campaign {
  id: string;
  name: string;
  channel: string;
  status: string;
  subject: string | null;
  queuedAt: string | null;
  sentAt: string | null;
}

export function parseCustomers(value: unknown): Customer[] {
  return records(value).map((row) => ({
    id: text(row.id),
    name: text(row.name),
    email: optionalText(row.email),
    phone: optionalText(row.phone),
    marketingOptIn: bool(row.marketingOptIn),
  }));
}

export function parseCustomerPage(value: unknown): Customer[] {
  return parseCustomers(record(value).items);
}

export function parseCampaigns(value: unknown): Campaign[] {
  return records(value).map((row) => ({
    id: text(row.id),
    name: text(row.name),
    channel: text(row.channel),
    status: text(row.status),
    subject: optionalText(row.subject),
    queuedAt: optionalText(row.queuedAt),
    sentAt: optionalText(row.sentAt),
  }));
}

export interface MultiunitSummary {
  generatedAt: string;
  units: Array<{
    id: string;
    name: string;
    completedDeliveryGrossCents: number;
    activeReservations: number;
    activeWaitlist: number;
  }>;
  transfersByStatus: Record<string, number>;
  disclaimer: string;
}

export function parseMultiunitSummary(value: unknown): MultiunitSummary {
  const payload = record(value);
  const transfers = record(payload.transfersByStatus);
  return {
    generatedAt: text(payload.generatedAt),
    units: records(payload.units).map((row) => ({
      id: text(row.id),
      name: text(row.name),
      completedDeliveryGrossCents: number(row.completedDeliveryGrossCents),
      activeReservations: number(row.activeReservations),
      activeWaitlist: number(row.activeWaitlist),
    })),
    transfersByStatus: Object.fromEntries(
      Object.entries(transfers).map(([key, value]) => [key, number(value)]),
    ),
    disclaimer: text(payload.disclaimer),
  };
}

export function useRemote<T>(
  scope: GrowthScope,
  loader: () => Promise<unknown>,
  parser: (value: unknown) => T,
  dependencyKey = "",
) {
  const [retryToken, setRetryToken] = useState(0);
  const [silentRefreshToken, setSilentRefreshToken] = useState(0);
  const [state, setState] = useState<RemoteState<T>>({ status: "loading" });
  const [refreshing, setRefreshing] = useState(false);
  const [refreshError, setRefreshError] = useState<string | null>(null);
  const [lastSuccessfulAt, setLastSuccessfulAt] = useState<string | null>(null);
  const loaderRef = useRef(loader);
  const parserRef = useRef(parser);
  const readyRef = useRef(false);
  const retryTokenRef = useRef(retryToken);
  const dependencyKeyRef = useRef(dependencyKey);
  const scopeKeyRef = useRef(`${scope.organizationId}:${scope.unitId}`);
  loaderRef.current = loader;
  parserRef.current = parser;
  useEffect(() => {
    void retryToken;
    void silentRefreshToken;
    void scope.organizationId;
    void scope.refreshToken;
    void scope.unitId;
    void dependencyKey;
    let active = true;
    const scopeKey = `${scope.organizationId}:${scope.unitId}`;
    const scopeChanged = scopeKeyRef.current !== scopeKey;
    const retryChanged = retryTokenRef.current !== retryToken;
    const resourceChanged = dependencyKeyRef.current !== dependencyKey;
    scopeKeyRef.current = scopeKey;
    retryTokenRef.current = retryToken;
    dependencyKeyRef.current = dependencyKey;
    const showProgress = shouldShowRefreshProgress(readyRef.current, retryChanged, resourceChanged);
    if (scopeChanged) {
      readyRef.current = false;
      setLastSuccessfulAt(null);
      setState({ status: "loading" });
    } else {
      setState((prev) => (prev.status === "ready" ? prev : { status: "loading" }));
    }
    setRefreshing(!scopeChanged && showProgress);
    if (scopeChanged || showProgress) setRefreshError(null);
    loaderRef
      .current()
      .then(parserRef.current)
      .then((data) => {
        if (!active) return;
        readyRef.current = true;
        setState({ status: "ready", data });
        setRefreshError(null);
        setLastSuccessfulAt(new Date().toISOString());
      })
      .catch((error: unknown) => {
        if (!active) return;
        const message =
          error instanceof Error ? error.message : "Não foi possível carregar os dados.";
        setRefreshError(message);
        setState((prev) => (prev.status === "ready" ? prev : { status: "error", message }));
      })
      .finally(() => active && setRefreshing(false));
    return () => {
      active = false;
    };
  }, [
    dependencyKey,
    retryToken,
    scope.organizationId,
    scope.refreshToken,
    scope.unitId,
    silentRefreshToken,
  ]);
  const retry = useCallback(() => setRetryToken((value) => value + 1), []);
  const refreshSilently = useCallback(() => setSilentRefreshToken((value) => value + 1), []);
  const update = useCallback((updater: (data: T) => T) => {
    setState((current) =>
      current.status === "ready" ? { status: "ready", data: updater(current.data) } : current,
    );
  }, []);
  return { state, retry, refreshSilently, update, refreshing, refreshError, lastSuccessfulAt };
}

export function RemoteGate<T>({
  remote,
  children,
}: {
  remote: ReturnType<typeof useRemote<T>>;
  children: (data: T) => React.ReactNode;
}) {
  if (remote.state.status === "loading")
    return (
      <Card className="remote-state" role="status">
        <span className="spinner" aria-hidden="true" />
        <strong>Carregando dados persistidos…</strong>
      </Card>
    );
  if (remote.state.status === "error")
    return (
      <Card className="remote-state" role="alert">
        <strong>Não foi possível carregar esta área</strong>
        <p>{remote.state.message}</p>
        <Button onClick={remote.retry} size="sm" variant="secondary">
          Tentar novamente
        </Button>
      </Card>
    );
  return children(remote.state.data);
}

export function dateTime(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? "Data inválida"
    : new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short" }).format(date);
}

export function moneyToCents(value: string): number {
  const normalized = value.trim().replace(/\./g, "").replace(",", ".");
  const amount = Number(normalized);
  return Number.isFinite(amount) ? Math.round(amount * 100) : -1;
}

export function mutationKey(prefix: string): string {
  return `${prefix}-${crypto.randomUUID()}`;
}
