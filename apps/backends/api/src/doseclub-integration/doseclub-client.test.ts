import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  DoseClubClientError,
  DoseClubHttpClient,
  normalizeDoseClubIntegrationBaseUrl,
} from "./doseclub-client.js";
import type { DoseClubOperation } from "./doseclub-contract.js";

const validOperation: DoseClubOperation = {
  operationId: "operation-1",
  status: "reserved",
  externalCommandId: "command-1",
  externalCommandItemId: "item-1",
  externalClubId: "club-1",
  externalBranchId: "branch-1",
  externalProductId: "product-1",
  doses: 2,
  availableDoses: 8,
  reservedAt: "2026-08-25T12:00:00.000Z",
  expiresAt: "2026-08-25T12:05:00.000Z",
  committedAt: null,
  canceledAt: null,
  expiredAt: null,
  reversedAt: null,
  updatedAt: "2026-08-25T12:00:00.000Z",
};

function jsonResponse(value: unknown, status = 200, headers?: HeadersInit): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });
}

function client(
  fetcher: typeof fetch,
  overrides: Partial<ConstructorParameters<typeof DoseClubHttpClient>[0]> = {},
) {
  return new DoseClubHttpClient({
    baseUrl: "https://doseclub.example.com",
    clientId: "giromesa-client",
    integrationKey: "integration-secret",
    environment: "test",
    fetcher,
    ...overrides,
  });
}

function expectClientError(
  code: DoseClubClientError["code"],
  retryable: boolean,
  status: number | null = null,
): (error: unknown) => boolean {
  return (error) => {
    assert.ok(error instanceof DoseClubClientError);
    assert.equal(error.code, code);
    assert.equal(error.status, status);
    assert.equal(error.retryable, retryable);
    return true;
  };
}

