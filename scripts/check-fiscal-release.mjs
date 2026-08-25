import { readFile, stat } from "node:fs/promises";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const evidenceNames = [
  "focusApproval",
  "sefazAuthorization",
  "consultation",
  "cancellation",
  "numberInvalidation",
  "artifactVerification",
  "rollbackRun",
];
const isRecord = (value) => Boolean(value) && typeof value === "object" && !Array.isArray(value);
const hasText = (value) => typeof value === "string" && value.trim().length > 0;
const immutableReference = (value) =>
  typeof value === "string" &&
  (/^(?:git:)?[a-f\d]{40}$/i.test(value) || /^(?:[\w./:-]+@)?sha256:[a-f\d]{64}$/i.test(value));

function validEncryptionKey(value) {
  if (!hasText(value)) return false;
  const normalized = value.trim();
  if (!/^[A-Za-z0-9+/]{43}=$/.test(normalized)) return false;
  try {
    return Buffer.from(normalized, "base64").length === 32;
  } catch {
    return false;
  }
}

export function validateFiscalReleaseManifest(manifest, expectedVersion) {
  if (!isRecord(manifest) || manifest.schemaVersion !== 1) {
    return ["Fiscal release manifest must use schemaVersion 1."];
  }
  const errors = [];
  if (manifest.moduleVersion !== expectedVersion) {
    errors.push("Fiscal moduleVersion must match the repository version.");
  }
  if (manifest.provider !== "focus") errors.push("Fiscal provider must be focus.");
  if (!["blocked", "homologated"].includes(manifest.status)) {
    errors.push("Fiscal release status must be blocked or homologated.");
    return errors;
  }
  if (manifest.status === "blocked") {
    if (manifest.environment !== "homologation") {
      errors.push("Blocked fiscal releases must remain in homologation.");
    }
    if (manifest.scope !== null || manifest.evidence !== null || manifest.homologatedAt !== null) {
      errors.push("Blocked fiscal releases cannot declare homologation evidence.");
    }
    if (
      !Array.isArray(manifest.blockers) ||
      manifest.blockers.length === 0 ||
      !manifest.blockers.every(hasText)
    ) {
      errors.push("Blocked fiscal releases must list their external blockers.");
    }
    return errors;
  }

  if (manifest.environment !== "production") {
    errors.push("Homologated fiscal releases must target production.");
  }
  if (!isRecord(manifest.scope)) {
    errors.push("Homologated fiscal releases require an approved issuer scope.");
  } else {
    if (!/^[A-Z]{2}$/.test(manifest.scope.uf ?? ""))
      errors.push("Fiscal scope requires a valid UF.");
    if (!/^\d+$/.test(manifest.scope.nfceSeries ?? "")) {
      errors.push("Fiscal scope requires the approved NFC-e series.");
    }
    if (!/^[a-f\d]{64}$/i.test(manifest.scope.issuerDocumentSha256 ?? "")) {
      errors.push("Fiscal scope requires a SHA-256 digest of the issuer document.");
    }
  }
  if (
    !isRecord(manifest.evidence) ||
    !evidenceNames.every((name) => immutableReference(manifest.evidence[name]))
  ) {
    errors.push(
      "Homologated fiscal releases require immutable evidence for the complete fiscal journey.",
    );
  }
  if (!hasText(manifest.homologatedAt) || Number.isNaN(Date.parse(manifest.homologatedAt))) {
    errors.push("Homologated fiscal releases require a valid homologatedAt timestamp.");
  }
  if (!Array.isArray(manifest.blockers) || manifest.blockers.length !== 0) {
    errors.push("Homologated fiscal releases cannot retain blockers.");
  }
  return errors;
}

