function pilotPath(tenant, resource) {
  return `/v1/organizations/${encodeURIComponent(tenant.organizationId)}/units/${encodeURIComponent(tenant.unitId)}/pilot/${resource}`;
}

export function operationalRequests(tenant, vuNumber, state) {
  const tableId = state.tableId ?? tenant.tableIds[vuNumber - 1];
  state.tableId = tableId;
  const requests = [
    {
      name: "floor.read",
      kind: "read",
      method: "GET",
      path: pilotPath(tenant, "floor"),
      expectedStatuses: [200],
    },
  ];
  if (tableId && !state.openAttempted) {
    state.openAttempted = true;
    requests.push({
      name: "tab.open",
      kind: "write",
      method: "POST",
      path: pilotPath(tenant, "tabs/open"),
      body: { tableId, guestCount: 2 },
      expectedStatuses: [200, 201],
    });
  }
  requests.push({
    name: "tabs.read",
    kind: "read",
    method: "GET",
    path: pilotPath(tenant, "tabs"),
    expectedStatuses: [200],
  });
  return requests;
}

export function publicQrRequests(tenant) {
  return [
    {
      name: "public-menu.read",
      kind: "read",
      method: "GET",
      path: tenant.publicMenuPath,
      expectedStatuses: [200],
    },
  ];
}

export function multitenantRequests(ownTenant, foreignTenant) {
  if (
    ownTenant.organizationId === foreignTenant.organizationId &&
    ownTenant.unitId === foreignTenant.unitId
  ) {
    throw new Error("Isolation probe requires distinct tenant scopes");
  }
  return [
    {
      name: "tenant-own-floor.read",
      kind: "read",
      method: "GET",
      path: pilotPath(ownTenant, "floor"),
      expectedStatuses: [200],
    },
    {
      name: "tenant-isolation.probe",
      kind: "read",
      method: "GET",
      path: pilotPath(foreignTenant, "floor"),
      expectedStatuses: [403, 404],
      isolationProbe: true,
    },
  ];
}
