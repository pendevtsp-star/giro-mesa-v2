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
  source: "system" | "actor_attestation" | "authorized_waiver" | "legacy_import";
  evidenceReference: string | null;
  evidence: Record<string, unknown>;
  actorIdentityId: string | null;
  verifiedAt: string | null;
  waiverReason: string | null;
};

function itemEvidence(
  status: ItemStatus,
  source: ItemEvidence["source"] = "system",
  overrides: Partial<ItemEvidence> = {},
): ItemEvidence {
  return {
    status,
    source,
    evidenceReference: null,
    evidence: {},
    actorIdentityId: null,
    verifiedAt: null,
    waiverReason: null,
    ...overrides,
  };
}

function pendingItems(): Record<Item, ItemEvidence> {
  return Object.fromEntries(
    checklistItems.map((item) => [item, itemEvidence("pending")]),
  ) as Record<Item, ItemEvidence>;
}

function verifiedItems(): Record<Item, ItemEvidence> {
  return Object.fromEntries(
    checklistItems.map((item) => [
      item,
      itemEvidence("verified", "system", {
        evidenceReference: `server:${item}`,
        verifiedAt: "2026-08-11T10:00:00.000Z",
      }),
    ]),
  ) as Record<Item, ItemEvidence>;
}

function selectedPlan(revision = 1, selectedUnitId = unitId) {
  return {
    selectedUnitId,
    plan: {
      id: planId,
      slug: "operacao",
      catalogVersion: 1,
      monthlyPriceCents: 0,
      annualPriceCents: 0,
      includedUnits: 1,
      entitlements: [],
    },
    revision,
    selectedAt: "2026-08-11T10:00:00.000Z",
    updatedAt: "2026-08-11T10:00:00.000Z",
  } as const;
}

function onboardingSnapshot({
  items = pendingItems(),
  selection = null,
  provisioning = null,
  activatedAt = null,
}: {
  items?: Record<Item, ItemEvidence>;
  selection?: ReturnType<typeof selectedPlan> | null;
  provisioning?: Record<string, unknown> | null;
  activatedAt?: string | null;
} = {}) {
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
    provisioning,
  };
}

