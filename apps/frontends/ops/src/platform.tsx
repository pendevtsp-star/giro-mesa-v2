import {
  Badge,
  Button,
  Card,
  commercialEntitlementLabels,
  EmptyState,
  Input,
  Modal,
  NativeSelect,
  Textarea,
} from "@giromesa/ui";
import { type FormEvent, useCallback, useEffect, useRef, useState } from "react";
import { api } from "./api";
import { PlatformTeam } from "./platform-team";
import "./platform.css";

type Row = Record<string, unknown>;
type Tone = "neutral" | "success" | "warning" | "danger" | "info";
type IncidentAction = "claim" | "snooze" | "resolve";

interface PlatformAccess {
  role: string;
  capabilities: string[];
  mfaEnforced: boolean;
}

interface PlatformOverview {
  generatedAt: string | null;
  partialSources: string[];
  access: PlatformAccess;
  counts: { organizations: number; units: number; activeTrials: number };
  health: {
    pendingJobs: number;
    failedJobs: number;
    staleHubs: number;
    failedIntegrations: number;
  };
  trialFunnel: { applications: number; activations: number; conversionPercent: number };
  recentTrialApplications: Array<{
    id: string;
    name: string;
    email: string;
    phone: string;
    businessName: string;
    planSlug: string;
    createdAt: string;
  }>;
  recentContacts: Array<{
    id: string;
    name: string;
    email: string;
    phone: string | null;
    message: string;
    createdAt: string;
  }>;
  recentOrganizations: Array<{
    id: string;
    name: string;
    billingState: string;
    createdAt: string;
    unitCount: number;
    staleHubs: number;
    failedIntegrations: number;
    issues: number;
    tone: "success" | "warning" | "danger";
  }>;
  fiscalIntegrations: FiscalIntegration[];
}

interface FiscalIntegration {
  organizationId: string;
  organizationName: string;
  unitId: string;
  unitName: string;
  document: string | null;
  provider: string | null;
  environment: "homologation" | "production" | null;
  profileUpdatedAt: string | null;
  companyId: string | null;
  status: string | null;
  certificateValidUntil: string | null;
  lastCheckedAt: string | null;
  hasHomologationCredential: boolean;
  hasProductionCredential: boolean;
  lastErrorCode: string | null;
  lastErrorMessage: string | null;
}

interface TenantSummary {
  id: string;
  name: string;
  legalName: string;
  document: string | null;
  billingState: string;
  billingStateChangedAt: string;
  unitCount: number;
  createdAt: string;
  updatedAt: string;
}

interface TenantList {
  items: TenantSummary[];
  nextCursor: string | null;
  partialSources: string[];
}

interface TenantPii {
  document: string | null;
  email: string | null;
  phone: string | null;
}

interface PilotTenantCreated {
  organization: { id: string; tradeName: string; billingState: string };
  unit: { id: string; name: string };
  owner: { identityId: string; email: string };
  replayed: boolean;
}

interface PilotTenantForm {
  legalName: string;
  tradeName: string;
  document: string;
  unitName: string;
  timezone: string;
  ownerEmail: string;
  reason: string;
}

const emptyPilotTenantForm: PilotTenantForm = {
  legalName: "",
  tradeName: "",
  document: "",
  unitName: "",
  timezone: "America/Sao_Paulo",
  ownerEmail: "",
  reason: "",
};

interface PilotAccessGrant {
  endsAt: string;
  extended: boolean;
  doseClubQueued: boolean;
}

interface TenantDetail {
  id: string;
  name: string;
  legalName: string;
  document: string | null;
  billingState: string;
  createdAt: string;
  unitCount: number;
  phone: string | null;
  health: {
    openIncidents: number;
    failedJobs: number;
    staleHubs: number;
    failedIntegrations: number;
  };
  billing: {
    planSlug: string | null;
    status: string;
    provider: string | null;
    nextChargeAt: string | null;
    delinquentSince: string | null;
    pilotStartsAt: string | null;
    pilotEndsAt: string | null;
  };
  onboarding: {
    status: string;
    assignedTo: string | null;
    pendingItems: string[];
    updatedAt: string | null;
  };
  units: Array<{ id: string; name: string; status: string }>;
  hubs: Array<{
    id: string;
    name: string;
    status: string;
    version: string | null;
    lastSeenAt: string | null;
  }>;
  integrations: Array<{
    id: string;
    unitName: string;
    provider: string;
    status: string;
    environment: string | null;
    lastCheckedAt: string | null;
    lastError: string | null;
  }>;
  doseClub: {
    available: boolean;
    providerEnabled: boolean;
    entitled: boolean;
    connections: Array<{
      id: string;
      unitId: string | null;
      unitName: string;
      status: string;
      managed: boolean;
      provisioningStatus: string | null;
      healthCheckedAt: string | null;
      updatedAt: string;
    }>;
  };
  timeline: Array<{
    id: string;
    title: string;
    detail: string | null;
    actorName: string | null;
    createdAt: string;
    tone: Tone;
  }>;
  partialSources: string[];
}

interface PlatformIncident {
  id: string;
  organizationId: string | null;
  organizationName: string;
  title: string;
  detail: string;
  category: string;
  severity: "info" | "warning" | "danger";
  severityLabel: string;
  status: "open" | "claimed" | "snoozed" | "resolved";
  assignedTo: string | null;
  createdAt: string;
  snoozedUntil: string | null;
  outboxEventId: string | null;
  ageMinutes: number;
}

interface IncidentList {
  items: PlatformIncident[];
  nextCursor: string | null;
  partialSources: string[];
}

type CommercialTab = "catalog" | "promotions" | "landing" | "leads";
interface CommercialPlan {
  id: string;
  slug: string;
  name: string;
  description: string;
  monthlyPriceCents: number;
  annualPriceCents: number;
  includedUnits: number;
  entitlements: string[];
  features: string[];
  featured: boolean;
  displayOrder: number;
  ctaLabel: string;
  ctaHref: string;
}
interface CommercialPromotion {
  id: string;
  name: string;
  type: "percentage" | "fixed" | "price";
  value: number;
  startsAt: string;
  endsAt: string | null;
  planSlugs: string[];
  cycles: Array<"monthly" | "annual">;
  newCustomersOnly: boolean;
  code: string | null;
  redemptionLimit: number | null;
  active: boolean;
}
interface CommercialBlock {
  key: "hero" | "finalCta";
  type: "hero" | "cta";
  title: string;
  body: string;
  mediaId: string | null;
}
interface CommercialDraft {
  id: string;
  status: string;
  version: number;
  updatedAt: string;
  plans: CommercialPlan[];
  promotions: CommercialPromotion[];
  experiments: Row[];
  landing: Row;
  seo: { title: string; description: string; canonicalPath: string; ogMediaId: string | null };
}
interface CommercialOverview {
  publication: { versionId: string; publishedAt: string; status: string } | null;
  scheduled: { versionId: string; publishAt: string; version: number } | null;
  rollbackVersions: Array<{ versionId: string; publishedAt: string; version: number }>;
  drafts: CommercialDraft[];
  media: Array<{ id: string; url: string; alt: string; mimeType: string; sizeBytes: number }>;
  campaigns: Array<{
    id: string;
    slug: string;
    name: string;
    status: string;
    startsAt: string | null;
    endsAt: string | null;
  }>;
  partialSources: string[];
  funnel: {
    status: "ok" | "partial";
    reason: string | null;
    stages: Array<{ stage: string; count: number }>;
    convertedOrganizations: number;
  };
}
interface CommercialLeadList {
  items: Array<{
    id: string;
    name: string;
    email: string | null;
    phone: string | null;
    type: string;
    stage: string;
    assignedTo: string | null;
    organizationId: string | null;
    createdAt: string;
  }>;
  funnel: Array<{ stage: string; count: number }>;
  nextCursor: string | null;
  partialSources: string[];
}

interface PlatformApi {
  overview: () => Promise<unknown>;
  tenants: (params: {
    search?: string;
    status?: string;
    cursor?: string;
    limit: number;
  }) => Promise<unknown>;
  tenant: (organizationId: string) => Promise<unknown>;
  createTenant: (body: PilotTenantForm, idempotencyKey?: string) => Promise<unknown>;
  grantPilotAccess: (organizationId: string, body: { reason: string }) => Promise<unknown>;
  incidents: (params: {
    search?: string;
    status?: string;
    cursor?: string;
    limit: number;
  }) => Promise<unknown>;
  updateIncident: (
    incidentId: string,
    body: { action: IncidentAction; reason: string; snoozedUntil?: string },
  ) => Promise<unknown>;
  retryOutbox: (eventId: string, body: { reason: string }) => Promise<unknown>;
  revealTenantPii: (organizationId: string, reason: string) => Promise<unknown>;
  commercialOverview: () => Promise<unknown>;
  createCommercialDraft: (body: { reason: string; sourceVersionId?: string }) => Promise<unknown>;
  updateCommercialDraft: (draftId: string, body: Record<string, unknown>) => Promise<unknown>;
  commercialDraftPreview: (draftId: string) => Promise<unknown>;
  approveCommercialDraft: (draftId: string, reason: string) => Promise<unknown>;
  publishCommercialDraft: (
    draftId: string,
    body: { reason: string; publishAt?: string },
  ) => Promise<unknown>;
  rollbackCommercialPublication: (versionId: string, reason: string) => Promise<unknown>;
  uploadCommercialMedia: (body: {
    fileName: string;
    mimeType: "image/jpeg" | "image/png" | "image/webp";
    base64: string;
    alt: string;
    reason: string;
  }) => Promise<unknown>;
  deleteCommercialMedia: (mediaId: string, reason: string) => Promise<unknown>;
  commercialLeads: (filters: {
    search?: string;
    type?: string;
    stage?: string;
    assignedToIdentityId?: string;
    campaignSlug?: string;
    cursor?: string;
    limit?: number;
  }) => Promise<unknown>;
  updateCommercialLead: (
    sourceType: "trial" | "contact",
    sourceId: string,
    body: {
      reason: string;
      stage: "new" | "qualified" | "contacted" | "converted" | "lost";
      assignedToIdentityId?: string | null;
      organizationId?: string | null;
      notes?: string | null;
      lastContactAt?: string | null;
    },
  ) => Promise<unknown>;
  createCommercialCampaign: (body: Record<string, unknown>) => Promise<unknown>;
  updateCommercialCampaign: (campaignId: string, body: Record<string, unknown>) => Promise<unknown>;
}

const platformApi = api.platform as unknown as PlatformApi;

export class InvalidPlatformPayloadError extends Error {
  constructor() {
    super("Os dados da central vieram em formato inesperado.");
    this.name = "InvalidPlatformPayloadError";
  }
}

function record(value: unknown): Row {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    throw new InvalidPlatformPayloadError();
  return value as Row;
}

function optionalRecord(value: unknown): Row | null {
  return value === null || value === undefined ? null : record(value);
}

function records(value: unknown): Row[] {
  if (!Array.isArray(value)) throw new InvalidPlatformPayloadError();
  return value.map(record);
}

function optionalRecords(value: unknown): Row[] {
  return value === null || value === undefined ? [] : records(value);
}

function text(value: unknown): string {
  if (typeof value !== "string" || value.trim() === "") throw new InvalidPlatformPayloadError();
  return value;
}

function optionalText(value: unknown): string | null {
  return value === null || value === undefined || value === "" ? null : text(value);
}

function stringList(value: unknown): string[] {
  if (value === null || value === undefined) return [];
  if (!Array.isArray(value)) throw new InvalidPlatformPayloadError();
  return value.map(text);
}

function number(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) throw new InvalidPlatformPayloadError();
  return value;
}

function optionalNumber(value: unknown, fallback = 0): number {
  return value === null || value === undefined ? fallback : number(value);
}

function bool(value: unknown): boolean {
  if (typeof value !== "boolean") throw new InvalidPlatformPayloadError();
  return value;
}

function healthTone(value: unknown): "success" | "warning" | "danger" {
  if (value !== "success" && value !== "warning" && value !== "danger")
    throw new InvalidPlatformPayloadError();
  return value;
}

function accessCapabilities(value: unknown): string[] {
  if (value === null || value === undefined) return [];
  if (Array.isArray(value)) return value.map(text);
  return Object.entries(record(value))
    .filter(([, enabled]) => enabled === true)
    .map(([capability]) => capability);
}

export function parsePlatformOverview(value: unknown): PlatformOverview {
  const payload = record(value);
  const counts = record(payload.counts);
  const health = record(payload.health);
  const trialFunnel = record(payload.trialFunnel);
  const access = optionalRecord(payload.access);
  return {
    generatedAt: optionalText(payload.generatedAt),
    partialSources: optionalRecords(payload.sources)
      .filter((source) => source.status === "unavailable")
      .map((source) => text(source.key)),
    access: access
      ? {
          role: text(access.role),
          capabilities: accessCapabilities(access.capabilities),
          mfaEnforced: bool(access.mfaEnforced),
        }
      : { role: "viewer", capabilities: [], mfaEnforced: false },
    counts: {
      organizations: number(counts.organizations),
      units: number(counts.units),
      activeTrials: number(counts.activeTrials),
    },
    health: {
      pendingJobs: number(health.pendingJobs),
      failedJobs: number(health.failedJobs),
      staleHubs: number(health.staleHubs),
      failedIntegrations: number(health.failedIntegrations),
    },
    trialFunnel: {
      applications: number(trialFunnel.applications),
      activations: number(trialFunnel.activations),
      conversionPercent: number(trialFunnel.conversionPercent),
    },
    recentTrialApplications: optionalRecords(payload.recentTrialApplications).map((row) => ({
      id: text(row.id),
      name: text(row.name),
      email: text(row.email),
      phone: text(row.phone),
      businessName: text(row.businessName),
      planSlug: text(row.planSlug),
      createdAt: text(row.createdAt),
    })),
    recentContacts: optionalRecords(payload.recentContacts).map((row) => ({
      id: text(row.id),
      name: text(row.name),
      email: text(row.email),
      phone: optionalText(row.phone),
      message: text(row.message),
      createdAt: text(row.createdAt),
    })),
    recentOrganizations: optionalRecords(payload.recentOrganizations).map((row) => ({
      id: text(row.id),
      name: text(row.name),
      billingState: text(row.billingState),
      createdAt: text(row.createdAt),
      unitCount: number(row.unitCount),
      staleHubs: number(row.staleHubs),
      failedIntegrations: number(row.failedIntegrations),
      issues: number(row.issues),
      tone: healthTone(row.tone),
    })),
    fiscalIntegrations: optionalRecords(payload.fiscalIntegrations).map(parseFiscalIntegration),
  };
}

