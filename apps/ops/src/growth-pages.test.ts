import { describe, expect, it } from "vitest";
import {
  InvalidGrowthPayloadError,
  parseCampaigns,
  parseDeliveryZones,
  parseMultiunitSummary,
} from "./growth-pages";

describe("contratos de crescimento reais", () => {
  it("mantém zonas e status de campanha exatamente como persistidos", () => {
    expect(
      parseDeliveryZones([
        { id: "zone-1", name: "Centro", feeCents: 700, minimumOrderCents: 3_000, active: true },
      ])[0],
    ).toMatchObject({ name: "Centro", feeCents: 700, active: true });
    expect(
      parseCampaigns([
        {
          id: "campaign-1",
          name: "Volte sempre",
          channel: "whatsapp",
          status: "blocked",
          subject: null,
          queuedAt: null,
          sentAt: null,
        },
      ])[0]?.status,
    ).toBe("blocked");
  });

  it("valida o consolidado multiunidade e preserva o aviso do backend", () => {
    const summary = parseMultiunitSummary({
      organizationId: "org-1",
      generatedAt: "2026-08-09T20:00:00.000Z",
      units: [
        {
          id: "unit-1",
          name: "Centro",
          completedDeliveryGrossCents: 10_000,
          activeReservations: 2,
          activeWaitlist: 1,
        },
      ],
      transfersByStatus: { requested: 2 },
      disclaimer: "Baseado em registros persistidos.",
    });
    expect(summary.units[0]?.completedDeliveryGrossCents).toBe(10_000);
    expect(summary.disclaimer).toContain("persistidos");
  });

  it("rejeita payload incompleto em vez de preencher com fixture", () => {
    expect(() => parseDeliveryZones([{ id: "zone-1" }])).toThrow(InvalidGrowthPayloadError);
  });
});
