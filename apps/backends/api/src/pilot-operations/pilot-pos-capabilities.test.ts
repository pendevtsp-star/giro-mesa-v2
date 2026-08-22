import assert from "node:assert/strict";
import { it } from "node:test";
import { paymentTerminalConfigurationSchema } from "@giromesa/contracts";
import type { SystemRole } from "@giromesa/domain";
import { ForbiddenException } from "@nestjs/common";
import { DatabaseService } from "../database/database.module.js";
import { ScopeService } from "../organizations/scope.service.js";
import { PilotPosService } from "./pilot-pos.service.js";

const id = "00000000-0000-4000-8000-000000000001";

function serviceFor(role: SystemRole) {
  const scope = {
    requireUnitAccess: async () => ({ membershipId: id, role }),
    requireOrganizationRole: async () => [{ membershipId: id, role, unitId: null }],
  } as unknown as ScopeService;
  return new PilotPosService({} as DatabaseService, scope);
}

async function rejectsCapability(action: () => Promise<unknown>, capability: string) {
  await assert.rejects(action, (error: unknown) => {
    assert.ok(error instanceof ForbiddenException);
    assert.deepEqual(error.getResponse(), {
      code: "POS_CAPABILITY_DENIED",
      message: "Ação operacional não autorizada nesta unidade.",
      capability,
    });
    return true;
  });
}

it("separates routine payment from managerial exceptions", async () => {
  await rejectsCapability(
    () =>
      serviceFor("waiter").discountItem(id, id, id, id, "discount-denied-0001", {
        discountCents: 100,
        approval: { approverMembershipId: id, pin: "1234", reason: "Cortesia" },
      }),
    "operations:exceptions:approve",
  );
  await rejectsCapability(
    () =>
      serviceFor("delivery").recordPayment(id, id, id, id, "payment-denied-0001", {
        method: "pix",
        amountCents: 100,
      }),
    "operations:payments:record",
  );
});

it("keeps tenant terminal configuration fail-closed without an internal certification", () => {
  assert.equal(
    paymentTerminalConfigurationSchema.safeParse({
      provider: "rede",
      status: "homologated",
      methods: ["credit_card"],
      maxInstallments: 12,
      supports: { cancel: true, recover: true, reversal: true },
    }).success,
    false,
  );
});
