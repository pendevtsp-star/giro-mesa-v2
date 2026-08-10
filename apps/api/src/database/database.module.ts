import { createDatabase, type DatabaseConnection } from "@giromesa/db";
import { Global, Injectable, Module, type OnModuleDestroy } from "@nestjs/common";

@Injectable()
export class DatabaseService implements OnModuleDestroy {
  private readonly connection: DatabaseConnection = createDatabase();
  readonly db = this.connection.db;
  readonly client = this.connection.client;

  async onModuleDestroy() {
    await this.client.end();
  }
}

@Global()
@Module({ providers: [DatabaseService], exports: [DatabaseService] })
export class DatabaseModule {}
