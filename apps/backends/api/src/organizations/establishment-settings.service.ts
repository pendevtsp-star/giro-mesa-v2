import type {
  BusinessHours,
  CopyUnitSettingsInput,
  EstablishmentPresentation,
  EstablishmentSettings,
  RestoreEstablishmentSettingsInput,
  UpdateOrganizationSettingsInput,
  UpdateUnitSettingsInput,
} from "@giromesa/contracts";
import { businessHoursSchema, establishmentPresentationSchema } from "@giromesa/contracts";
import {
  auditEvents,
  type Database,
  deviceEnrollments,
  fiscalProfiles,
  identities,
  managementCashSettings,
  managementTimeTrackingSettings,
  organizations,
  outboxEvents,
  posCatalogBranding,
  posIdempotencyReceipts,
  posProductionStations,
  publicMenus,
  units,
} from "@giromesa/db";
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { DatabaseService } from "../database/database.module.js";
import { replayResult, requestHash } from "../pilot-operations/pilot-rules.js";
import { ScopeService } from "./scope.service.js";

type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];
type StoredBranding = Record<string, unknown>;
type SettingsSection = "unit" | "brand" | "contacts" | "hours" | "timezone";
type PublicSettingsSection = Exclude<SettingsSection, "unit">;
type HistorySnapshot = {
  unit: { name: string; timezone: string };
  presentation: Omit<EstablishmentPresentation, "wifi">;
  businessHours: BusinessHours;
};
type LegacyBrandingInput = Pick<
  EstablishmentPresentation,
  "displayName" | "primaryColor" | "accentColor"
> &
  Partial<EstablishmentPresentation>;

const DEFAULT_COLOR = "#10b981";

export function closedBusinessHours(): BusinessHours {
  return {
    weekly: Array.from({ length: 7 }, (_, index) => ({
      weekday: (index + 1) as 1 | 2 | 3 | 4 | 5 | 6 | 7,
      mode: "closed" as const,
    })),
    exceptions: [],
  };
}

function readableBusinessHours(hours: BusinessHours) {
  const labels = ["Seg", "Ter", "Qua", "Qui", "Sex", "Sáb", "Dom"];
  return hours.weekly
    .map((day) => {
      if (day.mode === "closed") return `${labels[day.weekday - 1]}: fechado`;
      if (day.mode === "open24h") return `${labels[day.weekday - 1]}: 24 horas`;
      const periods = day.periods
        .map((period) => `${period.start}–${period.end}${period.endsNextDay ? " (+1 dia)" : ""}`)
        .join(", ");
      return `${labels[day.weekday - 1]}: ${periods}`;
    })
    .join("; ");
}

function optionalString(value: unknown) {
  return typeof value === "string" ? value : null;
}

export function normalizeStoredBranding(
  value: unknown,
  fallbackDisplayName: string,
): { presentation: EstablishmentPresentation; businessHours: BusinessHours } {
  const config = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  const stored = config as StoredBranding;
  const parsedHours = businessHoursSchema.safeParse(stored.businessHours);
  const businessHours = parsedHours.success ? parsedHours.data : closedBusinessHours();
  const parsedPresentation = establishmentPresentationSchema.safeParse({
    displayName:
      typeof stored.displayName === "string" && stored.displayName.trim()
        ? stored.displayName
        : fallbackDisplayName,
    slogan: optionalString(stored.slogan),
    logoUrl: optionalString(stored.logoUrl),
    logoThumbnailUrl: optionalString(stored.logoThumbnailUrl),
    coverImageUrl: optionalString(stored.coverImageUrl),
    primaryColor: optionalString(stored.primaryColor) ?? DEFAULT_COLOR,
    accentColor: optionalString(stored.accentColor) ?? DEFAULT_COLOR,
    notice: optionalString(stored.notice),
    address: optionalString(stored.address),
    addressDetails: stored.addressDetails ?? null,
    phone: optionalString(stored.phone),
    instagram: optionalString(stored.instagram),
    openingHours: optionalString(stored.openingHours) ?? readableBusinessHours(businessHours),
    serviceTaxNotice: optionalString(stored.serviceTaxNotice),
    corkageFeeNotice: optionalString(stored.corkageFeeNotice),
    wifi: stored.wifi ?? null,
  });
  if (parsedPresentation.success) return { presentation: parsedPresentation.data, businessHours };
  return {
    presentation: establishmentPresentationSchema.parse({
      displayName: fallbackDisplayName,
      primaryColor: DEFAULT_COLOR,
      accentColor: DEFAULT_COLOR,
      openingHours: readableBusinessHours(businessHours),
    }),
    businessHours,
  };
}

export function composeStoredSettings(
  presentation: EstablishmentPresentation,
  businessHours: BusinessHours,
  base: StoredBranding = {},
  revision = storedSettingsRevision(base),
): StoredBranding {
  return {
    ...base,
    ...presentation,
    openingHours: readableBusinessHours(businessHours),
    businessHours,
    settingsRevision: revision,
  };
}

