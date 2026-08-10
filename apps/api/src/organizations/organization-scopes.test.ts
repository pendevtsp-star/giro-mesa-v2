import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { shapeOrganizationScopes } from "./organization-scopes.js";

describe("organization selector scopes", () => {
  it("returns only units belonging to the authenticated membership organization", () => {
    const result = shapeOrganizationScopes(
      [
        {
          membershipId: "membership-a",
          status: "active",
          organization: {
            id: "organization-a",
            legalName: "A Ltda",
            tradeName: "A",
            billingState: "active",
          },
        },
      ],
      [{ membershipId: "membership-a", unitId: null, role: "owner" }],
      [
        {
          id: "unit-a",
          organizationId: "organization-a",
          name: "A Centro",
          timezone: "America/Sao_Paulo",
          active: true,
        },
        {
          id: "unit-b",
          organizationId: "organization-b",
          name: "B Centro",
          timezone: "America/Sao_Paulo",
          active: true,
        },
      ],
    );
    assert.deepEqual(
      result[0]?.units.map((unit) => unit.id),
      ["unit-a"],
    );
    assert.deepEqual(result[0]?.units[0]?.roles, ["owner"]);
  });

  it("limits unit-bound staff without promoting their scope", () => {
    const result = shapeOrganizationScopes(
      [
        {
          membershipId: "membership-a",
          status: "active",
          organization: {
            id: "organization-a",
            legalName: "A Ltda",
            tradeName: "A",
            billingState: "active",
          },
        },
      ],
      [{ membershipId: "membership-a", unitId: "unit-a", role: "waiter" }],
      [
        {
          id: "unit-a",
          organizationId: "organization-a",
          name: "A Centro",
          timezone: "America/Sao_Paulo",
          active: true,
        },
        {
          id: "unit-a-2",
          organizationId: "organization-a",
          name: "A Norte",
          timezone: "America/Sao_Paulo",
          active: true,
        },
      ],
    );
    assert.deepEqual(
      result[0]?.units.map((unit) => unit.id),
      ["unit-a"],
    );
    assert.deepEqual(result[0]?.roles, ["waiter"]);
  });
});
