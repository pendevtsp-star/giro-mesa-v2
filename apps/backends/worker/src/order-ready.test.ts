import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  OrderReadyDeliveryError,
  parseOrderReadyNotificationRequest,
  planOrderReadyDelivery,
} from "./order-ready.js";

const organizationId = "11111111-1111-4111-8111-111111111111";
const unitId = "22222222-2222-4222-8222-222222222222";
const orderId = "33333333-3333-4333-8333-333333333333";
const tabId = "44444444-4444-4444-8444-444444444444";

describe("order-ready notification", () => {
  it("accepts the IDs-only canonical envelope and deduplicates channels", () => {
    const request = parseOrderReadyNotificationRequest({
      aggregate_type: "order",
      aggregate_id: orderId,
      payload: {
        organizationId,
        unitId,
        orderId,
        tabId,
        channels: ["waiter", "customer", "waiter"],
      },
    });

    assert.deepEqual(request, {
      organizationId,
      unitId,
      orderId,
      tabId,
      channels: ["waiter", "customer"],
    });
  });

  it("treats waiter delivery as internal instead of sending email", () => {
    const plan = planOrderReadyDelivery(
      { organizationId, unitId, orderId, tabId, channels: ["waiter"] },
      { orderStatus: "ready", customerPhone: null, readyNotificationConsent: false },
    );

    assert.equal(plan.internalWaiter, true);
    assert.equal(plan.externalCustomer, false);
    assert.deepEqual(plan.disabled, []);
  });

  it("allows customer delivery only with an explicit consent and phone", () => {
    const plan = planOrderReadyDelivery(
      { organizationId, unitId, orderId, tabId, channels: ["waiter", "customer"] },
      {
        orderStatus: "ready",
        customerPhone: "+5511999999999",
        readyNotificationConsent: true,
      },
    );

    assert.equal(plan.internalWaiter, true);
    assert.equal(plan.externalCustomer, true);
    assert.deepEqual(plan.disabled, []);
  });

  it("does not claim delivery after the order leaves ready state", () => {
    assert.throws(
      () =>
        planOrderReadyDelivery(
          { organizationId, unitId, orderId, tabId, channels: ["waiter"] },
          {
            orderStatus: "served",
            customerPhone: null,
            readyNotificationConsent: false,
          },
        ),
      (error: unknown) =>
        error instanceof OrderReadyDeliveryError &&
        error.disabled &&
        error.code === "ORDER_READY_NOTIFICATION_STALE",
    );
  });

  it("rejects an aggregate that does not match the order payload", () => {
    assert.throws(
      () =>
        parseOrderReadyNotificationRequest({
          aggregate_type: "tab",
          aggregate_id: tabId,
          payload: { organizationId, unitId, orderId, tabId, channels: ["waiter"] },
        }),
      (error: unknown) =>
        error instanceof OrderReadyDeliveryError &&
        error.code === "ORDER_READY_EVENT_CONTEXT_INVALID",
    );
  });
});