export function storedSettingsRevision(value: unknown): number {
  if (!value || typeof value !== "object" || Array.isArray(value)) return 0;
  const revision = (value as StoredBranding).settingsRevision;
  return typeof revision === "number" && Number.isInteger(revision) && revision >= 0 ? revision : 0;
}

export function canManageSettingsUnit(
  roles: Array<{ role: string; unitId: string | null }>,
  unitId: string,
) {
  return roles.some(
    (binding) =>
      (binding.role === "owner" || binding.role === "manager") &&
      (binding.unitId === null || binding.unitId === unitId),
  );
}

export function copyStoredSettings(
  sourceValue: unknown,
  sourceFallbackDisplayName: string,
  targetValue: unknown,
  targetFallbackDisplayName: string,
) {
  const source = normalizeStoredBranding(sourceValue, sourceFallbackDisplayName);
  const target = normalizeStoredBranding(targetValue, targetFallbackDisplayName);
  return composeStoredSettings(
    { ...source.presentation, wifi: target.presentation.wifi },
    source.businessHours,
    targetValue && typeof targetValue === "object" && !Array.isArray(targetValue)
      ? (targetValue as StoredBranding)
      : {},
    storedSettingsRevision(targetValue) + 1,
  );
}

export function projectBrandingSummary(value: unknown, fallbackDisplayName: string) {
  const { presentation } = normalizeStoredBranding(value, fallbackDisplayName);
  return {
    displayName: presentation.displayName,
    logoUrl: presentation.logoUrl,
    primaryColor: presentation.primaryColor,
    accentColor: presentation.accentColor,
  };
}

export function projectPublicBranding(
  value: unknown,
  fallbackDisplayName: string,
  timezone: string,
) {
  const { presentation, businessHours } = normalizeStoredBranding(value, fallbackDisplayName);
  return {
    displayName: presentation.displayName,
    slogan: presentation.slogan,
    logoUrl: presentation.logoUrl,
    logoThumbnailUrl: presentation.logoThumbnailUrl,
    coverImageUrl: presentation.coverImageUrl,
    primaryColor: presentation.primaryColor,
    accentColor: presentation.accentColor,
    address: presentation.address,
    addressDetails: presentation.addressDetails,
    phone: presentation.phone,
    instagram: presentation.instagram,
    openingHours: presentation.openingHours,
    businessHours,
    timezone,
  };
}

function comparable(value: unknown) {
  return JSON.stringify(value);
}

type BrandProjectionSource = Partial<
  Pick<
    EstablishmentPresentation,
    | "displayName"
    | "slogan"
    | "logoUrl"
    | "logoThumbnailUrl"
    | "coverImageUrl"
    | "primaryColor"
    | "accentColor"
  >
>;
type ContactProjectionSource = Partial<
  Pick<EstablishmentPresentation, "address" | "addressDetails" | "phone" | "instagram">
>;

function brandProjection(presentation: BrandProjectionSource) {
  return {
    displayName: presentation.displayName,
    slogan: presentation.slogan ?? null,
    logoUrl: presentation.logoUrl ?? null,
    logoThumbnailUrl: presentation.logoThumbnailUrl ?? null,
    coverImageUrl: presentation.coverImageUrl ?? null,
    primaryColor: presentation.primaryColor,
    accentColor: presentation.accentColor,
  };
}

function contactProjection(presentation: ContactProjectionSource) {
  return {
    address: presentation.address ?? null,
    addressDetails: presentation.addressDetails ?? null,
    phone: presentation.phone ?? null,
    instagram: presentation.instagram ?? null,
  };
}

export function pendingPublicSections(
  draft: ReturnType<typeof projectPublicBranding>,
  published: unknown,
): PublicSettingsSection[] {
  if (!published || typeof published !== "object" || Array.isArray(published)) {
    return ["brand", "contacts", "hours", "timezone"];
  }
  const current = published as Record<string, unknown>;
  const pending: PublicSettingsSection[] = [];
  if (
    comparable(brandProjection(draft)) !==
    comparable(brandProjection(current as EstablishmentPresentation))
  ) {
    pending.push("brand");
  }
  if (
    comparable(contactProjection(draft)) !==
    comparable(contactProjection(current as EstablishmentPresentation))
  ) {
    pending.push("contacts");
  }
  if (comparable(draft.businessHours) !== comparable(current.businessHours)) pending.push("hours");
  if (draft.timezone !== current.timezone) pending.push("timezone");
  return pending;
}

function historySnapshot(
  unit: { name: string; timezone: string },
  presentation: EstablishmentPresentation,
  businessHours: BusinessHours,
): HistorySnapshot {
  const { wifi: _wifi, ...safePresentation } = presentation;
  return { unit, presentation: safePresentation, businessHours };
}

