import { describe, expect, it } from "vitest";
import { ApiClientError } from "./api";
import {
  InvalidPlatformPayloadError,
  LatestPlatformRequest,
  parsePlatformActionPage,
  parsePlatformOverview,
  parsePlatformProjection,
  parsePlatformTenantContext,
  platformRecovery,
} from "./platform";

const organizationId = "a1111111-1111-4111-8111-111111111111";

describe("backoffice seguro", () => {
  it("aborta a leitura anterior e aceita somente o epoch mais recente", () => {
    const requests = new LatestPlatformRequest();
    const first = requests.begin();
    const second = requests.begin();

    expect(first.signal.aborted).toBe(true);
    expect(requests.isCurrent(first.epoch)).toBe(false);
    expect(second.signal.aborted).toBe(false);
    expect(requests.isCurrent(second.epoch)).toBe(true);

    requests.invalidate();
    expect(second.signal.aborted).toBe(true);
    expect(requests.isCurrent(second.epoch)).toBe(false);
  });

  it("valida a visão agregada sem aceitar listas cross-tenant", () => {
    expect(
      parsePlatformOverview({
        counts: { organizations: 3, active: 2, attention: 1 },
        access: {
          permissions: ["platform.read", "platform.action.propose"],
          stepUp: false,
          stepUpExpiresAt: null,
        },
      }),
    ).toEqual({
      counts: { organizations: 3, active: 2, attention: 1 },
      access: {
        permissions: ["platform.read", "platform.action.propose"],
        stepUp: false,
        stepUpExpiresAt: null,
      },
    });
    expect(() =>
      parsePlatformOverview({
        counts: { organizations: 3, active: 2, attention: 1 },
        access: { permissions: ["platform.read"], stepUp: false, stepUpExpiresAt: null },
        organizations: [{ id: organizationId }],
      }),
    ).toThrow(InvalidPlatformPayloadError);
  });

  it("preserva tenant e unidade explícitos no contexto carregado", () => {
    expect(
      parsePlatformTenantContext({
        organization: {
          id: organizationId,
          name: "Aurora Centro",
          billingState: "active",
          updatedAt: "2026-08-11T12:00:00.000Z",
        },
        units: [
          {
            id: "b1111111-1111-4111-8111-111111111111",
            name: "Matriz",
            active: true,
            timezone: "America/Sao_Paulo",
          },
        ],
        selectedUnitId: null,
      }).organization.name,
    ).toBe("Aurora Centro");
  });

  it("mantém projection indisponível explícita e não fabrica itens", () => {
    expect(
      parsePlatformProjection({
        resource: "incidents",
        availability: "unavailable",
        reasonCode: "INCIDENT_PROJECTION_NOT_WIRED",
        items: [],
        nextCursor: null,
      }),
    ).toEqual({
      resource: "incidents",
      availability: "unavailable",
      reasonCode: "INCIDENT_PROJECTION_NOT_WIRED",
      items: [],
      nextCursor: null,
    });
  });

  it("aceita as filas globais mascaradas e as ações tenant-scoped de incidente", () => {
    expect(
      parsePlatformProjection({
        resource: "leads",
        availability: "available",
        items: [
          {
            id: "e1111111-1111-4111-8111-111111111111",
            displayName: "M***",
            email: "m***@example.test",
            phone: "**********5432",
            businessName: "Bar Horizonte",
            segment: "bar",
            planSlug: "operacao",
            submittedAt: "2026-08-11T12:00:00.000Z",
            actionAvailability: "unavailable",
            actionReasonCode: "LEAD_WORKFLOW_NOT_AVAILABLE",
          },
        ],
        nextCursor: null,
      }).resource,
    ).toBe("leads");

    expect(
      parsePlatformActionPage({
        items: [
          {
            id: "c1111111-1111-4111-8111-111111111111",
            organizationId,
            action: "incident.approve",
            targetType: "incident",
            targetId: "e1111111-1111-4111-8111-111111111111",
            requestedByIdentityId: "d1111111-1111-4111-8111-111111111111",
            justification: "Revisão independente com fundamento operacional documentado.",
            payload: {
              expectedState: "under_review",
              unitId: "b1111111-1111-4111-8111-111111111111",
            },
            status: "pending",
            version: 1,
            requestedAt: "2026-08-11T12:00:00.000Z",
            expiresAt: "2026-08-11T12:15:00.000Z",
          },
        ],
        nextCursor: null,
      }).items[0],
    ).toMatchObject({ action: "incident.approve", targetType: "incident" });
  });

  it("rejeita segredos e estados desconhecidos na fila dual-control", () => {
    expect(() =>
      parsePlatformActionPage({
        items: [
          {
            id: "c1111111-1111-4111-8111-111111111111",
            organizationId,
            action: "tenant.suspend",
            targetType: "organization",
            targetId: organizationId,
            requestedByIdentityId: "d1111111-1111-4111-8111-111111111111",
            justification: "Risco operacional confirmado e documentado.",
            payload: { expectedState: "active", token: "must-not-render" },
            status: "success",
            version: 1,
            requestedAt: "2026-08-11T12:00:00.000Z",
            expiresAt: "2026-08-11T12:15:00.000Z",
          },
        ],
        nextCursor: null,
      }),
    ).toThrow(InvalidPlatformPayloadError);
  });

  it.each([
    [401, "Autenticação reforçada necessária", "Concluir MFA e tentar novamente."],
    [403, "Ação não autorizada", "Solicite a permissão explícita para esta operação."],
    [409, "Estado alterado", "Atualize o contexto antes de repetir a decisão."],
    [429, "Limite temporário", "Aguarde e tente novamente."],
    [503, "Serviço indisponível", "Tente novamente; nenhum sucesso foi confirmado."],
  ])("oferece recuperação específica para HTTP %s", (status, title, instruction) => {
    expect(platformRecovery(new ApiClientError("Falha", status, "CODE", true))).toMatchObject({
      title,
      instruction,
    });
  });
});
