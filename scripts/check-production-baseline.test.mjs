import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";

import {
  validateProductionBaseline,
  validateRepositoryEvidence,
} from "./check-production-baseline.mjs";

const gitSha = "0123456789abcdef0123456789abcdef01234567";
const digest = `sha256:${"a".repeat(64)}`;
const immutableEvidence = `git:${gitSha}`;

const validBaseline = {
  level: "software-ready",
  artifact: immutableEvidence,
  migration: {
    id: "0028_privacy_domain_processors",
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
  const artifact = `registry.example/giromesa@${digest}`;
  assert.deepEqual(
    validateProductionBaseline({
      ...validBaseline,
      artifact,
      migration: { ...validBaseline.migration, evidence: artifact },
      gateResults: {
        automated: { status: "passed", evidence: artifact },
        security: { status: "passed", evidence: artifact },
      },
    }),
    [],
  );
});

test("accepts a bare full Git SHA as an artifact", () => {
  assert.deepEqual(validateProductionBaseline({ ...validBaseline, artifact: gitSha }), []);
});

test("accepts a current migration id with underscore-separated words", () => {
  assert.deepEqual(validateProductionBaseline(validBaseline), []);
});

test("rejects gate or migration evidence that is not bound to the artifact", () => {
  const otherEvidence = `git:${"a".repeat(40)}`;
  assert.deepEqual(
    validateProductionBaseline({
      ...validBaseline,
      migration: { ...validBaseline.migration, evidence: otherEvidence },
      gateResults: {
        ...validBaseline.gateResults,
        security: { status: "passed", evidence: otherEvidence },
      },
    }),
    [
      "Release baseline gate security evidence must be bound to the artifact.",
      "Release baseline migration evidence must be bound to the artifact.",
    ],
  );
});

test("requires the latest journaled SQL migration and a reachable Git artifact", () => {
  assert.deepEqual(
    validateRepositoryEvidence(validBaseline, {
      latestMigrationId: "0027_doseclub_reconciliation",
      migrationSqlExists: false,
      artifactCommitExists: false,
      artifactReachable: false,
    }),
    [
      "Release baseline migration must be the latest journaled migration.",
      "Release baseline migration SQL must exist in the repository.",
      "Release baseline Git artifact must resolve to a commit.",
    ],
  );
  assert.deepEqual(
    validateRepositoryEvidence(validBaseline, {
      latestMigrationId: validBaseline.migration.id,
      migrationSqlExists: true,
      artifactCommitExists: true,
      artifactReachable: false,
    }),
    ["Release baseline Git artifact must be an ancestor of the manifest commit."],
  );
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