function changedSections(before: HistorySnapshot, after: HistorySnapshot): SettingsSection[] {
  const changed: SettingsSection[] = [];
  if (before.unit.name !== after.unit.name) changed.push("unit");
  if (before.unit.timezone !== after.unit.timezone) changed.push("timezone");
  if (
    comparable(brandProjection(before.presentation)) !==
    comparable(brandProjection(after.presentation))
  ) {
    changed.push("brand");
  }
  if (
    comparable(contactProjection(before.presentation)) !==
    comparable(contactProjection(after.presentation))
  ) {
    changed.push("contacts");
  }
  if (comparable(before.businessHours) !== comparable(after.businessHours)) changed.push("hours");
  return changed;
}

export function resolveEstablishmentName(value: unknown, fallbackDisplayName: string): string {
  return normalizeStoredBranding(value, fallbackDisplayName).presentation.displayName;
}

export function hasUnpublishedSettings(
  publishedAt: Date | null,
  ...settingsUpdates: Array<Date | null>
) {
  return (
    publishedAt === null ||
    settingsUpdates.some((updatedAt) => updatedAt !== null && updatedAt > publishedAt)
  );
}

@Injectable()
export class EstablishmentSettingsService {
  constructor(
    private readonly database: DatabaseService,
    private readonly scope: ScopeService,
  ) {}

  private async requireManager(identityId: string, organizationId: string, unitId: string) {
    await this.scope.requireUnitAccess(identityId, organizationId, unitId);
    const roles = await this.scope.requireOrganizationRole(identityId, organizationId, [
      "owner",
      "manager",
    ]);
    if (!canManageSettingsUnit(roles, unitId)) {
      throw new ForbiddenException({ code: "SETTINGS_SCOPE_DENIED" });
    }
    return roles;
  }

  async get(identityId: string, organizationId: string, unitId: string) {
    await this.requireManager(identityId, organizationId, unitId);
    const [row] = await this.database.db
      .select({
        organizationId: organizations.id,
        legalName: organizations.legalName,
        tradeName: organizations.tradeName,
        document: organizations.document,
        organizationUpdatedAt: organizations.updatedAt,
        unitId: units.id,
        unitName: units.name,
        timezone: units.timezone,
        unitUpdatedAt: units.updatedAt,
        branding: posCatalogBranding.config,
        brandingUpdatedAt: posCatalogBranding.updatedAt,
        publicationActive: publicMenus.active,
        publishedAt: publicMenus.publishedAt,
        publishedVersion: publicMenus.version,
        publicationSlug: publicMenus.slug,
        publicationMetadata: publicMenus.metadata,
      })
      .from(units)
      .innerJoin(organizations, eq(organizations.id, units.organizationId))
      .leftJoin(
        posCatalogBranding,
        and(
          eq(posCatalogBranding.organizationId, units.organizationId),
          eq(posCatalogBranding.unitId, units.id),
        ),
      )
      .leftJoin(
        publicMenus,
        and(eq(publicMenus.organizationId, units.organizationId), eq(publicMenus.unitId, units.id)),
      )
      .where(
        and(eq(organizations.id, organizationId), eq(units.id, unitId), eq(units.active, true)),
      )
      .limit(1);
    if (!row) throw new NotFoundException({ code: "UNIT_NOT_FOUND" });
    return this.toSettings(row);
  }

  async updateOrganization(
    identityId: string,
    organizationId: string,
    input: UpdateOrganizationSettingsInput,
  ) {
    const roles = await this.scope.requireOrganizationRole(identityId, organizationId, ["owner"]);
    if (!roles.some((role) => role.role === "owner" && role.unitId === null)) {
      throw new ForbiddenException({ code: "ORGANIZATION_SETTINGS_OWNER_REQUIRED" });
    }
    return this.database.db.transaction(async (tx) => {
      const expectedRevision = new Date(input.expectedRevision);
      const now = new Date();
      const [organization] = await tx
        .update(organizations)
        .set({ tradeName: input.tradeName, updatedAt: now })
        .where(
          and(eq(organizations.id, organizationId), eq(organizations.updatedAt, expectedRevision)),
        )
        .returning({
          id: organizations.id,
          legalName: organizations.legalName,
          tradeName: organizations.tradeName,
          document: organizations.document,
          updatedAt: organizations.updatedAt,
        });
      if (!organization) {
        const [existing] = await tx
          .select({ id: organizations.id })
          .from(organizations)
          .where(eq(organizations.id, organizationId))
          .limit(1);
        if (!existing) throw new NotFoundException({ code: "ORGANIZATION_NOT_FOUND" });
        throw new ConflictException({
          code: "SETTINGS_VERSION_CONFLICT",
          message: "As configurações foram alteradas por outra pessoa. Recarregue antes de salvar.",
        });
      }
      await tx.insert(auditEvents).values({
        organizationId,
        actorIdentityId: identityId,
        action: "settings.organization.updated",
        entityType: "organization",
        entityId: organizationId,
        metadata: { tradeName: input.tradeName, revision: organization.updatedAt.toISOString() },
      });
      await tx.insert(outboxEvents).values({
        topic: "settings.organization.updated",
        aggregateType: "organization",
        aggregateId: organizationId,
        payload: { organizationId, tradeName: input.tradeName },
      });
      const { updatedAt, ...settingsOrganization } = organization;
      return { ...settingsOrganization, revision: updatedAt.toISOString() };
    });
  }

