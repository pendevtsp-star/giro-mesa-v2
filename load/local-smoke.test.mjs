import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { it } from "node:test";
import {
  assertOperationalEffects,
  createInterruptionController,
  settleAfterCleanup,
} from "./lib/local-smoke-runtime.js";

const tenants = [
  {
    label: "tenant-a",
    organizationId: "a1111111-1111-4111-8111-111111111111",
    unitId: "b1111111-1111-4111-8111-111111111111",
    tableId: "d1111111-1111-4111-8111-111111111111",
  },
  {
    label: "tenant-b",
    organizationId: "a2222222-2222-4222-8222-222222222222",
    unitId: "b2222222-2222-4222-8222-222222222222",
    tableId: "d2222222-2222-4222-8222-222222222222",
  },
];

it("requires one open tab on the expected table for every smoke tenant", () => {
  assert.deepEqual(
    assertOperationalEffects(
      [
        {
          organizationId: tenants[1].organizationId,
          unitId: tenants[1].unitId,
          tableId: tenants[1].tableId,
          status: "open",
        },
        {
          organizationId: tenants[0].organizationId,
          unitId: tenants[0].unitId,
          tableId: tenants[0].tableId,
          status: "open",
        },
      ],
      tenants,
    ),
    { tenantsVerified: 2, tablesVerified: 2 },
  );

  assert.throws(
    () =>
      assertOperationalEffects(
        [
          {
            organizationId: tenants[0].organizationId,
            unitId: tenants[0].unitId,
            tableId: tenants[1].tableId,
            status: "open",
          },
        ],
        tenants,
      ),
    /tenant-a.*expected open table/i,
  );
});

it("turns SIGINT and SIGTERM into fail-closed interruption and terminates active children", () => {
  const processEvents = new EventEmitter();
  const killed = [];
  const controller = createInterruptionController(processEvents);
  controller.track({ kill: (signal) => killed.push(signal) });

  processEvents.emit("SIGTERM");

  assert.deepEqual(killed, ["SIGTERM"]);
  assert.throws(() => controller.throwIfInterrupted(), /SIGTERM/);
  controller.dispose();
  assert.equal(processEvents.listenerCount("SIGINT"), 0);
  assert.equal(processEvents.listenerCount("SIGTERM"), 0);
});

it("publishes success only after cleanup and fails closed when cleanup fails", async () => {
  const order = [];
  await settleAfterCleanup(undefined, [
    async () => {
      order.push("cleanup");
    },
  ]);
  order.push("success");
  assert.deepEqual(order, ["cleanup", "success"]);

  await assert.rejects(
    () =>
      settleAfterCleanup(undefined, [
        async () => {
          throw new Error("container remained active");
        },
      ]),
    /container remained active/,
  );
});
