import {
  type Attributes,
  type Counter,
  type Histogram,
  metrics,
  SpanStatusCode,
  trace,
} from "@opentelemetry/api";

export type TelemetryAttributeValue = string | number | boolean;
export type TelemetryAttributes = Record<string, TelemetryAttributeValue>;
export type UnsafeTelemetryAttributes = Readonly<Record<string, unknown>>;

export type TelemetrySignal =
  | {
      kind: "counter" | "histogram";
      name: string;
      value: number;
      attributes: TelemetryAttributes;
    }
  | {
      kind: "log";
      name: string;
      severity: "debug" | "info" | "warn" | "error";
      attributes: TelemetryAttributes;
    }
  | {
      kind: "span";
      name: string;
      durationMs: number;
      attributes: TelemetryAttributes;
    };

export interface TelemetryBackend {
  emit(signal: TelemetrySignal): void;
}

type AttributeValidator = (value: unknown) => TelemetryAttributeValue | null;

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const UUID_FRAGMENT_PATTERN =
  /[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/i;
const TOKEN_PATTERN = /^[A-Za-z][A-Za-z0-9._:-]{0,95}$/;
const ROUTE_PATTERN = /^\/[A-Za-z0-9._~:/-]{0,159}$/;
const EMAIL_PATTERN = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i;
const BEARER_PATTERN = /\bbearer\s+[A-Za-z0-9._~+/=-]{4,}/i;
const JWT_PATTERN = /\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/;
const PAN_PATTERN = /(?:\d[ -]?){13,19}/;
const TRACK_PATTERN = /(?:%B\d{13,19}\^|;\d{13,19}=)/i;
const SECRET_PREFIX_PATTERN = /\b(?:sk|pk)_(?:live|test)_[A-Za-z0-9_-]{8,}\b/i;
const LONG_TOKEN_PATTERN = /^[A-Za-z0-9_-]{32,}$/;
const PREFIXED_PIN_PATTERN = /(?:^|[^a-z0-9])pin[\s._:-]*(?:\d[\s._:-]*){4,12}(?:$|[^0-9])/i;
const PREFIXED_CVV_PATTERN = /(?:^|[^a-z0-9])cvv[\s._:-]*(?:\d[\s._:-]*){3,4}(?:$|[^0-9])/i;
const PREFIXED_DOCUMENT_PATTERN =
  /(?:^|[^a-z0-9])(?:cpf|cnpj|documento?|doc)[\s._:-]*(?:\d[\s./-]*){11,14}(?:$|[^0-9])/i;
const PREFIXED_PHONE_PATTERN =
  /(?:^|[^a-z0-9])(?:phone|telefone|tel)[\s._:+-]*(?:\d[\s().+-]*){8,15}(?:$|[^0-9])/i;
const PREFIXED_COOKIE_PATTERN =
  /(?:^|[^a-z0-9])(?:cookie|session)[\s._:-]+(?=[a-z0-9._:=+-]{4,})(?=[a-z0-9._:=+-]*(?:[0-9=._:-]))[a-z0-9._:=+-]+/i;

const stringEnum = (...allowed: string[]): AttributeValidator => {
  const values = new Set(allowed);
  return (value) => (typeof value === "string" && values.has(value) ? value : null);
};

const token: AttributeValidator = (value) =>
  typeof value === "string" && TOKEN_PATTERN.test(value) && !containsSensitiveValue(value)
    ? value
    : null;
const uuid: AttributeValidator = (value) =>
  typeof value === "string" && UUID_PATTERN.test(value) ? value.toLowerCase() : null;
const statusCode: AttributeValidator = (value) =>
  typeof value === "number" && Number.isInteger(value) && value >= 100 && value <= 599
    ? value
    : null;
const route: AttributeValidator = (value) => {
  if (typeof value !== "string" || !ROUTE_PATTERN.test(value) || value.includes("//")) return null;
  if (UUID_FRAGMENT_PATTERN.test(value) || /\/(?:\d{2,})(?:\/|$)/.test(value)) return null;
  return value;
};

const ATTRIBUTE_VALIDATORS: Readonly<Record<string, AttributeValidator>> = {
  "service.name": token,
  "deployment.environment": stringEnum("local", "test", "staging", "production"),
  "http.request.method": stringEnum("GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS", "HEAD"),
  "http.route": route,
  "http.response.status_code": statusCode,
  "organization.id": uuid,
  "unit.id": uuid,
  "device.id": uuid,
  "device.type": stringEnum("ops", "kds", "pos", "edge", "worker", "customer"),
  "job.type": token,
  "queue.name": token,
  "messaging.operation.name": token,
  "error.type": token,
  "error.code": token,
  outcome: stringEnum("success", "error", "retry", "timeout", "rejected"),
};

function containsSensitiveValue(value: string) {
  const normalized = value.normalize("NFKC");
  return (
    EMAIL_PATTERN.test(normalized) ||
    BEARER_PATTERN.test(normalized) ||
    JWT_PATTERN.test(normalized) ||
    PAN_PATTERN.test(normalized) ||
    TRACK_PATTERN.test(normalized) ||
    SECRET_PREFIX_PATTERN.test(normalized) ||
    LONG_TOKEN_PATTERN.test(normalized) ||
    PREFIXED_PIN_PATTERN.test(normalized) ||
    PREFIXED_CVV_PATTERN.test(normalized) ||
    PREFIXED_DOCUMENT_PATTERN.test(normalized) ||
    PREFIXED_PHONE_PATTERN.test(normalized) ||
    PREFIXED_COOKIE_PATTERN.test(normalized)
  );
}

export function redactTelemetryAttributes(source: UnsafeTelemetryAttributes): TelemetryAttributes {
  const sanitized: TelemetryAttributes = {};
  let dropped = 0;
  let redacted = 0;

  for (const [key, value] of Object.entries(source)) {
    const validator = ATTRIBUTE_VALIDATORS[key];
    if (!validator) {
      dropped += 1;
      continue;
    }
    const accepted = validator(value);
    if (accepted !== null) {
      sanitized[key] = accepted;
      continue;
    }
    if (key === "http.route") {
      dropped += 1;
      continue;
    }
    if (typeof value === "string" && containsSensitiveValue(value)) {
      sanitized[key] = "[REDACTED]";
      redacted += 1;
      continue;
    }
    dropped += 1;
  }

  if (dropped > 0) sanitized["telemetry.dropped_attributes_count"] = dropped;
  if (redacted > 0) sanitized["telemetry.redacted_attributes_count"] = redacted;
  return sanitized;
}

export const DEFAULT_CARDINALITY_BUDGETS: Readonly<Record<string, number>> = {
  "service.name": 16,
  "deployment.environment": 8,
  "http.request.method": 8,
  "http.route": 256,
  "http.response.status_code": 64,
  "organization.id": 1_000,
  "unit.id": 5_000,
  "device.id": 50_000,
  "device.type": 8,
  "job.type": 128,
  "queue.name": 64,
  "messaging.operation.name": 32,
  "error.type": 128,
  "error.code": 256,
  outcome: 8,
};

export class CardinalityGuard {
  private readonly retained = new Map<string, Set<string>>();
  private readonly overflowed = new Map<string, number>();

  constructor(private readonly budgets = DEFAULT_CARDINALITY_BUDGETS) {
    for (const [key, limit] of Object.entries(budgets)) {
      if (!Number.isInteger(limit) || limit < 1) {
        throw new Error(`Invalid cardinality budget for ${key}`);
      }
    }
  }

  apply(attributes: TelemetryAttributes): TelemetryAttributes {
    const bounded = { ...attributes };
    let overflowCount = 0;
    for (const [key, limit] of Object.entries(this.budgets)) {
      const value = bounded[key];
      if (value === undefined) continue;
      const serialized = `${typeof value}:${String(value)}`;
      const retained = this.retained.get(key) ?? new Set<string>();
      this.retained.set(key, retained);
      if (retained.has(serialized)) continue;
      if (retained.size < limit) {
        retained.add(serialized);
        continue;
      }
      bounded[key] = "__overflow__";
      overflowCount += 1;
      this.overflowed.set(key, (this.overflowed.get(key) ?? 0) + 1);
    }
    if (overflowCount > 0) bounded["telemetry.cardinality_overflow_count"] = overflowCount;
    return bounded;
  }

  snapshot(): Record<string, { limit: number; retained: number; overflowed: number }> {
    return Object.fromEntries(
      Object.entries(this.budgets).map(([key, limit]) => [
        key,
        {
          limit,
          retained: this.retained.get(key)?.size ?? 0,
          overflowed: this.overflowed.get(key) ?? 0,
        },
      ]),
    );
  }
}

const SIGNAL_NAME_PATTERN = /^[a-z][a-z0-9_.-]{2,95}$/;

function boundedSignalName(name: string) {
  return SIGNAL_NAME_PATTERN.test(name) ? name : "giromesa.invalid_signal";
}

export class SafeTelemetry {
  private readonly cardinality: CardinalityGuard;

  constructor(
    private readonly backend: TelemetryBackend = new OpenTelemetryBackend("giromesa"),
    budgets: Readonly<Record<string, number>> = DEFAULT_CARDINALITY_BUDGETS,
  ) {
    this.cardinality = new CardinalityGuard(budgets);
  }

  counter(name: string, value: number, attributes: UnsafeTelemetryAttributes = {}) {
    if (!Number.isFinite(value) || value < 0) return;
    this.backend.emit({
      kind: "counter",
      name: boundedSignalName(name),
      value,
      attributes: this.attributes(attributes),
    });
  }

  histogram(name: string, value: number, attributes: UnsafeTelemetryAttributes = {}) {
    if (!Number.isFinite(value) || value < 0) return;
    this.backend.emit({
      kind: "histogram",
      name: boundedSignalName(name),
      value,
      attributes: this.attributes(attributes),
    });
  }

  log(
    severity: "debug" | "info" | "warn" | "error",
    eventName: string,
    attributes: UnsafeTelemetryAttributes = {},
  ) {
    this.backend.emit({
      kind: "log",
      name: boundedSignalName(eventName),
      severity,
      attributes: this.attributes(attributes),
    });
  }

  span(name: string, durationMs: number, attributes: UnsafeTelemetryAttributes = {}) {
    if (!Number.isFinite(durationMs) || durationMs < 0) return;
    this.backend.emit({
      kind: "span",
      name: boundedSignalName(name),
      durationMs,
      attributes: this.attributes(attributes),
    });
  }

  private attributes(source: UnsafeTelemetryAttributes) {
    return this.cardinality.apply(redactTelemetryAttributes(source));
  }
}

export class OpenTelemetryBackend implements TelemetryBackend {
  private readonly counters = new Map<string, Counter>();
  private readonly histograms = new Map<string, Histogram>();
  private readonly tracer;
  private readonly meter;

  constructor(
    scopeName: string,
    scopeVersion = "0.1.0",
    private readonly writeLog: (line: string) => void = (line) => process.stdout.write(line),
  ) {
    this.tracer = trace.getTracer(scopeName, scopeVersion);
    this.meter = metrics.getMeter(scopeName, scopeVersion);
  }

  emit(signal: TelemetrySignal) {
    const attributes = signal.attributes as Attributes;
    if (signal.kind === "counter") {
      const counter =
        this.counters.get(signal.name) ?? this.meter.createCounter(signal.name, { unit: "1" });
      this.counters.set(signal.name, counter);
      counter.add(signal.value, attributes);
      return;
    }
    if (signal.kind === "histogram") {
      const histogram =
        this.histograms.get(signal.name) ?? this.meter.createHistogram(signal.name, { unit: "ms" });
      this.histograms.set(signal.name, histogram);
      histogram.record(signal.value, attributes);
      return;
    }
    if (signal.kind === "log") {
      this.writeLog(`${JSON.stringify(signal)}\n`);
      return;
    }
    if (signal.kind === "span") {
      const endedAt = Date.now();
      const span = this.tracer.startSpan(signal.name, {
        attributes,
        startTime: endedAt - signal.durationMs,
      });
      if (signal.attributes.outcome === "error") {
        span.setStatus({ code: SpanStatusCode.ERROR });
      }
      span.end(endedAt);
    }
  }
}
