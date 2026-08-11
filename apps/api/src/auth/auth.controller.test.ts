import assert from "node:assert/strict";
import { it } from "node:test";
import type { FastifyReply } from "fastify";
import { AuthController } from "./auth.controller.js";
import type { AuthService } from "./auth.service.js";

it("keeps opaque browser session tokens confined to the HttpOnly cookie", async () => {
  const expiresAt = new Date("2026-08-10T12:00:00.000Z");
  const auth = {
    register: async () => ({
      accepted: true,
      email: "owner@example.com",
      verificationRequired: true,
    }),
    login: async () => ({
      token: "login-secret",
      expiresAt,
      identity: { id: "identity", email: "owner@example.com", displayName: "Owner" },
    }),
    verifyMfaChallenge: async () => ({
      token: "mfa-secret",
      expiresAt,
      identity: { id: "identity", email: "owner@example.com", displayName: "Owner" },
    }),
    verifyEmail: async () => ({
      status: "verified",
      token: "verification-secret",
      expiresAt,
      identity: { id: "identity", email: "owner@example.com", displayName: "Owner" },
    }),
  } as unknown as AuthService;
  const cookies: string[] = [];
  const reply = {
    setCookie: (_name: string, value: string) => {
      cookies.push(value);
    },
  } as unknown as FastifyReply;
  const controller = new AuthController(auth);

  const registration = await controller.register({
    email: "owner@example.com",
    password: "a-secure-password",
    displayName: "Owner",
  });

  const login = await controller.login(
    { email: "owner@example.com", password: "secret", trustedDevice: false },
    reply,
  );
  const mfa = await controller.verifyMfaChallenge(
    { challengeToken: "x".repeat(43), code: "123456" },
    reply,
  );
  const verification = await controller.verifyEmail({ token: "x".repeat(43) }, reply);

  assert.equal("token" in login, false);
  assert.equal("token" in mfa, false);
  assert.equal("token" in registration, false);
  assert.equal("token" in verification, false);
  assert.deepEqual(cookies, ["login-secret", "mfa-secret", "verification-secret"]);
});
