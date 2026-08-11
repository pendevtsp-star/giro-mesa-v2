import assert from "node:assert/strict";
import { randomInt, randomUUID } from "node:crypto";
import { it } from "node:test";
import {
  identities,
  memberships,
  organizations,
  publicMenuVersions,
  publicMenus,
  roleBindings,
  units,
} from "@giromesa/db";
import { and, eq } from "drizzle-orm";
import { DatabaseService } from "../database/database.module.js";
import { ScopeService } from "../organizations/scope.service.js";
import { PublicMenuService } from "./public-menu.service.js";

function hasCode(expected: string) {
  return (error: unknown) => {
    const response = (error as { getResponse?: () => unknown }).getResponse?.();
    return (
      typeof response === "object" &&
      response !== null &&
      (response as { code?: string }).code === expected
    );
  };
}

it("publishes an immutable, tenant-isolated menu version with CAS", async (context) => {
  const databaseUrl = process.env.PUBLIC_MENU_DATABASE_URL;
  if (!databaseUrl) {
    context.skip("PUBLIC_MENU_DATABASE_URL not configured");
    return;
  }
  process.env.DATABASE_URL = databaseUrl;
  const database = new DatabaseService();
  try {
    const scope = new ScopeService(database);
    const service = new PublicMenuService(database, scope);
    const suffix = randomUUID();
    const [organizationA, organizationB] = await database.db
      .insert(organizations)
      .values([
        {
          legalName: "Menu A Ltda",
          tradeName: "Menu A",
          document: String(randomInt(10_000_000_000_000, 99_999_999_999_999)),
        },
        {
          legalName: "Menu B Ltda",
          tradeName: "Menu B",
          document: String(randomInt(10_000_000_000_000, 99_999_999_999_999)),
        },
      ])
      .returning();
    assert.ok(organizationA && organizationB);
    const [unitA, unitB] = await database.db
      .insert(units)
      .values([
        { organizationId: organizationA.id, name: "Menu A" },
        { organizationId: organizationB.id, name: "Menu B" },
      ])
      .returning();
    const [identity] = await database.db
      .insert(identities)
      .values({ email: `menu-${suffix}@example.test`, displayName: "Menu Owner" })
      .returning();
    assert.ok(unitA && unitB && identity);
    const [membership] = await database.db
      .insert(memberships)
      .values({ organizationId: organizationA.id, identityId: identity.id, status: "active" })
      .returning();
    assert.ok(membership);
    await database.db.insert(roleBindings).values({ membershipId: membership.id, role: "owner" });
    const [menu] = await database.db
      .insert(publicMenus)
      .values({ organizationId: organizationA.id, unitId: unitA.id, slug: `menu-${suffix}` })
      .returning();
    assert.ok(menu);

    const draft = await service.saveDraft(
      identity.id,
      organizationA.id,
      unitA.id,
      menu.id,
      {
        expectedVersion: 0,
        branding: {
          name: "Cozinha Horizonte",
          description: "Cardápio do turno atual.",
          primaryColor: "#155e75",
          surfaceColor: "#ffffff",
          textColor: "#102a2f",
          logoAssetId: null,
          coverAssetId: null,
        },
        items: [
          {
            id: "item-1",
            category: "Pratos",
            name: "Executivo",
            description: "Arroz, feijão e acompanhamento.",
            priceCents: 2_900,
            available: true,
            imageAssetId: null,
          },
        ],
      },
    );
    assert.equal(draft.resourceVersion, 1);
    await assert.rejects(
      () =>
        service.saveDraft(identity.id, organizationA.id, unitA.id, menu.id, {
          ...draft,
          expectedVersion: 0,
        }),
      hasCode("PUBLIC_MENU_VERSION_CONFLICT"),
    );

    const preview = await service.createPreview(
      identity.id,
      organizationA.id,
      unitA.id,
      menu.id,
      draft.resourceVersion,
    );
    assert.ok(preview.token.length >= 32);
    const version = await service.createVersion(
      identity.id,
      organizationA.id,
      unitA.id,
      menu.id,
      draft.resourceVersion,
    );
    const published = await service.publish(
      identity.id,
      organizationA.id,
      unitA.id,
      menu.id,
      version.id,
      0,
    );
    assert.equal(published.version, 1);

    const [persisted] = await database.db
      .select()
      .from(publicMenuVersions)
      .where(
        and(
          eq(publicMenuVersions.organizationId, organizationA.id),
          eq(publicMenuVersions.id, version.id),
        ),
      );
    assert.equal(persisted?.publishedAt?.toISOString(), published.publishedAt.toISOString());
    await assert.rejects(
      () => service.menuForTenant(organizationB.id, unitB.id, menu.id),
      hasCode("PUBLIC_MENU_NOT_FOUND"),
    );
  } finally {
    await database.onModuleDestroy();
  }
});
