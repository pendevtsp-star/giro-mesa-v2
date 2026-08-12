import { createHash } from "node:crypto";
import { publicMenuMediaAssets, publicMenus, publicMenuVersions } from "@giromesa/db";
import {
  BadRequestException,
  ConflictException,
  Injectable,
  PayloadTooLargeException,
} from "@nestjs/common";
import { and, eq, sql } from "drizzle-orm";
import sharp from "sharp";
import { DatabaseService } from "../database/database.module.js";
import { ScopeService } from "../organizations/scope.service.js";

const INPUT_MIME_BY_FORMAT: Readonly<Record<string, string>> = {
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
};

export type MediaLimits = {
  maxBytes: number;
  maxPixels: number;
  maxWidth: number;
  maxHeight: number;
};

const DEFAULT_LIMITS: MediaLimits = {
  maxBytes: 8 * 1024 * 1024,
  maxPixels: 20_000_000,
  maxWidth: 6_000,
  maxHeight: 6_000,
};

export class MediaValidationError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "MediaValidationError";
  }
}

export async function inspectAndRecodeImage(
  bytes: Buffer,
  declaredMimeType: string,
  limits: MediaLimits = DEFAULT_LIMITS,
) {
  if (bytes.length === 0) throw new MediaValidationError("MEDIA_EMPTY", "A imagem está vazia.");
  if (bytes.length > limits.maxBytes)
    throw new MediaValidationError("MEDIA_TOO_LARGE", "A imagem excede o limite de bytes.");

  let metadata: Awaited<ReturnType<ReturnType<typeof sharp>["metadata"]>>;
  try {
    metadata = await sharp(bytes, {
      failOn: "error",
      limitInputPixels: limits.maxPixels,
    }).metadata();
  } catch {
    throw new MediaValidationError("MEDIA_INVALID_BYTES", "Os bytes não formam uma imagem válida.");
  }
  const actualMimeType = metadata.format ? INPUT_MIME_BY_FORMAT[metadata.format] : undefined;
  if (!actualMimeType)
    throw new MediaValidationError("MEDIA_FORMAT_NOT_ALLOWED", "Use uma imagem PNG, JPEG ou WebP.");
  if (actualMimeType !== declaredMimeType)
    throw new MediaValidationError(
      "MEDIA_MIME_MISMATCH",
      "O tipo declarado não corresponde aos bytes enviados.",
    );
  if (!metadata.width || !metadata.height)
    throw new MediaValidationError("MEDIA_DIMENSIONS_MISSING", "A imagem não informa dimensões.");
  if (
    metadata.width > limits.maxWidth ||
    metadata.height > limits.maxHeight ||
    metadata.width * metadata.height > limits.maxPixels
  )
    throw new MediaValidationError(
      "MEDIA_DIMENSIONS_EXCEEDED",
      "A imagem excede o limite de dimensões ou pixels.",
    );
  if ((metadata.pages ?? 1) !== 1)
    throw new MediaValidationError(
      "MEDIA_ANIMATION_NOT_ALLOWED",
      "Imagens animadas não são aceitas.",
    );

  const recoded = await sharp(bytes, { failOn: "error", limitInputPixels: limits.maxPixels })
    .rotate()
    .webp({ quality: 84, alphaQuality: 90, effort: 4 })
    .toBuffer();
  return {
    bytes: recoded,
    mimeType: "image/webp" as const,
    width: metadata.width,
    height: metadata.height,
    sha256: createHash("sha256").update(recoded).digest("hex"),
  };
}

@Injectable()
export class MediaService {
  constructor(
    private readonly database: DatabaseService,
    private readonly scope: ScopeService,
  ) {}

