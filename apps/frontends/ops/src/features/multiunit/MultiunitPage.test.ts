import { describe, expect, it } from "vitest";
import type { MultiunitSummary } from "../../growth.shared";
import { multiunitAttention, scopedUnitHref } from "./MultiunitPage";

const unit: MultiunitSummary["units"][number] = {
  id: "unit-1",
  name: "Centro",
  completedDeliveryGrossCents: 0,
  activeReservations: 0,
  activeWaitlist: 0,
  cash: { status: "closed", openSince: null, varianceCents: null },
  delays: { total: 2, oldestMinutes: 18 },
  stockouts: { total: 1 },
};

describe("visão multiunidade operacional", () => {
  it("prioriza alertas cobertos sem transformar ausência de cobertura em zero", () => {
    expect(multiunitAttention(unit)).toBe(3);
    expect(
      multiunitAttention({
        ...unit,
        delays: { total: null, oldestMinutes: null },
        stockouts: { total: null },
      }),
    ).toBe(0);
  });

  it("gera link que troca apenas para unidade autorizada pelo bootstrap", () => {
    expect(
      scopedUnitHref("https://ops.example.test/app?old=1#/multiunit", "org-1", "unit-2", "kds"),
    ).toBe("/app?reportOrganization=org-1&reportUnit=unit-2#/kds");
  });
});
