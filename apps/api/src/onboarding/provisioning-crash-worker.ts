import { createDatabase } from "@giromesa/db";
import { DatabaseService } from "../database/database.module.js";
import { ScopeService } from "../organizations/scope.service.js";
import { OnboardingService } from "./onboarding.service.js";

const [databaseUrl, identityId, organizationId, idempotencyKey] = process.argv.slice(2);
if (!databaseUrl || !identityId || !organizationId || !idempotencyKey) {
  throw new Error("databaseUrl, identityId, organizationId and idempotencyKey are required");
}

const connection = createDatabase(databaseUrl, { max: 4 });
const database = new DatabaseService(connection);
const service = new OnboardingService(database, new ScopeService(database));

try {
  await database.withTenantContext(
    { source: "http", organizationId, actorIdentityId: identityId },
    () => service.activate(identityId, organizationId, idempotencyKey, {}),
  );
} finally {
  await database.onModuleDestroy();
}
