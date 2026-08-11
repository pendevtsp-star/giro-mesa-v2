import assert from "node:assert/strict";
import { after, before, it } from "node:test";
import type { TelemetryBackend, TelemetrySignal } from "@giromesa/observability";
import { BadRequestException, Controller, Get, Module } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { FastifyAdapter, type NestFastifyApplication } from "@nestjs/platform-fastify";
import { ObservabilityModule } from "./observability.module.js";

const organizationId = "a1111111-1111-4111-8111-111111111111";
const unitId = "b1111111-1111-4111-8111-111111111111";
const deviceId = "c1111111-1111-4111-8111-111111111111";

class RecordingBackend implements TelemetryBackend {
  readonly signals: TelemetrySignal[] = [];

  emit(signal: TelemetrySignal) {
    this.signals.push(signal);
  }
}

const backend = new RecordingBackend();

@Controller("observability-probe")
class ProbeController {
  @Get(":organizationId/:unitId/ok")
  ok() {
    return { ok: true };
  }

  @Get(":organizationId/:unitId/fail")
  fail() {
    const error = new Error("payload with guest@example.com");
    error.name = "PIN_1234";
    throw error;
  }

  @Get(":organizationId/:unitId/rejected")
  rejected() {
    throw new BadRequestException("invalid guest@example.com");
  }
}

@Module({
  imports: [ObservabilityModule.forBackend(backend)],
  controllers: [ProbeController],
})
class ProbeModule {}

let app: NestFastifyApplication;

before(async () => {
  app = await NestFactory.create<NestFastifyApplication>(ProbeModule, new FastifyAdapter(), {
    logger: false,
  });
  await app.init();
  await app.getHttpAdapter().getInstance().ready();
});

after(async () => {
  await app.close();
});

it("boots the global HTTP boundary and emits bounded success telemetry", async () => {
  const start = backend.signals.length;
  const response = await app.inject({
    method: "GET",
    url: `/observability-probe/${organizationId}/${unitId}/ok`,
    headers: { "x-device-id": deviceId },
  });

  assert.equal(response.statusCode, 200);
  const signals = backend.signals.slice(start);
  assert.deepEqual(
    signals.map((signal) => [signal.kind, signal.name]),
    [
      ["span", "http.server.request"],
      ["counter", "http.server.request.count"],
      ["histogram", "http.server.request.duration"],
    ],
  );
  for (const signal of signals) {
    assert.deepEqual(signal.attributes, {
      "http.request.method": "GET",
      "http.route": "/observability-probe/:organizationId/:unitId/ok",
      "http.response.status_code": 200,
      "organization.id": organizationId,
      "unit.id": unitId,
      "device.id": deviceId,
      outcome: "success",
    });
  }
});

it("records a sanitized error type without its message at the HTTP boundary", async () => {
  const start = backend.signals.length;
  const response = await app.inject({
    method: "GET",
    url: `/observability-probe/${organizationId}/${unitId}/fail`,
  });

  assert.equal(response.statusCode, 500);
  const signals = backend.signals.slice(start);
  assert.deepEqual(
    signals.map((signal) => [signal.kind, signal.name]),
    [
      ["span", "http.server.request"],
      ["counter", "http.server.request.count"],
      ["histogram", "http.server.request.duration"],
      ["log", "giromesa.http.request.failed"],
    ],
  );
  for (const signal of signals) {
    assert.equal(signal.attributes["error.type"], "[REDACTED]");
    assert.equal(signal.attributes["http.response.status_code"], 500);
    assert.equal(signal.attributes.outcome, "error");
  }
  assert.doesNotMatch(JSON.stringify(signals), /guest@example\.com|PIN_1234/);
});

it("classifies HTTP 4xx as client_rejected without a server error signal", async () => {
  const start = backend.signals.length;
  const response = await app.inject({
    method: "GET",
    url: `/observability-probe/${organizationId}/${unitId}/rejected`,
  });

  assert.equal(response.statusCode, 400);
  const signals = backend.signals.slice(start);
  assert.deepEqual(
    signals.map((signal) => [signal.kind, signal.name]),
    [
      ["span", "http.server.request"],
      ["counter", "http.server.request.count"],
      ["histogram", "http.server.request.duration"],
    ],
  );
  for (const signal of signals) {
    assert.equal(signal.attributes["http.response.status_code"], 400);
    assert.equal(signal.attributes.outcome, "client_rejected");
    assert.equal(signal.attributes["error.type"], undefined);
    assert.equal(signal.attributes["error.code"], undefined);
  }
  assert.doesNotMatch(JSON.stringify(signals), /guest@example\.com|HTTP_REQUEST_FAILED/);
});
