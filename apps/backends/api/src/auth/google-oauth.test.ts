import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  beginGoogleOAuth,
  consumeGoogleState,
  googleConfiguration,
  validateGoogleClaims,
} from "./google-oauth.js";

const config = googleConfiguration({
  GOOGLE_OAUTH_CLIENT_ID: "client.apps.googleusercontent.com",
  GOOGLE_OAUTH_CLIENT_SECRET: "secret",
  GOOGLE_OAUTH_REDIRECT_URI: "https://api.example.com/api/v1/auth/google/callback",
  SESSION_SECRET: "a".repeat(32),
});

describe("Google OAuth boundary", () => {
  it("binds state, nonce and PKCE to a short-lived signed cookie", () => {
    assert.ok(config);
    const flow = beginGoogleOAuth(
      "login",
      config,
      "/aceitar-convite?token=invite-token-abcdefghijklmnopqrstuvwxyz",
    );
    const authorization = new URL(flow.authorizationUrl);
    const state = consumeGoogleState(
      flow.stateCookie,
      authorization.searchParams.get("state") ?? undefined,
      config,
    );
    assert.equal(state?.intent, "login");
    assert.equal(state?.returnTo, "/aceitar-convite?token=invite-token-abcdefghijklmnopqrstuvwxyz");
    assert.equal(authorization.searchParams.get("nonce"), state?.nonce);
    assert.equal(authorization.searchParams.get("code_challenge_method"), "S256");
    assert.equal(consumeGoogleState(`${flow.stateCookie}x`, state?.state, config), null);
    assert.equal(
      consumeGoogleState(flow.stateCookie, state?.state, config, Date.now() + 11 * 60_000),
      null,
    );

    const platformFlow = beginGoogleOAuth(
      "login",
      config,
      "/aceitar-convite#platform=invite_token_abcdefghijklmnopqrstuvwxyz",
    );
    const platformAuthorization = new URL(platformFlow.authorizationUrl);
    assert.equal(
      consumeGoogleState(
        platformFlow.stateCookie,
        platformAuthorization.searchParams.get("state") ?? undefined,
        config,
      )?.returnTo,
      "/aceitar-convite#platform=invite_token_abcdefghijklmnopqrstuvwxyz",
    );
  });

  it("rejects unsafe return targets", () => {
    assert.ok(config);
    assert.throws(() => beginGoogleOAuth("login", config, "https://evil.example"));
    assert.throws(() => beginGoogleOAuth("login", config, "//evil.example"));
    assert.throws(() => beginGoogleOAuth("login", config, "/\\evil.example"));
  });

  it("accepts only a verified e-mail tied to the one-time nonce", () => {
    assert.deepEqual(
      validateGoogleClaims(
        {
          sub: "google-subject",
          email: " Owner@Example.com ",
          email_verified: true,
          nonce: "expected",
          name: " Owner ",
        },
        "expected",
      ),
      { subject: "google-subject", email: "owner@example.com", displayName: "Owner" },
    );
    assert.throws(() =>
      validateGoogleClaims(
        { sub: "subject", email: "owner@example.com", email_verified: false, nonce: "expected" },
        "expected",
      ),
    );
    assert.throws(() =>
      validateGoogleClaims(
        { sub: "subject", email: "owner@example.com", email_verified: true, nonce: "replayed" },
        "expected",
      ),
    );
  });
});
