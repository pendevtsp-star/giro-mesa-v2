import { describe, expect, it } from "vitest";
import { reservationCapacity, suggestedWait } from "./ReservationsPage";

function floor(status: "available" | "occupied" | "needs_cleaning") {
  return {
    tables: [{ id: "table-1", active: true, seats: 4, status }],
    openTabs: [],
  } as unknown as Parameters<typeof suggestedWait>[0];
}

describe("reception operational estimates", () => {
  it("uses current table state and warns when overlapping bookings exceed capacity", () => {
    expect(suggestedWait(floor("available"), 4)).toBe(0);
    expect(suggestedWait(floor("needs_cleaning"), 4)).toBe(10);

    const scheduledAt = "2026-08-18T20:00:00.000Z";
    const capacity = reservationCapacity(
      floor("available"),
      [
        {
          scheduledAt,
          durationMinutes: 120,
          partySize: 3,
          status: "confirmed",
        },
      ] as Parameters<typeof reservationCapacity>[1],
      scheduledAt,
      2,
    );
    expect(capacity).toEqual({ compatible: true, remainingSeats: -1 });
  });
});
