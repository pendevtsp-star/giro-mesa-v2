import { beforeEach, describe, expect, it, vi } from "vitest";
import { api, resolveSecurityUrl } from "./api";
import { parseShellContext, sendShellCommand } from "./bridge";
import { createCommand, enqueueCommand, queuedCommandCount, removeQueuedCommand } from "./commands";

const storage = new Map<string, string>();
vi.stubGlobal("localStorage", {
  getItem: (key: string) => storage.get(key) ?? null,
  setItem: (key: string, value: string) => storage.set(key, value),
  removeItem: (key: string) => storage.delete(key),
});
vi.stubGlobal("crypto", { randomUUID: () => "11111111-1111-4111-8111-111111111111" });

beforeEach(() => storage.clear());

describe("integração operacional", () => {
  it("aceita apenas URL web para a segurança da conta", () => {
    expect(resolveSecurityUrl("https://conta.giromesa.com.br/app?return=unsafe#x")).toBe(
      "https://conta.giromesa.com.br/app/seguranca",
    );
    expect(resolveSecurityUrl("javascript:alert(1)")).toBeNull();
  });

  it("cria o envelope aceito pelo contrato e preserva idempotência na fila", () => {
    const command = createCommand(
      "22222222-2222-4222-8222-222222222222",
      "order.item_added",
      { productId: "burger", quantity: 1 },
      new Date("2026-08-09T20:00:00.000Z"),
    );
    expect(command).toEqual({
      id: "11111111-1111-4111-8111-111111111111",
      deviceId: "22222222-2222-4222-8222-222222222222",
      type: "order.item_added",
      version: 1,
      occurredAt: "2026-08-09T20:00:00.000Z",
      idempotencyKey: "22222222-2222-4222-8222-222222222222:11111111-1111-4111-8111-111111111111",
      payload: { productId: "burger", quantity: 1 },
    });
    expect(enqueueCommand(command)).toBe(1);
    expect(queuedCommandCount()).toBe(1);
    expect(removeQueuedCommand(command.id)).toBe(0);
    expect(queuedCommandCount()).toBe(0);
  });

  it("envia comando e escopo ao bridge nativo", async () => {
    const invoke = vi.fn().mockResolvedValue({ Success: true, Duplicate: false });
    vi.stubGlobal("window", { HybridWebView: { InvokeDotNet: invoke } });
    const command = createCommand(
      "22222222-2222-4222-8222-222222222222",
      "order.created",
      {},
      new Date("2026-08-09T20:00:00.000Z"),
    );

    await expect(sendShellCommand("org-1", "unit-1", "actor-1", command)).resolves.toEqual({
      success: true,
      duplicate: false,
      errorCode: undefined,
    });
    expect(invoke).toHaveBeenCalledWith("SendCommandAsync", [
      "org-1",
      "unit-1",
      "actor-1",
      JSON.stringify(command),
    ]);
  });

  it("normaliza contexto PascalCase do MAUI e ignora mensagens inválidas", () => {
    expect(
      parseShellContext(
        JSON.stringify({
          type: "shell.context",
          payload: {
            DeviceId: "33333333-3333-4333-8333-333333333333",
            DeviceName: "Caixa 01",
            Platform: "WinUI",
            HubUrl: "http://giromesa-hub.local:43120",
          },
        }),
      ),
    ).toEqual({
      embedded: true,
      deviceId: "33333333-3333-4333-8333-333333333333",
      deviceName: "Caixa 01",
      platform: "WinUI",
      hubUrl: "http://giromesa-hub.local:43120",
    });
    expect(parseShellContext("not-json")).toBeNull();
  });

  it("converte erro real da API em falha tratável", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          statusCode: 402,
          code: "OPERATION_RESTRICTED",
          message: "Novas operações estão bloqueadas.",
        }),
        { status: 402, headers: { "content-type": "application/json" } },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(api.health()).rejects.toMatchObject({
      status: 402,
      code: "OPERATION_RESTRICTED",
      message: "Novas operações estão bloqueadas.",
      retryable: false,
    });
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("/health"),
      expect.objectContaining({ credentials: "include" }),
    );
  });

  it("conclui desafio MFA por cookie sem persistir bearer", async () => {
    const challengeToken = "c".repeat(43);
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ mfaRequired: true, challengeToken }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ identity: { id: "identity-1" } }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      );
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      api.login({ email: "marina@example.com", password: "senha-segura", trustedDevice: true }),
    ).resolves.toEqual({ mfaRequired: true, challengeToken, expiresAt: undefined });
    await api.verifyMfaChallenge({ challengeToken, code: "123456" });

    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      expect.stringContaining("/v1/auth/mfa/challenge/verify"),
      expect.objectContaining({
        credentials: "include",
        body: JSON.stringify({ challengeToken, code: "123456" }),
      }),
    );
    expect(JSON.stringify(fetchMock.mock.calls)).not.toContain("Bearer");
  });

  it("envia comandos gerenciais com cookie e chave de idempotência", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ status: "approved" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await api.management.approvePurchase("org-1", "unit-1", "purchase-1", "idem-1");

    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining(
        "/v1/organizations/org-1/units/unit-1/management/purchases/purchase-1/approve",
      ),
      expect.objectContaining({
        method: "POST",
        credentials: "include",
        headers: expect.objectContaining({ "idempotency-key": "idem-1" }),
      }),
    );
  });

  it("envia mutações POS com cookie e idempotência inclusive em PUT", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ tabId: "tab-1" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await api.pilot.serviceCharge("org-1", "unit-1", "tab-1", 1_000, "idem-pos-1");

    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining(
        "/v1/organizations/org-1/units/unit-1/pilot/tabs/tab-1/service-charge",
      ),
      expect.objectContaining({
        method: "PUT",
        credentials: "include",
        body: JSON.stringify({ basisPoints: 1_000 }),
        headers: expect.objectContaining({ "idempotency-key": "idem-pos-1" }),
      }),
    );
  });

  it("consulta o overview da plataforma somente com a sessão cookie", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          counts: { organizations: 0, units: 0, activeTrials: 0 },
          recentTrialApplications: [],
          recentContacts: [],
          recentOrganizations: [],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    await api.platform.overview();

    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("/v1/platform/overview"),
      expect.objectContaining({ credentials: "include" }),
    );
    expect(JSON.stringify(fetchMock.mock.calls)).not.toContain("Authorization");
  });
});
