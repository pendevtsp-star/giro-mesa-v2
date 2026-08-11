import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { stableOperationalId } from "./stable-operational-id.js";
import { hubSyncKey } from "./sync.controller.js";
import { normalizeSyncBatch, syncBatchSchema } from "./sync.schemas.js";
import { canonicalJson, pilotConflictResult, redactOperationalSecrets } from "./sync.service.js";
import { PilotConflictException } from "./sync-pilot.service.js";

describe("edge sync boundaries", () => {
  it("canonicalizes JSON for idempotency without depending on property order", () => {
    assert.equal(
      canonicalJson({ b: 2, a: { d: 4, c: 3 } }),
      canonicalJson({ a: { c: 3, d: 4 }, b: 2 }),
    );
  });

  it("orders composed and decomposed Unicode keys without locale-dependent equality", () => {
    const composed = "\u00e9";
    const decomposed = "e\u0301";
    assert.equal(
      canonicalJson({ [composed]: 1, [decomposed]: 2, z: 3 }),
      canonicalJson({ z: 3, [decomposed]: 2, [composed]: 1 }),
    );
    assert.notEqual(composed, decomposed);
  });

  it("rejects tenant scope supplied by the edge and oversized batches", () => {
    const base = { protocolVersion: 1, hubVersion: "2.0.0", events: [] };
    assert.equal(syncBatchSchema.safeParse(base).success, true);
    assert.equal(
      syncBatchSchema.safeParse({ ...base, unitId: crypto.randomUUID() }).success,
      false,
    );
    assert.equal(
      syncBatchSchema.safeParse({
        ...base,
        acknowledgedCommandIds: Array.from({ length: 101 }, () => crypto.randomUUID()),
      }).success,
      false,
    );
  });

  it("accepts protocol N and N-1 while deriving legacy ordering metadata", () => {
    const id = crypto.randomUUID();
    const actorId = crypto.randomUUID();
    const deviceId = crypto.randomUUID();
    const occurredAt = new Date().toISOString();
    const legacy = normalizeSyncBatch({
      protocolVersion: 1,
      hubVersion: "1.9.0",
      events: [
        {
          id,
          actorId,
          deviceId,
          idempotencyKey: "legacy-command-1",
          type: "order.created",
          payload: {},
          version: 1,
          occurredAt,
        },
      ],
    });
    assert.equal(legacy.events[0]?.commandId, id);
    assert.equal(legacy.events[0]?.aggregateSequence, 1);

    const current = normalizeSyncBatch({
      protocolVersion: 2,
      hubVersion: "2.0.0",
      events: [
        {
          commandId: id,
          actorId,
          deviceId,
          idempotencyKey: "ordered-command-1",
          type: "order.item_added",
          payload: {},
          aggregate: { type: "tab", id: crypto.randomUUID() },
          occupancyEpoch: crypto.randomUUID(),
          resourceVersion: 0,
          aggregateSequence: 1,
          occurredAt,
        },
      ],
    });
    assert.equal(current.events[0]?.commandId, id);
    assert.equal(current.events[0]?.aggregate.type, "tab");
    assert.equal(
      syncBatchSchema.safeParse({
        protocolVersion: 2,
        hubVersion: "2.0.0",
        events: [
          {
            commandId: current.events[0]?.commandId,
            actorId,
            deviceId,
            idempotencyKey: "ordered-command-1",
            type: "order.item_added",
            payload: {},
            aggregate: current.events[0]?.aggregate,
            occupancyEpoch: current.events[0]?.occupancyEpoch,
            resourceVersion: 0,
            aggregateSequence: 1,
            occurredAt,
            organizationId: crypto.randomUUID(),
          },
        ],
      }).success,
      false,
    );
  });

  it("accepts a bounded sorted multi-resource vector without changing singular compatibility", () => {
    const tab = {
      type: "tab",
      id: crypto.randomUUID(),
      occupancyEpoch: crypto.randomUUID(),
      resourceVersion: 4,
    };
    const table = {
      type: "table",
      id: crypto.randomUUID(),
      occupancyEpoch: crypto.randomUUID(),
      resourceVersion: 2,
    };
    const parsed = normalizeSyncBatch({
      protocolVersion: 2,
      hubVersion: "2.1.0",
      events: [
        {
          commandId: crypto.randomUUID(),
          actorId: crypto.randomUUID(),
          deviceId: crypto.randomUUID(),
          idempotencyKey: "ordered-transfer-1",
          type: "pos.tab.transfer_requested",
          payload: {},
          aggregate: { type: tab.type, id: tab.id },
          occupancyEpoch: tab.occupancyEpoch,
          resourceVersion: tab.resourceVersion,
          aggregateSequence: 5,
          resourcePreconditions: [tab, table].sort((left, right) =>
            `${left.type}:${left.id}`.localeCompare(`${right.type}:${right.id}`),
          ),
          priceReferences: [],
          occurredAt: new Date().toISOString(),
        },
      ],
    });
    assert.equal(parsed.events[0]?.resourcePreconditions.length, 2);
    assert.deepEqual(parsed.events[0]?.aggregate, { type: "tab", id: tab.id });
    assert.equal(
      syncBatchSchema.safeParse({
        protocolVersion: 2,
        hubVersion: "2.1.0",
        events: [
          {
            ...parsed.events[0],
            id: undefined,
            version: undefined,
            resourcePreconditions: [table, tab],
          },
        ],
      }).success,
      false,
    );
  });

  it("accepts only the dedicated authorization scheme", () => {
    assert.equal(hubSyncKey("GiroMesaHub one-time-secret"), "one-time-secret");
    assert.equal(hubSyncKey("Bearer one-time-secret"), undefined);
    assert.equal(hubSyncKey(undefined), undefined);
  });

  it("derives the same stable UUID contract used by the Edge Hub", () => {
    assert.equal(
      stableOperationalId("11111111-1111-4111-8111-111111111111", "order-item", "0"),
      "65798188-b7b6-5dff-9e7a-3d1eb3cdcdd0",
    );
  });

  it("never persists a manager PIN from an offline command envelope", () => {
    const redacted = redactOperationalSecrets({
      kind: "pilot.mutation",
      data: {
        body: {
          approval: { approverMembershipId: crypto.randomUUID(), pin: "1234" },
        },
      },
    });
    assert.equal(JSON.stringify(redacted).includes("1234"), false);
    assert.equal(JSON.stringify(redacted).includes("[redacted]"), true);
  });

  it("preserves reconciliation outcomes instead of flattening them into rejection", () => {
    assert.deepEqual(
      pilotConflictResult(
        new PilotConflictException({
          outcome: "reconcile",
          code: "OCCUPANCY_EPOCH_MISMATCH",
        }),
      ),
      { status: "quarantined", code: "OCCUPANCY_EPOCH_MISMATCH" },
    );
    assert.deepEqual(
      pilotConflictResult(
        new PilotConflictException({
          outcome: "reject",
          code: "RESOURCE_VERSION_CONFLICT",
        }),
      ),
      { status: "rejected", code: "RESOURCE_VERSION_CONFLICT" },
    );
  });
});
