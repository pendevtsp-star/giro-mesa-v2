import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { describe, it } from "node:test";
import { processPrivacyRequest } from "./privacy.js";

describe("privacy worker event boundary", () => {
  it("rejects a payload whose tenant does not match the durable outbox envelope", async () => {
    const envelopeOrganizationId = randomUUID();
    const payloadOrganizationId = randomUUID();
    const requestId = randomUUID();

    await assert.rejects(
      () =>
        processPrivacyRequest({} as never, {
          topic: "privacy.request.processing",
          aggregate_type: "privacy_request",
          aggregate_id: `${requestId}:1`,
          organization_id: envelopeOrganizationId,
          unit_id: null,
          payload: { organizationId: payloadOrganizationId, requestId, attempt: 1 },
        }),
      (error: unknown) =>
        error instanceof Error && error.message === "PRIVACY_EVENT_CONTEXT_INVALID",
    );
  });

  it("rejects an aggregate mismatch before touching the database", async () => {
    const organizationId = randomUUID();
    const requestId = randomUUID();

    await assert.rejects(
      () =>
        processPrivacyRequest({} as never, {
          topic: "privacy.request.processing",
          aggregate_type: "privacy_request",
          aggregate_id: randomUUID(),
          organization_id: organizationId,
          unit_id: null,
          payload: { organizationId, requestId, attempt: 1 },
        }),
      (error: unknown) =>
        error instanceof Error && error.message === "PRIVACY_EVENT_CONTEXT_INVALID",
    );
  });
});
