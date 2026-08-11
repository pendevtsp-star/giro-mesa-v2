import assert from "node:assert/strict";
import { fork, spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { it } from "node:test";
import { fileURLToPath } from "node:url";
import type { TelemetryRuntime } from "@giromesa/observability";
import { type SupportedSignal, startApiProcess } from "./process-runtime.js";

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

it("keeps the real API entrypoint fail-closed without printing telemetry secrets", () => {
  const secret = "entrypoint-api-secret";
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
  assert.match(result.stderr, /API startup failed/);
  assert.doesNotMatch(`${result.stdout}${result.stderr}`, new RegExp(secret));
});

it("fails before creating the API when telemetry configuration is invalid", async () => {
  let applicationCreated = false;
  await assert.rejects(
    startApiProcess({
      env: {},
      createApplication: async () => {
        applicationCreated = true;
        throw new Error("must not run");
      },
      registerSignal: () => undefined,
    }),
    /OTEL_EXPORTER_OTLP_ENDPOINT/,
  );
  assert.equal(applicationCreated, false);
});

it("starts telemetry before the API and flushes it after the application closes on a signal", async () => {
  const events: string[] = [];
  const handlers = new Map<SupportedSignal, () => Promise<void>>();
  const telemetry = fakeTelemetry(events);

  const processRuntime = await startApiProcess({
    env: { PORT: "3200", HOST: "127.0.0.1" },
    startTelemetry: async () => {
      await telemetry.start();
      return telemetry;
    },
    createApplication: async () => {
      events.push("app.create");
      return {
        app: {
          async listen(port: number, host: string) {
            events.push(`app.listen:${host}:${port}`);
          },
          async close() {
            events.push("app.close");
          },
        },
      };
    },
    registerSignal(signal, handler) {
      handlers.set(signal, handler);
    },
  });

  assert.deepEqual(events, ["telemetry.start", "app.create", "app.listen:127.0.0.1:3200"]);
  await handlers.get("SIGTERM")?.();
  await processRuntime.stop();
  assert.deepEqual(events, [
    "telemetry.start",
    "app.create",
    "app.listen:127.0.0.1:3200",
    "app.close",
    "telemetry.flush",
    "telemetry.shutdown",
  ]);
});

it("shuts telemetry down when API bootstrap fails", async () => {
  const events: string[] = [];
  const telemetry = fakeTelemetry(events);
  await assert.rejects(
    startApiProcess({
      env: {},
      startTelemetry: async () => {
        await telemetry.start();
        return telemetry;
      },
      createApplication: async () => {
        events.push("app.create");
        throw new Error("bootstrap failed");
      },
      registerSignal: () => undefined,
    }),
    /bootstrap failed/,
  );
  assert.deepEqual(events, [
    "telemetry.start",
    "app.create",
    "telemetry.flush",
    "telemetry.shutdown",
  ]);
});

it("closes an application created before port validation fails", async () => {
  const events: string[] = [];
  const telemetry = fakeTelemetry(events);

  await assert.rejects(
    startApiProcess({
      env: { PORT: "0" },
      startTelemetry: async () => {
        await telemetry.start();
        return telemetry;
      },
      createApplication: async () => ({
        app: {
          async listen() {
            events.push("app.listen");
          },
          async close() {
            events.push("app.close");
          },
        },
      }),
      registerSignal: () => undefined,
    }),
    /Invalid API port configuration/,
  );
  assert.deepEqual(events, [
    "telemetry.start",
    "app.close",
    "telemetry.flush",
    "telemetry.shutdown",
  ]);
});

it("closes an application and telemetry when listen fails without masking the startup error", async () => {
  const events: string[] = [];
  const telemetry = fakeTelemetry(events);

  await assert.rejects(
    startApiProcess({
      env: { PORT: "3200" },
      startTelemetry: async () => {
        await telemetry.start();
        return telemetry;
      },
      createApplication: async () => ({
        app: {
          async listen() {
            events.push("app.listen");
            throw new Error("listen failed");
          },
          async close() {
            events.push("app.close");
          },
        },
      }),
      registerSignal: () => undefined,
    }),
    /listen failed/,
  );
  assert.deepEqual(events, [
    "telemetry.start",
    "app.listen",
    "app.close",
    "telemetry.flush",
    "telemetry.shutdown",
  ]);
});

it("keeps shutdown single-owned by the process runtime", async () => {
  const source = await readFile(
    fileURLToPath(new URL("../src/app-factory.ts", import.meta.url)),
    "utf8",
  );
  assert.doesNotMatch(source, /\.enableShutdownHooks\s*\(/);
});

async function runNestShutdownFixture(flushFails: boolean) {
  const child = fork(fileURLToPath(new URL("./process-runtime.fixture.js", import.meta.url)), [], {
    env: { ...process.env, FIXTURE_FLUSH_FAILS: String(flushFails) },
    silent: true,
  });
  const events: string[] = [];
  let stderr = "";
  child.stderr?.setEncoding("utf8");
  child.stderr?.on("data", (chunk: string) => {
    stderr += chunk;
  });

  const exit = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>(
    (resolve, reject) => {
      child.once("error", reject);
      child.once("exit", (code, signal) => resolve({ code, signal }));
    },
  );
  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(
      () => reject(new Error("Nest fixture did not become ready")),
      10_000,
    );
    child.on("message", (message: unknown) => {
      if (!message || typeof message !== "object") return;
      const event = Reflect.get(message, "event");
      if (typeof event !== "string") return;
      events.push(event);
      if (event === "ready") {
        clearTimeout(timeout);
        resolve();
      }
    });
  });
  child.send({ command: "SIGTERM" });
  const result = await exit;
  return { ...result, events, stderr };
}

it("closes a real Nest process, flushes and shuts down exactly once before exit", async () => {
  const result = await runNestShutdownFixture(false);
  assert.deepEqual(result.events, [
    "nest.started",
    "ready",
    "nest.closed",
    "telemetry.flush",
    "telemetry.shutdown",
  ]);
  assert.deepEqual({ code: result.code, signal: result.signal }, { code: 0, signal: null });
  assert.equal(result.stderr, "");
});

it("still shuts telemetry down exactly once before a failed flush exits", async () => {
  const result = await runNestShutdownFixture(true);
  assert.deepEqual(result.events, [
    "nest.started",
    "ready",
    "nest.closed",
    "telemetry.flush",
    "telemetry.shutdown",
  ]);
  assert.deepEqual({ code: result.code, signal: result.signal }, { code: 1, signal: null });
  assert.equal(result.stderr, "");
});
