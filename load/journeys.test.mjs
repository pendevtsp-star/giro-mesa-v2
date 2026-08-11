import assert from "node:assert/strict";
import { it } from "node:test";
import { multitenantRequests, operationalRequests, publicQrRequests } from "./lib/journeys.js";

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
  ...tenantA,
  label: "tenant-b",
  organizationId: "a2222222-2222-4222-8222-222222222222",
  unitId: "b2222222-2222-4222-8222-222222222222",
  sessionCookieEnv: "K6_TENANT_B_COOKIE",
  publicMenuPath: "/api/v1/public/menus/load-tenant-b",
};

it("models a real operational read/open/read journey with bounded tags", () => {
  assert.deepEqual(operationalRequests(tenantA, 1, 0), [
    {
      name: "floor.read",
      kind: "read",
      method: "GET",
      path: "/v1/organizations/a1111111-1111-4111-8111-111111111111/units/b1111111-1111-4111-8111-111111111111/pilot/floor",
      expectedStatuses: [200],
    },
    {
      name: "tab.open",
      kind: "write",
      method: "POST",
      path: "/v1/organizations/a1111111-1111-4111-8111-111111111111/units/b1111111-1111-4111-8111-111111111111/pilot/tabs/open",
      body: {
        tableId: "d1111111-1111-4111-8111-111111111111",
        guestCount: 2,
      },
      expectedStatuses: [200, 201],
    },
    {
      name: "tabs.read",
      kind: "read",
      method: "GET",
      path: "/v1/organizations/a1111111-1111-4111-8111-111111111111/units/b1111111-1111-4111-8111-111111111111/pilot/tabs",
      expectedStatuses: [200],
    },
  ]);
});

it("opens each table once and then keeps the steady-state journey read-only", () => {
  assert.deepEqual(
    operationalRequests(tenantA, 1, 1).map((request) => request.name),
    ["floor.read", "tabs.read"],
  );
});

it("models public QR sessions without credentials or tenant tags", () => {
  assert.deepEqual(publicQrRequests(tenantA), [
    {
      name: "public-menu.read",
      kind: "read",
      method: "GET",
      path: "/api/v1/public/menus/load-tenant-a",
      expectedStatuses: [200],
    },
  ]);
});

it("models a negative cross-tenant probe that only accepts forbidden or not-found", () => {
  assert.deepEqual(multitenantRequests(tenantA, tenantB), [
    {
      name: "tenant-own-floor.read",
      kind: "read",
      method: "GET",
      path: "/v1/organizations/a1111111-1111-4111-8111-111111111111/units/b1111111-1111-4111-8111-111111111111/pilot/floor",
      expectedStatuses: [200],
    },
    {
      name: "tenant-isolation.probe",
      kind: "read",
      method: "GET",
      path: "/v1/organizations/a2222222-2222-4222-8222-222222222222/units/b2222222-2222-4222-8222-222222222222/pilot/floor",
      expectedStatuses: [403, 404],
      isolationProbe: true,
    },
  ]);
});

it("keeps secrets outside journey descriptors", () => {
  const serialized = JSON.stringify([
    ...operationalRequests(tenantA, 1, 0),
    ...publicQrRequests(tenantA),
    ...multitenantRequests(tenantA, tenantB),
  ]);
  assert.doesNotMatch(serialized, /Cookie|sessionCookieEnv|authorization/i);
});