function parseFiscalIntegration(row: Row): FiscalIntegration {
  const environment = optionalText(row.environment);
  if (environment !== null && environment !== "homologation" && environment !== "production")
    throw new InvalidPlatformPayloadError();
  return {
    organizationId: text(row.organizationId),
    organizationName: text(row.organizationName),
    unitId: text(row.unitId),
    unitName: text(row.unitName),
    document: optionalText(row.document),
    provider: optionalText(row.provider),
    environment,
    profileUpdatedAt: optionalText(row.profileUpdatedAt),
    companyId: optionalText(row.companyId),
    status: optionalText(row.status),
    certificateValidUntil: optionalText(row.certificateValidUntil),
    lastCheckedAt: optionalText(row.lastCheckedAt),
    hasHomologationCredential: bool(row.hasHomologationCredential),
    hasProductionCredential: bool(row.hasProductionCredential),
    lastErrorCode: optionalText(row.lastErrorCode),
    lastErrorMessage: optionalText(row.lastErrorMessage),
  };
}

function parseTenantSummary(row: Row): TenantSummary {
  return {
    id: text(row.id),
    name: text(row.name),
    legalName: text(row.legalName),
    document: optionalText(row.document),
    billingState: text(row.billingState),
    billingStateChangedAt: text(row.billingStateChangedAt),
    unitCount: optionalNumber(row.unitCount),
    createdAt: text(row.createdAt),
    updatedAt: text(row.updatedAt),
  };
}

export function parsePlatformTenants(value: unknown): TenantList {
  const payload = record(value);
  return {
    items: records(payload.items).map(parseTenantSummary),
    nextCursor: optionalText(payload.nextCursor),
    partialSources: stringList(payload.partialSources),
  };
}

export function parsePlatformTenant(value: unknown): TenantDetail {
  const payload = record(value);
  const organization = record(payload.organization);
  const billing = optionalRecord(payload.billing);
  const subscriptions = optionalRecords(billing?.subscriptions);
  const subscription = subscriptions[0];
  const plan = optionalRecord(subscription?.plan);
  const trialBundle = optionalRecord(payload.trial);
  const trial = optionalRecord(trialBundle?.trial);
  const trialPlan = optionalRecord(trialBundle?.plan);
  const charges = optionalRecords(billing?.charges);
  const pendingCharge = charges.find(
    (charge) => !["paid", "received", "confirmed"].includes(String(charge.status).toLowerCase()),
  );
  const onboarding = optionalRecord(payload.onboarding);
  const incidents = parseIncidentRows(optionalRecords(payload.incidents));
  const units = optionalRecords(payload.units);
  const doseClub = optionalRecord(payload.doseClub);
  return {
    id: text(organization.id),
    name: text(organization.tradeName),
    legalName: text(organization.legalName),
    document: optionalText(organization.document),
    billingState: text(organization.billingState),
    createdAt: text(organization.createdAt),
    unitCount: units.length,
    phone: null,
    health: {
      openIncidents: incidents.filter((incident) => incident.status !== "resolved").length,
      failedJobs: incidents.filter((incident) => incident.category === "outbox").length,
      staleHubs: incidents.filter((incident) => incident.category === "hub").length,
      failedIntegrations: incidents.filter((incident) => incident.category === "fiscal").length,
    },
    billing: {
      planSlug: optionalText(plan?.slug) ?? optionalText(trialPlan?.slug),
      status: optionalText(subscription?.state) ?? text(organization.billingState),
      provider: optionalText(subscription?.provider),
      nextChargeAt: optionalText(pendingCharge?.dueAt),
      delinquentSince: ["restricted", "suspended"].includes(text(organization.billingState))
        ? text(organization.billingStateChangedAt)
        : null,
      pilotStartsAt: optionalText(trial?.startsAt),
      pilotEndsAt: optionalText(trial?.endsAt),
    },
    onboarding: {
      status: onboarding?.activatedAt ? "ativado" : onboarding ? "em andamento" : "não iniciado",
      assignedTo: null,
      pendingItems: stringList(onboarding?.missingItems),
      updatedAt: optionalText(onboarding?.updatedAt),
    },
    units: units.map((row) => ({
      id: text(row.id),
      name: text(row.name),
      status: row.active === true ? "ativa" : "inativa",
    })),
    hubs: optionalRecords(payload.hubs).map((row) => ({
      id: text(row.hubId),
      name: text(row.unitName),
      status: row.stale === true ? "sem sinal" : "online",
      version: optionalText(row.version),
      lastSeenAt: optionalText(row.lastSeenAt),
    })),
    integrations: optionalRecords(payload.fiscal).map((row) => {
      const entity = record(row.entity);
      const profile = optionalRecord(row.profile);
      return {
        id: text(entity.id),
        unitName: optionalText(profile?.unitId) ?? text(entity.legalName),
        provider:
          optionalText(profile?.provider) ??
          optionalText(entity.fiscalProvider) ??
          "não configurado",
        status: text(entity.fiscalStatus),
        environment: optionalText(profile?.environment),
        lastCheckedAt: optionalText(profile?.updatedAt) ?? optionalText(entity.updatedAt),
        lastError: null,
      };
    }),
    doseClub: {
      available: doseClub !== undefined,
      providerEnabled: doseClub ? bool(doseClub.providerEnabled) : false,
      entitled: doseClub ? bool(doseClub.entitled) : false,
      connections: optionalRecords(doseClub?.connections).map((row) => ({
        id: text(row.id),
        unitId: optionalText(row.unitId),
        unitName: optionalText(row.unitName) ?? "Todas as unidades",
        status: text(row.status),
        managed: bool(row.managed),
        provisioningStatus: optionalText(row.provisioningStatus),
        healthCheckedAt: optionalText(row.healthCheckedAt),
        updatedAt: text(row.updatedAt),
      })),
    },
    timeline: optionalRecords(payload.timeline).map((row) => ({
      id: text(row.id),
      title: text(row.action),
      detail: optionalRecord(row.metadata)
        ? Object.entries(record(row.metadata))
            .map(([key, item]) => `${key}: ${String(item)}`)
            .join(" · ") || null
        : null,
      actorName: optionalText(row.actor),
      createdAt: text(row.occurredAt),
      tone: "neutral",
    })),
    partialSources: [],
  };
}

function parseOptionalPlatformTenant(value: unknown): TenantDetail | null {
  return value === null ? null : parsePlatformTenant(value);
}

export function parsePlatformIncidents(value: unknown): IncidentList {
  const payload = record(value);
  return {
    items: parseIncidentRows(records(payload.items)),
    nextCursor: optionalText(payload.nextCursor),
    partialSources: stringList(payload.partialSources),
  };
}

export function parseTenantPii(value: unknown): TenantPii {
  const payload = record(value);
  const organization = record(payload.organization);
  const member = optionalRecords(payload.members)[0];
  return {
    document: optionalText(organization.document),
    email: optionalText(member?.email),
    phone: null,
  };
}

export function parsePilotAccessGrant(value: unknown): PilotAccessGrant {
  const payload = record(value);
  return {
    endsAt: text(payload.endsAt),
    extended: bool(payload.extended),
    doseClubQueued: bool(payload.doseClubQueued),
  };
}

export function toggleCommercialEntitlement(
  entitlements: string[],
  entitlement: string,
  enabled: boolean,
) {
  return enabled
    ? [...new Set([...entitlements, entitlement])]
    : entitlements.filter((item) => item !== entitlement);
}

export function parsePilotTenantCreated(value: unknown): PilotTenantCreated {
  const payload = record(value);
  const organization = record(payload.organization);
  const unit = record(payload.unit);
  const owner = record(payload.owner);
  return {
    organization: {
      id: text(organization.id),
      tradeName: text(organization.tradeName),
      billingState: text(organization.billingState),
    },
    unit: { id: text(unit.id), name: text(unit.name) },
    owner: { identityId: text(owner.identityId), email: text(owner.email) },
    replayed: bool(payload.replayed),
  };
}

export function normalizeOrganizationDocument(value: string): string {
  return value
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "")
    .slice(0, 14);
}

export function parseCommercialOverview(value: unknown): CommercialOverview {
  const payload = record(value);
  const publication = optionalRecord(payload.publication);
  const published = optionalRecord(publication?.published);
  const scheduled = optionalRecord(publication?.scheduled);
  const versions = optionalRecords(payload.versions);
  const metrics = optionalRecord(payload.metrics);
  const funnel = optionalRecord(metrics?.funnel);
  return {
    publication: published
      ? {
          versionId: text(published.id),
          publishedAt: text(published.publishedAt),
          status: text(published.status),
        }
      : null,
    scheduled: scheduled
      ? {
          versionId: text(scheduled.id),
          publishAt: text(scheduled.scheduledPublishAt),
          version: number(scheduled.version),
        }
      : null,
    rollbackVersions: versions
      .filter((version) => version.status === "discontinued")
      .map((version) => ({
        versionId: text(version.id),
        publishedAt: text(version.publishedAt),
        version: number(version.version),
      })),
    drafts: versions
      .filter((version) => ["draft", "approved", "scheduled"].includes(String(version.status)))
      .map(parseCommercialDraft),
    media: optionalRecords(payload.media).map((item) => ({
      id: text(item.id),
      url: text(item.url),
      alt: text(item.alt),
      mimeType: text(item.mimeType),
      sizeBytes: number(item.sizeBytes),
    })),
    campaigns: optionalRecords(payload.campaigns).map((item) => ({
      id: text(item.id),
      slug: text(item.slug),
      name: text(item.name),
      status: text(item.status),
      startsAt: optionalText(item.startsAt),
      endsAt: optionalText(item.endsAt),
    })),
    partialSources: optionalRecords(payload.sources)
      .filter((source) => source.status === "unavailable")
      .map((source) => text(source.key)),
    funnel: funnel
      ? {
          status: funnel.status === "ok" ? "ok" : "partial",
          reason: optionalText(funnel.reason),
          stages: Object.entries(record(funnel.stages)).map(([stage, count]) => ({
            stage,
            count: number(count),
          })),
          convertedOrganizations: number(funnel.convertedOrganizations),
        }
      : {
          status: "partial",
          reason: "FUNNEL_SOURCE_UNAVAILABLE",
          stages: [],
          convertedOrganizations: 0,
        },
  };
}

export function parseCommercialDraft(row: Row): CommercialDraft {
  const content = optionalRecord(row.content) ?? row;
  const landing = optionalRecord(content.landing) ?? {};
  const seo = optionalRecord(content.seo) ?? {};
  return {
    id: text(row.id),
    status: text(row.status),
    version: number(row.version),
    updatedAt: text(row.updatedAt),
    plans: optionalRecords(content.plans).map((plan) => ({
      id: text(plan.id),
      slug: text(plan.slug),
      name: text(plan.name),
      description: optionalText(plan.description) ?? "",
      monthlyPriceCents: number(plan.monthlyPriceCents),
      annualPriceCents: number(plan.annualPriceCents),
      includedUnits: number(plan.includedUnits),
      entitlements: stringList(plan.entitlements),
      features: stringList(plan.features),
      featured: bool(plan.featured),
      displayOrder: number(plan.displayOrder),
      ctaLabel: text(plan.ctaLabel),
      ctaHref: text(plan.ctaHref),
    })),
    promotions: optionalRecords(content.promotions).map((promotion) => {
      const type = text(promotion.type);
      if (!(["percentage", "fixed", "price"] as string[]).includes(type))
        throw new InvalidPlatformPayloadError();
      return {
        id: text(promotion.id),
        name: text(promotion.name),
        type: type as CommercialPromotion["type"],
        value: number(promotion.value),
        startsAt: text(promotion.startsAt),
        endsAt: optionalText(promotion.endsAt),
        planSlugs: stringList(promotion.planSlugs),
        cycles: stringList(promotion.cycles) as CommercialPromotion["cycles"],
        newCustomersOnly: bool(promotion.newCustomersOnly),
        code: optionalText(promotion.code),
        redemptionLimit:
          promotion.redemptionLimit == null ? null : number(promotion.redemptionLimit),
        active: bool(promotion.active),
      };
    }),
    experiments: optionalRecords(content.experiments),
    landing,
    seo: {
      title: optionalText(seo.title) ?? "",
      description: optionalText(seo.description) ?? "",
      canonicalPath: optionalText(seo.canonicalPath) ?? "/",
      ogMediaId: optionalText(seo.ogMediaId),
    },
  };
}

export function parseCommercialLeads(value: unknown): CommercialLeadList {
  const payload = record(value);
  return {
    items: records(payload.items).map((lead) => {
      const state = record(lead.state);
      return {
        id: text(lead.id),
        name: text(lead.name),
        email: optionalText(lead.email),
        phone: optionalText(lead.phone),
        type: text(lead.type),
        stage: text(state.stage),
        assignedTo: optionalText(state.assignedToIdentityId),
        organizationId: optionalText(state.organizationId),
        createdAt: text(lead.createdAt),
      };
    }),
    funnel: optionalRecords(payload.funnel).map((stage) => ({
      stage: text(stage.stage),
      count: number(stage.count),
    })),
    nextCursor: optionalText(payload.nextCursor),
    partialSources: stringList(payload.partialSources),
  };
}

export function brlToCents(value: string): number {
  const normalized = value.trim().replace(/\s/g, "").replace(/\./g, "").replace(",", ".");
  const amount = Number(normalized);
  if (!Number.isFinite(amount) || amount < 0) throw new Error("Informe um valor monetário válido.");
  return Math.round(amount * 100);
}

function centsToBrl(value: number): string {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(value / 100);
}

function parseIncidentRows(rows: Row[]): PlatformIncident[] {
  return rows.map((row) => {
    const severity = text(row.severity);
    const state = text(row.state);
    if (!(["low", "medium", "high", "critical"] as string[]).includes(severity))
      throw new InvalidPlatformPayloadError();
    if (!(["open", "claimed", "snoozed", "resolved"] as string[]).includes(state))
      throw new InvalidPlatformPayloadError();
    const detail = record(row.detail);
    return {
      id: text(row.fingerprint),
      organizationId: optionalText(row.organizationId),
      organizationName: optionalText(row.organizationName) ?? "Tenant não identificado",
      title: text(row.title),
      detail:
        Object.entries(detail)
          .map(([key, item]) => `${key}: ${String(item)}`)
          .join(" · ") || "Sem detalhe adicional.",
      category: text(row.source),
      severity:
        severity === "critical" || severity === "high"
          ? "danger"
          : severity === "medium"
            ? "warning"
            : "info",
      severityLabel:
        { low: "baixa", medium: "média", high: "alta", critical: "crítica" }[severity] ?? severity,
      status: state as PlatformIncident["status"],
      assignedTo: optionalText(row.claimedByIdentityId),
      createdAt: text(row.occurredAt),
      snoozedUntil: optionalText(row.snoozedUntil),
      outboxEventId: row.source === "outbox" ? text(row.sourceId) : null,
      ageMinutes: number(row.ageMinutes),
    };
  });
}

