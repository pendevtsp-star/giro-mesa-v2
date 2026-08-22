import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { type ExecutionContext, UnauthorizedException } from "@nestjs/common";
import type { AuthService } from "./auth.service.js";
import { SessionGuard, sessionToken, terminalRequestAllowed } from "./session.guard.js";

const auth = {
  identityId: "identity-id",
  email: "owner@example.com",
  displayName: "Owner",
  sessionId: "session-id",
  expiresAt: new Date("2030-01-01T00:00:00.000Z"),
};

function contextFor(request: Record<string, unknown>) {
  return {
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext;
}

describe("SessionGuard", () => {
  it("accepts the HttpOnly cookie when Bearer is absent", async () => {
    let received = "";
    const service = {
      authenticate: async (token: string) => {
        received = token;
        return auth;
      },
    } as AuthService;
    const request: {
      headers: Record<string, string>;
      cookies: Record<string, string>;
      auth?: typeof auth;
    } = { headers: {}, cookies: { giromesa_session: "cookie-token" } };
    assert.equal(await new SessionGuard(service).canActivate(contextFor(request)), true);
    assert.equal(received, "cookie-token");
    assert.deepEqual(request.auth, auth);
  });

  it("accepts Bearer for native clients and rejects ambiguous malformed headers", async () => {
    assert.equal(
      sessionToken("Bearer native-token", { giromesa_session: "cookie-token" }),
      "native-token",
    );
    assert.equal(sessionToken("Basic invalid", { giromesa_session: "cookie-token" }), null);
    const service = { authenticate: async () => auth } as unknown as AuthService;
    await assert.rejects(
      () =>
        new SessionGuard(service).canActivate(
          contextFor({ headers: { authorization: "Basic invalid" }, cookies: {} }),
        ),
      UnauthorizedException,
    );
  });
});

describe("terminal request boundary", () => {
  const terminalAuth = {
    ...auth,
    authKind: "terminal" as const,
    organizationId: "org-1",
    unitId: "unit-1",
    actorEpoch: 3,
  };

  it("allows only operational pilot resources in the fixed scope", () => {
    assert.equal(
      terminalRequestAllowed(
        "POST",
        "/v1/organizations/org-1/units/unit-1/pilot/tabs/tab-1/items",
        terminalAuth,
      ),
      true,
    );
    assert.equal(
      terminalRequestAllowed(
        "GET",
        "/v1/organizations/org-1/units/unit-2/pilot/tabs",
        terminalAuth,
      ),
      false,
    );
  });

  it("denies administrative and approval-secret routes", () => {
    assert.equal(
      terminalRequestAllowed(
        "PUT",
        "/v1/organizations/org-1/units/unit-1/pilot/manager-pin",
        terminalAuth,
      ),
      false,
    );
    assert.equal(
      terminalRequestAllowed(
        "GET",
        "/v1/organizations/org-1/units/unit-1/management/people",
        terminalAuth,
      ),
      false,
    );
  });
});
