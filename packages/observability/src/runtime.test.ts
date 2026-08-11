import assert from "node:assert/strict";
import { after, it } from "node:test";
import { InMemoryLogRecordExporter } from "@opentelemetry/sdk-logs";
import { AggregationTemporality, InMemoryMetricExporter } from "@opentelemetry/sdk-metrics";
import { InMemorySpanExporter } from "@opentelemetry/sdk-trace-base";
import {
  createTelemetryRuntime,
  OpenTelemetryBackend,
  parseTelemetryConfig,
  SafeTelemetry,
  type TelemetryRuntime,
} from "./index.js";

let runtime: TelemetryRuntime | undefined;

after(async () => {
  await runtime?.shutdown();
});

it("fails closed when an OTLP destination is missing", () => {
  assert.throws(() => parseTelemetryConfig({}, "giromesa.api"), /OTEL_EXPORTER_OTLP_ENDPOINT/);
});

it("rejects unsafe OTLP transport, malformed headers and invalid samplers without exposing secrets", () => {
  assert.throws(
    () =>
      parseTelemetryConfig(
        { OTEL_EXPORTER_OTLP_ENDPOINT: "http://collector:4318" },
        "giromesa.api",
      ),
    /OTEL_EXPORTER_OTLP_INSECURE/,
  );

  const secret = "super-secret-value";
  assert.throws(
    () =>
      parseTelemetryConfig(
        {
          OTEL_EXPORTER_OTLP_ENDPOINT: "https://collector.example.test",
          OTEL_EXPORTER_OTLP_HEADERS: `authorization=Bearer ${secret}\r\nx-injected=yes`,
        },
        "giromesa.api",
      ),
    (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.match(error.message, /OTEL_EXPORTER_OTLP_HEADERS/);
      assert.doesNotMatch(error.message, new RegExp(secret));
      return true;
    },
  );

  assert.throws(
    () =>
      parseTelemetryConfig(
        {
          OTEL_EXPORTER_OTLP_ENDPOINT: "https://collector.example.test",
          OTEL_TRACES_SAMPLER: "made_up",
        },
        "giromesa.api",
      ),
    /OTEL_TRACES_SAMPLER/,
  );
});

it("starts real providers and exports manual traces, metrics and logs with bounded resources", async () => {
  const traceExporter = new InMemorySpanExporter();
  const metricExporter = new InMemoryMetricExporter(AggregationTemporality.CUMULATIVE);
  const logExporter = new InMemoryLogRecordExporter();
  const config = parseTelemetryConfig(
    {
      DEPLOYMENT_ENVIRONMENT: "test",
      OTEL_EXPORTER_OTLP_ENDPOINT: "https://collector.example.test/otlp",
      OTEL_EXPORTER_OTLP_HEADERS: "authorization=Bearer%20collector-token",
      OTEL_EXPORTER_OTLP_TIMEOUT: "2500",
      OTEL_METRIC_EXPORT_INTERVAL: "3000",
      OTEL_TRACES_SAMPLER: "always_on",
    },
    "giromesa.api",
  );

  runtime = createTelemetryRuntime(config, {
    traceExporter,
    metricExporter,
    logExporter,
    simpleProcessors: true,
  });
  await runtime.start();

  const telemetry = new SafeTelemetry(new OpenTelemetryBackend("giromesa.runtime.test"));
  telemetry.span("http.server.request", 3, { outcome: "success" });
  telemetry.counter("http.server.request.count", 1, { outcome: "success" });
  telemetry.histogram("http.server.request.duration", 2, { outcome: "success" });
  telemetry.log("info", "giromesa.http.request.failed", { outcome: "success" });
  await runtime.forceFlush();

  const spans = traceExporter.getFinishedSpans();
  assert.equal(spans.length, 1);
  assert.equal(spans[0]?.name, "http.server.request");
  assert.equal(spans[0]?.resource.attributes["service.name"], "giromesa.api");
  assert.equal(spans[0]?.resource.attributes["deployment.environment.name"], "test");

  const metricNames = metricExporter
    .getMetrics()
    .flatMap((resourceMetrics) => resourceMetrics.scopeMetrics)
    .flatMap((scopeMetrics) => scopeMetrics.metrics)
    .map((metric) => metric.descriptor.name);
  assert.ok(metricNames.includes("http.server.request.count"));
  assert.ok(metricNames.includes("http.server.request.duration"));

  const logs = logExporter.getFinishedLogRecords();
  assert.equal(logs.length, 1);
  assert.equal(logs[0]?.body, "giromesa.http.request.failed");
  assert.equal(logs[0]?.resource.attributes["service.name"], "giromesa.api");
});
