import assert from "node:assert/strict";
import { it } from "node:test";
import { MetricsService } from "./health.module.js";

it("exports bounded route metrics without using raw request URLs", () => {
  const metrics = new MetricsService();
  const started = metrics.begin();
  metrics.end("GET", "/api/v1/orders/:id", 200, started);
  const output = metrics.render();
  assert.match(
    output,
    /giromesa_http_requests_total\{method="GET",route="\/api\/v1\/orders\/:id",status="200"\} 1/,
  );
  assert.match(output, /giromesa_http_requests_in_flight 0/);
});
