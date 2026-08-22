import { expect, type Page, test } from "@playwright/test";

const organizationId = "org-people";
const unitId = "unit-people";
const settings = {
  mode: "all",
  geofenceEnabled: true,
  locationLabel: "Unidade Centro",
  latitude: -23.5505,
  longitude: -46.6333,
  radiusMeters: 100,
  accuracyToleranceMeters: 50,
  managerCanView: true,
  financeCanView: false,
  antiFraudEnabled: true,
  offlineEnabled: true,
  notificationsEnabled: true,
  managerAlertOnAnomaly: true,
  lateToleranceMinutes: 15,
  minimumBreakMinutes: 30,
  maxOvertimeMinutes: 120,
  longShiftAlertMinutes: 720,
  reminderBeforeShiftMinutes: 15,
  reminderAfterShiftMinutes: 15,
};

const people = [
  {
    id: "person-1",
    identityId: "identity-people",
    name: "Ana Martins",
    roleLabel: "Gerente",
    active: true,
    hourlyRateCents: 3200,
    updatedAt: "2026-08-17T12:00:00.000Z",
    access: {
      status: "active",
      email: "ana@giromesa.test",
      role: "manager",
      membershipId: "membership-people",
    },
  },
  {
    id: "person-2",
    identityId: null,
    name: "Bruno Lima",
    roleLabel: "Garçom",
    active: true,
    hourlyRateCents: 2200,
    updatedAt: "2026-08-17T12:00:00.000Z",
    access: { status: "none" },
  },
  {
    id: "person-3",
    identityId: "identity-pending",
    name: "Carla Souza",
    roleLabel: "Caixa",
    active: true,
    hourlyRateCents: 2400,
    updatedAt: "2026-08-17T12:00:00.000Z",
    access: {
      status: "pending",
      email: "carla@giromesa.test",
      role: "cashier",
      invitationId: "invitation-3",
      expiresAt: "2026-08-25T12:00:00.000Z",
    },
  },
  {
    id: "person-4",
    identityId: "identity-expired",
    name: "Diego Santos",
    roleLabel: "Cozinha",
    active: true,
    hourlyRateCents: 2300,
    updatedAt: "2026-08-17T12:00:00.000Z",
    access: {
      status: "expired",
      email: "diego@giromesa.test",
      role: "kds",
      invitationId: "invitation-4",
      expiresAt: "2026-08-10T12:00:00.000Z",
    },
  },
  {
    id: "person-5",
    identityId: "identity-suspended",
    name: "Eva Rocha",
    roleLabel: "Estoque",
    active: true,
    hourlyRateCents: 2500,
    updatedAt: "2026-08-17T12:00:00.000Z",
    access: {
      status: "suspended",
      email: "eva@giromesa.test",
      role: "inventory",
      membershipId: "membership-5",
    },
  },
];

const schedules = [
  {
    id: "schedule-1",
    personId: "person-2",
    startsAt: "2026-08-18T14:00:00.000Z",
    endsAt: "2026-08-18T22:00:00.000Z",
    breakMinutes: 30,
    notes: null,
    updatedAt: "2026-08-17T12:00:00.000Z",
  },
];

const commissionRules = [{ id: "rule-1", name: "Venda do salão", basisPoints: 500, active: true }];

const commissions = [
  {
    id: "commission-1",
    personId: "person-1",
    ruleId: "rule-1",
    sourceOrderId: null,
    baseCents: 100_000,
    amountCents: 5_000,
    status: "pending",
    createdAt: "2026-08-17T18:00:00.000Z",
  },
];

type CapturedRequest = {
  body: Record<string, unknown>;
  idempotencyKey: string | undefined;
};

