import assert from "node:assert/strict";
import { dirname } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  checkFiscalRelease,
  validateFiscalEnvironment,
  validateFiscalReleaseManifest,
} from "./check-fiscal-release.mjs";

const blocked = {
  schemaVersion: 1,
  moduleVersion: "0.2.3",
  provider: "focus",
  status: "blocked",
  environment: "homologation",
  scope: null,
  evidence: null,
  homologatedAt: null,
  blockers: ["external homologation"],
};
const digest = (letter) => `sha256:${letter.repeat(64)}`;
const homologated = {
  ...blocked,
  status: "homologated",
  environment: "production",
  scope: { uf: "SP", nfceSeries: "1", issuerDocumentSha256: "a".repeat(64) },
  evidence: {
    focusApproval: digest("b"),
    sefazAuthorization: digest("c"),
    consultation: digest("d"),
    cancellation: digest("e"),
    numberInvalidation: digest("f"),
    artifactVerification: digest("1"),
    rollbackRun: digest("2"),
  },
  homologatedAt: "2026-08-21T12:00:00.000Z",
  blockers: [],
};
const productionEnvironment = {
  FISCAL_RELEASE_ENV: "production",
  FOCUS_NFE_PRIMARY_TOKEN: "private-focus-token",
  FISCAL_CREDENTIALS_ENCRYPTION_KEY: Buffer.alloc(32, 1).toString("base64"),
  MEDIA_ROOT: "/app/data/media",
};

test("accepts the fail-closed fiscal manifest outside production", () => {
  assert.deepEqual(validateFiscalReleaseManifest(blocked, "0.2.3"), []);
  assert.deepEqual(validateFiscalEnvironment({}, blocked), []);
  assert.deepEqual(validateFiscalEnvironment({ NODE_ENV: "production" }, blocked), []);
});

test("blocks production until complete external evidence exists", () => {
  assert.match(
    validateFiscalEnvironment(productionEnvironment, blocked).join("\n"),
    /blocked until the manifest is homologated/,
  );
  assert.match(
    validateFiscalReleaseManifest({ ...homologated, evidence: null }, "0.2.3").join("\n"),
    /immutable evidence/,
  );
});

test("accepts production only with homologation evidence and valid secret configuration", () => {
  assert.deepEqual(validateFiscalReleaseManifest(homologated, "0.2.3"), []);
  assert.deepEqual(validateFiscalEnvironment(productionEnvironment, homologated), []);
});

test("rejects malformed fiscal encryption keys before release", () => {
  assert.match(
    validateFiscalEnvironment(
      { ...productionEnvironment, FISCAL_CREDENTIALS_ENCRYPTION_KEY: "not-base64" },
      homologated,
    ).join("\n"),
    /must be 32 bytes encoded as base64/,
  );
});

test("current repository passes the declared non-production fiscal gate", async () => {
  const repositoryRoot = dirname(fileURLToPath(new URL("../package.json", import.meta.url)));
  assert.deepEqual(await checkFiscalRelease({ repositoryRoot, environment: {} }), []);
});
