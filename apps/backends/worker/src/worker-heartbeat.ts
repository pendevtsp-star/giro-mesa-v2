import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

export const DEFAULT_WORKER_HEARTBEAT_FILE = "/tmp/giromesa-worker-heartbeat";

export function createWorkerHeartbeat(
  env: Readonly<Record<string, string | undefined>>,
  dependencies: { now?: () => number; owner?: string; pid?: number } = {},
) {
  const filePath = env.WORKER_HEARTBEAT_FILE?.trim() || DEFAULT_WORKER_HEARTBEAT_FILE;
  const cleanupOnShutdown = env.WORKER_HEARTBEAT_CLEANUP_ON_SHUTDOWN?.trim() === "true";
  const now = dependencies.now ?? Date.now;
  const owner = dependencies.owner ?? randomUUID();
  const pid = dependencies.pid ?? process.pid;
  const temporaryPath = `${filePath}.${owner}.tmp`;
  let lastPayload: string | undefined;

  return {
    async recordSuccessfulCycle() {
      const payload = `${JSON.stringify({ owner, pid, updatedAtMs: now() })}\n`;
      await mkdir(dirname(filePath), { recursive: true });
      try {
        await writeFile(temporaryPath, payload, { encoding: "utf8", mode: 0o600 });
        await rename(temporaryPath, filePath);
        lastPayload = payload;
      } catch (error) {
        await rm(temporaryPath, { force: true }).catch(() => undefined);
        throw error;
      }
    },
    async cleanup() {
      if (!cleanupOnShutdown || lastPayload === undefined) return;
      try {
        if ((await readFile(filePath, "utf8")) === lastPayload) await rm(filePath);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      }
    },
  };
}
