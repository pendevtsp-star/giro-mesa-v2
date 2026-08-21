import { describe, expect, it } from "vitest";
import { customerDisplayTabIdFromHash } from "./CustomerDisplayPage";

describe("visor do cliente", () => {
  it("lê somente a comanda indicada no hash", () => {
    expect(customerDisplayTabIdFromHash("#/counter?display=tab-123")).toBe("tab-123");
    expect(customerDisplayTabIdFromHash("#/counter")).toBeNull();
  });
});
