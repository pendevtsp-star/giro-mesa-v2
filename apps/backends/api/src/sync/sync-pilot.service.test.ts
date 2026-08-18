import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { PilotPosService } from "../pilot-operations/pilot-pos.service.js";
import { stableOperationalId } from "./stable-operational-id.js";
import type { SyncEventInput } from "./sync.schemas.js";
import { SyncPilotService } from "./sync-pilot.service.js";

const organizationId = "11111111-1111-4111-8111-111111111111";
const unitId = "22222222-2222-4222-8222-222222222222";
const actorId = "33333333-3333-4333-8333-333333333333";
const deviceId = "44444444-4444-4444-8444-444444444444";
const entityId = "55555555-5555-4555-8555-555555555555";
const secondId = "66666666-6666-4666-8666-666666666666";
const commandId = "77777777-7777-4777-8777-777777777777";

type Call = { method: string; args: unknown[] };

function mockPilot(calls: Call[]): PilotPosService {
  const method =
    (name: string) =>
    async (...args: unknown[]) => {
      calls.push({ method: name, args });
      return { method: name };
    };
  return {
    openTab: method("openTab"),
    createOrder: method("createOrder"),
    moveItems: method("moveItems"),
    recordPayment: method("recordPayment"),
    notifyReady: method("notifyReady"),
    transitionServiceCall: method("transitionServiceCall"),
    sendOrder: method("sendOrder"),
    transferTab: method("transferTab"),
    mergeTabs: method("mergeTabs"),
    splitTab: method("splitTab"),
    setServiceCharge: method("setServiceCharge"),
    setTip: method("setTip"),
    discountItem: method("discountItem"),
    cancelItem: method("cancelItem"),
    transitionKds: method("transitionKds"),
    transitionKdsItem: method("transitionKdsItem"),
    refireKdsItem: method("refireKdsItem"),
    recallKdsTicket: method("recallKdsTicket"),
    setKdsPriority: method("setKdsPriority"),
    setKdsCourseState: method("setKdsCourseState"),
    handoffKdsOrder: method("handoffKdsOrder"),
    setKdsProductAvailability: method("setKdsProductAvailability"),
    blockKdsItem: method("blockKdsItem"),
    unblockKdsItem: method("unblockKdsItem"),
    acknowledgeKdsAttention: method("acknowledgeKdsAttention"),
  } as unknown as PilotPosService;
}

function event(
  type: string,
  action: string,
  data: Record<string, unknown>,
  delivery?: "cloud-only" | "edge-capable",
): SyncEventInput {
  return {
    id: commandId,
    actorId,
    deviceId,
    idempotencyKey: `edge:${commandId}`,
    type,
    payload: { kind: "pilot.mutation", action, data, ...(delivery ? { delivery } : {}) },
    version: 1,
    occurredAt: new Date().toISOString(),
  };
}

