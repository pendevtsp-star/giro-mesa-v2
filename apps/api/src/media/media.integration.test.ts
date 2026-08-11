import assert from "node:assert/strict";
import { randomInt, randomUUID } from "node:crypto";
import { it } from "node:test";
import {
  identities,
  memberships,
  organizations,
  publicMenuMediaAssets,
  publicMenus,
  publicMenuVersions,
  roleBindings,
  units,
} from "@giromesa/db";
import { eq } from "drizzle-orm";
import sharp from "sharp";
import { DatabaseService } from "../database/database.module.js";
import { ScopeService } from "../organizations/scope.service.js";
import { inspectAndRecodeImage, MediaService } from "./media.service.js";

it("serializes media quota and exposes only assets referenced by the published slug", async (context) => {
  const databaseUrl = process.env.MEDIA_DATABASE_URL;
  if (!databaseUrl) {
    context.skip("MEDIA_DATABASE_URL not configured");
    return;
  }
  process.env.DATABASE_URL = databaseUrl;
  const database = new DatabaseService();
  const previousQuota = process.env.PUBLIC_MEDIA_QUOTA_BYTES;
  try {
    const [organization] = await database.db
      .insert(organizations)
      .values({
        legalName: "Media Race Ltda",
        tradeName: "Media Race",
        document: String(randomInt(10_000_000_000_000, 99_999_999_999_999)),
        billingState: "active",
      })
      .returning();
    assert.ok(organization);
    const [unit] = await database.db
      .insert(units)
      .values({ organizationId: organization.id, name: "Media Unit" })
      .returning();
    const [identity] = await database.db
      .insert(identities)
      .values({ email: `media-${randomUUID()}@example.test`, displayName: "Owner" })
      .returning();
    assert.ok(unit && identity);
    const [membership] = await database.db
      .insert(memberships)
      .values({ organizationId: organization.id, identityId: identity.id, status: "active" })
      .returning();
    assert.ok(membership);
    await database.db.insert(roleBindings).values({ membershipId: membership.id, role: "owner" });

    const sources = await Promise.all(
      ["#155e75", "#be123c"].map((background) =>
        sharp({ create: { width: 64, height: 64, channels: 4, background } }).png().toBuffer(),
      ),
    );
    const recoded = await Promise.all(sources.map((source) => inspectAndRecodeImage(source, "image/png")));
    process.env.PUBLIC_MEDIA_QUOTA_BYTES = String(Math.max(...recoded.map((image) => image.bytes.length)));
    const service = new MediaService(database, new ScopeService(database));
    const uploads = await Promise.allSettled(
      sources.map((source, index) =>
        service.upload(identity.id, organization.id, unit.id, {
          kind: index === 0 ? "logo" : "cover",
          declaredMimeType: "image/png",
          contentBase64: source.toString("base64"),
        }),
      ),
    );
    assert.equal(uploads.filter((result) => result.status === "fulfilled").length, 1);
    assert.equal(uploads.filter((result) => result.status === "rejected").length, 1);
    const [asset] = await database.db
      .select()
      .from(publicMenuMediaAssets)
      .where(eq(publicMenuMediaAssets.organizationId, organization.id));
    assert.ok(asset);

    const slug = `media-${randomUUID()}`;
    const [menu] = await database.db
      .insert(publicMenus)
      .values({ organizationId: organization.id, unitId: unit.id, slug, active: true })
      .returning();
    assert.ok(menu);
    const branding = {
      name: "Media Menu",
      description: "",
      primaryColor: "#155e75",
      surfaceColor: "#ffffff",
      textColor: "#111111",
      logoAssetId: asset.id,
      coverAssetId: null,
    };
    const [version] = await database.db
      .insert(publicMenuVersions)
      .values({
        organizationId: organization.id,
        unitId: unit.id,
        menuId: menu.id,
        version: 1,
        sourceResourceVersion: 0,
        checksum: randomUUID().replaceAll("-", "").padEnd(64, "0"),
        branding,
        items: [],
        createdByIdentityId: identity.id,
        publishedAt: new Date(),
      })
      .returning();
    assert.ok(version);
    await database.db
      .update(publicMenus)
      .set({ publishedVersionId: version.id, publishedAt: new Date() })
      .where(eq(publicMenus.id, menu.id));

    assert.equal((await service.publicAsset(slug, asset.id))?.id, asset.id);
    assert.equal(await service.publicAsset(`other-${randomUUID()}`, asset.id), null);
  } finally {
    if (previousQuota === undefined) delete process.env.PUBLIC_MEDIA_QUOTA_BYTES;
    else process.env.PUBLIC_MEDIA_QUOTA_BYTES = previousQuota;
    await database.onModuleDestroy();
  }
});
