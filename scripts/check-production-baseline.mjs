import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
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
  typeof value === "string" && /^\d{4}_[a-z\d]+(?:-[a-z\d]+)*$/i.test(value);

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
    }
  }

  return errors;
}

export async function checkProductionBaseline(packagePath) {
  const resolvedPackagePath =
    packagePath ?? fileURLToPath(new URL("../package.json", import.meta.url));
  const packageJson = JSON.parse(await readFile(resolvedPackagePath, "utf8"));
  return validateProductionBaseline(packageJson.productionBaseline);
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
