import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { it } from "node:test";
import {
  deviceEnrollments,
  identities,
  memberships,
  organizations,
  roleBindings,
  units,
} from "@giromesa/db";
import { eq } from "drizzle-orm";
import { DatabaseService } from "../database/database.module.js";
import { OrganizationsService } from "./organizations.service.js";
import { ScopeService } from "./scope.service.js";

function errorCode(error: unknown) {
  const response = (error as { getResponse?: () => unknown }).getResponse?.();
  return typeof response === "object" && response !== null
    ? (response as { code?: string }).code
    : undefined;
}

it("redeems an Edge Hub pairing code once and stores only the sync-key hash", async (context) => {
  const databaseUrl = process.env.PILOT_DATABASE_URL;
  if (!databaseUrl) {
    context.skip("PILOT_DATABASE_URL not configured");
    return;
  }
  process.env.DATABASE_URL = databaseUrl;
  const database = new DatabaseService();
  try {
    const suffix = randomUUID();
    const [organization] = await database.db
      .insert(organizations)
      .values({
        legalName: "Edge Hub pairing integration",
        tradeName: "Edge Hub pairing integration",
        document: suffix.replaceAll("-", "").slice(0, 14),
        billingState: "active",
      })
      .returning();
    assert.ok(organization);
    const [unit] = await database.db
      .insert(units)
      .values({ organizationId: organization.id, name: "Unidade Edge" })
      .returning();
    const [owner] = await database.db
      .insert(identities)
      .values({ email: `edge-owner-${suffix}@example.test`, displayName: "Proprietário" })
      .returning();
    assert.ok(unit && owner);
    const [membership] = await database.db
      .insert(memberships)
      .values({ identityId: owner.id, organizationId: organization.id, status: "active" })
      .returning();
    assert.ok(membership);
    await database.db.insert(roleBindings).values({ membershipId: membership.id, role: "owner" });

    const service = new OrganizationsService(database, new ScopeService(database));
    const pairing = await service.createEdgeHubPairing(owner.id, organization.id, unit.id, {
      label: "Computador da cozinha",
      expiresInSeconds: 300,
    });
    assert.match(pairing.code, /^[A-HJ-NP-Z2-9]{8}$/);

    const enrollment = await service.redeemEdgeHubPairing({ code: pairing.code });
    assert.equal(enrollment.organizationId, organization.id);
    assert.equal(enrollment.unitId, unit.id);
    assert.equal(enrollment.syncKey.length > 32, true);

    const [stored] = await database.db
      .select({ syncKeyHash: deviceEnrollments.syncKeyHash })
      .from(deviceEnrollments)
      .where(eq(deviceEnrollments.id, enrollment.deviceId));
    assert.equal(
      stored?.syncKeyHash,
      createHash("sha256").update(enrollment.syncKey).digest("hex"),
    );
    assert.notEqual(stored?.syncKeyHash, enrollment.syncKey);

    await assert.rejects(
      () => service.redeemEdgeHubPairing({ code: pairing.code }),
      (error) => errorCode(error) === "EDGE_HUB_PAIRING_INVALID_OR_EXPIRED",
    );
  } finally {
    await database.onModuleDestroy();
  }
});
