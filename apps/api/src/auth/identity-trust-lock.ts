import type { TenantTransaction } from "@giromesa/db";
import { sql } from "drizzle-orm";

const IDENTITY_TRUST_LOCK_NAMESPACE = "auth-trust:identity:";

export function identityTrustLockName(identityId: string) {
  return `${IDENTITY_TRUST_LOCK_NAMESPACE}${identityId}`;
}

/**
 * Global auth lock order:
 * 1. provider subject/e-mail locks used to discover or create an identity;
 * 2. this identity trust lock;
 * 3. identity, credential, token, factor, challenge and session rows.
 *
 * A transaction holding this lock must never acquire a subject/e-mail lock.
 */
export async function acquireIdentityTrustLock(tx: TenantTransaction, identityId: string) {
  await tx.execute(
    sql`select pg_advisory_xact_lock(hashtextextended(${identityTrustLockName(identityId)}::text, 0))`,
  );
}
