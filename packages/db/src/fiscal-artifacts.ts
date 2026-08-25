import { createHash } from "node:crypto";
import { access, mkdir, readFile, realpath, rename, unlink, writeFile } from "node:fs/promises";
import { dirname, relative, resolve, sep } from "node:path";

export type FiscalArtifactKind = "authorization_xml" | "cancellation_xml" | "danfe_pdf";
export type FiscalArtifactNamespace = "documents" | "invalidations" | "packages";

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const storageKey =
  /^fiscal\/[0-9a-f-]{36}\/[0-9a-f-]{36}\/(documents|invalidations|packages)\/[0-9a-f-]{36}\/[a-z_]+-[a-f0-9]{64}\.(xml|pdf|zip)$/;

export function validateFiscalArtifact(kind: FiscalArtifactKind, content: Buffer) {
  const maximum = kind === "danfe_pdf" ? 15 * 1024 * 1024 : 5 * 1024 * 1024;
  if (content.length === 0 || content.length > maximum)
    throw new Error("FISCAL_ARTIFACT_SIZE_INVALID");
  if (kind === "danfe_pdf") {
    if (content.subarray(0, 5).toString("ascii") !== "%PDF-")
      throw new Error("FISCAL_ARTIFACT_SIGNATURE_INVALID");
    return;
  }
  const xml = content.toString("utf8").trimStart();
  if (!xml.startsWith("<") || /<!DOCTYPE|<!ENTITY/i.test(xml))
    throw new Error("FISCAL_ARTIFACT_SIGNATURE_INVALID");
}

export async function writeFiscalArtifact(input: {
  root: string | undefined;
  organizationId: string;
  unitId: string;
  namespace: FiscalArtifactNamespace;
  entityId: string;
  name: string;
  extension: "xml" | "pdf" | "zip";
  content: Buffer;
}) {
  for (const value of [input.organizationId, input.unitId, input.entityId])
    if (!uuid.test(value)) throw new Error("FISCAL_ARTIFACT_SCOPE_INVALID");
  if (!/^[a-z_]{2,40}$/.test(input.name)) throw new Error("FISCAL_ARTIFACT_NAME_INVALID");
  const sha256 = createHash("sha256").update(input.content).digest("hex");
  const key = `fiscal/${input.organizationId}/${input.unitId}/${input.namespace}/${input.entityId}/${input.name}-${sha256}.${input.extension}`;
  const root = resolve(input.root?.trim() || "data/media");
  const target = resolve(root, ...key.split("/"));
  if (relative(root, target).startsWith(`..${sep}`))
    throw new Error("FISCAL_ARTIFACT_PATH_INVALID");
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

export async function readFiscalArtifact(root: string | undefined, key: string) {
  if (!storageKey.test(key)) throw new Error("FISCAL_ARTIFACT_KEY_INVALID");
  const configuredRoot = resolve(root?.trim() || "data/media");
  const canonicalRoot = await realpath(configuredRoot);
  const canonicalFile = await realpath(resolve(canonicalRoot, ...key.split("/")));
  const path = relative(canonicalRoot, canonicalFile);
  if (!path || path.startsWith(`..${sep}`) || path === "..")
    throw new Error("FISCAL_ARTIFACT_PATH_INVALID");
  return readFile(canonicalFile);
}

export async function deleteFiscalArtifact(root: string | undefined, key: string) {
  if (!storageKey.test(key)) throw new Error("FISCAL_ARTIFACT_KEY_INVALID");
  const configuredRoot = resolve(root?.trim() || "data/media");
  const target = resolve(configuredRoot, ...key.split("/"));
  const path = relative(configuredRoot, target);
  if (!path || path.startsWith(`..${sep}`) || path === "..")
    throw new Error("FISCAL_ARTIFACT_PATH_INVALID");
  await unlink(target).catch((error: NodeJS.ErrnoException) => {
    if (error.code !== "ENOENT") throw error;
  });
}
