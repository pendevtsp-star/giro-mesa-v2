import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  maskPlatformEmail,
  paginatePlatformItems,
  sanitizePlatformAuditItem,
  sanitizePlatformIncident,
  sanitizePlatformIntegration,
  sanitizePlatformLead,
  sanitizePlatformSupportRequest,
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

  it("projects global leads with PII masked and no synthetic workflow", () => {
    const input = {
      id: "lead-1",
      name: "Marina Lopes",
      email: "marina@example.com",
      phone: "+5511998765432",
      businessName: "Bar Horizonte",
      segment: "bar",
      planSlug: "pro",
      consentedAt: new Date("2026-08-11T11:59:00.000Z"),
      createdAt: new Date("2026-08-11T12:00:00.000Z"),
    };

    assert.deepEqual(sanitizePlatformLead(input, false), {
      id: "lead-1",
      displayName: "M***",
      email: "m***@example.com",
      phone: "**********5432",
      businessName: "Bar Horizonte",
      segment: "bar",
      planSlug: "pro",
      submittedAt: "2026-08-11T12:00:00.000Z",
      actionAvailability: "unavailable",
      actionReasonCode: "LEAD_WORKFLOW_NOT_AVAILABLE",
    });
    assert.equal(sanitizePlatformLead(input, true).displayName, "Marina Lopes");
    assert.equal(sanitizePlatformLead(input, true).phone, "+5511998765432");
  });

  it("projects global support requests without returning free-form messages", () => {
    const projection = sanitizePlatformSupportRequest(
      {
        id: "support-1",
        name: "Rafael Lima",
        email: "rafael@example.com",
        phone: "+5511987654321",
        message: "Token acidental que nunca pode atravessar a projection.",
        consentedAt: new Date("2026-08-11T11:59:00.000Z"),
        createdAt: new Date("2026-08-11T12:00:00.000Z"),
      },
      false,
    );

    assert.deepEqual(projection, {
      id: "support-1",
      displayName: "R***",
      email: "r***@example.com",
      phone: "**********4321",
      submittedAt: "2026-08-11T12:00:00.000Z",
      actionAvailability: "unavailable",
      actionReasonCode: "SUPPORT_WORKFLOW_NOT_AVAILABLE",
    });
    assert.equal("message" in projection, false);
  });

  it("projects incidents without evidence or idempotency internals and exposes only valid next actions", () => {
    const projection = sanitizePlatformIncident({
      id: "incident-1",
      organizationId: "organization-1",
      unitId: "unit-1",
      incidentType: "inventory_variance",
      status: "under_review",
      neutralSummary: "Diferença neutra confirmada na contagem.",
      evidence: [{ secret: "must-not-surface" }],
      amountCents: 1290,
      payrollAction: false,
      idempotencyKey: "hidden",
      requestHash: "hidden",
      reporterIdentityId: "reporter-1",
      approverIdentityId: null,
      occurredAt: new Date("2026-08-11T12:00:00.000Z"),
      updatedAt: new Date("2026-08-11T12:05:00.000Z"),
    });

    assert.deepEqual(projection, {
      id: "incident-1",
      organizationId: "organization-1",
      unitId: "unit-1",
      incidentType: "inventory_variance",
      status: "under_review",
      neutralSummary: "Diferença neutra confirmada na contagem.",
      amountCents: 1290,
      reporterIdentityId: "reporter-1",
      approverIdentityId: null,
      occurredAt: "2026-08-11T12:00:00.000Z",
      updatedAt: "2026-08-11T12:05:00.000Z",
      availableActions: ["incident.approve", "incident.reject"],
    });
    assert.equal("evidence" in projection, false);
    assert.equal("idempotencyKey" in projection, false);
  });
});
