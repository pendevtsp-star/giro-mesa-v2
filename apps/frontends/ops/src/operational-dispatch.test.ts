import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiClientError } from "./api";
import {
  createCommand,
  enqueueCommand,
  quarantinedCommands,
  queuedCommandCount,
  queuedCommands,
} from "./commands";
import {
  dispatchOperationalMutation,
  loadOperationalResource,
  pilotMutation,
  QueuedOperationalMutationError,
  RejectedOperationalMutationError,
  replayOperationalQueue,
} from "./operational-dispatch";

const storage = new Map<string, string>();
vi.stubGlobal("localStorage", {
  getItem: (key: string) => storage.get(key) ?? null,
  setItem: (key: string, value: string) => storage.set(key, value),
  removeItem: (key: string) => storage.delete(key),
});
vi.stubGlobal("crypto", { randomUUID: () => "11111111-1111-4111-8111-111111111111" });

beforeEach(() => {
  storage.clear();
  vi.restoreAllMocks();
  vi.stubGlobal("window", { HybridWebView: undefined });
});

describe("fila idempotente das mutações POS", () => {
  it("preserva falha de API e remove somente depois do replay confirmado", async () => {
    const failing = vi
      .fn()
      .mockRejectedValue(new ApiClientError("offline", 0, "API_UNREACHABLE", true));
    await expect(
      dispatchOperationalMutation({
        scope: { organizationId: "org-1", unitId: "unit-1", actorId: "actor-1" },
        runtime: { embedded: false, deviceId: "device-1", deviceName: "Browser", platform: "web" },
        type: "pos.tab.open_requested",
        payload: pilotMutation("open-tab", { body: { label: "Balcão", guestCount: 1 } }),
        execute: failing,
      }),
    ).rejects.toBeInstanceOf(QueuedOperationalMutationError);
    expect(queuedCommandCount()).toBe(1);

    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ tab: { id: "tab-1" } }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);
    await replayOperationalQueue(
      { organizationId: "org-1", unitId: "unit-1", actorId: "actor-1" },
      { embedded: false, deviceId: "device-1", deviceName: "Browser", platform: "web" },
    );

    expect(queuedCommandCount()).toBe(0);
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("/pilot/tabs/open"),
      expect.objectContaining({
        headers: expect.objectContaining({
          "idempotency-key": "device-1:11111111-1111-4111-8111-111111111111",
        }),
      }),
    );
  });

  it("usa o Hub como fronteira única no aplicativo e devolve a projeção local", async () => {
    const invoke = vi.fn().mockResolvedValue({
      Success: true,
      Duplicate: false,
      Result: { tab: { id: "11111111-1111-4111-8111-111111111111" } },
    });
    window.HybridWebView = { SendRawMessage: vi.fn(), InvokeDotNet: invoke };
    const execute = vi.fn();

    const result = await dispatchOperationalMutation({
      scope: { organizationId: "org-1", unitId: "unit-1", actorId: "actor-1" },
      runtime: { embedded: true, deviceId: "device-1", deviceName: "Terminal", platform: "win" },
      type: "pos.tab.open_requested",
      payload: pilotMutation("open-tab", { body: { label: "Balcão", guestCount: 1 } }),
      execute,
    });

    expect(result).toEqual({ tab: { id: "11111111-1111-4111-8111-111111111111" } });
    expect(execute).not.toHaveBeenCalled();
    const command = JSON.parse(String(invoke.mock.calls[0]?.[1]?.[3])) as {
      idempotencyKey: string;
    };
    expect(command.idempotencyKey).toBe("device-1:11111111-1111-4111-8111-111111111111");
  });

  it("reenvia ao Hub sem duplicar a mutação pela API", async () => {
    const invoke = vi
      .fn()
      .mockResolvedValueOnce({
        Success: false,
        Duplicate: false,
        ErrorCode: "HUB_COMMAND_UNREACHABLE",
      })
      .mockResolvedValueOnce({
        Success: true,
        Duplicate: false,
        Result: { tab: { id: "11111111-1111-4111-8111-111111111111" } },
      });
    window.HybridWebView = { SendRawMessage: vi.fn(), InvokeDotNet: invoke };
    const runtime = {
      embedded: true,
      deviceId: "device-1",
      deviceName: "Terminal",
      platform: "win",
    };
    await expect(
      dispatchOperationalMutation({
        scope: { organizationId: "org-1", unitId: "unit-1", actorId: "actor-1" },
        runtime,
        type: "pos.tab.open_requested",
        payload: pilotMutation("open-tab", { body: { label: "Balcão", guestCount: 1 } }),
        execute: vi.fn(),
      }),
    ).rejects.toBeInstanceOf(QueuedOperationalMutationError);

    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const remaining = await replayOperationalQueue(
      { organizationId: "org-1", unitId: "unit-1", actorId: "actor-1" },
      runtime,
    );

    expect(remaining).toBe(0);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("não enfileira rejeição determinística do Hub", async () => {
    window.HybridWebView = {
      SendRawMessage: vi.fn(),
      InvokeDotNet: vi.fn().mockResolvedValue({
        Success: false,
        Duplicate: false,
        ErrorCode: "INVALID_KDS_TRANSITION",
      }),
    };

    await expect(
      dispatchOperationalMutation({
        scope: { organizationId: "org-1", unitId: "unit-1", actorId: "actor-1" },
        runtime: {
          embedded: true,
          deviceId: "device-1",
          deviceName: "Terminal",
          platform: "win",
        },
        type: "pos.kds.transition_requested",
        payload: pilotMutation("transition-kds", { ticketId: "ticket-1", state: "ready" }),
        execute: vi.fn(),
      }),
    ).rejects.toBeInstanceOf(RejectedOperationalMutationError);
    expect(queuedCommandCount()).toBe(0);
  });

  it.each([
    {
      action: "discount-item" as const,
      type: "pos.item.discount_requested",
      data: {
        itemId: "item-1",
        body: {
          discountCents: 100,
          approval: { approverMembershipId: "manager-1", pin: "1234", reason: "Cortesia" },
        },
      },
    },
    {
      action: "cancel-item" as const,
      type: "pos.item.cancel_requested",
      data: {
        itemId: "item-1",
        approval: { approverMembershipId: "manager-1", pin: "1234", reason: "Erro" },
      },
    },
    {
      action: "cancel-kds-ticket" as const,
      type: "pos.kds.cancel_requested",
      data: {
        ticketId: "ticket-1",
        approval: { approverMembershipId: "manager-1", pin: "1234", reason: "Erro" },
      },
    },
  ])("mantém $action cloud-only e nunca persiste o PIN", async ({ action, type, data }) => {
    const invoke = vi.fn();
    window.HybridWebView = { SendRawMessage: vi.fn(), InvokeDotNet: invoke };
    const execute = vi
      .fn()
      .mockRejectedValue(new ApiClientError("offline", 0, "API_UNREACHABLE", true));

    await expect(
      dispatchOperationalMutation({
        scope: { organizationId: "org-1", unitId: "unit-1", actorId: "actor-1" },
        runtime: {
          embedded: true,
          deviceId: "device-1",
          deviceName: "Terminal",
          platform: "win",
        },
        type,
        payload: pilotMutation(action, data),
        execute,
      }),
    ).rejects.toBeInstanceOf(ApiClientError);
    expect(execute).toHaveBeenCalledOnce();
    expect(invoke).not.toHaveBeenCalled();
    expect(queuedCommandCount()).toBe(0);
    expect([...storage.values()].join("\n")).not.toContain("1234");
  });

  it("prioriza o snapshot do Hub ao carregar o estado operacional", async () => {
    window.HybridWebView = {
      SendRawMessage: vi.fn(),
      InvokeDotNet: vi.fn().mockResolvedValue({
        Success: true,
        Payload: [{ id: "tab-local" }],
      }),
    };
    const cloudLoader = vi.fn();

    const result = await loadOperationalResource(
      { embedded: true, deviceId: "device-1", deviceName: "Terminal", platform: "win" },
      "tabs",
      undefined,
      cloudLoader,
    );

    expect(result).toEqual([{ id: "tab-local" }]);
    expect(cloudLoader).not.toHaveBeenCalled();
  });

  it("isola a fila por unidade, deduplica ação KDS e quarentena rejeição permanente", async () => {
    const scopeA = { organizationId: "org-1", unitId: "unit-1", actorId: "actor-1" };
    const scopeB = { organizationId: "org-1", unitId: "unit-2", actorId: "actor-1" };
    const payload = pilotMutation("transition-kds", {
      ticketId: "ticket-1",
      state: "preparing",
    });
    const first = createCommand("device-1", "pos.kds.transition_requested", payload);
    const duplicate = { ...first, id: "22222222-2222-4222-8222-222222222222" };
    enqueueCommand(first, scopeA);
    enqueueCommand(duplicate, scopeA);
    enqueueCommand(duplicate, scopeB);

    expect(queuedCommands(scopeA)).toHaveLength(1);
    expect(queuedCommands(scopeB)).toHaveLength(1);
    window.HybridWebView = {
      SendRawMessage: vi.fn(),
      InvokeDotNet: vi.fn().mockResolvedValue({
        Success: false,
        Duplicate: false,
        ErrorCode: "INVALID_KDS_TRANSITION",
      }),
    };
    await replayOperationalQueue(scopeA, {
      embedded: true,
      deviceId: "device-1",
      deviceName: "Terminal",
      platform: "win",
    });

    expect(queuedCommands(scopeA)).toHaveLength(0);
    expect(queuedCommands(scopeB)).toHaveLength(1);
    expect(quarantinedCommands(scopeA)[0]?.errorCode).toBe("INVALID_KDS_TRANSITION");
  });

  it("quarentena fila legada sem inferir organização ou unidade", () => {
    const command = createCommand("device-1", "pos.kds.transition_requested", {});
    storage.set("giromesa.ops.command-queue.v1", JSON.stringify([command]));

    expect(
      queuedCommands({ organizationId: "org-1", unitId: "unit-1", actorId: "actor-1" }),
    ).toHaveLength(0);
    expect(quarantinedCommands()[0]?.errorCode).toBe("LEGACY_SCOPE_UNKNOWN");
  });

  it("deduplica e reprocessa disponibilidade KDS por produto e estado", async () => {
    const scope = { organizationId: "org-1", unitId: "unit-1", actorId: "actor-1" };
    const payload = pilotMutation("set-kds-product-availability", {
      productId: "product-1",
      available: false,
      reason: "Sem insumo",
    });
    const first = createCommand("device-1", "pos.kds.availability_requested", payload);
    enqueueCommand(first, scope);
    enqueueCommand(
      { ...first, id: "22222222-2222-4222-8222-222222222222", idempotencyKey: "device-1:2" },
      scope,
    );
    expect(queuedCommands(scope)).toHaveLength(1);

    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ productId: "product-1", available: false }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);
    await replayOperationalQueue(scope, {
      embedded: false,
      deviceId: "device-1",
      deviceName: "Browser",
      platform: "web",
    });

    expect(queuedCommands(scope)).toHaveLength(0);
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("/pilot/kds/products/product-1/availability"),
      expect.objectContaining({
        method: "PUT",
        body: JSON.stringify({ available: false, reason: "Sem insumo" }),
      }),
    );
  });
});
