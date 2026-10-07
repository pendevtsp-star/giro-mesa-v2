import assert from "node:assert/strict";
import { it } from "node:test";
import type { DatabaseService } from "../database/database.module.js";
import type { ScopeService } from "../organizations/scope.service.js";
import { GrowthService } from "./growth.service.js";

it("denies organization-wide customer access to a unit-bound manager", async () => {
  const scope = {
    requireOrganizationRole: async () => [
      { role: "manager", unitId: "unit-a" },
      { role: "waiter", unitId: null },
    ],
  } as unknown as ScopeService;
  const growth = new GrowthService({} as DatabaseService, scope);
  for (const action of [
    () => growth.listCustomers("manager", "org"),
    () => growth.listCustomerPage("manager", "org", { limit: 10, offset: 0 }),
    () => growth.customerDetail("manager", "org", "customer-b"),
    () => growth.updateCustomer("manager", "org", "customer-b", { name: "Alterado" }),
  ]) {
    await assert.rejects(action, (error: unknown) => {
      assert.equal(
        (error as { response?: { code?: string } }).response?.code,
        "CRM_GLOBAL_ROLE_REQUIRED",
      );
      return true;
    });
  }
});
