import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { it } from "node:test";
import { fileURLToPath } from "node:url";
import type { TelemetryRuntime } from "@giromesa/observability";
import {
  type SupportedSignal,
  startWorkerProcess,
  type WorkerProcessRuntime,
} from "./process-runtime.js";

function fakeTelemetry(events: string[]): TelemetryRuntime {
  return {
    async start() {
      events.push("telemetry.start");
    },
    async forceFlush() {
      events.push("telemetry.flush");
    },
    async shutdown() {
      events.push("telemetry.shutdown");
    },
  };
}

it("keeps the real worker entrypoint fail-closed without printing telemetry secrets", () => {
  const secret = "entrypoint-worker-secret";
  const env = { ...process.env };
  for (const name of [
    "OTEL_EXPORTER_OTLP_ENDPOINT",
    "OTEL_EXPORTER_OTLP_TRACES_ENDPOINT",
    "OTEL_EXPORTER_OTLP_METRICS_ENDPOINT",
    "OTEL_EXPORTER_OTLP_LOGS_ENDPOINT",
  ]) {
    delete env[name];
  }
  env.OTEL_EXPORTER_OTLP_HEADERS = `authorization=${secret}`;
  const result = spawnSync(
    process.execPath,
    [fileURLToPath(new URL("./main.js", import.meta.url))],
    {
      encoding: "utf8",
      env,
      timeout: 10_000,
    },
  );

  assert.equal(result.status, 1);
  assert.match(result.stderr, /Worker startup or runtime failed/);
  assert.doesNotMatch(`${result.stdout}${result.stderr}`, new RegExp(secret));
});

it("fails before creating the worker when telemetry configuration is invalid", async () => {
  let workerCreated = false;
  await assert.rejects(
    startWorkerProcess({
      env: {},
      createWorker: async () => {
        workerCreated = true;
        throw new Error("must not run");
      },
      registerSignal: () => undefined,
    }),
    /OTEL_EXPORTER_OTLP_ENDPOINT/,
  );
  assert.equal(workerCreated, false);
});

it("starts telemetry before the worker and closes both once on a signal", async () => {
  const events: string[] = [];
  const handlers = new Map<SupportedSignal, () => Promise<void>>();
  const telemetry = fakeTelemetry(events);
  const processRuntime = await startWorkerProcess({
    env: {},
    startTelemetry: async () => {
      await telemetry.start();
      return telemetry;
    },
    createWorker: async () => {
      events.push("worker.create");
      return {
        async expireAccessWindows() {
          events.push("worker.maintenance");
        },
        async runOnce() {
          events.push("worker.run");
          return 0;
        },
        async close() {
          events.push("worker.close");
        },
      };
    },
    registerSignal(signal, handler) {
      handlers.set(signal, handler);
    },
    sleep: async () => undefined,
  });

  assert.deepEqual(events, ["telemetry.start", "worker.create"]);
  await handlers.get("SIGINT")?.();
  await processRuntime.stop();
  assert.deepEqual(events, [
    "telemetry.start",
    "worker.create",
    "worker.close",
    "telemetry.flush",
    "telemetry.shutdown",
  ]);
});

it("runs DoseClub reconciliation before the generic outbox cycle", async () => {
  const events: string[] = [];
  const telemetry = fakeTelemetry(events);
  let processRuntime: WorkerProcessRuntime | undefined;
  processRuntime = await startWorkerProcess({
    env: {},
    startTelemetry: async () => {
      await telemetry.start();
      return telemetry;
    },
    createWorker: async () => ({
      async expireAccessWindows() {
        events.push("worker.maintenance");
      },
      async reconcileDoseClub() {
        events.push("worker.doseclub");
      },
      async runOnce() {
        events.push("worker.run");
        await processRuntime?.stop();
        return 0;
      },
      async close() {
        events.push("worker.close");
      },
    }),
    registerSignal: () => undefined,
    now: () => 1,
    sleep: async () => {
      throw new Error("sleep should not run after stop");
    },
  });

  await processRuntime.run();
  assert.deepEqual(events, [
    "telemetry.start",
    "worker.maintenance",
    "worker.doseclub",
    "worker.run",
    "worker.close",
    "telemetry.flush",
    "telemetry.shutdown",
  ]);
});

it("records a heartbeat only after a successful worker cycle", async () => {
  const events: string[] = [];
  const telemetry = fakeTelemetry(events);
  let processRuntime: WorkerProcessRuntime | undefined;
  processRuntime = await startWorkerProcess({
    env: {},
    startTelemetry: async () => {
      await telemetry.start();
      return telemetry;
    },
    createWorker: async () => ({
      async expireAccessWindows() {
        events.push("worker.maintenance");
      },
      async runOnce() {
        events.push("worker.run");
        return 0;
      },
      async close() {
        events.push("worker.close");
      },
    }),
    createHeartbeat: () => ({
      async recordSuccessfulCycle() {
        events.push("heartbeat.record");
      },
      async cleanup() {
        events.push("heartbeat.cleanup");
      },
    }),
    registerSignal: () => undefined,
    now: () => 1,
    sleep: async () => {
      await processRuntime?.stop();
    },
  });

  await processRuntime.run();
  assert.deepEqual(events, [
    "telemetry.start",
    "worker.maintenance",
    "worker.run",
    "heartbeat.record",
    "worker.close",
    "heartbeat.cleanup",
    "telemetry.flush",
    "telemetry.shutdown",
  ]);
});

it("does not update the heartbeat when a worker cycle fails", async () => {
  const events: string[] = [];
  const telemetry = fakeTelemetry(events);
  const processRuntime = await startWorkerProcess({
    env: {},
    startTelemetry: async () => {
      await telemetry.start();
      return telemetry;
    },
    createWorker: async () => ({
      async expireAccessWindows() {
        events.push("worker.maintenance");
      },
      async runOnce() {
        events.push("worker.run");
        throw new Error("cycle failed");
      },
      async close() {
        events.push("worker.close");
      },
    }),
    createHeartbeat: () => ({
      async recordSuccessfulCycle() {
        events.push("heartbeat.record");
      },
      async cleanup() {
        events.push("heartbeat.cleanup");
      },
    }),
    registerSignal: () => undefined,
    now: () => 1,
  });

  await assert.rejects(processRuntime.run(), /cycle failed/);
  assert.deepEqual(events, [
    "telemetry.start",
    "worker.maintenance",
    "worker.run",
    "worker.close",
    "heartbeat.cleanup",
    "telemetry.flush",
    "telemetry.shutdown",
  ]);
});

it("flushes telemetry when worker construction fails", async () => {
  const events: string[] = [];
  const telemetry = fakeTelemetry(events);
  await assert.rejects(
    startWorkerProcess({
      env: {},
      startTelemetry: async () => {
        await telemetry.start();
        return telemetry;
      },
      createWorker: async () => {
        events.push("worker.create");
        throw new Error("worker failed");
      },
      registerSignal: () => undefined,
    }),
    /worker failed/,
  );
  assert.deepEqual(events, [
    "telemetry.start",
    "worker.create",
    "telemetry.flush",
    "telemetry.shutdown",
  ]);
});
