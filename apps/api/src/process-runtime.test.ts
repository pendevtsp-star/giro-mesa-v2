import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
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
