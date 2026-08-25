import { describe, expect, it } from "vitest";
import {
  defaultSettlementPeriod,
  parseSettlement,
  parseSettlementConfiguration,
  parseWaiterSettlementsOverview,
  type SettlementConfiguration,
} from "./waiter-settlements";

const configuration: SettlementConfiguration = {
  serviceChargeEnabled: false,
  defaultServiceChargeBasisPoints: 0,
  serviceChargeApplication: "manual",
  attributionMode: "final_responsible",
  transferMode: "move_to_final",
  serviceBase: "net_after_discounts",
  eligibleTabs: "fully_paid",
  serviceDistribution: "individual_sales",
  serviceTeamShareBasisPoints: 10_000,
  partnershipBase: "net_excluding_service",
  tierApplication: "all_revenue",
  discountTreatment: "deduct",
  cancellationTreatment: "exclude",
  refundTreatment: "deduct",
  periodMode: "calendar_month",
  customPeriodStartDay: 1,
  aggregateAcrossUnits: false,
};

describe("waiter settlements payload", () => {
  it("mantém a taxa desabilitada ao ler uma configuração legada", () => {
    const {
      serviceChargeEnabled: _enabled,
      defaultServiceChargeBasisPoints: _basisPoints,
      serviceChargeApplication: _application,
      ...legacy
    } = configuration;

    expect(parseSettlementConfiguration(legacy)).toMatchObject({
      serviceChargeEnabled: false,
      defaultServiceChargeBasisPoints: 0,
      serviceChargeApplication: "manual",
    });
  });

  it("mantém perdas apenas informativas no total apurado", () => {
    const settlement = parseSettlement(
      {
        periodFrom: "2026-08-01",
        periodTo: "2026-08-31",
        unassignedGrossCents: 0,
        operationalLossCents: 8_000,
        warnings: [],
        lines: [
          {
            personId: "person-1",
            personIdentityId: "identity-1",
            personName: "Ana",
            roleLabel: "Garçom",
            eligibleForPayment: true,
            tabCount: 4,
            orderCount: 10,
            grossSalesCents: 100_000,
            discountCents: 0,
            canceledCents: 0,
            receivedCents: 92_000,
            serviceChargeCents: 9_200,
            serviceShareCents: 9_200,
            tipCents: 500,
            partnershipBaseCents: 82_800,
            partnershipCents: 2_000,
            operationalLossCents: 8_000,
            payableCents: 11_200,
          },
        ],
      },
      true,
    );

    expect(settlement.lines[0]?.payableCents).toBe(11_200);
    expect(settlement.lines[0]?.operationalLossCents).toBe(8_000);
  });

  it("rejeita opções desconhecidas no limite da API", () => {
    expect(() =>
      parseWaiterSettlementsOverview({
        configuration: { ...configuration, attributionMode: "qualquer" },
        partnershipPlan: null,
        operationalLosses: [],
        settlements: [],
        capabilities: {
          canRead: true,
          canConfigure: true,
          canRecordLoss: true,
          canReviewLoss: true,
          canGenerate: true,
          canApprove: true,
          canPay: true,
          canCancel: true,
          canExport: true,
        },
      }),
    ).toThrow();
  });

  it("expõe turnos operacionais para filtrar a apuração", () => {
    const overview = parseWaiterSettlementsOverview({
      configuration,
      partnershipPlan: null,
      operationalShifts: [
        {
          id: "shift-1",
          label: "Jantar",
          status: "closed",
          startsAt: "2026-08-19T18:00:00.000Z",
          closedAt: "2026-08-20T02:00:00.000Z",
        },
      ],
      operationalLosses: [],
      settlements: [],
      capabilities: {
        canRead: true,
        canConfigure: true,
        canRecordLoss: true,
        canReviewLoss: true,
        canGenerate: true,
        canApprove: true,
        canPay: true,
        canCancel: true,
        canExport: true,
      },
    });

    expect(overview.operationalShifts[0]?.label).toBe("Jantar");
  });

  it("inicia o ciclo personalizado no mês anterior quando necessário", () => {
    expect(
      defaultSettlementPeriod(
        { ...configuration, periodMode: "custom", customPeriodStartDay: 20 },
        new Date(2026, 7, 5),
      ),
    ).toEqual({ from: "2026-07-20", to: "2026-08-05" });
  });
});
