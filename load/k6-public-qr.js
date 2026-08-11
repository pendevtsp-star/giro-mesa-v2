import { sleep } from "k6";
import {
  buildK6Options,
  fixturePath,
  parseLoadFixture,
  pickFixtureTenant,
  publicBaseUrl,
} from "./lib/config.js";
import { publicQrRequests } from "./lib/journeys.js";
import { runRequests } from "./lib/k6-runtime.js";

const profile = __ENV.K6_PROFILE ?? "smoke";
const fixture = parseLoadFixture(open(fixturePath(__ENV)), profile);
const baseUrl = publicBaseUrl(__ENV);

export const options = buildK6Options("public-qr", profile, fixture.tenants.length);

export default function publicQrScenario() {
  const tenant = pickFixtureTenant(fixture, __VU);
  runRequests(baseUrl, {}, publicQrRequests(tenant));
  sleep(1);
}
