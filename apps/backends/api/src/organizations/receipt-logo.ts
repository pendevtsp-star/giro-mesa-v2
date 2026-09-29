import { readFile } from "node:fs/promises";
import type { PrintDocumentPayloadV2 } from "@giromesa/contracts";
import { auditEvents } from "@giromesa/db";
import { and, eq } from "drizzle-orm";
import sharp from "sharp";
import type { DatabaseService } from "../database/database.module.js";
import { resolvePublicMedia } from "../public-menu/public-media.js";

type LogoRaster = NonNullable<PrintDocumentPayloadV2["establishment"]["logoRaster"]>;

/** A single monochrome snapshot fits both 58 and 80 mm printers. */
export async function monochromeReceiptLogo(bytes: Buffer): Promise<LogoRaster> {
  if (bytes.length > 2_000_000) throw new Error("RECEIPT_LOGO_TOO_LARGE");
  const { data, info } = await sharp(bytes, { limitInputPixels: 16_000_000, animated: false })
    .rotate()
    .flatten({ background: "#ffffff" })
    .resize({ width: 384, height: 160, fit: "inside", withoutEnlargement: true })
    .greyscale()
    .threshold(160)
    .raw()
    .toBuffer({ resolveWithObject: true });
  const stride = Math.ceil(info.width / 8);
  const raster = Buffer.alloc(stride * info.height);
  for (let y = 0; y < info.height; y++) {
    for (let x = 0; x < info.width; x++) {
      if ((data[(y * info.width + x) * info.channels] ?? 255) < 128) {
        const offset = y * stride + Math.floor(x / 8);
        raster[offset] = (raster[offset] ?? 0) | (0x80 >> (x % 8));
      }
    }
  }
  return {
    encoding: "escpos-raster",
    widthDots: info.width,
    heightDots: info.height,
    dataBase64: raster.toString("base64"),
  };
}

/** Reads only media uploaded by this unit. Never fetches a user-controlled URL. */
export async function receiptLogoRaster(
  database: DatabaseService,
  organizationId: string,
  unitId: string,
  logoUrl: string | null | undefined,
): Promise<LogoRaster | null> {
  if (!logoUrl) return null;
  let key: string;
  try {
    const match = /^\/public\/v1\/media\/([a-f0-9]{32}\.(?:jpg|png|webp))$/.exec(
      new URL(logoUrl).pathname,
    );
    if (!match?.[1]) return null;
    key = match[1];
  } catch {
    return null;
  }
  const [owned] = await database.db
    .select({ id: auditEvents.id })
    .from(auditEvents)
    .where(
      and(
        eq(auditEvents.organizationId, organizationId),
        eq(auditEvents.unitId, unitId),
        eq(auditEvents.action, "media.uploaded"),
        eq(auditEvents.entityId, key),
      ),
    )
    .limit(1);
  if (!owned) return null;
  const file = await resolvePublicMedia(key, process.env.MEDIA_ROOT ?? "data/media");
  if (!file || file.size > 2_000_000) return null;
  try {
    return await monochromeReceiptLogo(await readFile(file.path));
  } catch {
    // A missing/corrupt optional logo must not prevent the operational document.
    return null;
  }
}
