import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { it } from "node:test";
import { outboxEvents } from "@giromesa/db";
import { inArray, sql } from "drizzle-orm";
import { DatabaseService } from "../database/database.module.js";
import type { ScopeService } from "../organizations/scope.service.js";
import { RealtimeService } from "./realtime.service.js";

class FakeSocket {
  readonly readyState = 1;
  readonly sent: string[] = [];
  readonly closed: Array<{ code?: number; reason?: string }> = [];
  private readonly listeners = new Map<string, (value?: unknown) => void>();

  send(value: string) {
    this.sent.push(value);
  }

  close(code?: number, reason?: string) {
    this.closed.push({ code, reason });
  }

  on(event: "message" | "close" | "error", listener: (value?: unknown) => void) {
    this.listeners.set(event, listener);
  }

  emitMessage(value: Record<string, unknown>) {
    this.listeners.get("message")?.(Buffer.from(JSON.stringify(value)));
  }
}

async function waitFor(predicate: () => boolean, timeoutMs = 2_000) {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error("Timed out waiting for realtime notification");
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

it("broadcasts realtime events only to the subscribed tenant unit", async () => {
  const scopes = {
    requireUnitAccess: async () => ({ membershipId: "membership", role: "owner" }),
  } as unknown as ScopeService;
  const service = new RealtimeService({} as DatabaseService, scopes);
  const first = new FakeSocket();
  const second = new FakeSocket();
  const organizationA = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  const organizationB = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
  const unitA = "11111111-1111-4111-8111-111111111111";
  const unitB = "22222222-2222-4222-8222-222222222222";
  const expiresAt = new Date(Date.now() + 60_000);
  service.attach(first, {
    identityId: "identity-a",
    sessionId: "session-a",
    email: "a@example.com",
    displayName: "A",
    expiresAt,
  });
  service.attach(second, {
    identityId: "identity-b",
    sessionId: "session-b",
    email: "b@example.com",
    displayName: "B",
    expiresAt,
  });
  first.emitMessage({ type: "subscribe", organizationId: organizationA, unitId: unitA });
  second.emitMessage({ type: "subscribe", organizationId: organizationB, unitId: unitB });
  await new Promise((resolve) => setImmediate(resolve));

  service.publish({
    organizationId: organizationA,
    unitId: unitA,
    topic: "pos.order.updated",
    aggregateType: "order",
    aggregateId: "order-1",
    payload: { organizationId: organizationA, unitId: unitA },
    createdAt: new Date("2026-08-09T00:00:00.000Z"),
  });

  assert.equal(
    first.sent.some((value) => JSON.parse(value).type === "event"),
    true,
  );
  assert.equal(
    second.sent.some((value) => JSON.parse(value).type === "event"),
    false,
  );
});

it("never publishes after the authenticated session expires", () => {
  const service = new RealtimeService({} as DatabaseService, {} as ScopeService);
  const socket = new FakeSocket();
  service.attach(socket, {
    identityId: "identity-a",
    sessionId: "session-a",
    email: "a@example.com",
    displayName: "A",
    expiresAt: new Date(0),
  });

  service.publish({
    organizationId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    unitId: "11111111-1111-4111-8111-111111111111",
    topic: "pos.order.updated",
    aggregateType: "order",
    aggregateId: "order-1",
    payload: {},
    createdAt: new Date(),
  });

  assert.deepEqual(socket.closed, [{ code: 1008, reason: "Sessão expirada" }]);
});

it("publishes committed outbox events once even when created_at and commit order differ", async (context) => {
  const databaseUrl = process.env.PILOT_DATABASE_URL;
  if (!databaseUrl) {
    context.skip("PILOT_DATABASE_URL not configured");
    return;
  }
  const previousDatabaseUrl = process.env.DATABASE_URL;
  process.env.DATABASE_URL = databaseUrl;
  const database = new DatabaseService();
  const organizationId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  const unitId = "11111111-1111-4111-8111-111111111111";
  const firstEventId = randomUUID();
  const secondEventId = randomUUID();
  const topicSuffix = randomUUID();
  const firstTopic = `realtime.commit_order_test.first.${topicSuffix}`;
  const secondTopic = `realtime.commit_order_test.second.${topicSuffix}`;
  const timestampPrefix = new Date(Date.now() + 5_000).toISOString().slice(0, 19);
  const firstCreatedAt = `${timestampPrefix}.100194Z`;
  const secondCreatedAt = `${timestampPrefix}.200918Z`;
  let releaseFirstTransaction: () => void = () => {};
  let firstTransaction: Promise<unknown> | undefined;
  let service: RealtimeService | undefined;
  try {
    const scopes = {
      requireUnitAccess: async () => ({ membershipId: "membership", role: "owner" }),
    } as unknown as ScopeService;
    service = new RealtimeService(database, scopes);
    await service.onModuleInit();
    const socket = new FakeSocket();
    service.attach(socket, {
      identityId: "identity-a",
      sessionId: "session-a",
      email: "a@example.com",
      displayName: "A",
      expiresAt: new Date(Date.now() + 60_000),
    });
    socket.emitMessage({ type: "subscribe", organizationId, unitId });
    await new Promise((resolve) => setImmediate(resolve));
    let markFirstInserted: () => void = () => {};
    const firstInserted = new Promise<void>((resolve) => {
      markFirstInserted = resolve;
    });
    const holdFirstTransaction = new Promise<void>((resolve) => {
      releaseFirstTransaction = resolve;
    });
    firstTransaction = database.db.transaction(async (transaction) => {
      await transaction.execute(sql`
        insert into ${outboxEvents} (id, topic, aggregate_type, aggregate_id, payload, created_at)
        values (
          ${firstEventId}, ${firstTopic}, 'test', ${firstEventId},
          jsonb_build_object(
            'organizationId', ${organizationId}::text,
            'unitId', ${unitId}::text
          ),
          ${firstCreatedAt}::timestamptz
        )
      `);
      markFirstInserted();
      await holdFirstTransaction;
    });
    await firstInserted;
    await database.db.execute(sql`
      insert into ${outboxEvents} (id, topic, aggregate_type, aggregate_id, payload, created_at)
      values (
        ${secondEventId}, ${secondTopic}, 'test', ${secondEventId},
        jsonb_build_object(
          'organizationId', ${organizationId}::text,
          'unitId', ${unitId}::text
        ),
        ${secondCreatedAt}::timestamptz
      )
    `);

    const publishedTopics = () =>
      socket.sent
        .map((value) => JSON.parse(value) as { topic?: string })
        .flatMap((message) => (message.topic?.includes(topicSuffix) ? [message.topic] : []));
    await waitFor(() => publishedTopics().length === 1);
    assert.deepEqual(publishedTopics(), [secondTopic]);

    releaseFirstTransaction();
    await firstTransaction;
    await waitFor(() => publishedTopics().length === 2);
    assert.deepEqual(publishedTopics(), [secondTopic, firstTopic]);
  } finally {
    releaseFirstTransaction();
    await firstTransaction?.catch(() => undefined);
    await database.db
      .delete(outboxEvents)
      .where(inArray(outboxEvents.id, [firstEventId, secondEventId]));
    await service?.onModuleDestroy();
    await database.onModuleDestroy();
    if (previousDatabaseUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = previousDatabaseUrl;
  }
});
