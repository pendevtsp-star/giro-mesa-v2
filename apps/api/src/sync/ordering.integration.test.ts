import assert from "node:assert/strict";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { it } from "node:test";
import { fileURLToPath } from "node:url";
import {
  aggregateSequenceStates,
  commandInbox,
  commandQuarantine,
  createDatabase,
  operationalCommands,
  outboxEvents,
} from "@giromesa/db";
import { and, eq } from "drizzle-orm";
import { DatabaseService } from "../database/database.module.js";
import type { OperationalSnapshotService } from "./operational-snapshot.service.js";
import type { NormalizedSyncEventInput, OrderedSyncEventInput } from "./sync.schemas.js";
import { SyncService } from "./sync.service.js";
import type { SyncPilotService } from "./sync-pilot.service.js";

const integrationUrl = process.env.ORDERING_DATABASE_URL;
const migrationsDirectory = fileURLToPath(
  new URL("../../../../packages/db/drizzle/", import.meta.url),
);

async function applyMigration(client: ReturnType<typeof createDatabase>["client"], file: string) {
  const source = await readFile(`${migrationsDirectory}${file}`, "utf8");
  const statements = source
    .split("--> statement-breakpoint")
    .map((statement) => statement.trim())
    .filter(Boolean);
  await client.begin(async (transaction) => {
    for (const statement of statements) await transaction.unsafe(statement);
  });
}

const hash = (value: string) => createHash("sha256").update(value).digest("hex");

