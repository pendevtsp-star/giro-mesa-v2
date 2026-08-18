const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export const ORDER_READY_NOTIFICATION_TOPIC = "pos.order.ready_notification_requested";

export type OrderReadyChannel = "waiter" | "customer";

export interface OrderReadyNotificationRequest {
  organizationId: string;
  unitId: string;
  orderId: string;
  tabId: string;
  channels: OrderReadyChannel[];
}

export interface OrderReadyDeliveryContext {
  orderStatus: string;
  customerPhone: string | null;
  readyNotificationConsent: boolean;
}

export interface DisabledOrderReadyChannel {
  channel: OrderReadyChannel;
  code: string;
}

export interface OrderReadyDeliveryPlan {
  internalWaiter: boolean;
  externalCustomer: boolean;
  disabled: DisabledOrderReadyChannel[];
}

export class OrderReadyDeliveryError extends Error {
  constructor(
    public readonly code: string,
    public readonly retryable: boolean,
    public readonly disabled = false,
    public readonly metadata: Record<string, unknown> = {},
  ) {
    super(code);
    this.name = "OrderReadyDeliveryError";
  }
}

function requiredUuid(payload: Record<string, unknown>, key: string) {
  const value = payload[key];
  if (typeof value !== "string" || !UUID.test(value)) {
    throw new OrderReadyDeliveryError("ORDER_READY_EVENT_INVALID", false);
  }
  return value;
}

export function parseOrderReadyNotificationRequest(event: {
  aggregate_type: string;
  aggregate_id: string;
  payload: Record<string, unknown>;
}): OrderReadyNotificationRequest {
  const organizationId = requiredUuid(event.payload, "organizationId");
  const unitId = requiredUuid(event.payload, "unitId");
  const orderId = requiredUuid(event.payload, "orderId");
  const tabId = requiredUuid(event.payload, "tabId");
  if (event.aggregate_type !== "order" || event.aggregate_id !== orderId) {
    throw new OrderReadyDeliveryError("ORDER_READY_EVENT_CONTEXT_INVALID", false);
  }
  const channelsValue = event.payload.channels;
  if (!Array.isArray(channelsValue) || channelsValue.length === 0) {
    throw new OrderReadyDeliveryError("ORDER_READY_EVENT_INVALID", false);
  }
  const channels: OrderReadyChannel[] = [];
  for (const value of channelsValue) {
    if (value !== "waiter" && value !== "customer") {
      throw new OrderReadyDeliveryError("ORDER_READY_EVENT_INVALID", false);
    }
    if (!channels.includes(value)) channels.push(value);
  }
  return { organizationId, unitId, orderId, tabId, channels };
}

export function planOrderReadyDelivery(
  request: OrderReadyNotificationRequest,
  context: OrderReadyDeliveryContext,
): OrderReadyDeliveryPlan {
  if (context.orderStatus !== "ready") {
    throw new OrderReadyDeliveryError("ORDER_READY_NOTIFICATION_STALE", false, true, {
      orderStatus: context.orderStatus,
    });
  }

  const disabled: DisabledOrderReadyChannel[] = [];
  const internalWaiter = request.channels.includes("waiter");
  let externalCustomer = false;
  if (request.channels.includes("customer")) {
    if (!context.customerPhone) {
      disabled.push({ channel: "customer", code: "CUSTOMER_CONTACT_UNAVAILABLE" });
    } else if (!context.readyNotificationConsent) {
      disabled.push({ channel: "customer", code: "CUSTOMER_CONSENT_UNAVAILABLE" });
    } else {
      externalCustomer = true;
    }
  }
  return { internalWaiter, externalCustomer, disabled };
}
