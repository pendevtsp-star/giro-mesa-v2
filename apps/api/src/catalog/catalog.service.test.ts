import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { contactRequests, outboxEvents, trialApplications } from "@giromesa/db";
import { CatalogService } from "./catalog.service.js";

describe("public catalog intake persistence", () => {
  it("creates application identifiers before INSERT so forced RLS needs no public SELECT", async () => {
    const writes: Array<{ table: unknown; values: Record<string, unknown> }> = [];
    const database = {
      db: {
        insert(table: unknown) {
          return {
            values(values: Record<string, unknown>) {
              writes.push({ table, values });
              return Promise.resolve();
            },
          };
        },
      },
    };
    const service = new CatalogService(database as never);

    const trial = await service.createTrialApplication({
      name: "Marina Lopes",
      email: "marina@example.com",
      phone: "+5511998765432",
      businessName: "Bar Horizonte",
      segment: "bar",
      planSlug: "operacao",
      consent: true,
    });
    assert.match(trial.id, /^[0-9a-f-]{36}$/i);
    assert.ok(trial.createdAt instanceof Date);
    assert.equal(writes[0]?.table, trialApplications);
    assert.equal(writes[0]?.values.id, trial.id);
    assert.equal(writes[1]?.table, outboxEvents);
    assert.deepEqual(writes[1]?.values.payload, { applicationId: trial.id });

    const contact = await service.createContactRequest({
      name: "Rafael Lima",
      email: "rafael@example.com",
      phone: "+5511987654321",
      message: "Preciso de ajuda com a implantação.",
      privacyAccepted: true,
    });
    assert.match(contact.id, /^[0-9a-f-]{36}$/i);
    assert.ok(contact.createdAt instanceof Date);
    assert.equal(writes[2]?.table, contactRequests);
    assert.equal(writes[2]?.values.id, contact.id);
    assert.equal(writes[3]?.table, outboxEvents);
    assert.deepEqual(writes[3]?.values.payload, { contactRequestId: contact.id });
  });
});
