import {
  createDatabase,
  currentTenantContext,
  currentTenantDatabase,
  type DatabaseConnection,
  type TenantContext,
  type TenantTransaction,
  withTenantContext,
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

  async onModuleDestroy() {
    await this.client.end();
  }
}

@Global()
@Module({ providers: [DatabaseService], exports: [DatabaseService] })
export class DatabaseModule {}
