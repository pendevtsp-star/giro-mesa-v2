import { describe, expect, it } from "vitest";
import {
  brlToCents,
  hasCapability,
  InvalidPlatformPayloadError,
  maskDocument,
  maskEmail,
  maskPhone,
  parseCommercialLeads,
  parseCommercialOverview,
  parsePilotAccessGrant,
  parsePlatformIncidents,
  parsePlatformOverview,
  parsePlatformTenant,
  parsePlatformTenants,
  parseTenantPii,
} from "./platform";

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
    expect(overview.access).toEqual({ role: "viewer", capabilities: [], mfaEnforced: false });
  });

  it("rejeita payload sem contadores", () => {
    expect(() => parsePlatformOverview({ recentTrialApplications: [] })).toThrow(
      InvalidPlatformPayloadError,
    );
  });

  it("lê acesso e fontes parciais sem liberar capacidade ausente", () => {
    const overview = parsePlatformOverview({
      counts: { organizations: 0, units: 0, activeTrials: 0 },
      health: { pendingJobs: 0, failedJobs: 0, staleHubs: 0, failedIntegrations: 0 },
      trialFunnel: { applications: 0, activations: 0, conversionPercent: 0 },
      access: {
        role: "support",
        capabilities: ["tenants:read", "incidents:write"],
        mfaEnforced: true,
      },
      sources: [
        { key: "overview", status: "ok" },
        { key: "metrics", status: "unavailable" },
      ],
    });

    expect(overview.partialSources).toEqual(["metrics"]);
    expect(hasCapability(overview.access, "incidents:write")).toBe(true);
    expect(hasCapability(overview.access, "pii:read")).toBe(false);
  });

  it("valida o diretório paginado sem criar métricas de tenant", () => {
    const directory = parsePlatformTenants({
      items: [
        {
          id: "org-1",
          name: "Bar da Ana",
          legalName: "Bar da Ana Ltda",
          document: "**********0132",
          billingState: "active",
          billingStateChangedAt: "2026-08-09T20:00:00.000Z",
          unitCount: 2,
          createdAt: "2026-08-01T20:00:00.000Z",
          updatedAt: "2026-08-09T20:00:00.000Z",
        },
      ],
      nextCursor: "2",
    });

    expect(directory.items[0]).toMatchObject({
      name: "Bar da Ana",
      legalName: "Bar da Ana Ltda",
      billingState: "active",
      unitCount: 2,
    });
    expect(directory.nextCursor).toBe("2");
  });

  it("normaliza a visão 360 a partir das fontes reais do tenant", () => {
    const detail = parsePlatformTenant({
      organization: {
        id: "org-1",
        tradeName: "Bar da Ana",
        legalName: "Bar da Ana Ltda",
        document: "**********0132",
        billingState: "restricted",
        billingStateChangedAt: "2026-08-09T20:00:00.000Z",
        createdAt: "2026-08-01T20:00:00.000Z",
      },
      units: [{ id: "unit-1", name: "Centro", active: true }],
      onboarding: {
        activatedAt: null,
        missingItems: ["cardapio"],
        updatedAt: "2026-08-09T20:00:00.000Z",
      },
      trial: {
        trial: {
          startsAt: "2026-08-09T20:00:00.000Z",
          endsAt: "2027-02-09T20:00:00.000Z",
        },
        plan: { slug: "pro" },
      },
      billing: {
        subscriptions: [
          {
            id: "sub-1",
            state: "restricted",
            provider: "asaas",
            plan: { slug: "pro" },
          },
        ],
        charges: [{ status: "PAID", dueAt: "2026-08-12T20:00:00.000Z" }],
      },
      hubs: [
        {
          hubId: "hub-1",
          unitName: "Centro",
          version: "2.1.0",
          lastSeenAt: "2026-08-09T20:00:00.000Z",
          stale: true,
        },
      ],
      fiscal: [],
      incidents: [
        {
          fingerprint: "hub:unit-1:hub-1:1",
          source: "hub",
          sourceId: "hub-1",
          organizationId: "org-1",
          organizationName: "Bar da Ana",
          severity: "high",
          title: "Hub sem sinal",
          detail: { version: "2.1.0" },
          occurredAt: "2026-08-09T20:00:00.000Z",
          state: "open",
          claimedByIdentityId: null,
          snoozedUntil: null,
          ageMinutes: 90,
        },
      ],
      timeline: [
        {
          id: "audit-1",
          action: "platform.incident.claim",
          metadata: { reason: "Investigação iniciada" },
          occurredAt: "2026-08-09T20:00:00.000Z",
          actor: "Suporte",
        },
      ],
    });

    expect(detail.billing).toMatchObject({ planSlug: "pro", provider: "asaas" });
    expect(detail.billing.nextChargeAt).toBeNull();
    expect(detail.billing.pilotEndsAt).toBe("2027-02-09T20:00:00.000Z");
    expect(detail.onboarding.pendingItems).toEqual(["cardapio"]);
    expect(detail.health.staleHubs).toBe(1);
    expect(detail.timeline[0]?.title).toBe("platform.incident.claim");
  });

  it("valida incidentes por fingerprint e preserva cursor", () => {
    const result = parsePlatformIncidents({
      items: [
        {
          fingerprint: "outbox:event-1:4",
          source: "outbox",
          sourceId: "event-1",
          organizationId: null,
          organizationName: null,
          severity: "critical",
          title: "Falha em job assíncrono",
          detail: { topic: "fiscal.issue", attempts: 10 },
          occurredAt: "2026-08-09T20:00:00.000Z",
          state: "open",
          claimedByIdentityId: null,
          snoozedUntil: null,
          ageMinutes: 125,
        },
      ],
      nextCursor: "3",
    });

    expect(result.items[0]).toMatchObject({
      id: "outbox:event-1:4",
      severity: "danger",
      severityLabel: "crítica",
      outboxEventId: "event-1",
    });
    expect(result.nextCursor).toBe("3");
  });

  it("mantém PII mascarada e lê somente a resposta auditada de revelação", () => {
    expect(maskEmail("ana@example.com")).toBe("a•••@example.com");
    expect(maskPhone("31999991234")).toBe("••••••1234");
    expect(maskDocument("05953016000132")).toBe("••.•••.•••/••32");
    expect(
      parseTenantPii({
        organization: { document: "05953016000132" },
        legalEntities: [],
        members: [{ email: "ana@example.com" }],
      }),
    ).toEqual({ document: "05953016000132", email: "ana@example.com", phone: null });
  });

  it("lê a data confirmada da concessão piloto sem assumir sucesso local", () => {
    expect(parsePilotAccessGrant({ endsAt: "2027-02-26T12:00:00.000Z", extended: true })).toEqual({
      endsAt: "2027-02-26T12:00:00.000Z",
      extended: true,
    });
    expect(() => parsePilotAccessGrant({ endsAt: "2027-02-26T12:00:00.000Z" })).toThrow(
      InvalidPlatformPayloadError,
    );
  });

  it("valida publicação comercial, funil real e valores em centavos", () => {
    const overview = parseCommercialOverview({
      publication: {
        published: {
          id: "version-1",
          status: "published",
          publishedAt: "2026-08-25T12:00:00.000Z",
        },
      },
      versions: [],
      media: [],
      campaigns: [],
      metrics: {
        funnel: {
          status: "ok",
          reason: null,
          stages: { new: 5, converted: 2 },
          convertedOrganizations: 2,
        },
      },
    });
    expect(overview.publication?.versionId).toBe("version-1");
    expect(overview.funnel.stages).toContainEqual({ stage: "converted", count: 2 });
    expect(brlToCents("1.299,90")).toBe(129_990);
  });

  it("lê estado persistido do lead sem inferir conversão por contato", () => {
    const leads = parseCommercialLeads({
      items: [
        {
          id: "lead-1",
          name: "A***",
          email: "a***@example.com",
          phone: "*******1234",
          type: "trial",
          createdAt: "2026-08-25T12:00:00.000Z",
          state: {
            stage: "converted",
            assignedToIdentityId: "identity-1",
            organizationId: "organization-1",
          },
        },
      ],
      nextCursor: null,
    });
    expect(leads.items[0]).toMatchObject({
      stage: "converted",
      assignedTo: "identity-1",
      organizationId: "organization-1",
    });
    expect(leads.funnel).toEqual([]);
  });
});
