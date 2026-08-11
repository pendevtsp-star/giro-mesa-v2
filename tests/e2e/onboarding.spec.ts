import AxeBuilder from "@axe-core/playwright";
import { expect, type Page, test } from "@playwright/test";

const organizationId = "a1111111-1111-4111-8111-111111111111";
const unitId = "b1111111-1111-4111-8111-111111111111";
const secondUnitId = "b2222222-2222-4222-8222-222222222222";
const planId = "d1111111-1111-4111-8111-111111111111";
const runId = "e1111111-1111-4111-8111-111111111111";
const subscriptionId = "f1111111-1111-4111-8111-111111111111";
const checklistItems = [
  "business",
  "unit",
  "plan",
  "fiscalChoice",
  "catalog",
  "tables",
  "team",
  "qr",
  "production",
  "cashier",
  "training",
  "rehearsal",
] as const;

type Item = (typeof checklistItems)[number];
type ItemStatus = "pending" | "in_progress" | "verified" | "blocked" | "not_applicable";
type ItemEvidence = {
  status: ItemStatus;
  source: "system" | "actor_attestation" | "authorized_waiver";
  evidenceReference?: string | null;
  evidence?: Record<string, unknown>;
  actorIdentityId?: string | null;
  verifiedAt?: string | null;
  waiverReason?: string | null;
};

function pendingItems(): Record<Item, ItemEvidence> {
  return Object.fromEntries(
    checklistItems.map((item) => [item, { status: "pending", source: "system" }]),
  ) as Record<Item, ItemEvidence>;
}

async function enterDemo(page: Page, profile?: "owner" | "waiter") {
  await page.goto("http://127.0.0.1:3112");
  if (profile) await page.getByLabel("Perfil demonstrativo").selectOption(profile);
  await page.getByRole("button", { name: /entrar no giromesa/i }).click();
  await page.getByRole("button", { name: /abrir operação/i }).click();
}

async function openOnboarding(page: Page) {
  const menuButton = page.getByRole("button", { name: "Abrir menu", exact: true });
  if (await menuButton.isVisible()) {
    await menuButton.click();
  }
  await page.getByRole("link", { name: "Configurar operação" }).click();
}

async function expectActiveUnit(page: Page, unitName: string) {
  const menuButton = page.getByRole("button", { name: "Abrir menu", exact: true });
  const openedMenu = await menuButton.isVisible();
  if (openedMenu) await menuButton.click();
  await expect(page.locator(".unit-chip strong")).toHaveText(unitName);
  if (openedMenu) await page.locator(".sidebar__close").click();
}

