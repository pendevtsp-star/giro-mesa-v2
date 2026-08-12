import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  assertDoseClubUnit,
  DoseClubIntegrationPanel,
  InvalidDoseClubPayloadError,
  parseDoseClubOverview,
  parseDoseClubRun,
} from "./doseclub-integration";

const now = "2026-08-11T12:00:00.000Z";
const unitId = "b1111111-1111-4111-8111-111111111111";

function run(overrides: Record<string, unknown> = {}) {
  return {
    id: "c1111111-1111-4111-8111-111111111111",
    unitId,
    runDate: "2026-08-11",
    trigger: "manual",
    status: "completed",
    findingCount: 1,
    failureCode: null,
    version: 1,
    startedAt: now,
    completedAt: now,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function overview() {
  const lastRun = run();
  return {
    integration: { provider: "doseclub", status: "active", unitId, updatedAt: now },
    reconciliation: {
      status: "attention",
      remoteHeartbeat: "partial",
      lastRun,
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
    runs: [lastRun],
  };
}

describe("integração DoseClub operacional", () => {
  it("aceita somente o contrato tenant-scoped completo", () => {
    const parsed = parseDoseClubOverview(overview());
    expect(parsed.integration).toMatchObject({ provider: "doseclub", unitId });
    expect(parsed.mappings[0]?.inventoryItemName).toBe("Whisky em mililitros");
    expect(parsed.findings[0]).toMatchObject({ status: "open", version: 1 });
    expect(parsed.reconciliation.remoteHeartbeat).toBe("partial");
  });

  it("rejeita enum, versão e campos desconhecidos em vez de completar a resposta", () => {
    expect(() => parseDoseClubRun(run({ status: "success" }))).toThrow(InvalidDoseClubPayloadError);
    expect(() => parseDoseClubRun(run({ version: 0 }))).toThrow(InvalidDoseClubPayloadError);
    expect(() => parseDoseClubOverview({ ...overview(), syntheticSuccess: true })).toThrow(
      InvalidDoseClubPayloadError,
    );
    const crossUnit = parseDoseClubOverview({
      ...overview(),
      mappings: [{ ...overview().mappings[0], unitId: "unidade-estranha" }],
    });
    expect(() => assertDoseClubUnit(crossUnit, unitId)).toThrow(InvalidDoseClubPayloadError);
  });

  it("renderiza carregamento acessível sem fabricar confirmação", () => {
    const html = renderToStaticMarkup(
      <DoseClubIntegrationPanel
        scope={{
          organizationId: "a1111111-1111-4111-8111-111111111111",
          unitId,
          refreshToken: 0,
        }}
      />,
    );
    expect(html).toContain('role="status"');
    expect(html).toContain("Consultando integração");
    expect(html).not.toContain("Sem divergências abertas");
  });
});
