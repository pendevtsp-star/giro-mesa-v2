import { authSessions, identities, outboxEvents } from "@giromesa/db";
import { Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from "@nestjs/common";
import { and, eq, gt, inArray, isNull } from "drizzle-orm";
import { z } from "zod";
import type { AuthContext } from "../auth/auth.service.js";
import { DatabaseService } from "../database/database.module.js";
import { ScopeService } from "../organizations/scope.service.js";

interface RealtimeSocket {
  readonly readyState: number;
  send(data: string): void;
  close(code?: number, reason?: string): void;
  on(event: "message" | "close" | "error", listener: (value?: unknown) => void): void;
}

interface RealtimeClient {
  socket: RealtimeSocket;
  identityId: string;
  sessionId: string;
  expiresAt: Date;
  organizationId?: string;
  unitId?: string;
  messageWindowStartedAt: number;
  messageCount: number;
}

const subscriptionSchema = z.object({
  type: z.literal("subscribe"),
  organizationId: z.string().uuid(),
  unitId: z.string().uuid(),
});

const REALTIME_OUTBOX_CHANNEL = "giromesa_realtime_outbox";
const REALTIME_OUTBOX_BATCH_SIZE = 200;
const outboxEventIdSchema = z.string().uuid();

@Injectable()
export class RealtimeService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RealtimeService.name);
  private readonly clients = new Set<RealtimeClient>();
  private authorizationTimer?: NodeJS.Timeout;
  private listenerReady = false;
  private readonly pendingEventIds = new Set<string>();
  private notificationScheduled = false;
  private notificationWork: Promise<void> = Promise.resolve();
  private unlisten?: () => Promise<void>;

  constructor(
    private readonly database: DatabaseService,
    private readonly scopes: ScopeService,
  ) {}

  async onModuleInit() {
    const listener = await this.database.client.listen(
      REALTIME_OUTBOX_CHANNEL,
      (eventId) => this.enqueueOutboxEvent(eventId),
      () => {
        if (this.listenerReady) this.invalidateSubscribedClients();
        this.listenerReady = true;
      },
    );
    this.unlisten = () => listener.unlisten();
    this.authorizationTimer = setInterval(() => void this.revalidateClients(), 30_000);
    this.authorizationTimer.unref();
  }

  async onModuleDestroy() {
    if (this.authorizationTimer) clearInterval(this.authorizationTimer);
    await this.unlisten?.();
    await this.notificationWork;
    for (const client of this.clients) client.socket.close(1001, "Servidor encerrando");
    this.clients.clear();
  }

  attach(socket: RealtimeSocket, auth: AuthContext) {
    const client: RealtimeClient = {
      socket,
      identityId: auth.identityId,
      sessionId: auth.sessionId,
      expiresAt: auth.expiresAt,
      messageWindowStartedAt: Date.now(),
      messageCount: 0,
    };
    this.clients.add(client);
    this.send(client, { type: "connected", protocolVersion: 1 });
    socket.on("message", (value) => void this.handleMessage(client, value));
    const detach = () => this.clients.delete(client);
    socket.on("close", detach);
    socket.on("error", detach);
  }

  publish(event: {
    organizationId: string;
    unitId: string;
    topic: string;
    aggregateType: string;
    aggregateId: string;
    payload: Record<string, unknown>;
    createdAt: Date;
  }) {
    for (const client of this.clients) {
      if (client.expiresAt <= new Date()) {
        this.disconnect(client, 1008, "Sessão expirada");
        continue;
      }
      if (client.organizationId !== event.organizationId || client.unitId !== event.unitId)
        continue;
      this.send(client, {
        type: "event",
        topic: event.topic,
        aggregateType: event.aggregateType,
        aggregateId: event.aggregateId,
        payload: event.payload,
        createdAt: event.createdAt.toISOString(),
      });
    }
  }

  private async handleMessage(client: RealtimeClient, raw: unknown) {
    if (!this.acceptMessage(client)) {
      this.disconnect(client, 1008, "Limite de mensagens excedido");
      return;
    }
    if (client.expiresAt <= new Date()) {
      this.disconnect(client, 1008, "Sessão expirada");
      return;
    }
    const text = Buffer.isBuffer(raw) ? raw.toString("utf8") : String(raw ?? "");
    if (Buffer.byteLength(text) > 16_384) {
      this.disconnect(client, 1009, "Mensagem muito grande");
      return;
    }
    const parsed = subscriptionSchema.safeParse(this.safeJson(text));
    if (!parsed.success) {
      this.send(client, { type: "error", code: "INVALID_REALTIME_MESSAGE" });
      return;
    }
    try {
      await this.scopes.requireUnitAccess(
        client.identityId,
        parsed.data.organizationId,
        parsed.data.unitId,
      );
      client.organizationId = parsed.data.organizationId;
      client.unitId = parsed.data.unitId;
      this.send(client, {
        type: "subscribed",
        organizationId: client.organizationId,
        unitId: client.unitId,
      });
    } catch {
      this.send(client, { type: "error", code: "REALTIME_SCOPE_DENIED" });
    }
  }

  private enqueueOutboxEvent(eventId: string) {
    const parsedEventId = outboxEventIdSchema.safeParse(eventId);
    if (!parsedEventId.success) return;
    this.pendingEventIds.add(parsedEventId.data);
    if (this.notificationScheduled) return;
    this.notificationScheduled = true;
    this.notificationWork = this.notificationWork
      .then(async () => {
        await new Promise<void>((resolve) => setImmediate(resolve));
        const eventIds = [...this.pendingEventIds];
        this.pendingEventIds.clear();
        this.notificationScheduled = false;
        await this.publishOutboxEvents(eventIds);
      })
      .catch((error) => {
        this.invalidateSubscribedClients();
        this.logger.error("Falha ao publicar evento realtime", error);
      });
  }

  private async publishOutboxEvents(eventIds: string[]) {
    if (this.clients.size === 0) return;
    for (let offset = 0; offset < eventIds.length; offset += REALTIME_OUTBOX_BATCH_SIZE) {
      const batch = eventIds.slice(offset, offset + REALTIME_OUTBOX_BATCH_SIZE);
      const events = await this.database.db
        .select({
          id: outboxEvents.id,
          topic: outboxEvents.topic,
          aggregateType: outboxEvents.aggregateType,
          aggregateId: outboxEvents.aggregateId,
          payload: outboxEvents.payload,
          createdAt: outboxEvents.createdAt,
        })
        .from(outboxEvents)
        .where(inArray(outboxEvents.id, batch));
      const eventsById = new Map(events.map((event) => [event.id, event]));
      for (const eventId of batch) {
        const event = eventsById.get(eventId);
        if (!event) continue;
        const organizationId = event.payload.organizationId;
        const unitId = event.payload.unitId;
        if (typeof organizationId !== "string" || typeof unitId !== "string") continue;
        this.publish({
          organizationId,
          unitId,
          topic: event.topic,
          aggregateType: event.aggregateType,
          aggregateId: event.aggregateId,
          payload: event.payload,
          createdAt: event.createdAt,
        });
      }
    }
  }

  private invalidateSubscribedClients() {
    const createdAt = new Date().toISOString();
    for (const client of this.clients) {
      if (client.expiresAt <= new Date()) {
        this.disconnect(client, 1008, "Sessão expirada");
        continue;
      }
      if (!client.organizationId || !client.unitId) continue;
      this.send(client, {
        type: "event",
        topic: "system.realtime_resync",
        aggregateType: "realtime",
        aggregateId: client.unitId,
        payload: { organizationId: client.organizationId, unitId: client.unitId },
        createdAt,
      });
    }
  }

  private send(client: RealtimeClient, value: Record<string, unknown>) {
    if (client.socket.readyState !== 1) return;
    try {
      client.socket.send(JSON.stringify(value));
    } catch {
      this.disconnect(client, 1011, "Falha de envio");
    }
  }

  private acceptMessage(client: RealtimeClient) {
    const now = Date.now();
    if (now - client.messageWindowStartedAt >= 60_000) {
      client.messageWindowStartedAt = now;
      client.messageCount = 0;
    }
    client.messageCount += 1;
    return client.messageCount <= 60;
  }

  private async revalidateClients() {
    for (const client of [...this.clients]) {
      if (client.expiresAt <= new Date()) {
        this.disconnect(client, 1008, "Sessão expirada");
        continue;
      }
      try {
        const [session] = await this.database.db
          .select({ id: authSessions.id })
          .from(authSessions)
          .innerJoin(identities, eq(identities.id, authSessions.identityId))
          .where(
            and(
              eq(authSessions.id, client.sessionId),
              eq(authSessions.identityId, client.identityId),
              isNull(authSessions.revokedAt),
              gt(authSessions.expiresAt, new Date()),
              isNull(identities.disabledAt),
            ),
          )
          .limit(1);
        if (!session) {
          this.disconnect(client, 1008, "Sessão inválida");
          continue;
        }
      } catch (error) {
        this.logger.error("Falha ao revalidar sessão realtime", error);
        this.disconnect(client, 1011, "Falha de autenticação");
        continue;
      }
      if (!client.organizationId || !client.unitId) continue;
      try {
        await this.scopes.requireUnitAccess(
          client.identityId,
          client.organizationId,
          client.unitId,
        );
      } catch {
        this.disconnect(client, 1008, "Escopo revogado");
      }
    }
  }

  private disconnect(client: RealtimeClient, code: number, reason: string) {
    this.clients.delete(client);
    client.socket.close(code, reason);
  }

  private safeJson(value: string): unknown {
    try {
      return JSON.parse(value);
    } catch {
      return null;
    }
  }
}
