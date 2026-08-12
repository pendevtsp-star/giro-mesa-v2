import { spawnSync } from "node:child_process";
import { access, readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const requirementsByLevel = {
  "software-ready": {
    gateNames: ["automated", "security"],
    migrationStatuses: ["verified", "applied"],
  },
  "integration-ready": {
    gateNames: ["automated", "security", "integration"],
    migrationStatuses: ["verified", "applied"],
  },
  "pilot-approved": {
    gateNames: ["automated", "security", "integration", "pilot", "restore"],
    migrationStatuses: ["applied"],
  },
  "production-approved": {
    gateNames: [
      "automated",
      "security",
      "integration",
      "pilot",
      "restore",
      "high-availability",
      "reconciliation",
    ],
    migrationStatuses: ["applied"],
  },
};

const isRecord = (value) => Boolean(value) && typeof value === "object" && !Array.isArray(value);
const isFullGitSha = (value) => typeof value === "string" && /^(?:git:)?[a-f\d]{40}$/i.test(value);
const isSha256Digest = (value) =>
  typeof value === "string" && /^(?:[\w./:-]+@)?sha256:[a-f\d]{64}$/i.test(value);
const isImmutableReference = (value) => isFullGitSha(value) || isSha256Digest(value);
const isMigrationId = (value) =>
  typeof value === "string" && /^\d{4}_[a-z\d]+(?:[_-][a-z\d]+)*$/i.test(value);

function normalizedReference(value) {
  if (isFullGitSha(value)) return String(value).replace(/^git:/i, "").toLowerCase();
  return value;
}

function validateMigration(migration, allowedStatuses) {
  if (!isRecord(migration)) return "Missing structured release baseline migration evidence.";
  if (!isMigrationId(migration.id)) return "Release baseline migration must have a migration id.";
  if (!allowedStatuses.includes(migration.status)) {
    return "Release baseline migration status is not sufficient for the claimed level.";
  }
  if (!isImmutableReference(migration.evidence)) {
    return "Release baseline migration must reference immutable evidence.";
  }
  return undefined;
}

function isPassedGate(gate) {
  return isRecord(gate) && gate.status === "passed" && isImmutableReference(gate.evidence);
}

export function validateProductionBaseline(baseline) {
  const errors = [];
  const levelRequirements = requirementsByLevel[baseline?.level];

  if (!levelRequirements) {
    errors.push("Release baseline level must be a supported readiness level.");
    return errors;
  }

  if (!isImmutableReference(baseline.artifact)) {
    errors.push("Release baseline artifact must be a full Git SHA or SHA-256 digest.");
  }

  const migrationError = validateMigration(baseline.migration, levelRequirements.migrationStatuses);
  if (migrationError) errors.push(migrationError);

  if (!isRecord(baseline.gateResults)) {
    errors.push("Missing structured release baseline gate results.");
    return errors;
  }

  for (const gateName of levelRequirements.gateNames) {
    if (!isPassedGate(baseline.gateResults[gateName])) {
      errors.push(`Release baseline gate ${gateName} must be passed with immutable evidence.`);
    } else if (
      normalizedReference(baseline.gateResults[gateName].evidence) !==
      normalizedReference(baseline.artifact)
    ) {
      errors.push(`Release baseline gate ${gateName} evidence must be bound to the artifact.`);
    }
  }

  if (
    isRecord(baseline.migration) &&
    isImmutableReference(baseline.migration.evidence) &&
    normalizedReference(baseline.migration.evidence) !== normalizedReference(baseline.artifact)
  ) {
    errors.push("Release baseline migration evidence must be bound to the artifact.");
  }

  return errors;
}

export function validateRepositoryEvidence(baseline, evidence) {
  const errors = [];
  if (evidence.latestMigrationId !== baseline?.migration?.id) {
    errors.push("Release baseline migration must be the latest journaled migration.");
  }
  if (!evidence.migrationSqlExists) {
    errors.push("Release baseline migration SQL must exist in the repository.");
  }
  if (isFullGitSha(baseline?.artifact)) {
    if (!evidence.artifactCommitExists) {
      errors.push("Release baseline Git artifact must resolve to a commit.");
    } else if (!evidence.artifactReachable) {
      errors.push("Release baseline Git artifact must be an ancestor of the manifest commit.");
    }
  }
  return errors;
}

export async function checkProductionBaseline(packagePath) {
  const resolvedPackagePath =
    packagePath ?? fileURLToPath(new URL("../package.json", import.meta.url));
  const packageJson = JSON.parse(await readFile(resolvedPackagePath, "utf8"));
  const baseline = packageJson.productionBaseline;
  const errors = validateProductionBaseline(baseline);
  if (errors.length > 0) return errors;

  const repositoryRoot = dirname(resolvedPackagePath);
  const journalPath = join(repositoryRoot, "packages", "db", "drizzle", "meta", "_journal.json");
  let latestMigrationId;
  try {
    const journal = JSON.parse(await readFile(journalPath, "utf8"));
    latestMigrationId = journal.entries?.at(-1)?.tag;
  } catch {
    latestMigrationId = undefined;
  }

  let migrationSqlExists = false;
  try {
    await access(join(repositoryRoot, "packages", "db", "drizzle", `${baseline.migration.id}.sql`));
    migrationSqlExists = true;
  } catch {
    migrationSqlExists = false;
  }

  const artifactSha = isFullGitSha(baseline.artifact)
    ? String(baseline.artifact).replace(/^git:/i, "")
    : undefined;
  const artifactCommitExists = artifactSha
    ? spawnSync("git", ["cat-file", "-e", `${artifactSha}^{commit}`], {
        cwd: repositoryRoot,
        stdio: "ignore",
      }).status === 0
    : true;
  const artifactReachable =
    artifactSha && artifactCommitExists
      ? spawnSync("git", ["merge-base", "--is-ancestor", artifactSha, "HEAD"], {
          cwd: repositoryRoot,
          stdio: "ignore",
        }).status === 0
      : !artifactSha;

  return [
    ...errors,
    ...validateRepositoryEvidence(baseline, {
      latestMigrationId,
      migrationSqlExists,
      artifactCommitExists,
      artifactReachable,
    }),
  ];
}

async function main() {
  const errors = await checkProductionBaseline();
  if (errors.length > 0) {
    for (const error of errors) console.error(error);
    process.exitCode = 1;
  } else {
    console.log("Production baseline manifest is complete.");
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