describe("offline pilot replay", () => {
  it("routes every shift operation through the real POS service with stable generated ids", async () => {
    const calls: Call[] = [];
    const service = new SyncPilotService(mockPilot(calls));
    const approval = {
      approverMembershipId: secondId,
      pin: "1234",
      reason: "Ajuste autorizado",
    };
    const cases = [
      event("pos.tab.open_requested", "open-tab", {
        body: { label: "Balcão", guestCount: 1 },
      }),
      event("pos.order.create_requested", "create-order", {
        tabId: entityId,
        body: { items: [{ productId: secondId, quantity: 1, modifierOptionIds: [] }] },
      }),
      event("pos.items.move_requested", "move-items", {
        tabId: entityId,
        body: { targetTabId: secondId, items: [{ orderItemId: commandId, quantity: 1 }] },
      }),
      event("pos.payment.record_requested", "record-payment", {
        tabId: entityId,
        body: { method: "pix", amountCents: 1_000 },
      }),
      event("pos.tab.ready_notification_requested", "notify-ready", { tabId: entityId }),
      event("pos.service_call.acknowledged_requested", "acknowledge-call", {
        callId: entityId,
      }),
      event("pos.service_call.resolved_requested", "resolve-call", { callId: entityId }),
      event("pos.order.send_requested", "send-order", { orderId: entityId }),
      event("pos.tab.transfer_requested", "transfer-tab", {
        tabId: entityId,
        body: { tableId: secondId, reason: "Troca solicitada" },
      }),
      event("pos.tabs.merge_requested", "merge-tabs", {
        body: { targetTabId: entityId, sourceTabIds: [secondId] },
      }),
      event("pos.tab.split_requested", "split-tab", {
        tabId: entityId,
        body: { label: "Conta separada", items: [{ orderItemId: secondId, quantity: 1 }] },
      }),
      event("pos.tab.service_charge_requested", "service-charge", {
        tabId: entityId,
        basisPoints: 1_000,
      }),
      event("pos.tab.tip_requested", "tip", { tabId: entityId, tipCents: 500 }),
      event("pos.item.discount_requested", "discount-item", {
        itemId: entityId,
        body: { discountCents: 200, approval },
      }),
      event("pos.item.cancel_requested", "cancel-item", { itemId: entityId, approval }),
      event("pos.kds.transition_requested", "transition-kds", {
        ticketId: entityId,
        state: "preparing",
      }),
      event("pos.kds.item_transition_requested", "transition-kds-item", {
        ticketId: entityId,
        itemId: secondId,
        state: "ready",
        quantity: 1,
      }),
      event("pos.kds.item_refire_requested", "refire-kds-item", {
        ticketId: entityId,
        itemId: secondId,
        reason: "Refação solicitada",
      }),
      event("pos.kds.recall_requested", "recall-kds", {
        ticketId: entityId,
        reason: "Retorno da expedição",
      }),
      event("pos.kds.priority_requested", "set-kds-priority", {
        ticketId: entityId,
        priority: 100,
        reason: "Urgência operacional",
      }),
      event("pos.kds.course_state_requested", "set-kds-course-state", {
        ticketId: entityId,
        course: "main",
        state: "fired",
      }),
      event("pos.kds.handoff_requested", "handoff-kds-order", {
        orderId: entityId,
        target: "expedition",
      }),
      event("pos.kds.product_availability_requested", "set-kds-product-availability", {
        productId: entityId,
        available: false,
        resetAt: "2026-08-18T03:00:00.000Z",
        dailyStock: 12,
        reason: "Sem insumo na praça",
      }),
      event("pos.kds.item_block_requested", "block-kds-item", {
        ticketId: entityId,
        itemId: secondId,
        code: "missing_ingredient",
        reason: "Reposição em andamento",
      }),
      event("pos.kds.item_unblock_requested", "unblock-kds-item", {
        ticketId: entityId,
        itemId: secondId,
        reason: "Insumo reposto",
      }),
      event(
        "pos.kds.critical_note_acknowledged_requested",
        "acknowledge-kds-critical-note",
        {
          ticketId: entityId,
          itemId: secondId,
          noteId: "allergy",
          revision: "a".repeat(64),
        },
        "edge-capable",
      ),
    ];

    for (const input of cases) {
      await service.apply(input, { organizationId, unitId });
    }

    assert.deepEqual(
      calls.map((call) => call.method),
      [
        "openTab",
        "createOrder",
        "moveItems",
        "recordPayment",
        "notifyReady",
        "transitionServiceCall",
        "transitionServiceCall",
        "sendOrder",
        "transferTab",
        "mergeTabs",
        "splitTab",
        "setServiceCharge",
        "setTip",
        "discountItem",
        "cancelItem",
        "transitionKds",
        "transitionKdsItem",
        "refireKdsItem",
        "recallKdsTicket",
        "setKdsPriority",
        "setKdsCourseState",
        "handoffKdsOrder",
        "setKdsProductAvailability",
        "blockKdsItem",
        "unblockKdsItem",
        "acknowledgeKdsAttention",
      ],
    );
    const createIds = calls.find((call) => call.method === "createOrder")?.args[6] as {
      modifierIdForOption(itemId: string, optionId: string): string;
    };
    assert.equal(
      createIds.modifierIdForOption(entityId, secondId),
      stableOperationalId(commandId, "order-modifier", `${entityId}:${secondId}`),
    );
    const splitIds = calls.find((call) => call.method === "splitTab")?.args[6] as {
      targetTabId: string;
      targetOrderId: string;
      movedItemIdForSource(sourceItemId: string): string;
      movedModifierIdForSource(sourceItemId: string, modifierId: string): string;
    };
    assert.equal(splitIds.targetTabId, commandId);
    assert.equal(splitIds.targetOrderId, stableOperationalId(commandId, "split-order", ""));
    const availabilityCall = calls.find((call) => call.method === "setKdsProductAvailability");
    assert.deepEqual(availabilityCall?.args[5], {
      available: false,
      reason: "Sem insumo na praça",
      resetAt: "2026-08-18T03:00:00.000Z",
      dailyStock: 12,
    });
    assert.equal(
      splitIds.movedItemIdForSource(entityId),
      stableOperationalId(commandId, "split-item", entityId),
    );
    assert.equal(
      splitIds.movedModifierIdForSource(entityId, secondId),
      stableOperationalId(commandId, "split-modifier", `${entityId}:${secondId}`),
    );
    for (const methodName of ["discountItem", "cancelItem"]) {
      const offlineIds = calls.find((call) => call.method === methodName)?.args[6] as {
        approvalId: string;
      };
      assert.equal(offlineIds.approvalId, stableOperationalId(commandId, "approval", ""));
    }
  });

  it("rejects a mismatched event type before calling POS", async () => {
    const calls: Call[] = [];
    const service = new SyncPilotService(mockPilot(calls));
    await assert.rejects(() =>
      service.apply(
        event("pos.tab.tip_requested", "service-charge", {
          tabId: entityId,
          basisPoints: 1_000,
        }),
        { organizationId, unitId },
      ),
    );
    assert.equal(calls.length, 0);
  });
});
