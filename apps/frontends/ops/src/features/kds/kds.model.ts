import type { PilotAction } from "../../operational-dispatch";
import type {
  KdsAllDayItem,
  KdsData,
  KdsItem,
  KdsItemState,
  KdsTicket,
  KdsTicketStatus,
} from "../../operations.shared";

export const KDS_PILOT_ACTIONS = {
  ticketState: "transition-kds",
  itemState: "transition-kds-item",
  refireItem: "refire-kds-item",
  recall: "recall-kds",
  priority: "set-kds-priority",
  orderPriority: "set-kds-order-priority",
  courseState: "set-kds-course-state",
  availability: "set-kds-product-availability",
  handoff: "handoff-kds-order",
  cancelTicket: "cancel-kds-ticket",
  blockItem: "block-kds-item",
  unblockItem: "unblock-kds-item",
  acknowledgeAttention: "acknowledge-kds-critical-note",
  rerouteItem: "reroute-kds-item",
  createBatch: "create-kds-batch",
  completeBatch: "complete-kds-batch",
  cancelBatch: "cancel-kds-batch",
} satisfies Record<string, PilotAction>;

export const KDS_ACTIVE_STATUSES: KdsTicketStatus[] = ["pending", "preparing", "ready"];

// ponytail: compatibilidade com o limiar legado; remover quando toda unidade enviar sla.targetMinutes.
export const KDS_LEGACY_SLA_MINUTES = 20;

export const KDS_STATUS_LABEL: Record<KdsTicketStatus, string> = {
  pending: "Aguardando",
  preparing: "Em preparo",
  ready: "Pronto",
  done: "Entregue",
  canceled: "Cancelado",
};

export const KDS_ITEM_STATE_LABEL: Record<KdsItemState, string> = {
  pending: "Na fila",
  queued: "Na fila",
  held: "Segurado",
  fired: "Fogo liberado",
  preparing: "Em preparo",
  ready: "Pronto",
  done: "Entregue",
  canceled: "Cancelado",
};

export const KDS_COURSE_LABEL: Record<KdsItem["course"], string> = {
  anytime: "A qualquer momento",
  starter: "Entrada",
  main: "Principal",
  dessert: "Sobremesa",
};

const channelLabels: Record<string, string> = {
  dine_in: "Salão",
  salon: "Salão",
  counter: "Balcão",
  pickup: "Retirada",
  delivery: "Delivery",
  qr: "QR Code",
};

export function kdsChannelLabel(channel: string | null): string | null {
  if (!channel) return null;
  return channelLabels[channel.toLowerCase()] ?? channel;
}

export function kdsTicketReference(ticket: KdsTicket): string {
  return (
    ticket.tableLabel ??
    ticket.tabLabel ??
    ticket.reference ??
    ticket.customerName ??
    `Pedido #${ticket.orderId.slice(0, 6)}`
  );
}

export function kdsStationLabel(ticket: KdsTicket): string {
  return ticket.stationName ?? `Estação ${ticket.stationId.slice(0, 6)}`;
}