  async updateUnit(
    identityId: string,
    organizationId: string,
    unitId: string,
    input: UpdateUnitSettingsInput,
  ) {
    await this.requireManager(identityId, organizationId, unitId);
    const now = new Date();
    await this.database.db.transaction(async (tx) => {
      await tx.execute(
        sql`select pg_advisory_xact_lock(hashtext(${`settings-unit:${organizationId}:${unitId}`}))`,
      );
      const [current] = await tx
        .select({
          name: units.name,
          timezone: units.timezone,
          branding: posCatalogBranding.config,
        })
        .from(units)
        .leftJoin(
          posCatalogBranding,
          and(
            eq(posCatalogBranding.organizationId, units.organizationId),
            eq(posCatalogBranding.unitId, units.id),
          ),
        )
        .where(and(eq(units.organizationId, organizationId), eq(units.id, unitId)))
        .limit(1);
      if (!current) throw new NotFoundException({ code: "UNIT_NOT_FOUND" });
      const currentRevision = storedSettingsRevision(current.branding);
      if (currentRevision !== input.expectedRevision) {
        throw new ConflictException({
          code: "SETTINGS_VERSION_CONFLICT",
          message: "As configurações foram alteradas por outra pessoa. Recarregue antes de salvar.",
        });
      }
      const normalizedBefore = normalizeStoredBranding(current.branding, current.name);
      const before = historySnapshot(
        { name: current.name, timezone: current.timezone },
        normalizedBefore.presentation,
        normalizedBefore.businessHours,
      );
      const nextRevision = currentRevision + 1;
      const after = historySnapshot(
        { name: input.name, timezone: input.timezone },
        input.presentation,
        input.businessHours,
      );
      const [unit] = await tx
        .update(units)
        .set({ name: input.name, timezone: input.timezone, updatedAt: now })
        .where(and(eq(units.organizationId, organizationId), eq(units.id, unitId)))
        .returning({ id: units.id });
      if (!unit) throw new NotFoundException({ code: "UNIT_NOT_FOUND" });
      const config = composeStoredSettings(
        input.presentation,
        input.businessHours,
        current.branding ?? {},
        nextRevision,
      );
      await tx
        .insert(posCatalogBranding)
        .values({ organizationId, unitId, config, updatedAt: now })
        .onConflictDoUpdate({
          target: [posCatalogBranding.organizationId, posCatalogBranding.unitId],
          set: { config, updatedAt: now },
        });
      await this.recordUnitChange(tx, identityId, organizationId, unitId, "updated", {
        revision: nextRevision,
        changedSections: changedSections(before, after),
        before,
        after,
      });
    });
    return this.get(identityId, organizationId, unitId);
  }

