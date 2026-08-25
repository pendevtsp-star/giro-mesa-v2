import assert from "node:assert/strict";
import { it } from "node:test";
import {
  counterQueueQuerySchema,
  openTabSchema,
  orderSchema,
  paymentSchema,
  terminalProfileSchema,
  updateTabSchema,
} from "./pilot-schemas.js";

const tableId = "00000000-0000-4000-8000-000000000001";
const reservationId = "00000000-0000-4000-8000-000000000002";
const waitlistEntryId = "00000000-0000-4000-8000-000000000003";
const cashRegisterId = "00000000-0000-4000-8000-000000000004";
const installationId = "00000000-0000-4000-8000-000000000005";
const customerId = "00000000-0000-4000-8000-000000000006";
const productId = "00000000-0000-4000-8000-000000000007";
const externalClubId = "00000000-0000-4000-8000-000000000008";

it("requires one table and only one reception source when seating a guest", () => {
  assert.equal(
    openTabSchema.safeParse({ tableId, reservationId, customerId, guestCount: 2 }).success,
    true,
  );
  assert.equal(
    openTabSchema.safeParse({ tableId, customerId: "invalid", guestCount: 2 }).success,
    false,
  );
  assert.equal(openTabSchema.safeParse({ reservationId, guestCount: 2 }).success, false);
  assert.equal(
    openTabSchema.safeParse({ tableId, reservationId, waitlistEntryId, guestCount: 2 }).success,
    false,
  );
});

it("bounds the counter queue and rejects stale promised times on opening", () => {
  assert.deepEqual(counterQueueQuerySchema.parse({}), {
    stage: "all",
    channel: "all",
    query: "",
    page: 1,
    limit: 50,
  });
  assert.equal(counterQueueQuerySchema.safeParse({ limit: 101 }).success, false);
  assert.equal(
    openTabSchema.safeParse({
      guestCount: 1,
      promisedAt: new Date(Date.now() - 120_000).toISOString(),
    }).success,
    false,
  );
  assert.equal(
    openTabSchema.safeParse({
      guestCount: 1,
      promisedAt: new Date(Date.now() - 30_000).toISOString(),
    }).success,
    true,
  );
  assert.equal(
    updateTabSchema.safeParse({
      expectedVersion: 1,
      promisedAt: new Date(Date.now() - 120_000).toISOString(),
    }).success,
    true,
  );
});

it("accepts only bounded operational terminal profiles", () => {
  const valid = {
    label: "Caixa principal",
    mode: "cashier",
    defaultRoute: "cash",
    printerId: "caixa-80mm",
    stationId: null,
    compact: true,
    quickActions: ["receive", "print"],
  };
  assert.equal(terminalProfileSchema.safeParse(valid).success, true);
  assert.equal(
    terminalProfileSchema.safeParse({ ...valid, defaultRoute: "finance" }).success,
    false,
  );
  assert.equal(
    terminalProfileSchema.safeParse({ ...valid, quickActions: Array(9).fill("print") }).success,
    false,
  );
  assert.equal(
    terminalProfileSchema.safeParse({ ...valid, cashRegisterId }).data?.cashRegisterId,
    cashRegisterId,
  );
  assert.equal(
    paymentSchema.safeParse({ method: "cash", amountCents: 100, cashRegisterId, installationId })
      .success,
    true,
  );
});

it("accepts only the minimal Dose Club marker on an order item", () => {
  const item = {
    productId,
    quantity: 2,
    modifierOptionIds: [],
    doseClub: { externalClubId },
  };
  assert.equal(orderSchema.safeParse({ items: [item] }).success, true);
  assert.equal(
    orderSchema.safeParse({
      items: [{ ...item, doseClub: { externalClubId, availableDoses: 10 } }],
    }).success,
    false,
  );
  assert.equal(
    orderSchema.safeParse({ items: [{ ...item, doseClub: { externalClubId: "invalid" } }] })
      .success,
    false,
  );
});
