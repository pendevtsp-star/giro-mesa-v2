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
import { and, eq, sql } from "drizzle-orm";
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
const fingerprintKey = (byte: number) => Buffer.alloc(32, byte).toString("base64url");

it("applies concurrent ordered commands effectively once with durable denials and tenant RLS", async (context) => {
  if (!integrationUrl) {
    context.skip("ORDERING_DATABASE_URL not configured");
    return;
  }

  const databaseName = `giromesa_ordering_${randomUUID().replaceAll("-", "")}`;
  const runtimeRole = `gm_runtime_${randomBytes(6).toString("hex")}`;
  const runtimePassword = randomBytes(24).toString("base64url");
  const admin = createDatabase(integrationUrl).client;
  const databaseUrl = new URL(integrationUrl);
  databaseUrl.pathname = `/${databaseName}`;
  const previousFingerprintVersion = process.env.COMMAND_FINGERPRINT_ACTIVE_KEY_VERSION;
  const previousFingerprintKeys = process.env.COMMAND_FINGERPRINT_KEYS;
  process.env.COMMAND_FINGERPRINT_ACTIVE_KEY_VERSION = "v1";
  process.env.COMMAND_FINGERPRINT_KEYS = JSON.stringify({ v1: fingerprintKey(1) });
  let database: DatabaseService | undefined;
  let migrated: ReturnType<typeof createDatabase> | undefined;
  let revoker: ReturnType<typeof createDatabase> | undefined;
  try {
    await admin.unsafe(`create database "${databaseName}"`);
    migrated = createDatabase(databaseUrl.toString(), { max: 4 });
    const migrationFiles = (await readdir(migrationsDirectory))
      .filter((file) => /^\d{4}_.*\.sql$/.test(file))
      .sort();
    assert.equal(migrationFiles.at(-1), "0012_clear_unicorn.sql");
    for (const file of migrationFiles) await applyMigration(migrated.client, file);

    await admin.unsafe(
      `create role "${runtimeRole}" login password '${runtimePassword}' noinherit nosuperuser nocreatedb nocreaterole noreplication nobypassrls`,
    );
    await admin.unsafe(`grant giromesa_app, giromesa_internal to "${runtimeRole}"`);
    const runtimeDatabaseUrl = new URL(databaseUrl);
    runtimeDatabaseUrl.username = runtimeRole;
    runtimeDatabaseUrl.password = runtimePassword;
    database = new DatabaseService(createDatabase(runtimeDatabaseUrl.toString(), { max: 4 }));
    const serviceDatabase = database;
    const [runtimeAttributes] = await serviceDatabase.client<
      { current_user: string; rolbypassrls: boolean; rolinherit: boolean; rolsuper: boolean }[]
    >`
      select current_user, rolinherit, rolbypassrls, rolsuper
      from pg_roles where rolname = current_user
    `;
    assert.deepEqual(runtimeAttributes, {
      current_user: runtimeRole,
      rolbypassrls: false,
      rolinherit: false,
      rolsuper: false,
    });
    const suffix = randomBytes(8).toString("hex");
    const organizationA = randomUUID();
    const organizationB = randomUUID();
    const unitA = randomUUID();
    const unitA2 = randomUUID();
    const unitB = randomUUID();
    const actorA = randomUUID();
    const actorB = randomUUID();
    const membershipA = randomUUID();
    const membershipB = randomUUID();
    const hubA = randomUUID();
    const hubB = randomUUID();
    const deviceA = randomUUID();
    const deviceB = randomUUID();
    const crossUnitDevice = randomUUID();
    const revokedDevice = randomUUID();
    const raceDevice = randomUUID();
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
      values
        (${unitA}, ${organizationA}, 'Unit A'),
        (${unitA2}, ${organizationA}, 'Unit A2'),
        (${unitB}, ${organizationB}, 'Unit B')
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
      insert into device_enrollments
        (id, organization_id, unit_id, label, sync_key_hash, revoked_at)
      values
        (${hubA}, ${organizationA}, ${unitA}, 'Hub A', ${hash(keyA)}, null),
        (${hubB}, ${organizationB}, ${unitB}, 'Hub B', ${hash(keyB)}, null),
        (${deviceA}, ${organizationA}, ${unitA}, 'Terminal A', null, null),
        (${deviceB}, ${organizationB}, ${unitB}, 'Terminal B', null, null),
        (${crossUnitDevice}, ${organizationA}, ${unitA2}, 'Terminal A2', null, null),
        (${revokedDevice}, ${organizationA}, ${unitA}, 'Revoked A', null, now()),
        (${raceDevice}, ${organizationA}, ${unitA}, 'Race Terminal A', null, null)
    `;
    const runtimeContext = await serviceDatabase.withTenantContext(
      {
        source: "internal",
        organizationId: organizationA,
        unitId: unitA,
        actorIdentityId: null,
      },
      async (tx) => {
        const roles = await tx.execute<{
          current_user: string;
          internal_member: boolean;
          session_user: string;
        }>(sql`
          select
            current_user,
            session_user,
            pg_has_role(session_user, 'giromesa_internal', 'member') internal_member
        `);
        return [...roles][0];
      },
    );
    assert.deepEqual(runtimeContext, {
      current_user: "giromesa_app",
      internal_member: true,
      session_user: runtimeRole,
    });

    let signalPilotEntered!: () => void;
    let releasePilot!: () => void;
    const pilotEntered = new Promise<void>((resolve) => {
      signalPilotEntered = resolve;
    });
    const pilotRelease = new Promise<void>((resolve) => {
      releasePilot = resolve;
    });
    let durableEffects = 0;
    const pilot = {
      apply: async (event: NormalizedSyncEventInput) => {
        if (event.type === "test.transient") throw new Error("transient probe");
        if (event.type === "test.revoke-race") {
          signalPilotEntered();
          await pilotRelease;
        }
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
    const event = (sequence: number, overrides: Partial<OrderedSyncEventInput> = {}) => ({
      commandId: randomUUID(),
      actorId: actorA,
      deviceId: deviceA,
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

    const firstEvent = event(1, { payload: { sequence: 1, approval: { pin: "1234" } } });
    const first = await sync.synchronize(keyA, batch([firstEvent]));
    const thirdEvent = event(3);
    assert.equal(
      (await sync.synchronize(keyA, batch([thirdEvent]))).rejectedEvents[0]?.code,
      "AGGREGATE_SEQUENCE_GAP",
    );
    const [v1GapReceipt] = await migrated.db
      .select()
      .from(commandInbox)
      .where(eq(commandInbox.commandId, thirdEvent.commandId));
    assert.equal(v1GapReceipt?.fingerprintKeyVersion, "v1");
    assert.equal(v1GapReceipt?.status, "quarantined");
    process.env.COMMAND_FINGERPRINT_ACTIVE_KEY_VERSION = "v2";
    process.env.COMMAND_FINGERPRINT_KEYS = JSON.stringify({
      v1: fingerprintKey(1),
      v2: fingerprintKey(2),
    });
    const replay = await sync.synchronize(keyA, batch([firstEvent]));
    assert.deepEqual(first.acceptedEventIds, [firstEvent.commandId]);
    assert.deepEqual(replay.acceptedEventIds, [firstEvent.commandId]);
    assert.equal(replay.eventResults[0]?.replayed, true);
    assert.deepEqual(replay.eventResults[0]?.result, first.eventResults[0]?.result);
    const [firstReceipt] = await migrated.db
      .select()
      .from(commandInbox)
      .where(
        and(
          eq(commandInbox.organizationId, organizationA),
          eq(commandInbox.commandId, firstEvent.commandId),
        ),
      );
    assert.equal(firstReceipt?.fingerprintKeyVersion, "v1");
    assert.equal(JSON.stringify(firstReceipt?.payload).includes("1234"), false);

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

    const secondEvent = event(2);
    assert.deepEqual((await sync.synchronize(keyA, batch([secondEvent]))).acceptedEventIds, [
      secondEvent.commandId,
    ]);
    const recovered = await sync.synchronize(keyA, batch([thirdEvent]));
    assert.deepEqual(recovered.acceptedEventIds, [thirdEvent.commandId]);
    assert.equal(recovered.eventResults[0]?.replayed, true);
    const [recoveredV1Receipt] = await migrated.db
      .select()
      .from(commandInbox)
      .where(eq(commandInbox.commandId, thirdEvent.commandId));
    assert.equal(recoveredV1Receipt?.fingerprintKeyVersion, "v1");
    assert.equal(recoveredV1Receipt?.fingerprint, v1GapReceipt?.fingerprint);
    assert.equal(recoveredV1Receipt?.status, "applied");
    assert.equal(
      (
        await migrated.db
          .select()
          .from(outboxEvents)
          .where(eq(outboxEvents.sourceCommandId, thirdEvent.commandId))
      ).length,
      1,
    );
    const stableRecoveredReplay = await sync.synchronize(keyA, batch([thirdEvent]));
    assert.deepEqual(
      stableRecoveredReplay.eventResults[0]?.result,
      recovered.eventResults[0]?.result,
    );
    assert.equal(stableRecoveredReplay.eventResults[0]?.replayed, true);
    const duplicateSequence = event(2);
    assert.equal(
      (await sync.synchronize(keyA, batch([duplicateSequence]))).rejectedEvents[0]?.code,
      "AGGREGATE_SEQUENCE_OUT_OF_ORDER",
    );

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
    const fourthEvent = { ...transient, type: "test.command" };
    assert.deepEqual((await sync.synchronize(keyA, batch([fourthEvent]))).acceptedEventIds, [
      fourthEvent.commandId,
    ]);

    const actorDenied = event(5, { actorId: actorB });
    const actorDeniedConcurrent = await Promise.all([
      sync.synchronize(keyA, batch([actorDenied])),
      sync.synchronize(keyA, batch([actorDenied])),
    ]);
    assert.deepEqual(
      actorDeniedConcurrent.map((result) => result.rejectedEvents[0]?.code),
      ["ACTOR_SCOPE_DENIED", "ACTOR_SCOPE_DENIED"],
    );
    assert.deepEqual(
      actorDeniedConcurrent.map((result) => result.eventResults[0]?.replayed).sort(),
      [false, true],
    );
    const membershipActorBAtA = randomUUID();
    await migrated.client`
      insert into memberships (id, identity_id, organization_id, status)
      values (${membershipActorBAtA}, ${actorB}, ${organizationA}, 'active')
    `;
    await migrated.client`
      insert into role_bindings (membership_id, role) values (${membershipActorBAtA}, 'owner')
    `;
    const actorReplayAfterGrant = await sync.synchronize(keyA, batch([actorDenied]));
    assert.equal(actorReplayAfterGrant.rejectedEvents[0]?.code, "ACTOR_SCOPE_DENIED");
    assert.equal(actorReplayAfterGrant.eventResults[0]?.replayed, true);
    const actorDivergentAfterGrant = await sync.synchronize(
      keyA,
      batch([
        event(5, {
          idempotencyKey: actorDenied.idempotencyKey,
          payload: { sequence: 5, divergent: true },
        }),
      ]),
    );
    assert.equal(actorDivergentAfterGrant.rejectedEvents[0]?.code, "IDEMPOTENCY_KEY_REUSED");

    const unregistered = event(6, { deviceId: randomUUID() });
    const crossUnit = event(7, { deviceId: crossUnitDevice });
    const revoked = event(8, { deviceId: revokedDevice });
    assert.equal(
      (await sync.synchronize(keyA, batch([unregistered]))).rejectedEvents[0]?.code,
      "DEVICE_NOT_ENROLLED",
    );
    assert.equal(
      (await sync.synchronize(keyA, batch([crossUnit]))).rejectedEvents[0]?.code,
      "DEVICE_SCOPE_DENIED",
    );
    assert.equal(
      (await sync.synchronize(keyA, batch([revoked]))).rejectedEvents[0]?.code,
      "DEVICE_REVOKED",
    );

    const identicalNine = event(9);
    const identicalResults = await Promise.all([
      sync.synchronize(keyA, batch([identicalNine])),
      sync.synchronize(keyA, batch([identicalNine])),
    ]);
    assert.equal(
      identicalResults.every((result) => result.acceptedEventIds.length === 1),
      true,
    );
    assert.deepEqual(identicalResults.map((result) => result.eventResults[0]?.replayed).sort(), [
      false,
      true,
    ]);

    const sharedKey = `concurrent-divergent-${suffix}`;
    const divergentTenA = event(10, { idempotencyKey: sharedKey, payload: { winner: "a" } });
    const divergentTenB = event(10, { idempotencyKey: sharedKey, payload: { winner: "b" } });
    const divergentConcurrent = await Promise.all([
      sync.synchronize(keyA, batch([divergentTenA])),
      sync.synchronize(keyA, batch([divergentTenB])),
    ]);
    assert.equal(
      divergentConcurrent.filter((result) => result.acceptedEventIds.length === 1).length,
      1,
    );
    assert.equal(
      divergentConcurrent.filter(
        (result) => result.rejectedEvents[0]?.code === "IDEMPOTENCY_KEY_REUSED",
      ).length,
      1,
    );

    const competingElevenA = event(11);
    const competingElevenB = event(11);
    const competingConcurrent = await Promise.all([
      sync.synchronize(keyA, batch([competingElevenA])),
      sync.synchronize(keyA, batch([competingElevenB])),
    ]);
    assert.equal(
      competingConcurrent.filter((result) => result.acceptedEventIds.length === 1).length,
      1,
    );
    assert.equal(
      competingConcurrent.filter(
        (result) => result.rejectedEvents[0]?.code === "AGGREGATE_SEQUENCE_OUT_OF_ORDER",
      ).length,
      1,
    );

    const tenantBEvent = event(1, {
      commandId: firstEvent.commandId,
      actorId: actorB,
      deviceId: deviceB,
      idempotencyKey: `tenant-b-${suffix}`,
    });
    assert.deepEqual((await sync.synchronize(keyB, batch([tenantBEvent]))).acceptedEventIds, [
      tenantBEvent.commandId,
    ]);
    const sameCommandRows = await migrated.db
      .select()
      .from(operationalCommands)
      .where(eq(operationalCommands.id, firstEvent.commandId));
    assert.equal(sameCommandRows.length, 2);
    assert.deepEqual(
      sameCommandRows.map((row) => row.organizationId).sort(),
      [organizationA, organizationB].sort(),
    );

    const deniedGap = event(13, { actorId: randomUUID() });
    const deniedGapResult = await sync.synchronize(keyA, batch([deniedGap]));
    assert.equal(deniedGapResult.rejectedEvents[0]?.code, "AGGREGATE_SEQUENCE_GAP");
    const [deniedGapReceipt] = await migrated.db
      .select()
      .from(commandInbox)
      .where(eq(commandInbox.commandId, deniedGap.commandId));
    assert.equal(deniedGapReceipt?.fingerprintKeyVersion, "v2");
    assert.equal(deniedGapReceipt?.preconditionCode, "ACTOR_SCOPE_DENIED");
    process.env.COMMAND_FINGERPRINT_ACTIVE_KEY_VERSION = "v3";
    process.env.COMMAND_FINGERPRINT_KEYS = JSON.stringify({
      v1: fingerprintKey(1),
      v2: fingerprintKey(2),
      v3: fingerprintKey(3),
    });
    const twelfthEvent = event(12);
    assert.deepEqual((await sync.synchronize(keyA, batch([twelfthEvent]))).acceptedEventIds, [
      twelfthEvent.commandId,
    ]);
    const deniedGapRecovered = await sync.synchronize(keyA, batch([deniedGap]));
    assert.equal(deniedGapRecovered.rejectedEvents[0]?.code, "ACTOR_SCOPE_DENIED");
    assert.equal(deniedGapRecovered.eventResults[0]?.replayed, true);
    const [deniedGapRecoveredReceipt] = await migrated.db
      .select()
      .from(commandInbox)
      .where(eq(commandInbox.commandId, deniedGap.commandId));
    assert.equal(deniedGapRecoveredReceipt?.fingerprintKeyVersion, "v2");
    assert.equal(deniedGapRecoveredReceipt?.fingerprint, deniedGapReceipt?.fingerprint);
    assert.equal(deniedGapRecoveredReceipt?.status, "rejected");
    const [deniedQuarantine] = await migrated.db
      .select()
      .from(commandQuarantine)
      .where(eq(commandQuarantine.commandId, deniedGap.commandId));
    assert.equal(deniedQuarantine?.status, "recovered");
    assert.deepEqual(
      (await sync.synchronize(keyA, batch([deniedGap]))).eventResults[0]?.result,
      deniedGapRecovered.eventResults[0]?.result,
    );

    const revokeRaceEvent = event(14, { deviceId: raceDevice, type: "test.revoke-race" });
    const commandDuringRevocation = sync.synchronize(keyA, batch([revokeRaceEvent]));
    await pilotEntered;
    revoker = createDatabase(databaseUrl.toString(), { max: 1 });
    const revokerConnection = revoker;
    const [revokerBackend] = await revokerConnection.client<
      { pid: number }[]
    >`select pg_backend_pid() pid`;
    assert.ok(revokerBackend);
    const revocation = (async () =>
      revokerConnection.client`
        update device_enrollments set revoked_at = now() where id = ${raceDevice}
      `)();
    let revocationWaitedOnLock = false;
    for (let attempt = 0; attempt < 50; attempt += 1) {
      const [activity] = await admin<
        { wait_event_type: string | null }[]
      >`select wait_event_type from pg_stat_activity where pid = ${revokerBackend.pid}`;
      if (activity?.wait_event_type === "Lock") {
        revocationWaitedOnLock = true;
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    assert.equal(revocationWaitedOnLock, true);
    releasePilot();
    assert.deepEqual((await commandDuringRevocation).acceptedEventIds, [revokeRaceEvent.commandId]);
    await revocation;
    const afterRevocation = event(15, { deviceId: raceDevice });
    assert.equal(
      (await sync.synchronize(keyA, batch([afterRevocation]))).rejectedEvents[0]?.code,
      "DEVICE_REVOKED",
    );
    assert.equal(
      (
        await migrated.db
          .select()
          .from(outboxEvents)
          .where(eq(outboxEvents.sourceCommandId, afterRevocation.commandId))
      ).length,
      0,
    );
    assert.equal(
      (
        await migrated.db
          .select()
          .from(operationalCommands)
          .where(eq(operationalCommands.id, afterRevocation.commandId))
      ).length,
      0,
    );

    for (const scope of [
      { organizationId: organizationA, unitId: unitA, actorIdentityId: actorA },
      { organizationId: organizationB, unitId: unitB, actorIdentityId: actorB },
    ]) {
      const scoped = await serviceDatabase.withTenantContext(
        { source: "http", ...scope },
        async (tx) => ({
          inbox: await tx.select().from(commandInbox),
          states: await tx.select().from(aggregateSequenceStates),
          quarantine: await tx.select().from(commandQuarantine),
        }),
      );
      assert.equal(
        scoped.inbox.every((row) => row.organizationId === scope.organizationId),
        true,
      );
      assert.equal(
        scoped.states.every((row) => row.organizationId === scope.organizationId),
        true,
      );
      assert.equal(
        scoped.quarantine.every((row) => row.organizationId === scope.organizationId),
        true,
      );
      if (scope.organizationId === organizationB) assert.equal(scoped.quarantine.length, 0);
    }
    const withoutContext = await migrated.client.begin(async (tx) => {
      await tx.unsafe("set local role giromesa_app");
      return Promise.all([
        tx.unsafe("select command_id from command_inbox"),
        tx.unsafe("select aggregate_id from aggregate_sequence_states"),
        tx.unsafe("select command_id from command_quarantine"),
      ]);
    });
    assert.deepEqual(
      withoutContext.map((rows) => rows.length),
      [0, 0, 0],
    );
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
            fingerprintKeyVersion: "v2",
            fingerprint: "a".repeat(64),
            actorIdentityId: actorB,
            deviceId: deviceB,
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
    await assert.rejects(() =>
      serviceDatabase.withTenantContext(
        {
          source: "http",
          organizationId: organizationA,
          unitId: unitA,
          actorIdentityId: actorA,
        },
        (tx) =>
          tx.insert(aggregateSequenceStates).values({
            organizationId: organizationB,
            unitId: unitB,
            aggregateType: "tab",
            aggregateId: randomUUID(),
            occupancyEpoch: randomUUID(),
            lastSequence: 1,
            resourceVersion: 0,
            lastCommandId: randomUUID(),
          }),
      ),
    );
    await assert.rejects(() =>
      serviceDatabase.withTenantContext(
        {
          source: "http",
          organizationId: organizationA,
          unitId: unitA,
          actorIdentityId: actorA,
        },
        (tx) =>
          tx.insert(commandQuarantine).values({
            organizationId: organizationB,
            unitId: unitB,
            commandId: tenantBEvent.commandId,
            reason: "CROSS_TENANT_PROBE",
            evidence: {},
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
    assert.equal(state?.lastSequence, 15);
    const [gapReceipt] = await migrated.db
      .select()
      .from(commandQuarantine)
      .where(eq(commandQuarantine.commandId, thirdEvent.commandId));
    assert.equal(gapReceipt?.reason, "AGGREGATE_SEQUENCE_GAP");
    assert.equal(gapReceipt?.status, "recovered");
    assert.ok(gapReceipt?.recoveredAt);
    const [actorReceipt] = await migrated.db
      .select()
      .from(commandInbox)
      .where(eq(commandInbox.commandId, actorDenied.commandId));
    assert.equal(actorReceipt?.preconditionCode, "ACTOR_SCOPE_DENIED");
    assert.equal(actorReceipt?.status, "rejected");
    assert.equal(
      (
        await migrated.db
          .select()
          .from(outboxEvents)
          .where(eq(outboxEvents.organizationId, organizationA))
      ).length,
      9,
    );
    assert.equal(durableEffects, 10);

    const security = await migrated.client<
      {
        app_delete: boolean;
        app_insert: boolean;
        app_select: boolean;
        app_update: boolean;
        force_rls: boolean;
        internal_select: boolean;
        rls: boolean;
        table_name: string;
        worker_select: boolean;
      }[]
    >`
      select
        relname table_name,
        has_table_privilege('giromesa_app', oid, 'select') app_select,
        has_table_privilege('giromesa_app', oid, 'insert') app_insert,
        has_table_privilege('giromesa_app', oid, 'update') app_update,
        has_table_privilege('giromesa_app', oid, 'delete') app_delete,
        has_table_privilege('giromesa_worker', oid, 'select') worker_select,
        has_table_privilege('giromesa_internal', oid, 'select') internal_select,
        relrowsecurity rls,
        relforcerowsecurity force_rls
      from pg_class
      where relname in ('command_inbox', 'aggregate_sequence_states', 'command_quarantine')
      order by relname
    `;
    assert.equal(security.length, 3);
    for (const table of security) {
      assert.deepEqual(
        {
          appDelete: table.app_delete,
          appInsert: table.app_insert,
          appSelect: table.app_select,
          appUpdate: table.app_update,
          forceRls: table.force_rls,
          internalSelect: table.internal_select,
          rls: table.rls,
          workerSelect: table.worker_select,
        },
        {
          appDelete: false,
          appInsert: true,
          appSelect: true,
          appUpdate: true,
          forceRls: true,
          internalSelect: false,
          rls: true,
          workerSelect: false,
        },
        table.table_name,
      );
    }
    const [functionSecurity] = await migrated.client<
      {
        app_actor_execute: boolean;
        app_device_execute: boolean;
        app_hub_execute: boolean;
        internal_actor_execute: boolean;
        internal_device_execute: boolean;
        internal_hub_execute: boolean;
      }[]
    >`
      select
        has_function_privilege('giromesa_app', 'giromesa_resolve_sync_hub(text)', 'execute') app_hub_execute,
        has_function_privilege('giromesa_app', 'giromesa_lock_command_device(uuid)', 'execute') app_device_execute,
        has_function_privilege('giromesa_app', 'giromesa_lock_command_actor(uuid,uuid,uuid)', 'execute') app_actor_execute,
        has_function_privilege('giromesa_internal', 'giromesa_resolve_sync_hub(text)', 'execute') internal_hub_execute,
        has_function_privilege('giromesa_internal', 'giromesa_lock_command_device(uuid)', 'execute') internal_device_execute,
        has_function_privilege('giromesa_internal', 'giromesa_lock_command_actor(uuid,uuid,uuid)', 'execute') internal_actor_execute
    `;
    assert.deepEqual(functionSecurity, {
      app_actor_execute: false,
      app_device_execute: false,
      app_hub_execute: false,
      internal_actor_execute: true,
      internal_device_execute: true,
      internal_hub_execute: true,
    });
  } finally {
    if (previousFingerprintVersion === undefined)
      delete process.env.COMMAND_FINGERPRINT_ACTIVE_KEY_VERSION;
    else process.env.COMMAND_FINGERPRINT_ACTIVE_KEY_VERSION = previousFingerprintVersion;
    if (previousFingerprintKeys === undefined) delete process.env.COMMAND_FINGERPRINT_KEYS;
    else process.env.COMMAND_FINGERPRINT_KEYS = previousFingerprintKeys;
    if (database) await database.onModuleDestroy();
    if (revoker) await revoker.client.end();
    if (migrated) await migrated.client.end();
    await admin.unsafe(
      `select pg_terminate_backend(pid) from pg_stat_activity where datname = '${databaseName}'`,
    );
    await admin.unsafe(`drop database if exists "${databaseName}"`);
    await admin.unsafe(`drop role if exists "${runtimeRole}"`);
    await admin.end();
  }
});
