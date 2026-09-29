import { afterEach, describe, expect, it, vi } from "vitest";
import { api } from "../../api";
import type { PosTab } from "../../operations.shared";
import { ensureCounterDelivery } from "./counter-delivery";

const scope = { organizationId: "organization-1", unitId: "unit-1" };
const tab = {
  id: "tab-1",
  fulfillmentType: "delivery",
  deliveryZoneId: "zone-1",
  deliveryAddressDetails: {
    street: "Rua Central",
    number: "10",
    neighborhood: "Centro",
    city: "São Paulo",
    state: "SP",
    postalCode: "01001-000",
  },
  promisedAt: null,
} as PosTab;
const order = {
  id: "delivery-1",
  orderRef: tab.id,
  publicProtocol: null,
  customerName: "Ana",
  customerPhone: "+5511999990000",
  fulfillment: "delivery",
  status: "placed",
  subtotalCents: 1_000,
  deliveryFeeCents: 500,
  totalCents: 1_500,
  paymentMethod: "pay_on_fulfillment",
  paymentStatus: "awaiting_payment",
  address: tab.deliveryAddressDetails,
  addressValidationStatus: "unchecked",
  scheduledFor: null,
  promisedAt: null,
  createdAt: "2026-09-18T12:00:00.000Z",
  updatedAt: "2026-09-18T12:00:00.000Z",
  zoneName: "Centro",
  history: [],
  notifications: [],
  courierId: null,
  courierReference: null,
  courierStatus: null,
  lastPosition: null,
};

afterEach(() => vi.restoreAllMocks());

describe("retomada de entrega no balcão", () => {
  it("retoma a entrega persistida sem tentar criá-la novamente e atribui entregador opcional", async () => {
    const list = vi.spyOn(api.growth, "deliveryOrders").mockResolvedValue([order]);
    const create = vi.spyOn(api.growth, "createDeliveryOrder");
    const assign = vi.spyOn(api.growth, "assignDeliveryCourier").mockResolvedValue({});

    await expect(ensureCounterDelivery(scope, tab, "delivery-key-1", "courier-1")).resolves.toBe(
      "delivery-1",
    );

    expect(list).toHaveBeenCalledWith("organization-1", "unit-1", { orderRef: "tab-1" });
    expect(create).not.toHaveBeenCalled();
    expect(assign).toHaveBeenCalledWith("organization-1", "delivery-1", {
      courierId: "courier-1",
      idempotencyKey: "delivery-key-1",
    });
  });

  it("cria uma única entrega com o snapshot da comanda quando ainda não há pedido", async () => {
    vi.spyOn(api.growth, "deliveryOrders").mockResolvedValue([]);
    const create = vi
      .spyOn(api.growth, "createDeliveryOrder")
      .mockResolvedValue({ duplicate: false, order });

    await expect(ensureCounterDelivery(scope, tab, "delivery-key-2")).resolves.toBe("delivery-1");

    expect(create).toHaveBeenCalledWith("organization-1", {
      unitId: "unit-1",
      orderRef: "tab-1",
      zoneId: "zone-1",
      fulfillment: "delivery",
      address: tab.deliveryAddressDetails,
      idempotencyKey: "delivery-key-2",
    });
  });

  it("recusa criar sem endereço ou zona, antes de chamar a API", async () => {
    vi.spyOn(api.growth, "deliveryOrders").mockResolvedValue([]);
    const create = vi.spyOn(api.growth, "createDeliveryOrder");

    await expect(
      ensureCounterDelivery(scope, { ...tab, deliveryAddressDetails: null }, "delivery-key-3"),
    ).rejects.toThrow("Complete o endereço e a zona");
    await expect(
      ensureCounterDelivery(scope, { ...tab, deliveryZoneId: null }, "delivery-key-4"),
    ).rejects.toThrow("Complete o endereço e a zona");
    expect(create).not.toHaveBeenCalled();
  });
});
