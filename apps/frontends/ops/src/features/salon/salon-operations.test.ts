import { describe, expect, it } from "vitest";
import type { FloorTable, PosTab } from "../../operations.shared";
import { countSalonGuests, selectSalonOpenTabs } from "./salon-operations";

describe("countSalonGuests", () => {
  const tab = (id: string, guestCount: number, serviceRootTabId?: string) =>
    ({ id, tableId: "table-1", guestCount, serviceRootTabId }) as PosTab;

  it("conta as pessoas da raiz uma vez e preserva atendimentos independentes na mesma mesa", () => {
    const child = tab("child", 1, "root");
    const accounts = [tab("root", 4), child, tab("independent", 2)];
    expect(countSalonGuests(accounts)).toBe(6);
    expect(countSalonGuests([...accounts].reverse())).toBe(6);
    expect(countSalonGuests([...accounts, child])).toBe(6);
    expect(countSalonGuests([tab("root", 2), tab("child", 4, "root")])).toBe(2);
  });

  it("usa o maior número conhecido quando a raiz está ausente sem multiplicar filhos", () => {
    expect(countSalonGuests([tab("a", 1, "root"), tab("b", 3, "root")])).toBe(3);
    expect(countSalonGuests([tab("b", 3, "root"), tab("a", 1, "root")])).toBe(3);
    expect(countSalonGuests([])).toBe(0);
  });
});

describe("selectSalonOpenTabs", () => {
  it("keeps unique table accounts and excludes counter and pickup tabs", () => {
    const tab = (id: string, tableId: string | null, status = "open", serviceRootTabId?: string) =>
      ({ id, tableId, status, serviceRootTabId }) as PosTab;
    const tables = [
      { id: "table-1", active: true },
      { id: "table-2", active: false },
    ] as FloorTable[];
    const linked = tab("linked", "table-1", "open", "root");

    expect(
      selectSalonOpenTabs(
        [
          tab("root", "table-1"),
          linked,
          linked,
          tab("counter", null),
          tab("pickup", null),
          tab("inactive-table", "table-2"),
          tab("closed", "table-1", "closed"),
        ],
        tables,
      ).map(({ id }) => id),
    ).toEqual(["root", "linked"]);
  });
});
