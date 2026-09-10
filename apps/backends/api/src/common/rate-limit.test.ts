import assert from "node:assert/strict";
import { it } from "node:test";
import {
  createTableSessionToken,
  verifyTableSessionToken,
} from "../public-menu/table-session-token.js";
import {
  isSensitiveAuthRequest,
  publicTableRateLimitSlug,
  requestRateLimit,
  requestRateLimitKey,
  validatedRequestRateLimitKey,
} from "./rate-limit.js";

it("shares the stricter auth rate-limit bucket across public aliases", () => {
  assert.equal(isSensitiveAuthRequest("/api/v1/auth/login"), true);
  assert.equal(isSensitiveAuthRequest("/v1/auth/mfa/challenge/verify?source=ops"), true);
  assert.equal(isSensitiveAuthRequest("/api/v1/auth/mfa/disable"), true);
  assert.equal(isSensitiveAuthRequest("/api/v1/auth/mfa/oauth/verify"), true);
  assert.equal(isSensitiveAuthRequest("/api/v1/auth/terminal-session/unlock"), true);
  assert.equal(requestRateLimit("POST", "/api/v1/auth/terminal-session/unlock").max, 10);
  assert.equal(isSensitiveAuthRequest("/public/v1/auth/password-reset/request/"), true);
  assert.equal(isSensitiveAuthRequest("/api/v1/auth/me"), false);
  assert.equal(isSensitiveAuthRequest("/api/v1/operations/orders"), false);
});

it("isolates the Evolution Go webhook from the generic write bucket", () => {
  assert.deepEqual(requestRateLimit("POST", "/v1/growth/evolution-go/webhook"), {
    bucket: "evolution-webhook",
    max: 300,
  });
});

it("limits Edge Hub pairing attempts independently", () => {
  assert.deepEqual(requestRateLimit("POST", "/api/v1/device/edge-hub-pairings/redeem"), {
    bucket: "edge-hub-pairing",
    max: 10,
  });
});

it("gives public mutations a separate bounded bucket", () => {
  assert.deepEqual(requestRateLimit("POST", "/public/v1/menus/unidade/reservations"), {
    bucket: "public-write",
    max: 20,
  });
  assert.deepEqual(requestRateLimit("POST", "/api/v1/public/menus/unidade/commands"), {
    bucket: "public-table-write",
    max: 30,
  });
  assert.deepEqual(requestRateLimit("POST", "/public/v1/menus/unidade/table-orders"), {
    bucket: "public-table-write",
    max: 30,
  });
  assert.deepEqual(requestRateLimit("POST", "/public/v1/menus/unidade/table-session"), {
    bucket: "public-table-session",
    max: 10,
  });
  assert.deepEqual(requestRateLimit("GET", "/public/v1/menus/unidade/table-orders/order-id"), {
    bucket: "public-table-read",
    max: 120,
  });
  assert.equal(requestRateLimit("POST", "/public/v1/menus/unidade/orders").max, 20);
  assert.equal(requestRateLimit("POST", "/public/v1/trial-applications").max, 20);
  assert.equal(requestRateLimit("POST", "/api/v1/public/contact").max, 20);
  assert.equal(requestRateLimit("GET", "/public/v1/menus/unidade").max, 600);
});

it("keeps reports independent from other operational reads", () => {
  assert.deepEqual(
    requestRateLimit(
      "GET",
      "/api/v1/organizations/org-1/units/unit-1/management/reports?from=2026-08-01&to=2026-08-17",
    ),
    { bucket: "reports-read", max: 120 },
  );
  assert.deepEqual(
    requestRateLimit("GET", "/api/v1/organizations/org-1/units/unit-1/management/reports/views"),
    { bucket: "api-read", max: 600 },
  );
  assert.deepEqual(requestRateLimit("GET", "/v1/organizations/org-1/units/unit-1/management"), {
    bucket: "api-read",
    max: 600,
  });
  assert.deepEqual(requestRateLimit("POST", "/v1/organizations/org-1/units/unit-1/orders"), {
    bucket: "api-write",
    max: 100,
  });
});

