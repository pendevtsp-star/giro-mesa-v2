import { describe, expect, it } from "vitest";
import { linkedReportScope } from "./App";

describe("shared report scope", () => {
  it("requires organization and unit together", () => {
    expect(linkedReportScope("?reportOrganization=org-1&reportUnit=unit-1")).toEqual({
      organizationId: "org-1",
      unitId: "unit-1",
    });
    expect(linkedReportScope("?reportUnit=unit-1")).toBeNull();
  });
});
