import {
  createDatabase,
  currentTenantContext,
  currentTenantDatabase,
  type DatabaseConnection,
  type DatabaseContextRole,
  type TenantContext,
  type TenantTransaction,
  withDatabaseRoleContext,
  withPublicMenuContext,
  withTenantContext,
  withWorkerContext,
} from "@giromesa/db";
import { Global, Injectable, Module, type OnModuleDestroy, Optional } from "@nestjs/common";

@Injectable()
export class DatabaseService implements OnModuleDestroy {
  private readonly connection: DatabaseConnection;

  constructor(@Optional() connection?: DatabaseConnection) {
    this.connection = connection ?? createDatabase();
  }

  get db() {
    return currentTenantDatabase() ?? this.connection.db;
  }

  get client() {
    return this.connection.client;
  }

  get tenantContext() {
    return currentTenantContext();
  }

  withTenantContext<T>(
    context: Omit<TenantContext, "unitId" | "actorIdentityId"> & {
      unitId?: string | null;
      actorIdentityId?: string | null;
    },
    work: (database: TenantTransaction, context: TenantContext) => Promise<T> | T,
  ) {
    return withTenantContext(this.connection, context, work);
  }

  withWorkerContext<T>(work: (database: TenantTransaction) => Promise<T> | T) {
    return withWorkerContext(this.connection, work);
  }

  withRoleContext<T>(
    role: DatabaseContextRole,
    actorIdentityId: string | null,
    work: (database: TenantTransaction) => Promise<T> | T,
  ) {
    return withDatabaseRoleContext(this.connection, role, actorIdentityId, work);
  }

  withPublicMenuContext<T>(
    slug: string,
    work: (database: TenantTransaction, context: TenantContext) => Promise<T> | T,
  ) {
    return withPublicMenuContext(this.connection, slug, work);
  }

  async onModuleDestroy() {
    await this.client.end();
  }
}

@Global()
@Module({ providers: [DatabaseService], exports: [DatabaseService] })
export class DatabaseModule {}
