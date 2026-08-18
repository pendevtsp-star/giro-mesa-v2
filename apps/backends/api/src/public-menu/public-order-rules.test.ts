import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  bestPromotion,
  localCalendar,
  localDate,
  type PublicPromotion,
} from "./public-order-rules.js";

const base: PublicPromotion = {
  id: "percentage",
  discountType: "percentage",
  discountValue: 1_500,
  productIds: ["product"],
  categoryIds: [],
  channels: ["delivery"],
  daysOfWeek: [0],
  startTime: null,
  endTime: null,
};

describe("public order promotions", () => {
  it("uses only the best active channel/day discount without discounting above product price", () => {
    assert.deepEqual(
      bestPromotion(
        [
          base,
          {
            ...base,
            id: "fixed-price",
            discountType: "fixed_price",
            discountValue: 1_600,
          },
        ],
        "product",
        "category",
        "delivery",
        0,
        600,
        2_000,
        2,
      ),
      { id: "fixed-price", discountCents: 800 },
    );
    assert.equal(bestPromotion([base], "product", "category", "pickup", 0, 600, 2_000, 1), null);
    assert.deepEqual(localCalendar(new Date("2026-08-17T01:00:00.000Z"), "America/Sao_Paulo"), {
      weekday: 0,
      minute: 1_320,
    });
    assert.equal(
      localDate(new Date("2026-08-17T01:00:00.000Z"), "America/Sao_Paulo"),
      "2026-08-16",
    );
  });

  it("supports category promotions and overnight recurring windows", () => {
    const overnight = {
      ...base,
      productIds: [],
      categoryIds: ["category"],
      startTime: "22:00",
      endTime: "02:00",
    };
    assert.equal(
      bestPromotion([overnight], "other", "category", "delivery", 1, 60, 2_000, 1)?.id,
      base.id,
    );
    assert.equal(
      bestPromotion([overnight], "other", "category", "delivery", 1, 180, 2_000, 1),
      null,
    );
  });
});