describe("Dose Club HTTP client", () => {
  it("normalizes the supported base URL forms without duplicating the contract path", () => {
    for (const baseUrl of [
      "https://doseclub.example.com",
      "https://doseclub.example.com/",
      "https://doseclub.example.com/v1",
      "https://doseclub.example.com/v1/integrations/giromesa/",
    ]) {
      assert.equal(
        normalizeDoseClubIntegrationBaseUrl(baseUrl, "production"),
        "https://doseclub.example.com/v1/integrations/giromesa",
      );
    }

    assert.throws(
      () => normalizeDoseClubIntegrationBaseUrl("http://doseclub.example.com", "production"),
      expectClientError("DOSECLUB_CONFIG_INVALID", false),
    );
    assert.throws(
      () =>
        normalizeDoseClubIntegrationBaseUrl(
          "https://doseclub.example.com/v1/integrations/giromesa/v1/integrations/giromesa",
          "test",
        ),
      expectClientError("DOSECLUB_CONFIG_INVALID", false),
    );
  });

  it("authenticates health and membership lookup and validates their projections", async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const responses = [
      jsonResponse({
        status: "ok",
        tenantId: "tenant-1",
        integrationAccountId: "account-1",
      }),
      jsonResponse({
        memberships: [
          {
            externalClubId: "club-1",
            status: "active",
            offer: {
              externalOfferId: "offer-1",
              name: "Selecao da casa",
              type: "combo_pool",
            },
            remainingDoses: 10,
            reservedDoses: 2,
            availableDoses: 8,
            doseMl: 30,
            eligibleProducts: [{ externalProductId: "product/a", name: "Whisky A", brand: null }],
          },
        ],
      }),
    ];
    const fetcher: typeof fetch = async (input, init) => {
      calls.push({ url: String(input), init });
      const response = responses.shift();
      assert.ok(response);
      return response;
    };
    const doseClub = client(fetcher, {
      baseUrl: "https://doseclub.example.com/v1/integrations/giromesa/",
    });

    assert.deepEqual(await doseClub.health(), {
      status: "ok",
      tenantId: "tenant-1",
      integrationAccountId: "account-1",
    });
    const result = await doseClub.listEligibleMemberships({
      externalCustomerId: "customer/a",
      externalBranchId: "branch/a",
      externalProductId: "product/a",
    });

    assert.equal(result.memberships[0]?.offer.type, "combo_pool");
    assert.equal(result.memberships[0]?.availableDoses, 8);
    assert.equal(calls[0]?.url, "https://doseclub.example.com/v1/integrations/giromesa/health");
    assert.equal(
      calls[1]?.url,
      "https://doseclub.example.com/v1/integrations/giromesa/customers/customer%2Fa/memberships?externalBranchId=branch%2Fa&externalProductId=product%2Fa",
    );
    for (const call of calls) {
      const headers = new Headers(call.init?.headers);
      assert.equal(headers.get("x-giromesa-client-id"), "giromesa-client");
      assert.equal(headers.get("x-giromesa-integration-key"), "integration-secret");
      assert.equal(headers.get("idempotency-key"), null);
      assert.equal(headers.get("content-type"), null);
    }
  });

  it("uses the frozen paths, bodies and idempotency headers for every mutation", async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const fetcher: typeof fetch = async (input, init) => {
      calls.push({ url: String(input), init });
      return jsonResponse(validOperation);
    };
    const doseClub = client(fetcher);

    await doseClub.reserveConsumption({
      externalCustomerId: "customer-1",
      externalBranchId: "branch-1",
      externalProductId: "product-1",
      externalClubId: "club-1",
      externalCommandId: "command-1",
      externalCommandItemId: "item-1",
      doses: 2,
      idempotencyKey: "reserve-item-1",
      reason: "Consumo na comanda",
    });
    await doseClub.commitReservation({
      operationId: "operation/1",
      idempotencyKey: "commit-item-1",
      externalStockMovementId: "movement-1",
    });
    await doseClub.cancelReservation({
      operationId: "operation/1",
      idempotencyKey: "cancel-item-1",
      reason: "Item removido",
    });
    await doseClub.reverseConsumption({
      operationId: "operation-1",
      externalReversalId: "reversal-1",
      idempotencyKey: "reverse-item-1",
      reason: "Estorno da comanda",
    });
    await doseClub.getOperation("operation/1");

    assert.deepEqual(
      calls.map(({ url }) => url),
      [
        "https://doseclub.example.com/v1/integrations/giromesa/consumption-reservations",
        "https://doseclub.example.com/v1/integrations/giromesa/consumption-reservations/operation%2F1/commit",
        "https://doseclub.example.com/v1/integrations/giromesa/consumption-reservations/operation%2F1/cancel",
        "https://doseclub.example.com/v1/integrations/giromesa/consumption-reversals",
        "https://doseclub.example.com/v1/integrations/giromesa/operations/operation%2F1",
      ],
    );
    assert.deepEqual(JSON.parse(String(calls[0]?.init?.body)), {
      externalCustomerId: "customer-1",
      externalBranchId: "branch-1",
      externalProductId: "product-1",
      externalClubId: "club-1",
      externalCommandId: "command-1",
      externalCommandItemId: "item-1",
      doses: 2,
      idempotencyKey: "reserve-item-1",
      reason: "Consumo na comanda",
    });
    assert.deepEqual(JSON.parse(String(calls[1]?.init?.body)), {
      externalStockMovementId: "movement-1",
    });
    assert.deepEqual(JSON.parse(String(calls[2]?.init?.body)), { reason: "Item removido" });
    assert.deepEqual(JSON.parse(String(calls[3]?.init?.body)), {
      operationId: "operation-1",
      externalReversalId: "reversal-1",
      idempotencyKey: "reverse-item-1",
      reason: "Estorno da comanda",
    });
    assert.deepEqual(
      calls.slice(0, 4).map((call) => new Headers(call.init?.headers).get("idempotency-key")),
      ["reserve-item-1", "commit-item-1", "cancel-item-1", "reverse-item-1"],
    );
    assert.equal(new Headers(calls[4]?.init?.headers).get("idempotency-key"), null);
  });

  it("classifies only 408, 429 and 5xx HTTP failures as retryable", async () => {
    for (const [status, retryable] of [
      [408, true],
      [429, true],
      [503, true],
      [409, false],
    ] as const) {
      let calls = 0;
      const fetcher: typeof fetch = async () => {
        calls += 1;
        return new Response("temporary upstream response", { status });
      };

      await assert.rejects(
        client(fetcher).health(),
        expectClientError("DOSECLUB_HTTP_ERROR", retryable, status),
      );
      assert.equal(calls, 1, "the client classifies but does not retry side effects implicitly");
    }
  });

  it("classifies abort-driven timeouts and network failures as retryable", async () => {
    const timeoutFetcher: typeof fetch = async (_input, init) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener(
          "abort",
          () => reject(new DOMException("Timed out", "AbortError")),
          { once: true },
        );
      });

    await assert.rejects(
      client(timeoutFetcher, { timeoutMs: 5 }).health(),
      expectClientError("DOSECLUB_TIMEOUT", true),
    );
    await assert.rejects(
      client(async () => {
        throw new TypeError("network down");
      }).health(),
      expectClientError("DOSECLUB_UNAVAILABLE", true),
    );
  });

  it("rejects malformed, oversized and contract-invalid success responses safely", async () => {
    const malformedJson = client(async () => new Response("not json"));
    await assert.rejects(
      malformedJson.health(),
      expectClientError("DOSECLUB_RESPONSE_INVALID", false),
    );

    const invalidContract = client(async () => jsonResponse({ status: "ok" }));
    await assert.rejects(
      invalidContract.health(),
      expectClientError("DOSECLUB_RESPONSE_INVALID", false),
    );

    const oversized = client(
      async () =>
        new Response("{}", {
          headers: { "content-length": "1048577", "content-type": "application/json" },
        }),
    );
    await assert.rejects(oversized.health(), expectClientError("DOSECLUB_RESPONSE_INVALID", false));
  });

  it("rejects an invalid dose count before making a request", async () => {
    let calls = 0;
    const doseClub = client(async () => {
      calls += 1;
      return jsonResponse(validOperation);
    });

    assert.throws(
      () =>
        doseClub.reserveConsumption({
          externalCustomerId: "customer-1",
          externalBranchId: "branch-1",
          externalProductId: "product-1",
          externalClubId: "club-1",
          externalCommandId: "command-1",
          externalCommandItemId: "item-1",
          doses: 501,
          idempotencyKey: "reserve-item-1",
        }),
      expectClientError("DOSECLUB_PAYLOAD_INVALID", false),
    );
    assert.equal(calls, 0);
  });
});
