import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { BadRequestException } from "@nestjs/common";
import { syncBatchSchema } from "./sync.schemas.js";
import { SyncBatchPipe } from "./sync-validation.js";

const validLegacyEvent = () => ({
  id: crypto.randomUUID(),
  actorId: crypto.randomUUID(),
  deviceId: crypto.randomUUID(),
  idempotencyKey: `edge-${crypto.randomUUID()}`,
  type: "order.created",
  payload: {},
  version: 1,
  occurredAt: new Date().toISOString(),
});

function validationResponse(value: unknown) {
  try {
    new SyncBatchPipe(syncBatchSchema).transform(value);
    assert.fail("Expected sync validation to fail.");
  } catch (error) {
    assert.ok(error instanceof BadRequestException);
    return error.getResponse();
  }
}

describe("sync validation problem contract", () => {
  it("identifies only the exact invalid event indexes without echoing payload or secrets", () => {
    const secret = "manager-pin-7391";
    const response = validationResponse({
      protocolVersion: 1,
      hubVersion: "2.1.0",
      events: [
        validLegacyEvent(),
        {
          ...validLegacyEvent(),
          actorId: "not-a-uuid",
          payload: { pin: secret, nested: { secret } },
        },
      ],
    });

    assert.deepEqual(response, {
      code: "SYNC_EVENT_SCHEMA_INVALID",
      scope: "event",
      eventIndexes: [1],
    });
    assert.equal(JSON.stringify(response).includes(secret), false);
    assert.equal(JSON.stringify(response).includes("payload"), false);
    assert.equal(JSON.stringify(response).includes("pin"), false);
  });

  it("keeps protocol, hub and shared metadata failures at batch scope", () => {
    assert.deepEqual(validationResponse({ protocolVersion: 99, hubVersion: "2.1.0", events: [] }), {
      code: "SYNC_BATCH_SCHEMA_INVALID",
      scope: "batch",
    });
    assert.deepEqual(
      validationResponse({ protocolVersion: 1, hubVersion: "x".repeat(41), events: [] }),
      { code: "SYNC_BATCH_SCHEMA_INVALID", scope: "batch" },
    );
    assert.deepEqual(
      validationResponse({
        protocolVersion: 1,
        hubVersion: "2.1.0",
        metadata: { ["m".repeat(65)]: true },
        events: [],
      }),
      { code: "SYNC_BATCH_SCHEMA_INVALID", scope: "batch" },
    );
  });

  it("uses ack scope for acknowledgement-only validation and batch scope for mixed failures", () => {
    assert.deepEqual(
      validationResponse({
        protocolVersion: 1,
        hubVersion: "2.1.0",
        acknowledgedCommandIds: ["forged-command-id"],
        events: [],
      }),
      { code: "SYNC_ACK_SCHEMA_INVALID", scope: "ack" },
    );
    assert.deepEqual(
      validationResponse({
        protocolVersion: 1,
        hubVersion: "2.1.0",
        acknowledgedCommandIds: ["forged-command-id"],
        events: [{ ...validLegacyEvent(), actorId: "not-a-uuid" }],
      }),
      { code: "SYNC_BATCH_SCHEMA_INVALID", scope: "batch" },
    );
  });

  it("does not misclassify event collection limits as an event-local problem", () => {
    assert.deepEqual(
      validationResponse({
        protocolVersion: 1,
        hubVersion: "2.1.0",
        events: Array.from({ length: 101 }, validLegacyEvent),
      }),
      { code: "SYNC_BATCH_SCHEMA_INVALID", scope: "batch" },
    );
  });
});
