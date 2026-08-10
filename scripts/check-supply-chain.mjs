import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const read = (path) => readFileSync(resolve(root, path), "utf8");
const requireText = (contents, pattern, description, errors) => {
  if (!pattern.test(contents)) errors.push(description);
};

export function validateWorkflowBuildArgs(workflow) {
  const buildArgs = [];
  let blockIndentation = null;

  for (const line of workflow.split(/\r?\n/)) {
    const buildArgsBlock = line.match(/^(\s*)build-args:\s*\|\s*$/);
    if (buildArgsBlock) {
      blockIndentation = buildArgsBlock[1].length;
      continue;
    }
    if (blockIndentation === null) continue;

    const indentation = line.match(/^\s*/)[0].length;
    if (line.trim() && indentation <= blockIndentation) {
      blockIndentation = null;
      continue;
    }
    buildArgs.push(line);
  }

  const buildArgsText = buildArgs.join("\n");
  const hasSecretExpression = /\$\{\{\s*secrets\./i.test(buildArgsText);
  const hasSensitiveBuildArgument =
    /^[ \t]*[A-Z0-9_]*(SECRET|TOKEN|PASSWORD|PRIVATE_KEY)[A-Z0-9_]*\s*=/im.test(buildArgsText);
  return hasSecretExpression || hasSensitiveBuildArgument
    ? ["workflow build arguments must not carry secrets or sensitive values"]
    : [];
}

export function validateSupplyChain() {
  const errors = [];
  const security = read(".github/workflows/security.yml");
  const dockerfile = read("Dockerfile");
  const opsDockerfile = read("Dockerfile.ops");
  const publish = read(".github/workflows/publish-images.yml");
  const nginx = read("deploy/vps/ops-nginx.conf");
  const runbook = read("docs/runbooks/vulnerability-response.md");
  const workflows = readdirSync(resolve(root, ".github/workflows"))
    .filter((file) => /\.ya?ml$/i.test(file))
    .map((file) => read(`.github/workflows/${file}`));

  requireText(
    security,
    /pnpm install --frozen-lockfile/,
    "security workflow must install from the lockfile",
    errors,
  );
  requireText(security, /gitleaks/i, "security workflow must scan for secrets", errors);
  requireText(
    security,
    /pnpm audit --audit-level=high/,
    "security workflow must fail SCA at high severity",
    errors,
  );
  requireText(security, /syft/i, "security workflow must generate an SBOM", errors);
  requireText(security, /trivy/i, "security workflow must scan container definitions", errors);
  if (/--ignore-unfixed/.test(security)) {
    errors.push("security workflow must not hide unfixed high or critical findings");
  }
  requireText(
    security,
    /actions\/upload-artifact@v4/,
    "security workflow must retain SBOM evidence",
    errors,
  );
  requireText(
    publish,
    /id-token:\s*write/,
    "image publication must request OIDC for provenance",
    errors,
  );
  requireText(
    publish,
    /attestations:\s*write/,
    "image publication must request attestation permission",
    errors,
  );
  requireText(publish, /provenance:\s*mode=max/, "image builds must emit provenance", errors);
  requireText(publish, /sbom:\s*true/, "image builds must emit an SBOM", errors);
  requireText(
    publish,
    /actions\/attest-build-provenance@v3/,
    "image publication must attest the built digest",
    errors,
  );
  requireText(dockerfile, /^USER node$/m, "application image must run as node", errors);
  requireText(
    opsDockerfile,
    /nginxinc\/nginx-unprivileged/,
    "operations image must use the unprivileged nginx image",
    errors,
  );
  requireText(
    opsDockerfile,
    /^USER 101$/m,
    "operations image must explicitly run as a non-root user",
    errors,
  );
  requireText(
    nginx,
    /listen 8080;/,
    "operations nginx must listen on an unprivileged port",
    errors,
  );
  requireText(runbook, /HIGH|high/, "runbook must define the high-severity response", errors);
  requireText(
    runbook,
    /CRITICAL|critical/,
    "runbook must define the critical-severity response",
    errors,
  );
  requireText(runbook, /SBOM/, "runbook must describe SBOM evidence", errors);
  requireText(runbook, /CRITICAL.*24 horas/s, "runbook must define a critical maximum SLA", errors);
  requireText(runbook, /HIGH.*7 dias/s, "runbook must define a high maximum SLA", errors);
  requireText(runbook, /MEDIUM.*30 dias/s, "runbook must define a medium maximum SLA", errors);
  requireText(runbook, /LOW.*90 dias/s, "runbook must define a low maximum SLA", errors);
  requireText(
    runbook,
    /Excecao maxima.*7 dias.*30 dias.*90 dias.*180 dias/s,
    "runbook must define expiring exceptions for every severity",
    errors,
  );

  if (/ARG\s+.*(SECRET|TOKEN|PASSWORD|PRIVATE_KEY)/i.test(`${dockerfile}\n${opsDockerfile}`)) {
    errors.push("container build arguments must not accept secrets");
  }
  for (const workflow of workflows) errors.push(...validateWorkflowBuildArgs(workflow));
  return errors;
}

export function main() {
  const errors = validateSupplyChain();
  if (errors.length) throw new Error(`Supply-chain checks failed:\n- ${errors.join("\n- ")}`);
  console.log("Supply-chain checks passed.");
}

if (process.argv[1] === new URL(import.meta.url).pathname) main();