export function maskEmail(value: string | null): string {
  if (!value) return "Não informado";
  const [local, domain] = value.split("@");
  if (!domain) return "••••••";
  return `${local?.slice(0, 1) ?? ""}•••@${domain}`;
}

export function maskPhone(value: string | null): string {
  if (!value) return "Não informado";
  const digits = value.replace(/\D/g, "");
  return digits.length < 4 ? "••••" : `••••••${digits.slice(-4)}`;
}

export function maskDocument(value: string | null): string {
  if (!value) return "Não informado";
  const digits = value.replace(/\D/g, "");
  return digits.length < 4 ? "••••" : `••.•••.•••/••${digits.slice(-2)}`;
}

export function hasCapability(access: PlatformAccess, capability: string): boolean {
  return access.capabilities.includes(capability);
}

type RemoteState<T> =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; data: T };

function usePlatformRemote<T>(loader: () => Promise<unknown>, parser: (value: unknown) => T) {
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<RemoteState<T>>({ status: "loading" });
  const [updating, setUpdating] = useState(false);
  const [refreshError, setRefreshError] = useState<string | null>(null);
  const [lastSuccessfulAt, setLastSuccessfulAt] = useState<string | null>(null);
  useEffect(() => {
    void attempt;
    let active = true;
    setRefreshError(null);
    setState((current) => {
      setUpdating(current.status === "ready");
      return current.status === "ready" ? current : { status: "loading" };
    });
    loader()
      .then(parser)
      .then((data) => {
        if (!active) return;
        setState({ status: "ready", data });
        setLastSuccessfulAt(new Date().toISOString());
        setUpdating(false);
      })
      .catch((error: unknown) => {
        if (!active) return;
        const message =
          error instanceof Error ? error.message : "Não foi possível carregar os dados.";
        setState((current) => {
          if (current.status === "ready") {
            setRefreshError(message);
            return current;
          }
          return { status: "error", message };
        });
        setUpdating(false);
      });
    return () => {
      active = false;
    };
  }, [attempt, loader, parser]);

  return {
    state,
    updating,
    refreshError,
    stale: refreshError !== null,
    lastSuccessfulAt,
    retry: useCallback(() => setAttempt((value) => value + 1), []),
  };
}

function dateTime(value: string | null): string {
  if (!value) return "Não informado";
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? "Data inválida"
    : new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short" }).format(date);
}

function incidentStatus(value: PlatformIncident["status"]): string {
  return { open: "Aberto", claimed: "Em atendimento", snoozed: "Adiado", resolved: "Resolvido" }[
    value
  ];
}

function RemoteMessage({
  label,
  state,
  retry,
}: {
  label: string;
  state: RemoteState<unknown>;
  retry: () => void;
}) {
  if (state.status === "loading")
    return (
      <div className="platform-remote" role="status">
        <span className="spinner" aria-hidden="true" />
        <strong>Carregando {label}…</strong>
      </div>
    );
  if (state.status === "error")
    return (
      <div className="platform-remote platform-remote--error" role="alert">
        <strong>Falha ao carregar {label}</strong>
        <span>{state.message}</span>
        <Button onClick={retry} size="sm" type="button" variant="secondary">
          Tentar novamente
        </Button>
      </div>
    );
  return null;
}

