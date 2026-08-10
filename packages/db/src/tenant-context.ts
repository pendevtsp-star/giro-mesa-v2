import { AsyncLocalStorage } from "node:async_hooks";
import { sql } from "drizzle-orm";
import type { Database, DatabaseConnection } from "./index.js";

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type TenantContext = Readonly<{
  source: "http" | "job";
  organizationId: string;
  unitId: string | null;
  actorIdentityId: string | null;
}>;

export type TenantTransaction = Parameters<Parameters<Database["transaction"]>[0]>[0];

interface ActiveTenantScope {
  context: TenantContext;
  database: TenantTransaction;
}

const activeTenantScope = new AsyncLocalStorage<ActiveTenantScope>();

function requiredUuid(value: string | undefined, field: string) {
  if (!value || !uuidPattern.test(value)) throw new TypeError(`${field} must be a UUID`);
  return value;
}

function optionalUuid(value: string | null | undefined, field: string) {
  if (value === null || value === undefined) return null;
  return requiredUuid(value, field);
}

export function tenantContext(input: {
  source: "http" | "job";
  organizationId: string;
  unitId?: string | null;
  actorIdentityId?: string | null;
}): TenantContext {
  return Object.freeze({
    source: input.source,
    organizationId: requiredUuid(input.organizationId, "organizationId"),
    unitId: optionalUuid(input.unitId, "unitId"),
    actorIdentityId: optionalUuid(input.actorIdentityId, "actorIdentityId"),
  });
}

export function currentTenantContext(): TenantContext | null {
  return activeTenantScope.getStore()?.context ?? null;
}

export function currentTenantDatabase(): TenantTransaction | null {
  return activeTenantScope.getStore()?.database ?? null;
}

export async function withTenantContext<T>(
  connection: DatabaseConnection,
  contextInput: Parameters<typeof tenantContext>[0],
  work: (database: TenantTransaction, context: TenantContext) => Promise<T> | T,
): Promise<T> {
  const context = tenantContext(contextInput);
  return connection.db.transaction(async (transaction) => {
    await transaction.execute(sql.raw("set local role giromesa_app"));
    await transaction.execute(sql`
      select
        set_config('app.current_organization_id', ${context.organizationId}, true),
        set_config('app.current_unit_id', ${context.unitId ?? ""}, true),
        set_config('app.current_actor_identity_id', ${context.actorIdentityId ?? ""}, true),
        set_config('app.current_context_source', ${context.source}, true)
    `);
    return activeTenantScope.run({ context, database: transaction }, () =>
      work(transaction, context),
    );
  });
}
