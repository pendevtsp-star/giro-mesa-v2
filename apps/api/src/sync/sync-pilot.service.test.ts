import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { DatabaseService } from "../database/database.module.js";
import type { PilotPosService } from "../pilot-operations/pilot-pos.service.js";
import { PilotResourceConflict } from "../pilot-operations/pilot-resource-boundary.js";
import { createPriceReference } from "./price-reference.js";
import { stableOperationalId } from "./stable-operational-id.js";
import type { NormalizedSyncEventInput, SyncEventInput } from "./sync.schemas.js";
import { PilotConflictException, SyncPilotService } from "./sync-pilot.service.js";

const organizationId = "11111111-1111-4111-8111-111111111111";
const unitId = "22222222-2222-4222-8222-222222222222";
const actorId = "33333333-3333-4333-8333-333333333333";
const deviceId = "44444444-4444-4444-8444-444444444444";
const entityId = "55555555-5555-4555-8555-555555555555";
const secondId = "66666666-6666-4666-8666-666666666666";
const commandId = "77777777-7777-4777-8777-777777777777";
process.env.COMMAND_FINGERPRINT_ACTIVE_KEY_VERSION ??= "test-v1";
process.env.COMMAND_FINGERPRINT_KEYS ??= JSON.stringify({
  "test-v1": Buffer.alloc(32, 7).toString("base64url"),
});

type Call = { method: string; args: unknown[] };

