import { stat } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { DEFAULT_WORKER_HEARTBEAT_FILE } from "./worker-heartbeat.js";

export async function checkWorkerHeartbeat(
  env: Readonly<Record<string, string | undefined>> = process.env,
  now: () => number = Date.now,
) {
  const filePath = env.WORKER_HEARTBEAT_FILE?.trim() || DEFAULT_WORKER_HEARTBEAT_FILE;
  const maxAgeMs = Number(env.WORKER_HEARTBEAT_MAX_AGE_MS?.trim() || 30_000);
  if (!Number.isFinite(maxAgeMs) || maxAgeMs <= 0) return false;
  try {
    const ageMs = now() - (await stat(filePath)).mtimeMs;
    return ageMs >= 0 && ageMs <= maxAgeMs;
  } catch {
    return false;
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  if (!(await checkWorkerHeartbeat())) process.exitCode = 1;
}
