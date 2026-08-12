import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

export const DEFAULT_WORKER_HEARTBEAT_FILE = "/tmp/giromesa-worker-heartbeat";

export interface WorkerHeartbeat {
  recordSuccessfulCycle(): Promise<void>;
  cleanup(): Promise<void>;
}

interface WorkerHeartbeatDependencies {
  readonly now?: () => number;
  readonly owner?: string;
  readonly pid?: number;
}

function isFileNotFound(error: unknown): boolean {
  return (error as NodeJS.ErrnoException).code === "ENOENT";
}

export function createWorkerHeartbeat(
  env: Readonly<Record<string, string | undefined>>,
  dependencies: WorkerHeartbeatDependencies = {},
): WorkerHeartbeat {
  const configuredPath = env.WORKER_HEARTBEAT_FILE?.trim();
  const filePath = configuredPath || DEFAULT_WORKER_HEARTBEAT_FILE;
  const cleanupOnShutdown =
    env.WORKER_HEARTBEAT_CLEANUP_ON_SHUTDOWN?.trim().toLowerCase() === "true";
  const now = dependencies.now ?? Date.now;
  const owner = dependencies.owner ?? randomUUID();
  const pid = dependencies.pid ?? process.pid;
  const temporaryPath = `${filePath}.${owner}.tmp`;
  let lastPublishedPayload: string | undefined;

  return {
    async recordSuccessfulCycle() {
      const payload = `${JSON.stringify({ owner, pid, updatedAtMs: now() })}\n`;
      await mkdir(dirname(filePath), { recursive: true });
      try {
        await writeFile(temporaryPath, payload, { encoding: "utf8", mode: 0o600 });
        await rename(temporaryPath, filePath);
        lastPublishedPayload = payload;
      } catch (error) {
        await rm(temporaryPath, { force: true }).catch(() => undefined);
        throw error;
      }
    },
    async cleanup() {
      if (!cleanupOnShutdown || lastPublishedPayload === undefined) return;

      let currentPayload: string;
      try {
        currentPayload = await readFile(filePath, "utf8");
      } catch (error) {
        if (isFileNotFound(error)) return;
        throw error;
      }
      if (currentPayload !== lastPublishedPayload) return;

      try {
        await rm(filePath);
      } catch (error) {
        if (!isFileNotFound(error)) throw error;
      }
    },
  };
}
