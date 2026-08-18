import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  clearSessionCookieOptions,
  SESSION_COOKIE_NAME,
  sessionCookieOptions,
} from "./session-cookie.js";

describe("browser session cookie", () => {
  it("is HttpOnly, Lax, root-scoped and follows the session expiration", () => {
    const previous = process.env.NODE_ENV;
    process.env.NODE_ENV = "production";
    try {
      const now = new Date("2026-08-10T00:00:00.000Z");
      const options = sessionCookieOptions(new Date("2026-08-10T12:00:00.000Z"), now);
      assert.equal(SESSION_COOKIE_NAME, "giromesa_session");
      assert.deepEqual(options, {
        httpOnly: true,
        secure: true,
        sameSite: "lax",
        path: "/",
        maxAge: 43_200,
      });
      assert.deepEqual(clearSessionCookieOptions(), {
        httpOnly: true,
        secure: true,
        sameSite: "lax",
        path: "/",
      });
    } finally {
      process.env.NODE_ENV = previous;
    }
  });
});
