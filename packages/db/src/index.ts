import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as doseClubSchema from "./doseclub-schema.js";
import * as fiscalSchema from "./fiscal-schema.js";
import * as growthSchema from "./growth-schema.js";
import * as managementSchema from "./management-schema.js";
import * as operationsSchema from "./operations-schema.js";
import * as platformSchema from "./platform-schema.js";
import * as reportSchema from "./report-schema.js";
import * as baseSchema from "./schema.js";
import * as settlementSchema from "./settlement-schema.js";

export * from "./doseclub-schema.js";
export * from "./fiscal-artifacts.js";
export * from "./fiscal-schema.js";
export * from "./growth-schema.js";
export * from "./management-schema.js";
export * from "./operations-schema.js";
export * from "./platform-schema.js";
export * from "./report-artifacts.js";
export * from "./report-schema.js";
export * from "./schema.js";
export * from "./settlement-schema.js";
export * from "./whatsapp-artifacts.js";

const schema: typeof baseSchema &
  typeof operationsSchema &
  typeof reportSchema &
  typeof settlementSchema &
  typeof managementSchema &
  typeof growthSchema &
  typeof fiscalSchema &
  typeof platformSchema &
  typeof doseClubSchema = {
  ...baseSchema,
  ...operationsSchema,
  ...reportSchema,
  ...settlementSchema,
  ...managementSchema,
  ...growthSchema,
  ...fiscalSchema,
  ...platformSchema,
  ...doseClubSchema,
};

export type GiroMesaDatabase = {
  client: ReturnType<typeof postgres>;
  db: PostgresJsDatabase<typeof schema>;
};

export function createDatabase(connectionString = process.env.DATABASE_URL): GiroMesaDatabase {
  if (!connectionString) throw new Error("DATABASE_URL is required");
  const client = postgres(connectionString, { max: 10, prepare: false });
  const db = drizzle(client, { schema });
  return { client, db };
}

export type DatabaseConnection = ReturnType<typeof createDatabase>;
export type Database = DatabaseConnection["db"];
