import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  createCommandEnvelope,
  MAX_AGGREGATE_SEQUENCE,
  MAX_RESOURCE_VERSION,
} from "./command-envelope.js";

const ids = {
  command: "11111111-1111-4111-8111-111111111111",
  organization: "22222222-2222-4222-8222-222222222222",
  unit: "33333333-3333-4333-8333-333333333333",
  actor: "44444444-4444-4444-8444-444444444444",
  device: "55555555-5555-4555-8555-555555555555",
  aggregate: "66666666-6666-4666-8666-666666666666",
  epoch: "77777777-7777-4777-8777-777777777777",
};

function validInput() {
  return {
    commandId: ids.command,
    idempotencyKey: "edge-command-0001",
    actorId: ids.actor,
    deviceId: ids.device,
    type: "order.item_added",
    aggregate: { type: "tab", id: ids.aggregate },
    occupancyEpoch: ids.epoch,
    resourceVersion: 0,
    aggregateSequence: 1,
    occurredAt: "2026-08-10T12:00:00.000Z",
    payload: { itemId: "burger" },
  };
}

describe("canonical command envelope", () => {
  it("adds only trusted tenant scope and receipt time", () => {
    const envelope = createCommandEnvelope(validInput(), {
      organizationId: ids.organization,
      unitId: ids.unit,
      receivedAt: "2026-08-10T12:00:01.000Z",
    });
    assert.equal(envelope.organizationId, ids.organization);
    assert.equal(envelope.unitId, ids.unit);
    assert.equal(envelope.receivedAt, "2026-08-10T12:00:01.000Z");
    assert.equal(envelope.aggregateSequence, 1);
    assert.equal(Object.isFrozen(envelope), true);
  });

  it("rejects malformed UUIDs, timestamps, and numeric bounds", () => {
    assert.throws(() =>
      createCommandEnvelope(
        { ...validInput(), commandId: "not-a-uuid" },
        {
          organizationId: ids.organization,
          unitId: ids.unit,
          receivedAt: "2026-08-10T12:00:01.000Z",
        },
      ),
    );
    assert.throws(() =>
      createCommandEnvelope(
        { ...validInput(), occurredAt: "yesterday" },
        {
          organizationId: ids.organization,
          unitId: ids.unit,
          receivedAt: "2026-08-10T12:00:01.000Z",
        },
      ),
    );
    assert.throws(() =>
      createCommandEnvelope(
        { ...validInput(), resourceVersion: MAX_RESOURCE_VERSION + 1 },
        {
          organizationId: ids.organization,
          unitId: ids.unit,
          receivedAt: "2026-08-10T12:00:01.000Z",
        },
      ),
    );
    assert.throws(() =>
      createCommandEnvelope(
        { ...validInput(), aggregateSequence: MAX_AGGREGATE_SEQUENCE + 1 },
        {
          organizationId: ids.organization,
          unitId: ids.unit,
          receivedAt: "2026-08-10T12:00:01.000Z",
        },
      ),
    );
  });
});
