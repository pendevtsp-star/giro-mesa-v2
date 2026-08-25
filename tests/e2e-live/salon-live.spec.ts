import { type APIResponse, expect, test } from "@playwright/test";

const apiUrl = "http://127.0.0.1:3216";

async function json<T>(response: APIResponse): Promise<T> {
  expect(response.ok(), `${response.status()} ${response.url()}: ${await response.text()}`).toBe(
    true,
  );
  return response.json() as Promise<T>;
}

test("opera, unifica, divide e imprime com API compilada e PostgreSQL reais", async ({ page }) => {
  const suffix = `${Date.now()}-${crypto.randomUUID().slice(0, 8)}`;
  const password = "salon-live-password-2026";
  const registration = await json<{ identity: { id: string } }>(
    await page.request.post(`${apiUrl}/v1/auth/register`, {
      data: {
        email: `salon-live-${suffix}@example.test`,
        name: "Salon Live Owner",
        password,
        termsAccepted: true,
      },
    }),
  );
  const created = await json<{
    organization: { id: string };
    unit: { id: string };
  }>(
    await page.request.post(`${apiUrl}/v1/organizations`, {
      data: {
        legalName: `Salon Live ${suffix}`,
        tradeName: "Salon Live",
        document: `E2E${Date.now().toString().slice(-9)}01`,
        unitName: "Unidade Salão E2E",
        timezone: "America/Sao_Paulo",
      },
    }),
  );
  const organizationId = created.organization.id;
  const unitId = created.unit.id;
  const pilotUrl = `${apiUrl}/v1/organizations/${organizationId}/units/${unitId}/pilot`;
  const catalogUrl = `${pilotUrl}/catalog`;
  await json(
    await page.request.post(
      `${apiUrl}/internal/v1/organizations/${organizationId}/billing/events`,
      {
        headers: { "x-internal-api-key": "salon-live-internal-key" },
        data: { event: "ACTIVATE_TRIAL" },
      },
    ),
  );

  let floor = await json<{ floorRevision: number }>(await page.request.get(`${pilotUrl}/floor`));
  const room = await json<{ id: string }>(
    await page.request.post(`${pilotUrl}/rooms`, {
      data: { name: "Salão Live", sortOrder: 0, expectedRevision: floor.floorRevision },
    }),
  );
  floor = await json(await page.request.get(`${pilotUrl}/floor`));
  await json(
    await page.request.post(`${pilotUrl}/rooms/${room.id}/tables/batch`, {
      data: {
        expectedRevision: floor.floorRevision,
        tables: ["Mesa Live 01", "Mesa Live 02"].map((label) => ({
          label,
          seats: 4,
          width: 122,
          height: 76,
          rotation: 0,
          shape: "rectangle",
        })),
      },
    }),
  );
  const configuredFloor = await json<{
    tables: Array<{ id: string; label: string }>;
  }>(await page.request.get(`${pilotUrl}/floor`));
  const tableIds = configuredFloor.tables.map((table) => table.id);
  await json(
    await page.request.post(`${pilotUrl}/service-sections`, {
      data: {
        name: "Praça Live",
        color: "#176B4D",
        serviceMode: "full_service",
        tableIds,
        defaultResponsibleIdentityId: registration.identity.id,
      },
    }),
  );
  await json(
    await page.request.post(`${pilotUrl}/shifts/open`, {
      data: {
        label: "Turno Live",
        serviceMode: "full_service",
        copyPreviousAssignments: true,
      },
    }),
  );

  const headers = { "idempotency-key": crypto.randomUUID() };
  const station = await json<{ id: string }>(
    await page.request.post(`${catalogUrl}/stations`, {
      headers,
      data: { name: "Cozinha Live", code: `cozinha-${suffix}`.slice(0, 40) },
    }),
  );
  const category = await json<{ id: string }>(
    await page.request.post(`${catalogUrl}/categories`, {
      headers: { "idempotency-key": crypto.randomUUID() },
      data: { name: "Live", slug: `live-${suffix}`.slice(0, 80), sortOrder: 0 },
    }),
  );
  await json(
    await page.request.post(`${catalogUrl}/products`, {
      headers: { "idempotency-key": crypto.randomUUID() },
      data: {
        categoryId: category.id,
        productType: "prepared",
        name: "Item Live",
        priceCents: 1_000,
        available: true,
        stationIds: [station.id],
        allergenIds: [],
        modifierGroupIds: [],
        recipe: [],
      },
    }),
  );

  await page.addInitScript(
    ({ identityId, organizationId, unitId }) => {
      localStorage.setItem(
        "giromesa_operational_scope_v1",
        JSON.stringify({ identityId, organizationId, unitId }),
      );
    },
    { identityId: registration.identity.id, organizationId, unitId },
  );
  await page.goto("/#/salon");
  await expect(page.getByRole("heading", { name: "Mesas e comandas" })).toBeVisible();
  const openOperation = page.getByRole("button", { name: "Abrir operação" });
  if (await openOperation.isVisible()) await openOperation.click();

  const openTable = async (label: string) => {
    await page.locator(".real-table").filter({ hasText: label }).click();
    const dialog = page.getByRole("dialog", { name: label });
    await dialog.getByRole("button", { name: "Abrir atendimento e pedir" }).click();
    await expect(dialog.getByRole("button", { name: "Conta", exact: true })).toBeVisible({
      timeout: 15_000,
    });
    return dialog;
  };

  const firstDialog = await openTable("Mesa Live 01");
  await firstDialog.getByRole("button", { name: "Adicionar Item Live", exact: true }).click();
  await firstDialog.getByRole("button", { name: /Enviar 1 item/ }).click();
  await expect(firstDialog.getByText(/Pedido enviado/)).toBeVisible();
  await page.keyboard.press("Escape");

  await openTable("Mesa Live 02");
  await page.keyboard.press("Escape");

  await page.getByRole("button", { name: "Juntar mesas", exact: true }).click();
  await page.locator(".real-table").filter({ hasText: "Mesa Live 01" }).click();
  await page.locator(".real-table").filter({ hasText: "Mesa Live 02" }).click();
  await page.getByRole("button", { name: "Configurar junção" }).click();
  const joinDialog = page.getByRole("dialog", { name: "Organizar mesas selecionadas" });
  await joinDialog.getByRole("radio", { name: /Usar uma única comanda/ }).check();
  await joinDialog.getByRole("button", { name: "Juntar e unificar comandas" }).click();
  await expect(joinDialog).toBeHidden();
  await expect(
    page.getByText("Mesas agrupadas com uma única comanda.", { exact: true }),
  ).toBeVisible();

  const accountDialog = page.getByRole("dialog", { name: "Mesa Live 01" });
  await expect(accountDialog).toBeVisible();
  await accountDialog.getByRole("button", { name: "Conta", exact: true }).click();
  const adjustments = accountDialog.locator("details.ops-actions");
  if (!(await adjustments.evaluate((element) => (element as HTMLDetailsElement).open))) {
    await adjustments.getByText("Receber pagamento e fazer ajustes", { exact: true }).click();
  }
  const splitForm = accountDialog.locator("form").filter({ hasText: "Separar item" });
  await splitForm.scrollIntoViewIfNeeded();
  await expect(splitForm).toBeVisible();
  await splitForm.locator("select").selectOption({ index: 1 });
  await splitForm.getByRole("button", { name: "Separar", exact: true }).click();
  await expect(accountDialog.getByText(/Item separado em nova comanda/)).toBeVisible();

  await accountDialog.getByRole("button", { name: "Pedir conta e imprimir" }).click();
  await accountDialog.getByRole("button", { name: "Imprimir agora" }).first().click();
  await expect(accountDialog.getByText(/confirme o papel/i)).toBeVisible();
  await expect(accountDialog.getByRole("button", { name: "Confirmar saída física" })).toBeVisible();

  await page.reload();
  await expect(page.getByRole("dialog", { name: "Mesa Live 01" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Conta", exact: true })).toHaveAttribute(
    "aria-current",
    "page",
  );

  await page.context().setOffline(true);
  await expect(page.getByText("Operação sem conexão", { exact: true })).toBeVisible();
  await page.context().setOffline(false);
  await expect(page.getByText("Operação sem conexão", { exact: true })).toBeHidden();
});