function mockPilot(calls: Call[]): PilotPosService {
  const method =
    (name: string) =>
    async (...args: unknown[]) => {
      calls.push({ method: name, args });
      return { method: name };
    };
  return {
    withSyncPreconditions: async (
      _commandType: unknown,
      _resources: unknown,
      work: () => Promise<unknown>,
    ) => work(),
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

function mockPilotConflict(outcome: "reject" | "reconcile", code: string): PilotPosService {
  const pilot = mockPilot([]) as PilotPosService & {
    withSyncPreconditions: PilotPosService["withSyncPreconditions"];
  };
  pilot.withSyncPreconditions = async () => {
    throw new PilotResourceConflict(outcome, code);
  };
  return pilot;
}

function orderedEvent(
  type: string,
  action: string,
  data: Record<string, unknown>,
  overrides: Partial<NormalizedSyncEventInput> = {},
): NormalizedSyncEventInput {
  const aggregateId = action === "open-tab" ? commandId : entityId;
  const createItems =
    action === "create-order"
      ? (data.body as { items: Array<{ productId: string; modifierOptionIds: string[] }> }).items
      : [];
  const base = {
    commandId,
    id: commandId,
    actorId,
    deviceId,
    idempotencyKey: `edge:${commandId}`,
    type,
    payload: { kind: "pilot.mutation", action, data },
    aggregate: { type: "tab", id: aggregateId },
    occupancyEpoch: "88888888-8888-4888-8888-888888888888",
    resourceVersion: 1,
    version: 1,
    aggregateSequence: 1,
    resourcePreconditions: [],
    priceReferences: createItems.flatMap((item) => [
      {
        kind: "product" as const,
        entityId: item.productId,
        priceRevision: "2026-08-10T12:00:00.000Z",
        token: createPriceReference({
          kind: "product",
          entityId: item.productId,
          organizationId,
          unitId,
          priceCents: 1_000,
          priceRevision: "2026-08-10T12:00:00.000Z",
        }),
      },
      ...item.modifierOptionIds.map((optionId) => ({
        kind: "modifier-option" as const,
        entityId: optionId,
        priceRevision: "2026-08-10T12:00:00.000Z",
        token: createPriceReference({
          kind: "modifier-option",
          entityId: optionId,
          organizationId,
          unitId,
          priceCents: 0,
          priceRevision: "2026-08-10T12:00:00.000Z",
        }),
      })),
    ]),
    occurredAt: new Date().toISOString(),
    ...overrides,
  };
  return {
    ...base,
    resourcePreconditions: overrides.resourcePreconditions ?? [
      {
        type: base.aggregate.type,
        id: base.aggregate.id,
        occupancyEpoch: base.occupancyEpoch,
        resourceVersion: base.resourceVersion,
      },
    ],
  };
}

function conflictDatabase(
  states: Array<
    undefined | { id?: string; occupancyEpoch?: string; resourceVersion?: number; status?: string }
  >,
): DatabaseService {
  let stateIndex = 0;
  return {
    db: {
      execute: async () => {
        const state = states[stateIndex++];
        if (!state) return [];
        return [
          {
            id: state.id ?? entityId,
            occupancy_epoch: state.occupancyEpoch ?? "88888888-8888-4888-8888-888888888888",
            resource_version: state.resourceVersion ?? 1,
            status: state.status ?? "open",
          },
        ];
      },
    },
  } as unknown as DatabaseService;
}

describe("offline pilot replay", () => {
  it("routes every shift operation through the real POS service with stable generated ids", async () => {
    const calls: Call[] = [];
    const service = new SyncPilotService(
      mockPilot(calls),
      conflictDatabase([
        undefined,
        { id: commandId },
        ...Array.from({ length: 10 }, () => [{ id: entityId }, { id: entityId }]).flat(),
      ]),
    );
    const approval = {
      approverMembershipId: secondId,
      pin: "1234",
      reason: "Ajuste autorizado",
    };
    const cases = [
      orderedEvent(
        "pos.tab.open_requested",
        "open-tab",
        { body: { label: "Balcão", guestCount: 1 } },
        { resourceVersion: 0, version: 0 },
      ),
      orderedEvent("pos.order.create_requested", "create-order", {
        tabId: entityId,
        body: { items: [{ productId: secondId, quantity: 1, modifierOptionIds: [] }] },
      }),
      orderedEvent("pos.order.send_requested", "send-order", { orderId: entityId }),
      orderedEvent("pos.tab.transfer_requested", "transfer-tab", {
        tabId: entityId,
        body: { tableId: secondId, reason: "Troca solicitada" },
      }),
      orderedEvent("pos.tabs.merge_requested", "merge-tabs", {
        body: { targetTabId: entityId, sourceTabIds: [secondId] },
      }),
      orderedEvent("pos.tab.split_requested", "split-tab", {
        tabId: entityId,
        body: { label: "Conta separada", items: [{ orderItemId: secondId, quantity: 1 }] },
      }),
      orderedEvent("pos.tab.service_charge_requested", "service-charge", {
        tabId: entityId,
        basisPoints: 1_000,
      }),
      orderedEvent("pos.tab.tip_requested", "tip", { tabId: entityId, tipCents: 500 }),
      orderedEvent("pos.item.discount_requested", "discount-item", {
        itemId: entityId,
        body: { discountCents: 200, approval },
      }),
      orderedEvent("pos.item.cancel_requested", "cancel-item", { itemId: entityId, approval }),
      orderedEvent("pos.kds.transition_requested", "transition-kds", {
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
    const service = new SyncPilotService(mockPilot(calls), conflictDatabase([]));
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

  it("rejects a same-epoch stale destructive command before calling POS", async () => {
    const calls: Call[] = [];
    const service = new SyncPilotService(
      mockPilotConflict("reject", "RESOURCE_VERSION_CONFLICT"),
      conflictDatabase([]),
    );
    await assert.rejects(
      () =>
        service.apply(
          orderedEvent("pos.tab.transfer_requested", "transfer-tab", {
            tabId: entityId,
            body: { tableId: secondId, reason: "Troca solicitada" },
          }),
          { organizationId, unitId },
        ),
      (error: unknown) =>
        error instanceof PilotConflictException &&
        error.decision.outcome === "reject" &&
        error.decision.code === "RESOURCE_VERSION_CONFLICT",
    );
    assert.equal(calls.length, 0);
  });

  it("quarantines an occupancy epoch mismatch for reconciliation", async () => {
    const service = new SyncPilotService(
      mockPilotConflict("reconcile", "OCCUPANCY_EPOCH_MISMATCH"),
      conflictDatabase([]),
    );
    await assert.rejects(
      () =>
        service.apply(
          orderedEvent("pos.order.create_requested", "create-order", {
            tabId: entityId,
            body: { items: [{ productId: secondId, quantity: 1, modifierOptionIds: [] }] },
          }),
          { organizationId, unitId },
        ),
      (error: unknown) =>
        error instanceof PilotConflictException &&
        error.decision.outcome === "reconcile" &&
        error.decision.code === "OCCUPANCY_EPOCH_MISMATCH",
    );
  });

  it("keeps N-1 destructive commands behind the conservative legacy policy", async () => {
    const calls: Call[] = [];
    const service = new SyncPilotService(mockPilot(calls), conflictDatabase([{ id: entityId }]));
    await assert.rejects(
      () =>
        service.apply(
          event("pos.tab.transfer_requested", "transfer-tab", {
            tabId: entityId,
            body: { tableId: secondId, reason: "Troca solicitada" },
          }),
          { organizationId, unitId },
        ),
      (error: unknown) =>
        error instanceof PilotConflictException &&
        error.decision.code === "LEGACY_PRECONDITION_REQUIRED",
    );
    assert.equal(calls.length, 0);
  });

  it("rejects unknown pilot commands instead of applying a no-op", async () => {
    const service = new SyncPilotService(mockPilot([]), conflictDatabase([]));
    await assert.rejects(
      () =>
        service.apply(
          orderedEvent(
            "pos.future.magic_requested",
            "future-magic",
            {},
            {
              aggregate: { type: "tab", id: entityId },
            },
          ),
          { organizationId, unitId },
        ),
      (error: unknown) =>
        error instanceof PilotConflictException &&
        error.decision.code === "UNSUPPORTED_PILOT_COMMAND",
    );
  });
});
