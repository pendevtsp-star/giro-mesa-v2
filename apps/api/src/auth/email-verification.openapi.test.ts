import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { describe, it } from "node:test";

type JsonObject = Record<string, unknown>;

function object(value: unknown): JsonObject {
  assert.ok(value && typeof value === "object" && !Array.isArray(value));
  return value as JsonObject;
}

function property(value: unknown, ...path: string[]): unknown {
  let current = value;
  for (const segment of path) current = object(current)[segment];
  return current;
}

const openApiUrl = new URL("../../openapi/openapi.json", import.meta.url);
const csharpRoot = new URL(
  "../../../../packages/api-client-csharp/Generated/Api/V1/Auth/EmailVerification/",
  import.meta.url,
);

describe("email verification generated contract", () => {
  it("publishes the same exact 202 and discriminated 200 schemas for every route alias", async () => {
    const document = object(JSON.parse(await readFile(openApiUrl, "utf8")));
    const routePrefixes = ["/api/v1", "/v1", "/public/v1"];

    for (const prefix of routePrefixes) {
      const accepted = object(
        property(
          document,
          "paths",
          `${prefix}/auth/email-verification/request`,
          "post",
          "responses",
          "202",
        ),
      );
      assert.deepEqual(property(accepted, "headers", "Retry-After", "schema"), {
        type: "integer",
        example: 60,
      });
      assert.deepEqual(property(accepted, "headers", "Cache-Control", "schema"), {
        type: "string",
        example: "no-store",
      });
      assert.deepEqual(property(accepted, "content", "application/json", "schema"), {
        $ref: "#/components/schemas/EmailVerificationAcceptedResponse",
      });

      const confirmed = object(
        property(
          document,
          "paths",
          `${prefix}/auth/email-verification/confirm`,
          "post",
          "responses",
          "200",
          "content",
          "application/json",
          "schema",
        ),
      );
      assert.deepEqual(
        property(
          document,
          "paths",
          `${prefix}/auth/email-verification/confirm`,
          "post",
          "responses",
          "200",
          "headers",
          "Cache-Control",
          "schema",
        ),
        { type: "string", example: "no-store" },
      );
      assert.deepEqual(confirmed.oneOf, [
        { $ref: "#/components/schemas/EmailVerificationSessionResponse" },
        { $ref: "#/components/schemas/EmailVerificationMfaResponse" },
        { $ref: "#/components/schemas/EmailVerificationAlreadyVerifiedResponse" },
      ]);
      assert.deepEqual(confirmed.discriminator, {
        propertyName: "status",
        mapping: {
          verified: "#/components/schemas/EmailVerificationSessionResponse",
          mfa_required: "#/components/schemas/EmailVerificationMfaResponse",
          already_verified: "#/components/schemas/EmailVerificationAlreadyVerifiedResponse",
        },
      });
    }

    assert.deepEqual(
      property(document, "components", "schemas", "EmailVerificationAcceptedResponse", "required"),
      ["accepted"],
    );
    assert.deepEqual(
      property(document, "components", "schemas", "EmailVerificationMfaResponse", "required"),
      ["status", "mfaRequired", "challengeToken", "expiresAt"],
    );
  });

  it("keeps the C# request and confirmation methods strongly typed", async () => {
    const requestBuilder = await readFile(
      new URL("Request/RequestRequestBuilder.cs", csharpRoot),
      "utf8",
    );
    const confirmBuilder = await readFile(
      new URL("Confirm/ConfirmRequestBuilder.cs", csharpRoot),
      "utf8",
    );

    assert.match(requestBuilder, /Task<[^>]*EmailVerificationAcceptedResponse\?> PostAsync/);
    assert.match(confirmBuilder, /Task<[^>]*ConfirmPostResponse\?> PostAsConfirmPostResponseAsync/);
    assert.match(confirmBuilder, /GetChildNode\("status"\)/);
    assert.doesNotMatch(requestBuilder, /Task<(?:Stream|void)\??>/i);
    assert.doesNotMatch(confirmBuilder, /Task<(?:Stream|void)\??>/i);
  });
});