export function RealPlatformPage({ refreshToken }: { refreshToken: number }) {
  const [area, setArea] = useState<"control" | "commercial" | "team">("control");
  const [tenantInput, setTenantInput] = useState("");
  const [tenantSearch, setTenantSearch] = useState("");
  const [tenantStatus, setTenantStatus] = useState("active");
  const [tenantCursor, setTenantCursor] = useState<string | undefined>();
  const [tenantHistory, setTenantHistory] = useState<Array<string | undefined>>([]);
  const [incidentInput, setIncidentInput] = useState("");
  const [incidentSearch, setIncidentSearch] = useState("");
  const [incidentStatusFilter, setIncidentStatusFilter] = useState("open");
  const [incidentCursor, setIncidentCursor] = useState<string | undefined>();
  const [incidentHistory, setIncidentHistory] = useState<Array<string | undefined>>([]);
  const [selectedTenantId, setSelectedTenantId] = useState<string | null>(null);
  const [actionTarget, setActionTarget] = useState<{
    incident: PlatformIncident;
    action: IncidentAction | "retry";
  } | null>(null);
  const [revealOpen, setRevealOpen] = useState(false);
  const [pilotAccessOpen, setPilotAccessOpen] = useState(false);
  const [tenantCreateOpen, setTenantCreateOpen] = useState(false);
  const [tenantCreateError, setTenantCreateError] = useState<string | null>(null);
  const [pilotTenantForm, setPilotTenantForm] = useState<PilotTenantForm>(emptyPilotTenantForm);
  const tenantCreateIdempotencyKey = useRef(crypto.randomUUID());
  const [revealedPii, setRevealedPii] = useState<TenantPii | null>(null);
  const [reason, setReason] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [snoozedUntil, setSnoozedUntil] = useState("");
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<{ tone: "success" | "danger"; text: string } | null>(
    null,
  );

  const overviewLoader = useCallback(() => {
    void refreshToken;
    return platformApi.overview();
  }, [refreshToken]);
  const tenantsLoader = useCallback(() => {
    void refreshToken;
    return platformApi.tenants({
      ...(tenantSearch ? { search: tenantSearch } : {}),
      ...(tenantStatus !== "all" ? { status: tenantStatus } : {}),
      ...(tenantCursor ? { cursor: tenantCursor } : {}),
      limit: 20,
    });
  }, [refreshToken, tenantCursor, tenantSearch, tenantStatus]);
  const incidentsLoader = useCallback(() => {
    void refreshToken;
    return platformApi.incidents({
      ...(incidentSearch ? { search: incidentSearch } : {}),
      ...(incidentStatusFilter !== "all" ? { status: incidentStatusFilter } : {}),
      ...(incidentCursor ? { cursor: incidentCursor } : {}),
      limit: 20,
    });
  }, [refreshToken, incidentCursor, incidentSearch, incidentStatusFilter]);
  const tenantLoader = useCallback(() => {
    void refreshToken;
    return selectedTenantId ? platformApi.tenant(selectedTenantId) : Promise.resolve(null);
  }, [refreshToken, selectedTenantId]);
  const overview = usePlatformRemote(overviewLoader, parsePlatformOverview);
  const tenants = usePlatformRemote(tenantsLoader, parsePlatformTenants);
  const incidents = usePlatformRemote(incidentsLoader, parsePlatformIncidents);
  const tenant = usePlatformRemote(tenantLoader, parseOptionalPlatformTenant);
  const access = overview.state.status === "ready" ? overview.state.data.access : null;
  const canManageIncidents = access ? hasCapability(access, "incidents:write") : false;
  const canRetryOutbox = access ? hasCapability(access, "outbox:retry") : false;
  const canCreateTenant = access ? hasCapability(access, "tenants:write") : false;
  const canGrantPilotAccess = access ? hasCapability(access, "billing:write") : false;
  const canRevealPii = access ? hasCapability(access, "pii:read") : false;
  const canManageTeam = access ? hasCapability(access, "team:manage") : false;

  function submitTenantSearch(event: FormEvent) {
    event.preventDefault();
    setTenantHistory([]);
    setTenantCursor(undefined);
    setTenantSearch(tenantInput.trim());
  }

  function submitIncidentSearch(event: FormEvent) {
    event.preventDefault();
    setIncidentHistory([]);
    setIncidentCursor(undefined);
    setIncidentSearch(incidentInput.trim());
  }

  function resetActionForm() {
    setActionTarget(null);
    setRevealOpen(false);
    setPilotAccessOpen(false);
    setReason("");
    setConfirmed(false);
    setSnoozedUntil("");
  }

  function resetPilotTenantForm() {
    setTenantCreateOpen(false);
    setTenantCreateError(null);
    setPilotTenantForm(emptyPilotTenantForm);
    tenantCreateIdempotencyKey.current = crypto.randomUUID();
    setConfirmed(false);
  }

  async function createPilotTenant(event: FormEvent) {
    event.preventDefault();
    if (
      !confirmed ||
      pilotTenantForm.document.length !== 14 ||
      pilotTenantForm.reason.trim().length < 8
    )
      return;
    setBusy(true);
    setTenantCreateError(null);
    setFeedback(null);
    try {
      const result = parsePilotTenantCreated(
        await platformApi.createTenant(
          {
            ...pilotTenantForm,
            legalName: pilotTenantForm.legalName.trim(),
            tradeName: pilotTenantForm.tradeName.trim(),
            unitName: pilotTenantForm.unitName.trim(),
            ownerEmail: pilotTenantForm.ownerEmail.trim().toLowerCase(),
            reason: pilotTenantForm.reason.trim(),
          },
          tenantCreateIdempotencyKey.current,
        ),
      );
      setSelectedTenantId(result.organization.id);
      setTenantInput("");
      setTenantSearch("");
      setTenantStatus("all");
      setTenantCursor(undefined);
      setTenantHistory([]);
      setFeedback({
        tone: "success",
        text: `${result.organization.tradeName} e a unidade ${result.unit.name} foram cadastradas. O responsável deve concluir o onboarding e ativar o teste; depois use “Conceder 6 meses”.`,
      });
      resetPilotTenantForm();
      tenants.retry();
      overview.retry();
    } catch (error) {
      setTenantCreateError(
        error instanceof Error
          ? error.message
          : "A plataforma não confirmou o cadastro do cliente piloto.",
      );
    } finally {
      setBusy(false);
    }
  }

  async function submitIncidentAction(event: FormEvent) {
    event.preventDefault();
    if (!actionTarget || reason.trim().length < 8 || !confirmed) return;
    setBusy(true);
    setFeedback(null);
    try {
      if (actionTarget.action === "retry") {
        if (!actionTarget.incident.outboxEventId)
          throw new Error("Evento de outbox não informado.");
        await platformApi.retryOutbox(actionTarget.incident.outboxEventId, {
          reason: reason.trim(),
        });
      } else {
        await platformApi.updateIncident(actionTarget.incident.id, {
          action: actionTarget.action,
          reason: reason.trim(),
          ...(actionTarget.action === "snooze"
            ? { snoozedUntil: new Date(snoozedUntil).toISOString() }
            : {}),
        });
      }
      setFeedback({ tone: "success", text: "Ação confirmada e registrada na auditoria." });
      resetActionForm();
      incidents.retry();
      tenant.retry();
      overview.retry();
    } catch (error) {
      setFeedback({
        tone: "danger",
        text: error instanceof Error ? error.message : "A ação não foi confirmada pela plataforma.",
      });
    } finally {
      setBusy(false);
    }
  }

  async function revealPii(event: FormEvent) {
    event.preventDefault();
    if (!selectedTenantId || reason.trim().length < 8 || !confirmed) return;
    setBusy(true);
    setFeedback(null);
    try {
      setRevealedPii(
        parseTenantPii(await platformApi.revealTenantPii(selectedTenantId, reason.trim())),
      );
      setFeedback({
        tone: "success",
        text: "Dados revelados nesta sessão. O acesso foi auditado.",
      });
      resetActionForm();
    } catch (error) {
      setFeedback({
        tone: "danger",
        text:
          error instanceof Error ? error.message : "A plataforma não autorizou o acesso aos dados.",
      });
    } finally {
      setBusy(false);
    }
  }

  async function grantPilotAccess(event: FormEvent) {
    event.preventDefault();
    if (!selectedTenantId || reason.trim().length < 8 || !confirmed) return;
    setBusy(true);
    setFeedback(null);
    try {
      const result = parsePilotAccessGrant(
        await platformApi.grantPilotAccess(selectedTenantId, { reason: reason.trim() }),
      );
      setFeedback({
        tone: "success",
        text: `${
          result.extended
            ? `Acesso piloto confirmado até ${dateTime(result.endsAt)}.`
            : `O tenant já tinha acesso igual ou superior até ${dateTime(result.endsAt)}.`
        }${result.doseClubQueued ? " Provisionamento do DoseClub enviado para a fila." : ""}`,
      });
      resetActionForm();
      tenant.retry();
      tenants.retry();
      overview.retry();
    } catch (error) {
      setFeedback({
        tone: "danger",
        text:
          error instanceof Error
            ? error.message
            : "A plataforma não confirmou a concessão do acesso piloto.",
      });
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="platform-console">
      <header className="platform-header gm-toolbar">
        <div>
          <p className="eyebrow">Back office GiroMesa</p>
          <h1>Central de controle</h1>
          <p>Tenants, incidentes, assinatura e integrações em uma visão auditável.</p>
        </div>
        <div className="platform-header__actions">
          {access && <Badge tone="info">Perfil: {access.role}</Badge>}
          {access && (
            <Badge tone={access.mfaEnforced ? "success" : "danger"}>
              MFA {access.mfaEnforced ? "obrigatório" : "não aplicado"}
            </Badge>
          )}
          <Button
            aria-busy={overview.updating || tenants.updating || incidents.updating}
            disabled={overview.updating || tenants.updating || incidents.updating}
            onClick={() => {
              overview.retry();
              tenants.retry();
              incidents.retry();
              tenant.retry();
            }}
            size="sm"
            type="button"
            variant="secondary"
          >
            {overview.updating || tenants.updating || incidents.updating
              ? "Atualizando…"
              : "Atualizar"}
          </Button>
        </div>
      </header>

      <nav aria-label="Áreas do back office" className="platform-area-tabs">
        <Button
          aria-pressed={area === "control"}
          onClick={() => setArea("control")}
          size="sm"
          type="button"
          variant={area === "control" ? "primary" : "ghost"}
        >
          Operação da plataforma
        </Button>
        <Button
          aria-pressed={area === "commercial"}
          onClick={() => setArea("commercial")}
          size="sm"
          type="button"
          variant={area === "commercial" ? "primary" : "ghost"}
        >
          Comercial &amp; Site
        </Button>
        {canManageTeam && (
          <Button
            aria-pressed={area === "team"}
            onClick={() => setArea("team")}
            size="sm"
            type="button"
            variant={area === "team" ? "primary" : "ghost"}
          >
            Equipe interna
          </Button>
        )}
      </nav>

      {area === "control" ? (
        <>
          <div
            aria-live="polite"
            className="platform-feedback"
            role={feedback?.tone === "danger" ? "alert" : "status"}
          >
            {feedback && <span data-tone={feedback.tone}>{feedback.text}</span>}
          </div>

          <RemoteMessage
            label="resumo da plataforma"
            retry={overview.retry}
            state={overview.state}
          />
          {overview.state.status === "ready" && (
            <>
              {(overview.updating ||
                overview.stale ||
                overview.state.data.partialSources.length > 0) && (
                <StatusNotice
                  lastSuccessfulAt={overview.lastSuccessfulAt}
                  partialSources={overview.state.data.partialSources}
                  refreshError={overview.refreshError}
                  updating={overview.updating}
                />
              )}
              <section aria-label="Indicadores da plataforma" className="platform-metrics">
                <Card>
                  <small>Tenants</small>
                  <strong>{overview.state.data.counts.organizations}</strong>
                </Card>
                <Card>
                  <small>Unidades</small>
                  <strong>{overview.state.data.counts.units}</strong>
                </Card>
                <Card>
                  <small>Incidentes técnicos</small>
                  <strong>
                    {overview.state.data.health.failedJobs +
                      overview.state.data.health.staleHubs +
                      overview.state.data.health.failedIntegrations}
                  </strong>
                </Card>
                <Card>
                  <small>Ativações / solicitações</small>
                  <strong>
                    {overview.state.data.trialFunnel.activations} /{" "}
                    {overview.state.data.trialFunnel.applications}
                  </strong>
                  <small>{overview.state.data.trialFunnel.conversionPercent}% em 7 dias</small>
                </Card>
              </section>
            </>
          )}

          <div className="platform-primary-grid">
            <TenantSearchPanel
              canCreate={canCreateTenant}
              history={tenantHistory}
              input={tenantInput}
              remote={tenants}
              selectedTenantId={selectedTenantId}
              setCursor={setTenantCursor}
              setHistory={setTenantHistory}
              setInput={setTenantInput}
              setSelectedTenantId={(organizationId) => {
                setRevealedPii(null);
                setSelectedTenantId(organizationId);
              }}
              setStatus={setTenantStatus}
              startCreate={() => {
                setFeedback(null);
                setConfirmed(false);
                setTenantCreateOpen(true);
              }}
              status={tenantStatus}
              submit={submitTenantSearch}
              tenantCursor={tenantCursor}
            />
            <IncidentPanel
              canManage={canManageIncidents}
              canRetry={canRetryOutbox}
              history={incidentHistory}
              input={incidentInput}
              incidentCursor={incidentCursor}
              remote={incidents}
              setActionTarget={setActionTarget}
              setCursor={setIncidentCursor}
              setHistory={setIncidentHistory}
              setInput={setIncidentInput}
              setStatus={setIncidentStatusFilter}
              status={incidentStatusFilter}
              submit={submitIncidentSearch}
            />
          </div>

          <TenantWorkspace
            canGrantPilotAccess={canGrantPilotAccess}
            canRevealPii={canRevealPii}
            data={tenant.state.status === "ready" ? tenant.state.data : null}
            loadingState={selectedTenantId ? tenant.state : null}
            onGrantPilotAccess={() => setPilotAccessOpen(true)}
            onReveal={() => setRevealOpen(true)}
            pii={revealedPii}
            retry={tenant.retry}
            selected={selectedTenantId !== null}
            stale={tenant.stale}
            updating={tenant.updating}
          />
        </>
      ) : area === "commercial" ? (
        <CommercialWorkspace access={access} refreshToken={refreshToken} />
      ) : (
        <PlatformTeam />
      )}

      <Modal
        description="Crie a empresa e a primeira unidade e vincule um responsável que já tenha uma conta GiroMesa. Nenhuma senha será criada no backoffice."
        isOpen={tenantCreateOpen}
        onClose={() => !busy && resetPilotTenantForm()}
        size="md"
        title="Cliente piloto"
      >
        <form className="platform-action-form" onSubmit={createPilotTenant}>
          {tenantCreateError && (
            <div className="platform-remote platform-remote--error" role="alert">
              {tenantCreateError}
            </div>
          )}
          <div className="platform-form-grid">
            <label htmlFor="platform-pilot-legal-name">
              <span>Razão social</span>
              <Input
                autoComplete="organization"
                id="platform-pilot-legal-name"
                maxLength={160}
                minLength={2}
                onChange={(event) =>
                  setPilotTenantForm((current) => ({
                    ...current,
                    legalName: event.target.value,
                  }))
                }
                required
                value={pilotTenantForm.legalName}
              />
            </label>
            <label htmlFor="platform-pilot-trade-name">
              <span>Nome fantasia</span>
              <Input
                id="platform-pilot-trade-name"
                maxLength={120}
                minLength={2}
                onChange={(event) =>
                  setPilotTenantForm((current) => ({
                    ...current,
                    tradeName: event.target.value,
                  }))
                }
                required
                value={pilotTenantForm.tradeName}
              />
            </label>
            <label htmlFor="platform-pilot-document">
              <span>CNPJ</span>
              <Input
                autoComplete="off"
                id="platform-pilot-document"
                inputMode="text"
                minLength={14}
                onChange={(event) =>
                  setPilotTenantForm((current) => ({
                    ...current,
                    document: normalizeOrganizationDocument(event.target.value),
                  }))
                }
                pattern="[A-Z0-9]{12}[0-9]{2}"
                placeholder="Somente letras e números"
                required
                value={pilotTenantForm.document}
              />
            </label>
            <label htmlFor="platform-pilot-unit-name">
              <span>Primeira unidade</span>
              <Input
                id="platform-pilot-unit-name"
                maxLength={120}
                minLength={2}
                onChange={(event) =>
                  setPilotTenantForm((current) => ({
                    ...current,
                    unitName: event.target.value,
                  }))
                }
                required
                value={pilotTenantForm.unitName}
              />
            </label>
            <label className="platform-form-grid__wide" htmlFor="platform-pilot-owner-email">
              <span>E-mail do responsável</span>
              <Input
                aria-describedby="platform-pilot-owner-email-hint"
                autoComplete="email"
                id="platform-pilot-owner-email"
                maxLength={320}
                onChange={(event) =>
                  setPilotTenantForm((current) => ({
                    ...current,
                    ownerEmail: event.target.value,
                  }))
                }
                required
                type="email"
                value={pilotTenantForm.ownerEmail}
              />
              <small className="platform-form-hint" id="platform-pilot-owner-email-hint">
                O responsável deve criar a conta GiroMesa com este e-mail antes do cadastro.
              </small>
            </label>
            <label className="platform-form-grid__wide" htmlFor="platform-pilot-reason">
              <span>Motivo do cadastro</span>
              <Textarea
                id="platform-pilot-reason"
                minLength={8}
                onChange={(event) =>
                  setPilotTenantForm((current) => ({
                    ...current,
                    reason: event.target.value,
                  }))
                }
                required
                value={pilotTenantForm.reason}
              />
            </label>
          </div>
          <label className="platform-confirm" htmlFor="platform-pilot-confirm">
            <Input
              checked={confirmed}
              id="platform-pilot-confirm"
              onChange={(event) => setConfirmed(event.target.checked)}
              required
              type="checkbox"
            />
            Confirmo a empresa, a unidade, o responsável e o registro desta ação em auditoria.
          </label>
          <div className="platform-modal-actions">
            <Button
              disabled={busy}
              onClick={resetPilotTenantForm}
              type="button"
              variant="secondary"
            >
              Cancelar
            </Button>
            <Button
              aria-busy={busy}
              disabled={busy || pilotTenantForm.reason.trim().length < 8 || !confirmed}
              type="submit"
            >
              {busy ? "Cadastrando…" : "Cadastrar cliente"}
            </Button>
          </div>
        </form>
      </Modal>

      <Modal
        description="A plataforma registrará operador, tenant, motivo e horário."
        isOpen={actionTarget !== null}
        onClose={() => !busy && resetActionForm()}
        size="sm"
        title={actionTarget ? actionLabel(actionTarget.action) : "Ação no incidente"}
      >
        <form className="platform-action-form" onSubmit={submitIncidentAction}>
          <label htmlFor="platform-action-reason">Motivo</label>
          <Textarea
            id="platform-action-reason"
            minLength={8}
            onChange={(event) => setReason(event.target.value)}
            required
            value={reason}
          />
          {actionTarget?.action === "snooze" && (
            <>
              <label htmlFor="platform-snooze-until">Adiar até</label>
              <Input
                id="platform-snooze-until"
                min={new Date().toISOString().slice(0, 16)}
                onChange={(event) => setSnoozedUntil(event.target.value)}
                required
                type="datetime-local"
                value={snoozedUntil}
              />
            </>
          )}
          <label className="platform-confirm" htmlFor="platform-action-confirm">
            <Input
              checked={confirmed}
              id="platform-action-confirm"
              onChange={(event) => setConfirmed(event.target.checked)}
              required
              type="checkbox"
            />
            Confirmo a ação e o registro em auditoria.
          </label>
          <div className="platform-modal-actions">
            <Button disabled={busy} onClick={resetActionForm} type="button" variant="secondary">
              Cancelar
            </Button>
            <Button
              aria-busy={busy}
              disabled={busy || reason.trim().length < 8 || !confirmed}
              type="submit"
            >
              {busy ? "Confirmando…" : "Confirmar"}
            </Button>
          </div>
        </form>
      </Modal>

      <Modal
        description="O período será de seis meses a partir da confirmação e nunca reduzirá um acesso vigente mais longo. A ação será auditada."
        isOpen={pilotAccessOpen}
        onClose={() => !busy && resetActionForm()}
        size="sm"
        title="Conceder acesso piloto"
      >
        <form className="platform-action-form" onSubmit={grantPilotAccess}>
          <label htmlFor="platform-pilot-access-reason">Motivo da concessão</label>
          <Textarea
            id="platform-pilot-access-reason"
            minLength={8}
            onChange={(event) => setReason(event.target.value)}
            required
            value={reason}
          />
          <label className="platform-confirm" htmlFor="platform-pilot-access-confirm">
            <Input
              checked={confirmed}
              id="platform-pilot-access-confirm"
              onChange={(event) => setConfirmed(event.target.checked)}
              required
              type="checkbox"
            />
            Confirmo a concessão do acesso piloto por seis meses.
          </label>
          <div className="platform-modal-actions">
            <Button disabled={busy} onClick={resetActionForm} type="button" variant="secondary">
              Cancelar
            </Button>
            <Button
              aria-busy={busy}
              disabled={busy || reason.trim().length < 8 || !confirmed}
              type="submit"
            >
              {busy ? "Confirmando…" : "Conceder acesso"}
            </Button>
          </div>
        </form>
      </Modal>

      <Modal
        description="Dados pessoais ficam mascarados por padrão. Este acesso será auditado."
        isOpen={revealOpen}
        onClose={() => !busy && resetActionForm()}
        size="sm"
        title="Revelar dados do tenant"
      >
        <form className="platform-action-form" onSubmit={revealPii}>
          <label htmlFor="platform-pii-reason">Motivo do acesso</label>
          <Textarea
            id="platform-pii-reason"
            minLength={8}
            onChange={(event) => setReason(event.target.value)}
            required
            value={reason}
          />
          <label className="platform-confirm" htmlFor="platform-pii-confirm">
            <Input
              checked={confirmed}
              id="platform-pii-confirm"
              onChange={(event) => setConfirmed(event.target.checked)}
              required
              type="checkbox"
            />
            Confirmo que preciso destes dados para o atendimento informado.
          </label>
          <div className="platform-modal-actions">
            <Button disabled={busy} onClick={resetActionForm} type="button" variant="secondary">
              Cancelar
            </Button>
            <Button
              aria-busy={busy}
              disabled={busy || reason.trim().length < 8 || !confirmed}
              type="submit"
            >
              {busy ? "Validando…" : "Revelar dados"}
            </Button>
          </div>
        </form>
      </Modal>
    </main>
  );
}

interface RemoteResult<T> {
  state: RemoteState<T>;
  updating: boolean;
  refreshError: string | null;
  stale: boolean;
  lastSuccessfulAt: string | null;
  retry: () => void;
}

function CommercialWorkspace({
  access,
  refreshToken,
}: {
  access: PlatformAccess | null;
  refreshToken: number;
}) {
  const canLeads = access ? hasCapability(access, "commercial:leads") : false;
  const [tab, setTab] = useState<CommercialTab>("catalog");
  const [selectedDraftId, setSelectedDraftId] = useState<string | null>(null);
  const [draft, setDraft] = useState<CommercialDraft | null>(null);
  const [leadSearch, setLeadSearch] = useState("");
  const [leadType, setLeadType] = useState("");
  const [leadStage, setLeadStage] = useState("");
  const [leadAssignee, setLeadAssignee] = useState("");
  const [leadQuery, setLeadQuery] = useState({
    search: "",
    type: "",
    stage: "",
    assignedToIdentityId: "",
  });
  const [action, setAction] = useState<
    "create" | "save" | "approve" | "publish" | "rollback" | null
  >(null);
  const [reason, setReason] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [publishAt, setPublishAt] = useState("");
  const [rollbackVersionId, setRollbackVersionId] = useState("");
  const [preview, setPreview] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [mediaFile, setMediaFile] = useState<File | null>(null);
  const [mediaPreview, setMediaPreview] = useState<string | null>(null);
  const [mediaAlt, setMediaAlt] = useState("");
  const [mediaReason, setMediaReason] = useState("");
  const [mediaConfirmed, setMediaConfirmed] = useState(false);
  const loader = useCallback(() => {
    void refreshToken;
    return platformApi.commercialOverview();
  }, [refreshToken]);
  const leadLoader = useCallback(
    () =>
      canLeads
        ? platformApi.commercialLeads({ ...leadQuery, limit: 50 })
        : Promise.resolve({ items: [], nextCursor: null }),
    [canLeads, leadQuery],
  );
  const remote = usePlatformRemote(loader, parseCommercialOverview);
  const leads = usePlatformRemote(leadLoader, parseCommercialLeads);
  const canRead = access ? hasCapability(access, "commercial:read") : false;
  const canWrite = access ? hasCapability(access, "commercial:write") : false;
  const canApprove = access ? hasCapability(access, "commercial:approve") : false;
  const canPublish = access ? hasCapability(access, "commercial:publish") : false;
  const canMedia = access ? hasCapability(access, "commercial:media") : false;
  const canMetrics = access ? hasCapability(access, "commercial:metrics") : false;

  useEffect(() => {
    if (remote.state.status !== "ready") return;
    const selected = remote.state.data.drafts.find((item) => item.id === selectedDraftId);
    const next = selected ?? remote.state.data.drafts[0] ?? null;
    setSelectedDraftId(next?.id ?? null);
    setDraft(next ? structuredClone(next) : null);
  }, [remote.state, selectedDraftId]);

  useEffect(() => {
    if (!selectedDraftId) return;
    let active = true;
    platformApi
      .commercialDraftPreview(selectedDraftId)
      .then((value) => parseCommercialDraft(record(value)))
      .then((value) => active && setDraft(value))
      .catch(
        (error: unknown) =>
          active && setFeedback(error instanceof Error ? error.message : "Draft indisponível."),
      );
    return () => {
      active = false;
    };
  }, [selectedDraftId]);

  useEffect(
    () => () => {
      if (mediaPreview) URL.revokeObjectURL(mediaPreview);
    },
    [mediaPreview],
  );

  if (!canRead)
    return (
      <Card className="platform-remote platform-remote--error" role="alert">
        <strong>Acesso comercial não autorizado</strong>
        <span>Seu perfil não possui commercial:read.</span>
      </Card>
    );

  async function runAction(event: FormEvent) {
    event.preventDefault();
    if (!action || reason.trim().length < 8 || !confirmed) return;
    setBusy(true);
    setFeedback(null);
    try {
      if (action === "create")
        await platformApi.createCommercialDraft({
          reason: reason.trim(),
          ...(remote.state.status === "ready" && remote.state.data.publication
            ? { sourceVersionId: remote.state.data.publication.versionId }
            : {}),
        });
      if (action === "save" && draft)
        await platformApi.updateCommercialDraft(draft.id, {
          reason: reason.trim(),
          plans: draft.plans.map(({ id: _id, ...plan }) => plan),
          landing: draft.landing,
          seo: {
            title: draft.seo.title,
            description: draft.seo.description,
            canonicalPath: draft.seo.canonicalPath,
            ...(draft.seo.ogMediaId ? { ogMediaId: draft.seo.ogMediaId } : {}),
          },
          promotions: draft.promotions,
          experiments: draft.experiments,
        });
      if (action === "approve" && draft)
        await platformApi.approveCommercialDraft(draft.id, reason.trim());
      if (action === "publish" && draft)
        await platformApi.publishCommercialDraft(draft.id, {
          reason: reason.trim(),
          ...(publishAt ? { publishAt: new Date(publishAt).toISOString() } : {}),
        });
      if (action === "rollback" && rollbackVersionId)
        await platformApi.rollbackCommercialPublication(rollbackVersionId, reason.trim());
      setFeedback("Ação comercial confirmada e registrada em auditoria.");
      setAction(null);
      setReason("");
      setConfirmed(false);
      setPublishAt("");
      setRollbackVersionId("");
      remote.retry();
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : "A ação comercial não foi confirmada.");
    } finally {
      setBusy(false);
    }
  }

  async function loadPreview() {
    if (!draft) return;
    setBusy(true);
    setFeedback(null);
    try {
      setPreview(await platformApi.commercialDraftPreview(draft.id));
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : "Preview indisponível.");
    } finally {
      setBusy(false);
    }
  }

  async function uploadMedia(event: FormEvent) {
    event.preventDefault();
    if (
      !mediaFile ||
      !mediaConfirmed ||
      mediaAlt.trim().length < 3 ||
      mediaReason.trim().length < 8
    )
      return;
    setBusy(true);
    setFeedback(null);
    try {
      await platformApi.uploadCommercialMedia({
        fileName: mediaFile.name,
        mimeType: mediaFile.type as "image/jpeg" | "image/png" | "image/webp",
        base64: await fileBase64(mediaFile),
        alt: mediaAlt.trim(),
        reason: mediaReason.trim(),
      });
      setFeedback("Imagem persistida na biblioteca de mídia.");
      setMediaFile(null);
      setMediaPreview(null);
      setMediaAlt("");
      setMediaReason("");
      setMediaConfirmed(false);
      remote.retry();
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : "Upload não confirmado.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="commercial-workspace" aria-labelledby="commercial-title">
      <div className="section-title">
        <div>
          <p className="eyebrow">Comercial &amp; Site</p>
          <h2 id="commercial-title">Publicação comercial</h2>
        </div>
        <div className="platform-header__actions">
          {remote.state.status === "ready" && (
            <>
              <Badge tone={remote.state.data.publication ? "success" : "warning"}>
                {remote.state.data.publication
                  ? `Publicada ${dateTime(remote.state.data.publication.publishedAt)}`
                  : "Sem publicação"}
              </Badge>
              {remote.state.data.scheduled && (
                <Badge tone="info">
                  v{remote.state.data.scheduled.version} agendada para{" "}
                  {dateTime(remote.state.data.scheduled.publishAt)}
                </Badge>
              )}
            </>
          )}
          <Button onClick={remote.retry} size="sm" type="button" variant="secondary">
            Atualizar
          </Button>
        </div>
      </div>
      <nav aria-label="Seções comerciais" className="commercial-tabs">
        {(
          [
            ["catalog", "Catálogo"],
            ["promotions", "Promoções"],
            ["landing", "Landing / SEO / Mídia"],
            ["leads", "Leads / Campanhas"],
          ] as Array<[CommercialTab, string]>
        ).map(([id, label]) => (
          <Button
            aria-pressed={tab === id}
            key={id}
            onClick={() => setTab(id)}
            size="sm"
            type="button"
            variant={tab === id ? "primary" : "ghost"}
          >
            {label}
          </Button>
        ))}
      </nav>
      <div aria-live="polite" className="platform-feedback" role="status">
        {feedback && <span data-tone="success">{feedback}</span>}
      </div>
      <RemoteMessage label="conteúdo comercial" retry={remote.retry} state={remote.state} />
      {remote.state.status === "ready" &&
        (remote.updating || remote.stale || remote.state.data.partialSources.length > 0) && (
          <StatusNotice
            lastSuccessfulAt={remote.lastSuccessfulAt}
            partialSources={remote.state.data.partialSources}
            refreshError={remote.refreshError}
            updating={remote.updating}
          />
        )}
      {remote.state.status === "ready" && (
        <>
          <Card className="commercial-draft-bar">
            <label htmlFor="commercial-draft">Draft em edição</label>
            <NativeSelect
              id="commercial-draft"
              onChange={(event) => setSelectedDraftId(event.target.value)}
              value={selectedDraftId ?? ""}
            >
              <option value="">Selecione</option>
              {remote.state.data.drafts.map((item) => (
                <option key={item.id} value={item.id}>
                  v{item.version} · {item.status}
                </option>
              ))}
            </NativeSelect>
            <div className="platform-header__actions">
              {canWrite && (
                <Button
                  onClick={() => setAction("create")}
                  size="sm"
                  type="button"
                  variant="secondary"
                >
                  Novo draft
                </Button>
              )}
              {draft && (
                <Button
                  disabled={busy}
                  onClick={() => void loadPreview()}
                  size="sm"
                  type="button"
                  variant="ghost"
                >
                  Preview
                </Button>
              )}
              {canWrite && draft && (
                <Button onClick={() => setAction("save")} size="sm" type="button">
                  Salvar draft
                </Button>
              )}
              {canApprove && draft && (
                <Button
                  onClick={() => setAction("approve")}
                  size="sm"
                  type="button"
                  variant="secondary"
                >
                  Solicitar / aprovar
                </Button>
              )}
              {canPublish && draft && (
                <Button onClick={() => setAction("publish")} size="sm" type="button">
                  Publicar / agendar
                </Button>
              )}
              {canPublish && remote.state.data.rollbackVersions.length > 0 && (
                <Button
                  onClick={() => {
                    if (remote.state.status !== "ready") return;
                    setRollbackVersionId(remote.state.data.rollbackVersions[0]?.versionId ?? "");
                    setAction("rollback");
                  }}
                  size="sm"
                  type="button"
                  variant="danger"
                >
                  Rollback
                </Button>
              )}
            </div>
          </Card>
          {!draft && (
            <EmptyState
              description="Crie um draft a partir da versão publicada para editar com segurança."
              icon="◇"
              title="Sem draft comercial"
            />
          )}
          {draft && tab === "catalog" && <CommercialCatalog draft={draft} setDraft={setDraft} />}
          {draft && tab === "promotions" && (
            <CommercialPromotions draft={draft} setDraft={setDraft} />
          )}
          {draft && tab === "landing" && (
            <CommercialLanding
              canMedia={canMedia}
              draft={draft}
              media={remote.state.data.media}
              setDraft={setDraft}
              mediaFile={mediaFile}
              mediaPreview={mediaPreview}
              setMediaFile={(file) => {
                if (mediaPreview) URL.revokeObjectURL(mediaPreview);
                setMediaFile(file);
                setMediaPreview(file ? URL.createObjectURL(file) : null);
              }}
              mediaAlt={mediaAlt}
              setMediaAlt={setMediaAlt}
              mediaReason={mediaReason}
              setMediaReason={setMediaReason}
              mediaConfirmed={mediaConfirmed}
              setMediaConfirmed={setMediaConfirmed}
              uploadMedia={uploadMedia}
              busy={busy}
            />
          )}
          {tab === "leads" && canLeads && (
            <CommercialLeads
              canMetrics={canMetrics}
              canWrite={canWrite}
              campaigns={remote.state.data.campaigns}
              funnel={remote.state.data.funnel}
              input={leadSearch}
              setInput={setLeadSearch}
              stage={leadStage}
              setStageFilter={setLeadStage}
              assignee={leadAssignee}
              setAssigneeFilter={setLeadAssignee}
              type={leadType}
              setType={setLeadType}
              submit={(event) => {
                event.preventDefault();
                setLeadQuery({
                  search: leadSearch.trim(),
                  type: leadType,
                  stage: leadStage,
                  assignedToIdentityId: leadAssignee.trim(),
                });
              }}
              remote={leads}
            />
          )}
          {tab === "leads" && !canLeads && (
            <Card className="platform-remote platform-remote--error" role="alert">
              Seu perfil não possui commercial:leads.
            </Card>
          )}
        </>
      )}
      <Modal
        description="Motivo e operador serão registrados na auditoria."
        isOpen={action !== null}
        onClose={() => !busy && setAction(null)}
        size="sm"
        title={commercialActionLabel(action)}
      >
        <form className="platform-action-form" onSubmit={runAction}>
          <label htmlFor="commercial-reason">Motivo</label>
          <Textarea
            id="commercial-reason"
            minLength={8}
            onChange={(event) => setReason(event.target.value)}
            required
            value={reason}
          />
          {action === "publish" && (
            <>
              <label htmlFor="commercial-publish-at">Agendar (opcional)</label>
              <Input
                id="commercial-publish-at"
                onChange={(event) => setPublishAt(event.target.value)}
                type="datetime-local"
                value={publishAt}
              />
            </>
          )}
          {action === "rollback" && remote.state.status === "ready" && (
            <>
              <label htmlFor="commercial-rollback-version">Versão que será restaurada</label>
              <NativeSelect
                id="commercial-rollback-version"
                onChange={(event) => setRollbackVersionId(event.target.value)}
                required
                value={rollbackVersionId}
              >
                {remote.state.data.rollbackVersions.map((version) => (
                  <option key={version.versionId} value={version.versionId}>
                    v{version.version} · publicada {dateTime(version.publishedAt)}
                  </option>
                ))}
              </NativeSelect>
            </>
          )}
          <label className="platform-confirm" htmlFor="commercial-confirm">
            <Input
              checked={confirmed}
              id="commercial-confirm"
              onChange={(event) => setConfirmed(event.target.checked)}
              required
              type="checkbox"
            />
            Confirmo a alteração e seu impacto no site público.
          </label>
          <div className="platform-modal-actions">
            <Button onClick={() => setAction(null)} type="button" variant="secondary">
              Cancelar
            </Button>
            <Button
              aria-busy={busy}
              disabled={
                busy ||
                !confirmed ||
                reason.trim().length < 8 ||
                (action === "rollback" && !rollbackVersionId)
              }
              type="submit"
            >
              Confirmar
            </Button>
          </div>
        </form>
      </Modal>
      <Modal
        isOpen={preview !== null}
        onClose={() => setPreview(null)}
        size="lg"
        title="Preview do draft"
      >
        <pre className="commercial-preview">{JSON.stringify(preview, null, 2)}</pre>
        <p className="muted">Preview retornado pelo backend; nenhuma publicação foi realizada.</p>
      </Modal>
    </section>
  );
}

