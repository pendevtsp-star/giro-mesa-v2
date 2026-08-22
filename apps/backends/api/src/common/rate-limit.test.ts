import assert from "node:assert/strict";
import { it } from "node:test";
import { isSensitiveAuthRequest, requestRateLimit, requestRateLimitKey } from "./rate-limit.js";

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

it("gives public mutations a separate bounded bucket", () => {
  assert.deepEqual(requestRateLimit("POST", "/public/v1/menus/unidade/reservations"), {
    bucket: "public-write",
    max: 20,
  });
  assert.deepEqual(requestRateLimit("POST", "/api/v1/public/menus/unidade/commands"), {
    bucket: "public-write",
    max: 20,
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

it("isolates analytical report reads by authenticated session without exposing its token", () => {
  const firstSession = requestRateLimitKey("reports-read", "10.0.0.1", "session-a");
  const sameSessionBehindAnotherIp = requestRateLimitKey("reports-read", "10.0.0.2", "session-a");

  assert.equal(firstSession, sameSessionBehindAnotherIp);
  assert.notEqual(firstSession, requestRateLimitKey("reports-read", "10.0.0.1", "session-b"));
  assert.equal(firstSession.includes("session-a"), false);
  assert.equal(requestRateLimitKey("auth", "10.0.0.1", "session-a"), "10.0.0.1:auth");
});