async function mockPeopleApi(
  page: Page,
  options: { canView?: boolean; role?: "owner" | "manager" | "finance" } = {},
) {
  const canView = options.canView ?? true;
  const role = options.role ?? "owner";
  const captured = {
    commissions: [] as CapturedRequest[],
    commissionTransitions: [] as CapturedRequest[],
    commissionRules: [] as Array<Record<string, unknown>>,
    correctionDecisions: [] as Array<Record<string, unknown>>,
    closures: [] as Array<Record<string, unknown>>,
    directoryQueries: [] as Array<Record<string, string>>,
    peopleUpdates: [] as Array<Record<string, unknown>>,
    peopleStatus: [] as Array<Record<string, unknown>>,
    peopleCreates: [] as Array<Record<string, unknown>>,
    accessActions: [] as Array<{
      action: string;
      method: string;
      body: Record<string, unknown>;
    }>,
    unitAccessActions: [] as Array<{
      method: string;
      body: Record<string, unknown>;
    }>,
    terminalRevocations: [] as Array<Record<string, unknown>>,
    scheduleUpdates: [] as Array<Record<string, unknown>>,
    scheduleCancellations: [] as Array<Record<string, unknown>>,
    scheduleBatchPreviews: [] as Array<Record<string, unknown>>,
    scheduleBatches: [] as CapturedRequest[],
    assignments: [] as CapturedRequest[],
  };

  await page.route("**/v1/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname;
    const method = request.method();

    if (method === "GET" && path.endsWith("/auth/terminal-session")) {
      await route.fulfill({ status: 401, json: { code: "TERMINAL_SESSION_REQUIRED" } });
      return;
    }

    if (method === "POST" && path.endsWith("/management/people")) {
      captured.peopleCreates.push(request.postDataJSON() as Record<string, unknown>);
      await route.fulfill({ json: { id: "person-new" } });
      return;
    }
    const unitAccessMatch = path.match(
      /\/management\/people\/([^/]+)\/access\/units(?:\/([^/]+))?$/,
    );
    if (unitAccessMatch && (method === "POST" || method === "DELETE")) {
      captured.unitAccessActions.push({
        method,
        body: (request.postDataJSON() ?? {}) as Record<string, unknown>,
      });
      await route.fulfill({ json: { personId: unitAccessMatch[1], unitId: unitAccessMatch[2] } });
      return;
    }
    if (method === "POST" && /\/management\/people\/terminals\/[^/]+\/revoke$/.test(path)) {
      captured.terminalRevocations.push(request.postDataJSON() as Record<string, unknown>);
      await route.fulfill({ json: { revoked: true } });
      return;
    }
    const accessMatch = path.match(/\/management\/people\/([^/]+)\/access(?:\/([^/]+))?$/);
    if (accessMatch && (method === "POST" || method === "PATCH")) {
      captured.accessActions.push({
        action: accessMatch[2] ?? "update",
        method,
        body: (request.postDataJSON() ?? {}) as Record<string, unknown>,
      });
      await route.fulfill({ json: { personId: accessMatch[1], ok: true } });
      return;
    }

    if (method === "PATCH" && path.endsWith("/management/people/person-2")) {
      captured.peopleUpdates.push(request.postDataJSON() as Record<string, unknown>);
      await route.fulfill({ json: { ...people[1], ...request.postDataJSON() } });
      return;
    }
    if (
      method === "POST" &&
      (path.endsWith("/management/people/person-2/inactivate") ||
        path.endsWith("/management/people/person-2/reactivate"))
    ) {
      captured.peopleStatus.push(request.postDataJSON() as Record<string, unknown>);
      await route.fulfill({ json: { personId: "person-2", active: path.endsWith("reactivate") } });
      return;
    }

    if (method === "GET" && path.endsWith("/management/people/access-center")) {
      await route.fulfill({
        json: {
          terminals: [
            {
              id: "00000000-0000-4000-8000-000000000099",
              deviceId: "caixa-centro-01",
              openedBy: "Ana Martins",
              activeOperator: "Bruno Lima",
              status: "active",
              createdAt: "2026-08-22T10:00:00.000Z",
              lastActivityAt: "2026-08-22T10:10:00.000Z",
              lockedUntil: null,
              expiresAt: "2026-08-23T10:00:00.000Z",
            },
          ],
        },
      });
      return;
    }
    const overviewMatch = path.match(/\/management\/people\/([^/]+)\/access-overview$/);
    if (method === "GET" && overviewMatch) {
      const person = people.find((item) => item.id === overviewMatch[1]) ?? people[1];
      await route.fulfill({
        json: {
          units: [
            { id: unitId, name: "Unidade Centro", active: true },
            { id: "unit-north", name: "Unidade Norte", active: true },
          ],
          assignments:
            person?.access.status === "none"
              ? []
              : [
                  {
                    unitId,
                    unitName: "Unidade Centro",
                    primary: true,
                    access: person?.access,
                    delivery:
                      person?.id === "person-3"
                        ? {
                            status: "failed",
                            attempts: 3,
                            processedAt: null,
                            lastError: "Servidor de e-mail indisponível",
                          }
                        : null,
                  },
                ],
          history: [
            {
              id: `audit-${person?.id}`,
              action: "management.person.access.invited",
              actorName: "Ana Martins",
              metadata: {},
              occurredAt: "2026-08-22T10:00:00.000Z",
            },
          ],
          offboarding: {
            canProceed: true,
            counts: {
              openTimeEntries: 0,
              futureSchedules: person?.id === "person-2" ? 1 : 0,
              unsettledCommissions: 0,
              openCashShifts: 0,
              activeTerminals: 0,
              accessAssignments: person?.access.status === "none" ? 0 : 1,
            },
            checks: [],
          },
        },
      });
      return;
    }
    if (method === "GET" && /\/management\/people\/[^/]+\/offboarding-preflight$/.test(path)) {
      await route.fulfill({
        json: {
          canProceed: true,
          counts: {
            openTimeEntries: 0,
            futureSchedules: 1,
            unsettledCommissions: 0,
            openCashShifts: 0,
            activeTerminals: 0,
            accessAssignments: 0,
          },
          checks: [
            { code: "OPEN_TIME", label: "Turnos em aberto", count: 0, severity: "blocker" },
            { code: "SCHEDULES", label: "Escalas futuras", count: 1, severity: "warning" },
          ],
        },
      });
      return;
    }
    if (method === "PATCH" && path.endsWith("/management/people/schedules/schedule-1")) {
      captured.scheduleUpdates.push(request.postDataJSON() as Record<string, unknown>);
      await route.fulfill({ json: { ...schedules[0], ...request.postDataJSON() } });
      return;
    }
    if (method === "POST" && path.endsWith("/management/people/schedules/schedule-1/cancel")) {
      captured.scheduleCancellations.push(request.postDataJSON() as Record<string, unknown>);
      await route.fulfill({ json: { scheduleId: "schedule-1", status: "canceled" } });
      return;
    }
    if (method === "POST" && path.endsWith("/management/people/schedules/batch/preview")) {
      captured.scheduleBatchPreviews.push(request.postDataJSON() as Record<string, unknown>);
      await route.fulfill({ json: { conflicts: [] } });
      return;
    }
    if (method === "POST" && path.endsWith("/management/people/schedules/batch")) {
      captured.scheduleBatches.push({
        body: request.postDataJSON() as Record<string, unknown>,
        idempotencyKey: request.headers()["idempotency-key"],
      });
      await route.fulfill({ json: { schedules: [], count: 1 } });
      return;
    }
    if (method === "POST" && path.endsWith("/management/people/time-tracking/assignments/batch")) {
      captured.assignments.push({
        body: request.postDataJSON() as Record<string, unknown>,
        idempotencyKey: request.headers()["idempotency-key"],
      });
      await route.fulfill({ json: { count: 1 } });
      return;
    }
    if (
      method === "POST" &&
      path.endsWith("/management/people/commissions/commission-1/transition")
    ) {
      captured.commissionTransitions.push({
        body: request.postDataJSON() as Record<string, unknown>,
        idempotencyKey: request.headers()["idempotency-key"],
      });
      await route.fulfill({ json: { ...commissions[0], status: "approved" } });
      return;
    }

    if (method === "POST" && path.endsWith("/management/people/commissions")) {
      captured.commissions.push({
        body: request.postDataJSON() as Record<string, unknown>,
        idempotencyKey: request.headers()["idempotency-key"],
      });
      await route.fulfill({ json: { id: "commission-new" } });
      return;
    }
    if (method === "POST" && path.endsWith("/management/people/commission-rules")) {
      captured.commissionRules.push(request.postDataJSON() as Record<string, unknown>);
      await route.fulfill({ json: { id: "rule-new" } });
      return;
    }
    if (method === "POST" && path.endsWith("/management/people/time-tracking/closures")) {
      captured.closures.push(request.postDataJSON() as Record<string, unknown>);
      await route.fulfill({ json: { id: "closure-new" } });
      return;
    }
    if (
      method === "POST" &&
      path.endsWith("/management/people/time-corrections/correction-1/decision")
    ) {
      captured.correctionDecisions.push(request.postDataJSON() as Record<string, unknown>);
      await route.fulfill({ json: { id: "correction-1", status: "rejected" } });
      return;
    }

    let directoryItems = people;
    if (url.searchParams.get("status") === "unlinked") {
      directoryItems = people.filter((person) => person.identityId === null);
    }
    if (url.searchParams.get("status") === "on_shift") {
      directoryItems = people.filter((person) => person.id === "person-2");
    }
    const query = url.searchParams.get("q")?.toLocaleLowerCase("pt-BR");
    if (query) {
      directoryItems = directoryItems.filter((person) =>
        `${person.name} ${person.roleLabel}`.toLocaleLowerCase("pt-BR").includes(query),
      );
    }

    const payload =
      path === "/v1/auth/me"
        ? {
            identity: {
              id: "identity-people",
              email: "ana@giromesa.test",
              displayName: "Ana Martins",
            },
            memberships: [{ membershipId: "membership-people", organizationId, status: "active" }],
            platformAdmin: false,
          }
        : path === "/v1/organizations"
          ? [
              {
                membershipId: "membership-people",
                organization: {
                  id: organizationId,
                  tradeName: "GiroMesa Pessoas",
                  document: "12345678000199",
                },
                units: [
                  {
                    id: unitId,
                    name: "Unidade Centro",
                    timezone: "America/Sao_Paulo",
                    active: true,
                  },
                ],
                scopes: [{ role, unitId }],
              },
            ]
          : path.endsWith("/management/people/self")
            ? {
                enabled: true,
                person: people[0],
                settings,
                current: null,
                entries: [],
                breaks: [],
              }
            : path.endsWith("/management/people/capabilities")
              ? {
                  canView,
                  canManage: canView && (role === "owner" || role === "manager"),
                  canConfigure: canView && role === "owner",
                  canApproveCommissions: canView && (role === "owner" || role === "manager"),
                  canPayCommissions: canView && (role === "owner" || role === "finance"),
                  reason: canView ? null : "TIME_TRACKING_POLICY_DENIED",
                }
              : path.endsWith("/management/people/directory")
                ? (() => {
                    captured.directoryQueries.push(Object.fromEntries(url.searchParams));
                    return {
                      items: directoryItems,
                      pagination: {
                        page: Number(url.searchParams.get("page") ?? 1),
                        pageSize: 20,
                        total: directoryItems.length,
                        totalPages: 1,
                      },
                    };
                  })()
                : path.endsWith("/management/people/indicators/operational")
                  ? {
                      period: { from: "2026-08-01", to: "2026-08-17" },
                      timezone: "America/Sao_Paulo",
                      indicators: {
                        scheduledShifts: 1,
                        absences: 0,
                        lateArrivals: 0,
                        overtimeMinutes: 0,
                        laborCostCents: 25_600,
                        laborCostPercentage: 0.08,
                      },
                      coverage: {
                        schedules: "complete",
                        timeEntries: "complete",
                        laborCost: "complete",
                        missingHourlyRatePeople: 0,
                      },
                    }
                  : path.endsWith("/management/people/person-2/timeline")
                    ? {
                        person: people[1],
                        period: {
                          from: "2026-08-01",
                          to: "2026-08-17",
                          timezone: "America/Sao_Paulo",
                        },
                        schedules,
                        entries: [
                          {
                            id: "entry-timeline-1",
                            personId: "person-2",
                            clockedInAt: "2026-08-16T14:15:00.000Z",
                            clockedOutAt: "2026-08-16T22:00:00.000Z",
                            source: "manual",
                            person: { name: "Bruno Lima" },
                            hourlyRateCents: 2200,
                            estimatedLaborCostCents: 16_500,
                            summary: {
                              timeEntryId: "entry-timeline-1",
                              personId: "person-2",
                              date: "2026-08-16",
                              workedMinutes: 450,
                              breakMinutes: 30,
                              scheduledMinutes: 480,
                              overtimeMinutes: 0,
                              anomalyCodes: ["late_arrival"],
                            },
                          },
                        ],
                        corrections: [],
                        commissions: [],
                        reconciliation: {
                          scheduledMinutes: 480,
                          workedMinutes: 450,
                          overtimeMinutes: 0,
                          lateArrivals: 1,
                        },
                        coverage: {
                          schedules: "complete",
                          timeEntries: "complete",
                          laborCost: "complete",
                        },
                      }
                    : path.endsWith("/management/people/time-tracking/report")
                      ? {
                          from: "2026-08-01",
                          to: "2026-08-17",
                          timezone: "America/Sao_Paulo",
                          rows: [
                            {
                              id: "entry-report-1",
                              personId: "person-1",
                              clockedInAt: "2026-08-16T14:00:00.000Z",
                              clockedOutAt: "2026-08-16T22:00:00.000Z",
                              source: "manual",
                              person: { name: "Ana Martins" },
                              hourlyRateCents: 3200,
                              estimatedLaborCostCents: 25_600,
                              summary: {
                                timeEntryId: "entry-report-1",
                                personId: "person-1",
                                date: "2026-08-16",
                                workedMinutes: 480,
                                breakMinutes: 30,
                                scheduledMinutes: 480,
                                overtimeMinutes: 0,
                                anomalyCodes: [],
                              },
                            },
                          ],
                          totals: {
                            workedMinutes: 480,
                            breakMinutes: 30,
                            overtimeMinutes: 0,
                            laborCostCents: 25_600,
                            revenueCents: 320_000,
                            laborCostPercentage: 0.08,
                            entries: 1,
                            anomalies: 0,
                          },
                        }
                      : path.endsWith("/management/people")
                        ? {
                            people,
                            schedules,
                            timeEntries: [
                              {
                                id: "entry-1",
                                personId: "person-2",
                                clockedInAt: "2026-08-17T14:00:00.000Z",
                                clockedOutAt: null,
                                source: "manual",
                              },
                            ],
                            breaks: [],
                            corrections: [
                              {
                                id: "correction-1",
                                timeEntryId: "entry-1",
                                personId: "person-2",
                                requestedClockedInAt: "2026-08-17T13:55:00.000Z",
                                requestedClockedOutAt: null,
                                reason: "Ajuste de entrada",
                                status: "pending",
                                requiresSpecialApproval: false,
                              },
                            ],
                            summaries: [],
                            anomalies: [],
                            alerts: [
                              {
                                type: "missing_clock_out",
                                personId: "person-2",
                                timeEntryId: "entry-1",
                                message: "Turno ainda sem saída registrada.",
                                severity: "warning",
                              },
                            ],
                            closures: [],
                            settings,
                            canManage: true,
                            accounts: [],
                            selectedPersonIds: [],
                            commissionRules,
                            commissions,
                          }
                        : null;

    await route.fulfill(
      payload === null
        ? { status: 404, json: { message: `Mock ausente para ${method} ${path}` } }
        : { json: payload },
    );
  });

  return captured;
}

