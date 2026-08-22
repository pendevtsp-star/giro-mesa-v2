import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  nextTerminalPinFailure,
  TERMINAL_LOCKOUT_MS,
  TERMINAL_MAX_FAILED_ATTEMPTS,
} from "./terminal-session.service.js";

describe("terminal PIN lockout", () => {
  it("locks exactly on the fifth failure inside the rolling window", () => {
    const now = new Date("2026-08-21T12:00:00.000Z");
    const result = nextTerminalPinFailure(
      TERMINAL_MAX_FAILED_ATTEMPTS - 1,
      new Date(now.getTime() - 60_000),
      now,
    );
    assert.equal(result.attempts, 5);
    assert.equal(result.lockedUntil?.getTime(), now.getTime() + TERMINAL_LOCKOUT_MS);
  });

  it("resets failures after the lockout window", () => {
    const now = new Date("2026-08-21T12:00:00.000Z");
    const result = nextTerminalPinFailure(
      4,
      new Date(now.getTime() - TERMINAL_LOCKOUT_MS - 1),
      now,
    );
    assert.equal(result.attempts, 1);
    assert.equal(result.failureWindowStartedAt, now);
    assert.equal(result.lockedUntil, null);
  });
});
