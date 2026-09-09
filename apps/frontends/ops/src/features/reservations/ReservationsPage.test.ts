import { describe, expect, it } from "vitest";
import {
  matchingCustomers,
  receptionSeatingOptions,
  reservationCapacity,
  reservationDateError,
  suggestedWait,
} from "./ReservationsPage";

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

  it("aceita um grupo single-tab livre pela mesa âncora e soma sua capacidade", () => {
    const grouped = {
      tables: [
        {
          id: "table-2",
          roomId: "room-1",
          label: "2",
          active: true,
          seats: 4,
          status: "available",
        },
        {
          id: "table-10",
          roomId: "room-1",
          label: "10",
          active: true,
          seats: 4,
          status: "available",
        },
      ],
      rooms: [{ id: "room-1", name: "Varanda" }],
      openTabs: [],
      tableGroups: [
        { id: "group-1", anchorTableId: "table-2", primaryTabId: null, mode: "single_tab" },
      ],
      tableGroupMembers: [
        { groupId: "group-1", tableId: "table-2" },
        { groupId: "group-1", tableId: "table-10" },
      ],
    } as unknown as Parameters<typeof receptionSeatingOptions>[0];

    expect(receptionSeatingOptions(grouped, 7)).toEqual([
      { id: "table-2", kind: "group", label: "2 + 10", roomName: "Varanda", seats: 8 },
    ]);

    grouped.tables = grouped.tables.map((table, index) =>
      index === 1 ? { ...table, status: "reserved" } : table,
    );
    expect(receptionSeatingOptions(grouped, 7, true)).toEqual([]);
  });

  it("bloqueia datas passadas e telefones são validados antes do envio", () => {
    const now = new Date("2026-09-09T18:00:00.000Z").getTime();
    expect(reservationDateError("2026-09-09T17:59:00.000Z", now)).toContain("futuras");
    expect(reservationDateError("2026-09-09T18:01:00.000Z", now)).toBeNull();
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
