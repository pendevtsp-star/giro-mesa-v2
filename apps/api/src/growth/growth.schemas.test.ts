import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  publicCouponValidationSchema,
  publicReservationSchema,
  publicWaitlistSchema,
  webhookEndpointSchema,
} from "./growth.schemas.js";

describe("growth API boundaries", () => {
  it("accepts public HTTPS webhook targets and blocks local targets", () => {
    assert.equal(
      webhookEndpointSchema.safeParse({
        url: "https://hooks.example.com/giro",
        eventTypes: ["order.closed"],
      }).success,
      true,
    );
    assert.equal(
      webhookEndpointSchema.safeParse({
        url: "https://127.0.0.1/hook",
        eventTypes: ["order.closed"],
      }).success,
      false,
    );
    assert.equal(
      webhookEndpointSchema.safeParse({
        url: "http://hooks.example.com/giro",
        eventTypes: ["order.closed"],
      }).success,
      false,
    );
  });

  it("requires explicit privacy acceptance on public reservation and waitlist submissions", () => {
    const reservation = {
      guestName: "Maria Silva",
      guestPhone: "+5511999999999",
      partySize: 4,
      scheduledAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
      policyVersion: "2026-08-public",
    };
    assert.equal(
      publicReservationSchema.safeParse({ ...reservation, privacyAccepted: true }).success,
      true,
    );
    assert.equal(publicReservationSchema.safeParse(reservation).success, false);
    assert.equal(
      publicWaitlistSchema.safeParse({
        guestName: "Maria Silva",
        guestPhone: "+5511999999999",
        partySize: 4,
        privacyAccepted: false,
        policyVersion: "2026-08-public",
      }).success,
      false,
    );
  });

  it("rejects tenant and operational identifiers on public inputs", () => {
    assert.equal(
      publicWaitlistSchema.safeParse({
        guestName: "Maria Silva",
        guestPhone: "+5511999999999",
        partySize: 4,
        privacyAccepted: true,
        policyVersion: "2026-08-public",
        unitId: "f898be18-4f20-4e20-93b3-75468c80646e",
        quotedWaitMinutes: 10,
      }).success,
      false,
    );
    assert.equal(
      publicCouponValidationSchema.safeParse({
        code: "MESA10",
        orderTotalCents: 10_000,
        customerId: "f898be18-4f20-4e20-93b3-75468c80646e",
      }).success,
      false,
    );
  });
});
