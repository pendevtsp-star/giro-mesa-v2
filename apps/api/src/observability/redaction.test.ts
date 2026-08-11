import assert from "node:assert/strict";
import { it } from "node:test";
import {
  CardinalityGuard,
  redactTelemetryAttributes,
  type TelemetryAttributes,
} from "@giromesa/observability";

const organizationId = "a1111111-1111-4111-8111-111111111111";
const otherOrganizationId = "a2222222-2222-4222-8222-222222222222";
const unitId = "b1111111-1111-4111-8111-111111111111";
const deviceId = "c1111111-1111-4111-8111-111111111111";

it("keeps only bounded operational attributes and drops arbitrary identifiers and payloads", () => {
  const attributes = redactTelemetryAttributes({
    "http.request.method": "POST",
    "http.route": "/api/v1/orders/:id",
    "http.response.status_code": 201,
    "organization.id": organizationId,
    "unit.id": unitId,
    "device.id": deviceId,
    authorization: "Bearer secret-access-token",
    cookie: "session=secret-cookie",
    email: "guest@example.com",
    phone: "+5511999999999",
    document: "123.456.789-00",
    pin: "1234",
    apiKey: "provider-secret",
    pan: "4111111111111111",
    cvv: "123",
    trackData: "%B4111111111111111^GUEST/TEST^",
    "request.body": { order: "sensitive-payload" },
    "customer.id": "customer-free-cardinality",
    "table.id": "table-free-cardinality",
    "tab.id": "tab-free-cardinality",
  });

  assert.deepEqual(attributes, {
    "http.request.method": "POST",
    "http.route": "/api/v1/orders/:id",
    "http.response.status_code": 201,
    "organization.id": organizationId,
    "unit.id": unitId,
    "device.id": deviceId,
    "telemetry.dropped_attributes_count": 14,
  });
  const serialized = JSON.stringify(attributes);
  for (const secret of [
    "secret-access-token",
    "secret-cookie",
    "guest@example.com",
    "123.456.789-00",
    "provider-secret",
    "4111111111111111",
    "sensitive-payload",
    "customer-free-cardinality",
  ]) {
    assert.doesNotMatch(serialized, new RegExp(secret.replaceAll(".", "\\.")));
  }
});

it("redacts sensitive values even when an attribute name is allowed", () => {
  assert.deepEqual(
    redactTelemetryAttributes({
      "service.name": "Bearer secret-access-token",
      "error.code": "guest@example.com",
      "error.type": "sk_live_1234567890abcdef",
      outcome: "success",
    }),
    {
      "service.name": "[REDACTED]",
      "error.code": "[REDACTED]",
      "error.type": "[REDACTED]",
      outcome: "success",
      "telemetry.redacted_attributes_count": 3,
    },
  );
});

it("redacts normalized PIN, CVV, document, cookie and phone prefixes in allowed values", () => {
  assert.deepEqual(
    redactTelemetryAttributes({
      "service.name": "PHONE_5511999999999",
      "job.type": "Pin-1234",
      "queue.name": "cookie_session-secret",
      "messaging.operation.name": "cpf:123.456.789-00",
      "error.type": "telefone.5511988887777",
      "error.code": "CvV_123",
    }),
    {
      "service.name": "[REDACTED]",
      "job.type": "[REDACTED]",
      "queue.name": "[REDACTED]",
      "messaging.operation.name": "[REDACTED]",
      "error.type": "[REDACTED]",
      "error.code": "[REDACTED]",
      "telemetry.redacted_attributes_count": 6,
    },
  );
  assert.deepEqual(redactTelemetryAttributes({ "error.code": "ＰＩＮ＿１２３４" }), {
    "error.code": "[REDACTED]",
    "telemetry.redacted_attributes_count": 1,
  });
});

it("does not mistake ordinary operational names for prefixed sensitive values", () => {
  assert.deepEqual(
    redactTelemetryAttributes({
      "service.name": "phonebook-sync",
      "job.type": "spinner-refresh",
      "queue.name": "cookie_missing",
      "error.type": "CvvParserError",
      "error.code": "TOKEN_EXPIRED",
    }),
    {
      "service.name": "phonebook-sync",
      "job.type": "spinner-refresh",
      "queue.name": "cookie_missing",
      "error.type": "CvvParserError",
      "error.code": "TOKEN_EXPIRED",
    },
  );
});

it("drops nested and array values without serializing their sensitive contents", () => {
  const attributes = redactTelemetryAttributes({
    "error.type": { name: "pin_1234", nested: { cookie: "session-secret" } },
    "error.code": ["cvv_123", { phone: "+5511999999999" }],
  });

  assert.deepEqual(attributes, { "telemetry.dropped_attributes_count": 2 });
  assert.doesNotMatch(JSON.stringify(attributes), /1234|session-secret|5511999999999/);
});

it("collapses controlled dimensions after their per-key cardinality budget", () => {
  const guard = new CardinalityGuard({ "organization.id": 1 });
  const first = guard.apply({ "organization.id": organizationId });
  const overflow = guard.apply({ "organization.id": otherOrganizationId });

  assert.deepEqual(first, { "organization.id": organizationId });
  assert.deepEqual(overflow, {
    "organization.id": "__overflow__",
    "telemetry.cardinality_overflow_count": 1,
  });
  assert.deepEqual(guard.snapshot(), {
    "organization.id": { limit: 1, retained: 1, overflowed: 1 },
  });
});

it("never admits uncontrolled customer, table or tab dimensions into a budget guard", () => {
  const guard = new CardinalityGuard({ "organization.id": 2 });
  const sanitized: TelemetryAttributes = redactTelemetryAttributes({
    "organization.id": organizationId,
    "customer.id": "customer-1",
    "table.id": "table-40",
    "tab.id": "tab-99",
  });

  assert.deepEqual(guard.apply(sanitized), {
    "organization.id": organizationId,
    "telemetry.dropped_attributes_count": 3,
  });
});

it("rejects raw URL paths with identifiers instead of turning them into route dimensions", () => {
  assert.deepEqual(
    redactTelemetryAttributes({
      "http.route": `/api/v1/organizations/${organizationId}/orders`,
    }),
    { "telemetry.dropped_attributes_count": 1 },
  );
  assert.deepEqual(redactTelemetryAttributes({ "http.route": "/api/v1/tables/2048" }), {
    "telemetry.dropped_attributes_count": 1,
  });
});
