import { authSessions, identities, outboxEvents } from "@giromesa/db";
import { Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from "@nestjs/common";
import { and, asc, eq, gt, isNull, or } from "drizzle-orm";
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

@Injectable()
export class RealtimeService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RealtimeService.name);
  private readonly clients = new Set<RealtimeClient>();
  private readonly startedAt = new Date();
  private lastCreatedAt = this.startedAt;
  private lastId = "00000000-0000-0000-0000-000000000000";
  private timer?: NodeJS.Timeout;
  private polling = false;
  private nextAuthorizationCheckAt = Date.now() + 30_000;

  constructor(
    private readonly database: DatabaseService,
    private readonly scopes: ScopeService,
  ) {}

  onModuleInit() {
    this.timer = setInterval(() => void this.pollOutbox(), 500);
    this.timer.unref();
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
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

  publishTableServiceCall(event: {
    organizationId: string;
    unitId: string;
    callId: string;
    tableId: string;
    occupancyEpoch: string;
    state: "received" | "routed" | "attended" | "canceled";
    routeSource: string;
  }) {
    this.publish({
      organizationId: event.organizationId,
      unitId: event.unitId,
      topic: `table_service_call.${event.state}`,
      aggregateType: "table_service_call",
      aggregateId: event.callId,
      payload: event,
      createdAt: new Date(),
    });
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

  private async pollOutbox() {
    if (this.polling || this.clients.size === 0) return;
    this.polling = true;
    try {
      if (Date.now() >= this.nextAuthorizationCheckAt) {
        await this.revalidateClients();
        this.nextAuthorizationCheckAt = Date.now() + 30_000;
      }
      if (this.clients.size === 0) return;
      const rows = await this.database.db
        .select({
          id: outboxEvents.id,
          topic: outboxEvents.topic,
          aggregateType: outboxEvents.aggregateType,
          aggregateId: outboxEvents.aggregateId,
          payload: outboxEvents.payload,
          createdAt: outboxEvents.createdAt,
        })
        .from(outboxEvents)
        .where(
          or(
            gt(outboxEvents.createdAt, this.lastCreatedAt),
            and(eq(outboxEvents.createdAt, this.lastCreatedAt), gt(outboxEvents.id, this.lastId)),
          ),
        )
        .orderBy(asc(outboxEvents.createdAt), asc(outboxEvents.id))
        .limit(200);
      for (const event of rows) {
        this.lastCreatedAt = event.createdAt;
        this.lastId = event.id;
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
    } catch (error) {
      this.logger.error("Falha ao ler eventos para realtime", error);
    } finally {
      this.polling = false;
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
