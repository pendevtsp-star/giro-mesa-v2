import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
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

test("usa apenas sessão assinada e capabilities para ações da mesa", async () => {
  const [menu, services] = await Promise.all([
    readFile(new URL("../components/menu-experience.tsx", import.meta.url), "utf8"),
    readFile(new URL("../components/public-services-experience.tsx", import.meta.url), "utf8"),
  ]);
  assert.doesNotMatch(menu, /\/public\/v1\/menus\/.*\/commands/);
  assert.match(menu, /\/servicos#mesa/);
  for (const capability of ["call_waiter", "request_bill", "view_partial"]) {
    assert.match(services, new RegExp(`canUse\\("${capability}"\\)`));
  }
});
