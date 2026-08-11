import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiClientError, api } from "./api";

const organizationId = "a1111111-1111-4111-8111-111111111111";
const items = [
  "business",
  "unit",
  "plan",
  "fiscalChoice",
  "catalog",
  "tables",
  "team",
  "qr",
  "production",
  "cashier",
  "training",
  "rehearsal",
];

function responseWithProvisioningState(state: string) {
  const now = "2026-08-11T10:00:00.000Z";
  return {
    organizationId,
    activatedAt: null,
    items: Object.fromEntries(
      items.map((item) => [
        item,
        {
          status: "pending",
          source: "system",
          evidenceReference: null,
          evidence: {},
          actorIdentityId: null,
          verifiedAt: null,
          waiverReason: null,
        },
      ]),
    ),
    ready: false,
    missingItems: items,
    selection: null,
    provisioning: {
      id: "e1111111-1111-4111-8111-111111111111",
      state,
      checkpoint: "requested",
      attempts: 0,
      lastErrorCode: null,
      nextRetryAt: null,
      completedAt: null,
      failedAt: null,
      createdAt: now,
      updatedAt: now,
    },
  };
}

describe("fronteira runtime da API de onboarding", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("rejeita um enum de provisionamento fora do contrato em vez de fazer cast cego", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json(responseWithProvisioningState("success_from_local_mock"), { status: 200 }),
      ),
    );

    const error = await api.onboarding.get(organizationId).catch((caught) => caught);
    expect(error).toBeInstanceOf(ApiClientError);
    expect(error).toMatchObject({
      status: 502,
      code: "INVALID_API_RESPONSE",
      retryable: false,
    });
  });
});
