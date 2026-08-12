import { sleep } from "k6";
import { Rate } from "k6/metrics";
import {
  buildK6Options,
  executionContext,
  fixturePath,
  fixtureTenantSlot,
  parseLoadFixture,
  pickFixtureTenant,
} from "./lib/config.js";
import { multitenantRequests } from "./lib/journeys.js";
import { runRequests } from "./lib/k6-runtime.js";

const profile = __ENV.K6_PROFILE ?? "smoke";
const fixture = parseLoadFixture(open(fixturePath(__ENV)), profile);
const isolationBreach = new Rate("isolation_breach");

export const options = buildK6Options("multitenant", profile, fixture.tenants.length);

export default function multitenantScenario() {
  const { tenant, tenantVuNumber } = fixtureTenantSlot(fixture, __VU);
  const foreignTenant = pickFixtureTenant(fixture, (__VU % fixture.tenants.length) + 1);
  const context = executionContext(tenant, __ENV, profile, tenantVuNumber);
  runRequests(
    context.metadata.baseUrl,
    context.requestHeaders,
    multitenantRequests(tenant, foreignTenant),
    isolationBreach,
  );
  sleep(1);
}
