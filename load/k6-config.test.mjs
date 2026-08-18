import assert from "node:assert/strict";
import { it } from "node:test";
import {
  buildK6Options,
  executionContext,
  fixturePath,
  fixtureTenantSlot,
  parseLoadFixture,
  pickFixtureTenant,
  profileRequirements,
  publicBaseUrl,
} from "./lib/config.js";

const tenantA = {
  label: "tenant-a",
  organizationId: "a1111111-1111-4111-8111-111111111111",
  unitId: "b1111111-1111-4111-8111-111111111111",
  sessionCookieEnv: "K6_TENANT_A_COOKIE",
  terminalIds: ["c1111111-1111-4111-8111-111111111111"],
  tableIds: ["d1111111-1111-4111-8111-111111111111"],
  publicMenuPath: "/api/v1/public/menus/load-tenant-a",
};
const tenantB = {
  label: "tenant-b",
  organizationId: "a2222222-2222-4222-8222-222222222222",
  unitId: "b2222222-2222-4222-8222-222222222222",
  sessionCookieEnv: "K6_TENANT_B_COOKIE",
  terminalIds: ["c2222222-2222-4222-8222-222222222222"],
  tableIds: ["d2222222-2222-4222-8222-222222222222"],
  publicMenuPath: "/api/v1/public/menus/load-tenant-b",
};

it("builds a light smoke profile and explicit reliability thresholds", () => {
  assert.deepEqual(buildK6Options("operational", "smoke", 2), {
    discardResponseBodies: true,
    scenarios: {
      operational_smoke: {
        executor: "per-vu-iterations",
        vus: 2,
        iterations: 1,
        maxDuration: "30s",
      },
    },
    thresholds: {
      checks: [{ threshold: "rate>0.999", abortOnFail: true, delayAbortEval: "30s" }],
      http_req_failed: [{ threshold: "rate<0.001", abortOnFail: true, delayAbortEval: "30s" }],
      "http_req_duration{kind:read}": [
        { threshold: "p(95)<300", abortOnFail: true, delayAbortEval: "1m" },
      ],
      "http_req_duration{kind:write}": [
        { threshold: "p(95)<500", abortOnFail: true, delayAbortEval: "1m" },
      ],
    },
  });
});

it("models the approved target, two-times spike and soak without running them", () => {
  assert.deepEqual(buildK6Options("operational", "target", 2).scenarios, {
    operational_target: { executor: "constant-vus", vus: 100, duration: "10m" },
  });
  assert.deepEqual(buildK6Options("public-qr", "target", 2).scenarios, {
    public_qr_target: { executor: "constant-vus", vus: 4_000, duration: "10m" },
  });
  assert.deepEqual(buildK6Options("public-qr", "spike", 2).scenarios, {
    public_qr_spike: {
      executor: "ramping-vus",
      startVUs: 4_000,
      stages: [
        { duration: "2m", target: 4_000 },
        { duration: "1m", target: 8_000 },
        { duration: "5m", target: 8_000 },
        { duration: "2m", target: 0 },
      ],
    },
  });
  assert.deepEqual(buildK6Options("multitenant", "soak", 3).scenarios, {
    multitenant_soak: { executor: "constant-vus", vus: 150, duration: "2h" },
  });
  assert.deepEqual(buildK6Options("multitenant", "target", 2).thresholds.isolation_breach, [
    { threshold: "rate==0", abortOnFail: true, delayAbortEval: "0s" },
  ]);
});

