import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { getTableName } from "drizzle-orm";
import { operationalCommands, organizations, units } from "./schema.js";

describe("database schema", () => {
  it("keeps tenant scope in the operational core", () => {
    assert.equal(getTableName(organizations), "organizations");
    assert.equal(getTableName(units), "units");
    assert.equal(getTableName(operationalCommands), "operational_commands");
    assert.ok(operationalCommands.organizationId);
    assert.ok(operationalCommands.unitId);
  });
});
