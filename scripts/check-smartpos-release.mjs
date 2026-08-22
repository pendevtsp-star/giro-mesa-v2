import { readFile, stat } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const providerNames = ["rede", "paygo", "stone", "getnet", "cielo", "pagbank"];
const storeEnvironmentByProvider = {
  rede: "NEXT_PUBLIC_REDE_STORE_URL",
  paygo: "NEXT_PUBLIC_PAYGO_STORE_URL",
  stone: "NEXT_PUBLIC_STONE_STORE_URL",
};

const isRecord = (value) => Boolean(value) && typeof value === "object" && !Array.isArray(value);
const hasText = (value) => typeof value === "string" && value.trim().length > 0;
const isImmutableReference = (value) =>
  typeof value === "string" &&
  (/^(?:git:)?[a-f\d]{40}$/i.test(value) || /^(?:[\w./:-]+@)?sha256:[a-f\d]{64}$/i.test(value));
const isCertificateDigest = (value) =>
  typeof value === "string" &&
  (/^[a-f\d]{64}$/i.test(value) || /^(?:[a-f\d]{2}:){31}[a-f\d]{2}$/i.test(value));

function parseHttpsUrl(value) {
  if (!hasText(value)) return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password ? url : null;
  } catch {
    return null;
  }
}

function sameUrl(left, right) {
  const normalized = (value) => new URL(value).toString().replace(/\/$/, "");
  return normalized(left) === normalized(right);
}

export function validateSmartPosReleaseManifest(manifest, expectedWebVersion) {
  const errors = [];
  if (!isRecord(manifest) || manifest.schemaVersion !== 1) {
    return ["SmartPOS release manifest must use schemaVersion 1."];
  }
  if (manifest.webVersion !== expectedWebVersion) {
    errors.push("SmartPOS webVersion must match the Ops package version.");
  }
  if (!isRecord(manifest.providers)) {
    errors.push("SmartPOS release manifest must declare provider states.");
    return errors;
  }

  for (const providerName of providerNames) {
    const provider = manifest.providers[providerName];
    if (!isRecord(provider)) {
      errors.push(`SmartPOS provider ${providerName} is missing from the release manifest.`);
      continue;
    }
    if (provider.status !== "blocked" && provider.status !== "homologated") {
      errors.push(`SmartPOS provider ${providerName} has an unsupported release status.`);
      continue;
    }

    if (provider.status === "blocked") {
      if (provider.enabled !== false) {
        errors.push(`Blocked SmartPOS provider ${providerName} must remain disabled.`);
      }
      if (provider.officialStoreUrl !== null) {
        errors.push(`Blocked SmartPOS provider ${providerName} cannot publish a store URL.`);
      }
      if (!Array.isArray(provider.blockers) || !provider.blockers.every(hasText)) {
        errors.push(`Blocked SmartPOS provider ${providerName} must list its external blockers.`);
      }
      continue;
    }

    if (provider.enabled !== true) {
      errors.push(`Homologated SmartPOS provider ${providerName} must be explicitly enabled.`);
    }
    if (!parseHttpsUrl(provider.officialStoreUrl)) {
      errors.push(
        `Homologated SmartPOS provider ${providerName} requires an official HTTPS store URL.`,
      );
    }
    if (
      !isRecord(provider.terminal) ||
      !["manufacturer", "model", "androidVersion", "firmwareVersion"].every((field) =>
        hasText(provider.terminal[field]),
      )
    ) {
      errors.push(
        `Homologated SmartPOS provider ${providerName} requires the exact terminal profile.`,
      );
    }
    if (
      !isRecord(provider.app) ||
      !hasText(provider.app.packageName) ||
      !hasText(provider.app.version) ||
      !isCertificateDigest(provider.app.signingCertificateSha256)
    ) {
      errors.push(
        `Homologated SmartPOS provider ${providerName} requires the signed app identity.`,
      );
    }
    if (
      !isRecord(provider.evidence) ||
      !["providerApproval", "hardwareRun", "rollbackRun"].every((field) =>
        isImmutableReference(provider.evidence[field]),
      )
    ) {
      errors.push(
        `Homologated SmartPOS provider ${providerName} requires immutable approval, hardware and rollback evidence.`,
      );
    }
  }
  return errors;
}

