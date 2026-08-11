import "reflect-metadata";
import { randomUUID } from "node:crypto";
import type { IncomingMessage } from "node:http";
import cookie from "@fastify/cookie";
import helmet from "@fastify/helmet";
import rateLimit from "@fastify/rate-limit";
import websocket from "@fastify/websocket";
import { MAX_SYNC_HTTP_BODY_BYTES } from "@giromesa/domain";
import { NestFactory } from "@nestjs/core";
import { FastifyAdapter, type NestFastifyApplication } from "@nestjs/platform-fastify";
import { DocumentBuilder, SwaggerModule } from "@nestjs/swagger";
import { AppModule } from "./app.module.js";
import { AuthService } from "./auth/auth.service.js";
import { SESSION_COOKIE_NAME } from "./auth/session-cookie.js";
import { configuredTrustProxy, corsConfiguration, isAllowedRealtimeOrigin } from "./common/cors.js";
import { addZodRequestBodies } from "./common/openapi-zod.js";
import { requestRateLimit } from "./common/rate-limit.js";
import { MetricsService } from "./health/health.module.js";
import { RealtimeService } from "./realtime/realtime.service.js";

export async function createApplication() {
  const adapter = new FastifyAdapter({
    trustProxy: configuredTrustProxy(),
    bodyLimit: MAX_SYNC_HTTP_BODY_BYTES,
    logger: { level: process.env.LOG_LEVEL ?? "info" },
    genReqId: (request: IncomingMessage) => {
      const supplied = request.headers["x-request-id"];
      return typeof supplied === "string" && /^[A-Za-z0-9._:-]{8,64}$/.test(supplied)
        ? supplied
        : randomUUID();
    },
  });
  const app = await NestFactory.create<NestFastifyApplication>(AppModule, adapter);
  await app.register(cookie);
  await app.register(helmet, { contentSecurityPolicy: false });
  await app.register(rateLimit, {
    max: (request) => requestRateLimit(request.method, request.url).max,
    keyGenerator: (request) =>
      `${request.ip}:${requestRateLimit(request.method, request.url).bucket}`,
    timeWindow: "1 minute",
  });
  await app.register(websocket, { options: { maxPayload: 16_384 } });
  app.enableShutdownHooks();
  app.enableCors(corsConfiguration());

  const fastify = app.getHttpAdapter().getInstance();
  const metrics = app.get(MetricsService);
  const requestStartedAt = new WeakMap<object, bigint>();
  fastify.addHook("onRequest", async (request, reply) => {
    requestStartedAt.set(request, metrics.begin());
    reply.header("x-request-id", request.id);
  });
  fastify.addHook("onResponse", async (request, reply) => {
    const startedAt = requestStartedAt.get(request);
    if (startedAt) {
      metrics.end(
        request.method,
        request.routeOptions.url ?? "unmatched",
        reply.statusCode,
        startedAt,
      );
    }
  });

  const document = SwaggerModule.createDocument(
    app,
    new DocumentBuilder()
      .setTitle("GiroMesa API")
      .setVersion("2.0.0")
      .addServer(process.env.API_URL ?? "http://localhost:3200", "Servidor da API")
      .addCookieAuth(SESSION_COOKIE_NAME)
      .addBearerAuth({ type: "http", scheme: "bearer", bearerFormat: "opaque" })
      .build(),
  );
  addZodRequestBodies(app, document);
  fastify.get("/api/v1/openapi.json", async () => document);
  fastify.get("/openapi.json", async () => document);

  const auth = app.get(AuthService);
  const realtime = app.get(RealtimeService);
  const realtimeHandler = async (
    socket: Parameters<typeof realtime.attach>[0],
    request: { headers: { origin?: string }; cookies: Record<string, string | undefined> },
  ) => {
    if (!isAllowedRealtimeOrigin(request.headers.origin)) {
      socket.close(1008, "Origem não autorizada");
      return;
    }
    const token = request.cookies[SESSION_COOKIE_NAME];
    const context = token ? await auth.authenticate(token) : null;
    if (!context) {
      socket.close(1008, "Sessão inválida");
      return;
    }
    realtime.attach(socket, context);
  };
  fastify.get("/api/v1/realtime", { websocket: true }, realtimeHandler);
  fastify.get("/v1/realtime", { websocket: true }, realtimeHandler);

  return { app, document };
}
