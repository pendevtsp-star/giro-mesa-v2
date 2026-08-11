import { OTLPLogExporter } from "@opentelemetry/exporter-logs-otlp-http";
import { OTLPMetricExporter } from "@opentelemetry/exporter-metrics-otlp-http";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { resourceFromAttributes } from "@opentelemetry/resources";
import {
  BatchLogRecordProcessor,
  type LogRecordExporter,
  type LogRecordProcessor,
  SimpleLogRecordProcessor,
} from "@opentelemetry/sdk-logs";
import {
  type MetricReader,
  PeriodicExportingMetricReader,
  type PushMetricExporter,
} from "@opentelemetry/sdk-metrics";
import { NodeSDK } from "@opentelemetry/sdk-node";
import type { Sampler, SpanExporter, SpanProcessor } from "@opentelemetry/sdk-trace-base";
import {
  AlwaysOffSampler,
  AlwaysOnSampler,
  BatchSpanProcessor,
  ParentBasedSampler,
  SimpleSpanProcessor,
  TraceIdRatioBasedSampler,
} from "@opentelemetry/sdk-trace-base";

type TelemetryEnvironment = Readonly<Record<string, string | undefined>>;
type DeploymentEnvironment = "local" | "test" | "staging" | "production";
type SignalName = "traces" | "metrics" | "logs";

export interface OtlpSignalConfig {
  readonly url: string;
  readonly headers: Readonly<Record<string, string>>;
  readonly timeoutMillis: number;
}

export interface TelemetryConfig {
  readonly serviceName: string;
  readonly serviceVersion: string;
  readonly deploymentEnvironment: DeploymentEnvironment;
  readonly traces: OtlpSignalConfig;
  readonly metrics: OtlpSignalConfig;
  readonly logs: OtlpSignalConfig;
  readonly metricExportIntervalMillis: number;
  readonly sampler: Sampler;
}

export interface TelemetryRuntime {
  start(): Promise<void>;
  forceFlush(): Promise<void>;
  shutdown(): Promise<void>;
}

export interface TelemetryRuntimeComponents {
  readonly traceExporter?: SpanExporter;
  readonly metricExporter?: PushMetricExporter;
  readonly logExporter?: LogRecordExporter;
  readonly simpleProcessors?: boolean;
}

const SERVICE_PATTERN = /^[a-z][a-z0-9._-]{2,63}$/;
const VERSION_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._+-]{0,31}$/;
const HEADER_NAME_PATTERN = /^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/;
const DEPLOYMENT_ENVIRONMENTS = new Set<DeploymentEnvironment>([
  "local",
  "test",
  "staging",
  "production",
]);
const SIGNAL_ENV_NAMES: Readonly<Record<SignalName, string>> = {
  traces: "TRACES",
  metrics: "METRICS",
  logs: "LOGS",
};

function invalid(name: string): never {
  throw new Error(`Invalid telemetry configuration: ${name}`);
}

function parseInteger(
  env: TelemetryEnvironment,
  name: string,
  fallback: number,
  minimum: number,
  maximum: number,
) {
  const raw = env[name];
  if (raw === undefined) return fallback;
  if (!/^\d+$/.test(raw)) invalid(name);
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) invalid(name);
  return value;
}

function parseHeaders(raw: string | undefined, name: string) {
  const headers: Record<string, string> = {};
  if (raw === undefined || raw === "") return headers;
  for (const pair of raw.split(",")) {
    const separator = pair.indexOf("=");
    if (separator <= 0) invalid(name);
    try {
      const key = decodeURIComponent(pair.slice(0, separator).trim());
      const value = decodeURIComponent(pair.slice(separator + 1).trim());
      if (!HEADER_NAME_PATTERN.test(key) || value.length === 0 || /[\r\n\0]/.test(value)) {
        invalid(name);
      }
      headers[key.toLowerCase()] = value;
    } catch {
      invalid(name);
    }
  }
  return headers;
}

function parseBoolean(env: TelemetryEnvironment, name: string, fallback: boolean) {
  const raw = env[name];
  if (raw === undefined) return fallback;
  if (raw === "true") return true;
  if (raw === "false") return false;
  return invalid(name);
}

