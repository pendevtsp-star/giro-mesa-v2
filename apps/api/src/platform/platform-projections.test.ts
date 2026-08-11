import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  maskPlatformEmail,
  paginatePlatformItems,
  sanitizePlatformAuditItem,
  sanitizePlatformIntegration,
} from "./platform-projections.js";

describe("platform projections", () => {
  it("masks identity email unless the caller has the dedicated PII permission", () => {
    assert.equal(maskPlatformEmail("person@example.com", false), "p***@example.com");
    assert.equal(maskPlatformEmail("person@example.com", true), "person@example.com");
  });

  it("never returns credential references or integration configuration", () => {
    assert.deepEqual(
      sanitizePlatformIntegration({
        id: "integration-1",
        unitId: "unit-1",
        provider: "adapter-name",
        status: "disabled",
        credentialReference: "vault://secret",
        config: { apiKey: "secret" },
        updatedAt: new Date("2026-08-11T12:00:00.000Z"),
      }),
      {
        id: "integration-1",
        unitId: "unit-1",
        provider: "adapter-name",
        status: "disabled",
        updatedAt: "2026-08-11T12:00:00.000Z",
      },
    );
  });

  it("returns a bounded opaque page and rejects malformed cursors", () => {
    const first = paginatePlatformItems(["a", "b", "c"], 2, undefined);
    assert.deepEqual(first.items, ["a", "b"]);
    assert.ok(first.nextCursor);
    assert.deepEqual(paginatePlatformItems(["a", "b", "c"], 2, first.nextCursor).items, ["c"]);
    assert.throws(() => paginatePlatformItems(["a"], 2, "not-a-cursor"), /INVALID_CURSOR/);
    assert.throws(() => paginatePlatformItems(["a"], 101, undefined), /INVALID_LIMIT/);
  });

  it("keeps audit projection structural and drops arbitrary metadata", () => {
    const item = sanitizePlatformAuditItem({
      id: "audit-1",
      action: "billing.changed",
      entityType: "subscription",
      entityId: "subscription-1",
      metadata: { token: "secret", before: { plan: "pro" } },
      occurredAt: new Date("2026-08-11T12:00:00.000Z"),
    });
    assert.deepEqual(item, {
      id: "audit-1",
      action: "billing.changed",
      entityType: "subscription",
      entityId: "subscription-1",
      occurredAt: "2026-08-11T12:00:00.000Z",
    });
  });
});
