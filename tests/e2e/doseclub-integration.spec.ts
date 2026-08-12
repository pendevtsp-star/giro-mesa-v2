import AxeBuilder from "@axe-core/playwright";
import { expect, type Page, test } from "@playwright/test";

const apiBase = "http://localhost:3200";
const organizationId = "a1111111-1111-4111-8111-111111111111";
const unitId = "b1111111-1111-4111-8111-111111111111";
const membershipId = "c3333333-3333-4333-8333-333333333333";
const now = "2026-08-11T12:00:00.000Z";

function run(id: string, status: "completed" | "pending" = "completed") {
  return {
    id,
    unitId,
    runDate: "2026-08-11",
    trigger: "manual",
    status,
    findingCount: 1,
    failureCode: null,
    version: 1,
    startedAt: now,
    completedAt: status === "completed" ? now : null,
    createdAt: now,
    updatedAt: now,
  };
}

async function installGrowthFixture(page: Page) {
  const initialRun = run("c1111111-1111-4111-8111-111111111111");
  let runs = [initialRun];
  await page.route(`${apiBase}/**`, async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname;
    if (path === "/v1/auth/me") {
      await route.fulfill({
        json: {
          identity: {
            id: "d3333333-3333-4333-8333-333333333333",
            email: "owner@example.test",
            displayName: "Marina Costa",
          },
          memberships: [{ membershipId, organizationId, status: "active" }],
          platformAdmin: false,
        },
      });
      return;
    }
    if (path === "/v1/organizations") {
      await route.fulfill({
        json: [
          {
            membershipId,
            organization: {
              id: organizationId,
              tradeName: "Grupo Aurora",
              document: "00000000000100",
            },
            units: [
              {
                id: unitId,
                name: "Aurora Centro",
                active: true,
                timezone: "America/Sao_Paulo",
              },
            ],
            scopes: [{ role: "owner", unitId: null }],
          },
        ],
      });
      return;
    }
    if (path.endsWith("/growth/customers") || path.endsWith("/growth/campaigns")) {
      await route.fulfill({ json: [] });
      return;
    }
    if (path.endsWith("/growth/integrations/doseclub/overview")) {
      expect(url.searchParams.get("unitId")).toBe(unitId);
      await route.fulfill({
        json: {
          integration: { provider: "doseclub", status: "active", unitId, updatedAt: now },
          reconciliation: {
            status: "attention",
            remoteHeartbeat: "partial",
            lastRun: runs[0] ?? null,
            openFindingCount: 1,
          },
          mappings: [
            {
              id: "d1111111-1111-4111-8111-111111111111",
              unitId,
              externalProductId: "e1111111-1111-4111-8111-111111111111",
              productId: "e1111111-1111-4111-8111-111111111111",
              productName: "Whisky da casa",
              inventoryItemId: "f1111111-1111-4111-8111-111111111111",
              inventoryItemName: "Whisky em mililitros",
              stockLocationId: "a2222222-2222-4222-8222-222222222222",
              stockLocationName: "Bar principal",
              active: true,
              version: 2,
              updatedAt: now,
            },
          ],
          findings: [
            {
              id: "b2222222-2222-4222-8222-222222222222",
              unitId,
              kind: "state_version_gap",
              status: "open",
              severity: "critical",
              entityType: "doseclub_state",
              entityId: "club-123",
              summary: "A versão recebida não é consecutiva.",
              evidence: { expectedVersion: 4, receivedVersion: 6 },
              firstDetectedAt: now,
              lastDetectedAt: now,
              resolvedAt: null,
              version: 1,
            },
          ],
          runs,
        },
      });
      return;
    }
    if (path.endsWith("/growth/integrations/doseclub/runs") && request.method() === "POST") {
      expect(request.headers()["idempotency-key"]).toBeTruthy();
      expect(request.postDataJSON()).toEqual({ unitId });
      const accepted = run("c2222222-2222-4222-8222-222222222222", "pending");
      runs = [accepted, ...runs];
      await route.fulfill({ status: 202, json: accepted });
      return;
    }
    await route.fulfill({
      status: 404,
      json: { code: "TEST_ROUTE_NOT_IMPLEMENTED", message: `Sem fixture para ${path}` },
    });
  });
}

test("exibe estado real, passa Axe e confirma uma nova execução somente após refetch", async ({
  page,
}) => {
  await installGrowthFixture(page);
  await page.goto("http://127.0.0.1:3213");
  await page.getByRole("button", { name: /abrir operação/i }).click();
  await page.getByRole("link", { name: "Clientes e campanhas" }).click();

  const panel = page.getByRole("region", { name: "DoseClub e estoque físico" });
  await expect(panel.getByText("Whisky em mililitros")).toBeVisible();
  await expect(panel.getByText("A versão recebida não é consecutiva.")).toBeVisible();
  await expect(panel.getByText("Ativa", { exact: true })).toBeVisible();
  await expect(panel.getByText(/retorno remoto.*parcial/i)).toBeVisible();
  await expect(panel.getByText(/requeue/i)).toHaveCount(0);

  const accessibility = await new AxeBuilder({ page }).include(".doseclub-panel").analyze();
  expect(accessibility.violations).toEqual([]);

  await panel.screenshot({
    path: ".superpowers/screenshots/task32-doseclub-desktop.png",
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.reload();
  await page.getByRole("button", { name: /abrir operação/i }).click();
  await expect(panel.getByText("Whisky em mililitros")).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({
    fullPage: true,
    path: ".superpowers/screenshots/task32-doseclub-mobile.png",
  });

  await panel.getByRole("button", { name: "Reexecutar verificação" }).click();
  await expect(panel.getByRole("status")).toContainText("confirmada no histórico persistido");
  await expect(panel.getByText("Aguardando processamento").first()).toBeVisible();
});
