import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { resolvePublicMedia } from "./public-media.js";

describe("public media", () => {
  it("serves only allowlisted regular files whose real path remains inside MEDIA_ROOT", async () => {
    const parent = await mkdtemp(join(tmpdir(), "giromesa-public-media-"));
    const root = join(parent, "root");
    const outside = join(parent, "outside.jpg");
    const key = `${"a".repeat(32)}.webp`;
    const escapedKey = `${"b".repeat(32)}.jpg`;
    try {
      await mkdir(root);
      await writeFile(join(root, key), "image");
      await writeFile(outside, "private");
      assert.deepEqual(await resolvePublicMedia(key, root), {
        path: join(root, key),
        contentType: "image/webp",
        size: 5,
      });
      assert.equal(await resolvePublicMedia("../outside.jpg", root), null);
      let symlinkCreated = false;
      try {
        await symlink(outside, join(root, escapedKey));
        symlinkCreated = true;
      } catch {
        // Windows may deny symlink creation without developer mode; traversal is still covered above.
      }
      if (symlinkCreated) assert.equal(await resolvePublicMedia(escapedKey, root), null);
    } finally {
      await rm(parent, { recursive: true, force: true });
    }
  });
});
