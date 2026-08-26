import assert from "node:assert/strict";
import test from "node:test";
import { isVisitorConsent, visitorTrackingDecision } from "./visitor-consent.ts";

test("só permite identificador comercial após consentimento explícito", () => {
  assert.equal(visitorTrackingDecision("accepted"), "create");
  assert.equal(visitorTrackingDecision("rejected"), "clear");
  assert.equal(visitorTrackingDecision(undefined), "clear");
  assert.equal(visitorTrackingDecision("valor-inválido"), "clear");
});

test("aceita somente escolhas explícitas de cookies", () => {
  assert.equal(isVisitorConsent("accepted"), true);
  assert.equal(isVisitorConsent("rejected"), true);
  assert.equal(isVisitorConsent("aceitar"), false);
  assert.equal(isVisitorConsent(null), false);
});
