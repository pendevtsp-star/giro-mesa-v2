import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const read = (path) => readFileSync(resolve(root, path), "utf8");
const requireText = (contents, pattern, description, errors) => {
  if (!pattern.test(contents)) errors.push(description);
};

export function validateSupplyChain() {
  const errors = [];
  const security = read(".github/workflows/security.yml");
  const dockerfile = read("Dockerfile");
  const opsDockerfile = read("Dockerfile.ops");
  const publish = read(".github/workflows/publish-images.yml");
  const nginx = read("deploy/vps/ops-nginx.conf");
  const runbook = read("docs/runbooks/vulnerability-response.md");

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

  if (/ARG\s+.*(SECRET|TOKEN|PASSWORD|PRIVATE_KEY)/i.test(`${dockerfile}\n${opsDockerfile}`)) {
    errors.push("container build arguments must not accept secrets");
  }
  return errors;
}

export function main() {
  const errors = validateSupplyChain();
  if (errors.length) throw new Error(`Supply-chain checks failed:\n- ${errors.join("\n- ")}`);
  console.log("Supply-chain checks passed.");
}

if (process.argv[1] === new URL(import.meta.url).pathname) main();
