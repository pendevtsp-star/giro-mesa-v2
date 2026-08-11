import assert from "node:assert/strict";
import { test } from "node:test";
import { readTablePartial, readTableSession } from "./public-contracts.ts";

test("aceita somente sessão e parcial vinculadas ao contrato público", () => {
  assert.deepEqual(
    readTableSession({
      token: `signed.${"x".repeat(48)}`,
      expiresAt: "2026-08-11T20:00:00.000Z",
      capabilities: ["call_waiter", "request_bill", "view_partial"],
    })?.capabilities,
    ["call_waiter", "request_bill", "view_partial"],
  );
  assert.equal(
    readTableSession({ token: "short", expiresAt: "now", capabilities: ["admin"] }),
    null,
  );
  assert.equal(
    readTablePartial({
      occupancyId: "occupancy",
      tab: { id: "tab", totalCents: 1_250 },
      items: [{ id: "item", productName: "Suco", quantity: 1, netCents: 1_250, status: "served" }],
    })?.tab.totalCents,
    1_250,
  );
  assert.equal(readTablePartial({ occupancyId: "occupancy", tab: { id: "tab" }, items: [] }), null);
});
