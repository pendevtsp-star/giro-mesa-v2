import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { Profile } from "./domain";
import {
  activationAllowed,
  activationStorageKey,
  CHECKLIST_GROUPS,
  createAttestationUpdate,
  createProductionUpdate,
  createQrWaiverUpdate,
  errorGuidance,
  getOrCreateActivationKey,
  isTerminalProvisioningState,
  OnboardingJourney,
  OnboardingPage,
  type OnboardingResponse,
  pollingDelay,
  releaseActivationKey,
  shouldPollProvisioning,
} from "./onboarding";
import { parseRoute } from "./router";
import { canAccess } from "./rules";

const organizationId = "a1111111-1111-4111-8111-111111111111";
const unitId = "b1111111-1111-4111-8111-111111111111";
const stationId = "c1111111-1111-4111-8111-111111111111";

const owner: Profile = {
  id: "owner",
  name: "Marina",
  shortName: "MC",
  role: "Proprietaria",
  description: "Gestao",
  pin: "1024",
  permissions: ["dashboard.view", "onboarding.manage", "alerts.view"],
};

const manager: Profile = {
  ...owner,
  id: "manager",
  name: "Rafael",
  shortName: "RN",
  role: "Gerente",
};

const waiter: Profile = {
  ...owner,
  id: "waiter",
  name: "Lia",
  shortName: "LM",
  role: "Garcom",
  permissions: ["dashboard.view", "alerts.view"],
};

const statuses = {
  business: "verified",
  unit: "verified",
  plan: "verified",
  fiscalChoice: "verified",
  catalog: "in_progress",
  tables: "pending",
  team: "blocked",
  qr: "not_applicable",
  production: "verified",
  cashier: "pending",
  training: "pending",
  rehearsal: "pending",
} as const;

function snapshot(overrides: Partial<OnboardingResponse> = {}): OnboardingResponse {
  return {
    organizationId,
    activatedAt: null,
    items: Object.fromEntries(
      Object.entries(statuses).map(([item, status]) => [
        item,
        {
          status,
          source: status === "not_applicable" ? "authorized_waiver" : "actor_attestation",
          evidenceReference: status === "pending" ? null : `test:${item}`,
          evidence: {},
          actorIdentityId: status === "pending" ? null : organizationId,
          verifiedAt: status === "pending" ? null : "2026-08-11T10:00:00.000Z",
          waiverReason:
            status === "not_applicable" ? "Operacao piloto sem QR nesta unidade." : null,
        },
      ]),
    ) as OnboardingResponse["items"],
    ready: false,
    missingItems: ["catalog", "tables", "team", "cashier", "training", "rehearsal"],
    selection: {
      selectedUnitId: unitId,
      plan: {
        id: "d1111111-1111-4111-8111-111111111111",
        slug: "operacao",
        catalogVersion: 4,
        monthlyPriceCents: 19900,
        annualPriceCents: 199000,
        includedUnits: 1,
        entitlements: ["operations"],
      },
      revision: 1,
      selectedAt: "2026-08-11T10:00:00.000Z",
      updatedAt: "2026-08-11T10:00:00.000Z",
    },
    provisioning: null,
    ...overrides,
  };
}