function validateEndpoint(raw: string, name: string, insecure: boolean) {
  let endpoint: URL;
  try {
    endpoint = new URL(raw);
  } catch {
    return invalid(name);
  }
  if (
    (endpoint.protocol !== "https:" && endpoint.protocol !== "http:") ||
    endpoint.username !== "" ||
    endpoint.password !== "" ||
    endpoint.search !== "" ||
    endpoint.hash !== ""
  ) {
    invalid(name);
  }
  if (endpoint.protocol === "http:" && !insecure) {
    invalid("OTEL_EXPORTER_OTLP_INSECURE");
  }
  return endpoint;
}

function appendSignalPath(endpoint: URL, signal: SignalName) {
  const basePath = endpoint.pathname.replace(/\/+$/, "");
  endpoint.pathname = `${basePath}/v1/${signal}`;
  return endpoint.toString();
}

function parseSignalConfig(
  env: TelemetryEnvironment,
  signal: SignalName,
  insecure: boolean,
): OtlpSignalConfig {
  const suffix = SIGNAL_ENV_NAMES[signal];
  const specificName = `OTEL_EXPORTER_OTLP_${suffix}_ENDPOINT`;
  const specificEndpoint = env[specificName];
  const commonEndpoint = env.OTEL_EXPORTER_OTLP_ENDPOINT;
  if (!specificEndpoint && !commonEndpoint) invalid("OTEL_EXPORTER_OTLP_ENDPOINT");
  const endpoint = validateEndpoint(
    specificEndpoint ?? commonEndpoint ?? "",
    specificName,
    insecure,
  );
  const url = specificEndpoint ? endpoint.toString() : appendSignalPath(endpoint, signal);

  const commonHeaders = parseHeaders(env.OTEL_EXPORTER_OTLP_HEADERS, "OTEL_EXPORTER_OTLP_HEADERS");
  const signalHeaders = parseHeaders(
    env[`OTEL_EXPORTER_OTLP_${suffix}_HEADERS`],
    `OTEL_EXPORTER_OTLP_${suffix}_HEADERS`,
  );
  const timeoutMillis = parseInteger(
    env,
    `OTEL_EXPORTER_OTLP_${suffix}_TIMEOUT`,
    parseInteger(env, "OTEL_EXPORTER_OTLP_TIMEOUT", 10_000, 100, 60_000),
    100,
    60_000,
  );
  const protocolName = `OTEL_EXPORTER_OTLP_${suffix}_PROTOCOL`;
  const protocol = env[protocolName] ?? env.OTEL_EXPORTER_OTLP_PROTOCOL ?? "http/protobuf";
  if (protocol !== "http/protobuf") invalid(protocolName);
  return {
    url,
    headers: { ...commonHeaders, ...signalHeaders },
    timeoutMillis,
  };
}

function parseSampler(env: TelemetryEnvironment): Sampler {
  const name = env.OTEL_TRACES_SAMPLER ?? "parentbased_always_on";
  const argument = env.OTEL_TRACES_SAMPLER_ARG;
  const ratioSampler = () => {
    if (argument === undefined || argument.trim() === "") invalid("OTEL_TRACES_SAMPLER_ARG");
    const ratio = Number(argument);
    if (!Number.isFinite(ratio) || ratio < 0 || ratio > 1) invalid("OTEL_TRACES_SAMPLER_ARG");
    return new TraceIdRatioBasedSampler(ratio);
  };
  if (argument !== undefined && !name.includes("traceidratio")) {
    invalid("OTEL_TRACES_SAMPLER_ARG");
  }
  switch (name) {
    case "always_on":
      return new AlwaysOnSampler();
    case "always_off":
      return new AlwaysOffSampler();
    case "traceidratio":
      return ratioSampler();
    case "parentbased_always_on":
      return new ParentBasedSampler({ root: new AlwaysOnSampler() });
    case "parentbased_always_off":
      return new ParentBasedSampler({ root: new AlwaysOffSampler() });
    case "parentbased_traceidratio":
      return new ParentBasedSampler({ root: ratioSampler() });
    default:
      return invalid("OTEL_TRACES_SAMPLER");
  }
}

