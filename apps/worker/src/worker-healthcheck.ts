import { stat } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { DEFAULT_WORKER_HEARTBEAT_FILE } from "./worker-heartbeat.js";

export const DEFAULT_WORKER_HEARTBEAT_MAX_AGE_MS = 30_000;

export async function checkWorkerHeartbeat(
  env: Readonly<Record<string, string | undefined>> = process.env,
  now: () => number = Date.now,
): Promise<boolean> {
  const configuredPath = env.WORKER_HEARTBEAT_FILE?.trim();
  const filePath = configuredPath || DEFAULT_WORKER_HEARTBEAT_FILE;
  const configuredMaxAge = env.WORKER_HEARTBEAT_MAX_AGE_MS?.trim();
  const maxAgeMs = configuredMaxAge
    ? Number(configuredMaxAge)
    : DEFAULT_WORKER_HEARTBEAT_MAX_AGE_MS;
  if (!Number.isFinite(maxAgeMs) || maxAgeMs <= 0) return false;

  try {
    const ageMs = now() - (await stat(filePath)).mtimeMs;
    return ageMs >= 0 && ageMs <= maxAgeMs;
  } catch {
    return false;
  }
}

const isEntrypoint = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isEntrypoint && !(await checkWorkerHeartbeat())) process.exitCode = 1;
