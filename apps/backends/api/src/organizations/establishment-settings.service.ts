import type {
  BusinessHours,
  CopyUnitSettingsInput,
  EstablishmentPresentation,
  EstablishmentSettings,
  UpdateOrganizationSettingsInput,
  UpdateUnitSettingsInput,
} from "@giromesa/contracts";
import { businessHoursSchema, establishmentPresentationSchema } from "@giromesa/contracts";
import {
  auditEvents,
  type Database,
  organizations,
  outboxEvents,
  posCatalogBranding,
  posIdempotencyReceipts,
  publicMenus,
  units,
} from "@giromesa/db";
import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { and, eq, inArray, sql } from "drizzle-orm";
import { DatabaseService } from "../database/database.module.js";
import { replayResult, requestHash } from "../pilot-operations/pilot-rules.js";
import { ScopeService } from "./scope.service.js";

type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];
type StoredBranding = Record<string, unknown>;
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
    primaryColor: optionalString(stored.primaryColor) ?? DEFAULT_COLOR,
    accentColor: optionalString(stored.accentColor) ?? DEFAULT_COLOR,
    notice: optionalString(stored.notice),
    address: optionalString(stored.address),
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
): StoredBranding {
  return {
    ...base,
    ...presentation,
    openingHours: readableBusinessHours(businessHours),
    businessHours,
  };
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
    primaryColor: presentation.primaryColor,
    accentColor: presentation.accentColor,
    address: presentation.address,
    phone: presentation.phone,
    instagram: presentation.instagram,
    openingHours: presentation.openingHours,
    businessHours,
    timezone,
  };
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
      const [organization] = await tx
        .update(organizations)
        .set({ tradeName: input.tradeName, updatedAt: new Date() })
        .where(eq(organizations.id, organizationId))
        .returning({
          id: organizations.id,
          legalName: organizations.legalName,
          tradeName: organizations.tradeName,
          document: organizations.document,
        });
      if (!organization) throw new NotFoundException({ code: "ORGANIZATION_NOT_FOUND" });
      await tx.insert(auditEvents).values({
        organizationId,
        actorIdentityId: identityId,
        action: "settings.organization.updated",
        entityType: "organization",
        entityId: organizationId,
        metadata: { tradeName: input.tradeName },
      });
      await tx.insert(outboxEvents).values({
        topic: "settings.organization.updated",
        aggregateType: "organization",
        aggregateId: organizationId,
        payload: { organizationId, tradeName: input.tradeName },
      });
      return organization;
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
      const [unit] = await tx
        .update(units)
        .set({ name: input.name, timezone: input.timezone, updatedAt: now })
        .where(and(eq(units.organizationId, organizationId), eq(units.id, unitId)))
        .returning({ id: units.id });
      if (!unit) throw new NotFoundException({ code: "UNIT_NOT_FOUND" });
      const config = composeStoredSettings(input.presentation, input.businessHours);
      await tx
        .insert(posCatalogBranding)
        .values({ organizationId, unitId, config, updatedAt: now })
        .onConflictDoUpdate({
          target: [posCatalogBranding.organizationId, posCatalogBranding.unitId],
          set: { config, updatedAt: now },
        });
      await this.recordUnitChange(tx, identityId, organizationId, unitId, "updated", {});
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
      targetUnitIds: input.targetUnitIds,
    });
    return this.database.db.transaction(async (tx) => {
      await tx.execute(
        sql`select pg_advisory_xact_lock(hashtext(${`settings-copy:${organizationId}:${sourceUnitId}:${key}`}))`,
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
            eq(posIdempotencyReceipts.unitId, sourceUnitId),
            eq(posIdempotencyReceipts.key, key),
          ),
        )
        .limit(1);
      const replay = replayResult<Record<string, unknown>>(existing, operation, hash, identityId);
      if (replay) return replay;

      const [sourceUnit] = await tx
        .select({ name: units.name })
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
        .select({ id: units.id, name: units.name })
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
      const now = new Date();
      for (const target of targetUnits) {
        const current = brandingRows.find((row) => row.unitId === target.id)?.config ?? {};
        const config = copyStoredSettings(sourceConfig, sourceUnit.name, current, target.name);
        await tx
          .insert(posCatalogBranding)
          .values({ organizationId, unitId: target.id, config, updatedAt: now })
          .onConflictDoUpdate({
            target: [posCatalogBranding.organizationId, posCatalogBranding.unitId],
            set: { config, updatedAt: now },
          });
      }
      await tx.insert(auditEvents).values(
        input.targetUnitIds.map((targetUnitId) => ({
          organizationId,
          unitId: targetUnitId,
          actorIdentityId: identityId,
          action: "settings.unit.copied",
          entityType: "unit",
          entityId: targetUnitId,
          metadata: { sourceUnitId },
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
      const [current] = await tx
        .select({ config: posCatalogBranding.config })
        .from(posCatalogBranding)
        .where(
          and(
            eq(posCatalogBranding.organizationId, organizationId),
            eq(posCatalogBranding.unitId, unitId),
          ),
        )
        .limit(1);
      const config = { ...(current?.config ?? {}), ...input };
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
  }): EstablishmentSettings {
    const normalized = normalizeStoredBranding(row.branding, row.tradeName || row.unitName);
    return {
      organization: {
        id: row.organizationId,
        legalName: row.legalName,
        tradeName: row.tradeName,
        document: row.document,
      },
      unit: { id: row.unitId, name: row.unitName, timezone: row.timezone },
      ...normalized,
      publication: {
        active: row.publicationActive ?? false,
        publishedAt: row.publishedAt?.toISOString() ?? null,
        hasUnpublishedChanges: hasUnpublishedSettings(
          row.publishedAt,
          row.organizationUpdatedAt,
          row.unitUpdatedAt,
          row.brandingUpdatedAt,
        ),
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