test("onboarding vazio chega a ativação única somente com readiness do servidor", async ({
  page,
}, testInfo) => {
  const items = pendingItems();
  let selection: Record<string, unknown> | null = null;
  let activatedAt: string | null = null;
  let getAfterSelection = 0;
  let activationCount = 0;
  let idempotencyKey = "";

  const response = () => {
    const missingItems = checklistItems.filter(
      (item) => !["verified", "not_applicable"].includes(items[item].status),
    );
    return {
      organizationId,
      activatedAt,
      items,
      ready: missingItems.length === 0,
      missingItems,
      selection,
      provisioning: activatedAt
        ? {
            id: runId,
            state: "completed",
            checkpoint: "published",
            attempts: 1,
            lastErrorCode: null,
            nextRetryAt: null,
            completedAt: activatedAt,
            failedAt: null,
            createdAt: activatedAt,
            updatedAt: activatedAt,
          }
        : null,
    };
  };

  await page.route(
    `http://localhost:3200/v1/organizations/${organizationId}/onboarding**`,
    async (route) => {
      const request = route.request();
      const url = new URL(request.url());
      if (request.method() === "GET" && url.pathname.endsWith("/onboarding")) {
        if (selection) {
          getAfterSelection += 1;
          for (const item of ["business", "unit", "plan"] as const) {
            items[item] = {
              status: "verified",
              source: "system",
              evidenceReference: `server:${item}`,
              evidence: {},
              verifiedAt: "2026-08-11T10:00:00.000Z",
            };
          }
          if (getAfterSelection >= 2) {
            for (const item of ["catalog", "tables", "team", "cashier"] as const) {
              items[item] = {
                status: "verified",
                source: "system",
                evidenceReference: `server:${item}`,
                evidence: {},
                verifiedAt: "2026-08-11T10:00:00.000Z",
              };
            }
          }
        }
        await route.fulfill({ json: response() });
        return;
      }
      if (request.method() === "PUT" && url.pathname.endsWith("/selection")) {
        expect(request.postDataJSON()).toEqual({
          planSlug: "operacao",
          selectedUnitId: secondUnitId,
          reselect: false,
        });
        selection = {
          selectedUnitId: secondUnitId,
          plan: {
            id: planId,
            slug: "operacao",
            catalogVersion: 1,
            monthlyPriceCents: 0,
            annualPriceCents: 0,
            includedUnits: 1,
            entitlements: [],
          },
          revision: 1,
          selectedAt: "2026-08-11T10:00:00.000Z",
          updatedAt: "2026-08-11T10:00:00.000Z",
        };
        await route.fulfill({ json: selection });
        return;
      }
      if (request.method() === "PATCH" && url.pathname.endsWith("/onboarding")) {
        const body = request.postDataJSON() as { items: Partial<Record<Item, ItemEvidence>> };
        for (const [item, evidence] of Object.entries(body.items) as Array<[Item, ItemEvidence]>) {
          items[item] = {
            ...evidence,
            source:
              evidence.status === "not_applicable" ? "authorized_waiver" : "actor_attestation",
            actorIdentityId: organizationId,
            verifiedAt:
              evidence.status === "verified" || evidence.status === "not_applicable"
                ? "2026-08-11T10:05:00.000Z"
                : null,
          };
        }
        await route.fulfill({ json: response() });
        return;
      }
      if (request.method() === "POST" && url.pathname.endsWith("/activate")) {
        activationCount += 1;
        idempotencyKey = request.headers()["idempotency-key"] ?? "";
        expect(response().ready).toBe(true);
        activatedAt = "2026-08-11T10:10:00.000Z";
        await route.fulfill({
          status: 201,
          json: {
            id: "a2222222-2222-4222-8222-222222222222",
            organizationId,
            commercialPlanId: planId,
            provisioningRunId: runId,
            subscriptionId,
            startsAt: activatedAt,
            endsAt: "2026-08-25T10:10:00.000Z",
            state: "completed",
            entitlements: [],
          },
        });
        return;
      }
      await route.fulfill({
        status: 404,
        json: { statusCode: 404, code: "NOT_FOUND", message: "Not found" },
      });
    },
  );

  await enterDemo(page);
  await openOnboarding(page);
  await expect(page.getByText("0 de 12 requisitos prontos")).toBeVisible();
  await expect(page.getByRole("button", { name: "Ativar trial de 14 dias" })).toBeDisabled();

  await page.getByLabel("Unidade da ativação").selectOption(secondUnitId);
  await page.getByRole("button", { name: "Salvar seleção" }).click();
  await expect(page.getByText("3 de 12 requisitos prontos")).toBeVisible();
  await expectActiveUnit(page, "Aurora Lagoa");
  await page.getByRole("button", { name: "Atualizar status" }).first().click();
  await expect(page.getByText("7 de 12 requisitos prontos")).toBeVisible();

  await page.getByRole("button", { name: "Confirmar escolha fiscal" }).click();
  await page.getByRole("button", { name: "Confirmar produção desligada" }).click();

  const qr = page.locator("article").filter({ hasText: "QR da mesa" });
  await qr.getByText("Solicitar dispensa de QR").click();
  await qr
    .getByLabel("Justificativa auditável")
    .fill("Piloto controlado sem QR físico nesta unidade.");
  await qr.getByLabel(/Entendo que esta unidade/).check();
  await qr.getByRole("button", { name: "Registrar dispensa" }).click();

  const training = page.locator("article").filter({ hasText: "Treinamento" });
  await training.getByRole("checkbox").check();
  await training.getByRole("button", { name: "Confirmar treinamento" }).click();
  const rehearsal = page.locator("article").filter({ hasText: "Ensaio operacional" });
  await rehearsal.getByRole("checkbox").check();
  await rehearsal.getByRole("button", { name: "Confirmar ensaio" }).click();

  await expect(page.getByText("12 de 12 requisitos prontos")).toBeVisible();
  const accessibility = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
    .analyze();
  expect(accessibility.violations).toEqual([]);
  const activation = page.locator(".onboarding-activation");
  await page.evaluate(() => window.scrollTo({ left: 0, top: 0 }));
  expect(
    await page
      .locator(".onboarding-section")
      .evaluateAll((sections) => sections.every((section) => section.scrollLeft === 0)),
  ).toBe(true);
  await page.screenshot({
    path: testInfo.outputPath("onboarding-ready-top.png"),
  });
  await activation.evaluate((element) => {
    const top = element.getBoundingClientRect().top + window.scrollY - 96;
    window.scrollTo({ left: 0, top });
  });
  expect(await page.evaluate(() => window.scrollX)).toBe(0);
  await page.screenshot({
    path: testInfo.outputPath("onboarding-ready-activation.png"),
  });
  await activation.getByRole("checkbox").check();
  await activation.getByRole("button", { name: "Ativar trial de 14 dias" }).click();
  await expect(page.getByRole("heading", { name: "Operação ativada" })).toBeVisible();
  expect(activationCount).toBe(1);
  expect(idempotencyKey.length).toBeGreaterThanOrEqual(8);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
});

