import { eq } from "drizzle-orm";
import { createDatabase } from "./index.js";
import { commercialCatalogVersions, commercialPlans } from "./schema.js";

const plans = [
  {
    slug: "operacao",
    name: "Operação",
    monthly: 14_900,
    units: 1,
    entitlements: [
      "salon",
      "counter",
      "kds",
      "cashier",
      "offline_hub",
      "qr_ordering",
      "inventory",
      "purchasing",
      "finance",
      "basic_crm",
      "reports",
    ],
  },
  {
    slug: "crescimento",
    name: "Crescimento",
    monthly: 29_900,
    units: 1,
    entitlements: [
      "salon",
      "counter",
      "kds",
      "cashier",
      "offline_hub",
      "qr_ordering",
      "inventory",
      "purchasing",
      "finance",
      "basic_crm",
      "reports",
      "delivery",
      "pickup",
      "advanced_crm",
      "loyalty",
      "campaigns",
      "reconciliation",
      "integrations",
    ],
  },
  {
    slug: "rede",
    name: "Rede",
    monthly: 49_900,
    units: 3,
    entitlements: [
      "all_growth",
      "multi_unit",
      "public_api",
      "webhooks",
      "advanced_audit",
      "priority_sla",
    ],
  },
] as const;

const { client, db } = createDatabase();
try {
  const existing = await db
    .select()
    .from(commercialCatalogVersions)
    .where(eq(commercialCatalogVersions.version, 1))
    .limit(1);
  const catalog =
    existing[0] ??
    (
      await db
        .insert(commercialCatalogVersions)
        .values({ version: 1, status: "published", publishedAt: new Date() })
        .returning()
    )[0];
  if (!catalog) throw new Error("Could not create commercial catalog");
  for (const plan of plans) {
    await db
      .insert(commercialPlans)
      .values({
        catalogVersionId: catalog.id,
        slug: plan.slug,
        name: plan.name,
        monthlyPriceCents: plan.monthly,
        annualPriceCents: plan.monthly * 10,
        includedUnits: plan.units,
        entitlements: [...plan.entitlements],
      })
      .onConflictDoNothing();
  }
} finally {
  await client.end();
}