function timestamp(value: string | null): number | null {
  if (!value) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function kdsElapsedMinutes(ticket: KdsTicket, now: number): number {
  const createdAt = timestamp(ticket.createdAt);
  if (createdAt !== null) return Math.max(0, Math.floor((now - createdAt) / 60_000));
  return Math.max(0, Math.floor(ticket.elapsedMinutes ?? 0));
}

export function kdsSla(ticket: KdsTicket, now: number) {
  const elapsedMinutes = kdsElapsedMinutes(ticket, now);
  const targetMinutes = ticket.slaMinutes ?? KDS_LEGACY_SLA_MINUTES;
  const overdueMinutes = Math.max(ticket.overdueMinutes ?? 0, elapsedMinutes - targetMinutes, 0);
  return {
    elapsedMinutes,
    targetMinutes,
    overdueMinutes,
    isOverdue: ticket.isOverdue || overdueMinutes > 0,
  };
}

export function sortKdsTickets(tickets: KdsTicket[], now: number): KdsTicket[] {
  return [...tickets].sort((left, right) => {
    if (left.rush !== right.rush) return left.rush ? -1 : 1;
    if (left.priority !== right.priority) return right.priority - left.priority;
    const leftSla = kdsSla(left, now);
    const rightSla = kdsSla(right, now);
    if (leftSla.isOverdue !== rightSla.isOverdue) return leftSla.isOverdue ? -1 : 1;
    if (leftSla.overdueMinutes !== rightSla.overdueMinutes) {
      return rightSla.overdueMinutes - leftSla.overdueMinutes;
    }
    const leftDue = timestamp(left.dueAt ?? left.promisedAt);
    const rightDue = timestamp(right.dueAt ?? right.promisedAt);
    if (leftDue !== rightDue)
      return (leftDue ?? Number.MAX_SAFE_INTEGER) - (rightDue ?? Number.MAX_SAFE_INTEGER);
    return (
      (timestamp(left.createdAt) ?? Number.MAX_SAFE_INTEGER) -
      (timestamp(right.createdAt) ?? Number.MAX_SAFE_INTEGER)
    );
  });
}

export function itemsForTicket(data: KdsData, ticketId: string): KdsItem[] {
  const courseOrder: Record<KdsItem["course"], number> = {
    anytime: 0,
    starter: 1,
    main: 2,
    dessert: 3,
  };
  return data.items
    .filter((row) => row.ticketId === ticketId)
    .map((row) => row.item)
    .sort((left, right) => courseOrder[left.course] - courseOrder[right.course]);
}

export function findKdsItemAssignment(
  data: KdsData,
  ticketId: string,
  itemId: string,
): KdsItem | null {
  return (
    data.items.find((row) => row.ticketId === ticketId && row.item.id === itemId)?.item ?? null
  );
}

export function isKdsRerouteConfirmed(
  data: KdsData,
  sourceTicketId: string,
  itemId: string,
  targetStationId: string,
): boolean {
  const sourceAssignmentExists = data.items.some(
    (row) => row.ticketId === sourceTicketId && row.item.id === itemId,
  );
  const targetAssignmentExists = data.items.some(
    (row) =>
      row.item.id === itemId &&
      data.tickets.some(
        (ticket) => ticket.id === row.ticketId && ticket.stationId === targetStationId,
      ),
  );
  return !sourceAssignmentExists && targetAssignmentExists;
}

export function isKdsItemTransitionConfirmed(
  data: KdsData,
  ticketId: string,
  itemId: string,
  state: "preparing" | "ready",
  minimumReadyQuantity?: number,
): boolean {
  const item = findKdsItemAssignment(data, ticketId, itemId);
  if (!item) return false;
  if (state === "ready" && minimumReadyQuantity !== undefined) {
    return item.readyQuantity >= minimumReadyQuantity;
  }
  return item.kdsState === state;
}

export function deriveKdsAllDay(data: KdsData, tickets: KdsTicket[]): KdsAllDayItem[] {
  const visibleTicketIds = new Set(tickets.map((ticket) => ticket.id));
  const totals = new Map<string, KdsAllDayItem>();
  for (const { ticketId, item } of data.items) {
    if (
      !visibleTicketIds.has(ticketId) ||
      item.kdsState === "canceled" ||
      item.kdsState === "done"
    ) {
      continue;
    }
    const productKey = item.productId ?? `name:${item.productName}`;
    const current = totals.get(productKey) ?? {
      productId: item.productId,
      productName: item.productName,
      quantity: 0,
      stationId: null,
      queuedQuantity: 0,
      preparingQuantity: 0,
      readyQuantity: 0,
      heldQuantity: 0,
    };
    const readyQuantity = Math.min(item.quantity, Math.max(0, item.readyQuantity));
    const legacyReadyQuantity =
      item.kdsState === "ready" && readyQuantity === 0 ? item.quantity : readyQuantity;
    const remainingQuantity = Math.max(0, item.quantity - legacyReadyQuantity);
    current.quantity += item.quantity;
    current.readyQuantity += legacyReadyQuantity;
    if (["pending", "queued", "fired"].includes(item.kdsState)) {
      current.queuedQuantity += remainingQuantity;
    }
    if (item.kdsState === "preparing") current.preparingQuantity += remainingQuantity;
    if (item.kdsState === "held") current.heldQuantity += remainingQuantity;
    totals.set(productKey, current);
  }
  return productiveKdsAllDay([...totals.values()]);
}

export function productiveKdsAllDay(items: KdsAllDayItem[]): KdsAllDayItem[] {
  const totals = new Map<string, KdsAllDayItem>();
  for (const item of items) {
    const productKey = item.productId ?? `name:${item.productName}`;
    const suppliedCounts =
      item.queuedQuantity + item.preparingQuantity + item.readyQuantity + item.heldQuantity;
    const queuedQuantity =
      suppliedCounts === 0 && item.quantity > 0 ? item.quantity : item.queuedQuantity;
    const relevantQuantity =
      queuedQuantity + item.preparingQuantity + item.readyQuantity + item.heldQuantity;
    if (relevantQuantity <= 0) continue;
    const current = totals.get(productKey) ?? {
      productId: item.productId,
      productName: item.productName,
      quantity: 0,
      stationId: item.stationId,
      queuedQuantity: 0,
      preparingQuantity: 0,
      readyQuantity: 0,
      heldQuantity: 0,
    };
    current.quantity += relevantQuantity;
    current.queuedQuantity += queuedQuantity;
    current.preparingQuantity += item.preparingQuantity;
    current.readyQuantity += item.readyQuantity;
    current.heldQuantity += item.heldQuantity;
    if (current.stationId !== item.stationId) current.stationId = null;
    totals.set(productKey, current);
  }
  return [...totals.values()].sort((left, right) => {
    const leftWork = left.queuedQuantity + left.preparingQuantity + left.heldQuantity;
    const rightWork = right.queuedQuantity + right.preparingQuantity + right.heldQuantity;
    return (
      rightWork - leftWork ||
      right.quantity - left.quantity ||
      left.productName.localeCompare(right.productName)
    );
  });
}

export function kdsFreshnessAgeMinutes(data: KdsData, now: number): number | null {
  const capturedAt = timestamp(data.freshness.lastSyncedAt ?? data.capturedAt);
  return capturedAt === null ? null : Math.max(0, Math.floor((now - capturedAt) / 60_000));
}

export interface KdsAnalytics {
  capturedAt: string | null;
  windowHours: number;
  prep: {
    p50Minutes: number | null;
    p90Minutes: number | null;
    averageMinutes: number | null;
    sampleSize: number;
  };
  counts: {
    completed: number | null;
    canceled: number | null;
    blocked: number | null;
    refired: number | null;
    rerouted: number | null;
    availability86: number | null;
  };
  slowProducts: Array<{
    productId: string | null;
    productName: string;
    count: number;
    p50Minutes: number | null;
    p90Minutes: number | null;
  }>;
}

function analyticsRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function analyticsNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

export function parseKdsAnalytics(value: unknown): KdsAnalytics {
  const payload = analyticsRecord(value);
  const prep = analyticsRecord(payload.prep ?? payload.preparation);
  const window = analyticsRecord(payload.window);
  const counts = analyticsRecord(payload.counts);
  const slowProducts = Array.isArray(payload.slowProducts) ? payload.slowProducts : [];
  return {
    capturedAt: typeof payload.capturedAt === "string" ? payload.capturedAt : null,
    windowHours: analyticsNumber(window.hours ?? payload.windowHours) ?? 24,
    prep: {
      p50Minutes:
        analyticsNumber(prep.p50Minutes ?? prep.p50) ??
        analyticsNumber(payload.p50PrepMinutes ?? payload.medianPrepMinutes),
      p90Minutes:
        analyticsNumber(prep.p90Minutes ?? prep.p90) ?? analyticsNumber(payload.p90PrepMinutes),
      averageMinutes:
        analyticsNumber(prep.averageMinutes ?? prep.average) ??
        analyticsNumber(payload.averagePrepMinutes),
      sampleSize: analyticsNumber(payload.sampleSize ?? prep.sampleSize) ?? 0,
    },
    counts: {
      completed: analyticsNumber(counts.completed ?? payload.completedCount),
      canceled: analyticsNumber(counts.canceled ?? payload.canceledCount),
      blocked: analyticsNumber(counts.blocked ?? payload.blockedCount),
      refired: analyticsNumber(counts.refired ?? payload.refiredCount),
      rerouted: analyticsNumber(counts.rerouted ?? payload.reroutedCount),
      availability86: analyticsNumber(counts.availability86 ?? payload.availability86Count),
    },
    slowProducts: slowProducts.flatMap((entry) => {
      const row = analyticsRecord(entry);
      const productName =
        typeof row.productName === "string"
          ? row.productName
          : typeof row.name === "string"
            ? row.name
            : null;
      if (!productName) return [];
      return [
        {
          productId: typeof row.productId === "string" ? row.productId : null,
          productName,
          count: analyticsNumber(row.count ?? row.sampleSize) ?? 0,
          p50Minutes: analyticsNumber(row.p50Minutes ?? row.p50),
          p90Minutes: analyticsNumber(row.p90Minutes ?? row.p90),
        },
      ];
    }),
  };
}

export function kdsHasUnacknowledgedAttention(item: KdsItem): boolean {
  return item.attention.some(
    (attention) => attention.required && attention.acknowledgedAt === null,
  );
}

export function kdsOperatingDay(now = new Date()): string {
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function shouldInvalidateKdsTopic(topic?: string): boolean {
  if (!topic) return false;
  return ["pos.kds.", "pos.kds_", "pos.order.", "pos.item.", "pos.batch."].some((prefix) =>
    topic.startsWith(prefix),
  );
}