it("requires the full 500-table, 50-terminal and 2000-QR target fixture per unit", () => {
  assert.deepEqual(profileRequirements("target"), {
    tablesPerUnit: 500,
    terminalsPerUnit: 50,
    qrSessionsPerUnit: 2_000,
    minimumTenants: 2,
  });
  assert.throws(
    () =>
      parseLoadFixture(
        JSON.stringify({ version: 1, qrSessionsPerUnit: 2_000, tenants: [tenantA, tenantB] }),
        "target",
      ),
    /500 tables and 50 terminals per unit/,
  );
  assert.equal(
    parseLoadFixture(
      JSON.stringify({ version: 1, qrSessionsPerUnit: 1, tenants: [tenantA, tenantB] }),
      "smoke",
    ).tenants.length,
    2,
  );
  assert.throws(
    () =>
      parseLoadFixture(
        JSON.stringify({
          version: 1,
          qrSessionsPerUnit: 1,
          tenants: [{ ...tenantA, sessionCookie: "secret-in-fixture" }, tenantB],
        }),
        "smoke",
      ),
    /unsupported fixture field: sessionCookie/,
  );
});

it("loads cookies only from named environment entries and never exposes them as metadata", () => {
  const context = executionContext(
    tenantA,
    { K6_BASE_URL: "http://localhost:3200", K6_TENANT_A_COOKIE: "session=top-secret" },
    "smoke",
  );

  assert.deepEqual(context.requestHeaders, {
    Cookie: "session=top-secret",
    "x-device-id": tenantA.terminalIds[0],
  });
  assert.deepEqual(context.metadata, {
    baseUrl: "http://localhost:3200",
    profile: "smoke",
    tenantLabel: "tenant-a",
    hasSession: true,
  });
  assert.doesNotMatch(JSON.stringify(context.metadata), /top-secret/);
  assert.equal(
    executionContext(
      {
        ...tenantA,
        terminalIds: [tenantA.terminalIds[0], "c3333333-3333-4333-8333-333333333333"],
      },
      { K6_BASE_URL: "http://localhost:3200", K6_TENANT_A_COOKIE: "session=top-secret" },
      "smoke",
      2,
    ).requestHeaders["x-device-id"],
    "c3333333-3333-4333-8333-333333333333",
  );
  assert.throws(
    () => executionContext(tenantA, { K6_BASE_URL: "file:///tmp/api" }, "smoke"),
    /http or https/,
  );
  assert.equal(
    publicBaseUrl({ K6_BASE_URL: "https://load.example.test/api/" }),
    "https://load.example.test/api",
  );
  assert.throws(
    () => publicBaseUrl({ K6_BASE_URL: "https://user:pass@example.test" }),
    /credentials/,
  );
  const urlConstructor = globalThis.URL;
  try {
    globalThis.URL = undefined;
    assert.equal(publicBaseUrl({ K6_BASE_URL: "http://localhost:3200" }), "http://localhost:3200");
  } finally {
    globalThis.URL = urlConstructor;
  }
});

it("selects fixture tenants deterministically without adding tenant IDs to metric tags", () => {
  const fixture = parseLoadFixture(
    JSON.stringify({ version: 1, qrSessionsPerUnit: 1, tenants: [tenantA, tenantB] }),
    "smoke",
  );

  assert.equal(pickFixtureTenant(fixture, 1).label, "tenant-a");
  assert.equal(pickFixtureTenant(fixture, 2).label, "tenant-b");
  assert.equal(pickFixtureTenant(fixture, 3).label, "tenant-a");
  assert.deepEqual(fixtureTenantSlot(fixture, 1), {
    tenant: fixture.tenants[0],
    tenantVuNumber: 1,
  });
  assert.deepEqual(fixtureTenantSlot(fixture, 2), {
    tenant: fixture.tenants[1],
    tenantVuNumber: 1,
  });
  assert.deepEqual(fixtureTenantSlot(fixture, 3), {
    tenant: fixture.tenants[0],
    tenantVuNumber: 2,
  });
});

it("resolves fixtures inside the load directory and rejects path traversal", () => {
  assert.equal(fixturePath({}), "./fixtures/smoke.example.json");
  assert.equal(
    fixturePath({ K6_FIXTURE_PATH: "./fixtures/smoke.local.json" }),
    "./fixtures/smoke.local.json",
  );
  assert.throws(() => fixturePath({ K6_FIXTURE_PATH: "../.env" }), /safe JSON path/);
});
