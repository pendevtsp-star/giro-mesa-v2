import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { retryDelaySeconds } from "./outbox.js";

describe("outbox retry", () => {
  it("backs off exponentially with a bounded delay", () => {
    assert.equal(retryDelaySeconds(0), 1);
    assert.equal(retryDelaySeconds(3), 8);
    assert.equal(retryDelaySeconds(99), 1_024);
  });
});
