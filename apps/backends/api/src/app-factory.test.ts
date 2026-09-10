import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { identities } from "@giromesa/db";
import { inArray } from "drizzle-orm";
import { createApplication, shouldExposeOpenApi } from "./app-factory.js";
import { AuthService } from "./auth/auth.service.js";
import { DatabaseService } from "./database/database.module.js";
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
