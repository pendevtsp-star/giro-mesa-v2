import assert from "node:assert/strict";
import { createServer } from "node:http";
import { describe, it } from "node:test";
import {
  buildEmailVerificationRequest,
  consumeEmailVerificationFragment,
} from "./email-verification.ts";

describe("email verification browser boundary", () => {
  it("keeps the bearer token in the fragment, removes it immediately and never puts it in a request URL", () => {
    const token = "opaque-verification-token";
    const initial = `https://app.example.test/verificar-email?returnTo=%2Fonboarding#token=${token}`;
    const consumed = consumeEmailVerificationFragment(initial);

    assert.deepEqual(consumed, {
      token,
      sanitizedUrl: "/verificar-email?returnTo=%2Fonboarding",
    });
    assert.equal(new URL(initial).pathname, "/verificar-email");
    assert.equal(new URL(initial).search.includes(token), false);

    const request = buildEmailVerificationRequest("https://api.example.test", token);
    assert.equal(request.url, "https://api.example.test/v1/auth/email-verification/confirm");
    assert.equal(request.url.includes(token), false);
    assert.equal(request.init.referrerPolicy, "no-referrer");
    assert.deepEqual(JSON.parse(String(request.init.body)), { token });
  });

  it("does not accept a token from query parameters", () => {
    assert.deepEqual(
      consumeEmailVerificationFragment("https://app.example.test/verificar-email?token=query-leak"),
      { token: null, sanitizedUrl: "/verificar-email" },
    );
  });

  it("requires HTTPS for every non-loopback API endpoint", () => {
    assert.throws(
      () => buildEmailVerificationRequest("http://api.example.test", "opaque-token"),
      /HTTPS API endpoint/,
    );
    assert.doesNotThrow(() =>
      buildEmailVerificationRequest("http://127.0.0.1:3100", "opaque-token"),
    );
  });

  it("does not transmit the fragment in the initial document request", async () => {
    let requestUrl = "";
    let referrer = "";
    const server = createServer((request, response) => {
      requestUrl = request.url ?? "";
      referrer = request.headers.referer ?? "";
      response.writeHead(204).end();
    });
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", resolve);
    });
    try {
      const address = server.address();
      assert.ok(address && typeof address === "object");
      const token = "network-visible-secret";
      await fetch(`http://127.0.0.1:${address.port}/verificar-email#token=${token}`);
      assert.equal(requestUrl, "/verificar-email");
      assert.equal(requestUrl.includes(token), false);
      assert.equal(referrer.includes(token), false);
    } finally {
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    }
  });
});
