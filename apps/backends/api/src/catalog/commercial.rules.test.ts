import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  assignCommercialExperimentVariant,
  automaticPromotionsOverlap,
  resolveCommercialPromotion,
} from "./commercial.rules.js";

describe("commercial promotion rules", () => {
  it("uses the best eligible promotion without applying code-only campaigns implicitly", () => {
    const now = new Date("2026-08-25T12:00:00Z");
    const base = {
      planSlugs: ["crescimento"],
      cycles: ["monthly" as const],
      startsAt: new Date("2026-08-01T00:00:00Z"),
      endsAt: null,
      newCustomersOnly: true,
      redemptionLimit: null,
      active: true,
    };
    const promotions = [
      {
        ...base,
        id: "auto",
        name: "Automática",
        type: "percentage" as const,
        value: 1_000,
        code: null,
      },
      { ...base, id: "code", name: "Cupom", type: "fixed" as const, value: 2_000, code: "GIRO20" },
    ];
    assert.equal(
      resolveCommercialPromotion(promotions, {
        planSlug: "crescimento",
        cycle: "monthly",
        basePriceCents: 10_000,
        newCustomer: true,
        now,
      })?.id,
      "auto",
    );
    assert.equal(
      resolveCommercialPromotion(promotions, {
        planSlug: "crescimento",
        cycle: "monthly",
        basePriceCents: 10_000,
        code: "giro20",
        newCustomer: true,
        now,
      })?.finalPriceCents,
      8_000,
    );
    assert.equal(
      resolveCommercialPromotion(promotions, {
        planSlug: "crescimento",
        cycle: "monthly",
        basePriceCents: 10_000,
        newCustomer: false,
        now,
      }),
      null,
    );
  });

  it("rejects overlapping automatic windows for the same plan and cycle", () => {
    const base = {
      id: "one",
      name: "One",
      type: "fixed" as const,
      value: 100,
      planSlugs: ["operacao"],
      cycles: ["monthly" as const],
      startsAt: new Date("2026-08-01T00:00:00Z"),
      endsAt: new Date("2026-09-01T00:00:00Z"),
      newCustomersOnly: true,
      code: null,
      redemptionLimit: null,
      active: true,
    };
    assert.equal(
      automaticPromotionsOverlap(base, {
        ...base,
        id: "two",
        startsAt: new Date("2026-08-15T00:00:00Z"),
      }),
      true,
    );
    assert.equal(automaticPromotionsOverlap(base, { ...base, id: "coupon", code: "GIRO" }), false);
  });

  it("assigns one stable content-only experiment variant", () => {
    const variants = [
      { key: "a", weight: 50, headline: "A", description: "A", ctaLabel: "A", ctaHref: "/a" },
      { key: "b", weight: 50, headline: "B", description: "B", ctaLabel: "B", ctaHref: "/b" },
    ];
    const first = assignCommercialExperimentVariant("hero", variants, "visitor-123");
    assert.ok(first);
    assert.equal(
      assignCommercialExperimentVariant("hero", variants, "visitor-123")?.key,
      first.key,
    );
  });
});
