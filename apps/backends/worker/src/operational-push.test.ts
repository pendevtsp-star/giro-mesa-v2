import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { operationalPushFailureDisposition, operationalPushMessage } from "./operational-push.js";

describe("operational web push", () => {
  it("classifies provider failures without retrying expired endpoints", () => {
    assert.equal(operationalPushFailureDisposition(410), "expired");
    assert.equal(operationalPushFailureDisposition(429), "retry");
    assert.equal(operationalPushFailureDisposition(503), "retry");
    assert.equal(operationalPushFailureDisposition(403), "configuration");
    assert.equal(operationalPushFailureDisposition(400), "disable");
  });

  it("builds a short operational payload without customer data", () => {
    const message = operationalPushMessage(
      "35dcbe12-c491-4b21-a4b0-8c36f47f7cab",
      "Mesa 12",
      "bill",
    );
    assert.deepEqual(message, {
      title: "Mesa 12 pediu a conta",
      body: "Abra a Central Operacional para assumir o chamado.",
      tag: "call:35dcbe12-c491-4b21-a4b0-8c36f47f7cab",
      route: "#/counter",
    });
    assert.equal(JSON.stringify(message).includes("customer"), false);
  });
});