it("applies ordered commands effectively once and isolates every receipt by tenant", async (context) => {
  if (!integrationUrl) {
    context.skip("ORDERING_DATABASE_URL not configured");
    return;
  }

  const databaseName = `giromesa_ordering_${randomUUID().replaceAll("-", "")}`;
  const admin = createDatabase(integrationUrl).client;
  const databaseUrl = new URL(integrationUrl);
  databaseUrl.pathname = `/${databaseName}`;
  let database: DatabaseService | undefined;
  try {
    await admin.unsafe(`create database "${databaseName}"`);
    const migrated = createDatabase(databaseUrl.toString(), { max: 1 });
    const migrationFiles = (await readdir(migrationsDirectory))
      .filter((file) => /^\d{4}_.*\.sql$/.test(file))
      .sort();
    assert.equal(migrationFiles.at(-1), "0010_event_foundation.sql");
    for (const file of migrationFiles) await applyMigration(migrated.client, file);

    database = new DatabaseService(migrated);
    const serviceDatabase = database;
    const suffix = randomBytes(8).toString("hex");
    const organizationA = randomUUID();
    const organizationB = randomUUID();
    const unitA = randomUUID();
    const unitB = randomUUID();
    const actorA = randomUUID();
    const actorB = randomUUID();
    const membershipA = randomUUID();
    const membershipB = randomUUID();
    const hubA = randomUUID();
    const hubB = randomUUID();
    const keyA = randomBytes(32).toString("base64url");
    const keyB = randomBytes(32).toString("base64url");
    await migrated.client`
      insert into organizations (id, legal_name, trade_name, document)
      values
        (${organizationA}, 'Ordering A Ltda', 'Ordering A', ${`1${suffix}`.slice(0, 14)}),
        (${organizationB}, 'Ordering B Ltda', 'Ordering B', ${`2${suffix}`.slice(0, 14)})
    `;
    await migrated.client`
      insert into units (id, organization_id, name)
      values (${unitA}, ${organizationA}, 'Unit A'), (${unitB}, ${organizationB}, 'Unit B')
    `;
    await migrated.client`
      insert into identities (id, email, display_name)
      values
        (${actorA}, ${`ordering-a-${suffix}@example.test`}, 'Actor A'),
        (${actorB}, ${`ordering-b-${suffix}@example.test`}, 'Actor B')
    `;
    await migrated.client`
      insert into memberships (id, identity_id, organization_id, status)
      values
        (${membershipA}, ${actorA}, ${organizationA}, 'active'),
        (${membershipB}, ${actorB}, ${organizationB}, 'active')
    `;
    await migrated.client`
      insert into role_bindings (membership_id, role)
      values (${membershipA}, 'owner'), (${membershipB}, 'owner')
    `;
    await migrated.client`
      insert into device_enrollments (id, organization_id, unit_id, label, sync_key_hash)
      values
        (${hubA}, ${organizationA}, ${unitA}, 'Hub A', ${hash(keyA)}),
        (${hubB}, ${organizationB}, ${unitB}, 'Hub B', ${hash(keyB)})
    `;

    let durableEffects = 0;
    const pilot = {
      apply: async (event: NormalizedSyncEventInput) => {
        if (event.type === "test.transient") throw new Error("transient probe");
        durableEffects += 1;
        return { effectNumber: durableEffects };
      },
    } as unknown as SyncPilotService;
    const snapshots = {
      capture: async () => ({ source: "ordering-test" }),
    } as unknown as OperationalSnapshotService;
    const sync = new SyncService(serviceDatabase, pilot, snapshots);
    const aggregateId = randomUUID();
    const occupancyEpoch = randomUUID();
    const deviceId = randomUUID();
    const event = (sequence: number, overrides: Partial<OrderedSyncEventInput> = {}) => ({
      commandId: randomUUID(),
      actorId: actorA,
      deviceId,
      idempotencyKey: `ordered-${suffix}-${sequence}-${randomBytes(3).toString("hex")}`,
      type: "test.command",
      payload: { sequence },
      aggregate: { type: "tab", id: aggregateId },
      occupancyEpoch,
      resourceVersion: sequence - 1,
      aggregateSequence: sequence,
      occurredAt: new Date().toISOString(),
      ...overrides,
    });
    const batch = (events: ReturnType<typeof event>[]) => ({
      protocolVersion: 2 as const,
      hubVersion: "2.0.0",
      metadata: {},
      acknowledgedCommandIds: [],
      events,
    });

    const firstEvent = event(1);
    const first = await sync.synchronize(keyA, batch([firstEvent]));
    const replay = await sync.synchronize(keyA, batch([firstEvent]));
    assert.deepEqual(first.acceptedEventIds, [firstEvent.commandId]);
    assert.deepEqual(replay.acceptedEventIds, [firstEvent.commandId]);
    assert.equal(replay.eventResults[0]?.replayed, true);
    assert.deepEqual(replay.eventResults[0]?.result, first.eventResults[0]?.result);

    const divergent = await sync.synchronize(
      keyA,
      batch([
        event(1, {
          idempotencyKey: firstEvent.idempotencyKey,
          payload: { sequence: 1, divergent: true },
        }),
      ]),
    );
    assert.equal(divergent.rejectedEvents[0]?.code, "IDEMPOTENCY_KEY_REUSED");

    const thirdEvent = event(3);
    const gap = await sync.synchronize(keyA, batch([thirdEvent]));
    assert.equal(gap.rejectedEvents[0]?.code, "AGGREGATE_SEQUENCE_GAP");
    const secondEvent = event(2);
    assert.deepEqual((await sync.synchronize(keyA, batch([secondEvent]))).acceptedEventIds, [
      secondEvent.commandId,
    ]);
    const recovered = await sync.synchronize(keyA, batch([thirdEvent]));
    assert.deepEqual(recovered.acceptedEventIds, [thirdEvent.commandId]);
    assert.equal(recovered.eventResults[0]?.replayed, true);

    const duplicateSequence = event(2);
    const outOfOrder = await sync.synchronize(keyA, batch([duplicateSequence]));
    assert.equal(outOfOrder.rejectedEvents[0]?.code, "AGGREGATE_SEQUENCE_OUT_OF_ORDER");

    const transient = event(4, { type: "test.transient" });
    assert.equal(
      (await sync.synchronize(keyA, batch([transient]))).rejectedEvents[0]?.code,
      "COMMAND_RETRY_REQUIRED",
    );
    assert.equal(
      (
        await migrated.db
          .select()
          .from(commandInbox)
          .where(eq(commandInbox.commandId, transient.commandId))
      ).length,
      0,
    );
    assert.equal(
      (
        await migrated.db
          .select()
          .from(operationalCommands)
          .where(eq(operationalCommands.id, transient.commandId))
      ).length,
      0,
    );
    const fourthEvent = { ...transient, type: "test.command" };
    assert.deepEqual((await sync.synchronize(keyA, batch([fourthEvent]))).acceptedEventIds, [
      fourthEvent.commandId,
    ]);

    const tenantBEvent = event(1, {
      actorId: actorB,
      idempotencyKey: `tenant-b-${suffix}`,
    });
    assert.deepEqual((await sync.synchronize(keyB, batch([tenantBEvent]))).acceptedEventIds, [
      tenantBEvent.commandId,
    ]);

    const tenantARows = await serviceDatabase.withTenantContext(
      {
        source: "http",
        organizationId: organizationA,
        unitId: unitA,
        actorIdentityId: actorA,
      },
      (tx) => tx.select().from(commandInbox),
    );
    assert.equal(
      tenantARows.some((row) => row.commandId === tenantBEvent.commandId),
      false,
    );
    const withoutContext = await migrated.client.begin(async (tx) => {
      await tx.unsafe("set local role giromesa_app");
      return tx.unsafe("select command_id from command_inbox");
    });
    assert.equal(withoutContext.length, 0);
    await assert.rejects(() =>
      serviceDatabase.withTenantContext(
        {
          source: "http",
          organizationId: organizationA,
          unitId: unitA,
          actorIdentityId: actorA,
        },
        (tx) =>
          tx.insert(commandInbox).values({
            organizationId: organizationB,
            unitId: unitB,
            commandId: randomUUID(),
            idempotencyKey: `cross-tenant-${suffix}`,
            fingerprint: "a".repeat(64),
            actorIdentityId: actorB,
            deviceId,
            commandType: "test.command",
            aggregateType: "tab",
            aggregateId,
            occupancyEpoch,
            resourceVersion: 0,
            aggregateSequence: 99,
            occurredAt: new Date(),
            receivedAt: new Date(),
            payload: {},
            status: "rejected",
            result: { status: "rejected", code: "CROSS_TENANT_PROBE" },
          }),
      ),
    );

    const [state] = await migrated.db
      .select()
      .from(aggregateSequenceStates)
      .where(
        and(
          eq(aggregateSequenceStates.organizationId, organizationA),
          eq(aggregateSequenceStates.aggregateId, aggregateId),
          eq(aggregateSequenceStates.occupancyEpoch, occupancyEpoch),
        ),
      );
    assert.equal(state?.lastSequence, 4);
    const [quarantine] = await migrated.db
      .select()
      .from(commandQuarantine)
      .where(eq(commandQuarantine.commandId, thirdEvent.commandId));
    assert.equal(quarantine?.reason, "AGGREGATE_SEQUENCE_GAP");
    assert.equal(quarantine?.status, "recovered");
    assert.ok(quarantine?.recoveredAt);
    assert.equal(
      (
        await migrated.db
          .select()
          .from(outboxEvents)
          .where(eq(outboxEvents.organizationId, organizationA))
      ).length,
      4,
    );
    assert.equal(durableEffects, 5);

    const [security] = await migrated.client<
      {
        app_insert: boolean;
        force_rls: boolean;
        rls: boolean;
        worker_select: boolean;
      }[]
    >`
      select
        has_table_privilege('giromesa_app', 'command_inbox', 'insert') app_insert,
        has_table_privilege('giromesa_worker', 'command_inbox', 'select') worker_select,
        relrowsecurity rls,
        relforcerowsecurity force_rls
      from pg_class where oid = 'command_inbox'::regclass
    `;
    assert.deepEqual(security, {
      app_insert: true,
      worker_select: false,
      rls: true,
      force_rls: true,
    });
  } finally {
    if (database) await database.onModuleDestroy();
    await admin.unsafe(
      `select pg_terminate_backend(pid) from pg_stat_activity where datname = '${databaseName}'`,
    );
    await admin.unsafe(`drop database if exists "${databaseName}"`);
    await admin.end();
  }
});