export function validateSmartPosEnvironment(environment, manifest) {
  const errors = [];
  const production =
    environment.NODE_ENV === "production" || environment.SMARTPOS_RELEASE_ENV === "production";
  if (production) {
    for (const name of ["APP_URL", "API_URL", "VITE_API_URL", "NEXT_PUBLIC_OPS_URL"]) {
      if (!parseHttpsUrl(environment[name])) errors.push(`${name} must be an absolute HTTPS URL.`);
    }
    const apiUrl = parseHttpsUrl(environment.API_URL);
    const viteApiUrl = parseHttpsUrl(environment.VITE_API_URL);
    if (apiUrl && viteApiUrl && apiUrl.origin !== viteApiUrl.origin) {
      errors.push("API_URL and VITE_API_URL must use the same public origin.");
    }
  }

  for (const [providerName, environmentName] of Object.entries(storeEnvironmentByProvider)) {
    const configuredUrl = environment[environmentName]?.trim();
    const provider = manifest?.providers?.[providerName];
    if (!configuredUrl) {
      if (provider?.enabled === true && provider?.status === "homologated") {
        errors.push(`${environmentName} is required for enabled provider ${providerName}.`);
      }
      continue;
    }
    if (!parseHttpsUrl(configuredUrl)) {
      errors.push(`${environmentName} must be an absolute HTTPS URL without credentials.`);
      continue;
    }
    if (provider?.enabled !== true || provider?.status !== "homologated") {
      errors.push(`${environmentName} cannot be published before ${providerName} is homologated.`);
      continue;
    }
    if (!sameUrl(configuredUrl, provider.officialStoreUrl)) {
      errors.push(`${environmentName} must match the store URL approved in the release manifest.`);
    }
  }
  return errors;
}

async function fileIsPresent(path) {
  try {
    return (await stat(path)).size > 0;
  } catch {
    return false;
  }
}

export async function checkSmartPosRelease(options = {}) {
  const repositoryRoot =
    options.repositoryRoot ?? dirname(fileURLToPath(new URL("../package.json", import.meta.url)));
  const environment = options.environment ?? process.env;
  const read = (path) => readFile(join(repositoryRoot, path), "utf8");
  const [
    opsPackage,
    releaseManifest,
    webManifest,
    serviceWorker,
    pwaSource,
    indexHtml,
    envExample,
  ] = await Promise.all([
    read("apps/frontends/ops/package.json").then(JSON.parse),
    read("config/smartpos-release.json").then(JSON.parse),
    read("apps/frontends/ops/public/manifest.webmanifest").then(JSON.parse),
    read("apps/frontends/ops/public/sw.js"),
    read("apps/frontends/ops/src/pwa.ts"),
    read("apps/frontends/ops/index.html"),
    read(".env.example"),
  ]);
  const errors = [
    ...validateSmartPosReleaseManifest(releaseManifest, opsPackage.version),
    ...validateSmartPosEnvironment(environment, releaseManifest),
  ];

  if (!serviceWorker.includes(`giromesa-ops-shell-v${opsPackage.version}`)) {
    errors.push("Service worker cache version must match the Ops package version.");
  }
  for (const marker of [
    'request.method !== "GET"',
    "url.origin !== SCOPE_URL.origin",
    'path.includes("/v1/")',
    'path.includes("/auth/")',
    'path.includes("/payment")',
    'type === "SKIP_WAITING"',
  ]) {
    if (!serviceWorker.includes(marker))
      errors.push(`Service worker is missing safety marker: ${marker}`);
  }
  for (const marker of [
    "!import.meta.env.PROD",
    'updateViaCache: "none"',
    'document.addEventListener("visibilitychange"',
    "window.setInterval",
  ]) {
    if (!pwaSource.includes(marker))
      errors.push(`PWA update lifecycle is missing marker: ${marker}`);
  }
  if (!indexHtml.includes('rel="manifest"') || !indexHtml.includes('rel="apple-touch-icon"')) {
    errors.push("Ops HTML must link the web manifest and Apple touch icon.");
  }
  if (
    webManifest.display !== "standalone" ||
    webManifest.start_url !== "./" ||
    webManifest.scope !== "./"
  ) {
    errors.push("Ops web manifest must keep a standalone, relative application scope.");
  }
  const requiredIcons = [
    "./icons/giromesa-192.png",
    "./icons/giromesa-512.png",
    "./icons/giromesa-maskable-512.png",
  ];
  for (const icon of requiredIcons) {
    if (!webManifest.icons?.some((entry) => entry.src === icon)) {
      errors.push(`Ops web manifest is missing required icon ${icon}.`);
    }
    if (!(await fileIsPresent(join(repositoryRoot, "apps/frontends/ops/public", icon)))) {
      errors.push(`Ops PWA icon is missing or empty: ${icon}`);
    }
  }
  for (const environmentName of [
    "NEXT_PUBLIC_OPS_URL",
    "NEXT_PUBLIC_REDE_STORE_URL",
    "NEXT_PUBLIC_PAYGO_STORE_URL",
    "NEXT_PUBLIC_STONE_STORE_URL",
  ]) {
    if (!new RegExp(`^${environmentName}=`, "m").test(envExample)) {
      errors.push(`.env.example must document ${environmentName}.`);
    }
  }
  return errors;
}

async function main() {
  const errors = await checkSmartPosRelease();
  if (errors.length > 0) {
    for (const error of errors) console.error(error);
    process.exitCode = 1;
  } else {
    console.log("SmartPOS release gate passed for the declared provider states.");
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
