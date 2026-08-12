import { AsyncLocalStorage } from "node:async_hooks";
import { sql } from "drizzle-orm";
import type { Database, DatabaseConnection } from "./index.js";

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type TenantContext = Readonly<{
  source: "http" | "internal" | "job" | "public";
  organizationId: string;
  unitId: string | null;
  actorIdentityId: string | null;
}>;

export type TenantTransaction = Parameters<Parameters<Database["transaction"]>[0]>[0];
export type DatabaseContextRole = "identity" | "internal" | "public" | "worker";

export type PlatformContext = Readonly<{
  actorIdentityId: string;
  sessionId: string;
  organizationId: string | null;
}>;

interface ActiveTenantScope {
  context: TenantContext | null;
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
  source: TenantContext["source"];
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

export async function withWorkerContext<T>(
  connection: DatabaseConnection,
  work: (database: TenantTransaction) => Promise<T> | T,
): Promise<T> {
  return connection.db.transaction(async (transaction) => {
    await transaction.execute(sql.raw("set local role giromesa_worker"));
    await transaction.execute(
      sql.raw("select set_config('app.current_context_source', 'worker-control', true)"),
    );
    return activeTenantScope.run({ context: null, database: transaction }, () => work(transaction));
  });
}

export async function withDatabaseRoleContext<T>(
  connection: DatabaseConnection,
  role: DatabaseContextRole,
  actorIdentityId: string | null,
  work: (database: TenantTransaction) => Promise<T> | T,
): Promise<T> {
  if (role === "worker") return withWorkerContext(connection, work);
  return connection.db.transaction(async (transaction) => {
    await transaction.execute(sql.raw(`set local role giromesa_${role}`));
    await transaction.execute(
      sql.raw(`select set_config('app.current_context_source', '${role}', true)`),
    );
    await transaction.execute(sql`
      select set_config('app.current_actor_identity_id', ${optionalUuid(actorIdentityId, "actorIdentityId") ?? ""}, true)
    `);
    return activeTenantScope.run({ context: null, database: transaction }, () => work(transaction));
  });
}

export async function withPlatformContext<T>(
  connection: DatabaseConnection,
  input: { actorIdentityId: string; sessionId: string; organizationId?: string | null },
  work: (database: TenantTransaction, context: PlatformContext) => Promise<T> | T,
): Promise<T> {
  const context: PlatformContext = Object.freeze({
    actorIdentityId: requiredUuid(input.actorIdentityId, "actorIdentityId"),
    sessionId: requiredUuid(input.sessionId, "sessionId"),
    organizationId: optionalUuid(input.organizationId, "organizationId"),
  });
  return connection.db.transaction(async (transaction) => {
    await transaction.execute(sql.raw("set local role giromesa_platform"));
    await transaction.execute(sql`
      select
        set_config('app.current_context_source', 'platform', true),
        set_config('app.current_organization_id', ${context.organizationId ?? ""}, true),
        set_config('app.current_unit_id', '', true),
        set_config('app.current_actor_identity_id', ${context.actorIdentityId}, true),
        set_config('app.current_session_id', ${context.sessionId}, true)
    `);
    return activeTenantScope.run({ context: null, database: transaction }, () =>
      work(transaction, context),
    );
  });
}

export async function withPublicMenuContext<T>(
  connection: DatabaseConnection,
  slug: string,
  work: (database: TenantTransaction, context: TenantContext) => Promise<T> | T,
): Promise<T> {
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) throw new TypeError("slug is invalid");
  return connection.db.transaction(async (transaction) => {
    await transaction.execute(sql.raw("set local role giromesa_public"));
    const result = await transaction.execute<{ organization_id: string; unit_id: string }>(sql`
      select organization_id, unit_id from public.giromesa_public_menu_scope(${slug})
    `);
    const [scope] = [...result];
    if (!scope) throw new Error("PUBLIC_MENU_SCOPE_NOT_FOUND");
    const context = tenantContext({
      source: "public",
      organizationId: scope.organization_id,
      unitId: scope.unit_id,
    });
    await transaction.execute(sql.raw("set local role giromesa_app"));
    await transaction.execute(sql`
      select
        set_config('app.current_organization_id', ${context.organizationId}, true),
        set_config('app.current_unit_id', ${context.unitId ?? ""}, true),
        set_config('app.current_actor_identity_id', '', true),
        set_config('app.current_context_source', 'public', true),
        set_config('app.current_public_menu_slug', ${slug}, true)
    `);
    return activeTenantScope.run({ context, database: transaction }, () =>
      work(transaction, context),
    );
  });
}

export async function withDoseClubContext<T>(
  connection: DatabaseConnection,
  input: { keyHash: string; scope: "doseclub:read" | "doseclub:write"; branchId?: string | null },
  work: (database: TenantTransaction, context: TenantContext) => Promise<T> | T,
): Promise<T> {
  if (!/^[0-9a-f]{64}$/.test(input.keyHash)) throw new TypeError("keyHash is invalid");
  const branchId = input.branchId?.trim() || null;
  if (branchId && branchId.length > 180) throw new TypeError("branchId is invalid");
  return connection.db.transaction(async (transaction) => {
    await transaction.execute(sql.raw("set local role giromesa_internal"));
    const resolved = await transaction.execute<{ organization_id: string; unit_id: string | null }>(
      sql`select organization_id, unit_id from public.giromesa_doseclub_scope(${input.keyHash}, ${input.scope}, ${branchId})`,
    );
    const [scope] = [...resolved];
    if (!scope) throw new Error("DOSECLUB_SCOPE_NOT_FOUND");
    const context = tenantContext({
      source: "internal",
      organizationId: scope.organization_id,
      unitId: scope.unit_id,
    });
    await transaction.execute(sql.raw("set local role giromesa_app"));
    await transaction.execute(sql`
      select
        set_config('app.current_organization_id', ${context.organizationId}, true),
        set_config('app.current_unit_id', ${context.unitId ?? ""}, true),
        set_config('app.current_actor_identity_id', '', true),
        set_config('app.current_context_source', 'internal', true)
    `);
    return activeTenantScope.run({ context, database: transaction }, () =>
      work(transaction, context),
    );
  });
}