async function openPeople(page: Page) {
  await page.goto("/#/people");
  await page.getByRole("button", { name: "Abrir operação" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Pessoas" })).toBeVisible();
}

test("Pessoas prioriza o resumo e permanece utilizável no mobile", async ({ page }, testInfo) => {
  await mockPeopleApi(page);
  await openPeople(page);

  await expect(page.getByRole("heading", { name: "Operação de pessoas" })).toBeVisible();
  await expect(page.locator(".people-overview__metrics > div")).toHaveCount(4);
  await expect(page.getByText("Ponto ativo", { exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Turnos em andamento" })).toBeVisible();
  await testInfo.attach("pessoas-desktop-light", {
    body: await page.screenshot({ fullPage: true }),
    contentType: "image/png",
  });

  const lightSurface = await page
    .locator(".people-overview")
    .evaluate((element) => getComputedStyle(element).backgroundColor);
  await page.evaluate(() => document.documentElement.setAttribute("data-theme", "dark"));
  expect(
    await page
      .locator(".people-overview")
      .evaluate((element) => getComputedStyle(element).backgroundColor),
  ).not.toBe(lightSurface);
  await testInfo.attach("pessoas-desktop-dark", {
    body: await page.screenshot({ fullPage: true }),
    contentType: "image/png",
  });

  await page.setViewportSize({ width: 375, height: 812 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  await page.getByRole("button", { name: /Configurações/ }).click();
  await page.getByText("Política de ponto", { exact: true }).click();
  await expect(page.getByRole("button", { name: "Salvar política" })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  await testInfo.attach("pessoas-mobile-375-dark", {
    body: await page.screenshot({ fullPage: true }),
    contentType: "image/png",
  });
});

test("Pessoas navega, filtra e executa fluxos reais sem diálogos nativos", async ({ page }) => {
  const captured = await mockPeopleApi(page);
  const nativeDialogs: string[] = [];
  page.on("dialog", async (dialog) => {
    nativeDialogs.push(dialog.type());
    await dialog.dismiss();
  });
  await openPeople(page);

  await page.getByRole("button", { name: "Rejeitar" }).click();
  const rejection = page.getByRole("dialog", { name: "Rejeitar correção" });
  await expect(rejection).toBeVisible();
  await rejection.getByLabel("Motivo").fill("Horário informado não confere");
  await rejection.getByRole("button", { name: "Confirmar" }).click();
  await expect
    .poll(() => captured.correctionDecisions)
    .toEqual([{ decision: "reject", reviewNote: "Horário informado não confere" }]);

  await page.getByRole("button", { name: /Equipe/ }).click();
  const teamCard = page
    .locator(".people-list-card")
    .filter({ has: page.getByRole("heading", { name: "Pessoas da unidade" }) });
  const search = page.getByRole("searchbox", { name: "Buscar por nome ou função" });
  await search.fill("Bruno");
  await expect(teamCard.getByText("Bruno Lima", { exact: true })).toBeVisible();
  await expect(teamCard.getByText("Ana Martins", { exact: true })).toBeHidden();
  await search.fill("");
  await page.getByLabel("Filtrar situação da pessoa").selectOption("unlinked");
  await expect(teamCard.getByText("Bruno Lima", { exact: true })).toBeVisible();
  await expect(teamCard.getByText("Ana Martins", { exact: true })).toBeHidden();

  await page.getByRole("button", { name: "Ver detalhes" }).click();
  const personDialog = page.getByRole("dialog", { name: "Bruno Lima" });
  await expect(personDialog.getByRole("heading", { name: "Escalas recentes" })).toBeVisible();
  await expect(personDialog.getByText(/30 min de intervalo/)).toBeVisible();
  await personDialog.getByRole("button", { name: "Fechar" }).click();

  await page.getByLabel("Filtrar situação da pessoa").selectOption("all");
  const commissionCard = page.locator(".people-commission-card");
  const commissionForm = commissionCard.locator("form").nth(1);
  await commissionForm.getByRole("combobox").nth(0).selectOption("person-1");
  await commissionForm.getByRole("combobox").nth(1).selectOption("rule-1");
  await commissionForm.getByLabel("Base da comissão (R$)").fill("250.50");
  await commissionForm.getByRole("button", { name: "Lançar comissão" }).click();
  await expect.poll(() => captured.commissions.length).toBe(1);
  expect(captured.commissions[0]?.body).toEqual({
    personId: "person-1",
    ruleId: "rule-1",
    baseCents: 25_050,
  });
  expect(captured.commissions[0]?.idempotencyKey).toBeTruthy();

  await page.getByRole("button", { name: /Escalas/ }).click();
  const schedulesCard = page
    .locator(".people-list-card")
    .filter({ has: page.getByRole("heading", { name: "Escalas cadastradas" }) });
  await expect(schedulesCard).toBeVisible();
  await expect(schedulesCard.getByText("Bruno Lima", { exact: true })).toBeVisible();

  await page.getByRole("button", { name: /Ponto e relatórios/ }).click();
  await page.getByRole("button", { name: "Consultar horas" }).click();
  const reportTable = page.getByRole("table", { name: "Detalhamento do relatório de horas" });
  await expect(reportTable).toBeVisible();
  await expect(reportTable.getByText("Ana Martins", { exact: true })).toBeVisible();
  await expect(reportTable.getByText("R$ 256,00", { exact: true })).toBeVisible();

  await page.getByRole("button", { name: "Fechar período" }).click();
  const closure = page.getByRole("dialog", { name: "Fechar período" });
  await expect(closure).toBeVisible();
  await closure.getByLabel("Motivo opcional").fill("Fechamento mensal");
  await closure.getByRole("button", { name: "Confirmar" }).click();
  await expect.poll(() => captured.closures.length).toBe(1);
  expect(captured.closures[0]).toMatchObject({ reason: "Fechamento mensal" });
  expect(nativeDialogs).toEqual([]);
});

test("Pessoas opera cadastro, lote, escala, espelho e comissão com auditoria", async ({ page }) => {
  const captured = await mockPeopleApi(page);
  await openPeople(page);
  await page.getByRole("button", { name: /Equipe/ }).click();

  await page.getByLabel("Selecionar Bruno Lima").check();
  await page.getByRole("button", { name: "Habilitar ponto" }).click();
  await expect.poll(() => captured.assignments.length).toBe(1);
  expect(captured.assignments[0]).toMatchObject({
    body: { personIds: ["person-2"], enabled: true },
  });
  expect(captured.assignments[0]?.idempotencyKey).toBeTruthy();

  await page.getByRole("button", { name: "Ver detalhes" }).nth(1).click();
  const personDialog = page.getByRole("dialog", { name: "Bruno Lima" });
  await expect(personDialog.locator(".people-reconciliation-grid")).toContainText("7h 30min");
  await expect(personDialog.getByRole("table")).toContainText("Entrada atrasada");
  const editForm = personDialog.locator("form.people-person-edit");
  await editForm.locator("input").nth(1).fill("Garçom líder");
  await editForm.getByRole("button", { name: /Salvar/ }).click();
  await expect.poll(() => captured.peopleUpdates.length).toBe(1);
  expect(captured.peopleUpdates[0]).toMatchObject({
    roleLabel: "Garçom líder",
    expectedUpdatedAt: "2026-08-17T12:00:00.000Z",
  });

  await personDialog.getByRole("button", { name: "Inativar" }).click();
  const personStatus = page.getByRole("dialog", { name: "Inativar pessoa" });
  await expect(personStatus.getByText("Escalas futuras", { exact: true })).toBeVisible();
  await expect(personStatus.getByText("Será preservado", { exact: true })).toBeVisible();
  await personStatus.getByLabel("Motivo").fill("Encerramento do vínculo operacional");
  await personStatus.getByRole("button", { name: "Confirmar" }).click();
  await expect.poll(() => captured.peopleStatus.length).toBe(1);

  const commissionCard = page.locator(".people-commission-card");
  await commissionCard.getByRole("button", { name: "Aprovar" }).click();
  const commissionApproval = page.getByRole("dialog", { name: "Atualizar comissão" });
  await commissionApproval.getByLabel("Motivo").fill("Venda conferida no fechamento");
  await commissionApproval.getByRole("button", { name: "Confirmar" }).click();
  await expect.poll(() => captured.commissionTransitions.length).toBe(1);
  expect(captured.commissionTransitions[0]).toMatchObject({
    body: { action: "approve", note: "Venda conferida no fechamento" },
  });
  expect(captured.commissionTransitions[0]?.idempotencyKey).toBeTruthy();

  await page.getByRole("button", { name: /Escalas/ }).click();
  const scheduleCard = page
    .locator(".people-list-card")
    .filter({ has: page.getByRole("heading", { name: "Escalas cadastradas" }) });
  await scheduleCard.getByRole("button", { name: "Editar" }).click();
  const editSchedule = page.getByRole("dialog", { name: "Editar escala" });
  await editSchedule.getByLabel("Intervalo (min)").fill("45");
  await editSchedule.getByRole("button", { name: "Salvar escala" }).click();
  await expect.poll(() => captured.scheduleUpdates.length).toBe(1);
  expect(captured.scheduleUpdates[0]).toMatchObject({
    breakMinutes: 45,
    expectedUpdatedAt: "2026-08-17T12:00:00.000Z",
  });

  await page.getByText("Escalas em lote", { exact: true }).click();
  const batchPanel = page.locator(".people-batch-panel");
  await batchPanel.getByLabel("Ana Martins").check();
  await batchPanel.getByRole("button", { name: /visualizar lote/ }).click();
  await expect(batchPanel.getByRole("status")).toContainText("Nenhum conflito detectado");
  await batchPanel.getByRole("button", { name: "Confirmar lote" }).click();
  await expect.poll(() => captured.scheduleBatches.length).toBe(1);
  expect(captured.scheduleBatchPreviews).toHaveLength(1);
  expect(captured.scheduleBatches[0]?.idempotencyKey).toBeTruthy();
});

test("Pessoas cadastra e administra convite, perfil e suspensão de acesso", async ({ page }) => {
  const captured = await mockPeopleApi(page);
  await openPeople(page);
  await page.getByRole("button", { name: /Equipe/ }).click();
  await page.setViewportSize({ width: 375, height: 812 });
  await page.evaluate(() => document.documentElement.setAttribute("data-theme", "dark"));

  await page.getByRole("button", { name: "Novo funcionário", exact: true }).click();
  const createDialog = page.getByRole("dialog", { name: "Novo funcionário" });
  await createDialog.getByLabel("Nome").fill("Felipe Nunes");
  await createDialog.getByLabel("Função").fill("Garçom");
  await createDialog.getByLabel(/Também terá acesso/).check();
  await createDialog.getByLabel("E-mail de acesso").fill("FELIPE@GIROMESA.TEST");
  await createDialog.getByLabel("Perfil de acesso").selectOption("waiter");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  await createDialog.getByRole("button", { name: "Cadastrar e convidar" }).click();
  await expect.poll(() => captured.peopleCreates.length).toBe(1);
  expect(captured.peopleCreates[0]).toMatchObject({
    name: "Felipe Nunes",
    roleLabel: "Garçom",
    access: { email: "felipe@giromesa.test", role: "waiter" },
  });

  const teamCard = page
    .locator(".people-list-card")
    .filter({ has: page.getByRole("heading", { name: "Pessoas da unidade" }) });
  const openDetails = async (name: string) => {
    const row = teamCard.locator(".people-row").filter({ hasText: name });
    await row.getByRole("button", { name: "Ver detalhes" }).click();
    return page.getByRole("dialog", { name });
  };

  const bruno = await openDetails("Bruno Lima");
  await bruno.getByRole("button", { name: "Conceder acesso" }).click();
  const invite = page.getByRole("dialog", { name: "Conceder acesso" });
  await invite.getByLabel("E-mail de acesso").fill("bruno@giromesa.test");
  await invite.getByLabel("Perfil de acesso").selectOption("waiter");
  await invite.getByRole("button", { name: "Confirmar" }).click();
  await expect(invite).toBeHidden();
  await bruno.getByRole("button", { name: "Fechar" }).click();

  const carla = await openDetails("Carla Souza");
  await expect(carla.getByText("Último erro: Servidor de e-mail indisponível")).toBeVisible();
  await carla.getByRole("button", { name: "Reenviar convite" }).click();
  await carla.getByRole("button", { name: "Cancelar convite" }).click();
  const cancel = page.getByRole("dialog", { name: "Cancelar convite" });
  await cancel.getByLabel("Motivo").fill("E-mail informado incorretamente");
  await cancel.getByRole("button", { name: "Confirmar" }).click();
  await expect(cancel).toBeHidden();
  await carla.getByRole("button", { name: "Fechar" }).click();

  const ana = await openDetails("Ana Martins");
  await expect(ana.getByRole("heading", { name: "Unidades liberadas" })).toBeVisible();
  await expect(ana.getByRole("heading", { name: "Histórico de acesso" })).toBeVisible();
  await ana.getByRole("button", { name: "Liberar outra unidade" }).click();
  const unitAccess = page.getByRole("dialog", { name: "Liberar outra unidade" });
  await unitAccess.getByLabel("Perfil nesta unidade").selectOption("manager");
  await unitAccess.getByLabel("Motivo").fill("Cobertura temporária da unidade");
  await unitAccess.getByLabel("Confirmar com").selectOption("mfa");
  await unitAccess.getByLabel("Código de 6 dígitos").fill("123456");
  await unitAccess.getByRole("button", { name: "Confirmar" }).click();
  await expect
    .poll(() => captured.unitAccessActions)
    .toEqual([
      {
        method: "POST",
        body: {
          unitId: "unit-north",
          role: "manager",
          reason: "Cobertura temporária da unidade",
          reauth: { mfaCode: "123456" },
        },
      },
    ]);
  await ana.getByRole("button", { name: "Alterar perfil" }).click();
  const profile = page.getByRole("dialog", { name: "Alterar perfil" });
  await profile.getByLabel("Perfil de acesso").selectOption("cashier");
  await profile.getByLabel("Motivo").fill("Transferência para o caixa");
  await profile.getByLabel("Senha atual", { exact: true }).fill("senha-do-proprietário");
  await profile.getByRole("button", { name: "Confirmar" }).click();
  await expect(profile).toBeHidden();
  await ana.getByRole("button", { name: "Suspender acesso" }).click();
  const suspend = page.getByRole("dialog", { name: "Suspender acesso" });
  await suspend.getByLabel("Motivo").fill("Afastamento temporário");
  await suspend.getByRole("button", { name: "Confirmar" }).click();
  await expect(suspend).toBeHidden();
  await ana.getByRole("button", { name: "Fechar" }).click();

  const eva = await openDetails("Eva Rocha");
  await eva.getByRole("button", { name: "Reativar acesso" }).click();
  const reactivate = page.getByRole("dialog", { name: "Reativar acesso" });
  await reactivate.getByLabel("Motivo").fill("Retorno ao trabalho");
  await reactivate.getByRole("button", { name: "Confirmar" }).click();
  await expect(reactivate).toBeHidden();
  await eva.getByRole("button", { name: "Fechar" }).click();

  await expect(teamCard.getByText("Convite expirado", { exact: true })).toBeVisible();
  expect(captured.accessActions).toEqual(
    expect.arrayContaining([
      { action: "invite", method: "POST", body: { email: "bruno@giromesa.test", role: "waiter" } },
      { action: "resend", method: "POST", body: {} },
      { action: "cancel", method: "POST", body: { reason: "E-mail informado incorretamente" } },
      {
        action: "update",
        method: "PATCH",
        body: {
          role: "cashier",
          reason: "Transferência para o caixa",
          reauth: { currentPassword: "senha-do-proprietário" },
        },
      },
      { action: "suspend", method: "POST", body: { reason: "Afastamento temporário" } },
      {
        action: "reactivate",
        method: "POST",
        body: { role: "inventory", reason: "Retorno ao trabalho" },
      },
    ]),
  );

  await page.getByRole("button", { name: /Acessos/ }).click();
  const terminals = page
    .locator(".people-list-card")
    .filter({ has: page.getByRole("heading", { name: "Sessões ativas nesta unidade" }) });
  await expect(terminals.getByText("Bruno Lima", { exact: true })).toBeVisible();
  await terminals.getByRole("button", { name: "Encerrar" }).click();
  const revokeTerminal = page.getByRole("dialog", { name: "Encerrar terminal remotamente" });
  await revokeTerminal.getByLabel("Motivo").fill("Terminal fora da operação");
  await revokeTerminal.getByRole("button", { name: "Confirmar" }).click();
  await expect
    .poll(() => captured.terminalRevocations)
    .toEqual([{ reason: "Terminal fora da operação" }]);

  await page.setViewportSize({ width: 375, height: 812 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
});

test("Pessoas sai da navegação quando a política da unidade nega o perfil", async ({ page }) => {
  await mockPeopleApi(page, { canView: false, role: "manager" });
  await page.goto("/#/people");
  await page.getByRole("button", { name: "Abrir operação" }).click();
  await expect(page).toHaveURL(/#\/dashboard$/);
  await expect(page.locator('a[href="#/people"]')).toHaveCount(0);
});
