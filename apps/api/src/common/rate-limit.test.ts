import assert from "node:assert/strict";
import { it } from "node:test";
import {
  DOSECLUB_KEY_RATE_LIMIT,
  isSensitiveAuthRequest,
  requestRateLimit,
  requestRateLimitKey,
} from "./rate-limit.js";

it("normalizes sensitive auth endpoints across public aliases", () => {
  assert.equal(isSensitiveAuthRequest("/api/v1/auth/login"), true);
  assert.equal(isSensitiveAuthRequest("/v1/auth/mfa/challenge/verify?source=ops"), true);
  assert.equal(isSensitiveAuthRequest("/api/v1/auth/mfa/disable"), true);
  assert.equal(isSensitiveAuthRequest("/api/v1/auth/mfa/oauth/verify"), true);
  assert.equal(isSensitiveAuthRequest("/v1/auth/email-verification/request"), true);
  assert.equal(isSensitiveAuthRequest("/public/v1/auth/email-verification/confirm"), true);
  assert.equal(isSensitiveAuthRequest("/public/v1/auth/password-reset/request/"), true);
  assert.equal(isSensitiveAuthRequest("/api/v1/auth/me"), false);
  assert.equal(isSensitiveAuthRequest("/api/v1/operations/orders"), false);
});

it("isolates auth rate-limit buckets by endpoint class without weakening them", () => {
  assert.deepEqual(requestRateLimit("POST", "/api/v1/auth/email-verification/request"), {
    bucket: "auth:email-verification-request",
    max: 10,
  });
  assert.deepEqual(requestRateLimit("POST", "/v1/auth/register"), {
    bucket: "auth:register",
    max: 5,
  });
  assert.deepEqual(requestRateLimit("POST", "/public/v1/auth/login"), {
    bucket: "auth:login",
    max: 10,
  });
  assert.equal(
    requestRateLimit("POST", "/api/v1/auth/email-verification/request").bucket,
    requestRateLimit("POST", "/public/v1/auth/email-verification/request").bucket,
  );
  assert.notEqual(
    requestRateLimit("POST", "/v1/auth/email-verification/request").bucket,
    requestRateLimit("POST", "/v1/auth/register").bucket,
  );
});

it("gives public mutations a separate bounded bucket", () => {
  assert.deepEqual(requestRateLimit("POST", "/public/v1/menus/demo/reservations"), {
    bucket: "public-write",
    max: 20,
  });
  assert.equal(requestRateLimit("POST", "/api/v1/public/menus/demo/commands").max, 100);
  assert.equal(requestRateLimit("POST", "/public/v1/menus/demo/orders").max, 20);
  assert.equal(requestRateLimit("POST", "/public/v1/trial-applications").max, 20);
  assert.equal(requestRateLimit("POST", "/api/v1/public/contact").max, 20);
  assert.equal(requestRateLimit("GET", "/public/v1/menus/demo").max, 100);
  assert.deepEqual(requestRateLimit("POST", "/api/v1/integrations/club-whisky/dose-consumptions"), {
    bucket: "integration:doseclub",
    max: 6_000,
  });
  assert.deepEqual(requestRateLimit("GET", "/v1/integrations/club-whisky/branches"), {
    bucket: "integration:doseclub",
    max: 6_000,
  });
  assert.equal(DOSECLUB_KEY_RATE_LIMIT, 600);
});

it("isolates DoseClub tenants by opaque key while bounding malformed keys by IP", () => {
  const firstKey = `gm_${"a".repeat(48)}`;
  const secondKey = `gm_${"b".repeat(48)}`;
  const base = {
    method: "POST",
    url: "/api/v1/integrations/club-whisky/dose-consumptions",
    ip: "203.0.113.10",
  };
  const first = requestRateLimitKey({ ...base, integrationKey: firstKey });
  const firstAlias = requestRateLimitKey({
    ...base,
    url: "/v1/integrations/club-whisky/dose-consumptions",
    integrationKey: firstKey,
  });
  const second = requestRateLimitKey({ ...base, integrationKey: secondKey });
  assert.equal(first, firstAlias);
  assert.notEqual(first, second);
  assert.equal(first.includes(firstKey), false);
  assert.equal(
    requestRateLimitKey({ ...base, integrationKey: "short" }),
    "integration:doseclub:ip:203.0.113.10",
  );
  assert.equal(
    requestRateLimitKey({ ...base, integrationKey: [firstKey, secondKey] }),
    "integration:doseclub:ip:203.0.113.10",
  );
});
