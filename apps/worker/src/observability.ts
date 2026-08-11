import {
  OpenTelemetryBackend,
  SafeTelemetry,
  type TelemetryBackend,
  type UnsafeTelemetryAttributes,
} from "@giromesa/observability";

export class WorkerObservability {
  private readonly telemetry: SafeTelemetry;

  constructor(
    backend: TelemetryBackend = new OpenTelemetryBackend(
      process.env.OTEL_SERVICE_NAME ?? "giromesa.worker",
    ),
  ) {
    this.telemetry = new SafeTelemetry(backend);
  }

  async runJob<T>(
    name: string,
    attributes: UnsafeTelemetryAttributes,
    operation: () => Promise<T>,
  ): Promise<T> {
    const startedAt = performance.now();
    try {
      const result = await operation();
      const completed = { ...attributes, outcome: "success" };
      const durationMs = performance.now() - startedAt;
      this.telemetry.span(name, durationMs, completed);
      this.telemetry.counter("giromesa.worker.jobs.completed", 1, completed);
      this.telemetry.histogram("giromesa.worker.job.duration", durationMs, completed);
      return result;
    } catch (error) {
      const failed = {
        ...attributes,
        outcome: "error",
        "error.type": error instanceof Error ? error.name : "UnknownError",
        "error.code": "WORKER_JOB_FAILED",
      };
      const durationMs = performance.now() - startedAt;
      this.telemetry.span(name, durationMs, failed);
      this.telemetry.counter("giromesa.worker.jobs.failed", 1, failed);
      this.telemetry.histogram("giromesa.worker.job.duration", durationMs, failed);
      throw error;
    }
  }
}
