import { describe, expect, it } from "vitest";
import type { DeliveryOrder } from "./growth.shared";
import {
  InvalidGrowthPayloadError,
  isDeliverySlaOverdue,
  mergeDeliveryOrders,
  parseCampaigns,
  parseDeliveryCourierMutation,
  parseDeliveryCouriers,
  parseDeliveryNotificationMutation,
  parseDeliveryOrderMutation,
  parseDeliveryOrders,
  parseDeliveryZones,
  parseMultiunitSummary,
} from "./growth.shared";

describe("contratos de crescimento reais", () => {
  it("mantém zonas e status de campanha exatamente como persistidos", () => {
    expect(
      parseDeliveryZones([
        {
          id: "zone-1",
          name: "Centro",
          feeCents: 700,
          minimumOrderCents: 3_000,
          estimatedDeliveryMinutes: 45,
          geometry: { type: "unit-radius", radiusKm: 5 },
          active: true,
        },
      ])[0],
    ).toMatchObject({ name: "Centro", feeCents: 700, estimatedDeliveryMinutes: 45, active: true });
    expect(
      parseCampaigns([
        {
          id: "campaign-1",
          name: "Volte sempre",
          channel: "whatsapp",
          status: "blocked",
          subject: null,
          queuedAt: null,
          sentAt: null,
        },
      ])[0]?.status,
    ).toBe("blocked");
  });

  it("valida o consolidado multiunidade e preserva o aviso do backend", () => {
    const summary = parseMultiunitSummary({
      organizationId: "org-1",
      generatedAt: "2026-08-09T20:00:00.000Z",
      units: [
        {
          id: "unit-1",
          name: "Centro",
          completedDeliveryGrossCents: 10_000,
          activeReservations: 2,
          activeWaitlist: 1,
        },
      ],
      transfersByStatus: { requested: 2 },
      disclaimer: "Baseado em registros persistidos.",
    });
    expect(summary.units[0]?.completedDeliveryGrossCents).toBe(10_000);
    expect(summary.disclaimer).toContain("persistidos");
  });

  it("rejeita payload incompleto em vez de preencher com fixture", () => {
    expect(() => parseDeliveryZones([{ id: "zone-1" }])).toThrow(InvalidGrowthPayloadError);
  });

  it("mantém pedidos de delivery persistidos, incluindo despacho e zona", () => {
    const [order] = parseDeliveryOrders([
      {
        id: "delivery-1",
        orderRef: "tab-1",
        publicProtocol: "D-101",
        customerName: "Cliente real",
        customerPhone: "11999999999",
        fulfillment: "delivery",
        status: "ready",
        subtotalCents: 5_000,
        deliveryFeeCents: 800,
        totalCents: 5_800,
        paymentMethod: "pay_on_fulfillment",
        paymentStatus: "awaiting_payment",
        address: {
          street: "Rua Um",
          number: "10",
          state: "SP",
          postalCode: "01000-000",
          latitude: -23.55,
          longitude: -46.63,
        },
        scheduledFor: null,
        promisedAt: "2026-08-16T20:30:00.000Z",
        createdAt: "2026-08-16T20:00:00.000Z",
        updatedAt: "2026-08-16T20:00:00.000Z",
        zoneName: "Centro",
        history: [
          {
            id: "delivery-history-1",
            fromStatus: "preparing",
            toStatus: "ready",
            occurredAt: "2026-08-16T20:10:00.000Z",
            actorIdentityId: "identity-1",
          },
        ],
        courierId: "courier-1",
        courierReference: "motoboy-1",
        courierStatus: "available",
        lastPosition: { latitude: -23.551, longitude: -46.631, at: "2026-08-16T20:15:00.000Z" },
        notifications: [
          {
            id: "notification-1",
            audience: "operations",
            type: "status_update",
            status: "pending_provider",
            createdAt: "2026-08-16T20:16:00.000Z",
          },
        ],
      },
    ]);

    expect(order).toMatchObject({
      publicProtocol: "D-101",
      promisedAt: "2026-08-16T20:30:00.000Z",
      zoneName: "Centro",
      totalCents: 5_800,
      address: { state: "SP", postalCode: "01000-000", latitude: -23.55 },
      history: [{ fromStatus: "preparing", toStatus: "ready" }],
      courierId: "courier-1",
      lastPosition: { latitude: -23.551, longitude: -46.631 },
      notifications: [{ status: "pending_provider", audience: "operations" }],
    });
    expect(() => parseDeliveryOrders([{ id: "delivery-1", status: "ready" }])).toThrow(
      InvalidGrowthPayloadError,
    );
  });

  it("valida entregadores persistidos para atribuição", () => {
    expect(
      parseDeliveryCouriers([
        {
          id: "courier-1",
          name: "João Motoboy",
          reference: "MOTO-01",
          phone: "11999999999",
          status: "available",
        },
      ]),
    ).toEqual([
      {
        id: "courier-1",
        name: "João Motoboy",
        reference: "MOTO-01",
        phone: "11999999999",
        status: "available",
      },
    ]);
    expect(() => parseDeliveryCouriers([{ id: "courier-1", status: "on_route" }])).toThrow(
      InvalidGrowthPayloadError,
    );
    expect(
      parseDeliveryCouriers([
        { id: "courier-2", name: "Ana", reference: "MOTO-02", phone: null, status: "delivering" },
      ])[0]?.status,
    ).toBe("delivering");
  });

  it("exige envelopes idempotentes para mutações de delivery", () => {
    const courier = {
      id: "courier-1",
      name: "João Motoboy",
      reference: "MOTO-01",
      phone: null,
      status: "available",
    };
    expect(parseDeliveryCourierMutation({ duplicate: false, courier })).toMatchObject({
      duplicate: false,
      courier,
    });
    expect(() => parseDeliveryCourierMutation(courier)).toThrow(InvalidGrowthPayloadError);
    expect(
      parseDeliveryNotificationMutation({
        duplicate: true,
        notification: {
          id: "notification-1",
          audience: "operations",
          type: "status_update",
          status: "pending_provider",
          createdAt: "2026-08-17T20:00:00.000Z",
        },
      }),
    ).toMatchObject({ duplicate: true, notification: { status: "pending_provider" } });
    expect(() => parseDeliveryNotificationMutation({ duplicate: false, notification: {} })).toThrow(
      InvalidGrowthPayloadError,
    );

    const [order] = parseDeliveryOrders([
      {
        id: "delivery-1",
        orderRef: "tab-1",
        publicProtocol: null,
        customerName: null,
        customerPhone: null,
        fulfillment: "delivery",
        status: "ready",
        subtotalCents: 1_000,
        deliveryFeeCents: 0,
        totalCents: 1_000,
        paymentMethod: "pay_on_fulfillment",
        paymentStatus: "awaiting_payment",
        address: null,
        scheduledFor: null,
        promisedAt: null,
        createdAt: "2026-08-17T20:00:00.000Z",
        updatedAt: "2026-08-17T20:00:00.000Z",
        zoneName: null,
        notifications: [],
      },
    ]);
    expect(order).toBeDefined();
    if (!order) return;
    expect(parseDeliveryOrderMutation({ duplicate: false, order })).toMatchObject({
      duplicate: false,
      order: { id: "delivery-1" },
    });
    expect(() => parseDeliveryOrderMutation(order)).toThrow(InvalidGrowthPayloadError);
  });

  it("mescla atualizações incrementais e identifica SLA vencido pelo prazo prometido", () => {
    const first = parseDeliveryOrders([
      {
        id: "delivery-1",
        orderRef: "tab-1",
        publicProtocol: null,
        customerName: null,
        customerPhone: null,
        fulfillment: "delivery",
        status: "preparing",
        subtotalCents: 1_000,
        deliveryFeeCents: 0,
        totalCents: 1_000,
        paymentMethod: "pay_on_fulfillment",
        paymentStatus: "awaiting_payment",
        address: null,
        scheduledFor: null,
        promisedAt: "2026-08-16T20:00:00.000Z",
        createdAt: "2026-08-16T19:00:00.000Z",
        updatedAt: "2026-08-16T19:00:00.000Z",
        zoneName: null,
        courierReference: null,
        notifications: [],
      },
    ]);
    const order = first[0];
    expect(order).toBeDefined();
    if (!order) return;
    const update: DeliveryOrder[] = [
      { ...order, status: "ready", updatedAt: "2026-08-16T20:01:00.000Z" },
    ];

    expect(mergeDeliveryOrders(first, update)).toMatchObject([
      { id: "delivery-1", status: "ready" },
    ]);
    const refreshed = update[0];
    expect(refreshed).toBeDefined();
    if (!refreshed) return;
    expect(isDeliverySlaOverdue(refreshed, new Date("2026-08-16T20:02:00.000Z").getTime())).toBe(
      true,
    );
    expect(
      isDeliverySlaOverdue(
        { ...refreshed, status: "completed" },
        new Date("2026-08-16T20:02:00.000Z").getTime(),
      ),
    ).toBe(false);
  });
});
