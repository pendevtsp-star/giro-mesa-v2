import assert from "node:assert/strict";
import { it } from "node:test";
import type { TelemetryBackend, TelemetrySignal } from "@giromesa/observability";
import { WorkerObservability } from "./observability.js";

const organizationId = "a1111111-1111-4111-8111-111111111111";

class RecordingBackend implements TelemetryBackend {
  readonly signals: TelemetrySignal[] = [];

  emit(signal: TelemetrySignal) {
    this.signals.push(signal);
  }
}

it("emits bounded worker metrics and spans without serializing job payloads", async () => {
  const backend = new RecordingBackend();
  const observability = new WorkerObservability(backend);

  const result = await observability.runJob(
    "outbox.dispatch",
    {
      "organization.id": organizationId,
      "job.type": "outbox.dispatch",
      payload: { authorization: "Bearer worker-secret" },
      "customer.id": "customer-99",
    },
    async () => "processed",
  );

  assert.equal(result, "processed");
  assert.deepEqual(
    backend.signals.map((signal) => [signal.kind, signal.name, signal.attributes]),
    [
      [
        "span",
        "outbox.dispatch",
        {
          "organization.id": organizationId,
          "job.type": "outbox.dispatch",
          "telemetry.dropped_attributes_count": 2,
          outcome: "success",
        },
      ],
      [
        "counter",
        "giromesa.worker.jobs.completed",
        {
          "organization.id": organizationId,
          "job.type": "outbox.dispatch",
          "telemetry.dropped_attributes_count": 2,
          outcome: "success",
        },
      ],
      [
        "histogram",
        "giromesa.worker.job.duration",
        {
          "organization.id": organizationId,
          "job.type": "outbox.dispatch",
          "telemetry.dropped_attributes_count": 2,
          outcome: "success",
        },
      ],
    ],
  );
  assert.doesNotMatch(JSON.stringify(backend.signals), /worker-secret|customer-99/);
});

it("records only the error type and code when a worker job fails", async () => {
  const backend = new RecordingBackend();
  const observability = new WorkerObservability(backend);

  await assert.rejects(
    observability.runJob("outbox.dispatch", { "job.type": "outbox.dispatch" }, async () => {
      const error = new Error("guest@example.com failed with token abc");
      error.name = "TemporaryProviderError";
      throw error;
    }),
    /guest@example.com/,
  );

  const errorAttributes = {
    "job.type": "outbox.dispatch",
    outcome: "error",
    "error.type": "TemporaryProviderError",
    "error.code": "WORKER_JOB_FAILED",
  };
  assert.deepEqual(
    backend.signals.map((signal) => [signal.kind, signal.name, signal.attributes]),
    [
      ["span", "outbox.dispatch", errorAttributes],
      ["counter", "giromesa.worker.jobs.failed", errorAttributes],
      ["histogram", "giromesa.worker.job.duration", errorAttributes],
    ],
  );
  const span = backend.signals[0];
  const duration = backend.signals[2];
  assert.equal(span?.kind, "span");
  assert.equal(duration?.kind, "histogram");
  if (span?.kind === "span" && duration?.kind === "histogram") {
    assert.ok(span.durationMs >= 0);
    assert.equal(duration.value, span.durationMs);
  }
  assert.doesNotMatch(JSON.stringify(backend.signals), /guest@example.com|token abc/);
});
