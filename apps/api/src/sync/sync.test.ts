import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  MAX_SYNC_BATCH_BYTES,
  MAX_SYNC_EVENT_BYTES,
  MAX_SYNC_PAYLOAD_BYTES,
  SYNC_ENVELOPE_CONTRACT,
} from "@giromesa/domain";
import { orderSchema } from "../pilot-operations/pilot-schemas.js";
import { createPriceReference } from "./price-reference.js";
import { stableOperationalId } from "./stable-operational-id.js";
import { hubSyncKey } from "./sync.controller.js";
import { normalizeSyncBatch, syncBatchSchema } from "./sync.schemas.js";
import { canonicalJson, pilotConflictResult, redactOperationalSecrets } from "./sync.service.js";
import { PilotConflictException } from "./sync-pilot.service.js";

describe("edge sync boundaries", () => {
  it("consumes the shared envelope format fixture", () => {
    assert.deepEqual(SYNC_ENVELOPE_CONTRACT.protocolVersions, [1, 2]);
    assert.deepEqual(SYNC_ENVELOPE_CONTRACT.priceReferenceKinds, ["product", "modifier-option"]);
    assert.equal(SYNC_ENVELOPE_CONTRACT.aggregateSequenceMin, 1);
    assert.equal(SYNC_ENVELOPE_CONTRACT.aggregateSequenceMax, 2_147_483_647);
  });

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
        protocolVersion: 1,
        hubVersion: "1.9.0",
        events: [
          {
            id: `{${id}}`,
            actorId,
            deviceId,
            idempotencyKey: "legacy-command-1",
            type: "order.created",
            payload: {},
            version: 1,
            occurredAt,
          },
        ],
      }).success,
      false,
    );
    assert.equal(
      syncBatchSchema.safeParse({
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
            version: 101,
            occurredAt,
          },
        ],
      }).success,
      false,
    );
    assert.equal(
      syncBatchSchema.safeParse({
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
            aggregate: current.events[0]?.aggregate,
            occupancyEpoch: current.events[0]?.occupancyEpoch,
            resourceVersion: 0,
            aggregateSequence: 0,
            occurredAt,
          },
        ],
      }).success,
      false,
    );
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

  it("covers the 50-source merge cap and rejects duplicate or oversized reference material", () => {
    const resources = Array.from({ length: 102 }, (_, index) => ({
      type: index < 51 ? "tab" : "table",
      id: crypto.randomUUID(),
      occupancyEpoch: crypto.randomUUID(),
      resourceVersion: 1,
    })).sort((left, right) => `${left.type}:${left.id}`.localeCompare(`${right.type}:${right.id}`));
    const primary = resources.find((resource) => resource.type === "tab");
    assert.ok(primary);
    const event = {
      commandId: crypto.randomUUID(),
      actorId: crypto.randomUUID(),
      deviceId: crypto.randomUUID(),
      idempotencyKey: "maximum-merge-vector",
      type: "pos.tabs.merge_requested",
      payload: {},
      aggregate: { type: primary.type, id: primary.id },
      occupancyEpoch: primary.occupancyEpoch,
      resourceVersion: primary.resourceVersion,
      aggregateSequence: 1,
      resourcePreconditions: resources,
      priceReferences: [],
      occurredAt: new Date().toISOString(),
    };
    const batch = { protocolVersion: 2 as const, hubVersion: "2.1.0", events: [event] };
    assert.equal(syncBatchSchema.safeParse(batch).success, true);
    assert.equal(
      syncBatchSchema.safeParse({
        ...batch,
        events: [
          {
            ...event,
            resourcePreconditions: [
              ...resources,
              ...Array.from({ length: 27 }, () => ({
                type: "table",
                id: crypto.randomUUID(),
                occupancyEpoch: crypto.randomUUID(),
                resourceVersion: 1,
              })),
            ].sort((left, right) =>
              `${left.type}:${left.id}`.localeCompare(`${right.type}:${right.id}`),
            ),
          },
        ],
      }).success,
      false,
    );
    const reference = {
      kind: "product" as const,
      entityId: crypto.randomUUID(),
      priceRevision: "2026-08-10T12:00:00.000Z",
      token: "t".repeat(64),
    };
    assert.equal(
      syncBatchSchema.safeParse({
        ...batch,
        events: [{ ...event, priceReferences: [reference, reference] }],
      }).success,
      false,
    );
    assert.equal(
      syncBatchSchema.safeParse({
        ...batch,
        events: [
          {
            ...event,
            priceReferences: Array.from({ length: 900 }, (_, index) => ({
              kind: "product" as const,
              entityId: crypto.randomUUID(),
              priceRevision: `revision-${index}`,
              token: "t".repeat(2_048),
            })),
          },
        ],
      }).success,
      false,
    );
  });

  it("uploads the reviewer 16x100 order and generated near-worst valid event", () => {
    const keyring = {
      activeVersion: "k".repeat(32),
      keys: new Map([["k".repeat(32), Buffer.alloc(32, 9)]]),
    };
    const makeItem = () => ({
      productId: crypto.randomUUID(),
      quantity: 1,
      modifierOptionIds: Array.from({ length: 100 }, () => crypto.randomUUID()),
    });
    const reviewerItems = Array.from({ length: 16 }, makeItem);
    const payloadFor = (items: typeof reviewerItems) => ({
      kind: "pilot.mutation",
      action: "create-order",
      data: { tabId: crypto.randomUUID(), body: { items } },
    });
    const reviewerPayload = payloadFor(reviewerItems);
    assert.equal(orderSchema.safeParse(reviewerPayload.data.body).success, true);
    assert.ok(Buffer.byteLength(JSON.stringify(reviewerPayload), "utf8") <= MAX_SYNC_PAYLOAD_BYTES);

    const generatedItems: typeof reviewerItems = [];
    while (generatedItems.length < 500) {
      const next = makeItem();
      const candidate = [...generatedItems, next];
      if (Buffer.byteLength(JSON.stringify(payloadFor(candidate)), "utf8") > MAX_SYNC_PAYLOAD_BYTES)
        break;
      generatedItems.push(next);
    }
    assert.equal(generatedItems.length, 16);
    const generatedPayload = payloadFor(generatedItems);
    assert.equal(orderSchema.safeParse(generatedPayload.data.body).success, true);
    const tabId = generatedPayload.data.tabId;
    const occupancyEpoch = crypto.randomUUID();
    const revision = "2026-08-10T12:00:00.000Z";
    const issuedAt = new Date("2026-08-10T12:00:00.000Z");
    const references = generatedItems.flatMap((item) => [
      {
        kind: "product" as const,
        entityId: item.productId,
        priceRevision: revision,
        token: createPriceReference(
          {
            kind: "product",
            entityId: item.productId,
            organizationId: crypto.randomUUID(),
            unitId: crypto.randomUUID(),
            priceCents: 2_500,
            priceRevision: revision,
          },
          keyring,
          issuedAt,
        ),
      },
      ...item.modifierOptionIds.map((entityId) => ({
        kind: "modifier-option" as const,
        entityId,
        priceRevision: revision,
        token: createPriceReference(
          {
            kind: "modifier-option",
            entityId,
            organizationId: crypto.randomUUID(),
            unitId: crypto.randomUUID(),
            priceCents: 100,
            priceRevision: revision,
          },
          keyring,
          issuedAt,
        ),
      })),
    ]);
    assert.equal(references.length, 1_616);
    const event = {
      commandId: crypto.randomUUID(),
      actorId: crypto.randomUUID(),
      deviceId: crypto.randomUUID(),
      idempotencyKey: "near-worst-valid-order",
      type: "pos.order.create_requested",
      payload: generatedPayload,
      aggregate: { type: "tab", id: tabId },
      occupancyEpoch,
      resourceVersion: 1,
      aggregateSequence: 1,
      resourcePreconditions: [
        {
          type: "tab",
          id: tabId,
          occupancyEpoch,
          resourceVersion: 1,
        },
      ],
      priceReferences: references,
      occurredAt: new Date().toISOString(),
    };
    const eventBytes = Buffer.byteLength(JSON.stringify(event), "utf8");
    const batch = { protocolVersion: 2 as const, hubVersion: "2.1.0", events: [event] };
    assert.ok(eventBytes < MAX_SYNC_EVENT_BYTES);
    assert.ok(eventBytes <= MAX_SYNC_EVENT_BYTES - 250_000);
    assert.ok(Buffer.byteLength(JSON.stringify(batch), "utf8") < MAX_SYNC_BATCH_BYTES);
    assert.equal(syncBatchSchema.safeParse(batch).success, true);
    assert.equal(SYNC_ENVELOPE_CONTRACT.eventBytesMax, MAX_SYNC_EVENT_BYTES);
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
