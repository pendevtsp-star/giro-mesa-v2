import { describe, expect, it } from "vitest";
import { matchingCustomers, reservationCapacity, suggestedWait } from "./ReservationsPage";

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

  it("finds a persisted customer by normalized identity and limits suggestions", () => {
    const customers = Array.from({ length: 8 }, (_, index) => ({
      id: `customer-${index}`,
      name: index === 0 ? "João da Silva" : `Cliente ${index}`,
      email: index === 0 ? "joao@example.com" : null,
      phone: index === 0 ? "(11) 99876-5432" : "11999990000",
      marketingOptIn: false,
    }));

    expect(matchingCustomers(customers, "joao")[0]?.id).toBe("customer-0");
    expect(matchingCustomers(customers, "998765432")[0]?.id).toBe("customer-0");
    expect(matchingCustomers(customers, "11")).toHaveLength(6);
    expect(matchingCustomers(customers, "j")).toEqual([]);
  });
});