function CommercialCatalog({
  draft,
  setDraft,
}: {
  draft: CommercialDraft;
  setDraft: (draft: CommercialDraft) => void;
}) {
  const update = (index: number, patch: Partial<CommercialPlan>) =>
    setDraft({
      ...draft,
      plans: draft.plans.map((plan, current) => (current === index ? { ...plan, ...patch } : plan)),
    });
  return (
    <div className="commercial-grid">
      {draft.plans.map((plan, index) => {
        const explicitDoseClub = plan.entitlements.includes("doseclub.subscription");
        const inheritedDoseClub =
          !explicitDoseClub &&
          plan.entitlements.some(
            (entitlement) => entitlement === "doseclub" || entitlement === "bundle",
          );
        return (
          <Card className="commercial-editor" key={plan.id}>
            <div className="section-title">
              <div>
                <p className="eyebrow">Plano {plan.slug}</p>
                <h3>{plan.name}</h3>
              </div>
              <Badge tone="info">{centsToBrl(plan.monthlyPriceCents)} / mês</Badge>
            </div>
            <label htmlFor={`plan-name-${plan.id}`}>Nome</label>
            <Input
              id={`plan-name-${plan.id}`}
              onChange={(event) => update(index, { name: event.target.value })}
              value={plan.name}
            />
            <label htmlFor={`plan-description-${plan.id}`}>Descrição</label>
            <Textarea
              id={`plan-description-${plan.id}`}
              onChange={(event) => update(index, { description: event.target.value })}
              value={plan.description}
            />
            <div className="commercial-fields">
              <label htmlFor={`plan-monthly-${plan.id}`}>
                Mensal (R$)
                <Input
                  id={`plan-monthly-${plan.id}`}
                  inputMode="decimal"
                  onChange={(event) => {
                    try {
                      update(index, { monthlyPriceCents: brlToCents(event.target.value) });
                    } catch {
                      /* validação nativa no blur */
                    }
                  }}
                  defaultValue={(plan.monthlyPriceCents / 100).toFixed(2).replace(".", ",")}
                />
              </label>
              <label htmlFor={`plan-annual-${plan.id}`}>
                Anual (R$)
                <Input
                  id={`plan-annual-${plan.id}`}
                  inputMode="decimal"
                  onChange={(event) => {
                    try {
                      update(index, { annualPriceCents: brlToCents(event.target.value) });
                    } catch {
                      /* validação nativa no blur */
                    }
                  }}
                  defaultValue={(plan.annualPriceCents / 100).toFixed(2).replace(".", ",")}
                />
              </label>
              <label htmlFor={`plan-units-${plan.id}`}>
                Unidades incluídas
                <Input
                  id={`plan-units-${plan.id}`}
                  min={1}
                  onChange={(event) => update(index, { includedUnits: Number(event.target.value) })}
                  type="number"
                  value={plan.includedUnits}
                />
              </label>
            </div>
            <label className="commercial-entitlement" htmlFor={`plan-doseclub-${plan.id}`}>
              <input
                checked={explicitDoseClub || inheritedDoseClub}
                disabled={inheritedDoseClub}
                id={`plan-doseclub-${plan.id}`}
                onChange={(event) =>
                  update(index, {
                    entitlements: toggleCommercialEntitlement(
                      plan.entitlements,
                      "doseclub.subscription",
                      event.target.checked,
                    ),
                  })
                }
                type="checkbox"
              />
              <span>
                <strong>DoseClub</strong>
                <small>
                  {inheritedDoseClub
                    ? "Incluído por bundle ou entitlement legado; ajuste essa origem para remover."
                    : commercialEntitlementLabels["doseclub.subscription"]}
                </small>
              </span>
            </label>
          </Card>
        );
      })}
    </div>
  );
}

