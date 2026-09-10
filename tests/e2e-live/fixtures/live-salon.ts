import { type APIRequestContext, type APIResponse, expect } from "@playwright/test";

export async function responseJson<T>(response: APIResponse): Promise<T> {
  expect(response.ok(), `${response.status()} ${response.url()}: ${await response.text()}`).toBe(
    true,
  );
  return response.json() as Promise<T>;
}

export async function createLiveSalonFixture(
  request: APIRequestContext,
  apiUrl: string,
  internalApiKey: string,
) {
  const suffix = `${Date.now()}-${crypto.randomUUID().slice(0, 8)}`;
  const password = "unified-service-live-password-2026";
  const registration = await responseJson<{ identity: { id: string } }>(
    await request.post(`${apiUrl}/v1/auth/register`, {
      data: {
        email: `unified-service-${suffix}@example.test`,
        name: "Unified Service Owner",
        password,
        termsAccepted: true,
      },
    }),
  );
  const created = await responseJson<{
    organization: { id: string };
    unit: { id: string };
  }>(
    await request.post(`${apiUrl}/v1/organizations`, {
      data: {
        legalName: `Unified Service ${suffix}`,
        tradeName: "Unified Service",
        document: `E2E${Date.now().toString().slice(-9)}83`,
        unitName: "Unidade Atendimento E2E",
        timezone: "America/Sao_Paulo",
      },
    }),
  );
  const { id: organizationId } = created.organization;
  const { id: unitId } = created.unit;
  const pilotUrl = `${apiUrl}/v1/organizations/${organizationId}/units/${unitId}/pilot`;
  await responseJson(
    await request.post(`${apiUrl}/internal/v1/organizations/${organizationId}/billing/events`, {
      headers: { "x-internal-api-key": internalApiKey },
      data: { event: "ACTIVATE_TRIAL" },
    }),
  );

  let floor = await responseJson<{ floorRevision: number }>(await request.get(`${pilotUrl}/floor`));
  const room = await responseJson<{ id: string }>(
    await request.post(`${pilotUrl}/rooms`, {
      data: { name: "Salão E2E", sortOrder: 0, expectedRevision: floor.floorRevision },
    }),
  );
  floor = await responseJson(await request.get(`${pilotUrl}/floor`));
  await responseJson(
    await request.post(`${pilotUrl}/rooms/${room.id}/tables/batch`, {
      data: {
        expectedRevision: floor.floorRevision,
        tables: [
          {
            label: "Mesa Brownie 01",
            seats: 4,
            width: 122,
            height: 76,
            rotation: 0,
            shape: "rectangle",
          },
        ],
      },
    }),
  );
  const configuredFloor = await responseJson<{
    tables: Array<{ id: string; label: string }>;
  }>(await request.get(`${pilotUrl}/floor`));
  const table = configuredFloor.tables.find((candidate) => candidate.label === "Mesa Brownie 01");
  expect(table).toBeTruthy();
  await responseJson(
    await request.post(`${pilotUrl}/service-sections`, {
      data: {
        name: "Praça E2E",
        color: "#176B4D",
        serviceMode: "full_service",
        tableIds: [table?.id],
        defaultResponsibleIdentityId: registration.identity.id,
      },
    }),
  );
  await responseJson(
    await request.post(`${pilotUrl}/shifts/open`, {
      data: {
        label: "Turno E2E",
        serviceMode: "full_service",
        copyPreviousAssignments: true,
      },
    }),
  );

  const catalogUrl = `${pilotUrl}/catalog`;
  const station = await responseJson<{ id: string }>(
    await request.post(`${catalogUrl}/stations`, {
      headers: { "idempotency-key": crypto.randomUUID() },
      data: { name: "Cozinha E2E", code: `cozinha-${suffix}`.slice(0, 40) },
    }),
  );
  const category = await responseJson<{ id: string }>(
    await request.post(`${catalogUrl}/categories`, {
      headers: { "idempotency-key": crypto.randomUUID() },
      data: { name: "Sobremesas", slug: `sobremesas-${suffix}`.slice(0, 80), sortOrder: 0 },
    }),
  );
  await responseJson(
    await request.post(`${catalogUrl}/products`, {
      headers: { "idempotency-key": crypto.randomUUID() },
      data: {
        categoryId: category.id,
        productType: "prepared",
        name: "Brownie E2E",
        priceCents: 1_500,
        available: true,
        stationIds: [station.id],
        allergenIds: [],
        modifierGroupIds: [],
        recipe: [],
      },
    }),
  );

  return {
    apiUrl,
    email: `unified-service-${suffix}@example.test`,
    identityId: registration.identity.id,
    organizationId,
    password,
    pilotUrl,
    tableId: table?.id as string,
    tableLabel: table?.label as string,
    unitId,
  };
}
