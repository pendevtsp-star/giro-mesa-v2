import assert from "node:assert/strict";
import { randomBytes, randomInt, randomUUID } from "node:crypto";
import { test } from "node:test";
import {
  createDatabase,
  fiscalDocuments,
  fiscalProfiles,
  identities,
  legalEntities,
  organizations,
  posCatalogCategories,
  posOrderItems,
  posOrders,
  posProducts,
  posTabPayments,
  posTabs,
  productTaxRevisions,
  units,
} from "@giromesa/db";
import { encryptSecret } from "@giromesa/domain";
import { eq } from "drizzle-orm";
import { processFiscalEvent } from "./fiscal.js";

test("persists delivery freight in the fiscal snapshot and never resends an authorized replay", async (context) => {
  const databaseUrl = process.env.WORKER_DATABASE_URL;
  if (!databaseUrl) return context.skip("WORKER_DATABASE_URL not configured");
  const database = createDatabase(databaseUrl);
  const previousKey = process.env.FISCAL_CREDENTIALS_ENCRYPTION_KEY;
  const key = randomBytes(32);
  process.env.FISCAL_CREDENTIALS_ENCRYPTION_KEY = key.toString("base64");
  const rollback = new Error("rollback fiscal integration fixtures");
  let sent: Record<string, unknown> | undefined;
  const fetch = context.mock.method(
    globalThis,
    "fetch",
    async (_url: unknown, options: RequestInit) => {
      sent = JSON.parse(String(options.body)) as Record<string, unknown>;
      return new Response(JSON.stringify({ status: "autorizado" }), { status: 201 });
    },
  );
  try {
    await assert.rejects(
      database.db.transaction(async (tx) => {
        const [organization] = await tx
          .insert(organizations)
          .values({
            legalName: "Fiscal Delivery Test",
            tradeName: "Fiscal Delivery Test",
            document: String(randomInt(10_000_000_000_000, 99_999_999_999_999)),
          })
          .returning();
        assert.ok(organization);
        const [unit] = await tx
          .insert(units)
          .values({ organizationId: organization.id, name: "Delivery" })
          .returning();
        const [actor] = await tx
          .insert(identities)
          .values({
            displayName: "Fiscal Test",
            email: `fiscal-delivery-${randomUUID()}@example.test`,
          })
          .returning();
        const [entity] = await tx
          .insert(legalEntities)
          .values({
            organizationId: organization.id,
            legalName: organization.legalName,
            document: organization.document,
          })
          .returning();
        assert.ok(unit && actor && entity);
        const scope = { organizationId: organization.id, unitId: unit.id };
        await tx.insert(fiscalProfiles).values({
          ...scope,
          legalEntityId: entity.id,
          taxRegime: "simples_nacional",
          crt: "1",
          stateCode: "SP",
          cityCode: "3550308",
          environment: "homologation",
          provider: "focus",
          settings: {
            focus: {
              status: "ready",
              enabled: { nfce: true },
              tokenHomologation: encryptSecret(
                "fixture-token",
                key,
                `focus:${organization.id}:${unit.id}:homologation`,
              ),
            },
          },
        });
        const [category] = await tx
          .insert(posCatalogCategories)
          .values({ organizationId: organization.id, name: "Pratos", slug: "pratos" })
          .returning();
        assert.ok(category);
        const [product] = await tx
          .insert(posProducts)
          .values({ organizationId: organization.id, categoryId: category.id, name: "Prato" })
          .returning();
        assert.ok(product);
        await tx.insert(productTaxRevisions).values({
          ...scope,
          productId: product.id,
          version: 1,
          status: "active",
          effectiveFrom: "2020-01-01",
          classification: {
            ncm: "21069090",
            cfop: "5102",
            origin: 0,
            csosn: "102",
            cstPis: "49",
            cstCofins: "49",
          },
        });
        const [tab] = await tx
          .insert(posTabs)
          .values({
            ...scope,
            openedByIdentityId: actor.id,
            label: "Delivery",
            fulfillmentType: "delivery",
            status: "closed",
            subtotalCents: 2000,
            deliveryFeeCents: 700,
            totalCents: 2700,
            closedAt: new Date(),
          })
          .returning();
        assert.ok(tab);
        const [order] = await tx
          .insert(posOrders)
          .values({ ...scope, tabId: tab.id, createdByIdentityId: actor.id })
          .returning();
        assert.ok(order);
        await tx.insert(posOrderItems).values({
          ...scope,
          orderId: order.id,
          productId: product.id,
          productName: "Prato",
          quantity: 1,
          unitPriceCents: 2000,
          grossCents: 2000,
          netCents: 2000,
          status: "served",
        });
        await tx.insert(posTabPayments).values({
          ...scope,
          tabId: tab.id,
          method: "pix",
          amountCents: 2700,
          createdByIdentityId: actor.id,
        });
        const event = {
          id: randomUUID(),
          topic: "pos.tab.closed",
          aggregate_type: "pos_tab",
          aggregate_id: tab.id,
          payload: { ...scope, tabId: tab.id },
          attempts: 1,
        };
        const transactionalDatabase = tx as unknown as Parameters<typeof processFiscalEvent>[0];
        await processFiscalEvent(transactionalDatabase, event);
        const [document] = await tx
          .select()
          .from(fiscalDocuments)
          .where(eq(fiscalDocuments.tabId, tab.id));
        assert.ok(document);
        assert.equal(document.status, "authorized");
        assert.equal(document.totalCents, 2700);
        const snapshot = document.snapshot.payload as {
          items: Array<{ valor_frete: number }>;
          formas_pagamento: Array<{ valor_pagamento: number }>;
        };
        assert.equal(snapshot.items[0]?.valor_frete, 7);
        assert.equal(snapshot.formas_pagamento[0]?.valor_pagamento, 27);
        assert.deepEqual(sent, document.snapshot.payload);
        await processFiscalEvent(transactionalDatabase, event);
        assert.equal(fetch.mock.callCount(), 1);
        assert.equal(
          (await tx.select().from(fiscalDocuments).where(eq(fiscalDocuments.tabId, tab.id))).length,
          1,
        );
        throw rollback;
      }),
      (error) => error === rollback,
    );
  } finally {
    if (previousKey === undefined) delete process.env.FISCAL_CREDENTIALS_ENCRYPTION_KEY;
    else process.env.FISCAL_CREDENTIALS_ENCRYPTION_KEY = previousKey;
    await database.client.end();
  }
});
