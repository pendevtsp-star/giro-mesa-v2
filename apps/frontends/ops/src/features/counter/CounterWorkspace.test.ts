import { describe, expect, it, vi } from "vitest";
import { ApiClientError } from "../../api";
import {
  canReleaseOrderDraftAfterPermanentCreateError,
  createPendingOrderSubmission,
  type DraftCartItem,
  parsePendingOrderSubmission,
  repeatRoundItemAvailability,
} from "./CounterWorkspace";

const scope = {
  organizationId: "org-1",
  unitId: "unit-1",
  identityId: "identity-1",
  tabId: "tab-1",
};
const items: DraftCartItem[] = [
  {
    id: "draft-1",
    productId: "product-1",
    name: "Bebida 1",
    quantity: 1,
    modifierOptionIds: [],
    course: "anytime",
  },
  {
    id: "draft-2",
    productId: "product-2",
    name: "Bebida 2",
    quantity: 1,
    modifierOptionIds: [],
    course: "main",
  },
];

describe("continuidade do pedido no balcão", () => {
  it("revalida disponibilidade, preço, rota e estoque ao repor uma rodada", () => {
    const firstItem = items[0] as DraftCartItem;
    const product = {
      active: true,
      available: true,
      dailyStockRemaining: 2,
      priceCents: 1590,
      stationIds: ["bar"],
    };
    expect(repeatRoundItemAvailability(firstItem, product, new Set(["bar"]))).toEqual({
      available: true,
      reason: null,
      priceCents: 1590,
    });
    expect(
      repeatRoundItemAvailability(
        { productId: "product-1", quantity: 3 },
        product,
        new Set(["bar"]),
      ),
    ).toMatchObject({ available: false, reason: expect.stringContaining("Restam 2") });
    expect(repeatRoundItemAvailability(firstItem, product, new Set())).toMatchObject({
      available: false,
      reason: "Produto sem estação ativa.",
    });
  });
  it("preserva comandos por etapa para retomar o mesmo pedido após recarga", () => {
    vi.stubGlobal("crypto", {
      randomUUID: vi.fn().mockReturnValueOnce("command-1").mockReturnValueOnce("command-2"),
    });
    const submission = createPendingOrderSubmission(scope, "device-1", items, true);
    const restored = parsePendingOrderSubmission(JSON.stringify(submission), scope);

    expect(restored).toEqual(submission);
    expect(restored?.groups.map((group) => group.createCommand.idempotencyKey)).toEqual([
      "device-1:command-1",
      "device-1:command-2",
    ]);
  });

  it("não reutiliza um pedido pendente em outra identidade, unidade ou comanda", () => {
    vi.stubGlobal("crypto", { randomUUID: () => "command-1" });
    const stored = JSON.stringify(createPendingOrderSubmission(scope, "device-1", items, false));

    expect(parsePendingOrderSubmission(stored, { ...scope, identityId: "identity-2" })).toBeNull();
    expect(parsePendingOrderSubmission(stored, { ...scope, unitId: "unit-2" })).toBeNull();
    expect(parsePendingOrderSubmission(stored, { ...scope, tabId: "tab-2" })).toBeNull();
  });

  it("retoma só os grupos pendentes depois de confirmação parcial e recarga", () => {
    const submission = createPendingOrderSubmission(scope, "device-1", items, true);
    submission.groups = submission.groups.slice(1);
    const restored = parsePendingOrderSubmission(JSON.stringify(submission), scope);
    expect(restored).toEqual(submission);
    expect(restored?.groups[0]?.itemIds).toEqual(["draft-2"]);
    expect(restored?.items).toHaveLength(2);
  });

  it("libera o rascunho quando a criação é rejeitada antes de aceitar qualquer grupo", () => {
    const submission = createPendingOrderSubmission(scope, "device-1", items, true);
    expect(
      canReleaseOrderDraftAfterPermanentCreateError(
        new ApiClientError("Produto indisponível", 409, "PRODUCT_UNAVAILABLE", false),
        submission,
        0,
        new Set(),
      ),
    ).toBe(true);
    expect(
      canReleaseOrderDraftAfterPermanentCreateError(
        new ApiClientError("Entrada inválida", 422, "INVALID_INPUT", false),
        submission,
        0,
        new Set(),
      ),
    ).toBe(true);
    expect(
      canReleaseOrderDraftAfterPermanentCreateError(
        new ApiClientError("Entrada inválida", 400, "INVALID_INPUT", false),
        submission,
        0,
        new Set(),
      ),
    ).toBe(true);
  });

  it("mantém o rascunho bloqueado para fila, timeout e confirmação parcial", () => {
    const submission = createPendingOrderSubmission(scope, "device-1", items, true);
    const commandId = submission.groups[0]?.createCommand.id;
    expect(commandId).toBeTruthy();
    expect(
      canReleaseOrderDraftAfterPermanentCreateError(
        new ApiClientError("Indisponível", 0, "API_TIMEOUT", true),
        submission,
        0,
        new Set(),
      ),
    ).toBe(false);
    expect(
      canReleaseOrderDraftAfterPermanentCreateError(
        new ApiClientError("Produto indisponível", 409, "PRODUCT_UNAVAILABLE", false),
        submission,
        0,
        new Set(commandId ? [commandId] : []),
      ),
    ).toBe(false);
    expect(
      canReleaseOrderDraftAfterPermanentCreateError(
        new ApiClientError("Conflito", 409, "ORDER_ALREADY_SENT", false),
        submission,
        0,
        new Set(),
      ),
    ).toBe(false);
    submission.groups = submission.groups.slice(1);
    expect(
      canReleaseOrderDraftAfterPermanentCreateError(
        new ApiClientError("Produto indisponível", 409, "PRODUCT_UNAVAILABLE", false),
        submission,
        0,
        new Set(),
      ),
    ).toBe(false);
  });
});