function CommercialPromotions({
  draft,
  setDraft,
}: {
  draft: CommercialDraft;
  setDraft: (draft: CommercialDraft) => void;
}) {
  const update = (index: number, patch: Partial<CommercialPromotion>) =>
    setDraft({
      ...draft,
      promotions: draft.promotions.map((promotion, current) =>
        current === index ? { ...promotion, ...patch } : promotion,
      ),
    });
  return (
    <Card className="commercial-editor">
      <div className="section-title">
        <div>
          <p className="eyebrow">Promoções</p>
          <h3>Vigência e elegibilidade</h3>
        </div>
        <Badge tone="info">{draft.promotions.length}</Badge>
      </div>
      {draft.promotions.length ? (
        <div className="platform-list">
          {draft.promotions.map((promotion, index) => (
            <fieldset className="commercial-promotion" key={promotion.id}>
              <legend>{promotion.name}</legend>
              <div className="commercial-fields">
                <label htmlFor={`promotion-name-${promotion.id}`}>
                  Nome
                  <Input
                    id={`promotion-name-${promotion.id}`}
                    onChange={(event) => update(index, { name: event.target.value })}
                    value={promotion.name}
                  />
                </label>
                <label htmlFor={`promotion-type-${promotion.id}`}>
                  Tipo
                  <NativeSelect
                    id={`promotion-type-${promotion.id}`}
                    onChange={(event) =>
                      update(index, { type: event.target.value as CommercialPromotion["type"] })
                    }
                    value={promotion.type}
                  >
                    <option value="percentage">Percentual</option>
                    <option value="fixed">Valor fixo</option>
                    <option value="price">Preço promocional</option>
                  </NativeSelect>
                </label>
                <label htmlFor={`promotion-value-${promotion.id}`}>
                  {promotion.type === "percentage" ? "Percentual (basis points)" : "Valor (R$)"}
                  <Input
                    id={`promotion-value-${promotion.id}`}
                    min={0}
                    onChange={(event) =>
                      update(index, {
                        value:
                          promotion.type === "percentage"
                            ? Number(event.target.value)
                            : brlToCents(event.target.value),
                      })
                    }
                    type="number"
                    value={
                      promotion.type === "percentage" ? promotion.value : promotion.value / 100
                    }
                  />
                </label>
                <label htmlFor={`promotion-start-${promotion.id}`}>
                  Início
                  <Input
                    id={`promotion-start-${promotion.id}`}
                    onChange={(event) =>
                      update(index, { startsAt: new Date(event.target.value).toISOString() })
                    }
                    type="datetime-local"
                  />
                </label>
                <label htmlFor={`promotion-end-${promotion.id}`}>
                  Fim
                  <Input
                    id={`promotion-end-${promotion.id}`}
                    onChange={(event) =>
                      update(index, { endsAt: new Date(event.target.value).toISOString() })
                    }
                    type="datetime-local"
                  />
                </label>
                <label htmlFor={`promotion-plans-${promotion.id}`}>
                  Planos elegíveis
                  <Input
                    id={`promotion-plans-${promotion.id}`}
                    onChange={(event) =>
                      update(index, {
                        planSlugs: event.target.value
                          .split(",")
                          .map((item) => item.trim())
                          .filter(Boolean),
                      })
                    }
                    value={promotion.planSlugs.join(", ")}
                  />
                </label>
              </div>
            </fieldset>
          ))}
        </div>
      ) : (
        <EmptyState
          description="O draft não possui promoções persistidas."
          icon="◇"
          title="Sem promoções"
        />
      )}
    </Card>
  );
}

function CommercialLanding({
  canMedia,
  draft,
  media,
  setDraft,
  mediaFile,
  mediaPreview,
  setMediaFile,
  mediaAlt,
  setMediaAlt,
  mediaReason,
  setMediaReason,
  mediaConfirmed,
  setMediaConfirmed,
  uploadMedia,
  busy,
}: {
  canMedia: boolean;
  draft: CommercialDraft;
  media: CommercialOverview["media"];
  setDraft: (draft: CommercialDraft) => void;
  mediaFile: File | null;
  mediaPreview: string | null;
  setMediaFile: (file: File | null) => void;
  mediaAlt: string;
  setMediaAlt: (value: string) => void;
  mediaReason: string;
  setMediaReason: (value: string) => void;
  mediaConfirmed: boolean;
  setMediaConfirmed: (value: boolean) => void;
  uploadMedia: (event: FormEvent) => void;
  busy: boolean;
}) {
  const blocks = commercialLandingBlocks(draft.landing);
  const updateBlock = (index: number, patch: Partial<CommercialBlock>) =>
    setDraft({
      ...draft,
      landing: updateCommercialLandingBlock(draft.landing, blocks[index], patch),
    });
  return (
    <div className="commercial-grid">
      <Card className="commercial-editor">
        <SectionTitle eyebrow="Landing" title="Blocos fixos" />
        <p className="muted">Somente campos estruturados; HTML arbitrário não é aceito.</p>
        {blocks.map((block, index) => (
          <fieldset className="commercial-promotion" key={block.key}>
            <legend>{block.type}</legend>
            <label htmlFor={`landing-${block.key}-title`}>
              Título
              <Input
                id={`landing-${block.key}-title`}
                onChange={(event) => updateBlock(index, { title: event.target.value })}
                value={block.title}
              />
            </label>
            <label htmlFor={`landing-${block.key}-body`}>
              Texto
              <Textarea
                id={`landing-${block.key}-body`}
                onChange={(event) => updateBlock(index, { body: event.target.value })}
                value={block.body}
              />
            </label>
            <label htmlFor={`landing-${block.key}-media`}>
              Mídia
              <NativeSelect
                id={`landing-${block.key}-media`}
                onChange={(event) => updateBlock(index, { mediaId: event.target.value || null })}
                value={block.mediaId ?? ""}
              >
                <option value="">Sem imagem</option>
                {media.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.alt}
                  </option>
                ))}
              </NativeSelect>
            </label>
          </fieldset>
        ))}
      </Card>
      <Card className="commercial-editor">
        <SectionTitle eyebrow="SEO" title="Metadados" />
        <label htmlFor="commercial-seo-title">
          Título
          <Input
            id="commercial-seo-title"
            onChange={(event) =>
              setDraft({ ...draft, seo: { ...draft.seo, title: event.target.value } })
            }
            value={draft.seo.title}
          />
        </label>
        <label htmlFor="commercial-seo-description">
          Descrição
          <Textarea
            id="commercial-seo-description"
            onChange={(event) =>
              setDraft({ ...draft, seo: { ...draft.seo, description: event.target.value } })
            }
            value={draft.seo.description}
          />
        </label>
        <label htmlFor="commercial-seo-media">
          Imagem social
          <NativeSelect
            id="commercial-seo-media"
            onChange={(event) =>
              setDraft({ ...draft, seo: { ...draft.seo, ogMediaId: event.target.value || null } })
            }
            value={draft.seo.ogMediaId ?? ""}
          >
            <option value="">Sem imagem</option>
            {media.map((item) => (
              <option key={item.id} value={item.id}>
                {item.alt}
              </option>
            ))}
          </NativeSelect>
        </label>
      </Card>
      {canMedia && (
        <Card className="commercial-editor">
          <SectionTitle eyebrow="Biblioteca" title="Enviar imagem" />
          <form className="platform-action-form" onSubmit={uploadMedia}>
            <label htmlFor="commercial-media-file">JPEG, PNG ou WebP · até 2 MB</label>
            <Input
              accept="image/jpeg,image/png,image/webp"
              id="commercial-media-file"
              onChange={(event) => {
                const file = event.target.files?.[0] ?? null;
                if (file && (!allowedMediaType(file.type) || file.size > 2_000_000)) {
                  event.target.value = "";
                  setMediaFile(null);
                  return;
                }
                setMediaFile(file);
              }}
              required
              type="file"
            />
            {mediaPreview && (
              <img
                alt="Prévia local não persistida"
                className="commercial-media-preview"
                src={mediaPreview}
              />
            )}
            <small>Prévia local; o endereço só existirá após a confirmação do sistema.</small>
            <label htmlFor="commercial-media-alt">Texto alternativo</label>
            <Input
              id="commercial-media-alt"
              minLength={3}
              onChange={(event) => setMediaAlt(event.target.value)}
              required
              value={mediaAlt}
            />
            <label htmlFor="commercial-media-reason">Motivo</label>
            <Textarea
              id="commercial-media-reason"
              minLength={8}
              onChange={(event) => setMediaReason(event.target.value)}
              required
              value={mediaReason}
            />
            <label className="platform-confirm" htmlFor="commercial-media-confirm">
              <Input
                checked={mediaConfirmed}
                id="commercial-media-confirm"
                onChange={(event) => setMediaConfirmed(event.target.checked)}
                required
                type="checkbox"
              />
              Confirmo direitos de uso e publicação.
            </label>
            <Button disabled={busy || !mediaFile || !mediaConfirmed} type="submit">
              Persistir imagem
            </Button>
          </form>
        </Card>
      )}
    </div>
  );
}

