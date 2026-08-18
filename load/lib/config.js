const PROFILE_NAMES = new Set(["smoke", "target", "spike", "soak"]);
const TEST_KINDS = new Set(["operational", "public-qr", "multitenant"]);
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const LABEL_PATTERN = /^[a-z][a-z0-9-]{0,31}$/;
const ENV_NAME_PATTERN = /^K6_[A-Z0-9_]{1,61}$/;
const PUBLIC_MENU_PATH_PATTERN = /^\/api\/v1\/public\/menus\/[a-z0-9][a-z0-9-]{0,62}$/;
const ROOT_FIELDS = new Set(["version", "qrSessionsPerUnit", "tenants"]);
const TENANT_FIELDS = new Set([
  "label",
  "organizationId",
  "unitId",
  "sessionCookieEnv",
  "terminalIds",
  "tableIds",
  "publicMenuPath",
]);

const thresholds = (kind) => ({
  checks: [{ threshold: "rate>0.999", abortOnFail: true, delayAbortEval: "30s" }],
  http_req_failed: [{ threshold: "rate<0.001", abortOnFail: true, delayAbortEval: "30s" }],
  "http_req_duration{kind:read}": [
    { threshold: "p(95)<300", abortOnFail: true, delayAbortEval: "1m" },
  ],
  "http_req_duration{kind:write}": [
    { threshold: "p(95)<500", abortOnFail: true, delayAbortEval: "1m" },
  ],
  ...(kind === "multitenant"
    ? {
        isolation_breach: [{ threshold: "rate==0", abortOnFail: true, delayAbortEval: "0s" }],
      }
    : {}),
});

export function profileRequirements(profile) {
  assertProfile(profile);
  if (profile === "smoke") {
    return {
      tablesPerUnit: 1,
      terminalsPerUnit: 1,
      qrSessionsPerUnit: 1,
      minimumTenants: 2,
    };
  }
  return {
    tablesPerUnit: 500,
    terminalsPerUnit: 50,
    qrSessionsPerUnit: 2_000,
    minimumTenants: 2,
  };
}

export function buildK6Options(kind, profile, tenantCount) {
  if (!TEST_KINDS.has(kind)) throw new Error(`Unsupported k6 test kind: ${kind}`);
  assertProfile(profile);
  if (!Number.isInteger(tenantCount) || tenantCount < 1) {
    throw new Error("Tenant count must be a positive integer");
  }

  const scenarioName = `${kind.replaceAll("-", "_")}_${profile}`;
  if (profile === "smoke") {
    return {
      discardResponseBodies: true,
      scenarios: {
        [scenarioName]: {
          executor: "per-vu-iterations",
          vus: tenantCount,
          iterations: 1,
          maxDuration: "30s",
        },
      },
      thresholds: thresholds(kind),
    };
  }

  const targetPerUnit = kind === "public-qr" ? 2_000 : 50;
  const target = targetPerUnit * tenantCount;
  if (profile === "target" || profile === "soak") {
    return {
      discardResponseBodies: true,
      scenarios: {
        [scenarioName]: {
          executor: "constant-vus",
          vus: target,
          duration: profile === "target" ? "10m" : "2h",
        },
      },
      thresholds: thresholds(kind),
    };
  }

  return {
    discardResponseBodies: true,
    scenarios: {
      [scenarioName]: {
        executor: "ramping-vus",
        startVUs: target,
        stages: [
          { duration: "2m", target },
          { duration: "1m", target: target * 2 },
          { duration: "5m", target: target * 2 },
          { duration: "2m", target: 0 },
        ],
      },
    },
    thresholds: thresholds(kind),
  };
}

export function parseLoadFixture(raw, profile) {
  const requirements = profileRequirements(profile);
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("Load fixture must be valid JSON");
  }
  if (!isRecord(parsed)) throw new Error("Load fixture must be an object");
  rejectUnknownFields(parsed, ROOT_FIELDS);
  if (parsed.version !== 1) throw new Error("Load fixture version must be 1");
  if (
    !Number.isInteger(parsed.qrSessionsPerUnit) ||
    parsed.qrSessionsPerUnit < requirements.qrSessionsPerUnit
  ) {
    throw new Error(
      `Profile ${profile} requires ${requirements.qrSessionsPerUnit} QR sessions per unit`,
    );
  }
  if (!Array.isArray(parsed.tenants) || parsed.tenants.length < requirements.minimumTenants) {
    throw new Error(`Profile ${profile} requires at least ${requirements.minimumTenants} tenants`);
  }

  const tenants = parsed.tenants.map((tenant, index) =>
    parseTenant(tenant, index, requirements, profile),
  );
  const scopes = new Set(tenants.map((tenant) => `${tenant.organizationId}:${tenant.unitId}`));
  if (scopes.size !== tenants.length) throw new Error("Fixture tenant scopes must be unique");
  return { version: 1, qrSessionsPerUnit: parsed.qrSessionsPerUnit, tenants };
}

export function executionContext(tenant, environment, profile, vuNumber = 1) {
  assertProfile(profile);
  if (!Number.isInteger(vuNumber) || vuNumber < 1) throw new Error("VU number must be positive");
  const baseUrl = publicBaseUrl(environment);

  const cookie = environment[tenant.sessionCookieEnv]?.trim();
  if (!cookie) throw new Error(`Missing session secret in ${tenant.sessionCookieEnv}`);
  return {
    requestHeaders: {
      Cookie: cookie,
      "x-device-id": tenant.terminalIds[(vuNumber - 1) % tenant.terminalIds.length],
    },
    metadata: {
      baseUrl,
      profile,
      tenantLabel: tenant.label,
      hasSession: true,
    },
  };
}

