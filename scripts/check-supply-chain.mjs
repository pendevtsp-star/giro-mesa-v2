import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const read = (path) => readFileSync(resolve(root, path), "utf8");
const requireText = (contents, pattern, description, errors) => {
  if (!pattern.test(contents)) errors.push(description);
};

export function validateWorkflowBuildArgs(workflow) {
  const lines = workflow.split(/\r?\n/);
  const buildArgsValues = [];
  const indentation = (line) => line.match(/^\s*/)[0].length;

  for (let index = 0; index < lines.length; index += 1) {
    if (!/^\s*(?:-\s+)?uses:\s*docker\/build-push-action@/i.test(lines[index])) continue;

    const actionIndentation = indentation(lines[index]);
    let end = index + 1;
    while (end < lines.length) {
      if (/^\s*-\s+/.test(lines[end]) && indentation(lines[end]) < actionIndentation) break;
      end += 1;
    }

    for (let input = index + 1; input < end; input += 1) {
      const match = lines[input].match(/^(\s*)build-args:\s*(.*)$/);
      if (!match) continue;
      const valueIndentation = match[1].length;
      if (match[2]) buildArgsValues.push(match[2]);

      for (let value = input + 1; value < end; value += 1) {
        if (lines[value].trim() && indentation(lines[value]) <= valueIndentation) break;
        buildArgsValues.push(lines[value]);
      }
    }
  }

  const buildArgsText = buildArgsValues.join("\n");
  const errors = [];
  if (/\$\{\{\s*secrets\./i.test(buildArgsText)) {
    errors.push("workflow Docker build args must not carry GitHub secrets");
  }
  if (
    /^[ \t]*(?:-\s+)?[A-Z0-9_]*(SECRET|TOKEN|PASSWORD|PRIVATE_KEY)[A-Z0-9_]*\s*=/im.test(
      buildArgsText,
    )
  ) {
    errors.push("workflow Docker build args must not use sensitive argument names");
  }
  return errors;
}

export function validateWorkflowActionPins(workflow) {
  const errors = [];
  for (const line of workflow.split(/\r?\n/)) {
    const match = line.match(/^\s*(?:-\s+)?uses:\s*([^\s#]+)(?:\s+#.*)?$/);
    if (match && !/@[0-9a-f]{40}$/.test(match[1])) {
      errors.push(`workflow action must use an immutable commit SHA: ${match[1]}`);
    }
  }
  return errors;
}

export function validateWorkflowCheckoutCredentials(workflow) {
  const lines = workflow.split(/\r?\n/);
  const errors = [];
  const indentation = (line) => line.match(/^\s*/)[0].length;
  for (let index = 0; index < lines.length; index += 1) {
    if (!/^\s*-\s+uses:\s*actions\/checkout@[0-9a-f]{40}(?:\s+#.*)?$/.test(lines[index])) {
      continue;
    }
    const actionIndentation = indentation(lines[index]);
    let end = index + 1;
    while (end < lines.length) {
      if (/^\s*-\s+/.test(lines[end]) && indentation(lines[end]) <= actionIndentation) break;
      end += 1;
    }
    if (!/^\s*persist-credentials:\s*false\s*$/m.test(lines.slice(index + 1, end).join("\n"))) {
      errors.push("checkout must set persist-credentials: false");
    }
  }
  return errors;
}

export function validateCosignImageSignatures(workflow) {
  const commands = [
    ...workflow.matchAll(/\bcosign\s+sign\s+--yes(?<arguments>[\s\S]*?)["']\$IMAGE["']/g),
  ].map((match) => match.groups.arguments.replace(/\s+/g, " ").trim());
  const errors = [];
  if (commands.length !== 2) {
    errors.push("image publication must contain exactly one target and one recovery signature");
  }
  const digestBindings = workflow.match(
    /IMAGE:\s*ghcr\.io\/pendevtsp-star\/giro-mesa-v2-\$\{\{\s*matrix\.service\s*\}\}@\$\{\{\s*steps\.build\.outputs\.digest\s*\}\}/g,
  );
  if ((digestBindings ?? []).length !== 2) {
    errors.push("image signatures must use the exact digests emitted by both builds");
  }
  const actionExpression = (value) => `$${`{{ ${value} }}`}`;
  const contracts = [
    {
      role: "target",
      source: `sourceCommit=${actionExpression("github.event.workflow_run.head_sha")}`,
      authorization: `authorizedByMain=${actionExpression("github.event.workflow_run.head_sha")}`,
    },
    {
      role: "recovery",
      source: `sourceCommit=${actionExpression("needs.authorize-recovery.outputs.recovery_sha")}`,
      authorization: `authorizedByMain=${actionExpression("github.event.workflow_run.head_sha")}`,
    },
  ];
  for (const contract of contracts) {
    const valid = commands.some(
      (command) =>
        command.includes(`-a role=${contract.role}`) &&
        !command.includes(`-a role=${contract.role === "target" ? "recovery" : "target"}`) &&
        command.includes(`-a ${contract.source}`) &&
        command.includes(`-a ${contract.authorization}`),
    );
    if (!valid) {
      errors.push(
        `${contract.role} image signature must bind role, source commit and main authorization`,
      );
    }
  }
  return errors;
}

export function validateSupplyChain() {
  const errors = [];
  const ci = read(".github/workflows/ci.yml");
  const security = read(".github/workflows/security.yml");
  const dockerfile = read("Dockerfile");
  const opsDockerfile = read("Dockerfile.ops");
  const publish = read(".github/workflows/publish-images.yml");
  const recoveryValidator = read("scripts/validate-recovery-candidate.sh");
  const nginx = read("deploy/vps/ops-nginx.conf");
  const runbook = read("docs/runbooks/vulnerability-response.md");
  const imageLock = JSON.parse(read("deploy/vps/image-lock.json"));
  const terraformNetwork = read("infra/terraform/network.tf");
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
    /gitleaks[\s\S]*dir --redact --no-banner \/repo/,
    "secret scan must inspect the build directory fail-closed",
    errors,
  );
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
    /actions\/upload-artifact@[0-9a-f]{40}/,
    "security workflow must retain SBOM evidence",
    errors,
  );
  requireText(
    ci,
    /gitleaks:v8\.28\.0@sha256:[0-9a-f]{64}/,
    "CI must gate publication on a pinned secret scan",
    errors,
  );
  requireText(
    ci,
    /gitleaks[\s\S]*dir --redact --no-banner \/repo/,
    "CI secret gate must inspect the build directory fail-closed",
    errors,
  );
  requireText(
    ci,
    /trivy:0\.69\.2@sha256:[0-9a-f]{64}/,
    "CI must gate publication on a pinned container scan",
    errors,
  );
  requireText(
    ci,
    /node scripts\/check-supply-chain\.mjs/,
    "CI must validate the release supply-chain contract",
    errors,
  );
  requireText(ci, /branches: \[main\]/, "only main CI may feed privileged publication", errors);
  requireText(
    publish,
    /authorize-recovery:/,
    "main publication must authorize recovery from a versioned matrix",
    errors,
  );
  requireText(
    publish,
    /validate-recovery:/,
    "main publication must reprove recovery compatibility",
    errors,
  );
  requireText(
    recoveryValidator,
    /gitleaks:v8\.28\.0@sha256:[0-9a-f]{64}[\s\S]*--volume "\$candidate_directory:\/repo:ro"[\s\S]*dir --config \/trusted-gitleaks\.toml --redact --no-banner \/repo/,
    "recovery validation must scan the exact recovery checkout for secrets",
    errors,
  );
  requireText(
    recoveryValidator,
    /"postgresMajors":\s*\[16,17\]/,
    "recovery validation must cover PostgreSQL 16 and 17",
    errors,
  );
  requireText(
    publish,
    /id-token:\s*write/,
    "image publication must request OIDC for provenance",
    errors,
  );
  requireText(publish, /provenance:\s*mode=max/, "image builds must emit provenance", errors);
  requireText(publish, /sbom:\s*true/, "image builds must emit an SBOM", errors);
  errors.push(...validateCosignImageSignatures(publish));
  requireText(
    publish,
    /cosign sign-blob --yes/,
    "release manifest must be signed with Cosign",
    errors,
  );
  requireText(
    publish,
    /giromesa-image-attestation-\$\{SOURCE_SHA\}\.json\.bundle/,
    "release manifest must retain a verification bundle",
    errors,
  );
  requireText(
    publish,
    /workflow_run\.event == 'push'/,
    "privileged publication must require a push CI event",
    errors,
  );
  requireText(
    publish,
    /workflow_run\.head_repository\.full_name == github\.repository/,
    "privileged publication must require the trusted repository",
    errors,
  );
  requireText(
    publish,
    /workflow_run\.head_sha == github\.sha/,
    "privileged publication must bind the completed CI SHA",
    errors,
  );
  requireText(
    publish,
    /driver-opts:\s*image=moby\/buildkit@sha256:[0-9a-f]{64}/,
    "BuildKit executor must be locked by digest",
    errors,
  );
  requireText(
    publish,
    /actions\/download-artifact@[0-9a-f]{40}/,
    "publication must aggregate immutable image digest fragments",
    errors,
  );
  if (/attestations:\s*write|actions\/attest-build-provenance@/.test(publish)) {
    errors.push(
      "private-repository publication must not depend on unavailable GitHub attestations",
    );
  }
  requireText(dockerfile, /^USER node$/m, "application image must run as node", errors);
  requireText(
    dockerfile,
    /^# syntax=docker\/dockerfile:1@sha256:[0-9a-f]{64}$/m,
    "application Dockerfile frontend must be locked by digest",
    errors,
  );
  requireText(
    dockerfile,
    /^FROM node:24\.18\.0-bookworm-slim@sha256:[0-9a-f]{64}$/m,
    "application base image must be locked by digest",
    errors,
  );
  requireText(
    opsDockerfile,
    /nginxinc\/nginx-unprivileged:1\.29-alpine@sha256:[0-9a-f]{64}/,
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
  requireText(
    terraformNetwork,
    /resource "aws_vpc_security_group_egress_rule" "application_https"/,
    "application HTTPS egress must use a standalone security-group rule",
    errors,
  );
  const applicationSecurityGroup = terraformNetwork.match(
    /resource "aws_security_group" "application" \{([\s\S]*?)\n\}/,
  );
  if (
    !applicationSecurityGroup ||
    /^\s*(?:ingress|egress)\s*\{/m.test(applicationSecurityGroup[1])
  ) {
    errors.push("application security group must not mix inline and standalone rules");
  }
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
  const lockedReferences = [
    [
      "buildkit",
      "moby/buildkit@sha256:28a898719c18a33f4e8000685287fa36fd0dd9560c6440227d3a732d79bb41d8",
    ],
    [
      "dockerfileFrontend",
      "docker/dockerfile:1@sha256:ecfaec9ed6d810b56388c508f4121597bfbba70d41a6dfeee4d8cad5f295fc32",
    ],
    [
      "node",
      "node:24.18.0-bookworm-slim@sha256:6f7b03f7c2c8e2e784dcf9295400527b9b1270fd37b7e9a7285cf83b6951452d",
    ],
    [
      "nginxUnprivileged",
      "nginxinc/nginx-unprivileged:1.29-alpine@sha256:0c79d56aee561a1d81c63f00eee5fb5fe29279560cdc55e91425133104c7fbe6",
    ],
  ];
  for (const [name, reference] of lockedReferences) {
    if (imageLock.images?.[name]?.reference !== reference)
      errors.push(`${name} image lock must match the reviewed digest`);
  }
  for (const workflow of workflows) {
    errors.push(...validateWorkflowBuildArgs(workflow));
    errors.push(...validateWorkflowActionPins(workflow));
    errors.push(...validateWorkflowCheckoutCredentials(workflow));
    for (const line of workflow.split(/\r?\n/)) {
      const match = line.match(/^\s*(?:-\s+)?uses:\s*([^\s#]+)(?:\s+#.*)?$/);
      if (match && !/@[0-9a-f]{40}$/.test(match[1])) {
        errors.push(`workflow action must use an immutable commit SHA: ${match[1]}`);
      }
    }
  }
  return errors;
}

export function main() {
  const errors = validateSupplyChain();
  if (errors.length) throw new Error(`Supply-chain checks failed:\n- ${errors.join("\n- ")}`);
  console.log("Supply-chain checks passed.");
}

if (process.argv[1] === new URL(import.meta.url).pathname) main();