  async copy(
    identityId: string,
    organizationId: string,
    sourceUnitId: string,
    idempotencyKey: string,
    input: CopyUnitSettingsInput,
  ) {
    const roles = await this.requireManager(identityId, organizationId, sourceUnitId);
    if (input.targetUnitIds.includes(sourceUnitId)) {
      throw new BadRequestException({ code: "SETTINGS_COPY_SOURCE_IS_TARGET" });
    }
    for (const targetUnitId of input.targetUnitIds) {
      if (!canManageSettingsUnit(roles, targetUnitId)) {
        throw new ForbiddenException({ code: "SETTINGS_SCOPE_DENIED" });
      }
    }
    const key = this.requireIdempotencyKey(idempotencyKey);
    const operation = "settings.unit.copy";
    const hash = requestHash(operation, {
      actorIdentityId: identityId,
      organizationId,
      sourceUnitId,
      expectedRevision: input.expectedRevision,
      targetUnitIds: input.targetUnitIds,
    });
    return this.database.db.transaction(async (tx) => {
      await tx.execute(
        sql`select pg_advisory_xact_lock(hashtext(${`settings-copy:${organizationId}:${sourceUnitId}:${key}`}))`,
      );
      for (const lockedUnitId of [sourceUnitId, ...input.targetUnitIds].sort()) {
        await tx.execute(
          sql`select pg_advisory_xact_lock(hashtext(${`settings-unit:${organizationId}:${lockedUnitId}`}))`,
        );
      }
      const [existing] = await tx
        .select({
          actorIdentityId: posIdempotencyReceipts.actorIdentityId,
          operation: posIdempotencyReceipts.operation,
          requestHash: posIdempotencyReceipts.requestHash,
          response: posIdempotencyReceipts.response,
        })
        .from(posIdempotencyReceipts)
        .where(
          and(
            eq(posIdempotencyReceipts.organizationId, organizationId),
            eq(posIdempotencyReceipts.unitId, sourceUnitId),
            eq(posIdempotencyReceipts.key, key),
          ),
        )
        .limit(1);
      const replay = replayResult<Record<string, unknown>>(existing, operation, hash, identityId);
      if (replay) return replay;

      const [sourceUnit] = await tx
        .select({ name: units.name, timezone: units.timezone })
        .from(units)
        .where(
          and(
            eq(units.organizationId, organizationId),
            eq(units.id, sourceUnitId),
            eq(units.active, true),
          ),
        )
        .limit(1);
      const targetUnits = await tx
        .select({ id: units.id, name: units.name, timezone: units.timezone })
        .from(units)
        .where(
          and(
            eq(units.organizationId, organizationId),
            inArray(units.id, input.targetUnitIds),
            eq(units.active, true),
          ),
        );
      if (!sourceUnit || targetUnits.length !== input.targetUnitIds.length) {
        throw new NotFoundException({ code: "UNIT_NOT_FOUND" });
      }
      const brandingRows = await tx
        .select({ unitId: posCatalogBranding.unitId, config: posCatalogBranding.config })
        .from(posCatalogBranding)
        .where(
          and(
            eq(posCatalogBranding.organizationId, organizationId),
            inArray(posCatalogBranding.unitId, [sourceUnitId, ...input.targetUnitIds]),
          ),
        );
      const sourceConfig = brandingRows.find((row) => row.unitId === sourceUnitId)?.config;
      if (storedSettingsRevision(sourceConfig) !== input.expectedRevision) {
        throw new ConflictException({
          code: "SETTINGS_VERSION_CONFLICT",
          message: "A unidade de origem foi alterada. Recarregue antes de copiar.",
        });
      }
      const now = new Date();
      const histories: Array<{
        targetUnitId: string;
        revision: number;
        before: HistorySnapshot;
        after: HistorySnapshot;
      }> = [];
      for (const target of targetUnits) {
        const current = brandingRows.find((row) => row.unitId === target.id)?.config ?? {};
        const config = copyStoredSettings(sourceConfig, sourceUnit.name, current, target.name);
        const beforeNormalized = normalizeStoredBranding(current, target.name);
        const afterNormalized = normalizeStoredBranding(config, target.name);
        histories.push({
          targetUnitId: target.id,
          revision: storedSettingsRevision(config),
          before: historySnapshot(
            { name: target.name, timezone: target.timezone },
            beforeNormalized.presentation,
            beforeNormalized.businessHours,
          ),
          after: historySnapshot(
            { name: target.name, timezone: target.timezone },
            afterNormalized.presentation,
            afterNormalized.businessHours,
          ),
        });
        await tx
          .insert(posCatalogBranding)
          .values({ organizationId, unitId: target.id, config, updatedAt: now })
          .onConflictDoUpdate({
            target: [posCatalogBranding.organizationId, posCatalogBranding.unitId],
            set: { config, updatedAt: now },
          });
      }
      await tx.insert(auditEvents).values(
        histories.map((history) => ({
          organizationId,
          unitId: history.targetUnitId,
          actorIdentityId: identityId,
          action: "settings.unit.copied",
          entityType: "unit",
          entityId: history.targetUnitId,
          metadata: {
            sourceUnitId,
            revision: history.revision,
            changedSections: changedSections(history.before, history.after),
            before: history.before,
            after: history.after,
          },
        })),
      );
      await tx.insert(outboxEvents).values(
        input.targetUnitIds.map((targetUnitId) => ({
          topic: "settings.unit.copied",
          aggregateType: "unit",
          aggregateId: targetUnitId,
          payload: { organizationId, sourceUnitId, targetUnitId },
        })),
      );
      const response = { sourceUnitId, targetUnitIds: input.targetUnitIds };
      await tx.insert(posIdempotencyReceipts).values({
        organizationId,
        unitId: sourceUnitId,
        actorIdentityId: identityId,
        key,
        operation,
        requestHash: hash,
        response,
      });
      return { ...response, idempotentReplay: false };
    });
  }

