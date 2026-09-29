import { posTabs } from "@giromesa/db";
import { ConflictException } from "@nestjs/common";
import { and, eq, sql } from "drizzle-orm";
import type { DatabaseService } from "../database/database.module.js";
import { MAX_STORED_CENTS } from "./pilot-rules.js";

type Transaction = Parameters<Parameters<DatabaseService["db"]["transaction"]>[0]>[0];

/** Install the delivery fee once, under the same lock used by payments and POS totals. */
export async function applyDeliveryFee(
  tx: Transaction,
  organizationId: string,
  unitId: string,
  tabId: string,
  deliveryFeeCents: number,
) {
  if (
    !Number.isSafeInteger(deliveryFeeCents) ||
    deliveryFeeCents < 0 ||
    deliveryFeeCents > MAX_STORED_CENTS
  )
    throw new ConflictException({ code: "DELIVERY_FEE_INVALID" });
  await tx.execute(
    sql`select pg_advisory_xact_lock(hashtext(${`pos-payment:${organizationId}:${unitId}:${tabId}`}))`,
  );
  const [tab] = await tx
    .select()
    .from(posTabs)
    .where(
      and(
        eq(posTabs.organizationId, organizationId),
        eq(posTabs.unitId, unitId),
        eq(posTabs.id, tabId),
      ),
    )
    .for("update")
    .limit(1);
  if (tab?.status !== "open" || tab.fulfillmentType !== "delivery")
    throw new ConflictException({ code: "DELIVERY_OPERATIONAL_TAB_NOT_FOUND" });
  if (tab.deliveryFeeCents === deliveryFeeCents) return tab;
  if (tab.deliveryFeeCents !== 0) throw new ConflictException({ code: "DELIVERY_FEE_ALREADY_SET" });
  const totalCents = tab.totalCents + deliveryFeeCents;
  if (totalCents > MAX_STORED_CENTS)
    throw new ConflictException({ code: "DELIVERY_TOTAL_INVALID" });
  const [updated] = await tx
    .update(posTabs)
    .set({ deliveryFeeCents, totalCents, updatedAt: new Date() })
    .where(
      and(
        eq(posTabs.organizationId, organizationId),
        eq(posTabs.unitId, unitId),
        eq(posTabs.id, tabId),
      ),
    )
    .returning();
  if (!updated) throw new ConflictException({ code: "DELIVERY_OPERATIONAL_TAB_NOT_FOUND" });
  return updated;
}