  async upload(
    identityId: string,
    organizationId: string,
    unitId: string,
    input: {
      kind: "logo" | "cover" | "product";
      declaredMimeType: string;
      contentBase64: string;
    },
  ) {
    await this.scope.requireUnitAccess(identityId, organizationId, unitId);
    await this.scope.requireOrganizationRole(identityId, organizationId, ["owner", "manager"]);
    let source: Buffer;
    try {
      source = Buffer.from(input.contentBase64, "base64");
    } catch {
      throw new BadRequestException({ code: "MEDIA_BASE64_INVALID", message: "Upload inválido." });
    }

    let recoded: Awaited<ReturnType<typeof inspectAndRecodeImage>>;
    try {
      recoded = await inspectAndRecodeImage(source, input.declaredMimeType);
    } catch (error) {
      if (error instanceof MediaValidationError) {
        const body = { code: error.code, message: error.message };
        if (error.code === "MEDIA_TOO_LARGE") throw new PayloadTooLargeException(body);
        throw new BadRequestException(body);
      }
      throw error;
    }

    const storageKey = `${organizationId}/${unitId}/${input.kind}/${recoded.sha256}.webp`;
    return this.database.db.transaction(async (tx) => {
      await tx.execute(
        sql`select pg_advisory_xact_lock(hashtext(${`media-quota:${organizationId}:${unitId}`}))`,
      );
      const [existing] = await tx
        .select()
        .from(publicMenuMediaAssets)
        .where(
          and(
            eq(publicMenuMediaAssets.organizationId, organizationId),
            eq(publicMenuMediaAssets.unitId, unitId),
            eq(publicMenuMediaAssets.kind, input.kind),
            eq(publicMenuMediaAssets.sha256, recoded.sha256),
          ),
        )
        .limit(1);
      if (existing) return this.publicMetadata(existing);

      const quotaBytes = Number(process.env.PUBLIC_MEDIA_QUOTA_BYTES ?? 100 * 1024 * 1024);
      const [usage] = await tx
        .select({ bytes: sql<number>`coalesce(sum(${publicMenuMediaAssets.byteSize}), 0)` })
        .from(publicMenuMediaAssets)
        .where(
          and(
            eq(publicMenuMediaAssets.organizationId, organizationId),
            eq(publicMenuMediaAssets.unitId, unitId),
          ),
        );
      if (Number(usage?.bytes ?? 0) + recoded.bytes.length > quotaBytes)
        throw new ConflictException({
          code: "MEDIA_QUOTA_EXCEEDED",
          message: "A cota de imagens da unidade foi atingida.",
        });

      const [created] = await tx
        .insert(publicMenuMediaAssets)
        .values({
          organizationId,
          unitId,
          kind: input.kind,
          sha256: recoded.sha256,
          storageKey,
          mimeType: recoded.mimeType,
          width: recoded.width,
          height: recoded.height,
          byteSize: recoded.bytes.length,
          bytes: recoded.bytes,
          createdByIdentityId: identityId,
        })
        .returning();
      if (!created) throw new Error("Media insert failed without a row");
      return this.publicMetadata(created);
    });
  }

  async publicAsset(slug: string, assetId: string) {
    const [publication] = await this.database.db
      .select({
        organizationId: publicMenus.organizationId,
        unitId: publicMenus.unitId,
        branding: publicMenuVersions.branding,
        items: publicMenuVersions.items,
      })
      .from(publicMenus)
      .innerJoin(publicMenuVersions, eq(publicMenuVersions.id, publicMenus.publishedVersionId))
      .where(and(eq(publicMenus.slug, slug), eq(publicMenus.active, true)))
      .limit(1);
    if (!publication) return null;
    const referenced =
      publication.branding.logoAssetId === assetId ||
      publication.branding.coverAssetId === assetId ||
      publication.items.some((item) => item.imageAssetId === assetId);
    if (!referenced) return null;
    const [asset] = await this.database.db
      .select()
      .from(publicMenuMediaAssets)
      .where(
        and(
          eq(publicMenuMediaAssets.id, assetId),
          eq(publicMenuMediaAssets.organizationId, publication.organizationId),
          eq(publicMenuMediaAssets.unitId, publication.unitId),
        ),
      )
      .limit(1);
    return asset ?? null;
  }

  private publicMetadata(asset: typeof publicMenuMediaAssets.$inferSelect) {
    return {
      id: asset.id,
      kind: asset.kind,
      mimeType: asset.mimeType,
      width: asset.width,
      height: asset.height,
      byteSize: asset.byteSize,
      sha256: asset.sha256,
      immutable: true,
    };
  }
}
