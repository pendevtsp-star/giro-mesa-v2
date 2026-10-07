import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { it } from "node:test";
import {
  auditEvents,
  identities,
  memberships,
  organizations,
  outboxEvents,
  posCatalogBranding,
  posDiningRooms,
  posDiningTables,
  posTabs,
  publicMenus,
  roleBindings,
  units,
} from "@giromesa/db";
import { eq, sql } from "drizzle-orm";
import { DatabaseService } from "../database/database.module.js";
import { ScopeService } from "../organizations/scope.service.js";
import { PublicTableService } from "../public-menu/public-table.service.js";
import { tableOccupancyCode } from "../public-menu/table-session-token.js";
import { PilotCatalogService } from "./pilot-catalog.service.js";
import { PilotPosService } from "./pilot-pos.service.js";

it("persists and audits the table QR settings and print lifecycle in PostgreSQL", async (context) => {
  const databaseUrl = process.env.PILOT_DATABASE_URL;
  if (!databaseUrl) {
    context.skip("PILOT_DATABASE_URL not configured");
    return;
  }
  process.env.DATABASE_URL = databaseUrl;
  const qrSecret = "integration-table-qr-secret".padEnd(32, "x");
  process.env.QR_TABLE_TOKEN_SECRET = qrSecret;
  process.env.CUSTOMER_APP_URL = "https://menu.example.test";
  const database = new DatabaseService();
  let createdOrganizationId: string | undefined;
  let createdIdentityId: string | undefined;
  try {
    const runId = randomUUID();
    const [organization] = await database.db
      .insert(organizations)
      .values({
        legalName: "QR Integration Ltda",
        tradeName: "Casa QR",
        document: `${runId.replaceAll("-", "").slice(0, 13)}1`,
        billingState: "active",
      })
      .returning();
    assert.ok(organization);
    createdOrganizationId = organization.id;
    const [unit] = await database.db
      .insert(units)
      .values({ organizationId: organization.id, name: "Unidade Centro" })
      .returning();
    assert.ok(unit);
    const [identity] = await database.db
      .insert(identities)
      .values({ email: `qr-owner+${runId}@example.test`, displayName: "Dona da casa" })
      .returning();
    assert.ok(identity);
    createdIdentityId = identity.id;
    const [membership] = await database.db
      .insert(memberships)
      .values({ identityId: identity.id, organizationId: organization.id, status: "active" })
      .returning();
    assert.ok(membership);
    await database.db.insert(roleBindings).values({ membershipId: membership.id, role: "owner" });
    await database.db.insert(posCatalogBranding).values({
      organizationId: organization.id,
      unitId: unit.id,
      config: {
        displayName: "Marca do cardápio",
        logoUrl: "https://cdn.example.test/logo.png",
        primaryColor: "#123456",
        accentColor: "#123456",
        wifi: { ssid: "Casa QR", password: "segredo" },
      },
    });
    const slug = `qr-${runId.slice(0, 8)}`;
    await database.db.insert(publicMenus).values({
      organizationId: organization.id,
      unitId: unit.id,
      slug,
      active: true,
      publishedAt: new Date(),
    });
    const [room] = await database.db
      .insert(posDiningRooms)
      .values({ organizationId: organization.id, unitId: unit.id, name: "Salão" })
      .returning();
    assert.ok(room);
    const [table] = await database.db
      .insert(posDiningTables)
      .values({
        organizationId: organization.id,
        unitId: unit.id,
        roomId: room.id,
        label: "Mesa 01",
      })
      .returning();
    assert.ok(table);

    const catalog = new PilotCatalogService(database, new ScopeService(database));
    const fallback = await catalog.getTableQrSettings(identity.id, organization.id, unit.id);
    assert.equal(fallback.revision, 0);
    assert.equal(fallback.displayName, "Marca do cardápio");
    assert.match(fallback.wifiNotice ?? "", /Casa QR/);

    assert.equal(fallback.presenceProtection, "session_only");
    const assistanceTabIds: Array<string | undefined> = [];
    const publicTable = new PublicTableService(database, {
      createPublicServiceCall: async (
        _organizationId: string,
        _unitId: string,
        _tableId: string,
        tabId: string | undefined,
      ) => {
        assistanceTabIds.push(tabId);
        return {
          call: { id: randomUUID(), kind: "assistance", status: "pending" },
          duplicate: false,
        };
      },
    } as unknown as PilotPosService);
    const sessionOnlyBatch = await catalog.createTableQrPrintBatch(
      identity.id,
      organization.id,
      unit.id,
      "qr-batch-session-only-0001",
      { format: "sticker", output: "png", includeWifi: false, tableIds: [table.id] },
    );
    const sessionOnlyUrl = new URL(sessionOnlyBatch.tables[0]?.url ?? "");
    const sessionOnlyToken = new URLSearchParams(sessionOnlyUrl.hash.slice(1)).get("mesa");
    assert.ok(sessionOnlyToken);
    const openedWithoutPresenceCode = await publicTable.openSession(slug, sessionOnlyToken, {});
    assert.equal(openedWithoutPresenceCode.response.tableLabel, "Mesa 01");
    assert.equal(openedWithoutPresenceCode.response.status, "awaiting_tab");
    await publicTable.command(
      slug,
      "qr-assistance-before-tab",
      undefined,
      openedWithoutPresenceCode.token,
      { type: "call_waiter", payload: {} },
    );
    assert.equal(assistanceTabIds.at(-1), undefined);
    const [firstTab] = await database.db
      .insert(posTabs)
      .values({
        organizationId: organization.id,
        unitId: unit.id,
        tableId: table.id,
        openedByIdentityId: identity.id,
      })
      .returning();
    assert.ok(firstTab);
    const staffPresence = await new PilotPosService(
      database,
      new ScopeService(database),
    ).tableQrPresence(identity.id, organization.id, unit.id);
    assert.equal(staffPresence.activeTables[0]?.tableId, table.id);
    await assert.rejects(() => publicTable.status(slug, openedWithoutPresenceCode.token));
    await assert.rejects(() => publicTable.consumption(slug, openedWithoutPresenceCode.token));
    await publicTable.command(
      slug,
      "qr-assistance-during-tab",
      undefined,
      openedWithoutPresenceCode.token,
      { type: "call_waiter", payload: {} },
    );
    assert.equal(assistanceTabIds.at(-1), undefined);
    await assert.rejects(() =>
      publicTable.command(
        slug,
        "qr-check-without-presence",
        undefined,
        openedWithoutPresenceCode.token,
        { type: "request_check", payload: {} },
      ),
    );
    await assert.rejects(() =>
      publicTable.createOrder(slug, openedWithoutPresenceCode.token, "old-qr-order", { items: [] }),
    );
    await assert.rejects(() => publicTable.openSession(slug, sessionOnlyToken, {}));
    const firstCode = tableOccupancyCode(qrSecret, organization.id, unit.id, table.id, firstTab.id);
    const firstOccupancy = await publicTable.openSession(
      slug,
      undefined,
      { presenceCode: firstCode },
      openedWithoutPresenceCode.token,
    );
    assert.equal(staffPresence.activeTables[0]?.code, firstCode);
    assert.equal(firstOccupancy.response.status, "active");
    await database.db
      .update(posTabs)
      .set({ status: "closed", closedAt: new Date() })
      .where(eq(posTabs.id, firstTab.id));
    const [nextTab] = await database.db
      .insert(posTabs)
      .values({
        organizationId: organization.id,
        unitId: unit.id,
        tableId: table.id,
        openedByIdentityId: identity.id,
      })
      .returning();
    assert.ok(nextTab);
    await assert.rejects(() => publicTable.status(slug, firstOccupancy.token));
    await assert.rejects(() =>
      publicTable.openSession(slug, sessionOnlyToken, { presenceCode: firstCode }),
    );
    const nextCode = tableOccupancyCode(qrSecret, organization.id, unit.id, table.id, nextTab.id);
    const nextOccupancy = await publicTable.openSession(slug, sessionOnlyToken, {
      presenceCode: nextCode,
    });
    assert.equal(nextOccupancy.response.status, "active");
    await database.db
      .update(posTabs)
      .set({ status: "closed", closedAt: new Date() })
      .where(eq(posTabs.id, nextTab.id));

    const settingsInput = {
      expectedRevision: 0,
      displayName: "Placas da Casa QR",
      headline: "Peça direto da mesa",
      instructions: "Aponte a câmera para o QR Code.",
      logoUrl: "https://cdn.example.test/placa.png",
      primaryColor: "#654321",
      wifiNotice: "Wi-Fi: Casa QR · Senha: segredo",
      serviceChargeNotice: "Serviço de 10% opcional.",
      template: "compact" as const,
      presenceProtection: "daily_code" as const,
    };
    const saved = await catalog.updateTableQrSettings(
      identity.id,
      organization.id,
      unit.id,
      "qr-settings-0001",
      settingsInput,
    );
    assert.equal(saved.revision, 1);
    assert.equal(
      (
        await catalog.updateTableQrSettings(
          identity.id,
          organization.id,
          unit.id,
          "qr-settings-0001",
          settingsInput,
        )
      ).idempotentReplay,
      true,
    );

    const batch = await catalog.createTableQrPrintBatch(
      identity.id,
      organization.id,
      unit.id,
      "qr-batch-0001",
      { format: "a4_4", output: "print", includeWifi: false, tableIds: [table.id] },
    );
    assert.equal(batch.includeWifi, false);
    assert.equal(batch.settings.wifiNotice, null);
    assert.equal(batch.tables[0]?.isCurrent, true);
    assert.match(batch.tables[0]?.url ?? "", /#mesa=/);
    const tested = await catalog.testTableQrUrl(identity.id, organization.id, unit.id, {
      url: batch.tables[0]?.url ?? "",
    });
    assert.equal(tested.valid, true);
    assert.equal(tested.displayName, "Placas da Casa QR");
    assert.equal(tested.unitName, "Unidade Centro");
    assert.equal(tested.tableLabel, "Mesa 01");

    await catalog.rotateTableQr(identity.id, organization.id, unit.id, table.id, "qr-rotate-0001");
    await assert.rejects(() => publicTable.openSession(slug, sessionOnlyToken, {}));
    await assert.rejects(() =>
      catalog.markTableQrPrintBatchPrinted(
        identity.id,
        organization.id,
        unit.id,
        batch.id,
        "qr-print-stale-0001",
      ),
    );

    const currentBatch = await catalog.createTableQrPrintBatch(
      identity.id,
      organization.id,
      unit.id,
      "qr-batch-0002",
      { format: "table_tent", output: "pdf", includeWifi: true, tableIds: [table.id] },
    );
    const printed = await catalog.markTableQrPrintBatchPrinted(
      identity.id,
      organization.id,
      unit.id,
      currentBatch.id,
      "qr-print-0002",
    );
    assert.equal(printed.status, "printed");
    assert.equal(printed.printedByLabel, "Dona da casa");
    assert.match(printed.settings.wifiNotice ?? "", /segredo/);
    const lifecycle = await catalog.tableQrLifecycle(identity.id, organization.id, unit.id);
    assert.equal(
      lifecycle.batches.some((entry) => entry.id === printed.id),
      true,
    );
    assert.equal(lifecycle.rotations[0]?.actorLabel, "Dona da casa");
    assert.match(lifecycle.presence.code ?? "", /^\d{6}$/);
    assert.equal(lifecycle.generalBranding.logoUrl, "https://cdn.example.test/logo.png");
    const currentUrl = new URL(currentBatch.tables[0]?.url ?? "");
    const tableToken = new URLSearchParams(currentUrl.hash.slice(1)).get("mesa");
    assert.ok(tableToken);
    const wrongPresenceCode = lifecycle.presence.code === "000000" ? "000001" : "000000";
    await assert.rejects(() =>
      publicTable.openSession(slug, tableToken, { presenceCode: wrongPresenceCode }),
    );
    const opened = await publicTable.openSession(slug, tableToken, {
      presenceCode: lifecycle.presence.code ?? undefined,
    });
    assert.equal(opened.response.tableLabel, "Mesa 01");
    const withMetrics = await catalog.tableQrLifecycle(identity.id, organization.id, unit.id);
    assert.equal(withMetrics.tables[0]?.scanCount, 4);
    assert.ok(withMetrics.tables[0]?.lastScannedAt);
  } finally {
    try {
      if (createdOrganizationId) {
        await database.db
          .delete(auditEvents)
          .where(eq(auditEvents.organizationId, createdOrganizationId));
        await database.db
          .delete(outboxEvents)
          .where(sql`${outboxEvents.payload}->>'organizationId' = ${createdOrganizationId}`);
        await database.db.delete(posTabs).where(eq(posTabs.organizationId, createdOrganizationId));
        await database.db.delete(organizations).where(eq(organizations.id, createdOrganizationId));
        const remaining = await database.db
          .select({ id: organizations.id })
          .from(organizations)
          .where(eq(organizations.id, createdOrganizationId));
        assert.equal(remaining.length, 0, "the integration organization must be removed");
      }
      if (createdIdentityId) {
        await database.db.delete(identities).where(eq(identities.id, createdIdentityId));
      }
    } finally {
      await database.onModuleDestroy();
    }
  }
});
