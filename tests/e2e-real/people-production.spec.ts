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
  },
  {
    id: "person-2",
    identityId: null,
    name: "Bruno Lima",
    roleLabel: "Garçom",
    active: true,
    hourlyRateCents: 2200,
    updatedAt: "2026-08-17T12:00:00.000Z",
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

test("Pessoas sai da navegação quando a política da unidade nega o perfil", async ({ page }) => {
  await mockPeopleApi(page, { canView: false, role: "manager" });
  await page.goto("/#/people");
  await page.getByRole("button", { name: "Abrir operação" }).click();
  await expect(page).toHaveURL(/#\/dashboard$/);
  await expect(page.locator('a[href="#/people"]')).toHaveCount(0);
});
