import { describe, expect, it } from "vitest";
import type { OverviewPriority } from "../../management.shared";
import { overviewPriorityHref } from "./DashboardPage";

describe("atalhos do painel", () => {
  it("abre a entidade somente no módulo correspondente e codifica os identificadores", () => {
    const priority = {
      route: "salon",
      target: { tableId: "mesa/1", tabId: "tab-2" },
    } as OverviewPriority;
    expect(overviewPriorityHref(priority)).toBe("#/salon?table=mesa%2F1");
    expect(overviewPriorityHref({ ...priority, route: "counter" })).toBe("#/counter?tab=tab-2");
    expect(overviewPriorityHref({ ...priority, route: "finance" })).toBe("#/finance");
    expect(
      overviewPriorityHref({ ...priority, route: "kds", target: { ticketId: "ticket-1" } }),
    ).toBe("#/kds?ticket=ticket-1");
    expect(
      overviewPriorityHref({
        ...priority,
        route: "delivery",
        target: { deliveryOrderId: "order-1" },
      }),
    ).toBe("#/delivery?order=order-1");
  });
});
