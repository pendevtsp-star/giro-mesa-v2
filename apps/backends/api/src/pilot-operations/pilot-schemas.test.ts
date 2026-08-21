import assert from "node:assert/strict";
import { it } from "node:test";
import { openTabSchema, terminalProfileSchema } from "./pilot-schemas.js";

const tableId = "00000000-0000-4000-8000-000000000001";
const reservationId = "00000000-0000-4000-8000-000000000002";
const waitlistEntryId = "00000000-0000-4000-8000-000000000003";

it("requires one table and only one reception source when seating a guest", () => {
  assert.equal(openTabSchema.safeParse({ tableId, reservationId, guestCount: 2 }).success, true);
  assert.equal(openTabSchema.safeParse({ reservationId, guestCount: 2 }).success, false);
  assert.equal(
    openTabSchema.safeParse({ tableId, reservationId, waitlistEntryId, guestCount: 2 }).success,
    false,
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
});
