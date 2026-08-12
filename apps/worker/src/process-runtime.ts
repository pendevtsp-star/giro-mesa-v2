import { startTelemetryFromEnv, type TelemetryRuntime } from "@giromesa/observability";
import { createWorkerHeartbeat, type WorkerHeartbeat } from "./worker-heartbeat.js";

export type SupportedSignal = "SIGINT" | "SIGTERM";

interface WorkerLoop {
  expireAccessWindows(): Promise<unknown>;
  reconcileDoseClub?(): Promise<unknown>;
  runOnce(): Promise<number>;
  close(): Promise<unknown>;
}

interface WorkerProcessDependencies {
  readonly env?: Readonly<Record<string, string | undefined>>;
  readonly startTelemetry?: (
    serviceName: string,
    env: Readonly<Record<string, string | undefined>>,
  ) => Promise<TelemetryRuntime>;
  readonly createWorker?: () => Promise<WorkerLoop>;
  readonly createHeartbeat?: (env: Readonly<Record<string, string | undefined>>) => WorkerHeartbeat;
  readonly registerSignal?: (signal: SupportedSignal, handler: () => Promise<void>) => void;
  readonly sleep?: (durationMs: number) => Promise<void>;
  readonly now?: () => number;
}

export interface WorkerProcessRuntime {
  run(): Promise<void>;
  stop(): Promise<void>;
}

function registerProcessSignal(signal: SupportedSignal, handler: () => Promise<void>) {
  process.once(signal, () => {
    void handler().catch(() => {
      process.exitCode = 1;
    });
  });
}

const sleepFor = (durationMs: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, durationMs));

export async function startWorkerProcess(
  dependencies: WorkerProcessDependencies = {},
): Promise<WorkerProcessRuntime> {
  const env = dependencies.env ?? process.env;
  const startTelemetry = dependencies.startTelemetry ?? startTelemetryFromEnv;
  const telemetry = await startTelemetry("giromesa.worker", env);
  const heartbeat = (dependencies.createHeartbeat ?? createWorkerHeartbeat)(env);
  let worker: WorkerLoop;
  try {
    const createWorker =
      dependencies.createWorker ??
      (async () => {
        const { OutboxWorker } = await import("./outbox.js");
        return new OutboxWorker();
      });
    worker = await createWorker();
  } catch (error) {
    try {
      await telemetry.forceFlush();
    } finally {
      await telemetry.shutdown();
    }
    throw error;
  }

  let stopping: Promise<void> | undefined;
  let stopRequested = false;
  const stop = () => {
    stopRequested = true;
    stopping ??= (async () => {
      try {
        await worker.close();
      } finally {
        try {
          await heartbeat.cleanup();
        } finally {
          try {
            await telemetry.forceFlush();
          } finally {
            await telemetry.shutdown();
          }
        }
      }
    })();
    return stopping;
  };
  const registerSignal = dependencies.registerSignal ?? registerProcessSignal;
  registerSignal("SIGINT", stop);
  registerSignal("SIGTERM", stop);

  return {
    async run() {
      const now = dependencies.now ?? Date.now;
      const sleep = dependencies.sleep ?? sleepFor;
      let nextMaintenanceAt = 0;
      try {
        while (!stopRequested) {
          if (now() >= nextMaintenanceAt) {
            await worker.expireAccessWindows();
            await worker.reconcileDoseClub?.();
            nextMaintenanceAt = now() + 60_000;
          }
          const processed = await worker.runOnce();
          if (!stopRequested) await heartbeat.recordSuccessfulCycle();
          if (processed === 0 && !stopRequested) await sleep(1_000);
        }
      } finally {
        await stop();
      }
    },
    stop,
  };
}
