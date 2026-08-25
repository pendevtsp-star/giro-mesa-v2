import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  tablePresenceCode,
  tablePresenceDate,
  verifyTablePresenceCode,
} from "./table-presence-code.js";

describe("table presence code", () => {
  it("rotates by the unit local date and compares a six digit code", () => {
    const beforeMidnight = new Date("2026-08-25T02:59:00.000Z");
    const afterMidnight = new Date("2026-08-25T03:01:00.000Z");
    assert.equal(tablePresenceDate(beforeMidnight, "America/Sao_Paulo"), "2026-08-24");
    assert.equal(tablePresenceDate(afterMidnight, "America/Sao_Paulo"), "2026-08-25");
    const first = tablePresenceCode("secret", "org", "unit", "America/Sao_Paulo", beforeMidnight);
    const second = tablePresenceCode("secret", "org", "unit", "America/Sao_Paulo", afterMidnight);
    assert.match(first, /^\d{6}$/);
    assert.notEqual(first, second);
    assert.equal(verifyTablePresenceCode(first, first), true);
    assert.equal(verifyTablePresenceCode(first, "000000"), false);
  });
});
