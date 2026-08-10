import assert from "node:assert/strict";
import { it } from "node:test";
import type { DatabaseService } from "../database/database.module.js";
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
