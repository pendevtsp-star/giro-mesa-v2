import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  deliverEmail,
  EmailDeliveryError,
  emailProviderConfiguration,
  escapeEmailHtml,
} from "./email.js";

const configuration = {
  apiKey: "re_test_only_key",
  appUrl: "https://app.example.com",
  apiUrl: "https://api.example.com",
  from: "GiroMesa <contato@example.com>",
};

describe("Resend email adapter", () => {
  it("sends an idempotent request without exposing credentials in the payload", async () => {
    let request: RequestInit | undefined;
    const result = await deliverEmail(
      {
        to: "cliente@example.com",
        subject: "Acesso",
        html: "<p>Mensagem</p>",
        text: "Mensagem",
        idempotencyKey: "password-reset/event-id",
      },
      {
        configuration,
        fetcher: async (_url, init) => {
          request = init;
          return new Response(JSON.stringify({ id: "provider-message-id" }), { status: 200 });
        },
      },
    );

    assert.equal(result.providerReference, "provider-message-id");
    assert.equal(
      (request?.headers as Record<string, string>)["Idempotency-Key"],
      "password-reset/event-id",
    );
    assert.match(String((request?.headers as Record<string, string>).Authorization), /^Bearer /);
    assert.doesNotMatch(String(request?.body), /re_test_only_key/);
  });

  it("classifies concurrent idempotency as retryable and invalid recipients as permanent", async () => {
    await assert.rejects(
      deliverEmail(
        {
          to: "cliente@example.com",
          subject: "Acesso",
          html: "<p>Mensagem</p>",
          text: "Mensagem",
          idempotencyKey: "event-id",
        },
        {
          configuration,
          fetcher: async () =>
            new Response(JSON.stringify({ name: "concurrent_idempotent_requests" }), {
              status: 409,
            }),
        },
      ),
      (error: unknown) =>
        error instanceof EmailDeliveryError &&
        error.code === "RESEND_CONCURRENT_IDEMPOTENT_REQUESTS" &&
        error.retryable,
    );
    await assert.rejects(
      deliverEmail(
        {
          to: "invalid",
          subject: "Acesso",
          html: "<p>Mensagem</p>",
          text: "Mensagem",
          idempotencyKey: "event-id",
        },
        { configuration },
      ),
      (error: unknown) => error instanceof EmailDeliveryError && !error.retryable,
    );
  });

  it("requires the provider reference and escapes customer-controlled HTML", () => {
    assert.throws(
      () =>
        emailProviderConfiguration({
          NODE_ENV: "production",
          EMAIL_PROVIDER_ENABLED: "true",
          EMAIL_PROVIDER_CREDENTIAL_REFERENCE: "smtp",
        }),
      /EMAIL_PROVIDER_REFERENCE_INVALID/,
    );
    assert.equal(
      escapeEmailHtml('<script>alert("x")</script>'),
      "&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;",
    );
  });
});