  async specializedSummary(identityId: string, organizationId: string, unitId: string) {
    await this.requireManager(identityId, organizationId, unitId);
    const [catalog, cash, people, stations, fiscal, devices, organization] = await Promise.all([
      this.database.db
        .select({ active: publicMenus.active, publishedVersion: publicMenus.version })
        .from(publicMenus)
        .where(and(eq(publicMenus.organizationId, organizationId), eq(publicMenus.unitId, unitId)))
        .limit(1),
      this.database.db
        .select({ unitId: managementCashSettings.unitId })
        .from(managementCashSettings)
        .where(
          and(
            eq(managementCashSettings.organizationId, organizationId),
            eq(managementCashSettings.unitId, unitId),
          ),
        )
        .limit(1),
      this.database.db
        .select({ mode: managementTimeTrackingSettings.mode })
        .from(managementTimeTrackingSettings)
        .where(
          and(
            eq(managementTimeTrackingSettings.organizationId, organizationId),
            eq(managementTimeTrackingSettings.unitId, unitId),
          ),
        )
        .limit(1),
      this.database.db
        .select({ count: sql<number>`count(*)::int` })
        .from(posProductionStations)
        .where(
          and(
            eq(posProductionStations.organizationId, organizationId),
            eq(posProductionStations.unitId, unitId),
            eq(posProductionStations.active, true),
          ),
        ),
      this.database.db
        .select({ id: fiscalProfiles.id })
        .from(fiscalProfiles)
        .where(
          and(eq(fiscalProfiles.organizationId, organizationId), eq(fiscalProfiles.unitId, unitId)),
        )
        .limit(1),
      this.database.db
        .select({ count: sql<number>`count(*)::int` })
        .from(deviceEnrollments)
        .where(
          and(
            eq(deviceEnrollments.organizationId, organizationId),
            eq(deviceEnrollments.unitId, unitId),
            isNull(deviceEnrollments.revokedAt),
          ),
        ),
      this.database.db
        .select({ billingState: organizations.billingState })
        .from(organizations)
        .where(eq(organizations.id, organizationId))
        .limit(1),
    ]);
    return {
      catalog: {
        active: catalog[0]?.active ?? false,
        publishedVersion: catalog[0]?.publishedVersion ?? null,
      },
      cash: { configured: cash.length > 0 },
      people: { timeTrackingConfigured: people[0]?.mode !== undefined && people[0].mode !== "off" },
      kds: { activeStations: stations[0]?.count ?? 0 },
      fiscal: { configured: fiscal.length > 0 },
      devices: { activeCount: devices[0]?.count ?? 0 },
      billing: { state: organization[0]?.billingState ?? "unknown" },
    };
  }

  async history(identityId: string, organizationId: string, unitId: string) {
    await this.requireManager(identityId, organizationId, unitId);
    const rows = await this.database.db
      .select({
        id: auditEvents.id,
        action: auditEvents.action,
        actorDisplayName: identities.displayName,
        metadata: auditEvents.metadata,
        occurredAt: auditEvents.occurredAt,
      })
      .from(auditEvents)
      .leftJoin(identities, eq(identities.id, auditEvents.actorIdentityId))
      .where(
        and(
          eq(auditEvents.organizationId, organizationId),
          eq(auditEvents.unitId, unitId),
          inArray(auditEvents.action, [
            "settings.unit.updated",
            "settings.unit.copied",
            "settings.unit.restored",
            "pos.branding.updated",
          ]),
        ),
      )
      .orderBy(desc(auditEvents.occurredAt))
      .limit(30);
    return rows.flatMap((row) => {
      const metadata = row.metadata as Record<string, unknown>;
      const revision = metadata.revision;
      const sections = metadata.changedSections;
      if (typeof revision !== "number" || !Array.isArray(sections) || !metadata.after) return [];
      const action = row.action.endsWith("copied")
        ? "copied"
        : row.action.endsWith("restored")
          ? "restored"
          : "updated";
      return [
        {
          id: row.id,
          action,
          actorDisplayName: row.actorDisplayName,
          occurredAt: row.occurredAt.toISOString(),
          revision,
          changedSections: sections.filter((section): section is SettingsSection =>
            ["unit", "brand", "contacts", "hours", "timezone"].includes(String(section)),
          ),
        },
      ];
    });
  }

