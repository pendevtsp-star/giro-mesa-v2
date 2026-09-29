import { api } from "../../api";
import { parseDeliveryOrderMutation, parseDeliveryOrders } from "../../growth.shared";
import type { PilotScope, PosTab } from "../../operations.shared";

/** Resumes an existing delivery before attempting another create after a timeout. */
export async function ensureCounterDelivery(
  scope: Pick<PilotScope, "organizationId" | "unitId">,
  tab: PosTab,
  idempotencyKey: string,
  courierId?: string,
) {
  const { organizationId, unitId } = scope;
  let delivery = parseDeliveryOrders(
    await api.growth.deliveryOrders(organizationId, unitId, { orderRef: tab.id }),
  ).find((order) => order.orderRef === tab.id);
  if (!delivery) {
    if (!tab.deliveryAddressDetails || !tab.deliveryZoneId) {
      throw Object.assign(new Error("Complete o endereço e a zona nos dados da entrega."), {
        code: "DELIVERY_ORDER_REGISTRATION_REQUIRED",
      });
    }
    delivery = parseDeliveryOrderMutation(
      await api.growth.createDeliveryOrder(organizationId, {
        unitId,
        orderRef: tab.id,
        zoneId: tab.deliveryZoneId,
        fulfillment: "delivery",
        address: tab.deliveryAddressDetails,
        ...(tab.promisedAt ? { promisedAt: tab.promisedAt } : {}),
        idempotencyKey,
      }),
    ).order;
  }
  if (courierId && courierId !== delivery.courierId) {
    await api.growth.assignDeliveryCourier(organizationId, delivery.id, {
      courierId,
      idempotencyKey,
    });
  }
  return delivery.id;
}
