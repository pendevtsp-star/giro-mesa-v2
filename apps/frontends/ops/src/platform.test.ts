import { describe, expect, it } from "vitest";
import { InvalidPlatformPayloadError, parsePlatformOverview } from "./platform";

describe("painel real da plataforma", () => {
  it("valida contadores e filas comerciais persistidas", () => {
    const overview = parsePlatformOverview({
      counts: { organizations: 3, units: 5, activeTrials: 2 },
      health: { pendingJobs: 4, failedJobs: 1, staleHubs: 2, failedIntegrations: 1 },
      trialFunnel: { applications: 10, activations: 4, conversionPercent: 40 },
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
      fiscalIntegrations: [
        {
          organizationId: "org-1",
          organizationName: "Bar da Ana",
          unitId: "unit-1",
          unitName: "Centro",
          document: "05953016000132",
          provider: "focus",
          environment: "homologation",
          profileUpdatedAt: "2026-08-09T20:00:00.000Z",
          companyId: "42",
          status: "ready",
          certificateValidUntil: "2027-08-09",
          lastCheckedAt: "2026-08-09T20:00:00.000Z",
          hasHomologationCredential: true,
          hasProductionCredential: false,
          lastErrorCode: null,
          lastErrorMessage: null,
        },
      ],
      recentOrganizations: [
        {
          id: "org-1",
          name: "Bar da Ana",
          billingState: "active",
          createdAt: "2026-08-09T20:00:00.000Z",
          unitCount: 2,
          staleHubs: 1,
          failedIntegrations: 0,
          issues: 1,
          tone: "warning",
        },
      ],
    });
    expect(overview.counts).toEqual({ organizations: 3, units: 5, activeTrials: 2 });
    expect(overview.recentTrialApplications[0]?.businessName).toBe("Bar da Ana");
    expect(overview.health.failedJobs).toBe(1);
    expect(overview.recentOrganizations[0]?.tone).toBe("warning");
    expect(overview.fiscalIntegrations[0]?.hasHomologationCredential).toBe(true);
  });

  it("rejeita payload sem contadores", () => {
    expect(() => parsePlatformOverview({ recentTrialApplications: [] })).toThrow(
      InvalidPlatformPayloadError,
    );
  });
});
