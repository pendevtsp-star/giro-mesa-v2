import assert from "node:assert/strict";
import { test } from "node:test";
import { PRICE_REFERENCE_KEY_RETENTION_MS, PRICE_REFERENCE_VALIDITY_MS } from "@giromesa/domain";
import type { CommandFingerprintKeyring } from "./command-fingerprint.js";
import { createPriceReference, verifyPriceReference } from "./price-reference.js";

const organizationId = "11111111-1111-4111-8111-111111111111";
const unitId = "22222222-2222-4222-8222-222222222222";
const entityId = "33333333-3333-4333-8333-333333333333";
const priceRevision = "2026-08-01T10:00:00.000Z";
const issuedAt = new Date("2026-08-01T12:00:00.000Z");
const key = (byte: number) => Buffer.alloc(32, byte);
const originalKeyring: CommandFingerprintKeyring = {
  activeVersion: "price-v1",
  keys: new Map([["price-v1", key(1)]]),
};
const expected = {
  kind: "product" as const,
  entityId,
  organizationId,
  unitId,
  priceRevision,
  occurredAt: "2026-08-02T12:00:00.000Z",
};

function token() {
  return createPriceReference(
    { kind: "product", entityId, organizationId, unitId, priceCents: 2_500, priceRevision },
    originalKeyring,
    issuedAt,
  );
}

function tamper(reference: string, field: string, value: string) {
  const [material, signature] = reference.split(".");
  assert.ok(material && signature);
  const decoded = JSON.parse(Buffer.from(material, "base64url").toString("utf8"));
  decoded[field] = value;
  return `${Buffer.from(JSON.stringify(decoded)).toString("base64url")}.${signature}`;
}

test("price references remain valid across key rotation and a catalog price change", () => {
  const rotated: CommandFingerprintKeyring = {
    activeVersion: "price-v2",
    keys: new Map([
      ["price-v1", key(1)],
      ["price-v2", key(2)],
    ]),
  };
  assert.equal(
    verifyPriceReference(token(), expected, rotated, new Date("2026-08-03T12:00:00.000Z")),
    2_500,
  );
  assert.ok(PRICE_REFERENCE_KEY_RETENTION_MS > PRICE_REFERENCE_VALIDITY_MS);
});

test("price references reject expiry and not-yet-valid server windows", () => {
  assert.throws(
    () =>
      verifyPriceReference(
        token(),
        expected,
        originalKeyring,
        new Date("2026-09-10T12:00:00.000Z"),
      ),
    /PRICE_REFERENCE_EXPIRED/,
  );
  assert.throws(
    () =>
      verifyPriceReference(
        token(),
        expected,
        originalKeyring,
        new Date("2026-07-31T12:00:00.000Z"),
      ),
    /PRICE_REFERENCE_NOT_YET_VALID/,
  );
});

test("price references reject commands outside validity and tampered revision or time", () => {
  assert.throws(
    () =>
      verifyPriceReference(
        token(),
        { ...expected, occurredAt: "2026-07-31T12:00:00.000Z" },
        originalKeyring,
        new Date("2026-08-03T12:00:00.000Z"),
      ),
    /PRICE_REFERENCE_COMMAND_OUTSIDE_VALIDITY/,
  );
  assert.throws(
    () =>
      verifyPriceReference(
        tamper(token(), "priceRevision", "tampered"),
        expected,
        originalKeyring,
        new Date("2026-08-03T12:00:00.000Z"),
      ),
    /PRICE_REFERENCE_INVALID/,
  );
  assert.throws(
    () =>
      verifyPriceReference(
        tamper(token(), "expiresAt", "2026-12-01T12:00:00.000Z"),
        expected,
        originalKeyring,
        new Date("2026-08-03T12:00:00.000Z"),
      ),
    /PRICE_REFERENCE_INVALID/,
  );
});

test("price references allow bounded occurredAt skew without extending expiry", () => {
  const now = new Date("2026-08-03T12:00:00.000Z");
  assert.equal(
    verifyPriceReference(
      token(),
      { ...expected, occurredAt: "2026-08-01T11:59:59.000Z" },
      originalKeyring,
      now,
    ),
    2_500,
  );
  assert.equal(
    verifyPriceReference(
      token(),
      { ...expected, occurredAt: "2026-08-01T11:55:01.000Z" },
      originalKeyring,
      now,
    ),
    2_500,
  );
  assert.throws(
    () =>
      verifyPriceReference(
        token(),
        { ...expected, occurredAt: "2026-08-01T11:54:59.000Z" },
        originalKeyring,
        now,
      ),
    /PRICE_REFERENCE_COMMAND_OUTSIDE_VALIDITY/,
  );
  assert.throws(
    () =>
      verifyPriceReference(
        token(),
        { ...expected, occurredAt: "2026-09-05T12:00:00.000Z" },
        originalKeyring,
        new Date("2026-09-05T12:00:01.000Z"),
      ),
    /PRICE_REFERENCE_EXPIRED/,
  );
});
