import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { transitionTableOccupancy, type TableOccupancySnapshot } from "./table-occupancy.js";

const open: TableOccupancySnapshot = {
  state: "open",
  occupancyEpoch: "11111111-1111-4111-8111-111111111111",
  resourceVersion: 3,
  tableId: "table-a",
  groupId: null,
};

describe("table occupancy state machine", () => {
  it("requires CAS and epoch for every transition", () => {
    assert.throws(
      () =>
        transitionTableOccupancy(open, {
          type: "begin_payment",
          occupancyEpoch: open.occupancyEpoch,
          expectedVersion: 2,
        }),
      (error: unknown) => (error as { code?: string }).code === "OCCUPANCY_VERSION_CONFLICT",
    );
    assert.throws(
      () =>
        transitionTableOccupancy(open, {
          type: "begin_payment",
          occupancyEpoch: "22222222-2222-4222-8222-222222222222",
          expectedVersion: 3,
        }),
      (error: unknown) => (error as { code?: string }).code === "OCCUPANCY_EPOCH_MISMATCH",
    );
  });

  it("serializes payment, close and reopen while rotating the epoch", () => {
    const paying = transitionTableOccupancy(open, {
      type: "begin_payment",
      occupancyEpoch: open.occupancyEpoch,
      expectedVersion: 3,
    });
    assert.equal(paying.state, "paying");
    const closed = transitionTableOccupancy(paying, {
      type: "close",
      occupancyEpoch: paying.occupancyEpoch,
      expectedVersion: 4,
    });
    assert.equal(closed.state, "closed");
    const reopened = transitionTableOccupancy(closed, {
      type: "reopen",
      occupancyEpoch: closed.occupancyEpoch,
      expectedVersion: 5,
      nextEpoch: "33333333-3333-4333-8333-333333333333",
    });
    assert.equal(reopened.state, "open");
    assert.equal(reopened.occupancyEpoch, "33333333-3333-4333-8333-333333333333");
  });

  it("keeps transfer, grouping and split inside the same active occupancy", () => {
    const transferred = transitionTableOccupancy(open, {
      type: "transfer",
      occupancyEpoch: open.occupancyEpoch,
      expectedVersion: 3,
      tableId: "table-b",
    });
    assert.equal(transferred.tableId, "table-b");
    const grouped = transitionTableOccupancy(transferred, {
      type: "group",
      occupancyEpoch: transferred.occupancyEpoch,
      expectedVersion: 4,
      groupId: "group-1",
    });
    assert.equal(grouped.groupId, "group-1");
    const split = transitionTableOccupancy(grouped, {
      type: "split",
      occupancyEpoch: grouped.occupancyEpoch,
      expectedVersion: 5,
      tableId: "table-c",
      groupId: null,
    });
    assert.deepEqual({ tableId: split.tableId, groupId: split.groupId }, { tableId: "table-c", groupId: null });
  });
});
