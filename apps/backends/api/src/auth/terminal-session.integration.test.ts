import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { it } from "node:test";
import {
  identities,
  memberships,
  organizations,
  roleBindings,
  terminalOperatorPins,
  terminalSessions,
  units,
} from "@giromesa/db";
import { eq } from "drizzle-orm";
import { DatabaseService } from "../database/database.module.js";
import { AuthService } from "./auth.service.js";
import { hashTerminalPin, TerminalSessionService } from "./terminal-session.service.js";

it("allows an active owner with a PIN to operate without a People record", async (context) => {
  const databaseUrl = process.env.AUTH_DATABASE_URL ?? process.env.MANAGEMENT_DATABASE_URL;
  if (!databaseUrl) {
    context.skip("AUTH_DATABASE_URL or MANAGEMENT_DATABASE_URL not configured");
    return;
  }
  process.env.DATABASE_URL = databaseUrl;
  const previousPepper = process.env.TERMINAL_PIN_PEPPER;
  process.env.TERMINAL_PIN_PEPPER = "terminal-pin-integration-test-pepper-0001";
  const database = new DatabaseService();
  const organizationId = randomUUID();
  const unitId = randomUUID();
  const identityId = randomUUID();
  const membershipId = randomUUID();
  const token = randomUUID();
  const pin = "123456";

  try {
    await database.db.insert(organizations).values({
      id: organizationId,
      legalName: "Terminal owner test",
      tradeName: "Terminal owner test",
      document: randomUUID().replace(/\D/g, "").padEnd(14, "0").slice(0, 14),
    });
    await database.db.insert(units).values({ id: unitId, organizationId, name: "Terminal unit" });
    await database.db.insert(identities).values({
      id: identityId,
      email: `terminal-owner-${randomUUID()}@example.test`,
      displayName: "Terminal owner",
    });
    await database.db.insert(memberships).values({
      id: membershipId,
      identityId,
      organizationId,
      status: "active",
    });
    await database.db.insert(roleBindings).values({ membershipId, role: "owner" });
    await database.db.insert(terminalOperatorPins).values({
      membershipId,
      pinHash: await hashTerminalPin(membershipId, pin),
    });
    await database.db.insert(terminalSessions).values({
      tokenHash: createHash("sha256").update(token).digest("hex"),
      organizationId,
      unitId,
      openedByIdentityId: identityId,
      expiresAt: new Date(Date.now() + 60_000),
    });

    const terminals = new TerminalSessionService(database, new AuthService(database));
    const waiting = await terminals.status(token);
    assert.deepEqual(waiting.operators, [
      { membershipId, identityId, displayName: "Terminal owner", roles: ["owner"] },
    ]);

    const active = await terminals.unlock(token, membershipId, pin);
    assert.equal(active.actor?.membershipId, membershipId);
    assert.equal((await terminals.authenticate(token))?.identityId, identityId);
  } finally {
    await database.db.delete(organizations).where(eq(organizations.id, organizationId));
    await database.db.delete(identities).where(eq(identities.id, identityId));
    await database.onModuleDestroy();
    if (previousPepper === undefined) delete process.env.TERMINAL_PIN_PEPPER;
    else process.env.TERMINAL_PIN_PEPPER = previousPepper;
  }
});
