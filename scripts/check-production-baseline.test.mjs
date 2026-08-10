import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";

import { validateProductionBaseline } from "./check-production-baseline.mjs";

const gitSha = "0123456789abcdef0123456789abcdef01234567";
const digest = `sha256:${"a".repeat(64)}`;
const immutableEvidence = `git:${gitSha}`;

const validBaseline = {
  level: "software-ready",
  artifact: immutableEvidence,
  migration: {
    id: "0008_final-recipes-and-operations",
    status: "verified",
    evidence: immutableEvidence,
  },
  gateResults: {
    automated: { status: "passed", evidence: immutableEvidence },
    security: { status: "passed", evidence: immutableEvidence },
  },
};

test("accepts a software-ready baseline with immutable evidence", () => {
  assert.deepEqual(validateProductionBaseline(validBaseline), []);
});

test("accepts a pinned image or package digest as an artifact", () => {
  assert.deepEqual(
    validateProductionBaseline({
      ...validBaseline,
      artifact: `registry.example/giromesa@${digest}`,
    }),
    [],
  );
});

test("accepts a bare full Git SHA as an artifact", () => {
  assert.deepEqual(validateProductionBaseline({ ...validBaseline, artifact: gitSha }), []);
});

for (const [field, baseline] of [
  ["level", { ...validBaseline, level: "" }],
  ["artifact", { ...validBaseline, artifact: "source-tree" }],
  ["migration", { ...validBaseline, migration: "not-assessed" }],
  [
    "placeholder migration evidence",
    {
      ...validBaseline,
      migration: {
        ...validBaseline.migration,
        status: "not-run",
        evidence: "source-tree",
      },
    },
  ],
  ["gate results", { ...validBaseline, gateResults: {} }],
  ["invented level", { ...validBaseline, level: "not-assessed" }],
  ["placeholder artifact", { ...validBaseline, artifact: "latest" }],
  [
    "not-run gate",
    {
      ...validBaseline,
      gateResults: {
        ...validBaseline.gateResults,
        security: { status: "not-run", evidence: immutableEvidence },
      },
    },
  ],
  ["promotion without integration evidence", { ...validBaseline, level: "integration-ready" }],
  ["pilot promotion without an applied migration", { ...validBaseline, level: "pilot-approved" }],
]) {
  test(`rejects a release baseline without ${field}`, () => {
    assert.ok(validateProductionBaseline(baseline).length > 0);
  });
}

test("importing the validator does not execute the CLI", () => {
  const result = spawnSync(
    process.execPath,
    ["--input-type=module", "--eval", 'import("./scripts/check-production-baseline.mjs")'],
    { cwd: process.cwd(), encoding: "utf8" },
  );

  assert.equal(result.status, 0);
  assert.equal(result.stdout, "");
  assert.equal(result.stderr, "");
});
