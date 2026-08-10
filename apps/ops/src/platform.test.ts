import { describe, expect, it } from "vitest";
import { InvalidPlatformPayloadError, parsePlatformOverview } from "./platform";

describe("painel real da plataforma", () => {
  it("valida contadores e filas comerciais persistidas", () => {
    const overview = parsePlatformOverview({
      counts: { organizations: 3, units: 5, activeTrials: 2 },
      recentTrialApplications: [
        {
          id: "trial-1",
          name: "Ana",
          email: "ana@example.com",
          phone: "31999999999",
          businessName: "Bar da Ana",
          planSlug: "pro",
          createdAt: "2026-08-09T20:00:00.000Z",
        },
      ],
      recentContacts: [],
      recentOrganizations: [],
    });
    expect(overview.counts).toEqual({ organizations: 3, units: 5, activeTrials: 2 });
    expect(overview.recentTrialApplications[0]?.businessName).toBe("Bar da Ana");
  });

  it("rejeita payload sem contadores", () => {
    expect(() => parsePlatformOverview({ recentTrialApplications: [] })).toThrow(
      InvalidPlatformPayloadError,
    );
  });
});