export function validateFiscalEnvironment(environment, manifest) {
  const errors = [];
  const production = environment.FISCAL_RELEASE_ENV === "production";
  const tokenConfigured = hasText(environment.FOCUS_NFE_PRIMARY_TOKEN);
  const encryptionConfigured = hasText(environment.FISCAL_CREDENTIALS_ENCRYPTION_KEY);
  if (tokenConfigured !== encryptionConfigured) {
    errors.push("Focus token and fiscal encryption key must be configured together.");
  }
  if (encryptionConfigured && !validEncryptionKey(environment.FISCAL_CREDENTIALS_ENCRYPTION_KEY)) {
    errors.push("FISCAL_CREDENTIALS_ENCRYPTION_KEY must be 32 bytes encoded as base64.");
  }
  if (!production) return errors;
  if (manifest?.status !== "homologated") {
    errors.push("Fiscal production release is blocked until the manifest is homologated.");
  }
  if (!tokenConfigured) errors.push("FOCUS_NFE_PRIMARY_TOKEN is required for fiscal production.");
  if (!encryptionConfigured) {
    errors.push("FISCAL_CREDENTIALS_ENCRYPTION_KEY is required for fiscal production.");
  }
  if (!hasText(environment.MEDIA_ROOT) || !isAbsolute(environment.MEDIA_ROOT)) {
    errors.push("MEDIA_ROOT must be an absolute persistent path for fiscal production.");
  }
  if (environment.ACCOUNTANT_ATTACHMENT_SCAN_MODE !== "clamd") {
    errors.push("ACCOUNTANT_ATTACHMENT_SCAN_MODE=clamd is required for fiscal production.");
  }
  if (!hasText(environment.ACCOUNTANT_ATTACHMENT_CLAMD_HOST)) {
    errors.push("ACCOUNTANT_ATTACHMENT_CLAMD_HOST is required for fiscal production.");
  }
  const clamdPort = Number(environment.ACCOUNTANT_ATTACHMENT_CLAMD_PORT ?? 3310);
  if (!Number.isSafeInteger(clamdPort) || clamdPort <= 0 || clamdPort > 65_535) {
    errors.push("ACCOUNTANT_ATTACHMENT_CLAMD_PORT must be a valid TCP port.");
  }
  const retentionDays = Number(environment.ACCOUNTANT_ATTACHMENT_RETENTION_DAYS);
  if (!Number.isSafeInteger(retentionDays) || retentionDays < 1827) {
    errors.push(
      "ACCOUNTANT_ATTACHMENT_RETENTION_DAYS must preserve fiscal attachments for at least five years.",
    );
  }
  return errors;
}

async function nonEmpty(path) {
  try {
    return (await stat(path)).size > 0;
  } catch {
    return false;
  }
}

export function validateRecoveryCoverage(recovery, journal, manifest) {
  if (manifest.status !== "homologated") return [];
  const latestMigration = journal.entries?.at(-1)?.tag;
  return latestMigration && recovery.targetMigration === latestMigration
    ? []
    : ["Recovery compatibility evidence must cover the latest database migration."];
}

export async function checkFiscalRelease(options = {}) {
  const repositoryRoot =
    options.repositoryRoot ?? dirname(fileURLToPath(new URL("../package.json", import.meta.url)));
  const environment = options.environment ?? process.env;
  const read = (path) => readFile(join(repositoryRoot, path), "utf8");
  const [rootPackage, manifest, compose, worker, migration, journal, recovery] = await Promise.all([
    read("package.json").then(JSON.parse),
    read("config/fiscal-release.json").then(JSON.parse),
    read("deploy/vps/compose.pilot.yaml"),
    read("apps/backends/worker/src/fiscal.ts"),
    nonEmpty(join(repositoryRoot, "packages/db/drizzle/0061_accountant_portal_security.sql")),
    read("packages/db/drizzle/meta/_journal.json").then(JSON.parse),
    read("deploy/vps/recovery-compatibility.json").then(JSON.parse),
  ]);
  const errors = [
    ...validateFiscalReleaseManifest(manifest, rootPackage.version),
    ...validateFiscalEnvironment(environment, manifest),
  ];
  if (!migration) errors.push("Fiscal/accountant security migration 0061 is missing.");
  errors.push(...validateRecoveryCoverage(recovery, journal, manifest));
  if ((compose.match(/media_data:\/app\/data\/media/g) ?? []).length < 2) {
    errors.push("API and worker must share the persistent fiscal media volume.");
  }
  for (const marker of ["clamav_data:/var/lib/clamav", "condition: service_healthy"]) {
    if (!compose.includes(marker)) errors.push(`Fiscal deploy is missing ClamAV marker ${marker}.`);
  }
  for (const marker of [
    '"pos.tab.closed"',
    '"fiscal.document.reconcile_requested"',
    '"fiscal.document.artifacts_requested"',
  ]) {
    if (!worker.includes(marker)) errors.push(`Fiscal worker is missing event handler ${marker}.`);
  }
  return errors;
}

async function main() {
  const errors = await checkFiscalRelease();
  if (errors.length > 0) {
    for (const error of errors) console.error(error);
    process.exitCode = 1;
  } else {
    console.log("Fiscal release gate passed for the declared state.");
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