export function publicBaseUrl(environment) {
  const value = environment.K6_BASE_URL;
  const match =
    typeof value === "string" ? /^(https?):\/\/([^/?#]+)(\/[^?#]*)?$/i.exec(value.trim()) : null;
  if (!match) throw new Error("K6_BASE_URL must use http or https without embedded credentials");
  const [, protocol, authority, rawPath = ""] = match;
  if (authority.includes("@")) {
    throw new Error("K6_BASE_URL must use http or https without embedded credentials");
  }
  const hostMatch = /^(?:[A-Za-z0-9.-]+|\[[0-9A-Fa-f:]+\])(?::(\d{1,5}))?$/.exec(authority);
  const port = hostMatch?.[1] ? Number(hostMatch[1]) : null;
  if (!hostMatch || (port !== null && (port < 1 || port > 65_535))) {
    throw new Error("K6_BASE_URL must use http or https without embedded credentials");
  }
  if (
    rawPath &&
    (!/^\/[A-Za-z0-9._~/-]*$/.test(rawPath) || rawPath.includes("..") || rawPath.includes("//"))
  ) {
    throw new Error("K6_BASE_URL must use http or https without embedded credentials");
  }
  const path = rawPath.replace(/\/$/, "");
  return `${protocol.toLowerCase()}://${authority}${path}`;
}

export function fixturePath(environment) {
  const value = environment.K6_FIXTURE_PATH ?? "./fixtures/smoke.example.json";
  if (!/^\.\/fixtures\/[A-Za-z0-9._-]+\.json$/.test(value)) {
    throw new Error("K6_FIXTURE_PATH must be a safe JSON path inside ./fixtures");
  }
  return value;
}

export function pickFixtureTenant(fixture, vuNumber) {
  if (!Number.isInteger(vuNumber) || vuNumber < 1) throw new Error("VU number must be positive");
  return fixture.tenants[(vuNumber - 1) % fixture.tenants.length];
}

export function fixtureTenantSlot(fixture, vuNumber) {
  return {
    tenant: pickFixtureTenant(fixture, vuNumber),
    tenantVuNumber: Math.floor((vuNumber - 1) / fixture.tenants.length) + 1,
  };
}

function assertProfile(profile) {
  if (!PROFILE_NAMES.has(profile)) throw new Error(`Unsupported k6 profile: ${profile}`);
}

function parseTenant(value, index, requirements, profile) {
  if (!isRecord(value)) throw new Error(`Fixture tenant ${index + 1} must be an object`);
  rejectUnknownFields(value, TENANT_FIELDS);
  if (typeof value.label !== "string" || !LABEL_PATTERN.test(value.label)) {
    throw new Error(`Fixture tenant ${index + 1} has an invalid label`);
  }
  if (typeof value.organizationId !== "string" || !UUID_PATTERN.test(value.organizationId)) {
    throw new Error(`Fixture tenant ${value.label} has an invalid organizationId`);
  }
  if (typeof value.unitId !== "string" || !UUID_PATTERN.test(value.unitId)) {
    throw new Error(`Fixture tenant ${value.label} has an invalid unitId`);
  }
  if (
    typeof value.sessionCookieEnv !== "string" ||
    !ENV_NAME_PATTERN.test(value.sessionCookieEnv)
  ) {
    throw new Error(`Fixture tenant ${value.label} has an invalid sessionCookieEnv`);
  }
  if (
    !Array.isArray(value.tableIds) ||
    value.tableIds.length < requirements.tablesPerUnit ||
    !value.tableIds.every((id) => typeof id === "string" && UUID_PATTERN.test(id))
  ) {
    throw new Error(
      `Profile ${profile} requires ${requirements.tablesPerUnit} tables and ${requirements.terminalsPerUnit} terminals per unit`,
    );
  }
  if (
    !Array.isArray(value.terminalIds) ||
    value.terminalIds.length < requirements.terminalsPerUnit ||
    !value.terminalIds.every((id) => typeof id === "string" && UUID_PATTERN.test(id))
  ) {
    throw new Error(
      `Profile ${profile} requires ${requirements.tablesPerUnit} tables and ${requirements.terminalsPerUnit} terminals per unit`,
    );
  }
  if (
    typeof value.publicMenuPath !== "string" ||
    !PUBLIC_MENU_PATH_PATTERN.test(value.publicMenuPath)
  ) {
    throw new Error(`Fixture tenant ${value.label} has an invalid publicMenuPath`);
  }
  return {
    label: value.label,
    organizationId: value.organizationId.toLowerCase(),
    unitId: value.unitId.toLowerCase(),
    sessionCookieEnv: value.sessionCookieEnv,
    terminalIds: value.terminalIds.map((id) => id.toLowerCase()),
    tableIds: value.tableIds.map((id) => id.toLowerCase()),
    publicMenuPath: value.publicMenuPath,
  };
}

function rejectUnknownFields(record, allowed) {
  for (const key of Object.keys(record)) {
    if (!allowed.has(key)) throw new Error(`unsupported fixture field: ${key}`);
  }
}

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