export function parseTelemetryConfig(
  env: TelemetryEnvironment,
  expectedServiceName: string,
): TelemetryConfig {
  if (!SERVICE_PATTERN.test(expectedServiceName)) invalid("service.name");
  if (env.OTEL_SDK_DISABLED === "true") invalid("OTEL_SDK_DISABLED");
  if (env.OTEL_SDK_DISABLED !== undefined && env.OTEL_SDK_DISABLED !== "false") {
    invalid("OTEL_SDK_DISABLED");
  }
  const configuredServiceName = env.OTEL_SERVICE_NAME ?? expectedServiceName;
  if (configuredServiceName !== expectedServiceName) invalid("OTEL_SERVICE_NAME");
  const serviceVersion = env.OTEL_SERVICE_VERSION ?? "0.1.0";
  if (!VERSION_PATTERN.test(serviceVersion)) invalid("OTEL_SERVICE_VERSION");
  const deploymentEnvironment = env.DEPLOYMENT_ENVIRONMENT ?? "local";
  if (!DEPLOYMENT_ENVIRONMENTS.has(deploymentEnvironment as DeploymentEnvironment)) {
    invalid("DEPLOYMENT_ENVIRONMENT");
  }
  const insecure = parseBoolean(env, "OTEL_EXPORTER_OTLP_INSECURE", false);
  const metrics = parseSignalConfig(env, "metrics", insecure);
  const metricExportIntervalMillis = parseInteger(
    env,
    "OTEL_METRIC_EXPORT_INTERVAL",
    60_000,
    1_000,
    300_000,
  );
  if (metricExportIntervalMillis < metrics.timeoutMillis) {
    invalid("OTEL_METRIC_EXPORT_INTERVAL");
  }
  return {
    serviceName: expectedServiceName,
    serviceVersion,
    deploymentEnvironment: deploymentEnvironment as DeploymentEnvironment,
    traces: parseSignalConfig(env, "traces", insecure),
    metrics,
    logs: parseSignalConfig(env, "logs", insecure),
    metricExportIntervalMillis,
    sampler: parseSampler(env),
  };
}

export function createTelemetryRuntime(
  config: TelemetryConfig,
  components: TelemetryRuntimeComponents = {},
): TelemetryRuntime {
  const traceExporter =
    components.traceExporter ??
    new OTLPTraceExporter({
      url: config.traces.url,
      headers: config.traces.headers,
      timeoutMillis: config.traces.timeoutMillis,
    });
  const metricExporter =
    components.metricExporter ??
    new OTLPMetricExporter({
      url: config.metrics.url,
      headers: config.metrics.headers,
      timeoutMillis: config.metrics.timeoutMillis,
    });
  const logExporter =
    components.logExporter ??
    new OTLPLogExporter({
      url: config.logs.url,
      headers: config.logs.headers,
      timeoutMillis: config.logs.timeoutMillis,
    });
  const spanProcessor: SpanProcessor = components.simpleProcessors
    ? new SimpleSpanProcessor(traceExporter)
    : new BatchSpanProcessor(traceExporter);
  const metricReader: MetricReader = new PeriodicExportingMetricReader({
    exporter: metricExporter,
    exportIntervalMillis: config.metricExportIntervalMillis,
    exportTimeoutMillis: config.metrics.timeoutMillis,
  });
  const logProcessor: LogRecordProcessor = components.simpleProcessors
    ? new SimpleLogRecordProcessor({ exporter: logExporter })
    : new BatchLogRecordProcessor({ exporter: logExporter });
  const sdk = new NodeSDK({
    autoDetectResources: false,
    instrumentations: [],
    logRecordProcessors: [logProcessor],
    metricReaders: [metricReader],
    resourceDetectors: [],
    resource: resourceFromAttributes({
      "service.name": config.serviceName,
      "service.version": config.serviceVersion,
      "deployment.environment.name": config.deploymentEnvironment,
    }),
    sampler: config.sampler,
    spanProcessors: [spanProcessor],
  });
  let started = false;
  let shutdownPromise: Promise<void> | undefined;

  const forceFlush = async () => {
    if (!started || shutdownPromise) return;
    await Promise.all([
      spanProcessor.forceFlush(),
      metricReader.forceFlush(),
      logProcessor.forceFlush(),
    ]);
  };

  return {
    async start() {
      if (started) return;
      sdk.start();
      started = true;
    },
    forceFlush,
    async shutdown() {
      if (!started) return;
      shutdownPromise ??= (async () => {
        try {
          await Promise.all([
            spanProcessor.forceFlush(),
            metricReader.forceFlush(),
            logProcessor.forceFlush(),
          ]);
        } finally {
          await sdk.shutdown();
        }
      })();
      await shutdownPromise;
    },
  };
}

export async function startTelemetryFromEnv(
  expectedServiceName: string,
  env: TelemetryEnvironment = process.env,
) {
  const runtime = createTelemetryRuntime(parseTelemetryConfig(env, expectedServiceName));
  await runtime.start();
  return runtime;
}
