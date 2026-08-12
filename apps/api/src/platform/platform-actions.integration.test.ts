import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  actionRequestFingerprint,
  assertPlatformActionTransition,
  type PlatformActionSnapshot,
  parsePlatformActionInput,
  platformActionFromAuditEvents,
  platformActionTargetType,
} from "./platform-actions.js";

const pending: PlatformActionSnapshot = {
  id: "018f47a0-37f2-7d15-8c08-2b71d8415f11",
  organizationId: "018f47a0-37f2-7d15-8c08-2b71d8415f22",
  action: "tenant.suspend",
  targetType: "organization",
  targetId: "018f47a0-37f2-7d15-8c08-2b71d8415f22",
  requestedByIdentityId: "018f47a0-37f2-7d15-8c08-2b71d8415f33",
  justification: "Risco operacional confirmado pelo suporte.",
  payload: { expectedState: "active" },
  status: "pending",
  version: 1,
  requestedAt: "2026-08-11T11:00:00.000Z",
  expiresAt: "2026-08-11T11:30:00.000Z",
};

describe("platform action contract", () => {
  it("rejects extra or secret-bearing mutation payload fields", () => {
    assert.throws(
      () =>
        parsePlatformActionInput({
          action: "tenant.suspend",
          targetId: pending.organizationId,
          justification: pending.justification,
          payload: { expectedState: "active", apiKey: "should-never-be-accepted" },
        }),
      /INVALID_PLATFORM_ACTION/,
    );
  });

  it("accepts only explicit incident transitions with tenant-scoped unit context", () => {
    const incidentId = "018f47a0-37f2-7d15-8c08-2b71d8415f55";
    const unitId = "018f47a0-37f2-7d15-8c08-2b71d8415f66";
    const review = parsePlatformActionInput({
      action: "incident.review",
      targetId: incidentId,
      justification: pending.justification,
      payload: { expectedState: "reported", unitId },
    });
    assert.equal(platformActionTargetType(review.action), "incident");
    assert.deepEqual(review.payload, { expectedState: "reported", unitId });

    for (const request of [
      { action: "incident.approve", expectedState: "under_review" },
      { action: "incident.reject", expectedState: "under_review" },
      { action: "incident.close", expectedState: "approved" },
      { action: "incident.close", expectedState: "rejected" },
    ] as const) {
      assert.doesNotThrow(() =>
        parsePlatformActionInput({
          action: request.action,
          targetId: incidentId,
          justification: pending.justification,
          payload: { expectedState: request.expectedState, unitId },
        }),
      );
    }

    assert.throws(
      () =>
        parsePlatformActionInput({
          action: "incident.approve",
          targetId: incidentId,
          justification: pending.justification,
          payload: { expectedState: "reported", unitId },
        }),
      /INVALID_PLATFORM_ACTION/,
    );
    assert.throws(
      () =>
        parsePlatformActionInput({
          action: "incident.review",
          targetId: incidentId,
          justification: pending.justification,
          payload: { expectedState: "reported" },
        }),
      /INVALID_PLATFORM_ACTION/,
    );
  });

  it("derives a stable fingerprint without storing the idempotency key", () => {
    const request = parsePlatformActionInput({
      action: "tenant.suspend",
      targetId: pending.organizationId,
      justification: pending.justification,
      payload: { expectedState: "active" },
    });
    const left = actionRequestFingerprint(pending.organizationId, request);
    const right = actionRequestFingerprint(pending.organizationId, {
      ...request,
      justification: ` ${pending.justification} `,
    });
    assert.equal(left, right);
    assert.match(left, /^[0-9a-f]{64}$/);
  });

  it("blocks self-approval and stale concurrent approvals", () => {
    assert.throws(
      () =>
        assertPlatformActionTransition(pending, {
          command: "approve",
          actorIdentityId: pending.requestedByIdentityId,
          expectedVersion: 1,
          now: new Date("2026-08-11T11:10:00.000Z"),
        }),
      /DUAL_CONTROL_REQUIRED/,
    );
    assert.throws(
      () =>
        assertPlatformActionTransition(pending, {
          command: "approve",
          actorIdentityId: "018f47a0-37f2-7d15-8c08-2b71d8415f44",
          expectedVersion: 0,
          now: new Date("2026-08-11T11:10:00.000Z"),
        }),
      /PLATFORM_ACTION_VERSION_CONFLICT/,
    );
  });

  it("expires pending actions and keeps terminal actions exactly-once", () => {
    assert.throws(
      () =>
        assertPlatformActionTransition(pending, {
          command: "approve",
          actorIdentityId: "018f47a0-37f2-7d15-8c08-2b71d8415f44",
          expectedVersion: 1,
          now: new Date(pending.expiresAt),
        }),
      /PLATFORM_ACTION_EXPIRED/,
    );
    assert.throws(
      () =>
        assertPlatformActionTransition(
          { ...pending, status: "executed", version: 3 },
          {
            command: "approve",
            actorIdentityId: "018f47a0-37f2-7d15-8c08-2b71d8415f44",
            expectedVersion: 3,
            now: new Date("2026-08-11T11:10:00.000Z"),
          },
        ),
      /PLATFORM_ACTION_TERMINAL/,
    );
  });

  it("reconstructs an append-only proposal without exposing unknown metadata", () => {
    const snapshot = platformActionFromAuditEvents(pending.organizationId, pending.id, [
      {
        action: "platform.action.proposed",
        actorIdentityId: pending.requestedByIdentityId,
        occurredAt: new Date(pending.requestedAt),
        metadata: {
          version: 1,
          status: "pending",
          action: pending.action,
          targetType: pending.targetType,
          targetId: pending.targetId,
          justification: pending.justification,
          payload: pending.payload,
          expiresAt: pending.expiresAt,
          accidentalSecret: "must-not-surface",
        },
      },
      {
        action: "platform.action.approved",
        actorIdentityId: "018f47a0-37f2-7d15-8c08-2b71d8415f44",
        occurredAt: new Date("2026-08-11T11:09:00.000Z"),
        metadata: { version: 2, status: "approved" },
      },
      {
        action: "platform.action.executed",
        actorIdentityId: "018f47a0-37f2-7d15-8c08-2b71d8415f44",
        occurredAt: new Date("2026-08-11T11:10:00.000Z"),
        metadata: { version: 3, status: "executed", before: {}, after: {} },
      },
    ]);
    assert.equal(snapshot.status, "executed");
    assert.equal(snapshot.version, 3);
    assert.equal("accidentalSecret" in snapshot, false);
  });

  it("fails closed when execution is not preceded by an independent approval", () => {
    assert.throws(
      () =>
        platformActionFromAuditEvents(pending.organizationId, pending.id, [
          {
            action: "platform.action.proposed",
            actorIdentityId: pending.requestedByIdentityId,
            occurredAt: new Date(pending.requestedAt),
            metadata: {
              version: 1,
              status: "pending",
              action: pending.action,
              targetType: pending.targetType,
              targetId: pending.targetId,
              justification: pending.justification,
              payload: pending.payload,
              expiresAt: pending.expiresAt,
            },
          },
          {
            action: "platform.action.executed",
            actorIdentityId: pending.requestedByIdentityId,
            occurredAt: new Date("2026-08-11T11:09:00.000Z"),
            metadata: { version: 2, status: "executed" },
          },
        ]),
      /INVALID_ACTION_LEDGER/,
    );
  });

  it("fails closed when an event action disagrees with its ledger status", () => {
    assert.throws(
      () =>
        platformActionFromAuditEvents(pending.organizationId, pending.id, [
          {
            action: "platform.action.proposed",
            actorIdentityId: pending.requestedByIdentityId,
            occurredAt: new Date(pending.requestedAt),
            metadata: {
              version: 1,
              status: "pending",
              action: pending.action,
              targetType: pending.targetType,
              targetId: pending.targetId,
              justification: pending.justification,
              payload: pending.payload,
              expiresAt: pending.expiresAt,
            },
          },
          {
            action: "platform.action.rejected",
            actorIdentityId: "018f47a0-37f2-7d15-8c08-2b71d8415f44",
            occurredAt: new Date("2026-08-11T11:09:00.000Z"),
            metadata: { version: 2, status: "approved" },
          },
        ]),
      /INVALID_ACTION_LEDGER/,
    );
  });
});
