import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as fiscalSchema from "./fiscal-schema.js";
import * as growthSchema from "./growth-schema.js";
import * as managementSchema from "./management-schema.js";
import * as operationsSchema from "./operations-schema.js";
import * as baseSchema from "./schema.js";

export * from "./fiscal-schema.js";
export * from "./growth-schema.js";
export * from "./management-schema.js";
export * from "./operations-schema.js";
export * from "./schema.js";

const schema = {
  ...baseSchema,
  ...operationsSchema,
  ...managementSchema,
  ...growthSchema,
  ...fiscalSchema,
};

export function createDatabase(connectionString = process.env.DATABASE_URL) {
  if (!connectionString) throw new Error("DATABASE_URL is required");
  const client = postgres(connectionString, { max: 10, prepare: false });
  const db = drizzle(client, { schema });
  return { client, db };
}

export type DatabaseConnection = ReturnType<typeof createDatabase>;
export type Database = DatabaseConnection["db"];
