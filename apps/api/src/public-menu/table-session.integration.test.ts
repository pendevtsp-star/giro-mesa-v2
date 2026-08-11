import assert from "node:assert/strict";
import { randomInt, randomUUID } from "node:crypto";
import { it } from "node:test";
import {
  identities,
  memberships,
  organizations,
  posDiningRooms,
  posDiningTables,
  publicMenus,
  roleBindings,
  units,
} from "@giromesa/db";
import { DatabaseService } from "../database/database.module.js";
import { ScopeService } from "../organizations/scope.service.js";
import { PilotPosService } from "../pilot-operations/pilot-pos.service.js";
import { TableSessionCodec, TableSessionService } from "./table-session.js";

it("binds a signed public session to the current occupancy epoch", async (context) => {
  const databaseUrl = process.env.TABLE_SESSION_DATABASE_URL;
  if (!databaseUrl) {
    context.skip("TABLE_SESSION_DATABASE_URL not configured");
    return;
  }
  process.env.DATABASE_URL = databaseUrl;
  process.env.PUBLIC_TABLE_SESSION_SIGNING_KEY = "table-session-integration-key-32-bytes-minimum";
  const database = new DatabaseService();
  try {
    const [organization] = await database.db.insert(organizations).values({
      legalName: "QR Session Ltda",
      tradeName: "QR Session",
      document: String(randomInt(10_000_000_000_000, 99_999_999_999_999)),
      billingState: "active",
    }).returning();
    assert.ok(organization);
    const [unit] = await database.db.insert(units).values({ organizationId: organization.id, name: "QR Unit" }).returning();
    const [identity] = await database.db.insert(identities).values({ email: `qr-${randomUUID()}@example.test`, displayName: "Owner" }).returning();
    assert.ok(unit && identity);
    const [membership] = await database.db.insert(memberships).values({ organizationId: organization.id, identityId: identity.id, status: "active" }).returning();
    assert.ok(membership);
    await database.db.insert(roleBindings).values({ membershipId: membership.id, role: "owner" });
    const [room] = await database.db.insert(posDiningRooms).values({ organizationId: organization.id, unitId: unit.id, name: "Salão" }).returning();
    assert.ok(room);
    const [table] = await database.db.insert(posDiningTables).values({ organizationId: organization.id, unitId: unit.id, roomId: room.id, label: "01" }).returning();
    const [menu] = await database.db.insert(publicMenus).values({ organizationId: organization.id, unitId: unit.id, slug: `qr-${randomUUID()}`, active: true, publishedAt: new Date() }).returning();
    assert.ok(table && menu);
    const opened = await new PilotPosService(database, new ScopeService(database)).openTab(identity.id, organization.id, unit.id, "qr-open-session", { tableId: table.id, guestCount: 2 });
    assert.ok(opened.occupancy);

    const codec = new TableSessionCodec(process.env.PUBLIC_TABLE_SESSION_SIGNING_KEY);
    const service = new TableSessionService(database, codec);
    const qrToken = codec.issueTableQr({ organizationId: organization.id, unitId: unit.id, menuId: menu.id, tableId: table.id });
    const issued = await service.issue(menu.slug, qrToken, "request-source-a");
    const claims = await service.validate(menu.slug, issued.token, "view_partial");
    assert.equal(claims.occupancyEpoch, (opened.occupancy as { occupancyEpoch: string }).occupancyEpoch);
    await service.consumeRequestNonce(claims, "n".repeat(32), "partial");
    await assert.rejects(
      () => service.consumeRequestNonce(claims, "n".repeat(32), "partial"),
      /Comando já consumido/,
    );
    await assert.rejects(
      () => service.validate(menu.slug, `${issued.token.slice(0, -1)}x`, "view_partial"),
      /Sessão da mesa inválida/,
    );
    const expired = codec.issueSession(
      {
        ...claims,
        sessionId: randomUUID(),
      },
      new Date(Date.now() - 1_000),
    );
    assert.throws(() => codec.verifySession(expired.token), /TABLE_SESSION_EXPIRED/);

    for (let attempt = 0; attempt < 11; attempt += 1) {
      await service.issue(menu.slug, qrToken, "rate-limited-source");
    }
    await service.issue(menu.slug, qrToken, "rate-limited-source");
    await assert.rejects(
      () => service.issue(menu.slug, qrToken, "rate-limited-source"),
      /Muitas tentativas/,
    );

    await new PilotPosService(database, new ScopeService(database)).transitionOccupancy(identity.id, organization.id, unit.id, (opened.occupancy as { id: string }).id, "qr-close-session", {
      type: "close",
      occupancyEpoch: claims.occupancyEpoch,
      expectedVersion: 0,
    });
    await assert.rejects(() => service.validate(menu.slug, issued.token, "view_partial"), /TABLE_SESSION_STALE/);
  } finally {
    await database.onModuleDestroy();
  }
});