async function enterDemo(
  page: Page,
  profile?: "owner" | "manager" | "waiter",
  selectedUnitId?: string,
) {
  await page.goto("http://127.0.0.1:3112");
  if (profile) await page.getByLabel("Perfil demonstrativo").selectOption(profile);
  await page.getByRole("button", { name: /entrar no giromesa/i }).click();
  if (selectedUnitId)
    await page.getByLabel("Unidade", { exact: true }).selectOption(selectedUnitId);
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
  await expect(page.locator(".unit-chip strong")).toContainText(unitName);
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
            items[item] = itemEvidence("verified", "system", {
              evidenceReference: `server:${item}`,
              verifiedAt: "2026-08-11T10:00:00.000Z",
            });
          }
          if (getAfterSelection >= 2) {
            for (const item of ["catalog", "tables", "team", "cashier"] as const) {
              items[item] = itemEvidence("verified", "system", {
                evidenceReference: `server:${item}`,
                verifiedAt: "2026-08-11T10:00:00.000Z",
              });
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
          items[item] = itemEvidence(
            evidence.status,
            evidence.status === "not_applicable" ? "authorized_waiver" : "actor_attestation",
            {
              ...evidence,
              actorIdentityId: organizationId,
              verifiedAt:
                evidence.status === "verified" || evidence.status === "not_applicable"
                  ? "2026-08-11T10:05:00.000Z"
                  : null,
            },
          );
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

test("recarrega de verdade, repete a mesma chave e a remove somente no snapshot terminal", async ({
  page,
}) => {
  const items = pendingItems();
  for (const item of checklistItems) {
    items[item] = itemEvidence("verified", "system", {
      evidenceReference: `server:${item}`,
      verifiedAt: "2026-08-11T10:00:00.000Z",
    });
  }
  let completed = false;
  const activationKeys: string[] = [];
  const selection = {
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
  };

  await page.route(
    `http://localhost:3200/v1/organizations/${organizationId}/onboarding**`,
    async (route) => {
      const url = new URL(route.request().url());
      if (route.request().method() === "POST" && url.pathname.endsWith("/activate")) {
        activationKeys.push(route.request().headers()["idempotency-key"] ?? "");
        if (activationKeys.length === 1) {
          await route.fulfill({
            status: 500,
            json: {
              statusCode: 500,
              code: "PROVISIONING_TRANSIENT_FAILURE",
              message: "A tentativa foi preservada e pode ser retomada.",
            },
          });
          return;
        }
        completed = true;
        await route.fulfill({
          status: 201,
          json: {
            id: "a2222222-2222-4222-8222-222222222222",
            organizationId,
            commercialPlanId: planId,
            provisioningRunId: runId,
            subscriptionId,
            startsAt: "2026-08-11T10:10:00.000Z",
            endsAt: "2026-08-25T10:10:00.000Z",
            state: "completed",
            entitlements: [],
          },
        });
        return;
      }
      await route.fulfill({
        json: {
          organizationId,
          activatedAt: completed ? "2026-08-11T10:10:00.000Z" : null,
          items,
          ready: true,
          missingItems: [],
          selection,
          provisioning: completed
            ? {
                id: runId,
                state: "completed",
                checkpoint: "published",
                attempts: 2,
                lastErrorCode: null,
                nextRetryAt: null,
                completedAt: "2026-08-11T10:10:00.000Z",
                failedAt: null,
                createdAt: "2026-08-11T10:00:00.000Z",
                updatedAt: "2026-08-11T10:10:00.000Z",
              }
            : null,
        },
      });
    },
  );

  await enterDemo(page);
  await openOnboarding(page);
  const activation = page.locator(".onboarding-activation");
  await activation.getByRole("checkbox").check();
  await activation.getByRole("button", { name: "Ativar trial de 14 dias" }).click();
  await expect(page.getByRole("alert")).toContainText(
    "A tentativa pode ser retomada com segurança",
  );
  const storedKey = await page.evaluate(
    (key) => sessionStorage.getItem(key),
    `giromesa:onboarding:activation:${organizationId}`,
  );
  expect(storedKey?.length).toBeGreaterThanOrEqual(8);

  await page.reload();
  await enterDemo(page);
  await openOnboarding(page);
  await activation.getByRole("checkbox").check();
  await activation.getByRole("button", { name: "Ativar trial de 14 dias" }).click();
  await expect(page.getByRole("heading", { name: "Operação ativada" })).toBeVisible({
    timeout: 10_000,
  });
  expect(activationKeys).toEqual([storedKey, storedKey]);
  expect(
    await page.evaluate(
      (key) => sessionStorage.getItem(key),
      `giromesa:onboarding:activation:${organizationId}`,
    ),
  ).toBeNull();

  await page.evaluate(({ key, value }) => sessionStorage.setItem(key, value), {
    key: `giromesa:onboarding:activation:${organizationId}`,
    value: "stale-terminal-replay-key",
  });
  await page.reload();
  await enterDemo(page);
  await openOnboarding(page);
  await expect(page.getByRole("heading", { name: "Operação ativada" })).toBeVisible();
  expect(
    await page.evaluate(
      (key) => sessionStorage.getItem(key),
      `giromesa:onboarding:activation:${organizationId}`,
    ),
  ).toBeNull();
});

test("manager da unidade A não recebe o onboarding pinado na unidade B", async ({ page }) => {
  const methods: string[] = [];
  await page.route(
    `http://localhost:3200/v1/organizations/${organizationId}/onboarding**`,
    async (route) => {
      methods.push(route.request().method());
      await route.fulfill({
        status: 403,
        json: {
          statusCode: 403,
          code: "ONBOARDING_UNIT_SCOPE_DENIED",
          message: "O onboarding selecionado pertence a outra unidade.",
        },
      });
    },
  );

  await enterDemo(page, "manager");
  await openOnboarding(page);
  await expect(
    page.getByRole("heading", { name: "O onboarding ainda não pôde ser carregado" }),
  ).toBeVisible();
  await expect(page.getByText("O onboarding selecionado pertence a outra unidade.")).toBeVisible();
  await expectActiveUnit(page, "Aurora Centro");
  expect(methods.length).toBeGreaterThanOrEqual(1);
  expect(methods.every((method) => method === "GET")).toBe(true);
});

test("PATCH 400 associa somente erros seguros ao campo e foca o primeiro inválido", async ({
  page,
}) => {
  await page.route(
    `http://localhost:3200/v1/organizations/${organizationId}/onboarding**`,
    async (route) => {
      if (route.request().method() === "GET") {
        await route.fulfill({ json: onboardingSnapshot() });
        return;
      }
      await route.fulfill({
        status: 400,
        json: {
          statusCode: 400,
          code: "VALIDATION_ERROR",
          message: "Dados inválidos.",
          details: {
            fieldErrors: {
              "items.fiscalChoice.evidence.choice": ["Valor inválido."],
              "items.fiscalChoice.evidence": ["Campo não permitido."],
            },
          },
        },
      });
    },
  );

  await enterDemo(page);
  await openOnboarding(page);
  await page.getByRole("button", { name: "Confirmar escolha fiscal" }).click();
  const fiscal = page.getByLabel("Modo fiscal real");
  await expect(fiscal).toHaveAttribute("aria-invalid", "true");
  await expect(fiscal).toHaveAttribute("aria-describedby", "onboarding-fiscal-error");
  await expect(page.getByText("Valor inválido.")).toBeVisible();
  await expect(fiscal).toBeFocused();
});

test("matriz 404, 409 e 429 permanece pública e recuperável", async ({ page }) => {
  let mode: "not-found" | "conflict" | "rate-limit" = "not-found";
  await page.route(
    `http://localhost:3200/v1/organizations/${organizationId}/onboarding**`,
    async (route) => {
      const request = route.request();
      if (request.method() === "GET") {
        if (mode === "not-found") {
          await route.fulfill({
            status: 404,
            json: {
              statusCode: 404,
              code: "ONBOARDING_NOT_FOUND",
              message: "Onboarding não encontrado.",
            },
          });
        } else {
          await route.fulfill({ json: onboardingSnapshot() });
        }
        return;
      }
      if (mode === "conflict") {
        await route.fulfill({
          status: 409,
          json: {
            statusCode: 409,
            code: "ONBOARDING_RESELECT_REQUIRED",
            message: "Confirme explicitamente a troca.",
          },
        });
        return;
      }
      await route.fulfill({
        status: 429,
        json: {
          statusCode: 429,
          code: "RATE_LIMITED",
          message: "Muitas tentativas.",
        },
      });
    },
  );

  await enterDemo(page);
  await openOnboarding(page);
  await expect(page.getByText("Onboarding não encontrado.")).toBeVisible();

  mode = "conflict";
  await page.getByRole("button", { name: "Tentar novamente" }).click();
  await expect(page.getByText("0 de 12 requisitos prontos")).toBeVisible();
  await page.getByRole("button", { name: "Salvar seleção" }).click();
  await expect(page.getByRole("alert")).toContainText("Confirme explicitamente a troca.");

  mode = "rate-limit";
  await page.getByRole("button", { name: "Confirmar escolha fiscal" }).click();
  await expect(page.getByRole("alert")).toContainText("Aguarde antes de repetir esta ação");
});

test("401 limpa a sessão visual no mesmo turno", async ({ page }) => {
  await page.route(
    `http://localhost:3200/v1/organizations/${organizationId}/onboarding**`,
    async (route) => {
      if (route.request().method() === "GET") {
        await route.fulfill({ json: onboardingSnapshot() });
        return;
      }
      await route.fulfill({
        status: 401,
        json: { statusCode: 401, code: "SESSION_EXPIRED", message: "Sessão expirada." },
      });
    },
  );

  await enterDemo(page);
  await openOnboarding(page);
  await page.getByRole("button", { name: "Confirmar escolha fiscal" }).click();
  await expect(page.getByRole("button", { name: /entrar no giromesa/i })).toBeVisible();
});

test("aborta GET obsoleto e preserva a revisão mais nova", async ({ page }) => {
  let getCalls = 0;
  const newerItems = pendingItems();
  newerItems.business = itemEvidence("verified", "system", {
    evidenceReference: "server:business:new",
    verifiedAt: "2026-08-11T10:00:00.000Z",
  });
  await page.route(
    `http://localhost:3200/v1/organizations/${organizationId}/onboarding**`,
    async (route) => {
      if (route.request().method() !== "GET") {
        await route.fulfill({
          status: 404,
          json: { statusCode: 404, code: "NOT_FOUND", message: "Not found" },
        });
        return;
      }
      getCalls += 1;
      if (getCalls === 2) {
        await new Promise((resolve) => setTimeout(resolve, 700));
        await route.fulfill({ json: onboardingSnapshot() }).catch(() => undefined);
        return;
      }
      await route.fulfill({
        json: onboardingSnapshot({ items: getCalls >= 3 ? newerItems : pendingItems() }),
      });
    },
  );

  await enterDemo(page);
  await openOnboarding(page);
  const refreshButtons = page.getByRole("button", { name: "Atualizar status" });
  await refreshButtons.first().click();
  await refreshButtons.nth(1).click();
  await expect(page.getByText("1 de 12 requisitos prontos")).toBeVisible();
  await page.waitForTimeout(800);
  await expect(page.getByText("1 de 12 requisitos prontos")).toBeVisible();
});

test("ordena GET e PATCH em ambos os sentidos sem rebaixar a revisão", async ({ page }) => {
  const fiscalOnly = pendingItems();
  fiscalOnly.fiscalChoice = itemEvidence("verified", "actor_attestation", {
    evidenceReference: "actor:fiscal:old",
    evidence: { choice: "disabled" },
    verifiedAt: "2026-08-11T10:01:00.000Z",
  });
  const serverRevision = pendingItems();
  serverRevision.business = itemEvidence("verified", "system", {
    evidenceReference: "server:business:new",
    verifiedAt: "2026-08-11T10:02:00.000Z",
  });
  serverRevision.catalog = itemEvidence("verified", "system", {
    evidenceReference: "server:catalog:new",
    verifiedAt: "2026-08-11T10:02:00.000Z",
  });
  const mutationRevision = structuredClone(serverRevision);
  mutationRevision.fiscalChoice = itemEvidence("verified", "actor_attestation", {
    evidenceReference: "actor:fiscal:new",
    evidence: { choice: "disabled" },
    verifiedAt: "2026-08-11T10:03:00.000Z",
  });
  let getCalls = 0;
  let patchCalls = 0;
  let releaseFirstPatch: (() => void) | undefined;
  const firstPatchMayFinish = new Promise<void>((resolve) => {
    releaseFirstPatch = resolve;
  });
  let markFirstPatchStarted: (() => void) | undefined;
  const firstPatchStarted = new Promise<void>((resolve) => {
    markFirstPatchStarted = resolve;
  });
  let releaseThirdGet: (() => void) | undefined;
  const thirdGetMayFinish = new Promise<void>((resolve) => {
    releaseThirdGet = resolve;
  });
  let markThirdGetStarted: (() => void) | undefined;
  const thirdGetStarted = new Promise<void>((resolve) => {
    markThirdGetStarted = resolve;
  });

  await page.route(
    `http://localhost:3200/v1/organizations/${organizationId}/onboarding**`,
    async (route) => {
      if (route.request().method() === "GET") {
        getCalls += 1;
        if (getCalls === 3) {
          markThirdGetStarted?.();
          await thirdGetMayFinish;
        }
        await route.fulfill({
          json: onboardingSnapshot({
            items: getCalls === 1 ? pendingItems() : serverRevision,
            selection: selectedPlan(getCalls === 1 ? 1 : 3),
          }),
        });
        return;
      }
      if (route.request().method() === "PATCH") {
        patchCalls += 1;
        if (patchCalls === 1) {
          markFirstPatchStarted?.();
          await firstPatchMayFinish;
          await route.fulfill({
            json: onboardingSnapshot({ items: fiscalOnly, selection: selectedPlan(2) }),
          });
          return;
        }
        await route.fulfill({
          json: onboardingSnapshot({ items: mutationRevision, selection: selectedPlan(4) }),
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
  const fiscalAction = page.getByRole("button", { name: "Confirmar escolha fiscal" });
  await fiscalAction.click();
  await firstPatchStarted;
  await page
    .getByRole("button", { name: "Atualizar status" })
    .first()
    .evaluate((button) => {
      (button as HTMLButtonElement).disabled = false;
      button.click();
    });
  await expect(page.getByText("2 de 12 requisitos prontos")).toBeVisible();
  releaseFirstPatch?.();
  await page.waitForTimeout(150);
  await expect(page.getByText("2 de 12 requisitos prontos")).toBeVisible();

  await page.getByRole("button", { name: "Atualizar status" }).first().click();
  await thirdGetStarted;
  await fiscalAction.click();
  await expect(page.getByText("3 de 12 requisitos prontos")).toBeVisible();
  releaseThirdGet?.();
  await page.waitForTimeout(150);
  await expect(page.getByText("3 de 12 requisitos prontos")).toBeVisible();
});

test("invalida confirmações quando readiness, revisão ou motivo mudam", async ({ page }) => {
  let revision = 1;
  let items = verifiedItems();
  await page.route(
    `http://localhost:3200/v1/organizations/${organizationId}/onboarding**`,
    async (route) => {
      await route.fulfill({
        json: onboardingSnapshot({ items, selection: selectedPlan(revision) }),
      });
    },
  );

  await enterDemo(page);
  await openOnboarding(page);
  const activation = page.locator(".onboarding-activation");
  await activation.getByRole("checkbox").check();
  await expect(activation.getByRole("checkbox")).toBeChecked();

  items = verifiedItems();
  items.qr = itemEvidence("blocked", "system", {
    evidenceReference: "unit:qr-readiness",
  });
  revision = 2;
  await page.getByRole("button", { name: "Atualizar status" }).first().click();
  await expect(activation.getByRole("checkbox")).not.toBeChecked();

  const qr = page.locator("article").filter({ hasText: "QR da mesa" });
  await qr.getByText("Solicitar dispensa de QR").click();
  await qr.getByLabel("Justificativa auditável").fill("Piloto controlado sem QR na nova revisão.");
  await qr.getByLabel(/Entendo que esta unidade/).check();
  await qr.getByLabel("Motivo").selectOption("external_qr");
  await expect(qr.getByLabel(/Entendo que esta unidade/)).not.toBeChecked();
  await qr.getByLabel(/Entendo que esta unidade/).check();

  revision = 3;
  await page.getByRole("button", { name: "Atualizar prova do servidor" }).click();
  await qr.getByText("Solicitar dispensa de QR").click();
  await expect(qr.getByLabel("Justificativa auditável")).toHaveValue("");
  await expect(qr.getByLabel(/Entendo que esta unidade/)).not.toBeChecked();
});

test("cancela polling antigo ao desmontar e não mistura runs", async ({ page }) => {
  const runB = "e2222222-2222-4222-8222-222222222222";
  let reopened = false;
  let markStatusStarted: (() => void) | undefined;
  const statusStarted = new Promise<void>((resolve) => {
    markStatusStarted = resolve;
  });
  const summary = (id: string, state: "publishing" | "completed") => ({
    id,
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
        markStatusStarted?.();
        await new Promise((resolve) => setTimeout(resolve, 700));
        await route
          .fulfill({
            json: {
              ...summary(runId, "completed"),
              state: "terminal_failed",
              checkpoint: "activation_committed",
              completedAt: null,
              failedAt: "2026-08-11T10:10:00.000Z",
              steps: [],
            },
          })
          .catch(() => undefined);
        return;
      }
      await route.fulfill({
        json: onboardingSnapshot({
          items: verifiedItems(),
          selection: selectedPlan(reopened ? 2 : 1),
          provisioning: summary(reopened ? runB : runId, reopened ? "completed" : "publishing"),
          activatedAt: reopened ? "2026-08-11T10:10:00.000Z" : null,
        }),
      });
    },
  );

  await enterDemo(page);
  await openOnboarding(page);
  await statusStarted;
  await page.evaluate(() => {
    window.location.hash = "#/dashboard";
  });
  reopened = true;
  await openOnboarding(page);
  await expect(page.getByRole("heading", { name: "Operação ativada" })).toBeVisible();
  await expect(page.getByText("Ativação concluída")).toBeVisible();
  await page.waitForTimeout(800);
  await expect(page.getByText("Ativação concluída")).toBeVisible();
});

test("aborta body 503 atrasado quando GET troca revisão e run", async ({ page }) => {
  const runB = "e2222222-2222-4222-8222-222222222222";
  const summary = (id: string, state: "publishing" | "completed") => ({
    id,
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
  const initial = onboardingSnapshot({
    items: verifiedItems(),
    selection: selectedPlan(1),
    provisioning: summary(runId, "publishing"),
  });
  const next = onboardingSnapshot({
    items: verifiedItems(),
    selection: selectedPlan(2),
    provisioning: summary(runB, "completed"),
    activatedAt: "2026-08-11T10:10:00.000Z",
  });
  await page.addInitScript(
    ({ initialSnapshot, nextSnapshot, organization, oldRun }) => {
      const browserWindow = window as typeof window & {
        __pollBodyStarted?: boolean;
        __useNextOnboardingSnapshot?: boolean;
      };
      const originalFetch = window.fetch.bind(window);
      window.fetch = async (input, init) => {
        const url = new URL(typeof input === "string" ? input : input.url, window.location.href);
        if (!url.pathname.includes(`/v1/organizations/${organization}/onboarding`)) {
          return originalFetch(input, init);
        }
        if (url.pathname.endsWith(`/provisioning/${oldRun}`)) {
          let settled = false;
          const body = new ReadableStream({
            start(controller) {
              browserWindow.__pollBodyStarted = true;
              init?.signal?.addEventListener(
                "abort",
                () => {
                  settled = true;
                  controller.error(new DOMException("The operation was aborted.", "AbortError"));
                },
                { once: true },
              );
              window.setTimeout(() => {
                if (settled) return;
                settled = true;
                controller.enqueue(
                  new TextEncoder().encode(
                    JSON.stringify({
                      statusCode: 503,
                      code: "PROVISIONING_TRANSIENT_FAILURE",
                      message: "Erro antigo não pode contaminar o run novo.",
                    }),
                  ),
                );
                controller.close();
              }, 1_500);
            },
          });
          return new Response(body, {
            status: 503,
            headers: { "content-type": "application/json" },
          });
        }
        if ((init?.method ?? "GET") === "GET") {
          return Response.json(
            browserWindow.__useNextOnboardingSnapshot ? nextSnapshot : initialSnapshot,
          );
        }
        return Response.json(
          { statusCode: 404, code: "NOT_FOUND", message: "Not found" },
          { status: 404 },
        );
      };
    },
    { initialSnapshot: initial, nextSnapshot: next, organization: organizationId, oldRun: runId },
  );

  await enterDemo(page);
  await openOnboarding(page);
  await page.waitForFunction(() => {
    return (window as typeof window & { __pollBodyStarted?: boolean }).__pollBodyStarted === true;
  });
  await page.evaluate(() => {
    (
      window as typeof window & { __useNextOnboardingSnapshot?: boolean }
    ).__useNextOnboardingSnapshot = true;
  });
  const refreshCurrentRun = page
    .locator("button:not([disabled])")
    .filter({ hasText: "Atualizar status" })
    .first();
  await expect(refreshCurrentRun).toBeEnabled();
  await refreshCurrentRun.click();
  await expect(page.getByRole("heading", { name: "Operação ativada" })).toBeVisible();
  await page.waitForTimeout(1_600);
  await expect(page.getByRole("heading", { name: "Operação ativada" })).toBeVisible();
  await expect(page.getByRole("alert")).toHaveCount(0);
});

test("retoma polling automático depois de refresh manual 503 sem timers duplicados", async ({
  page,
}) => {
  let statusCalls = 0;
  let failNextRefresh = false;
  let completed = false;
  await page.clock.install();
  await page.clock.pauseAt(new Date(Date.now() + 1_000));
  const summary = (state: "publishing" | "completed") => ({
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
      const request = route.request();
      const url = new URL(request.url());
      if (url.pathname.endsWith(`/provisioning/${runId}`)) {
        statusCalls += 1;
        completed = true;
        await route.fulfill({ json: { ...summary("completed"), steps: [] } });
        return;
      }
      if (request.method() === "GET" && url.pathname.endsWith("/onboarding")) {
        if (failNextRefresh) {
          failNextRefresh = false;
          await route.fulfill({
            status: 503,
            json: {
              statusCode: 503,
              code: "SERVICE_UNAVAILABLE",
              message: "Atualização temporariamente indisponível.",
            },
          });
          return;
        }
        await route.fulfill({
          json: onboardingSnapshot({
            items: verifiedItems(),
            selection: selectedPlan(1),
            provisioning: summary(completed ? "completed" : "publishing"),
            activatedAt: completed ? "2026-08-11T10:10:00.000Z" : null,
          }),
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
  const refreshCurrentRun = page
    .locator("button:not([disabled])")
    .filter({ hasText: "Atualizar status" })
    .first();
  failNextRefresh = true;
  await refreshCurrentRun.click();
  await expect.poll(() => failNextRefresh).toBe(false);
  await page.clock.runFor(1_600);
  await expect(page.getByRole("heading", { name: "Operação ativada" })).toBeVisible({
    timeout: 5_000,
  });
  expect(statusCalls).toBe(1);
  await page.clock.runFor(5_000);
  expect(statusCalls).toBe(1);
  await expect(page.getByRole("alert")).toHaveCount(0);
});

for (const status of [400, 401, 403, 404] as const) {
  test(`não rearma polling depois de refresh permanente ${status}`, async ({ page }) => {
    let failNextRefresh = false;
    let statusCalls = 0;
    let markRefreshFailed: (() => void) | undefined;
    const refreshFailed = new Promise<void>((resolve) => {
      markRefreshFailed = resolve;
    });
    await page.clock.install();
    await page.clock.pauseAt(new Date(Date.now() + 1_000));
    await page.route(
      `http://localhost:3200/v1/organizations/${organizationId}/onboarding**`,
      async (route) => {
        const request = route.request();
        const url = new URL(request.url());
        if (url.pathname.endsWith(`/provisioning/${runId}`)) {
          statusCalls += 1;
          await route.fulfill({
            status: 500,
            json: {
              statusCode: 500,
              code: "UNEXPECTED_POLL",
              message: "O polling não deveria ter sido reagendado.",
            },
          });
          return;
        }
        if (request.method() === "GET" && url.pathname.endsWith("/onboarding")) {
          if (failNextRefresh) {
            failNextRefresh = false;
            await route.fulfill({
              status,
              json: {
                statusCode: status,
                code: status === 401 ? "SESSION_EXPIRED" : `REFRESH_${status}`,
                message: `Refresh permanente ${status}.`,
              },
            });
            markRefreshFailed?.();
            return;
          }
          await route.fulfill({
            json: onboardingSnapshot({
              items: verifiedItems(),
              selection: selectedPlan(1),
              provisioning: {
                id: runId,
                state: "publishing",
                checkpoint: "activation_committed",
                attempts: 1,
                lastErrorCode: null,
                nextRetryAt: null,
                completedAt: null,
                failedAt: null,
                createdAt: "2026-08-11T10:00:00.000Z",
                updatedAt: "2026-08-11T10:00:00.000Z",
              },
            }),
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
    await page.waitForLoadState("networkidle");
    const refreshCurrentRun = page
      .locator("button:not([disabled])")
      .filter({ hasText: "Atualizar status" })
      .first();
    failNextRefresh = true;
    await refreshCurrentRun.click();
    await refreshFailed;
    await page.evaluate(() => {
      Object.defineProperty(document, "visibilityState", { configurable: true, value: "hidden" });
      document.dispatchEvent(new Event("visibilitychange"));
    });
    const callsAfterPermanentFailure = statusCalls;
    await page.clock.fastForward(10_000);
    await expect.poll(() => statusCalls).toBe(callsAfterPermanentFailure);
    await page.evaluate(() => {
      Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" });
      document.dispatchEvent(new Event("visibilitychange"));
    });
    await page.clock.fastForward(10_000);
    await expect.poll(() => statusCalls).toBe(callsAfterPermanentFailure);
  });
}

for (const status of [400, 404] as const) {
  test(`mantém poll ${status} latched no lifecycle e libera por recovery autoritativo`, async ({
    page,
  }) => {
    const runB = "e2222222-2222-4222-8222-222222222222";
    let recover = false;
    let completed = false;
    let onboardingGets = 0;
    let oldRunStatusCalls = 0;
    let newRunStatusCalls = 0;
    await page.clock.install();
    await page.clock.pauseAt(new Date(Date.now() + 1_000));
    await page.route(
      `http://localhost:3200/v1/organizations/${organizationId}/onboarding**`,
      async (route) => {
        const request = route.request();
        const url = new URL(request.url());
        if (url.pathname.endsWith(`/provisioning/${runId}`)) {
          oldRunStatusCalls += 1;
          if (!recover) {
            await route.fulfill({
              status,
              json: {
                statusCode: status,
                code: `POLL_${status}`,
                message: `Polling permanente ${status}.`,
              },
            });
            return;
          }
          if (status === 404) {
            await route.fulfill({
              status: 500,
              json: {
                statusCode: 500,
                code: "STALE_RUN_POLLED",
                message: "O run antigo não deve ser consultado depois da troca.",
              },
            });
            return;
          }
          completed = true;
          await route.fulfill({
            json: {
              id: runId,
              state: "completed",
              checkpoint: "published",
              attempts: 2,
              lastErrorCode: null,
              nextRetryAt: null,
              completedAt: "2026-08-11T10:20:00.000Z",
              failedAt: null,
              createdAt: "2026-08-11T10:00:00.000Z",
              updatedAt: "2026-08-11T10:20:00.000Z",
              steps: [],
            },
          });
          return;
        }
        if (url.pathname.endsWith(`/provisioning/${runB}`)) {
          newRunStatusCalls += 1;
          completed = true;
          await route.fulfill({
            json: {
              id: runB,
              state: "completed",
              checkpoint: "published",
              attempts: 1,
              lastErrorCode: null,
              nextRetryAt: null,
              completedAt: "2026-08-11T10:20:00.000Z",
              failedAt: null,
              createdAt: "2026-08-11T10:15:00.000Z",
              updatedAt: "2026-08-11T10:20:00.000Z",
              steps: [],
            },
          });
          return;
        }
        if (request.method() === "GET" && url.pathname.endsWith("/onboarding")) {
          onboardingGets += 1;
          const currentRunId = recover && status === 404 ? runB : runId;
          await route.fulfill({
            json: onboardingSnapshot({
              items: verifiedItems(),
              selection: selectedPlan(recover && status === 404 ? 2 : 1),
              provisioning: {
                id: currentRunId,
                state: completed ? "completed" : "publishing",
                checkpoint: completed ? "published" : "activation_committed",
                attempts: completed ? 2 : 1,
                lastErrorCode: null,
                nextRetryAt: null,
                completedAt: completed ? "2026-08-11T10:20:00.000Z" : null,
                failedAt: null,
                createdAt: "2026-08-11T10:00:00.000Z",
                updatedAt: completed ? "2026-08-11T10:20:00.000Z" : "2026-08-11T10:00:00.000Z",
              },
              activatedAt: completed ? "2026-08-11T10:20:00.000Z" : null,
            }),
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
    await expect(page.getByText("Publicando conclusão", { exact: true })).toBeVisible();
    await page.waitForTimeout(100);
    await page.clock.runFor(1_100);
    await expect.poll(() => oldRunStatusCalls).toBe(1);
    expect(newRunStatusCalls).toBe(0);
    await expect(page.getByRole("alert")).toContainText(`Polling permanente ${status}.`);

    await page.evaluate(() => {
      Object.defineProperty(document, "visibilityState", { configurable: true, value: "hidden" });
      document.dispatchEvent(new Event("visibilitychange"));
      Object.defineProperty(navigator, "onLine", { configurable: true, value: false });
      window.dispatchEvent(new Event("offline"));
    });
    await page.waitForTimeout(100);
    await page.clock.runFor(10_000);
    await page.evaluate(() => {
      Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" });
      document.dispatchEvent(new Event("visibilitychange"));
      Object.defineProperty(navigator, "onLine", { configurable: true, value: true });
      window.dispatchEvent(new Event("online"));
    });
    await page.waitForTimeout(100);
    await page.clock.runFor(10_000);
    expect(oldRunStatusCalls).toBe(1);
    expect(newRunStatusCalls).toBe(0);

    recover = true;
    const getsBeforeRecovery = onboardingGets;
    await page
      .locator("button:not([disabled])")
      .filter({ hasText: "Atualizar status" })
      .first()
      .click();
    await expect.poll(() => onboardingGets).toBeGreaterThan(getsBeforeRecovery);
    await page.waitForTimeout(100);
    await page.clock.runFor(1_100);
    await expect.poll(() => oldRunStatusCalls).toBe(status === 400 ? 2 : 1);
    await expect.poll(() => newRunStatusCalls).toBe(status === 404 ? 1 : 0);
    await expect(page.getByRole("heading", { name: "Operação ativada" })).toBeVisible();
  });
}

test("mantém latch e pausa polling durante ativação pendente", async ({ page }) => {
  let completed = false;
  let activationCalls = 0;
  let statusCalls = 0;
  let markDelayedPostStarted: (() => void) | undefined;
  let releaseDelayedPost: (() => void) | undefined;
  const delayedPostStarted = new Promise<void>((resolve) => {
    markDelayedPostStarted = resolve;
  });
  const allowDelayedPost = new Promise<void>((resolve) => {
    releaseDelayedPost = resolve;
  });
  await page.clock.install();
  await page.clock.pauseAt(new Date(Date.now() + 1_000));
  await page.route(
    `http://localhost:3200/v1/organizations/${organizationId}/onboarding**`,
    async (route) => {
      const request = route.request();
      const url = new URL(request.url());
      if (url.pathname.endsWith(`/provisioning/${runId}`)) {
        statusCalls += 1;
        await route.fulfill({
          status: statusCalls === 1 ? 400 : 500,
          json: {
            statusCode: statusCalls === 1 ? 400 : 500,
            code: statusCalls === 1 ? "POLL_PERMANENT" : "UNEXPECTED_POLL_DURING_MUTATION",
            message:
              statusCalls === 1
                ? "Polling bloqueado até recuperação explícita."
                : "O polling não pode avançar durante a ativação.",
          },
        });
        return;
      }
      if (request.method() === "POST" && url.pathname.endsWith("/activate")) {
        activationCalls += 1;
        if (activationCalls === 1) {
          await route.fulfill({
            status: 500,
            json: {
              statusCode: 500,
              code: "ACTIVATION_TRANSIENT_FAILURE",
              message: "A primeira ativação falhou.",
            },
          });
          return;
        }
        markDelayedPostStarted?.();
        await allowDelayedPost;
        completed = true;
        await route.fulfill({
          status: 201,
          json: {
            id: "a2222222-2222-4222-8222-222222222222",
            organizationId,
            commercialPlanId: planId,
            provisioningRunId: runId,
            subscriptionId,
            startsAt: "2026-08-11T10:30:00.000Z",
            endsAt: "2026-08-25T10:30:00.000Z",
            state: "completed",
            entitlements: [],
          },
        });
        return;
      }
      if (request.method() === "GET" && url.pathname.endsWith("/onboarding")) {
        await route.fulfill({
          json: onboardingSnapshot({
            items: verifiedItems(),
            selection: selectedPlan(1),
            provisioning: {
              id: runId,
              state: completed ? "completed" : "publishing",
              checkpoint: completed ? "published" : "activation_committed",
              attempts: completed ? 2 : 1,
              lastErrorCode: null,
              nextRetryAt: null,
              completedAt: completed ? "2026-08-11T10:30:00.000Z" : null,
              failedAt: null,
              createdAt: "2026-08-11T10:00:00.000Z",
              updatedAt: completed ? "2026-08-11T10:30:00.000Z" : "2026-08-11T10:00:00.000Z",
            },
            activatedAt: completed ? "2026-08-11T10:30:00.000Z" : null,
          }),
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
  await expect(page.getByText("Publicando conclusão", { exact: true })).toBeVisible();
  await page.clock.runFor(1_100);
  await expect(page.getByRole("alert")).toContainText(
    "Polling bloqueado até recuperação explícita.",
  );
  expect(statusCalls).toBe(1);

  const activation = page.locator(".onboarding-activation");
  await activation.getByRole("checkbox").check();
  await activation.getByRole("button", { name: "Ativar trial de 14 dias" }).click();
  await expect(page.getByRole("alert")).toContainText("O servidor não concluiu a solicitação.");
  await page.clock.runFor(10_000);
  expect(statusCalls).toBe(1);

  await activation.getByRole("button", { name: "Ativar trial de 14 dias" }).click();
  await delayedPostStarted;
  await page.clock.runFor(1_600);
  expect(statusCalls).toBe(1);
  releaseDelayedPost?.();
  await expect(page.getByRole("heading", { name: "Operação ativada" })).toBeVisible();
  expect(activationCalls).toBe(2);
});

test("latcha resposta de status pertencente a outro run até refresh autoritativo", async ({
  page,
}) => {
  const runB = "e2222222-2222-4222-8222-222222222222";
  let recover = false;
  let completed = false;
  let onboardingGets = 0;
  let statusCalls = 0;
  await page.clock.install();
  await page.clock.pauseAt(new Date(Date.now() + 1_000));
  await page.route(
    `http://localhost:3200/v1/organizations/${organizationId}/onboarding**`,
    async (route) => {
      const request = route.request();
      const url = new URL(request.url());
      if (url.pathname.endsWith(`/provisioning/${runId}`)) {
        statusCalls += 1;
        if (!recover) {
          await route.fulfill({
            json: {
              id: runB,
              state: "publishing",
              checkpoint: "activation_committed",
              attempts: 1,
              lastErrorCode: null,
              nextRetryAt: null,
              completedAt: null,
              failedAt: null,
              createdAt: "2026-08-11T10:00:00.000Z",
              updatedAt: "2026-08-11T10:00:00.000Z",
              steps: [],
            },
          });
          return;
        }
        completed = true;
        await route.fulfill({
          json: {
            id: runId,
            state: "completed",
            checkpoint: "published",
            attempts: 2,
            lastErrorCode: null,
            nextRetryAt: null,
            completedAt: "2026-08-11T10:40:00.000Z",
            failedAt: null,
            createdAt: "2026-08-11T10:00:00.000Z",
            updatedAt: "2026-08-11T10:40:00.000Z",
            steps: [],
          },
        });
        return;
      }
      if (request.method() === "GET" && url.pathname.endsWith("/onboarding")) {
        onboardingGets += 1;
        await route.fulfill({
          json: onboardingSnapshot({
            items: verifiedItems(),
            selection: selectedPlan(1),
            provisioning: {
              id: runId,
              state: completed ? "completed" : "publishing",
              checkpoint: completed ? "published" : "activation_committed",
              attempts: completed ? 2 : 1,
              lastErrorCode: null,
              nextRetryAt: null,
              completedAt: completed ? "2026-08-11T10:40:00.000Z" : null,
              failedAt: null,
              createdAt: "2026-08-11T10:00:00.000Z",
              updatedAt: completed ? "2026-08-11T10:40:00.000Z" : "2026-08-11T10:00:00.000Z",
            },
            activatedAt: completed ? "2026-08-11T10:40:00.000Z" : null,
          }),
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
  await expect(page.getByText("Publicando conclusão", { exact: true })).toBeVisible();
  await page.clock.runFor(1_100);
  await expect(page.getByRole("alert")).toContainText("O servidor não concluiu a solicitação.");
  await expect(page.getByText(runB)).toHaveCount(0);
  expect(statusCalls).toBe(1);

  await page.evaluate(() => {
    Object.defineProperty(document, "visibilityState", { configurable: true, value: "hidden" });
    document.dispatchEvent(new Event("visibilitychange"));
    Object.defineProperty(navigator, "onLine", { configurable: true, value: false });
    window.dispatchEvent(new Event("offline"));
  });
  await page.clock.runFor(10_000);
  await page.evaluate(() => {
    Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" });
    document.dispatchEvent(new Event("visibilitychange"));
    Object.defineProperty(navigator, "onLine", { configurable: true, value: true });
    window.dispatchEvent(new Event("online"));
  });
  await page.clock.runFor(10_000);
  expect(statusCalls).toBe(1);

  recover = true;
  const getsBeforeRecovery = onboardingGets;
  await page
    .locator("button:not([disabled])")
    .filter({ hasText: "Atualizar status" })
    .first()
    .click();
  await expect.poll(() => onboardingGets).toBeGreaterThan(getsBeforeRecovery);
  await page.waitForTimeout(100);
  await page.clock.runFor(1_100);
  await expect.poll(() => statusCalls).toBe(2);
  await expect(page.getByRole("heading", { name: "Operação ativada" })).toBeVisible();
});

test("suprime 409 de ativação antigo depois de refresh autoritativo terminal", async ({ page }) => {
  let completed = false;
  const completedAt = "2026-08-11T10:10:00.000Z";
  await page.route(
    `http://localhost:3200/v1/organizations/${organizationId}/onboarding**`,
    async (route) => {
      const request = route.request();
      const url = new URL(request.url());
      if (request.method() === "POST" && url.pathname.endsWith("/activate")) {
        completed = true;
        await route.fulfill({
          status: 409,
          json: {
            statusCode: 409,
            code: "ACTIVATION_ALREADY_RUNNING",
            message: "Uma ativação anterior já resolveu este onboarding.",
            details: { provisioningRunId: runId },
          },
        });
        return;
      }
      if (request.method() === "GET" && url.pathname.endsWith("/onboarding")) {
        await route.fulfill({
          json: onboardingSnapshot({
            items: verifiedItems(),
            selection: selectedPlan(1),
            provisioning: completed
              ? {
                  id: runId,
                  state: "completed",
                  checkpoint: "published",
                  attempts: 1,
                  lastErrorCode: null,
                  nextRetryAt: null,
                  completedAt,
                  failedAt: null,
                  createdAt: completedAt,
                  updatedAt: completedAt,
                }
              : null,
            activatedAt: completed ? completedAt : null,
          }),
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
  const activation = page.locator(".onboarding-activation");
  await activation.getByRole("checkbox").check();
  await activation.getByRole("button", { name: "Ativar trial de 14 dias" }).click();
  await expect(page.getByRole("heading", { name: "Operação ativada" })).toBeVisible();
  await page.waitForTimeout(150);
  await expect(page.getByRole("alert")).toHaveCount(0);
});

for (const state of ["terminal_failed", "compensated"] as const) {
  test(`preserva erro público e recuperação após ativação ${state}`, async ({ page }) => {
    let failed = false;
    const failedAt = "2026-08-11T10:10:00.000Z";
    const publicMessage = `A ativação terminou em ${state} e pode ser tentada novamente.`;
    await page.route(
      `http://localhost:3200/v1/organizations/${organizationId}/onboarding**`,
      async (route) => {
        const request = route.request();
        const url = new URL(request.url());
        if (request.method() === "POST" && url.pathname.endsWith("/activate")) {
          failed = true;
          await route.fulfill({
            status: 409,
            json: {
              statusCode: 409,
              code: "ACTIVATION_PROVISIONING_FAILED",
              message: publicMessage,
              details: { provisioningRunId: runId },
            },
          });
          return;
        }
        if (request.method() === "GET" && url.pathname.endsWith("/onboarding")) {
          await route.fulfill({
            json: onboardingSnapshot({
              items: verifiedItems(),
              selection: selectedPlan(1),
              provisioning: failed
                ? {
                    id: runId,
                    state,
                    checkpoint: "activation_committed",
                    attempts: 1,
                    lastErrorCode: "ACTIVATION_PROVISIONING_FAILED",
                    nextRetryAt: null,
                    completedAt: null,
                    failedAt,
                    createdAt: failedAt,
                    updatedAt: failedAt,
                  }
                : null,
            }),
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
    const activation = page.locator(".onboarding-activation");
    await activation.getByRole("checkbox").check();
    await activation.getByRole("button", { name: "Ativar trial de 14 dias" }).click();
    const alert = page.getByRole("alert");
    await expect(alert).toContainText(publicMessage);
    await expect(alert.getByRole("button", { name: "Tentar novamente" })).toBeVisible();
    await expect(alert).toBeFocused();
    await expect(activation).toContainText(
      state === "terminal_failed" ? "Ativação encerrada com falha" : "Ativação compensada",
    );
  });
}

for (const state of ["terminal_failed", "compensated", "completed"] as const) {
  test(`descarta erro do run A quando recovery autoritativo retorna run B ${state}`, async ({
    page,
  }) => {
    const runB = "e2222222-2222-4222-8222-222222222222";
    const staleMessage = "A falhou e não pode aparecer sobre a execução B.";
    let runBVisible = false;
    const terminalAt = "2026-08-11T10:30:00.000Z";
    await page.route(
      `http://localhost:3200/v1/organizations/${organizationId}/onboarding**`,
      async (route) => {
        const request = route.request();
        const url = new URL(request.url());
        if (request.method() === "POST" && url.pathname.endsWith("/activate")) {
          runBVisible = true;
          await route.fulfill({
            status: 409,
            json: {
              statusCode: 409,
              code: "ACTIVATION_ALREADY_RUNNING",
              message: staleMessage,
              details: { provisioningRunId: runId },
            },
          });
          return;
        }
        if (request.method() === "GET" && url.pathname.endsWith("/onboarding")) {
          await route.fulfill({
            json: onboardingSnapshot({
              items: verifiedItems(),
              selection: selectedPlan(2),
              provisioning: runBVisible
                ? {
                    id: runB,
                    state,
                    checkpoint: state === "completed" ? "published" : "activation_committed",
                    attempts: 1,
                    lastErrorCode: state === "completed" ? null : "RUN_B_TERMINAL",
                    nextRetryAt: null,
                    completedAt: state === "completed" ? terminalAt : null,
                    failedAt: state === "completed" ? null : terminalAt,
                    createdAt: terminalAt,
                    updatedAt: terminalAt,
                  }
                : null,
              activatedAt: runBVisible && state === "completed" ? terminalAt : null,
            }),
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
    const activation = page.locator(".onboarding-activation");
    await activation.getByRole("checkbox").check();
    await activation.getByRole("button", { name: "Ativar trial de 14 dias" }).click();
    await expect(page.getByText(staleMessage)).toHaveCount(0);
    await expect(page.getByRole("alert")).toHaveCount(0);
    if (state === "completed") {
      await expect(page.getByRole("heading", { name: "Operação ativada" })).toBeVisible();
    } else {
      await expect(activation).toContainText(
        state === "terminal_failed" ? "Ativação encerrada com falha" : "Ativação compensada",
      );
    }
  });
}

test("não deixa erro de ativação cruzar a troca de unidade durante refresh de recuperação", async ({
  page,
}) => {
  let delayRecovery = false;
  let secondScope = false;
  let markRecoveryStarted: (() => void) | undefined;
  const recoveryStarted = new Promise<void>((resolve) => {
    markRecoveryStarted = resolve;
  });
  let releaseRecovery: (() => void) | undefined;
  const recoveryMayFinish = new Promise<void>((resolve) => {
    releaseRecovery = resolve;
  });
  await page.route(
    `http://localhost:3200/v1/organizations/${organizationId}/onboarding**`,
    async (route) => {
      const request = route.request();
      const url = new URL(request.url());
      if (request.method() === "POST" && url.pathname.endsWith("/activate")) {
        delayRecovery = true;
        await route.fulfill({
          status: 409,
          json: {
            statusCode: 409,
            code: "ACTIVATION_ALREADY_RUNNING",
            message: "Este erro pertence à unidade anterior.",
            details: { provisioningRunId: runId },
          },
        });
        return;
      }
      if (request.method() === "PUT" && url.pathname.endsWith("/selection")) {
        await route.fulfill({ json: selectedPlan(2, secondUnitId) });
        return;
      }
      if (request.method() === "GET" && url.pathname.endsWith("/onboarding")) {
        if (delayRecovery) {
          delayRecovery = false;
          markRecoveryStarted?.();
          await recoveryMayFinish;
        }
        await route
          .fulfill({
            json: onboardingSnapshot({
              items: verifiedItems(),
              selection: selectedPlan(secondScope ? 2 : 1, secondScope ? secondUnitId : unitId),
            }),
          })
          .catch(() => undefined);
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
  const activation = page.locator(".onboarding-activation");
  await activation.getByRole("checkbox").check();
  await activation.getByRole("button", { name: "Ativar trial de 14 dias" }).click();
  await recoveryStarted;
  secondScope = true;
  const selection = page.getByLabel("Unidade da ativação");
  await selection.evaluate((element) => {
    (element as HTMLSelectElement).disabled = false;
  });
  await selection.selectOption(secondUnitId);
  await page.getByLabel(/Confirmo a reseleção/).check();
  const saveSelection = page.getByRole("button", { name: "Confirmar reseleção" });
  await saveSelection.evaluate((element) => {
    (element as HTMLButtonElement).disabled = false;
  });
  await saveSelection.click();
  await expectActiveUnit(page, "Aurora Lagoa");
  releaseRecovery?.();
  await page.waitForTimeout(200);
  await expect(page.getByRole("alert")).toHaveCount(0);
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
