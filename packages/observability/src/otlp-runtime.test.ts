import assert from "node:assert/strict";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { after, before, it } from "node:test";
import {
  createTelemetryRuntime,
  OpenTelemetryBackend,
  parseTelemetryConfig,
  SafeTelemetry,
  type TelemetryRuntime,
} from "./index.js";

interface ReceivedSignal {
  authorization: string | undefined;
  bodyLength: number;
  path: string;
}

const received: ReceivedSignal[] = [];
let server: http.Server;
let runtime: TelemetryRuntime;

before(async () => {
  server = http.createServer((request, response) => {
    const chunks: Buffer[] = [];
    request.on("data", (chunk: Buffer) => chunks.push(chunk));
    request.on("end", () => {
      received.push({
        authorization: request.headers.authorization,
        bodyLength: Buffer.concat(chunks).length,
        path: request.url ?? "",
      });
      response.statusCode = 200;
      response.end();
    });
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const port = (server.address() as AddressInfo).port;
  const config = parseTelemetryConfig(
    {
      DEPLOYMENT_ENVIRONMENT: "test",
      OTEL_EXPORTER_OTLP_ENDPOINT: `http://127.0.0.1:${port}/collector`,
      OTEL_EXPORTER_OTLP_HEADERS: "authorization=Bearer%20fixture-token",
      OTEL_EXPORTER_OTLP_INSECURE: "true",
      OTEL_EXPORTER_OTLP_TIMEOUT: "1000",
      OTEL_METRIC_EXPORT_INTERVAL: "1000",
      OTEL_TRACES_SAMPLER: "always_on",
    },
    "giromesa.worker",
  );
  runtime = createTelemetryRuntime(config);
  await runtime.start();
});

after(async () => {
  await runtime.shutdown();
  server.closeAllConnections();
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
});

it("exports traces, metrics and logs through the configured OTLP HTTP collector", async () => {
  const telemetry = new SafeTelemetry(new OpenTelemetryBackend("giromesa.otlp.test"));
  telemetry.span("outbox.dispatch", 1, { outcome: "success" });
  telemetry.counter("giromesa.worker.jobs.completed", 1, { outcome: "success" });
  telemetry.log("info", "giromesa.http.request.failed", { outcome: "success" });
  await runtime.forceFlush();

  assert.deepEqual(received.map((signal) => signal.path).sort(), [
    "/collector/v1/logs",
    "/collector/v1/metrics",
    "/collector/v1/traces",
  ]);
  for (const signal of received) {
    assert.equal(signal.authorization, "Bearer fixture-token");
    assert.ok(signal.bodyLength > 0);
  }
});
