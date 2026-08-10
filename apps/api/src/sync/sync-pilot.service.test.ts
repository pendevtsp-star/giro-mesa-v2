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
    sendOrder: method("sendOrder"),
    transferTab: method("transferTab"),
    mergeTabs: method("mergeTabs"),
    splitTab: method("splitTab"),
    setServiceCharge: method("setServiceCharge"),
    setTip: method("setTip"),
    discountItem: method("discountItem"),
    cancelItem: method("cancelItem"),
    transitionKds: method("transitionKds"),
  } as unknown as PilotPosService;
}

function event(type: string, action: string, data: Record<string, unknown>): SyncEventInput {
  return {
    id: commandId,
    actorId,
    deviceId,
    idempotencyKey: `edge:${commandId}`,
    type,
    payload: { kind: "pilot.mutation", action, data },
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
    ];

    for (const input of cases) {
      await service.apply(input, { organizationId, unitId });
    }

    assert.deepEqual(
      calls.map((call) => call.method),
      [
        "openTab",
        "createOrder",
        "sendOrder",
        "transferTab",
        "mergeTabs",
        "splitTab",
        "setServiceCharge",
        "setTip",
        "discountItem",
        "cancelItem",
        "transitionKds",
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
