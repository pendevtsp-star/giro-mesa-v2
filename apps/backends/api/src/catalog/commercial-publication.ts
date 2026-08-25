import { auditEvents, commercialCatalogVersions, type Database, outboxEvents } from "@giromesa/db";
import { and, desc, eq, lte, sql } from "drizzle-orm";

type CommercialExecutor = Pick<Database, "execute" | "select" | "update" | "insert">;

// ponytail: scheduled publication is activated by catalog/checkout reads; add a worker trigger if zero-traffic deadlines become required.
export async function activateDueCommercialCatalog(db: CommercialExecutor, now = new Date()) {
  await db.execute(sql`select pg_advisory_xact_lock(hashtextextended('commercial-catalog', 0))`);
  const [due] = await db
    .select({
      id: commercialCatalogVersions.id,
      version: commercialCatalogVersions.version,
      publishedByIdentityId: commercialCatalogVersions.publishedByIdentityId,
    })
    .from(commercialCatalogVersions)
    .where(
      and(
        eq(commercialCatalogVersions.status, "scheduled"),
        lte(commercialCatalogVersions.scheduledPublishAt, now),
      ),
    )
    .orderBy(desc(commercialCatalogVersions.version))
    .limit(1);
  if (!due) return null;
  await db
    .update(commercialCatalogVersions)
    .set({ status: "discontinued", updatedAt: now })
    .where(eq(commercialCatalogVersions.status, "published"));
  await db
    .update(commercialCatalogVersions)
    .set({ status: "published", publishedAt: now, scheduledPublishAt: null, updatedAt: now })
    .where(eq(commercialCatalogVersions.id, due.id));
  await db.insert(auditEvents).values({
    actorIdentityId: due.publishedByIdentityId,
    action: "commercial.catalog.scheduled_published",
    entityType: "commercial_catalog_version",
    entityId: due.id,
    metadata: { version: due.version },
  });
  await db.insert(outboxEvents).values({
    topic: "commercial.catalog_published",
    aggregateType: "commercial_catalog_version",
    aggregateId: due.id,
    payload: { catalogVersionId: due.id, version: due.version, scheduled: true },
  });
  return due;
}
