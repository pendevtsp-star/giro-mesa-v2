import type { DatabaseContextRole } from "@giromesa/db";
import { SetMetadata } from "@nestjs/common";

export const DATABASE_CONTEXT_ROLE = "giromesa.database-context-role";

export type HttpDatabaseContext =
  | Exclude<DatabaseContextRole, "worker">
  | "public-menu"
  | "platform";

export const DatabaseContext = (role: HttpDatabaseContext) =>
  SetMetadata(DATABASE_CONTEXT_ROLE, role);
