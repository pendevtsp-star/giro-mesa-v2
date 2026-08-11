import { getPwaMutationCount, withPwaMutation } from "@giromesa/ui/pwa-mutation";
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

  it("propaga AbortError quando o cancelamento acontece durante o body de um erro HTTP", async () => {
    let markBodyStarted: (() => void) | undefined;
    const bodyStarted = new Promise<void>((resolve) => {
      markBodyStarted = resolve;
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
        const signal = init?.signal;
        return {
          ok: false,
          status: 503,
          json: () =>
            new Promise((_resolve, reject) => {
              markBodyStarted?.();
              signal?.addEventListener(
                "abort",
                () => reject(new DOMException("The operation was aborted.", "AbortError")),
                { once: true },
              );
            }),
        } as Response;
      }),
    );
    const controller = new AbortController();
    const pending = api.onboarding.provisioning(
      organizationId,
      "e1111111-1111-4111-8111-111111111111",
      controller.signal,
    );
    await bodyStarted;
    controller.abort();

    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
    await expect(pending).rejects.not.toBeInstanceOf(ApiClientError);
  });

  it("mantém mutação atrasada do Ops ativa sem dupla contagem", async () => {
    let finish: ((response: Response) => void) | undefined;
    vi.stubGlobal(
      "fetch",
      vi.fn(
        () =>
          new Promise<Response>((resolve) => {
            finish = resolve;
          }),
      ),
    );

    const pending = withPwaMutation((context) => api.logout(context));
    expect(getPwaMutationCount()).toBe(1);
    finish?.(new Response(null, { status: 204 }));
    await pending;
    expect(getPwaMutationCount()).toBe(0);
  });
});