  async restore(
    identityId: string,
    organizationId: string,
    unitId: string,
    idempotencyKey: string,
    input: RestoreEstablishmentSettingsInput,
  ) {
    await this.requireManager(identityId, organizationId, unitId);
    const key = this.requireIdempotencyKey(idempotencyKey);
    const operation = "settings.unit.restore";
    const hash = requestHash(operation, { identityId, organizationId, unitId, ...input });
    await this.database.db.transaction(async (tx) => {
      await tx.execute(
        sql`select pg_advisory_xact_lock(hashtext(${`settings-restore:${organizationId}:${unitId}:${key}`}))`,
      );
      await tx.execute(
        sql`select pg_advisory_xact_lock(hashtext(${`settings-unit:${organizationId}:${unitId}`}))`,
      );
      const [existing] = await tx
        .select({
          actorIdentityId: posIdempotencyReceipts.actorIdentityId,
          operation: posIdempotencyReceipts.operation,
          requestHash: posIdempotencyReceipts.requestHash,
          response: posIdempotencyReceipts.response,
        })
        .from(posIdempotencyReceipts)
        .where(
          and(
            eq(posIdempotencyReceipts.organizationId, organizationId),
            eq(posIdempotencyReceipts.unitId, unitId),
            eq(posIdempotencyReceipts.key, key),
          ),
        )
        .limit(1);
      if (replayResult(existing, operation, hash, identityId)) return;

      const [current] = await tx
        .select({ name: units.name, timezone: units.timezone, branding: posCatalogBranding.config })
        .from(units)
        .leftJoin(
          posCatalogBranding,
          and(
            eq(posCatalogBranding.organizationId, units.organizationId),
            eq(posCatalogBranding.unitId, units.id),
          ),
        )
        .where(and(eq(units.organizationId, organizationId), eq(units.id, unitId)))
        .limit(1);
      if (!current) throw new NotFoundException({ code: "UNIT_NOT_FOUND" });
      const currentRevision = storedSettingsRevision(current.branding);
      if (currentRevision !== input.expectedRevision) {
        throw new ConflictException({ code: "SETTINGS_VERSION_CONFLICT" });
      }
      const [source] = await tx
        .select({ metadata: auditEvents.metadata })
        .from(auditEvents)
        .where(
          and(
            eq(auditEvents.id, input.auditEventId),
            eq(auditEvents.organizationId, organizationId),
            eq(auditEvents.unitId, unitId),
          ),
        )
        .limit(1);
      const rawSnapshot = (source?.metadata as Record<string, unknown> | undefined)?.after;
      if (!rawSnapshot || typeof rawSnapshot !== "object" || Array.isArray(rawSnapshot)) {
        throw new BadRequestException({ code: "SETTINGS_HISTORY_NOT_RESTORABLE" });
      }
      const snapshot = rawSnapshot as Record<string, unknown>;
      const unitSnapshot = snapshot.unit as Record<string, unknown> | undefined;
      const currentNormalized = normalizeStoredBranding(current.branding, current.name);
      const presentation = establishmentPresentationSchema.safeParse({
        ...(snapshot.presentation as Record<string, unknown> | undefined),
        wifi: currentNormalized.presentation.wifi,
      });
      const hours = businessHoursSchema.safeParse(snapshot.businessHours);
      if (
        !unitSnapshot ||
        typeof unitSnapshot.name !== "string" ||
        typeof unitSnapshot.timezone !== "string" ||
        !presentation.success ||
        !hours.success
      ) {
        throw new BadRequestException({ code: "SETTINGS_HISTORY_NOT_RESTORABLE" });
      }
      const revision = currentRevision + 1;
      const before = historySnapshot(
        { name: current.name, timezone: current.timezone },
        currentNormalized.presentation,
        currentNormalized.businessHours,
      );
      const after = historySnapshot(
        { name: unitSnapshot.name, timezone: unitSnapshot.timezone },
        presentation.data,
        hours.data,
      );
      const now = new Date();
      await tx
        .update(units)
        .set({ name: unitSnapshot.name, timezone: unitSnapshot.timezone, updatedAt: now })
        .where(and(eq(units.organizationId, organizationId), eq(units.id, unitId)));
      const config = composeStoredSettings(
        presentation.data,
        hours.data,
        current.branding ?? {},
        revision,
      );
      await tx
        .insert(posCatalogBranding)
        .values({ organizationId, unitId, config, updatedAt: now })
        .onConflictDoUpdate({
          target: [posCatalogBranding.organizationId, posCatalogBranding.unitId],
          set: { config, updatedAt: now },
        });
      await this.recordUnitChange(tx, identityId, organizationId, unitId, "restored", {
        sourceAuditEventId: input.auditEventId,
        revision,
        changedSections: changedSections(before, after),
        before,
        after,
      });
      await tx.insert(posIdempotencyReceipts).values({
        organizationId,
        unitId,
        actorIdentityId: identityId,
        key,
        operation,
        requestHash: hash,
        response: { unitId, revision },
      });
    });
    return this.get(identityId, organizationId, unitId);
  }

  async getLegacyBranding(identityId: string, organizationId: string, unitId: string) {
    await this.scope.requireUnitAccess(identityId, organizationId, unitId);
    const [row] = await this.database.db
      .select({ config: posCatalogBranding.config })
      .from(posCatalogBranding)
      .where(
        and(
          eq(posCatalogBranding.organizationId, organizationId),
          eq(posCatalogBranding.unitId, unitId),
        ),
      )
      .limit(1);
    return row?.config ?? null;
  }

