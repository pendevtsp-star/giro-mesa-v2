import AxeBuilder from "@axe-core/playwright";
import { expect, type Page, test } from "@playwright/test";

const ids = {
  bar: "22222222-2222-4222-8222-222222222222",
  barItem: "66666666-6666-4666-8666-666666666666",
  barTicket: "44444444-4444-4444-8444-444444444444",
  kitchen: "11111111-1111-4111-8111-111111111111",
  kitchenItem: "55555555-5555-4555-8555-555555555555",
  kitchenTicket: "33333333-3333-4333-8333-333333333333",
  order: "77777777-7777-4777-8777-777777777777",
  tab: "88888888-8888-4888-8888-888888888888",
};

type TicketStatus = "canceled" | "done" | "pending" | "preparing" | "ready";

function itemStatus(status: TicketStatus) {
  if (status === "pending") return "queued";
  return status === "done" ? "served" : status;
}

async function mockKdsApi(page: Page) {
  await page.route("**/health", (route) =>
    route.fulfill({
      json: {
        status: "ok",
        version: "2.0.0",
        buildSha: "kds-e2e",
        schemaVersion: 77,
        database: "up",
        integrations: {},
        capabilities: [
          "table_qr_lifecycle_v1",
          "table_qr_metrics_v1",
          "table_qr_presence_code_v1",
          "ops_background_notifications_v1",
          "table_qr_brand_upload_v1",
          "ops_web_push_v1",
          "public_menu_cover_image_v1",
          "platform_backoffice_v1",
          "platform_commercial_site_v1",
          "edge_hub_pairing_v1",
        ],
      },
    }),
  );
  const state = {
    acknowledgedAttention: false,
    attentionEnabled: false,
    availabilityMutations: [] as Array<{
      available: boolean;
      reason: string;
      resetAt?: string | null;
      dailyStock?: number | null;
    }>,
    availabilityShouldFail: false,
    availability: {
      productId: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
      productName: "Risoto de cogumelos",
      status: "available" as "available" | "limited" | "unavailable",
      available: true,
      dailyStock: null as number | null,
      soldToday: 2,
      remainingQuantity: null as number | null,
      autoDeductStock: false,
      reason: null as string | null,
      updatedByIdentityId: null as string | null,
      updatedAt: new Date().toISOString(),
      resetAt: null as string | null,
    },
    barReadyQuantity: 0,
    blockMutations: [] as Array<{ action: "block" | "unblock"; reason: string }>,
    blockedKitchen: false,
    cancelKitchen: false,
    cancelMutations: [] as Array<{
      approverMembershipId: string;
      pin: string;
      reason: string;
    }>,
    freshness: "live" as "live" | "stale",
    handoffTargets: [] as Array<"expedition" | "served">,
    attentionMutations: [] as Array<{ noteId: string; revision: string }>,
    loads: 0,
    orderPriority: 80,
    printMutations: [] as Array<Record<string, unknown>>,
    priorityMutations: [] as Array<{
      orderId: string;
      priority: number;
      reason: string;
      installationId?: string;
    }>,
    revision: 1,
    transitions: new Map<string, number>(),
    terminalProfile: null as null | {
      installationId: string;
      mode: "station" | "pass";
      stationId: string | null;
      label: string;
      soundEnabled: boolean;
      fullscreenPreferred: boolean;
      createdAt: string;
      updatedAt: string;
      updatedByIdentityId: string;
    },
    statuses: new Map<string, TicketStatus>([
      [ids.kitchenTicket, "pending"],
      [ids.barTicket, "pending"],
    ]),
  };

  await page.route("**/v1/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = `${url.pathname}${url.search}`;
    const method = request.method();

    if (method === "GET" && path === "/v1/auth/terminal-session") {
      await route.fulfill({ status: 401, json: { code: "TERMINAL_SESSION_REQUIRED" } });
      return;
    }
    if (path === "/v1/auth/me") {
      await route.fulfill({
        json: {
          identity: {
            id: "99999999-9999-4999-8999-999999999999",
            email: "chef@giromesa.test",
            displayName: "Chef Ana",
          },
          memberships: [
            {
              membershipId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
              organizationId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
              status: "active",
            },
          ],
          platformAdmin: false,
        },
      });
      return;
    }
    if (path === "/v1/organizations") {
      await route.fulfill({
        json: [
          {
            membershipId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
            organization: {
              id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
              tradeName: "Bistrô Aurora",
              document: "12345678000199",
            },
            units: [
              {
                id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
                name: "Matriz",
                city: "São Paulo",
                timezone: "America/Sao_Paulo",
                active: true,
              },
            ],
            scopes: [{ role: "manager", unitId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc" }],
          },
        ],
      });
      return;
    }
    if (path.endsWith("/pilot/approval-requests?status=pending")) {
      await route.fulfill({ json: [] });
      return;
    }

    if (method === "GET" && path.endsWith("/pilot/kds/products/availability")) {
      await route.fulfill({
        json: { capturedAt: new Date().toISOString(), products: [state.availability] },
      });
      return;
    }

    const terminalProfile = path.match(/\/pilot\/kds\/terminals\/([^/?]+)$/);
    if (method === "GET" && terminalProfile) {
      if (!state.terminalProfile) {
        await route.fulfill({ status: 404, json: { message: "Perfil ainda não registrado" } });
      } else {
        await route.fulfill({ json: state.terminalProfile });
      }
      return;
    }
    if (method === "PUT" && terminalProfile) {
      const body = request.postDataJSON() as {
        mode: "station" | "pass";
        stationId: string | null;
        label: string;
        soundEnabled: boolean;
        fullscreenPreferred: boolean;
      };
      const timestamp = new Date().toISOString();
      state.terminalProfile = {
        installationId: decodeURIComponent(terminalProfile[1] ?? ""),
        ...body,
        createdAt: timestamp,
        updatedAt: timestamp,
        updatedByIdentityId: "99999999-9999-4999-8999-999999999999",
      };
      await route.fulfill({ json: state.terminalProfile });
      return;
    }

    if (method === "GET" && path.includes("/pilot/kds")) {
      state.loads += 1;
      const now = new Date();
      const synchronizedAt =
        state.freshness === "stale"
          ? new Date(now.getTime() - 15 * 60_000).toISOString()
          : now.toISOString();
      const createdAt = new Date(now.getTime() - 18 * 60_000).toISOString();
      const dueAt = new Date(now.getTime() - 3 * 60_000).toISOString();
      const kitchenStatus = state.statuses.get(ids.kitchenTicket) ?? "pending";
      const barStatus = state.statuses.get(ids.barTicket) ?? "pending";
      const requestedStationId = url.searchParams.get("stationId");
      await route.fulfill({
        json: {
          capturedAt: synchronizedAt,
          revision: String(state.revision),
          serverTime: now.toISOString(),
          operationServiceMode: "full_service",
          capabilities: {
            ticketTransition: true,
            itemTransition: true,
            partialReady: true,
            authorizedCancellation: true,
            courseHold: true,
            priority: true,
            orderPriority: true,
            recall: true,
            refire: true,
            orderHandoff: true,
            availability: true,
            block: true,
            attentionAcknowledgement: true,
            recommendation: true,
            terminalProfileRead: true,
            terminalProfileManage: true,
            offlineAvailabilityLifecycle: false,
          },
          freshness: {
            status: state.freshness,
            source: "cloud",
            capturedAt: synchronizedAt,
            lastSyncedAt: synchronizedAt,
            lastSuccessfulSyncAt: synchronizedAt,
            pendingCount: 0,
            rejectedCount: 0,
          },
          stations: [
            {
              id: ids.kitchen,
              code: "COZ",
              name: "Cozinha",
              capacity: {
                queuedQuantity: 8,
                preparingQuantity: 3,
                recommendation: {
                  state: "strained",
                  suggestedDelayMinutes: 10,
                  reasons: ["queue_depth"],
                },
              },
            },
            { id: ids.bar, code: "BAR", name: "Bar" },
          ],
          tickets: [
            {
              id: ids.kitchenTicket,
              orderId: ids.order,
              stationId: ids.kitchen,
              status: kitchenStatus,
              priority: state.orderPriority,
              rush: state.orderPriority >= 50,
              createdAt,
              dueAt,
              handedOffAt: state.handoffTargets.includes("expedition") ? synchronizedAt : null,
              servedAt: state.handoffTargets.includes("served") ? synchronizedAt : null,
              station: { id: ids.kitchen, code: "COZ", name: "Cozinha" },
              order: {
                id: ids.order,
                displayReference: "Pedido 42",
                status: "sent",
                priority: state.orderPriority,
                reason: state.orderPriority >= 50 ? "Cliente com horário" : null,
              },
              tab: {
                id: ids.tab,
                displayNumber: 42,
                label: "Comanda 42",
                fulfillmentType: "dine_in",
                customerName: "Marina",
                promisedAt: dueAt,
                readyNotifiedAt: null,
              },
              table: { id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd", label: "Mesa 12" },
              sla: {
                elapsedMinutes: 18,
                targetMinutes: 15,
                overdueMinutes: 3,
                isOverdue: true,
              },
            },
            {
              id: ids.barTicket,
              orderId: ids.order,
              stationId: ids.bar,
              status: barStatus,
              priority: state.orderPriority,
              rush: state.orderPriority >= 50,
              createdAt,
              dueAt,
              handedOffAt: state.handoffTargets.includes("expedition") ? synchronizedAt : null,
              servedAt: state.handoffTargets.includes("served") ? synchronizedAt : null,
              station: { id: ids.bar, code: "BAR", name: "Bar" },
              order: {
                id: ids.order,
                displayReference: "Pedido 42",
                status: "sent",
                priority: state.orderPriority,
                reason: state.orderPriority >= 50 ? "Cliente com horário" : null,
              },
              tab: {
                id: ids.tab,
                displayNumber: 42,
                label: "Comanda 42",
                fulfillmentType: "dine_in",
                customerName: "Marina",
                promisedAt: dueAt,
                readyNotifiedAt: null,
              },
              table: { id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd", label: "Mesa 12" },
              sla: {
                elapsedMinutes: 18,
                targetMinutes: 5,
                overdueMinutes: 13,
                isOverdue: true,
              },
            },
          ].filter((ticket) => !requestedStationId || ticket.stationId === requestedStationId),
          items: [
            {
              ticketId: ids.kitchenTicket,
              item: {
                id: ids.kitchenItem,
                orderId: ids.order,
                productId: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
                productName: "Risoto de cogumelos",
                quantity: 1,
                grossCents: 4_900,
                discountCents: 0,
                netCents: 4_900,
                status: itemStatus(kitchenStatus),
                seatNumber: 1,
                course: "main",
                allergyNote: "Amendoim",
                notes: "Sem cebola",
                canceledAt: kitchenStatus === "canceled" ? now.toISOString() : null,
                canceledReason: kitchenStatus === "canceled" ? "Cliente desistiu" : null,
              },
              kds: {
                quantity: 1,
                readyQuantity: kitchenStatus === "ready" || kitchenStatus === "done" ? 1 : 0,
                status: itemStatus(kitchenStatus),
                held: false,
                heldAt: null,
                firedAt: createdAt,
                startedAt: kitchenStatus === "pending" ? null : createdAt,
                readyAt:
                  kitchenStatus === "ready" || kitchenStatus === "done" ? now.toISOString() : null,
                completedAt: kitchenStatus === "done" ? now.toISOString() : null,
                blocked: state.blockedKitchen
                  ? {
                      active: true,
                      code: "missing_ingredient",
                      reason: "Sem cogumelos frescos",
                    }
                  : null,
                attention: state.attentionEnabled
                  ? [
                      {
                        noteId: "allergy",
                        revision: "a".repeat(64),
                        text: "Amendoim",
                        required: true,
                        acknowledgedAt: state.acknowledgedAttention ? now.toISOString() : null,
                        acknowledgedBy: state.acknowledgedAttention ? "Chef Ana" : null,
                      },
                    ]
                  : [],
              },
              modifiers: [{ id: "mod-1", name: "Ponto bem passado", quantity: 1 }],
            },
            {
              ticketId: ids.barTicket,
              item: {
                id: ids.barItem,
                orderId: ids.order,
                productId: "ffffffff-ffff-4fff-8fff-ffffffffffff",
                productName: "Água com gás",
                quantity: 2,
                grossCents: 1_000,
                discountCents: 0,
                netCents: 1_000,
                status: itemStatus(barStatus),
                seatNumber: 2,
                course: "anytime",
                allergyNote: null,
                notes: "Com limão",
              },
              kds: {
                quantity: 2,
                readyQuantity:
                  barStatus === "ready" || barStatus === "done" ? 2 : state.barReadyQuantity,
                status: itemStatus(barStatus),
                held: false,
                heldAt: null,
                firedAt: createdAt,
                startedAt: barStatus === "pending" ? null : createdAt,
                readyAt: barStatus === "ready" || barStatus === "done" ? now.toISOString() : null,
                completedAt: barStatus === "done" ? now.toISOString() : null,
              },
              modifiers: [],
            },
          ].filter(
            (row) =>
              !requestedStationId ||
              (requestedStationId === ids.kitchen && row.ticketId === ids.kitchenTicket) ||
              (requestedStationId === ids.bar && row.ticketId === ids.barTicket),
          ),
          metrics: {
            total: 2,
            pending: [...state.statuses.values()].filter((status) => status === "pending").length,
            preparing: [...state.statuses.values()].filter((status) => status === "preparing")
              .length,
            ready: [...state.statuses.values()].filter((status) => status === "ready").length,
            overdue: 2,
            rush: 1,
            averageWaitMinutes: 18,
            averagePrepMinutes: 12,
            medianPrepMinutes: 11,
            p90PrepMinutes: 16,
          },
          allDay: [
            {
              productId: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
              productName: "Risoto de cogumelos",
              totalQuantity: 1,
              queuedQuantity: kitchenStatus === "pending" ? 1 : 0,
              preparingQuantity: kitchenStatus === "preparing" ? 1 : 0,
              readyQuantity: kitchenStatus === "ready" ? 1 : 0,
              heldQuantity: 0,
            },
          ],
          productAvailability: [state.availability],
          alerts: state.cancelKitchen
            ? [
                {
                  id: `cancel:${ids.kitchenTicket}:active`,
                  ticketId: ids.kitchenTicket,
                  orderId: ids.order,
                  reference: "Mesa 12",
                  tableLabel: "Mesa 12",
                  tabLabel: "Comanda 42",
                  stationId: ids.kitchen,
                  stationName: "Cozinha",
                  reason: "Cliente desistiu",
                  canceledAt: synchronizedAt,
                  items: [{ productName: "Risoto de cogumelos", quantity: 1 }],
                },
              ]
            : [],
        },
      });
      return;
    }

    const itemTransition = path.match(/\/pilot\/kds\/([^/]+)\/items\/([^/]+)\/state$/);
    if (method === "POST" && itemTransition) {
      const ticketId = decodeURIComponent(itemTransition[1] ?? "");
      const body = request.postDataJSON() as {
        state: "preparing" | "ready";
        quantity?: number;
      };
      if (ticketId === ids.barTicket && body.state === "ready") {
        const remaining = 2 - state.barReadyQuantity;
        state.barReadyQuantity += Math.min(remaining, body.quantity ?? remaining);
        state.statuses.set(ids.barTicket, state.barReadyQuantity === 2 ? "ready" : "preparing");
      } else {
        state.statuses.set(ticketId, body.state);
      }
      state.revision += 1;
      await route.fulfill({
        status: 200,
        json: { ticketId, state: state.statuses.get(ticketId), itemState: body.state },
      });
      return;
    }

    const blockItem = path.match(/\/pilot\/kds\/([^/]+)\/items\/([^/]+)\/(block|unblock)$/);
    if (method === "POST" && blockItem) {
      const action = blockItem[3] as "block" | "unblock";
      const body = request.postDataJSON() as { reason: string };
      state.blockMutations.push({ action, reason: body.reason });
      state.blockedKitchen = action === "block";
      state.revision += 1;
      await route.fulfill({ status: 200, json: { active: state.blockedKitchen } });
      return;
    }

    const acknowledgeAttention = path.match(
      /\/pilot\/kds\/([^/]+)\/items\/([^/]+)\/attention\/acknowledge$/,
    );
    if (method === "POST" && acknowledgeAttention) {
      const body = request.postDataJSON() as { noteId: string; revision: string };
      state.attentionMutations.push(body);
      state.acknowledgedAttention = true;
      state.revision += 1;
      await route.fulfill({ status: 200, json: { acknowledgedAt: new Date().toISOString() } });
      return;
    }

    const cancel = path.match(/\/pilot\/kds\/([^/]+)\/cancel$/);
    if (method === "POST" && cancel) {
      const ticketId = decodeURIComponent(cancel[1] ?? "");
      const body = request.postDataJSON() as {
        approval: { approverMembershipId: string; pin: string; reason: string };
      };
      state.cancelMutations.push(body.approval);
      if (ticketId === ids.kitchenTicket) state.cancelKitchen = true;
      state.statuses.set(ticketId, "canceled");
      state.revision += 1;
      await route.fulfill({ status: 200, json: { ticketId, state: "canceled" } });
      return;
    }

    if (method === "POST" && /\/pilot\/kds\/[^/]+\/print-jobs$/.test(path)) {
      state.printMutations.push(request.postDataJSON() as Record<string, unknown>);
      await route.fulfill({
        status: 201,
        json: { printJob: { id: "print-job-1", status: "queued" } },
      });
      return;
    }

    const transition = path.match(/\/pilot\/kds\/([^/]+)\/state$/);
    if (method === "POST" && transition) {
      const ticketId = decodeURIComponent(transition[1] ?? "");
      const body = request.postDataJSON() as { state: TicketStatus };
      state.transitions.set(ticketId, (state.transitions.get(ticketId) ?? 0) + 1);
      state.statuses.set(ticketId, body.state);
      state.revision += 1;
      await route.fulfill({ status: 201, json: { id: ticketId, status: body.state } });
      return;
    }

    if (
      method === "POST" &&
      (path.endsWith(`/pilot/kds/orders/${ids.order}/handoff`) ||
        path.endsWith(`/pilot/kds/${ids.kitchenTicket}/handoff`) ||
        path.endsWith(`/pilot/kds/${ids.barTicket}/handoff`))
    ) {
      const body = request.postDataJSON() as { target: "expedition" | "served" };
      state.handoffTargets.push(body.target);
      if (body.target === "expedition") {
        for (const ticketId of [ids.kitchenTicket, ids.barTicket])
          state.statuses.set(ticketId, "done");
      }
      state.revision += 1;
      await route.fulfill({ status: 201, json: { orderId: ids.order, state: body.target } });
      return;
    }

    if (
      method === "PUT" &&
      path.includes("/pilot/kds/products/") &&
      path.endsWith("/availability")
    ) {
      const body = request.postDataJSON() as {
        available: boolean;
        reason: string;
        resetAt?: string | null;
        dailyStock?: number | null;
      };
      if (state.availabilityShouldFail) {
        await route.fulfill({
          status: 503,
          json: { message: "Disponibilidade temporariamente indisponível" },
        });
        return;
      }
      state.availabilityMutations.push(body);
      state.availability.available = body.available;
      state.availability.reason = body.reason;
      state.availability.resetAt = body.resetAt ?? null;
      if (Object.hasOwn(body, "dailyStock"))
        state.availability.dailyStock = body.dailyStock ?? null;
      state.availability.remainingQuantity =
        state.availability.dailyStock === null
          ? null
          : Math.max(0, state.availability.dailyStock - state.availability.soldToday);
      state.availability.status = !body.available
        ? "unavailable"
        : state.availability.dailyStock === null
          ? "available"
          : "limited";
      state.availability.updatedAt = new Date().toISOString();
      state.revision += 1;
      await route.fulfill({ status: 200, json: state.availability });
      return;
    }

    if (method === "PUT" && path.endsWith(`/pilot/kds/orders/${ids.order}/priority`)) {
      const body = request.postDataJSON() as {
        priority: number;
        reason: string;
        installationId?: string;
      };
      state.priorityMutations.push({ orderId: ids.order, ...body });
      state.orderPriority = body.priority;
      state.revision += 1;
      await route.fulfill({
        status: 200,
        json: {
          orderId: ids.order,
          ticketIds: [ids.kitchenTicket, ids.barTicket],
          ...body,
          updatedAt: new Date().toISOString(),
          updatedByIdentityId: "99999999-9999-4999-8999-999999999999",
        },
      });
      return;
    }

    if (method !== "GET" && path.includes("/pilot/kds/")) {
      await route.fulfill({ status: 201, json: { ok: true } });
      return;
    }

    await route.fulfill({ status: 404, json: { message: `Mock ausente para ${method} ${path}` } });
  });

  return state;
}

async function enterKds(page: Page) {
  await page.goto("/");
  await page.evaluate(() => {
    window.location.hash = "#/kds/station";
  });
  await page.getByRole("button", { name: "Abrir operação" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Produção" })).toBeVisible();
}

async function expectNoHorizontalOverflow(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
}

test("KDS mantém submenu, rotas e última área operacional", async ({ page }, testInfo) => {
  await mockKdsApi(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await enterKds(page);

  await expect(page).toHaveURL(/#\/kds\/station$/);
  await expect(
    page.locator(".kds-tabs").getByRole("link", { name: /Estação de preparo/ }),
  ).toHaveAttribute("aria-current", "page");
  await page.getByRole("link", { name: "Passe / expedição", exact: true }).click();
  await expect(page).toHaveURL(/#\/kds\/pass$/);
  await expect(page.getByRole("heading", { level: 1, name: "Passe / expedição" })).toBeVisible();

  await page
    .locator(".kds-tabs")
    .getByRole("link", { name: "Configurações", exact: true })
    .click();
  await expect(page).toHaveURL(/#\/kds\/settings$/);
  await expect(page.getByRole("heading", { level: 1, name: "Configurações do KDS" })).toBeVisible();
  await expect(page.getByRole("heading", { level: 2, name: "Terminal" })).toBeVisible();
  await expect(
    page.getByRole("heading", { level: 2, name: "Estações e roteamento" }),
  ).toBeVisible();
  await expect(page.getByRole("heading", { level: 2, name: "Fluxo" })).toBeVisible();
  await expect(page.getByRole("heading", { level: 2, name: "Aparência" })).toBeVisible();
  await expect(page.getByText("Somente este terminal").first()).toBeVisible();
  await expect(page.getByText("Configuração da unidade").first()).toBeVisible();
  await expect(page.getByLabel("Tecla para Ação anterior")).toHaveValue("← Esquerda");
  await expect(page.getByLabel("Tecla para Próxima ação")).toHaveValue("→ Direita");

  const settingsGrid = page.locator(".kds-settings__grid");
  await expect(settingsGrid).toHaveCSS("column-count", "2");
  const bumpMappings = page.locator(".kds-bump-map label");
  const firstDesktopMapping = await bumpMappings.nth(0).boundingBox();
  const secondDesktopMapping = await bumpMappings.nth(1).boundingBox();
  expect(Math.abs((firstDesktopMapping?.y ?? 0) - (secondDesktopMapping?.y ?? 0))).toBeLessThan(3);

  const desktopScreenshot = testInfo.outputPath("kds-configuracoes-1440.png");
  await page.screenshot({ path: desktopScreenshot, fullPage: true });
  await testInfo.attach("kds-configuracoes-1440", {
    contentType: "image/png",
    path: desktopScreenshot,
  });

  await page.setViewportSize({ width: 375, height: 812 });
  await expect(settingsGrid).toHaveCSS("column-count", "1");
  const firstMobileMapping = await bumpMappings.nth(0).boundingBox();
  const secondMobileMapping = await bumpMappings.nth(1).boundingBox();
  expect(secondMobileMapping?.y ?? 0).toBeGreaterThan(
    (firstMobileMapping?.y ?? 0) + (firstMobileMapping?.height ?? 0),
  );
  await expectNoHorizontalOverflow(page);

  await page.getByRole("link", { name: "Produção KDS", exact: true }).click();
  await expect(page).toHaveURL(/#\/kds\/pass$/);
});

test("KDS centraliza disponibilidade e sincroniza o perfil deste terminal", async ({ page }) => {
  const apiState = await mockKdsApi(page);
  await enterKds(page);

  await page
    .locator(".kds-tabs")
    .getByRole("link", { name: "Configurações", exact: true })
    .click();
  await expect(page.getByRole("heading", { name: "Central de disponibilidade" })).toBeVisible();
  await page.getByLabel("Pesquisar produto").fill("Risoto");
  await page.getByRole("button", { name: "Alterar" }).click();
  const availabilityDialog = page.getByRole("dialog", {
    name: "Disponibilidade — Risoto de cogumelos",
  });
  await availabilityDialog.getByLabel(/Esgotado/).check();
  await availabilityDialog.getByLabel("Motivo").fill("Ingrediente principal esgotado");
  await availabilityDialog.getByLabel(/Confirmo a alteração para toda a unidade/).check();
  apiState.availabilityShouldFail = true;
  await availabilityDialog.getByRole("button", { name: "Confirmar disponibilidade" }).click();
  await expect(availabilityDialog).toBeVisible();
  await expect(availabilityDialog.getByLabel("Motivo")).toHaveValue(
    "Ingrediente principal esgotado",
  );
  apiState.availabilityShouldFail = false;
  await availabilityDialog.getByRole("button", { name: "Confirmar disponibilidade" }).click();
  await expect(availabilityDialog).toHaveCount(0);
  await expect
    .poll(() => apiState.availabilityMutations)
    .toEqual([
      {
        available: false,
        reason: "Ingrediente principal esgotado",
        resetAt: null,
      },
    ]);
  await expect(page.getByText("Esgotado", { exact: true }).first()).toBeVisible();
  await expect(page.getByRole("button", { name: "Voltar a vender" })).toBeVisible();

  await page.getByLabel("Nome deste terminal").fill("KDS Bar");
  await page.locator("[data-kds-station]").selectOption({ label: "Bar" });
  await page.getByRole("button", { name: "Sincronizar perfil do terminal" }).click();
  await expect.poll(() => apiState.terminalProfile?.label).toBe("KDS Bar");
  await expect(page.getByText("Perfil sincronizado com a unidade.")).toBeVisible();
});

test("KDS real coordena duas praças e só entrega o pedido completo no passe", async ({ page }) => {
  const apiState = await mockKdsApi(page);
  await enterKds(page);

  await expect(page.locator("[data-kds-ticket]")).toHaveCount(2);
  await expect(
    page.locator(".kds-tabs").getByRole("link", { name: /Estação de preparo/ }),
  ).toHaveAttribute("aria-current", "page");
  await expect(page.getByRole("progressbar")).toHaveCount(2);
  await expect(page.getByText("Mesa 12").first()).toBeVisible();
  await expect(page.locator("[data-kds-ticket]").getByText("Cozinha").first()).toBeVisible();
  await expect(page.locator("[data-kds-ticket]").getByText("Bar").first()).toBeVisible();
  await expect(page.getByText("Sem cebola")).toBeVisible();
  await expect(page.getByText(/Alergia.*Amendoim/)).toBeVisible();
  await expect(page.getByText("Ponto bem passado")).toBeVisible();
  await page.getByText("All-day", { exact: true }).click();
  await expect(page.getByText(/\d+ A produzir/, { exact: true }).first()).toBeVisible();
  await page.locator("details.kds-all-day").getByText("Ações", { exact: true }).first().click();
  await expect(page.getByRole("button", { name: "Ver pedidos" })).toBeVisible();
  await expect(page.getByRole("button", { name: /86|indisponível/i })).toHaveCount(0);

  await page.getByText("Atalhos de teclado").click();
  await expect(page.getByText(/Setas.*ações/i)).toBeVisible();
  const loadsBeforeShortcut = apiState.loads;
  await page.keyboard.press("r");
  await expect.poll(() => apiState.loads).toBeGreaterThan(loadsBeforeShortcut);
  await expect(page.getByRole("button", { name: "Atualizar produção" })).toBeEnabled();
  await page.keyboard.press("m");
  await page.getByText("Ações do terminal").click();
  await expect(page.getByRole("button", { name: "Desativar som" })).toBeVisible();
  const bumpActions = page.locator("[data-kds-bump]");
  await bumpActions.first().focus();
  await page.keyboard.press("ArrowRight");
  await expect(bumpActions.nth(1)).toBeFocused();

  const kitchenTicket = page.locator(`[data-kds-ticket="${ids.kitchenTicket}"]`);
  const startKitchen = kitchenTicket.getByRole("button", { name: /Iniciar preparo/ });
  await startKitchen.evaluate((button: HTMLButtonElement) => {
    button.click();
    button.click();
  });
  await expect.poll(() => apiState.transitions.get(ids.kitchenTicket) ?? 0).toBe(1);
  await kitchenTicket.getByRole("button", { name: /Marcar ticket pronto/ }).click();

  await page.getByRole("link", { name: "Passe / expedição", exact: true }).click();
  await expect(
    page.locator(".kds-tabs").getByRole("link", { name: /Passe \/ expedição/ }),
  ).toHaveAttribute("aria-current", "page");
  await expect(page.getByText("Aguardando estações")).toBeVisible();
  await page.getByRole("button", { name: "Remover prioridade" }).click();
  await expect.poll(() => apiState.priorityMutations).toHaveLength(1);
  await expect(page.getByRole("button", { name: "Priorizar pedido" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Receber pedido no passe" })).toHaveCount(0);
  await page
    .locator(".kds-tabs")
    .getByRole("link", { name: "Configurações", exact: true })
    .click();
  await page.getByRole("button", { name: "Estação", exact: true }).click();
  await page.locator("[data-kds-station]").selectOption({ label: "Bar" });
  await page.getByRole("button", { name: "Fixar estação neste terminal" }).click();
  await page.getByRole("link", { name: "Estação — Bar", exact: true }).click();
  await page.reload();
  await expect(page.getByRole("heading", { level: 1, name: "Produção" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Estação — Bar", exact: true })).toBeVisible();
  await expect(page.getByText("Estação fixada", { exact: true })).toBeVisible();
  const startBar = page.getByRole("button", { name: /Iniciar preparo/ }).first();
  await startBar.click();
  await page.getByRole("button", { name: "Marcar 1 pronto" }).click();
  await expect(page.getByText("1/2 prontos")).toBeVisible();
  await page.getByRole("button", { name: "Marcar Água com gás pronto" }).click();

  await page.getByRole("link", { name: "Passe / expedição", exact: true }).click();
  const receiveAtPass = page.getByRole("button", { name: "Receber pedido no passe" });
  await expect(receiveAtPass).toBeEnabled();
  await receiveAtPass.evaluate((button: HTMLButtonElement) => {
    button.click();
    button.click();
  });
  await expect.poll(() => apiState.handoffTargets).toEqual(["expedition"]);

  const confirmDelivery = page.getByRole("button", { name: "Confirmar entrega do pedido" });
  await expect(confirmDelivery).toBeEnabled();
  await confirmDelivery.evaluate((button: HTMLButtonElement) => {
    button.click();
    button.click();
  });
  await expect.poll(() => apiState.handoffTargets).toEqual(["expedition", "served"]);
});

test("KDS bloqueia pronto sem ciência, opera bloqueio e imprime o ticket focado", async ({
  page,
}) => {
  const apiState = await mockKdsApi(page);
  apiState.attentionEnabled = true;
  await enterKds(page);

  const ticket = page.locator(`[data-kds-ticket="${ids.kitchenTicket}"]`);
  const start = ticket.getByRole("button", { name: "Iniciar preparo" });
  await start.focus();
  await page.keyboard.press("Enter");
  await expect.poll(() => apiState.statuses.get(ids.kitchenTicket)).toBe("preparing");

  const ready = ticket.getByRole("button", { name: "Marcar ticket pronto" });
  await expect(ready).toBeDisabled();
  await ticket
    .getByRole("button", { name: "Confirmar ciência de alergia em Risoto de cogumelos" })
    .click();
  await expect
    .poll(() => apiState.attentionMutations)
    .toEqual([{ noteId: "allergy", revision: "a".repeat(64) }]);
  await expect(ready).toBeEnabled();

  await ticket.getByText("Exceções do item").click();
  await ticket.getByRole("button", { name: "Bloquear item" }).click();
  const blockDialog = page.getByRole("dialog", { name: "Bloquear item" });
  await blockDialog.getByLabel("Tipo de bloqueio").selectOption("missing_ingredient");
  await blockDialog.getByLabel("Motivo", { exact: true }).fill("Sem cogumelos frescos");
  await blockDialog.getByRole("button", { name: "Confirmar bloqueio" }).click();
  await expect
    .poll(() => apiState.blockMutations.at(-1))
    .toEqual({
      action: "block",
      reason: "Sem cogumelos frescos",
    });
  await expect(ticket.getByText("Item bloqueado", { exact: false })).toBeVisible();
  await expect(ready).toBeDisabled();

  await ticket.getByRole("button", { name: "Desbloquear item" }).click();
  const unblockDialog = page.getByRole("dialog", { name: "Desbloquear item" });
  await unblockDialog.getByLabel("Motivo", { exact: true }).fill("Ingrediente reposto");
  await unblockDialog.getByRole("button", { name: "Confirmar desbloqueio" }).click();
  await expect
    .poll(() => apiState.blockMutations.at(-1))
    .toEqual({
      action: "unblock",
      reason: "Ingrediente reposto",
    });
  await expect(ready).toBeEnabled();

  await ready.focus();
  await expect(ready).toBeFocused();
  await page.keyboard.press("p");
  await expect.poll(() => apiState.printMutations).toHaveLength(1);
});

test("KDS mantém acessibilidade, dark mode e ausência de overflow nos pontos críticos", async ({
  page,
}) => {
  await mockKdsApi(page);
  await enterKds(page);

  for (const viewport of [
    { width: 375, height: 812 },
    { width: 768, height: 1024 },
    { width: 1440, height: 900 },
  ]) {
    await page.setViewportSize(viewport);
    await expectNoHorizontalOverflow(page);
  }

  await page.setViewportSize({ width: 1440, height: 900 });
  await page.getByRole("button", { name: /Abrir menu do perfil/ }).click();
  const profileMenu = page.getByRole("region", { name: "Menu do perfil" });
  const popoverBackdrop = page.getByRole("button", { name: "Fechar menu aberto" });
  await expect(profileMenu).toBeVisible();
  await expect(popoverBackdrop).toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
  await popoverBackdrop.hover({ position: { x: 24, y: 180 } });
  await expect(popoverBackdrop).toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
  await expect(profileMenu).toBeVisible();
  await page.getByRole("button", { name: /Tema escuro/ }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await expectNoHorizontalOverflow(page);

  const accessibility = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
    .analyze();
  expect(accessibility.violations).toEqual([]);
});

test("KDS deixa explícito quando a leitura está atrasada", async ({ page }) => {
  const apiState = await mockKdsApi(page);
  apiState.freshness = "stale";
  await enterKds(page);

  await expect(page.getByRole("status").filter({ hasText: "Dados atrasados" })).toBeVisible();
  await expect(page.locator("[data-kds-ticket]")).not.toHaveCount(0);
});

test("KDS mantém cancelamento visível até a cozinha confirmar ciência", async ({ page }) => {
  const apiState = await mockKdsApi(page);
  await enterKds(page);

  apiState.cancelKitchen = true;
  apiState.revision += 1;
  await page.getByRole("button", { name: "Atualizar produção" }).click();

  const alert = page.getByRole("heading", { name: "Pedido cancelado — Mesa 12" });
  await expect(alert).toBeVisible();
  await page.getByRole("button", { name: "Confirmar ciência do cancelamento de Mesa 12" }).click();
  await expect(alert).toHaveCount(0);
});

test("KDS exige confirmação e PIN gerencial para cancelar um ticket", async ({ page }) => {
  const apiState = await mockKdsApi(page);
  await enterKds(page);

  await page.getByText("Mais ações do ticket").first().click();
  await page.getByRole("button", { name: "Cancelar ticket Mesa 12" }).click();
  await expect(page.getByRole("dialog", { name: "Cancelar ticket — Mesa 12" })).toBeVisible();
  await page.getByLabel("Motivo do cancelamento").fill("Cliente desistiu");
  await page.getByLabel("PIN gerencial").fill("1234");
  await page
    .getByLabel("Confirmo o cancelamento deste ticket e a interrupção da produção.")
    .check();
  await page.getByRole("button", { name: "Confirmar cancelamento" }).click();

  await expect
    .poll(() => apiState.cancelMutations)
    .toEqual([
      {
        approverMembershipId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        pin: "1234",
        reason: "Cliente desistiu",
      },
    ]);
  await expect(page.getByRole("heading", { name: "Pedido cancelado — Mesa 12" })).toBeVisible();
});
