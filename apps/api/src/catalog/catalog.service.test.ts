import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { DatabaseService } from "../database/database.module.js";
import { CatalogService } from "./catalog.service.js";

type RecordedInsert = {
  values: Record<string, unknown>;
};

function writeOnlyDatabase(records: RecordedInsert[]): DatabaseService {
  return {
    db: {
      insert: () => ({
        values: async (values: Record<string, unknown>) => {
          records.push({ values });
        },
      }),
    },
  } as unknown as DatabaseService;
}

describe("CatalogService public intake", () => {
  it("creates explicit identities without relying on INSERT RETURNING", async () => {
    const records: RecordedInsert[] = [];
    const service = new CatalogService(writeOnlyDatabase(records));

    const trial = await service.createTrialApplication({
      name: "Maria Silva",
      email: "maria@example.com",
      phone: "11999999999",
      businessName: "Bar Maria",
      segment: "Bar",
      planSlug: "operacao",
      consent: true,
    });
    const contact = await service.createContactRequest({
      name: "Maria Silva",
      email: "maria@example.com",
      phone: "11999999999",
      message: "Preciso de ajuda com a implantação.",
      privacyAccepted: true,
    });

    assert.match(trial.id, /^[0-9a-f-]{36}$/);
    assert.ok(trial.createdAt instanceof Date);
    assert.match(contact.id, /^[0-9a-f-]{36}$/);
    assert.ok(contact.createdAt instanceof Date);
    assert.equal(records.length, 4);
    assert.equal(records[0]?.values.id, trial.id);
    assert.equal(records[1]?.values.aggregateId, trial.id);
    assert.equal(records[2]?.values.id, contact.id);
    assert.equal(records[3]?.values.aggregateId, contact.id);
  });
});