  async updateLegacyBranding(
    identityId: string,
    organizationId: string,
    unitId: string,
    input: LegacyBrandingInput,
  ) {
    await this.requireManager(identityId, organizationId, unitId);
    return this.database.db.transaction(async (tx) => {
      await tx.execute(
        sql`select pg_advisory_xact_lock(hashtext(${`settings-unit:${organizationId}:${unitId}`}))`,
      );
      const [current] = await tx
        .select({
          config: posCatalogBranding.config,
          name: units.name,
          timezone: units.timezone,
        })
        .from(units)
        .leftJoin(
          posCatalogBranding,
          and(
            eq(posCatalogBranding.organizationId, units.organizationId),
            eq(posCatalogBranding.unitId, units.id),
          ),
        )
        .where(and(eq(units.organizationId, organizationId), eq(units.id, unitId)))
        .limit(1);
      if (!current) throw new NotFoundException({ code: "UNIT_NOT_FOUND" });
      const normalizedBefore = normalizeStoredBranding(current.config, current.name);
      const revision = storedSettingsRevision(current.config) + 1;
      const config = { ...(current.config ?? {}), ...input, settingsRevision: revision };
      const normalizedAfter = normalizeStoredBranding(config, current.name);
      const before = historySnapshot(
        { name: current.name, timezone: current.timezone },
        normalizedBefore.presentation,
        normalizedBefore.businessHours,
      );
      const after = historySnapshot(
        { name: current.name, timezone: current.timezone },
        normalizedAfter.presentation,
        normalizedAfter.businessHours,
      );
      await tx
        .insert(posCatalogBranding)
        .values({ organizationId, unitId, config })
        .onConflictDoUpdate({
          target: [posCatalogBranding.organizationId, posCatalogBranding.unitId],
          set: { config, updatedAt: new Date() },
        });
      await tx.insert(auditEvents).values({
        organizationId,
        unitId,
        actorIdentityId: identityId,
        action: "pos.branding.updated",
        entityType: "catalog_branding",
        entityId: unitId,
        metadata: {
          revision,
          changedSections: changedSections(before, after),
          before,
          after,
        },
      });
      await tx.insert(outboxEvents).values({
        topic: "pos.catalog_changed",
        aggregateType: "catalog_branding",
        aggregateId: unitId,
        payload: { organizationId, unitId, action: "pos.branding.updated" },
      });
      return config;
    });
  }

  private toSettings(row: {
    organizationId: string;
    legalName: string;
    tradeName: string;
    document: string;
    organizationUpdatedAt: Date;
    unitId: string;
    unitName: string;
    timezone: string;
    unitUpdatedAt: Date;
    branding: StoredBranding | null;
    brandingUpdatedAt: Date | null;
    publicationActive: boolean | null;
    publishedAt: Date | null;
    publishedVersion: number | null;
    publicationSlug: string | null;
    publicationMetadata: Record<string, unknown> | null;
  }): EstablishmentSettings {
    const normalized = normalizeStoredBranding(row.branding, row.tradeName || row.unitName);
    const draft = projectPublicBranding(row.branding, row.tradeName || row.unitName, row.timezone);
    const publishedBranding =
      row.publicationMetadata && typeof row.publicationMetadata.branding === "object"
        ? row.publicationMetadata.branding
        : null;
    const pendingSections = pendingPublicSections(draft, publishedBranding);
    let publicUrl: string | null = null;
    if (row.publicationSlug) {
      try {
        publicUrl = new URL(
          `/m/${row.publicationSlug}`,
          process.env.CUSTOMER_APP_URL ?? "http://localhost:3101",
        ).toString();
      } catch {
        publicUrl = null;
      }
    }
    return {
      revision: storedSettingsRevision(row.branding),
      organization: {
        id: row.organizationId,
        legalName: row.legalName,
        tradeName: row.tradeName,
        document: row.document,
        revision: row.organizationUpdatedAt.toISOString(),
      },
      unit: { id: row.unitId, name: row.unitName, timezone: row.timezone },
      ...normalized,
      publication: {
        active: row.publicationActive ?? false,
        publishedAt: row.publishedAt?.toISOString() ?? null,
        publishedVersion: row.publishedVersion,
        publicUrl,
        hasUnpublishedChanges: pendingSections.length > 0,
        pendingSections,
      },
    };
  }

  private requireIdempotencyKey(value: string) {
    if (!value || value.trim().length < 8 || value.length > 160) {
      throw new BadRequestException({
        code: "IDEMPOTENCY_KEY_REQUIRED",
        message: "Envie Idempotency-Key com 8 a 160 caracteres.",
      });
    }
    return value.trim();
  }

  private async recordUnitChange(
    tx: Transaction,
    actorIdentityId: string,
    organizationId: string,
    unitId: string,
    action: string,
    metadata: Record<string, unknown>,
  ) {
    await tx.insert(auditEvents).values({
      organizationId,
      unitId,
      actorIdentityId,
      action: `settings.unit.${action}`,
      entityType: "unit",
      entityId: unitId,
      metadata,
    });
    await tx.insert(outboxEvents).values({
      topic: `settings.unit.${action}`,
      aggregateType: "unit",
      aggregateId: unitId,
      payload: { organizationId, unitId, ...metadata },
    });
  }
}
