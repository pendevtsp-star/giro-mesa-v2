import assert from "node:assert/strict";
import { it } from "node:test";
import { isSensitiveAuthRequest, requestRateLimit } from "./rate-limit.js";

it("shares the stricter auth rate-limit bucket across public aliases", () => {
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

it("gives public mutations a separate bounded bucket", () => {
  assert.deepEqual(requestRateLimit("POST", "/public/v1/menus/demo/reservations"), {
    bucket: "public-write",
    max: 20,
  });
  assert.deepEqual(requestRateLimit("POST", "/api/v1/public/menus/demo/commands"), {
    bucket: "public-write",
    max: 20,
  });
  assert.equal(requestRateLimit("POST", "/public/v1/menus/demo/orders").max, 20);
  assert.equal(requestRateLimit("POST", "/public/v1/trial-applications").max, 20);
  assert.equal(requestRateLimit("POST", "/api/v1/public/contact").max, 20);
  assert.equal(requestRateLimit("GET", "/public/v1/menus/demo").max, 100);
});