test("retoma polling cancelável após reload e conclui a saga existente", async ({ page }) => {
  const items = pendingItems();
  for (const item of checklistItems) {
    items[item] = {
      status: "verified",
      source: "system",
      evidenceReference: `server:${item}`,
      evidence: {},
      verifiedAt: "2026-08-11T10:00:00.000Z",
    };
  }
  let completed = false;
  let statusCalls = 0;
  const provisioning = (state: "publishing" | "completed") => ({
    id: runId,
    state,
    checkpoint: state === "completed" ? "published" : "activation_committed",
    attempts: 1,
    lastErrorCode: null,
    nextRetryAt: null,
    completedAt: state === "completed" ? "2026-08-11T10:10:00.000Z" : null,
    failedAt: null,
    createdAt: "2026-08-11T10:00:00.000Z",
    updatedAt: "2026-08-11T10:10:00.000Z",
  });

  await page.route(
    `http://localhost:3200/v1/organizations/${organizationId}/onboarding**`,
    async (route) => {
      const url = new URL(route.request().url());
      if (url.pathname.endsWith(`/provisioning/${runId}`)) {
        statusCalls += 1;
        if (statusCalls === 1) {
          await route.fulfill({
            status: 503,
            json: {
              statusCode: 503,
              code: "PROVISIONING_TEMPORARILY_UNAVAILABLE",
              message: "Acompanhamento temporariamente indisponível.",
            },
          });
          return;
        }
        completed = true;
        await route.fulfill({ json: { ...provisioning("completed"), steps: [] } });
        return;
      }
      await route.fulfill({
        json: {
          organizationId,
          activatedAt: completed ? "2026-08-11T10:10:00.000Z" : null,
          items,
          ready: true,
          missingItems: [],
          selection: {
            selectedUnitId: unitId,
            plan: {
              id: planId,
              slug: "operacao",
              catalogVersion: 1,
              monthlyPriceCents: 0,
              annualPriceCents: 0,
              includedUnits: 1,
              entitlements: [],
            },
            revision: 1,
            selectedAt: "2026-08-11T10:00:00.000Z",
            updatedAt: "2026-08-11T10:00:00.000Z",
          },
          provisioning: provisioning(completed ? "completed" : "publishing"),
        },
      });
    },
  );

  await enterDemo(page);
  await openOnboarding(page);
  await expect(page.getByText("Publicando conclusão")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Operação ativada" })).toBeVisible({
    timeout: 10_000,
  });
  expect(statusCalls).toBe(2);
});

test("perfil não autorizado vê bloqueio sem request e erro de autorização recebe foco", async ({
  page,
}) => {
  let requestCount = 0;
  await page.route(
    `http://localhost:3200/v1/organizations/${organizationId}/onboarding**`,
    async (route) => {
      requestCount += 1;
      if (route.request().method() === "GET") {
        await route.fulfill({
          status: 200,
          json: {
            organizationId,
            activatedAt: null,
            items: pendingItems(),
            ready: false,
            missingItems: checklistItems,
            selection: null,
            provisioning: null,
          },
        });
        return;
      }
      await route.fulfill({
        status: 403,
        json: { statusCode: 403, code: "FORBIDDEN", message: "Sem acesso ao onboarding." },
      });
    },
  );
  await enterDemo(page, "waiter");
  await page.evaluate(() => {
    window.location.hash = "#/onboarding";
  });
  await expect(page.getByRole("heading", { name: "Acesso restrito" })).toBeVisible();
  expect(requestCount).toBe(0);
  const back = page.getByRole("link", { name: "Voltar à visão geral" });
  await back.focus();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/#\/dashboard$/);

  await page.reload();
  await page.getByLabel("Perfil demonstrativo").selectOption("owner");
  await page.getByRole("button", { name: /entrar no giromesa/i }).click();
  await page.getByRole("button", { name: /abrir operação/i }).click();
  await openOnboarding(page);
  await expect(page.getByText("0 de 12 requisitos prontos")).toBeVisible();
  const fiscalAction = page.getByRole("button", { name: "Confirmar escolha fiscal" });
  await fiscalAction.click();
  const error = page.getByRole("alert");
  await expect(error).toContainText("Sem acesso ao onboarding.");
  await expect(error).toBeFocused();
  await expect(page.getByText("0 de 12 requisitos prontos")).toBeVisible();
  await expect(fiscalAction).toBeDisabled();
  await error.getByRole("button", { name: "Manter em modo de consulta" }).click();
  await expect(error).toBeHidden();
  await expect(fiscalAction).toBeDisabled();
});
