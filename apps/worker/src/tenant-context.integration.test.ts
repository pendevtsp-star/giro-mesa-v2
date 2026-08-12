import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { describe, it } from "node:test";
import { createDatabase, outboxEvents } from "@giromesa/db";
import { OutboxWorker } from "./outbox.js";

const integrationUrl = process.env.TENANT_ISOLATION_DATABASE_URL;

function applicationUrl(ownerUrl: string, user: string, password: string) {
  const url = new URL(ownerUrl);
  url.username = user;
  url.password = password;
  return url.toString();
}

describe("worker tenant context", () => {
  it("claims through the worker role and executes a tenant job on one pooled connection", async (context) => {
    if (!integrationUrl) {
      context.skip("TENANT_ISOLATION_DATABASE_URL not configured");
      return;
    }
    const suffix = randomUUID().replaceAll("-", "");
    const loginRole = `giromesa_test_worker_${suffix}`;
    const password = `worker-test-${suffix}`;
    const organizationId = randomUUID();
    const unitId = randomUUID();
    const eventId = randomUUID();
    const ownerConnection = createDatabase(integrationUrl);
    const owner = ownerConnection.client;
    let worker: OutboxWorker | undefined;
    try {
      await owner.unsafe(
        `create role "${loginRole}" login password '${password}' noinherit nosuperuser nocreatedb nocreaterole noreplication nobypassrls`,
      );
      await owner.unsafe(`grant giromesa_app, giromesa_worker to "${loginRole}"`);
      await owner`
        insert into organizations (id, legal_name, trade_name, document)
        values (${organizationId}, 'Worker Tenant Ltda', 'Worker Tenant', ${suffix.slice(0, 14)})
      `;
      await owner`
        insert into units (id, organization_id, name)
        values (${unitId}, ${organizationId}, 'Worker Unit')
      `;
      await ownerConnection.db.insert(outboxEvents).values({
        id: eventId,
        organizationId,
        unitId,
        topic: "test.tenant_job",
        aggregateType: "test",
        aggregateId: eventId,
        payload: { organizationId, unitId, privateValue: "worker-only" },
      });
      const connection = createDatabase(applicationUrl(integrationUrl, loginRole, password), {
        max: 1,
      });
      worker = new OutboxWorker(connection);
      assert.equal(await worker.runOnce(1), 1);
      const [processed] = await owner<
        { attempts: number; locked_at: Date | null; processed_at: Date | null }[]
      >`
        select attempts, locked_at, processed_at from outbox_events where id = ${eventId}
      `;
      assert.equal(processed?.attempts, 1);
      assert.equal(processed?.locked_at, null);
      assert.ok(processed?.processed_at);
    } finally {
      if (worker) await worker.close();
      await owner`delete from organizations where id = ${organizationId}`;
      await owner.unsafe(`revoke giromesa_app, giromesa_worker from "${loginRole}"`);
      await owner.unsafe(`drop owned by "${loginRole}"`);
      await owner.unsafe(`drop role "${loginRole}"`);
      await owner.end();
    }
  });
});
