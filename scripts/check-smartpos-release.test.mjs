import assert from "node:assert/strict";
import { dirname } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  checkSmartPosRelease,
  validateSmartPosEnvironment,
  validateSmartPosReleaseManifest,
} from "./check-smartpos-release.mjs";

const blockedProvider = (blocker = "external dependency") => ({
  enabled: false,
  status: "blocked",
  officialStoreUrl: null,
  terminal: null,
  app: null,
  evidence: null,
  blockers: [blocker],
});

const validManifest = {
  schemaVersion: 1,
  webVersion: "0.2.3",
  providers: Object.fromEntries(
    ["rede", "paygo", "stone", "getnet", "cielo", "pagbank"].map((provider) => [
      provider,
      blockedProvider(),
    ]),
  ),
};

const homologatedRede = {
  enabled: true,
  status: "homologated",
  officialStoreUrl: "https://store.example/giromesa",
  terminal: {
    manufacturer: "Vendor",
    model: "POS-1",
    androidVersion: "12",
    firmwareVersion: "1.2.3",
  },
  app: {
    packageName: "com.giromesa.smartpos.rede",
    version: "1.0.0",
    signingCertificateSha256: "a".repeat(64),
  },
  evidence: {
    providerApproval: `sha256:${"b".repeat(64)}`,
    hardwareRun: `sha256:${"c".repeat(64)}`,
    rollbackRun: `sha256:${"d".repeat(64)}`,
  },
  blockers: [],
};

test("accepts a fail-closed manifest with every provider explicitly blocked", () => {
  assert.deepEqual(validateSmartPosReleaseManifest(validManifest, "0.2.3"), []);
});

test("requires complete immutable evidence before a provider is homologated", () => {
  const manifest = structuredClone(validManifest);
  manifest.providers.rede = { ...homologatedRede, evidence: null };
  assert.match(
    validateSmartPosReleaseManifest(manifest, "0.2.3").join("\n"),
    /immutable approval, hardware and rollback evidence/,
  );
});

test("rejects a store URL while its provider remains blocked", () => {
  assert.deepEqual(
    validateSmartPosEnvironment(
      { NEXT_PUBLIC_REDE_STORE_URL: "https://store.example/giromesa" },
      validManifest,
    ),
    ["NEXT_PUBLIC_REDE_STORE_URL cannot be published before rede is homologated."],
  );
});

test("accepts the exact approved store URL for a homologated provider", () => {
  const manifest = structuredClone(validManifest);
  manifest.providers.rede = homologatedRede;
  assert.deepEqual(
    validateSmartPosEnvironment(
      { NEXT_PUBLIC_REDE_STORE_URL: "https://store.example/giromesa/" },
      manifest,
    ),
    [],
  );
});

test("requires coherent HTTPS public URLs in a production release", () => {
  assert.deepEqual(
    validateSmartPosEnvironment(
      {
        SMARTPOS_RELEASE_ENV: "production",
        APP_URL: "http://site.example",
        API_URL: "https://api.example",
        VITE_API_URL: "https://other-api.example",
        NEXT_PUBLIC_OPS_URL: "https://ops.example",
      },
      validManifest,
    ),
    [
      "APP_URL must be an absolute HTTPS URL.",
      "API_URL and VITE_API_URL must use the same public origin.",
    ],
  );
});

test("current repository passes the declared SmartPOS release gate", async () => {
  const repositoryRoot = dirname(fileURLToPath(new URL("../package.json", import.meta.url)));
  assert.deepEqual(
    await checkSmartPosRelease({ repositoryRoot, environment: { NODE_ENV: "development" } }),
    [],
  );
});
