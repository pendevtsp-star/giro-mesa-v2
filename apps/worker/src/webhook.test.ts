import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { after, before, describe, it } from "node:test";
import {
  deliverWebhook,
  parseWebhookDeliveryRequest,
  type WebhookDeliveryContext,
  WebhookDeliveryError,
} from "./webhook.js";

const masterKey = "test-master-key-with-at-least-thirty-two-characters";
const organizationId = "11111111-1111-4111-8111-111111111111";
const publicationId = "22222222-2222-4222-8222-222222222222";
const endpointId = "33333333-3333-4333-8333-333333333333";

interface ReceivedRequest {
  body: string;
  headers: http.IncomingHttpHeaders;
  path: string;
}

function expectWebhookError(code: string) {
  return (error: unknown) => error instanceof WebhookDeliveryError && error.message === code;
}

describe("webhook delivery", { concurrency: false }, () => {
  const received: ReceivedRequest[] = [];
  let retryRequests = 0;
  let server: http.Server;
  let baseUrl = "";
  let previousNodeEnv: string | undefined;

  before(async () => {
    previousNodeEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = "test";
    server = http.createServer((request, response) => {
      const chunks: Buffer[] = [];
      request.on("data", (chunk: Buffer) => chunks.push(chunk));
      request.on("end", () => {
        const path = request.url ?? "/";
        received.push({
          body: Buffer.concat(chunks).toString("utf8"),
          headers: request.headers,
          path,
        });

        if (path === "/retry") {
          retryRequests += 1;
          response.statusCode = retryRequests === 1 ? 503 : 204;
          response.end();
          return;
        }
        if (path === "/redirect-private") {
          response.statusCode = 307;
          response.setHeader("location", "http://169.254.169.254/latest");
          response.end();
          return;
        }
        if (path === "/large") {
          response.statusCode = 200;
          response.end("x".repeat(512));
          return;
        }
        if (path === "/timeout") return;

        response.statusCode = 204;
        response.end();
      });
    });
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", resolve);
    });
    const address = server.address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${address.port}`;
  });

  after(async () => {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
    if (previousNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = previousNodeEnv;
  });

  function context(endpointUrl: string): WebhookDeliveryContext {
    return {
      endpointId,
      endpointUrl,
      eventType: "order.closed",
      organizationId,
      publication: {
        aggregateId: "44444444-4444-4444-8444-444444444444",
        aggregateType: "order",
        createdAt: new Date("2026-08-10T12:00:00.000Z"),
        payload: { customer: { name: "Ana", id: "customer-1" }, amount: 12_500 },
      },
      publicationId,
      signingKeyVersion: 2,
    };
  }

  const localOptions = {
    allowLocalTestServer: true,
    masterKey,
  } as const;

  it("validates the exact delivery request contract", () => {
    const request = {
      endpointId,
      eventType: "order.closed",
      organizationId,
      publicationId,
      signingKeyVersion: 2,
    };
    assert.deepEqual(parseWebhookDeliveryRequest(request), request);
    assert.throws(
      () => parseWebhookDeliveryRequest({ ...request, endpointUrl: "https://attacker.example" }),
      expectWebhookError("WEBHOOK_EVENT_INVALID"),
    );
  });

  it("keeps a stable body, signature and idempotency key across retry and replay", async () => {
    const firstIndex = received.length;
    const delivery = context(`${baseUrl}/retry`);

    await assert.rejects(
      deliverWebhook(delivery, localOptions),
      expectWebhookError("WEBHOOK_HTTP_STATUS"),
    );
    await deliverWebhook(delivery, localOptions);
    await deliverWebhook(delivery, localOptions);

    const attempts = received.slice(firstIndex).filter((item) => item.path === "/retry");
    assert.equal(attempts.length, 3);
    assert.equal(attempts[0]?.body, attempts[1]?.body);
    assert.equal(attempts[1]?.body, attempts[2]?.body);

    const body = attempts[0]?.body ?? "";
    const derivedSecret = createHmac("sha256", masterKey)
      .update(`${organizationId}:${endpointId}:v2`)
      .digest("base64url");
    const expectedSignature = `sha256=${createHmac("sha256", derivedSecret).update(body).digest("hex")}`;
    for (const attempt of attempts) {
      assert.equal(attempt.headers["idempotency-key"], `${publicationId}:${endpointId}`);
      assert.equal(attempt.headers["x-giromesa-event-id"], publicationId);
      assert.equal(attempt.headers["x-giromesa-event-version"], "1");
      assert.equal(attempt.headers["x-giromesa-signature"], expectedSignature);
      assert.equal(attempt.headers["x-giromesa-signing-key-version"], "2");
      assert.equal(attempt.headers["x-giromesa-timestamp"], "2026-08-10T12:00:00.000Z");
    }
    assert.deepEqual(JSON.parse(body), {
      aggregate: { id: "44444444-4444-4444-8444-444444444444", type: "order" },
      data: { amount: 12_500, customer: { id: "customer-1", name: "Ana" } },
      id: publicationId,
      timestamp: "2026-08-10T12:00:00.000Z",
      type: "order.closed",
      version: 1,
    });
  });

  it("limits receiver response bodies", async () => {
    await assert.rejects(
      deliverWebhook(context(`${baseUrl}/large`), { ...localOptions, responseLimitBytes: 64 }),
      expectWebhookError("WEBHOOK_RESPONSE_TOO_LARGE"),
    );
  });

  it("times out stalled receivers", async () => {
    await assert.rejects(
      deliverWebhook(context(`${baseUrl}/timeout`), { ...localOptions, timeoutMs: 50 }),
      expectWebhookError("WEBHOOK_TIMEOUT"),
    );
  });

  it("blocks private destinations and credentials", async () => {
    await assert.rejects(
      deliverWebhook(context("https://127.0.0.1/webhook"), { masterKey }),
      expectWebhookError("WEBHOOK_TARGET_BLOCKED"),
    );
    await assert.rejects(
      deliverWebhook(context("https://10.0.0.1/webhook"), { masterKey }),
      expectWebhookError("WEBHOOK_TARGET_BLOCKED"),
    );
    await assert.rejects(
      deliverWebhook(context("https://[::1]/webhook"), { masterKey }),
      expectWebhookError("WEBHOOK_TARGET_BLOCKED"),
    );
    await assert.rejects(
      deliverWebhook(context("https://[::ffff:127.0.0.1]/webhook"), { masterKey }),
      expectWebhookError("WEBHOOK_TARGET_BLOCKED"),
    );
    await assert.rejects(
      deliverWebhook(
        context(`${baseUrl.replace("http://", "http://user:password@")}/webhook`),
        localOptions,
      ),
      expectWebhookError("WEBHOOK_TARGET_INVALID"),
    );
  });

  it("revalidates redirects and blocks a redirect to link-local metadata", async () => {
    await assert.rejects(
      deliverWebhook(context(`${baseUrl}/redirect-private`), localOptions),
      expectWebhookError("WEBHOOK_TARGET_BLOCKED"),
    );
  });

  it("permits plain HTTP loopback only in the explicit test mode", async () => {
    await assert.rejects(
      deliverWebhook(context(`${baseUrl}/ok`), { masterKey }),
      expectWebhookError("WEBHOOK_TARGET_HTTPS_REQUIRED"),
    );
    await deliverWebhook(context(`${baseUrl}/ok`), localOptions);
  });
});
