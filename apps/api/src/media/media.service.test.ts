import assert from "node:assert/strict";
import { describe, it } from "node:test";
import sharp from "sharp";
import { inspectAndRecodeImage } from "./media.service.js";

describe("public image ingestion", () => {
  it("recodes raster uploads to metadata-free WebP", async () => {
    const source = await sharp({
      create: { width: 64, height: 48, channels: 4, background: "#155e75" },
    })
      .png()
      .withMetadata({ orientation: 6 })
      .toBuffer();

    const result = await inspectAndRecodeImage(source, "image/png", {
      maxBytes: 100_000,
      maxPixels: 10_000,
      maxWidth: 256,
      maxHeight: 256,
    });

    assert.equal(result.mimeType, "image/webp");
    assert.equal(result.width, 64);
    assert.equal(result.height, 48);
    assert.match(result.sha256, /^[a-f0-9]{64}$/);
    const metadata = await sharp(result.bytes).metadata();
    assert.equal(metadata.format, "webp");
    assert.equal(metadata.exif, undefined);
    assert.equal(metadata.icc, undefined);
    assert.equal(metadata.orientation, undefined);
  });

  it("rejects declared MIME that disagrees with the encoded bytes", async () => {
    const source = await sharp({
      create: { width: 8, height: 8, channels: 3, background: "#ffffff" },
    })
      .jpeg()
      .toBuffer();

    await assert.rejects(
      inspectAndRecodeImage(source, "image/png"),
      (error: unknown) => (error as { code?: string }).code === "MEDIA_MIME_MISMATCH",
    );
  });
});