function CommercialLeads({
  canMetrics,
  canWrite,
  campaigns,
  funnel,
  input,
  setInput,
  stage: stageFilter,
  setStageFilter,
  assignee: assigneeFilter,
  setAssigneeFilter,
  type,
  setType,
  submit,
  remote,
}: {
  canMetrics: boolean;
  canWrite: boolean;
  campaigns: CommercialOverview["campaigns"];
  funnel: CommercialOverview["funnel"];
  input: string;
  setInput: (value: string) => void;
  stage: string;
  setStageFilter: (value: string) => void;
  assignee: string;
  setAssigneeFilter: (value: string) => void;
  type: string;
  setType: (value: string) => void;
  submit: (event: FormEvent) => void;
  remote: RemoteResult<CommercialLeadList>;
}) {
  const [target, setTarget] = useState<CommercialLeadList["items"][number] | null>(null);
  const [stage, setStage] = useState<"new" | "qualified" | "contacted" | "converted" | "lost">(
    "new",
  );
  const [assignee, setAssignee] = useState("");
  const [organizationId, setOrganizationId] = useState("");
  const [reason, setReason] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [campaignId, setCampaignId] = useState<string | null>(null);
  const [campaignName, setCampaignName] = useState("");
  const [campaignSlug, setCampaignSlug] = useState("");
  const [campaignReason, setCampaignReason] = useState("");
  async function updateLead(event: FormEvent) {
    event.preventDefault();
    if (!target || reason.trim().length < 8 || !confirmed) return;
    setBusy(true);
    try {
      await platformApi.updateCommercialLead(target.type as "trial" | "contact", target.id, {
        reason: reason.trim(),
        stage,
        assignedToIdentityId: assignee.trim() || null,
        organizationId: organizationId.trim() || null,
      });
      setTarget(null);
      setReason("");
      setConfirmed(false);
      remote.retry();
    } finally {
      setBusy(false);
    }
  }
  async function saveCampaign(event: FormEvent) {
    event.preventDefault();
    if (campaignReason.trim().length < 8) return;
    setBusy(true);
    try {
      const body = {
        reason: campaignReason.trim(),
        slug: campaignSlug.trim(),
        name: campaignName.trim(),
        status: "draft",
      };
      if (campaignId) await platformApi.updateCommercialCampaign(campaignId, body);
      else await platformApi.createCommercialCampaign(body);
      setCampaignId(null);
      setCampaignName("");
      setCampaignSlug("");
      setCampaignReason("");
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="commercial-grid">
      <Card className="commercial-editor">
        <SectionTitle eyebrow="Leads" title="Pipeline comercial" />
        <search>
          <form className="platform-search" onSubmit={submit}>
            <label htmlFor="commercial-lead-search">Nome, contato ou empresa</label>
            <div>
              <Input
                id="commercial-lead-search"
                onChange={(event) => setInput(event.target.value)}
                type="search"
                value={input}
              />
              <NativeSelect
                aria-label="Tipo do lead"
                onChange={(event) => setType(event.target.value)}
                value={type}
              >
                <option value="">Todos</option>
                <option value="trial">Teste</option>
                <option value="contact">Contato</option>
              </NativeSelect>
              <NativeSelect
                aria-label="Estágio do lead"
                onChange={(event) => setStageFilter(event.target.value)}
                value={stageFilter}
              >
                <option value="">Todos os estágios</option>
                <option value="new">Novo</option>
                <option value="qualified">Qualificado</option>
                <option value="contacted">Contatado</option>
                <option value="converted">Convertido</option>
                <option value="lost">Perdido</option>
              </NativeSelect>
              <Input
                aria-label="ID do responsável"
                onChange={(event) => setAssigneeFilter(event.target.value)}
                placeholder="Responsável (ID)"
                value={assigneeFilter}
              />
              <Button size="sm" type="submit">
                Filtrar
              </Button>
            </div>
          </form>
        </search>
        <RemoteMessage label="leads" retry={remote.retry} state={remote.state} />
        {remote.state.status === "ready" && (
          <>
            {canMetrics && funnel.stages.length > 0 && (
              <div className="commercial-funnel">
                {funnel.stages.map((item) => (
                  <span key={item.stage}>
                    <strong>{item.count}</strong>
                    <small>{item.stage}</small>
                  </span>
                ))}
              </div>
            )}
            {canMetrics && funnel.status === "partial" && (
              <div className="platform-status" role="alert">
                Funil parcial: {funnel.reason ?? "fonte indisponível"}. Conversões não são inferidas
                por e-mail.
              </div>
            )}
            {remote.state.data.partialSources.length > 0 && (
              <StatusNotice
                lastSuccessfulAt={remote.lastSuccessfulAt}
                partialSources={remote.state.data.partialSources}
                refreshError={remote.refreshError}
                updating={remote.updating}
              />
            )}
            {remote.state.data.items.length ? (
              <div className="platform-list">
                {remote.state.data.items.map((lead) => (
                  <article className="data-row" key={lead.id}>
                    <div>
                      <strong>{lead.name}</strong>
                      <small>
                        {lead.email ?? "e-mail indisponível"} ·{" "}
                        {lead.phone ?? "telefone indisponível"}
                      </small>
                      <small>
                        {lead.type} · etapa {lead.stage}
                        {lead.assignedTo ? ` · ${lead.assignedTo}` : " · sem responsável"}
                      </small>
                    </div>
                    <div className="platform-row-actions">
                      <Badge tone="info">{dateTime(lead.createdAt)}</Badge>
                      <Button
                        onClick={() => {
                          setTarget(lead);
                          setStage(lead.stage as typeof stage);
                          setAssignee(lead.assignedTo ?? "");
                          setOrganizationId(lead.organizationId ?? "");
                        }}
                        size="sm"
                        type="button"
                        variant="secondary"
                      >
                        Atualizar lead
                      </Button>
                    </div>
                  </article>
                ))}
              </div>
            ) : (
              <EmptyState
                description="Nenhum lead corresponde aos filtros confirmados."
                icon="◇"
                title="Sem leads"
              />
            )}
          </>
        )}
      </Card>
      <Card className="commercial-editor">
        <SectionTitle eyebrow="Campanhas" title="Campanhas persistidas" />
        {canWrite && (
          <form className="platform-action-form" onSubmit={saveCampaign}>
            <label htmlFor="commercial-campaign-name">
              Nome
              <Input
                id="commercial-campaign-name"
                onChange={(event) => setCampaignName(event.target.value)}
                required
                value={campaignName}
              />
            </label>
            <label htmlFor="commercial-campaign-slug">
              Slug
              <Input
                id="commercial-campaign-slug"
                pattern="[a-z0-9]+(?:-[a-z0-9]+)*"
                onChange={(event) => setCampaignSlug(event.target.value)}
                required
                value={campaignSlug}
              />
            </label>
            <label htmlFor="commercial-campaign-reason">
              Motivo
              <Textarea
                id="commercial-campaign-reason"
                minLength={8}
                onChange={(event) => setCampaignReason(event.target.value)}
                required
                value={campaignReason}
              />
            </label>
            <Button disabled={busy || campaignReason.trim().length < 8} size="sm" type="submit">
              {campaignId ? "Salvar campanha" : "Criar campanha"}
            </Button>
          </form>
        )}
        {campaigns.length ? (
          <div className="platform-list">
            {campaigns.map((campaign) => (
              <article className="data-row" key={campaign.id}>
                <div>
                  <strong>{campaign.name}</strong>
                  <small>
                    {campaign.slug} ·{" "}
                    {campaign.startsAt ? dateTime(campaign.startsAt) : "sem início definido"}
                  </small>
                </div>
                <Badge tone={campaign.status === "sent" ? "success" : "neutral"}>
                  {campaign.status}
                </Badge>
                {canWrite && (
                  <Button
                    onClick={() => {
                      setCampaignId(campaign.id);
                      setCampaignName(campaign.name);
                      setCampaignSlug(campaign.slug);
                    }}
                    size="sm"
                    type="button"
                    variant="ghost"
                  >
                    Editar
                  </Button>
                )}
              </article>
            ))}
          </div>
        ) : (
          <EmptyState
            description="Crie campanhas somente quando segmento e conteúdo estiverem definidos."
            icon="◇"
            title="Sem campanhas"
          />
        )}
      </Card>
      <Modal
        description="Estágio, responsável e vínculo de tenant são persistidos e auditados."
        isOpen={target !== null}
        onClose={() => !busy && setTarget(null)}
        size="sm"
        title="Atualizar lead"
      >
        <form className="platform-action-form" onSubmit={updateLead}>
          <label htmlFor="commercial-lead-stage">
            Estágio
            <NativeSelect
              id="commercial-lead-stage"
              onChange={(event) => setStage(event.target.value as typeof stage)}
              value={stage}
            >
              <option value="new">Novo</option>
              <option value="qualified">Qualificado</option>
              <option value="contacted">Contatado</option>
              <option value="converted">Convertido</option>
              <option value="lost">Perdido</option>
            </NativeSelect>
          </label>
          <label htmlFor="commercial-lead-assignee">
            Responsável (ID)
            <Input
              id="commercial-lead-assignee"
              onChange={(event) => setAssignee(event.target.value)}
              value={assignee}
            />
          </label>
          <label htmlFor="commercial-lead-organization">
            Tenant convertido (ID){stage !== "converted" && " · opcional"}
            <Input
              id="commercial-lead-organization"
              onChange={(event) => setOrganizationId(event.target.value)}
              required={stage === "converted"}
              value={organizationId}
            />
          </label>
          <label htmlFor="commercial-lead-reason">
            Motivo
            <Textarea
              id="commercial-lead-reason"
              minLength={8}
              onChange={(event) => setReason(event.target.value)}
              required
              value={reason}
            />
          </label>
          <label className="platform-confirm" htmlFor="commercial-lead-confirm">
            <Input
              checked={confirmed}
              id="commercial-lead-confirm"
              onChange={(event) => setConfirmed(event.target.checked)}
              required
              type="checkbox"
            />
            Confirmo a atualização auditada.
          </label>
          <Button disabled={busy || !confirmed || reason.trim().length < 8} type="submit">
            Salvar lead
          </Button>
        </form>
      </Modal>
    </div>
  );
}

function commercialActionLabel(
  action: "create" | "save" | "approve" | "publish" | "rollback" | null,
) {
  return action
    ? {
        create: "Criar draft",
        save: "Salvar draft",
        approve: "Solicitar / aprovar",
        publish: "Publicar / agendar",
        rollback: "Restaurar versão publicada",
      }[action]
    : "Ação comercial";
}
function allowedMediaType(value: string): value is "image/jpeg" | "image/png" | "image/webp" {
  return ["image/jpeg", "image/png", "image/webp"].includes(value);
}

function commercialLandingBlocks(landing: Row): CommercialBlock[] {
  const hero = record(landing.hero);
  const finalCta = record(landing.finalCta);
  return [
    {
      key: "hero",
      type: "hero",
      title: text(hero.title),
      body: text(hero.description),
      mediaId: optionalText(hero.mediaId),
    },
    {
      key: "finalCta",
      type: "cta",
      title: text(finalCta.title),
      body: text(finalCta.description),
      mediaId: null,
    },
  ];
}

function updateCommercialLandingBlock(
  landing: Row,
  block: CommercialBlock | undefined,
  patch: Partial<CommercialBlock>,
): Row {
  if (!block) return landing;
  const current = record(landing[block.key]);
  return {
    ...landing,
    [block.key]: {
      ...current,
      ...(patch.title !== undefined ? { title: patch.title } : {}),
      ...(patch.body !== undefined ? { description: patch.body } : {}),
      ...(block.key === "hero" && patch.mediaId !== undefined
        ? {
            ...(patch.mediaId ? { mediaId: patch.mediaId } : {}),
            mediaId: patch.mediaId ?? undefined,
          }
        : {}),
    },
  };
}
async function fileBase64(file: File): Promise<string> {
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Não foi possível ler a imagem."));
    reader.onload = () => resolve(String(reader.result));
    reader.readAsDataURL(file);
  });
  return dataUrl.slice(dataUrl.indexOf(",") + 1);
}

function TenantSearchPanel({
  canCreate,
  history,
  input,
  remote,
  selectedTenantId,
  setCursor,
  setHistory,
  setInput,
  setSelectedTenantId,
  setStatus,
  startCreate,
  status,
  submit,
  tenantCursor,
}: {
  canCreate: boolean;
  history: Array<string | undefined>;
  input: string;
  remote: RemoteResult<TenantList>;
  selectedTenantId: string | null;
  setCursor: (value: string | undefined) => void;
  setHistory: React.Dispatch<React.SetStateAction<Array<string | undefined>>>;
  setInput: (value: string) => void;
  setSelectedTenantId: (value: string) => void;
  setStatus: (value: string) => void;
  startCreate: () => void;
  status: string;
  submit: (event: FormEvent) => void;
  tenantCursor: string | undefined;
}) {
  return (
    <Card className="platform-panel">
      <div className="section-title">
        <div>
          <p className="eyebrow">Busca global</p>
          <h2>Tenants</h2>
        </div>
        <div className="platform-header__actions">
          {remote.state.status === "ready" && (
            <Badge tone="info">Página {history.length + 1}</Badge>
          )}
          {canCreate && (
            <Button onClick={startCreate} size="sm" type="button">
              Cadastrar cliente piloto
            </Button>
          )}
        </div>
      </div>
      <search aria-label="Buscar tenants">
        <form className="platform-search" onSubmit={submit}>
          <label htmlFor="platform-tenant-search">Nome, CNPJ, e-mail ou ID</label>
          <div>
            <Input
              id="platform-tenant-search"
              onChange={(event) => setInput(event.target.value)}
              placeholder="Buscar tenant"
              type="search"
              value={input}
            />
            <NativeSelect
              aria-label="Situação do tenant"
              onChange={(event) => {
                setStatus(event.target.value);
                setHistory([]);
                setCursor(undefined);
              }}
              value={status}
            >
              <option value="active">Ativos</option>
              <option value="trial_active">Em teste</option>
              <option value="restricted">Restritos</option>
              <option value="suspended">Suspensos</option>
              <option value="all">Todos</option>
            </NativeSelect>
            <Button size="sm" type="submit">
              Buscar
            </Button>
          </div>
        </form>
      </search>
      <RemoteMessage label="tenants" retry={remote.retry} state={remote.state} />
      {remote.state.status === "ready" && (
        <>
          {(remote.updating || remote.stale || remote.state.data.partialSources.length > 0) && (
            <StatusNotice
              lastSuccessfulAt={remote.lastSuccessfulAt}
              partialSources={remote.state.data.partialSources}
              refreshError={remote.refreshError}
              updating={remote.updating}
            />
          )}
          {remote.state.data.items.length ? (
            <div className="platform-list">
              {remote.state.data.items.map((item) => (
                <button
                  aria-pressed={selectedTenantId === item.id}
                  className="platform-tenant-row"
                  key={item.id}
                  onClick={() => {
                    setSelectedTenantId(item.id);
                  }}
                  type="button"
                >
                  <span>
                    <strong>{item.name}</strong>
                    <small>
                      {maskDocument(item.document)} · {item.legalName}
                    </small>
                    <small>
                      {item.unitCount} unidade(s) · criada em {dateTime(item.createdAt)}
                    </small>
                  </span>
                  <span>
                    <Badge tone={billingTone(item.billingState)}>{item.billingState}</Badge>
                    <small>Alterado {dateTime(item.billingStateChangedAt)}</small>
                  </span>
                </button>
              ))}
            </div>
          ) : (
            <EmptyState
              description="Revise o termo ou altere o filtro de situação."
              icon="◇"
              title="Nenhum tenant encontrado"
            />
          )}
          <Pagination
            canNext={remote.state.data.nextCursor !== null}
            canPrevious={history.length > 0}
            next={() => {
              const nextCursor =
                remote.state.status === "ready" ? remote.state.data.nextCursor : null;
              if (!nextCursor) return;
              setHistory((current) => [...current, tenantCursor]);
              setCursor(nextCursor);
            }}
            previous={() => {
              const previousCursor = history.at(-1);
              setHistory((current) => current.slice(0, -1));
              setCursor(previousCursor);
            }}
          />
        </>
      )}
    </Card>
  );
}

function IncidentPanel({
  canManage,
  canRetry,
  history,
  input,
  incidentCursor,
  remote,
  setActionTarget,
  setCursor,
  setHistory,
  setInput,
  setStatus,
  status,
  submit,
}: {
  canManage: boolean;
  canRetry: boolean;
  history: Array<string | undefined>;
  input: string;
  incidentCursor: string | undefined;
  remote: RemoteResult<IncidentList>;
  setActionTarget: (value: {
    incident: PlatformIncident;
    action: IncidentAction | "retry";
  }) => void;
  setCursor: (value: string | undefined) => void;
  setHistory: React.Dispatch<React.SetStateAction<Array<string | undefined>>>;
  setInput: (value: string) => void;
  setStatus: (value: string) => void;
  status: string;
  submit: (event: FormEvent) => void;
}) {
  return (
    <Card className="platform-panel platform-incidents">
      <div className="section-title">
        <div>
          <p className="eyebrow">Fila operacional</p>
          <h2>Incidentes</h2>
        </div>
        {remote.state.status === "ready" && (
          <Badge tone={remote.state.data.items.length ? "warning" : "success"}>
            {remote.state.data.items.length
              ? `${remote.state.data.items.length} nesta página`
              : "Em dia"}
          </Badge>
        )}
      </div>
      <search aria-label="Buscar incidentes">
        <form className="platform-search" onSubmit={submit}>
          <label htmlFor="platform-incident-search">Tenant, erro ou categoria</label>
          <div>
            <Input
              id="platform-incident-search"
              onChange={(event) => setInput(event.target.value)}
              placeholder="Buscar incidente"
              type="search"
              value={input}
            />
            <NativeSelect
              aria-label="Situação do incidente"
              onChange={(event) => {
                setStatus(event.target.value);
                setHistory([]);
                setCursor(undefined);
              }}
              value={status}
            >
              <option value="open">Abertos</option>
              <option value="claimed">Em atendimento</option>
              <option value="snoozed">Adiados</option>
              <option value="resolved">Resolvidos</option>
              <option value="all">Todos</option>
            </NativeSelect>
            <Button size="sm" type="submit">
              Buscar
            </Button>
          </div>
        </form>
      </search>
      <RemoteMessage label="incidentes" retry={remote.retry} state={remote.state} />
      {remote.state.status === "ready" && (
        <>
          {(remote.updating || remote.stale || remote.state.data.partialSources.length > 0) && (
            <StatusNotice
              lastSuccessfulAt={remote.lastSuccessfulAt}
              partialSources={remote.state.data.partialSources}
              refreshError={remote.refreshError}
              updating={remote.updating}
            />
          )}
          {remote.state.data.items.length ? (
            <div className="platform-list">
              {remote.state.data.items.map((incident) => (
                <article className="platform-incident-row" key={incident.id}>
                  <span
                    aria-label={`Severidade ${incident.severityLabel}`}
                    className={`platform-severity platform-severity--${incident.severity}`}
                    role="img"
                  />
                  <div>
                    <strong>{incident.title}</strong>
                    <small>
                      {incident.organizationName} · {incident.category} ·{" "}
                      {dateTime(incident.createdAt)}
                    </small>
                    <p>{incident.detail}</p>
                    <small>Aberto há {durationMinutes(incident.ageMinutes)}</small>
                    {incident.assignedTo && <small>Responsável: {incident.assignedTo}</small>}
                    {incident.snoozedUntil && (
                      <small>Adiado até {dateTime(incident.snoozedUntil)}</small>
                    )}
                  </div>
                  <div className="platform-row-actions">
                    <Badge tone={incident.severity}>{incidentStatus(incident.status)}</Badge>
                    {canManage && incident.status !== "resolved" && (
                      <>
                        <Button
                          onClick={() => setActionTarget({ incident, action: "claim" })}
                          size="sm"
                          type="button"
                          variant="secondary"
                        >
                          Assumir
                        </Button>
                        <Button
                          onClick={() => setActionTarget({ incident, action: "snooze" })}
                          size="sm"
                          type="button"
                          variant="ghost"
                        >
                          Adiar
                        </Button>
                        <Button
                          onClick={() => setActionTarget({ incident, action: "resolve" })}
                          size="sm"
                          type="button"
                          variant="ghost"
                        >
                          Resolver
                        </Button>
                      </>
                    )}
                    {canRetry && incident.outboxEventId && (
                      <Button
                        onClick={() => setActionTarget({ incident, action: "retry" })}
                        size="sm"
                        type="button"
                        variant="secondary"
                      >
                        Reprocessar
                      </Button>
                    )}
                  </div>
                </article>
              ))}
            </div>
          ) : (
            <EmptyState
              description={
                remote.state.data.partialSources.length
                  ? "Há fontes indisponíveis; a ausência de itens não está confirmada."
                  : "Nenhum incidente corresponde aos filtros atuais."
              }
              icon="✓"
              title={
                remote.state.data.partialSources.length
                  ? "Fila parcialmente disponível"
                  : "Fila em dia"
              }
            />
          )}
          <Pagination
            canNext={remote.state.data.nextCursor !== null}
            canPrevious={history.length > 0}
            next={() => {
              const nextCursor =
                remote.state.status === "ready" ? remote.state.data.nextCursor : null;
              if (!nextCursor) return;
              setHistory((current) => [...current, incidentCursor]);
              setCursor(nextCursor);
            }}
            previous={() => {
              const previousCursor = history.at(-1);
              setHistory((current) => current.slice(0, -1));
              setCursor(previousCursor);
            }}
          />
        </>
      )}
    </Card>
  );
}

