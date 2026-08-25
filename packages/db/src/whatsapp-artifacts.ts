import { createHash } from "node:crypto";
import { access, mkdir, readFile, realpath, rename, unlink, writeFile } from "node:fs/promises";
import { dirname, relative, resolve, sep } from "node:path";

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const storageKey =
  /^crm-whatsapp\/[0-9a-f-]{36}\/[0-9a-f-]{36}\/[0-9a-f-]{36}\/[a-f0-9]{64}\.(jpg|png|webp|mp4|mp3|ogg|wav|pdf)$/;

const signatures = [
  {
    mime: "image/jpeg",
    extension: "jpg",
    matches: (value: Buffer) => value.subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff])),
  },
  {
    mime: "image/png",
    extension: "png",
    matches: (value: Buffer) =>
      value.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])),
  },
  {
    mime: "image/webp",
    extension: "webp",
    matches: (value: Buffer) =>
      value.subarray(0, 4).toString("ascii") === "RIFF" &&
      value.subarray(8, 12).toString("ascii") === "WEBP",
  },
  {
    mime: "video/mp4",
    extension: "mp4",
    matches: (value: Buffer) => value.subarray(4, 8).toString("ascii") === "ftyp",
  },
  {
    mime: "audio/mp4",
    extension: "mp4",
    matches: (value: Buffer) => value.subarray(4, 8).toString("ascii") === "ftyp",
  },
  {
    mime: "audio/mpeg",
    extension: "mp3",
    matches: (value: Buffer) =>
      value.subarray(0, 3).toString("ascii") === "ID3" ||
      (value[0] === 0xff && (value[1] ?? 0) >= 0xe0),
  },
  {
    mime: "audio/ogg",
    extension: "ogg",
    matches: (value: Buffer) => value.subarray(0, 4).toString("ascii") === "OggS",
  },
  {
    mime: "audio/wav",
    extension: "wav",
    matches: (value: Buffer) =>
      value.subarray(0, 4).toString("ascii") === "RIFF" &&
      value.subarray(8, 12).toString("ascii") === "WAVE",
  },
  {
    mime: "application/pdf",
    extension: "pdf",
    matches: (value: Buffer) => value.subarray(0, 5).toString("ascii") === "%PDF-",
  },
] as const;

export function validateWhatsAppArtifact(content: Buffer, mimeType: string) {
  if (content.length === 0 || content.length > 3 * 1024 * 1024)
    throw new Error("WHATSAPP_MEDIA_SIZE_INVALID");
  const detected = signatures.find((candidate) => candidate.matches(content));
  if (!detected || detected.mime !== mimeType) throw new Error("WHATSAPP_MEDIA_SIGNATURE_INVALID");
  return detected.extension;
}

export async function writeWhatsAppArtifact(input: {
  root: string | undefined;
  organizationId: string;
  unitId: string;
  messageId: string;
  mimeType: string;
  content: Buffer;
}) {
  for (const value of [input.organizationId, input.unitId, input.messageId])
    if (!uuid.test(value)) throw new Error("WHATSAPP_MEDIA_SCOPE_INVALID");
  const extension = validateWhatsAppArtifact(input.content, input.mimeType);
  const sha256 = createHash("sha256").update(input.content).digest("hex");
  const key = `crm-whatsapp/${input.organizationId}/${input.unitId}/${input.messageId}/${sha256}.${extension}`;
  const root = resolve(input.root?.trim() || "data/media");
  const target = resolve(root, ...key.split("/"));
  if (relative(root, target).startsWith(`..${sep}`)) throw new Error("WHATSAPP_MEDIA_PATH_INVALID");
  await mkdir(dirname(target), { recursive: true });
  try {
    await access(target);
  } catch {
    const temporary = `${target}.${process.pid}.tmp`;
    try {
      await writeFile(temporary, input.content, { flag: "wx" });
      await rename(temporary, target);
    } catch (error) {
      await unlink(temporary).catch(() => undefined);
      throw error;
    }
  }
  return { storageKey: key, sha256, bytes: input.content.length };
}

export async function readWhatsAppArtifact(root: string | undefined, key: string) {
  if (!storageKey.test(key)) throw new Error("WHATSAPP_MEDIA_KEY_INVALID");
  const configuredRoot = resolve(root?.trim() || "data/media");
  const canonicalRoot = await realpath(configuredRoot);
  const canonicalFile = await realpath(resolve(canonicalRoot, ...key.split("/")));
  const path = relative(canonicalRoot, canonicalFile);
  if (!path || path === ".." || path.startsWith(`..${sep}`))
    throw new Error("WHATSAPP_MEDIA_PATH_INVALID");
  return readFile(canonicalFile);
}

export async function deleteWhatsAppArtifact(root: string | undefined, key: string) {
  if (!storageKey.test(key)) throw new Error("WHATSAPP_MEDIA_KEY_INVALID");
  const configuredRoot = resolve(root?.trim() || "data/media");
  const target = resolve(configuredRoot, ...key.split("/"));
  const path = relative(configuredRoot, target);
  if (!path || path === ".." || path.startsWith(`..${sep}`))
    throw new Error("WHATSAPP_MEDIA_PATH_INVALID");
  await unlink(target).catch((error: NodeJS.ErrnoException) => {
    if (error.code !== "ENOENT") throw error;
  });
}
