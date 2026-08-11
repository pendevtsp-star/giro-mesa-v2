import { createHash, randomBytes } from "node:crypto";
import type { PublicMenuCommandInput } from "@giromesa/contracts";
import {
  deviceEnrollments,
  hubHeartbeats,
  type PublicMenuBranding,
  type PublicMenuItemSnapshot,
  publicMenuDrafts,
  publicMenuMediaAssets,
  publicMenuVersions,
  publicMenus,
} from "@giromesa/db";
import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  PayloadTooLargeException,
  ServiceUnavailableException,
} from "@nestjs/common";
import { and, desc, eq, gt, inArray, isNotNull, isNull, sql } from "drizzle-orm";
import { DatabaseService } from "../database/database.module.js";
import { ScopeService } from "../organizations/scope.service.js";
import { SyncService } from "../sync/sync.service.js";

export type PublicMenuDraftInput = {
  expectedVersion: number;
  branding: PublicMenuBranding;
  items: PublicMenuItemSnapshot[];
};

function menuError(code: string, message: string) {
  return new ConflictException({ code, message });
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => `${JSON.stringify(key)}:${canonical(entry)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function checksum(value: unknown) {
  return createHash("sha256").update(canonical(value)).digest("hex");
}

function relativeLuminance(hex: string) {
  const rgb = [1, 3, 5].map((offset) => Number.parseInt(hex.slice(offset, offset + 2), 16) / 255);
  return rgb
    .map((channel) => (channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4))
    .reduce((sum, channel, index) => sum + channel * [0.2126, 0.7152, 0.0722][index]!, 0);
}

function contrast(left: string, right: string) {
  const [bright, dark] = [relativeLuminance(left), relativeLuminance(right)].sort((a, b) => b - a);
  return (bright! + 0.05) / (dark! + 0.05);
}

function assertDraft(input: PublicMenuDraftInput) {
  const color = /^#[0-9a-f]{6}$/i;
  if (
    !color.test(input.branding.primaryColor) ||
    !color.test(input.branding.surfaceColor) ||
    !color.test(input.branding.textColor)
  )
    throw new BadRequestException({
      code: "PUBLIC_MENU_COLOR_INVALID",
      message: "As cores devem usar o formato hexadecimal completo.",
    });
  if (contrast(input.branding.surfaceColor, input.branding.textColor) < 4.5)
    throw new BadRequestException({
      code: "PUBLIC_MENU_CONTRAST_INVALID",
      message: "A combinação de texto e superfície não atende ao contraste mínimo.",
    });
  if (input.branding.name.trim().length < 2 || input.branding.name.length > 120)
    throw new BadRequestException({ code: "PUBLIC_MENU_NAME_INVALID", message: "Nome inválido." });
  if (input.items.length > 500)
    throw new BadRequestException({
      code: "PUBLIC_MENU_ITEM_LIMIT",
      message: "O cardápio excede o limite de itens.",
    });
  const ids = new Set<string>();
  for (const item of input.items) {
    if (ids.has(item.id))
      throw new BadRequestException({
        code: "PUBLIC_MENU_ITEM_DUPLICATED",
        message: "O cardápio contém um item duplicado.",
      });
    ids.add(item.id);
    if (!Number.isSafeInteger(item.priceCents) || item.priceCents < 0)
      throw new BadRequestException({
        code: "PUBLIC_MENU_PRICE_INVALID",
        message: "O preço do item é inválido.",
      });
  }
}

@Injectable()
export class PublicMenuService {
  constructor(
    private readonly database: DatabaseService,
    private readonly sync: SyncService,
    private readonly scope: ScopeService,
  ) {}

  async menu(slug: string) {
    const menu = await this.resolveMenu(slug);
    return {
      branding: menu.branding
        ? {
            ...menu.branding,
            logoUrl: menu.branding.logoAssetId
              ? `/public/v1/menus/${encodeURIComponent(slug)}/assets/${menu.branding.logoAssetId}`
              : null,
            coverUrl: menu.branding.coverAssetId
              ? `/public/v1/menus/${encodeURIComponent(slug)}/assets/${menu.branding.coverAssetId}`
              : null,
          }
        : null,
      items: menu.items.map((item) => ({
        ...item,
        imageUrl: item.imageAssetId
          ? `/public/v1/menus/${encodeURIComponent(slug)}/assets/${item.imageAssetId}`
          : null,
      })),
      version: menu.version,
      publishedAt: menu.publishedAt,
    };
  }

  async preview(slug: string, token: string) {
    const menu = await this.resolveMenuRecord(slug);
    const [draft] = await this.database.db
      .select()
      .from(publicMenuDrafts)
      .where(eq(publicMenuDrafts.menuId, menu.id))
      .limit(1);
    const tokenHash = createHash("sha256").update(token).digest("hex");
    if (
      !draft?.previewTokenHash ||
      draft.previewTokenHash !== tokenHash ||
      !draft.previewExpiresAt ||
      draft.previewExpiresAt <= new Date()
    )
      throw new NotFoundException({
        code: "PUBLIC_MENU_PREVIEW_NOT_FOUND",
        message: "Prévia expirada ou inválida.",
      });
    return { branding: draft.branding, items: draft.items, preview: true };
  }

  async saveDraft(
    identityId: string,
    organizationId: string,
    unitId: string,
    menuId: string,
    input: PublicMenuDraftInput,
  ) {
    assertDraft(input);
    await this.requireEditor(identityId, organizationId, unitId);
    await this.requireMenu(organizationId, unitId, menuId);
    await this.assertAssetsInScope(organizationId, unitId, input.branding, input.items);
    const now = new Date();
    if (input.expectedVersion === 0) {
      const [created] = await this.database.db
        .insert(publicMenuDrafts)
        .values({
          organizationId,
          unitId,
          menuId,
          branding: input.branding,
          items: input.items,
          resourceVersion: 1,
          updatedByIdentityId: identityId,
          updatedAt: now,
        })
        .onConflictDoNothing()
        .returning();
      if (created) return created;
    }
    const [updated] = await this.database.db
      .update(publicMenuDrafts)
      .set({
        branding: input.branding,
        items: input.items,
        resourceVersion: input.expectedVersion + 1,
        previewTokenHash: null,
        previewExpiresAt: null,
        updatedByIdentityId: identityId,
        updatedAt: now,
      })
      .where(
        and(
          eq(publicMenuDrafts.organizationId, organizationId),
          eq(publicMenuDrafts.unitId, unitId),
          eq(publicMenuDrafts.menuId, menuId),
          eq(publicMenuDrafts.resourceVersion, input.expectedVersion),
        ),
      )
      .returning();
    if (!updated)
      throw menuError(
        "PUBLIC_MENU_VERSION_CONFLICT",
        "O rascunho mudou em outro dispositivo. Recarregue antes de salvar.",
      );
    return updated;
  }

  async createPreview(
    identityId: string,
    organizationId: string,
    unitId: string,
    menuId: string,
    expectedVersion: number,
  ) {
    await this.requireEditor(identityId, organizationId, unitId);
    const token = randomBytes(32).toString("base64url");
    const expiresAt = new Date(Date.now() + 15 * 60 * 1_000);
    const [draft] = await this.database.db
      .update(publicMenuDrafts)
      .set({
        previewTokenHash: createHash("sha256").update(token).digest("hex"),
        previewExpiresAt: expiresAt,
      })
      .where(
        and(
          eq(publicMenuDrafts.organizationId, organizationId),
          eq(publicMenuDrafts.unitId, unitId),
          eq(publicMenuDrafts.menuId, menuId),
          eq(publicMenuDrafts.resourceVersion, expectedVersion),
        ),
      )
      .returning({ resourceVersion: publicMenuDrafts.resourceVersion });
    if (!draft)
      throw menuError("PUBLIC_MENU_VERSION_CONFLICT", "A prévia não corresponde ao rascunho atual.");
    return { token, expiresAt, resourceVersion: draft.resourceVersion };
  }

  async createVersion(
    identityId: string,
    organizationId: string,
    unitId: string,
    menuId: string,
    expectedVersion: number,
  ) {
    await this.requireEditor(identityId, organizationId, unitId);
    return this.database.db.transaction(async (tx) => {
      await tx.execute(sql`select id from ${publicMenus} where id = ${menuId} for update`);
      const [draft] = await tx
        .select()
        .from(publicMenuDrafts)
        .where(
          and(
            eq(publicMenuDrafts.organizationId, organizationId),
            eq(publicMenuDrafts.unitId, unitId),
            eq(publicMenuDrafts.menuId, menuId),
            eq(publicMenuDrafts.resourceVersion, expectedVersion),
          ),
        )
        .limit(1);
      if (!draft)
        throw menuError("PUBLIC_MENU_VERSION_CONFLICT", "O rascunho não está mais nesta versão.");
      const digest = checksum({ branding: draft.branding, items: draft.items });
      const [existing] = await tx
        .select()
        .from(publicMenuVersions)
        .where(
          and(eq(publicMenuVersions.menuId, menuId), eq(publicMenuVersions.checksum, digest)),
        )
        .limit(1);
      if (existing) return existing;
      const [latest] = await tx
        .select({ version: publicMenuVersions.version })
        .from(publicMenuVersions)
        .where(eq(publicMenuVersions.menuId, menuId))
        .orderBy(desc(publicMenuVersions.version))
        .limit(1);
      const [created] = await tx
        .insert(publicMenuVersions)
        .values({
          organizationId,
          unitId,
          menuId,
          version: (latest?.version ?? 0) + 1,
          sourceResourceVersion: draft.resourceVersion,
          checksum: digest,
          branding: draft.branding,
          items: draft.items,
          createdByIdentityId: identityId,
        })
        .returning();
      if (!created) throw new Error("Menu version insert returned no row");
      return created;
    });
  }

  async publish(
    identityId: string,
    organizationId: string,
    unitId: string,
    menuId: string,
    versionId: string,
    expectedPublishEpoch: number,
  ) {
    await this.requireEditor(identityId, organizationId, unitId);
    return this.database.db.transaction(async (tx) => {
      const [version] = await tx
        .select()
        .from(publicMenuVersions)
        .where(
          and(
            eq(publicMenuVersions.organizationId, organizationId),
            eq(publicMenuVersions.unitId, unitId),
            eq(publicMenuVersions.menuId, menuId),
            eq(publicMenuVersions.id, versionId),
          ),
        )
        .limit(1);
      if (!version)
        throw new NotFoundException({
          code: "PUBLIC_MENU_VERSION_NOT_FOUND",
          message: "Versão não encontrada.",
        });
      const publishedAt = version.publishedAt ?? new Date();
      const [publishedMenu] = await tx
        .update(publicMenus)
        .set({
          active: true,
          publishedAt,
          publishedVersionId: version.id,
          publishEpoch: expectedPublishEpoch + 1,
          items: version.items,
          updatedAt: publishedAt,
        })
        .where(
          and(
            eq(publicMenus.organizationId, organizationId),
            eq(publicMenus.unitId, unitId),
            eq(publicMenus.id, menuId),
            eq(publicMenus.publishEpoch, expectedPublishEpoch),
          ),
        )
        .returning({ publishEpoch: publicMenus.publishEpoch });
      if (!publishedMenu)
        throw menuError(
          "PUBLIC_MENU_PUBLISH_CONFLICT",
          "Outra publicação venceu esta tentativa. Atualize o estado do cardápio.",
        );
      if (!version.publishedAt)
        await tx
          .update(publicMenuVersions)
          .set({ publishedAt })
          .where(eq(publicMenuVersions.id, version.id));
      return {
        id: version.id,
        version: version.version,
        publishEpoch: publishedMenu.publishEpoch,
        publishedAt,
      };
    });
  }

  async menuForTenant(organizationId: string, unitId: string, menuId: string) {
    const menu = await this.requireMenu(organizationId, unitId, menuId);
    return menu;
  }

  async hubStatus(slug: string) {
    const menu = await this.resolveMenuRecord(slug);
    return { acknowledged: Boolean(await this.recentHub(menu.organizationId, menu.unitId)) };
  }

  async command(slug: string, idempotencyKey: string, body: PublicMenuCommandInput) {
    const menu = await this.resolveMenuRecord(slug);
    if (Buffer.byteLength(JSON.stringify(body.payload), "utf8") > 65_536) {
      throw new PayloadTooLargeException({
        code: "PUBLIC_COMMAND_TOO_LARGE",
        message: "O comando público excede o limite permitido.",
      });
    }
    const hub = await this.recentHub(menu.organizationId, menu.unitId);
    if (!hub) {
      throw new ServiceUnavailableException({
        code: "PUBLIC_ORDERING_OFFLINE",
        message: "A unidade não está confirmando pedidos digitais neste momento.",
      });
    }
    const command = await this.sync.enqueuePublicCommand({
      organizationId: menu.organizationId,
      unitId: menu.unitId,
      hubId: hub.hubId,
      idempotencyKey,
      type: body.type,
      payload: body.payload,
    });
    const acknowledgement = await this.sync.waitForAcknowledgement(command);
    return { commandId: command.id, expiresAt: command.expiresAt, ...acknowledgement };
  }

  private async resolveMenu(slug: string) {
    const menu = await this.resolveMenuRecord(slug);
    if (!menu.publishedVersionId)
      return { branding: null, items: menu.items, version: 0, publishedAt: menu.publishedAt };
    const [version] = await this.database.db
      .select()
      .from(publicMenuVersions)
      .where(eq(publicMenuVersions.id, menu.publishedVersionId))
      .limit(1);
    if (!version)
      throw new NotFoundException({
        code: "PUBLIC_MENU_VERSION_NOT_FOUND",
        message: "A versão publicada não está disponível.",
      });
    return version;
  }

  private async resolveMenuRecord(slug: string) {
    const [menu] = await this.database.db
      .select({
        id: publicMenus.id,
        organizationId: publicMenus.organizationId,
        unitId: publicMenus.unitId,
        items: publicMenus.items,
        publishedVersionId: publicMenus.publishedVersionId,
        publishedAt: publicMenus.publishedAt,
      })
      .from(publicMenus)
      .where(
        and(
          eq(publicMenus.slug, slug),
          eq(publicMenus.active, true),
          isNotNull(publicMenus.publishedAt),
        ),
      )
      .limit(1);
    if (!menu)
      throw new NotFoundException({
        code: "PUBLIC_MENU_NOT_FOUND",
        message: "Cardápio não encontrado.",
      });
    return menu;
  }

  private async requireEditor(identityId: string, organizationId: string, unitId: string) {
    await this.scope.requireUnitAccess(identityId, organizationId, unitId);
    await this.scope.requireOrganizationRole(identityId, organizationId, ["owner", "manager"]);
  }

  private async requireMenu(organizationId: string, unitId: string, menuId: string) {
    const [menu] = await this.database.db
      .select()
      .from(publicMenus)
      .where(
        and(
          eq(publicMenus.organizationId, organizationId),
          eq(publicMenus.unitId, unitId),
          eq(publicMenus.id, menuId),
        ),
      )
      .limit(1);
    if (!menu)
      throw new NotFoundException({
        code: "PUBLIC_MENU_NOT_FOUND",
        message: "Cardápio não encontrado.",
      });
    return menu;
  }

  private async assertAssetsInScope(
    organizationId: string,
    unitId: string,
    branding: PublicMenuBranding,
    items: PublicMenuItemSnapshot[],
  ) {
    const expected = new Map<string, "logo" | "cover" | "product">();
    if (branding.logoAssetId) expected.set(branding.logoAssetId, "logo");
    if (branding.coverAssetId) expected.set(branding.coverAssetId, "cover");
    for (const item of items) if (item.imageAssetId) expected.set(item.imageAssetId, "product");
    if (!expected.size) return;
    const assets = await this.database.db
      .select({ id: publicMenuMediaAssets.id, kind: publicMenuMediaAssets.kind })
      .from(publicMenuMediaAssets)
      .where(
        and(
          eq(publicMenuMediaAssets.organizationId, organizationId),
          eq(publicMenuMediaAssets.unitId, unitId),
          inArray(publicMenuMediaAssets.id, [...expected.keys()]),
        ),
      );
    if (
      assets.length !== expected.size ||
      assets.some((asset) => expected.get(asset.id) !== asset.kind)
    )
      throw new BadRequestException({
        code: "PUBLIC_MENU_MEDIA_SCOPE_INVALID",
        message: "Uma imagem não pertence à unidade ou não serve para este uso.",
      });
  }

  private async recentHub(organizationId: string, unitId: string) {
    const cutoff = new Date(Date.now() - 30_000);
    const [heartbeat] = await this.database.db
      .select({ hubId: hubHeartbeats.hubId, lastSeenAt: hubHeartbeats.lastSeenAt })
      .from(hubHeartbeats)
      .innerJoin(
        deviceEnrollments,
        and(
          eq(deviceEnrollments.id, hubHeartbeats.hubId),
          eq(deviceEnrollments.organizationId, hubHeartbeats.organizationId),
          eq(deviceEnrollments.unitId, hubHeartbeats.unitId),
        ),
      )
      .where(
        and(
          eq(hubHeartbeats.organizationId, organizationId),
          eq(hubHeartbeats.unitId, unitId),
          gt(hubHeartbeats.lastSeenAt, cutoff),
          isNull(deviceEnrollments.revokedAt),
        ),
      )
      .limit(1);
    return heartbeat;
  }
}
