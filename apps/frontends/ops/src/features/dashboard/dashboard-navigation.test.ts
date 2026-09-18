import { describe, expect, it } from "vitest";
import { overviewDestinationHref } from "./dashboard-navigation";

describe("destinos da visão geral", () => {
  it("abre o formulário de nova comanda sem criar uma comanda", () => {
    expect(overviewDestinationHref({ id: "new-tab", route: "counter" })).toBe(
      "#/counter?action=new",
    );
  });
});