it("isolates operational requests by a previously validated session without exposing its token", () => {
  const firstSession = requestRateLimitKey("reports-read", "10.0.0.1", "session-a");
  const sameSessionBehindAnotherIp = requestRateLimitKey("reports-read", "10.0.0.2", "session-a");

  assert.equal(firstSession, sameSessionBehindAnotherIp);
  assert.notEqual(firstSession, requestRateLimitKey("reports-read", "10.0.0.1", "session-b"));
  assert.equal(firstSession.includes("session-a"), false);
  assert.equal(requestRateLimitKey("auth", "10.0.0.1", "session-a"), "10.0.0.1:auth");
});

it("keeps session creation, authentication and invalid credentials in strict IP buckets", async () => {
  const authenticate = async (credential: string) => credential === "valid-session";
  assert.equal(
    await validatedRequestRateLimitKey({
      bucket: "public-table-session",
      ip: "10.0.0.1",
      credential: "arbitrary-table-cookie",
      authenticate,
    }),
    "10.0.0.1:public-table-session",
  );
  assert.equal(
    await validatedRequestRateLimitKey({
      bucket: "auth",
      ip: "10.0.0.1",
      credential: "valid-session",
      authenticate,
    }),
    "10.0.0.1:auth",
  );
  assert.equal(
    await validatedRequestRateLimitKey({
      bucket: "api-write",
      ip: "10.0.0.1",
      credential: "random-invalid-token",
      authenticate,
    }),
    "10.0.0.1:api-write",
  );
  assert.notEqual(
    await validatedRequestRateLimitKey({
      bucket: "api-write",
      ip: "10.0.0.1",
      credential: "valid-session",
      authenticate,
    }),
    "10.0.0.1:api-write",
  );
});

it("isolates only signed, unexpired table sessions behind a shared restaurant network", async () => {
  const secret = "rate-limit-table-session-secret-at-least-32-bytes";
  const claims = {
    slug: "unidade-rate-limit",
    organizationId: "10000000-0000-4000-8000-000000000001",
    unitId: "10000000-0000-4000-8000-000000000002",
    tokenVersion: 1,
    exp: 2_000_000_000,
  };
  const firstToken = createTableSessionToken(
    { ...claims, tableId: "10000000-0000-4000-8000-000000000003" },
    secret,
  );
  const secondToken = createTableSessionToken(
    { ...claims, tableId: "10000000-0000-4000-8000-000000000004" },
    secret,
  );
  const authenticate = async (credential: string) =>
    Boolean(verifyTableSessionToken(credential, claims.slug, secret, 1_900_000_000));
  const firstKey = await validatedRequestRateLimitKey({
    bucket: "public-table-read",
    ip: "10.0.0.1",
    credential: firstToken,
    authenticate,
  });

  assert.notEqual(firstKey, "10.0.0.1:public-table-read");
  assert.notEqual(
    firstKey,
    await validatedRequestRateLimitKey({
      bucket: "public-table-read",
      ip: "10.0.0.1",
      credential: secondToken,
      authenticate,
    }),
  );
  assert.equal(
    await validatedRequestRateLimitKey({
      bucket: "public-table-read",
      ip: "10.0.0.1",
      credential: "random-invalid-cookie",
      authenticate,
    }),
    "10.0.0.1:public-table-read",
  );
  assert.equal(
    publicTableRateLimitSlug("/api/v1/public/menus/unidade-rate-limit/table-orders/123"),
    claims.slug,
  );
  assert.equal(
    publicTableRateLimitSlug("/public/v1/menus/unidade-rate-limit/table-session"),
    claims.slug,
  );
  assert.deepEqual(requestRateLimit("GET", "/public/v1/menus/unidade-rate-limit/table-session"), {
    bucket: "public-table-read",
    max: 120,
  });
});
