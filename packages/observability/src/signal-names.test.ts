import assert from "node:assert/strict";
import { it } from "node:test";
import { SafeTelemetry, type TelemetryBackend, type TelemetrySignal } from "./index.js";

it("drops unknown or sensitive signal names before they reach a backend cache", () => {
  const signals: TelemetrySignal[] = [];
  const backend: TelemetryBackend = { emit: (signal) => signals.push(signal) };
  const telemetry = new SafeTelemetry(backend);

  for (const name of [
    "pin_1234",
    "cpf_12345678901",
    "guest@example.com",
    "a1111111-1111-4111-8111-111111111111",
    ...Array.from({ length: 1_000 }, (_, index) => `dynamic_signal_${index}`),
  ]) {
    telemetry.span(name, 1);
    telemetry.counter(name, 1);
    telemetry.histogram(name, 1);
    telemetry.log("info", name);
  }

  assert.deepEqual(signals, []);
});

it("emits only the finite production signal allowlist", () => {
  const signals: TelemetrySignal[] = [];
  const telemetry = new SafeTelemetry({ emit: (signal) => signals.push(signal) });

  telemetry.span("http.server.request", 1);
  telemetry.counter("http.server.request.count", 1);
  telemetry.histogram("http.server.request.duration", 1);
  telemetry.log("error", "giromesa.http.request.failed");

  assert.deepEqual(
    signals.map(({ kind, name }) => [kind, name]),
    [
      ["span", "http.server.request"],
      ["counter", "http.server.request.count"],
      ["histogram", "http.server.request.duration"],
      ["log", "giromesa.http.request.failed"],
    ],
  );
});
