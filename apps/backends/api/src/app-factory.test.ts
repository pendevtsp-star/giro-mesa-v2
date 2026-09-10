import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { identities, organizations } from "@giromesa/db";
import { eq, inArray } from "drizzle-orm";
import { createApplication, shouldExposeOpenApi } from "./app-factory.js";
import { AuthService } from "./auth/auth.service.js";
import { SESSION_COOKIE_NAME } from "./auth/session-cookie.js";
import { DatabaseService } from "./database/database.module.js";
import { OrganizationsService } from "./organizations/organizations.service.js";
import {
  createTableSessionToken,
  TABLE_SESSION_COOKIE_NAME,
} from "./public-menu/table-session-token.js";

test("exposes OpenAPI only outside production", () => {
  assert.equal(shouldExposeOpenApi("development"), true);
  assert.equal(shouldExposeOpenApi("test"), true);
  assert.equal(shouldExposeOpenApi("production"), false);
});

test("boots the complete Nest application graph", async (context) => {
  if (!process.env.DATABASE_URL) {
    context.skip("DATABASE_URL not configured");
    return;
  }

  const { app, document } = await createApplication();
  assert.equal(document.paths["/api/v1/public/menus/{slug}"]?.get?.requestBody, undefined);
  assert.ok(document.paths["/api/v1/auth/register"]?.post?.requestBody);
  await app.close();
});

test("isolates operational limits by valid session while strict buckets remain IP based", async (context) => {
  if (!process.env.DATABASE_URL) {
    context.skip("DATABASE_URL not configured");
    return;
  }

  const { app } = await createApplication();
  await app.init();
  const auth = app.get(AuthService);
  const database = app.get(DatabaseService);
  const suffix = randomUUID();
  const operationalUrl = `/v1/organizations/${randomUUID()}/units/${randomUUID()}/pilot/tabs/open`;
  const publicTableUrl = "/public/v1/menus/rate-limit-probe/consumption";
  const registered = await Promise.all(
    ["a", "b"].map((label) =>
      auth.register({
        email: `rate-limit-${label}-${suffix}@example.invalid`,
        displayName: `Rate limit ${label}`,
        password: "Local-rate-limit-123!",
      }),
    ),
  );

  try {
    for (const session of registered) {
      for (let requestNumber = 0; requestNumber < 51; requestNumber += 1) {
        const response = await app.inject({
          method: "POST",
          url: operationalUrl,
          headers: { authorization: `Bearer ${session.token}` },
          payload: {},
        });
        assert.notEqual(response.statusCode, 429);
      }
    }

    for (let requestNumber = 0; requestNumber < 100; requestNumber += 1) {
      const response = await app.inject({
        method: "POST",
        url: operationalUrl,
        headers: { authorization: "Bearer invalid-random-credential" },
        payload: {},
      });
      assert.notEqual(response.statusCode, 429);
    }
    assert.equal(
      (
        await app.inject({
          method: "POST",
          url: operationalUrl,
          headers: { authorization: "Bearer invalid-random-credential" },
          payload: {},
        })
      ).statusCode,
      429,
    );

    const publicClaims = {
      slug: "rate-limit-probe",
      organizationId: randomUUID(),
      unitId: randomUUID(),
      tokenVersion: 1,
      exp: Math.floor(Date.now() / 1_000) + 3_600,
    };
    const tableSessions = [
      createTableSessionToken({ ...publicClaims, tableId: randomUUID() }),
      createTableSessionToken({ ...publicClaims, tableId: randomUUID() }),
    ];
    for (const token of tableSessions) {
      for (let requestNumber = 0; requestNumber < 61; requestNumber += 1) {
        const response = await app.inject({
          method: "GET",
          url: publicTableUrl,
          headers: { cookie: `${TABLE_SESSION_COOKIE_NAME}=${token}` },
        });
        assert.notEqual(response.statusCode, 429);
      }
    }
    for (let requestNumber = 0; requestNumber < 120; requestNumber += 1) {
      const response = await app.inject({
        method: "GET",
        url: publicTableUrl,
        headers: { cookie: `${TABLE_SESSION_COOKIE_NAME}=invalid-random-cookie` },
      });
      assert.notEqual(response.statusCode, 429);
    }
    assert.equal(
      (
        await app.inject({
          method: "GET",
          url: publicTableUrl,
          headers: { cookie: `${TABLE_SESSION_COOKIE_NAME}=invalid-random-cookie` },
        })
      ).statusCode,
      429,
    );

    for (let requestNumber = 0; requestNumber < 10; requestNumber += 1) {
      const response = await app.inject({ method: "POST", url: "/v1/auth/login", payload: {} });
      assert.notEqual(response.statusCode, 429);
    }
    assert.equal(
      (await app.inject({ method: "POST", url: "/v1/auth/login", payload: {} })).statusCode,
      429,
    );
  } finally {
    await database.db.delete(identities).where(
      inArray(
        identities.id,
        registered.map((session) => session.identity.id),
      ),
    );
    await app.close();
  }
});

