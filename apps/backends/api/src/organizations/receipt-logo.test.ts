import assert from "node:assert/strict";
import test from "node:test";
import sharp from "sharp";
import type { DatabaseService } from "../database/database.module.js";
import { monochromeReceiptLogo, receiptLogoRaster } from "./receipt-logo.js";

test("receipt logo packs black pixels MSB-first and white-pads partial bytes", async () => {
  const bytes = await sharp(Buffer.from([0, 255, 0, 255, 0, 255, 0, 255, 0]), {
    raw: { width: 9, height: 1, channels: 1 },
  })
    .png()
    .toBuffer();
  const logo = await monochromeReceiptLogo(bytes);
  assert.equal(logo.widthDots, 9);
  assert.equal(logo.heightDots, 1);
  assert.deepEqual([...Buffer.from(logo.dataBase64, "base64")], [0xaa, 0x80]);
});

test("receipt logo bounds both paper widths and composites transparency onto white", async () => {
  const bytes = await sharp({
    create: {
      width: 1000,
      height: 1000,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    },
  })
    .png()
    .toBuffer();
  const logo = await monochromeReceiptLogo(bytes);
  assert.ok(logo.widthDots <= 384 && logo.heightDots <= 160);
  assert.ok(Buffer.from(logo.dataBase64, "base64").every((byte) => byte === 0));
  await assert.rejects(() => monochromeReceiptLogo(Buffer.alloc(2_000_001)));
});

test("receipt logo does not fetch arbitrary URLs or read unowned media", async () => {
  const neverQuery = {} as DatabaseService;
  assert.equal(await receiptLogoRaster(neverQuery, "org", "unit", "http://127.0.0.1/secret"), null);
  assert.equal(await receiptLogoRaster(neverQuery, "org", "unit", "file:///etc/passwd"), null);
  const database = {
    db: { select: () => ({ from: () => ({ where: () => ({ limit: async () => [] }) }) }) },
  } as unknown as DatabaseService;
  assert.equal(
    await receiptLogoRaster(
      database,
      "org",
      "unit",
      `https://example.test/public/v1/media/${"a".repeat(32)}.png`,
    ),
    null,
  );
});