describe("onboarding operacional", () => {
  it("integra a rota e restringe acesso a owner e manager", () => {
    expect(parseRoute("#/onboarding")).toBe("onboarding");
    expect(canAccess(owner, "onboarding")).toBe(true);
    expect(canAccess(manager, "onboarding")).toBe(true);
    expect(canAccess(waiter, "onboarding")).toBe(false);

    const html = renderToStaticMarkup(
      <OnboardingPage
        organizationId={organizationId}
        profileId="waiter"
        unitId={unitId}
        units={[{ id: unitId, name: "Aurora Centro", timezone: "America/Sao_Paulo" }]}
      />,
    );
    expect(html).toContain("Acesso restrito");
    expect(html).not.toContain("Ativar trial");
  });

  it("mantem os 12 itens visiveis em quatro blocos escaneaveis", () => {
    expect(CHECKLIST_GROUPS).toHaveLength(4);
    expect(CHECKLIST_GROUPS.flatMap((group) => group.items)).toHaveLength(12);
    const html = renderToStaticMarkup(
      <OnboardingJourney
        busy={false}
        online
        profileId="owner"
        snapshot={snapshot()}
        unitId={unitId}
        units={[{ id: unitId, name: "Aurora Centro", timezone: "America/Sao_Paulo" }]}
        onActivate={() => undefined}
        onPatch={() => undefined}
        onRefresh={() => undefined}
        onSelect={() => undefined}
      />,
    );
    for (const title of ["Empresa", "Operação", "Atendimento", "Prontidão"]) {
      expect(html).toContain(title);
    }
    for (const label of [
      "Negócio",
      "Unidade",
      "Plano",
      "Escolha fiscal",
      "Catálogo",
      "Mesas",
      "Equipe",
      "QR da mesa",
      "Rota de produção",
      "Caixa",
      "Treinamento",
      "Ensaio operacional",
    ]) {
      expect(html).toContain(label);
    }
    expect(html).toContain("6 de 12 requisitos prontos");
    expect(html).toContain("disabled");
  });

  it("gera apenas evidencias aceitas para fiscal, treinamento e ensaio", () => {
    expect(createAttestationUpdate("fiscalChoice", "external")).toEqual({
      items: {
        fiscalChoice: {
          status: "verified",
          evidenceReference: "ops:fiscal:external",
          evidence: { choice: "external" },
        },
      },
    });
    expect(createAttestationUpdate("training", true)).toEqual({
      items: {
        training: {
          status: "verified",
          evidenceReference: "ops:training:completed",
          evidence: { completed: true },
        },
      },
    });
    expect(createAttestationUpdate("rehearsal", true).items?.rehearsal?.status).toBe("verified");
  });

  it("nunca fabrica evidencia de KDS ou impressora", () => {
    expect(createProductionUpdate({ mode: "off" })).toEqual({
      items: {
        production: {
          status: "verified",
          evidenceReference: "ops:production:off",
          evidence: { mode: "off" },
        },
      },
    });
    expect(() => createProductionUpdate({ mode: "kds", kdsStationIds: [] })).toThrow(
      /estação real/i,
    );
    expect(
      createProductionUpdate({ mode: "kds", kdsStationIds: [stationId] }).items?.production,
    ).toMatchObject({ status: "in_progress", evidence: { mode: "kds" } });
    expect(() => createProductionUpdate({ mode: "print", printerProfileIds: [] })).toThrow(
      /perfil real/i,
    );
    expect(
      createProductionUpdate({
        mode: "both",
        kdsStationIds: [stationId],
        printerProfileIds: ["e1111111-1111-4111-8111-111111111111"],
      }).items?.production,
    ).toMatchObject({ status: "in_progress", evidence: { mode: "both" } });
  });

  it("exige justificativa auditavel para a dispensa de QR", () => {
    expect(() => createQrWaiverUpdate("not_required", "curta")).toThrow(/10 caracteres/i);
    expect(createQrWaiverUpdate("pilot_without_qr", "Piloto sem QR fisico nesta unidade.")).toEqual(
      {
        items: {
          qr: {
            status: "not_applicable",
            evidence: { reason: "pilot_without_qr" },
            waiverReason: "Piloto sem QR fisico nesta unidade.",
          },
        },
      },
    );
  });

  it("bloqueia ativacao incompleta e exige owner", () => {
    expect(activationAllowed(snapshot(), "owner", true, false)).toBe(false);
    const ready = snapshot({ ready: true, missingItems: [] });
    expect(activationAllowed(ready, "manager", true, false)).toBe(false);
    expect(activationAllowed(ready, "owner", false, false)).toBe(false);
    expect(activationAllowed(ready, "owner", true, true)).toBe(false);
    expect(activationAllowed(ready, "owner", true, false)).toBe(true);
  });

  it("preserva uma chave opaca por organizacao ate estado terminal", () => {
    const values = new Map<string, string>();
    const storage = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
      removeItem: (key: string) => values.delete(key),
    };
    const first = getOrCreateActivationKey(organizationId, storage, () => "first-key-123456");
    const second = getOrCreateActivationKey(organizationId, storage, () => "second-key-123456");
    expect(first).toBe("first-key-123456");
    expect(second).toBe(first);
    releaseActivationKey(organizationId, "retryable_failed", storage);
    expect(values.get(activationStorageKey(organizationId))).toBe(first);
    releaseActivationKey(organizationId, "completed", storage);
    expect(values.has(activationStorageKey(organizationId))).toBe(false);
    storage.setItem(activationStorageKey(organizationId), first);
    releaseActivationKey(organizationId, "terminal_failed", storage);
    expect(values.has(activationStorageKey(organizationId))).toBe(false);
    storage.setItem(activationStorageKey(organizationId), first);
    releaseActivationKey(organizationId, "compensated", storage);
    expect(values.has(activationStorageKey(organizationId))).toBe(false);
  });

  it("limita polling, pausa offline ou fora de foco e reconhece terminais", () => {
    expect(pollingDelay(0)).toBe(1_000);
    expect(pollingDelay(20)).toBe(8_000);
    expect(shouldPollProvisioning({ online: true, visible: true, state: "publishing" })).toBe(true);
    expect(shouldPollProvisioning({ online: false, visible: true, state: "publishing" })).toBe(
      false,
    );
    expect(shouldPollProvisioning({ online: true, visible: false, state: "publishing" })).toBe(
      false,
    );
    expect(isTerminalProvisioningState("completed")).toBe(true);
    expect(isTerminalProvisioningState("terminal_failed")).toBe(true);
    expect(isTerminalProvisioningState("compensated")).toBe(true);
    expect(isTerminalProvisioningState("retryable_failed")).toBe(false);
  });

  it("oferece recuperacao segura e preserva somente validação allowlisted", () => {
    expect(
      errorGuidance({ status: 401, code: "UNAUTHORIZED", message: "Sessao encerrada" }),
    ).toMatchObject({ action: "Entrar novamente", sessionEnded: true });
    expect(errorGuidance({ status: 403, code: "FORBIDDEN", message: "Sem acesso" }).message).toBe(
      "Sem acesso",
    );
    expect(
      errorGuidance({ status: 409, code: "ONBOARDING_RESELECT_REQUIRED", message: "x" }),
    ).toMatchObject({ action: "Revisar seleção" });
    expect(errorGuidance({ status: 429, code: "RATE_LIMITED", message: "x" })).toMatchObject({
      action: "Tentar mais tarde",
    });
    expect(errorGuidance({ status: 500, code: "INTERNAL", message: "x" }).message).not.toContain(
      "details",
    );
    expect(
      errorGuidance({
        status: 400,
        code: "VALIDATION_ERROR",
        message: "Revise",
        details: {
          fieldErrors: { "items.qr.waiverReason": ["Justificativa inválida"] },
          formErrors: ["Revise a dispensa"],
        },
      }),
    ).toMatchObject({
      fieldErrors: { "items.qr.waiverReason": ["Justificativa inválida"] },
      formErrors: ["Revise a dispensa"],
    });
  });
});
