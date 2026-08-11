import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiClientError } from "./api";
import { queuedCommandCount } from "./commands";
import {
  acknowledgeKdsDelivery,
  dispatchOperationalMutation,
  loadOperationalResource,
  pendingKdsAcknowledgementCount,
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
        ErrorCode: "OFFLINE_MANAGER_APPROVAL_INVALID",
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
        type: "pos.item.discount_requested",
        payload: pilotMutation("discount-item", { itemId: "item-1" }),
        execute: vi.fn(),
      }),
    ).rejects.toBeInstanceOf(RejectedOperationalMutationError);
    expect(queuedCommandCount()).toBe(0);
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

  it("falha fechado no KDS quando a inbox durável do Edge não responde", async () => {
    window.HybridWebView = {
      SendRawMessage: vi.fn(),
      InvokeDotNet: vi.fn().mockResolvedValue({
        Success: false,
        ErrorCode: "KDS_EDGE_UNREACHABLE",
      }),
    };
    const cloudLoader = vi.fn().mockResolvedValue({ tickets: [{ id: "cloud-only" }], items: [] });

    await expect(
      loadOperationalResource(
        { embedded: true, deviceId: "device-1", deviceName: "Terminal", platform: "win" },
        "kds",
        undefined,
        cloudLoader,
      ),
    ).rejects.toMatchObject({ code: "KDS_EDGE_UNREACHABLE" });
    expect(cloudLoader).not.toHaveBeenCalled();
  });

  it("preserva ACK do KDS offline e o reproduz com a mesma identidade", async () => {
    const invoke = vi
      .fn()
      .mockResolvedValueOnce({ Success: false, ErrorCode: "HUB_ACK_UNREACHABLE" })
      .mockResolvedValueOnce({ Success: true });
    window.HybridWebView = { SendRawMessage: vi.fn(), InvokeDotNet: invoke };
    const runtime = {
      embedded: true,
      deviceId: "device-1",
      deviceName: "Terminal",
      platform: "win",
    };

    await expect(acknowledgeKdsDelivery(runtime, "effect-1", "delivery-1")).rejects.toMatchObject({
      code: "HUB_ACK_UNREACHABLE",
    });
    expect(pendingKdsAcknowledgementCount()).toBe(1);

    const remaining = await replayOperationalQueue(
      { organizationId: "org-1", unitId: "unit-1", actorId: "actor-1" },
      runtime,
    );
    expect(remaining).toBe(0);
    expect(invoke.mock.calls.map((call) => call[0])).toEqual([
      "AcknowledgeKdsDispatchAsync",
      "AcknowledgeKdsDispatchAsync",
    ]);
    expect(invoke.mock.calls[0]?.[1]).toEqual(["effect-1", "delivery-1"]);
    expect(invoke.mock.calls[1]?.[1]).toEqual(["effect-1", "delivery-1"]);
  });
});
