import { sleep } from "k6";
import {
  buildK6Options,
  executionContext,
  fixturePath,
  fixtureTenantSlot,
  parseLoadFixture,
} from "./lib/config.js";
import { operationalRequests } from "./lib/journeys.js";
import { runRequests } from "./lib/k6-runtime.js";

const profile = __ENV.K6_PROFILE ?? "smoke";
const fixture = parseLoadFixture(open(fixturePath(__ENV)), profile);

export const options = buildK6Options("operational", profile, fixture.tenants.length);
const operationalState = {};

export default function operationalScenario() {
  const { tenant, tenantVuNumber } = fixtureTenantSlot(fixture, __VU);
  const context = executionContext(tenant, __ENV, profile, tenantVuNumber);
  runRequests(
    context.metadata.baseUrl,
    context.requestHeaders,
    operationalRequests(tenant, tenantVuNumber, operationalState),
  );
  sleep(1);
}
