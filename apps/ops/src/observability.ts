export type ObservabilityStatus = "healthy" | "degraded" | "breaching" | "unknown";

export interface ObservabilitySignalSummary {
  name: string;
  status: ObservabilityStatus;
  value: number | null;
  unit: "percent" | "milliseconds" | "seconds" | "count";
  objective: string;
  window: string;
}

export interface ObservabilityAlertSummary {
  id: string;
  title: string;
  severity: "sev1" | "sev2" | "sev3";
  owner: string;
  status: "firing" | "resolved" | "unknown";
  runbookPath: string;
}

export interface ObservabilitySyntheticSummary {
  id: string;
  target: "api-health" | "public-menu" | "ops-shell";
  status: ObservabilityStatus;
  checkedAt: string | null;
  latencyMs: number | null;
}

export interface ObservabilitySnapshot {
  generatedAt: string;
  environment: "local" | "test" | "staging" | "production";
  status: ObservabilityStatus;
  signals: ObservabilitySignalSummary[];
  alerts: ObservabilityAlertSummary[];
  synthetics: ObservabilitySyntheticSummary[];
}
