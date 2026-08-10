import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ConflictException } from "@nestjs/common";
import {
  assertKdsTransition,
  assertTenantScope,
  isWithinAvailability,
  itemAmounts,
  replayResult,
  requestHash,
  tabTotals,
} from "./pilot-rules.js";

describe("pilot POS rules", () => {
  it("keeps all totals in integer cents", () => {
    assert.deepEqual(itemAmounts(3, 1_999, 250, 500), {
      grossCents: 6_747,
      discountCents: 500,
      netCents: 6_247,
    });
    assert.deepEqual(
      tabTotals(
        [
          { grossCents: 6_747, discountCents: 500 },
          { grossCents: 2_000, discountCents: 0, canceled: true },
          { grossCents: 1_253, discountCents: 0 },
        ],
        1_000,
        300,
      ),
      {
        subtotalCents: 8_000,
        discountCents: 500,
        serviceChargeCents: 750,
        tipCents: 300,
        totalCents: 8_550,
      },
    );
  });

  it("rejects cross-tenant entities", () => {
    assert.throws(
      () =>
        assertTenantScope(
          { organizationId: "org-a", unitId: "unit-a" },
          { organizationId: "org-b", unitId: "unit-a" },
        ),
      ConflictException,
    );
  });

  it("allows only forward KDS transitions", () => {
    assert.doesNotThrow(() => assertKdsTransition("pending", "preparing"));
    assert.doesNotThrow(() => assertKdsTransition("preparing", "ready"));
    assert.throws(() => assertKdsTransition("ready", "preparing"), ConflictException);
    assert.throws(() => assertKdsTransition("done", "canceled"), ConflictException);
  });

  it("enforces unit-local availability windows, including overnight", () => {
    const schedule = { windows: [{ dayOfWeek: 6, start: "18:00", end: "02:00" }] };
    assert.equal(
      isWithinAvailability(schedule, new Date("2026-08-09T02:30:00.000Z"), "America/Sao_Paulo"),
      true,
    );
    assert.equal(
      isWithinAvailability(schedule, new Date("2026-08-09T06:00:00.000Z"), "America/Sao_Paulo"),
      false,
    );
  });

  it("replays the same idempotent request and rejects divergent reuse", () => {
    const hash = requestHash("tab.open", { guests: 2, label: "Ana" });
    const existing = { operation: "tab.open", requestHash: hash, response: { tabId: "tab-1" } };
    assert.deepEqual(replayResult(existing, "tab.open", hash), {
      tabId: "tab-1",
      idempotentReplay: true,
    });
    assert.throws(
      () => replayResult(existing, "tab.open", requestHash("tab.open", { guests: 3 })),
      ConflictException,
    );
  });
});
