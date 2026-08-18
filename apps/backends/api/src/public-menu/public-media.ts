import { realpath, stat } from "node:fs/promises";
import { dirname, resolve } from "node:path";

const mediaKeyPattern = /^[a-f0-9]{32}\.(jpg|png|webp)$/;
const mediaTypes: Record<string, string> = {
  jpg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
};

export type PublicMediaFile = { path: string; contentType: string; size: number };

export async function resolvePublicMedia(
  key: string,
  configuredRoot: string | undefined,
): Promise<PublicMediaFile | null> {
  const match = mediaKeyPattern.exec(key);
  if (!match || !configuredRoot?.trim()) return null;
  try {
    const root = await realpath(resolve(configuredRoot));
    const file = await realpath(resolve(root, key));
    if (dirname(file) !== root) return null;
    const details = await stat(file);
    if (!details.isFile()) return null;
    const contentType = mediaTypes[match[1] ?? ""];
    return contentType ? { path: file, contentType, size: details.size } : null;
  } catch {
    return null;
  }
}