async function expectImmediateRealtimeSubscription(options: {
  app: Awaited<ReturnType<typeof createApplication>>["app"];
  token: string;
  organizationId: string;
  unitId: string;
}) {
  const auth = options.app.get(AuthService);
  const originalAuthenticate = auth.authenticate.bind(auth);
  auth.authenticate = async (token) => {
    await new Promise((resolve) => setTimeout(resolve, 75));
    return originalAuthenticate(token);
  };
  const fastify = options.app.getHttpAdapter().getInstance();
  await fastify.ready();

  let resolveSubscription: () => void = () => {};
  let rejectSubscription: (error: Error) => void = () => {};
  const subscribed = new Promise<void>((resolve, reject) => {
    resolveSubscription = resolve;
    rejectSubscription = reject;
  });
  const timeout = setTimeout(
    () => rejectSubscription(new Error("Timed out waiting for immediate realtime subscription")),
    1_500,
  );
  timeout.unref();
  const socket = await fastify.injectWS(
    "/v1/realtime",
    {
      headers: {
        cookie: `${SESSION_COOKIE_NAME}=${options.token}`,
        origin: "http://localhost:3102",
      },
    },
    {
      onInit: (client) => {
        client.on("message", (raw: { toString(): string }) => {
          const message = JSON.parse(raw.toString()) as { type?: string };
          if (message.type === "subscribed") resolveSubscription();
        });
      },
      onOpen: (client) => {
        client.send(
          JSON.stringify({
            type: "subscribe",
            organizationId: options.organizationId,
            unitId: options.unitId,
          }),
        );
      },
    },
  );

  try {
    await subscribed;
  } finally {
    clearTimeout(timeout);
    socket.terminate();
  }
}

test("accepts an immediate realtime subscription after reconnecting to a restarted app", async (context) => {
  if (!process.env.DATABASE_URL) {
    context.skip("DATABASE_URL not configured");
    return;
  }

  const suffix = randomUUID();
  let activeApp: Awaited<ReturnType<typeof createApplication>>["app"] | undefined;
  let identityId: string | undefined;
  let organizationId: string | undefined;
  try {
    const first = await createApplication();
    activeApp = first.app;
    await activeApp.init();
    const registration = await activeApp.get(AuthService).register({
      email: `realtime-reconnect-${suffix}@example.invalid`,
      displayName: "Realtime reconnect",
      password: "Local-realtime-123!",
    });
    identityId = registration.identity.id;
    const fastify = activeApp.getHttpAdapter().getInstance();
    await fastify.ready();
    await assert.rejects(
      fastify.injectWS("/v1/realtime", {
        headers: {
          cookie: `${SESSION_COOKIE_NAME}=${registration.token}`,
          origin: "https://origin.invalid",
        },
      }),
      /Unexpected server response: 403/,
    );
    await assert.rejects(
      fastify.injectWS("/v1/realtime", {
        headers: {
          cookie: `${SESSION_COOKIE_NAME}=invalid-session-token`,
          origin: "http://localhost:3102",
        },
      }),
      /Unexpected server response: 401/,
    );
    const created = await activeApp.get(OrganizationsService).create(identityId, {
      legalName: "Realtime reconnect integration",
      tradeName: "Realtime reconnect",
      document: `RT${suffix.replaceAll("-", "").slice(0, 10).toUpperCase()}12`,
      unitName: "Unidade realtime",
      timezone: "America/Sao_Paulo",
    });
    organizationId = created.organization.id;
    const subscription = {
      app: activeApp,
      token: registration.token,
      organizationId,
      unitId: created.unit.id,
    };
    await expectImmediateRealtimeSubscription(subscription);

    await activeApp.close();
    activeApp = undefined;
    const restarted = await createApplication();
    activeApp = restarted.app;
    await activeApp.init();
    await expectImmediateRealtimeSubscription({ ...subscription, app: activeApp });
  } finally {
    if (activeApp) {
      const database = activeApp.get(DatabaseService);
      if (organizationId)
        await database.db.delete(organizations).where(eq(organizations.id, organizationId));
      if (identityId) await database.db.delete(identities).where(eq(identities.id, identityId));
      await activeApp.close();
    }
  }
});