function StatusNotice({
  lastSuccessfulAt,
  partialSources,
  refreshError,
  updating,
}: {
  lastSuccessfulAt: string | null;
  partialSources: string[];
  refreshError: string | null;
  updating: boolean;
}) {
  const stale = refreshError !== null;
  return (
    <div
      className="platform-status gm-observability-row"
      role={stale || partialSources.length ? "alert" : "status"}
    >
      <Badge tone={stale || partialSources.length ? "warning" : "info"}>
        {updating ? "Atualizando" : stale ? "Dados desatualizados" : "Dados parciais"}
      </Badge>
      <span>
        {updating
          ? "A última resposta confirmada permanece visível."
          : stale
            ? `${refreshError} Última confirmação: ${dateTime(lastSuccessfulAt)}.`
            : `Fontes indisponíveis: ${partialSources.join(", ")}.`}
      </span>
    </div>
  );
}

function Pagination({
  canNext,
  canPrevious,
  next,
  previous,
}: {
  canNext: boolean;
  canPrevious: boolean;
  next: () => void;
  previous: () => void;
}) {
  if (!canNext && !canPrevious) return null;
  return (
    <nav aria-label="Paginação" className="platform-pagination">
      <Button disabled={!canPrevious} onClick={previous} size="sm" type="button" variant="ghost">
        Anterior
      </Button>
      <Button disabled={!canNext} onClick={next} size="sm" type="button" variant="secondary">
        Próxima
      </Button>
    </nav>
  );
}

function TenantWorkspace({
  canGrantPilotAccess,
  canRevealPii,
  data,
  loadingState,
  onGrantPilotAccess,
  onReveal,
  pii,
  retry,
  selected,
  stale,
  updating,
}: {
  canGrantPilotAccess: boolean;
  canRevealPii: boolean;
  data: TenantDetail | null;
  loadingState: RemoteState<TenantDetail | null> | null;
  onGrantPilotAccess: () => void;
  onReveal: () => void;
  pii: TenantPii | null;
  retry: () => void;
  selected: boolean;
  stale: boolean;
  updating: boolean;
}) {
  if (!selected)
    return (
      <Card className="platform-tenant-empty">
        <EmptyState
          description="Use a busca global e selecione uma organização para abrir assinatura, onboarding, saúde e auditoria."
          icon="◎"
          title="Selecione um tenant"
        />
      </Card>
    );
  if (loadingState?.status !== "ready" || !data)
    return (
      <Card className="platform-tenant-empty">
        <RemoteMessage
          label="visão 360 do tenant"
          retry={retry}
          state={loadingState ?? { status: "loading" }}
        />
      </Card>
    );
  return (
    <section aria-labelledby="platform-tenant-title" className="platform-tenant-workspace">
      <Card className="platform-tenant-heading">
        <div>
          <p className="eyebrow">Visão 360 do tenant</p>
          <h2 id="platform-tenant-title">{data.name}</h2>
          <p>
            {data.id} · criado em {dateTime(data.createdAt)}
          </p>
        </div>
        <div className="platform-header__actions">
          <Badge tone={billingTone(data.billingState)}>{data.billingState}</Badge>
          {canGrantPilotAccess && data.billingState === "trial_active" && (
            <Button onClick={onGrantPilotAccess} size="sm" type="button">
              Conceder 6 meses
            </Button>
          )}
          {canRevealPii && !pii && (
            <Button onClick={onReveal} size="sm" type="button" variant="secondary">
              Revelar dados
            </Button>
          )}
          {pii && <Badge tone="warning">PII revelada · acesso auditado</Badge>}
        </div>
      </Card>
      {(updating || stale || data.partialSources.length > 0) && (
        <StatusNotice
          lastSuccessfulAt={null}
          partialSources={data.partialSources}
          refreshError={stale ? "Não foi possível atualizar o tenant." : null}
          updating={updating}
        />
      )}
      <div className="platform-detail-grid">
        <Card>
          <SectionTitle eyebrow="Cadastro" title="Identificação" />
          <dl className="platform-definition-list">
            <div>
              <dt>Razão social</dt>
              <dd>{data.legalName}</dd>
            </div>
            <div>
              <dt>CNPJ</dt>
              <dd>{pii?.document ?? maskDocument(data.document)}</dd>
            </div>
            <div>
              <dt>E-mail de membro</dt>
              <dd>{pii?.email ?? "Mascarado por padrão"}</dd>
            </div>
            <div>
              <dt>Unidades</dt>
              <dd>{data.unitCount}</dd>
            </div>
          </dl>
        </Card>
        <Card className="platform-billing">
          <SectionTitle eyebrow="Assinatura GiroMesa" title="Cobrança do assinante" />
          <p className="platform-boundary">
            Separada do Financeiro e do caixa operacional do restaurante.
          </p>
          <dl className="platform-definition-list">
            <div>
              <dt>Plano</dt>
              <dd>{data.billing.planSlug ?? "Não informado"}</dd>
            </div>
            <div>
              <dt>Situação</dt>
              <dd>{data.billing.status}</dd>
            </div>
            <div>
              <dt>Provedor</dt>
              <dd>{data.billing.provider ?? "Não informado"}</dd>
            </div>
            <div>
              <dt>Próxima cobrança</dt>
              <dd>{dateTime(data.billing.nextChargeAt)}</dd>
            </div>
            {data.billing.pilotEndsAt && (
              <div>
                <dt>Acesso piloto até</dt>
                <dd>{dateTime(data.billing.pilotEndsAt)}</dd>
              </div>
            )}
            {data.billing.delinquentSince && (
              <div>
                <dt>Restrição desde</dt>
                <dd>{dateTime(data.billing.delinquentSince)}</dd>
              </div>
            )}
          </dl>
        </Card>
        <Card>
          <SectionTitle eyebrow="Ativação" title="Onboarding" />
          <div className="platform-inline-status">
            <Badge tone={data.onboarding.pendingItems.length ? "warning" : "success"}>
              {data.onboarding.status}
            </Badge>
            {data.onboarding.updatedAt && (
              <small>Atualizado {dateTime(data.onboarding.updatedAt)}</small>
            )}
          </div>
          {data.onboarding.pendingItems.length ? (
            <ul className="platform-checklist">
              {data.onboarding.pendingItems.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          ) : (
            <EmptyState
              description="Não há pendências persistidas para esta ativação."
              icon="✓"
              title="Onboarding em dia"
            />
          )}
        </Card>
        <Card>
          <SectionTitle eyebrow="Saúde técnica" title="Sinais atuais" />
          <div className="platform-health-grid">
            <span>
              <strong>{data.health.openIncidents}</strong>
              <small>incidentes</small>
            </span>
            <span>
              <strong>{data.health.failedJobs}</strong>
              <small>jobs falhos</small>
            </span>
            <span>
              <strong>{data.health.staleHubs}</strong>
              <small>hubs com incidente</small>
            </span>
            <span>
              <strong>{data.health.failedIntegrations}</strong>
              <small>integrações fiscais</small>
            </span>
          </div>
        </Card>
        <Card>
          <SectionTitle eyebrow="Unidades e operação local" title="Conexões locais" />
          {data.hubs.length ? (
            <div className="platform-compact-list">
              {data.hubs.map((hub) => (
                <article key={hub.id}>
                  <div>
                    <strong>{hub.name}</strong>
                    <small>
                      {hub.version ?? "versão não informada"} · último sinal{" "}
                      {dateTime(hub.lastSeenAt)}
                    </small>
                  </div>
                  <Badge tone={hub.status === "online" ? "success" : "warning"}>{hub.status}</Badge>
                </article>
              ))}
            </div>
          ) : (
            <EmptyState
              description={`${data.units.length} unidade(s), sem hub retornado pela fonte.`}
              icon="◇"
              title="Sem hubs cadastrados"
            />
          )}
        </Card>
        <Card>
          <SectionTitle eyebrow="Provedores" title="Integrações fiscais" />
          {data.integrations.length ? (
            <div className="platform-compact-list">
              {data.integrations.map((integration) => (
                <article key={integration.id}>
                  <div>
                    <strong>
                      {integration.provider} · {integration.unitName}
                    </strong>
                    <small>
                      {integration.environment ?? "ambiente pendente"} · atualizado{" "}
                      {dateTime(integration.lastCheckedAt)}
                    </small>
                  </div>
                  <Badge tone={integration.status === "ready" ? "success" : "warning"}>
                    {integration.status}
                  </Badge>
                </article>
              ))}
            </div>
          ) : (
            <EmptyState
              description="Nenhuma integração retornada ou seu perfil não tem acesso fiscal."
              icon="◇"
              title="Sem integrações visíveis"
            />
          )}
        </Card>
        <Card>
          <SectionTitle eyebrow="Benefício do plano" title="DoseClub" />
          <div className="platform-inline-status">
            {data.doseClub.available ? (
              <>
                <Badge tone={data.doseClub.entitled ? "success" : "warning"}>
                  {data.doseClub.entitled ? "Incluído no plano" : "Fora do plano"}
                </Badge>
                <Badge tone={data.doseClub.providerEnabled ? "success" : "danger"}>
                  Provedor {data.doseClub.providerEnabled ? "habilitado" : "desabilitado"}
                </Badge>
              </>
            ) : (
              <Badge tone="info">Estado não informado</Badge>
            )}
          </div>
          {!data.doseClub.available ? (
            <EmptyState
              description="Os dados seguros do DoseClub ainda não estão disponíveis. Atualize após publicar a nova versão do sistema."
              icon="◇"
              title="Estado indisponível"
            />
          ) : !data.doseClub.entitled ? (
            <EmptyState
              description="Inclua DoseClub no plano comercial, publique o catálogo e conceda o acesso piloto para enfileirar o provisionamento."
              icon="◇"
              title="Entitlement pendente"
            />
          ) : data.doseClub.connections.length ? (
            <div className="platform-compact-list">
              {data.doseClub.connections.map((connection) => (
                <article key={connection.id}>
                  <div>
                    <strong>{connection.unitName}</strong>
                    <small>
                      {connection.managed ? "gerenciada automaticamente" : "configuração manual"}
                      {connection.provisioningStatus
                        ? ` · ${connection.provisioningStatus}`
                        : " · status remoto pendente"}
                      {` · atualizado ${dateTime(connection.updatedAt)}`}
                    </small>
                  </div>
                  <Badge
                    tone={
                      connection.status === "active"
                        ? connection.provisioningStatus === "waiting_product_mappings"
                          ? "warning"
                          : "success"
                        : connection.status === "failed"
                          ? "danger"
                          : "warning"
                    }
                  >
                    {connection.status === "active" &&
                    connection.provisioningStatus === "waiting_product_mappings"
                      ? "Mapeamentos pendentes"
                      : connection.status}
                  </Badge>
                </article>
              ))}
            </div>
          ) : (
            <EmptyState
              description="Conceda ou reconfirme os seis meses para enfileirar a criação das conexões por unidade."
              icon="◇"
              title="Aguardando provisionamento"
            />
          )}
          <p className="platform-boundary">
            Os mapeamentos de cliente, filial e produtos permanecem no DoseClub; esta tela não
            replica essa fonte de verdade.
          </p>
        </Card>
        <Card className="platform-timeline">
          <SectionTitle eyebrow="Auditoria" title="Linha do tempo" />
          {data.timeline.length ? (
            <ol>
              {data.timeline.map((event) => (
                <li key={event.id}>
                  <span
                    className={`platform-timeline__dot platform-timeline__dot--${event.tone}`}
                  />
                  <div>
                    <strong>{event.title}</strong>
                    {event.detail && <p>{event.detail}</p>}
                    <small>
                      {dateTime(event.createdAt)}
                      {event.actorName ? ` · ${event.actorName}` : ""}
                    </small>
                  </div>
                </li>
              ))}
            </ol>
          ) : (
            <EmptyState
              description="Nenhum evento foi retornado pela trilha de auditoria."
              icon="◇"
              title="Sem eventos"
            />
          )}
        </Card>
      </div>
    </section>
  );
}

function SectionTitle({ eyebrow, title }: { eyebrow: string; title: string }) {
  return (
    <div className="section-title">
      <div>
        <p className="eyebrow">{eyebrow}</p>
        <h3>{title}</h3>
      </div>
    </div>
  );
}

function actionLabel(action: IncidentAction | "retry"): string {
  return {
    claim: "Assumir incidente",
    snooze: "Adiar incidente",
    resolve: "Resolver incidente",
    retry: "Reprocessar evento",
  }[action];
}

function billingTone(state: string): Tone {
  if (["active", "trial_active"].includes(state)) return "success";
  if (["restricted", "suspended"].includes(state)) return "danger";
  if (["grace", "onboarding"].includes(state)) return "warning";
  return "neutral";
}

function durationMinutes(minutes: number): string {
  if (minutes < 60) return `${minutes} min`;
  if (minutes < 1_440) return `${Math.floor(minutes / 60)} h`;
  return `${Math.floor(minutes / 1_440)} d`;
}
