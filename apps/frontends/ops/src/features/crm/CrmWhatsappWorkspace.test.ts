import { describe, expect, it, vi } from "vitest";
import { ApiClientError } from "../../api";
import {
  conversationNeedsReply,
  requestEvolutionQr,
  whatsappStatusLabel,
} from "./CrmWhatsappWorkspace";
import { crmError, crmFailureMessage } from "./crm.ui";

describe("QR Code da Evolution Go", () => {
  it("configura a integração ausente antes de buscar o QR Code", async () => {
    const configure = vi.fn().mockResolvedValue({});
    const load = vi.fn().mockResolvedValue({ ready: false, state: "qr_ready", qrDataUrl: "data" });

    await expect(requestEvolutionQr(false, configure, load)).resolves.toEqual({
      ready: false,
      state: "qr_ready",
      qrDataUrl: "data",
    });
    expect(configure).toHaveBeenCalledOnce();
    expect(load).toHaveBeenCalledOnce();

    configure.mockClear();
    await requestEvolutionQr(true, configure, load);
    expect(configure).not.toHaveBeenCalled();
  });

  it("explica indisponibilidade sem atribuir todo 503 à licença", () => {
    const message = crmError(new ApiClientError("erro", 503, "EVOLUTION_HTTP_503", true), "erro");
    expect(message).toContain("indisponível");
    expect(message).not.toMatch(/licença|Evolution|503/);
    expect(crmFailureMessage("EVOLUTION_HTTP_503", "erro")).toBe(message);
  });

  it("preserva orientações operacionais e não expõe erros internos", () => {
    const fallback = "Não foi possível concluir. Tente novamente.";
    expect(crmError(new Error("secret provider response"), fallback)).toBe(fallback);
    expect(
      crmError(new ApiClientError("CUSTOMER_INSERT_FAILED", 500, "UNKNOWN", true), fallback),
    ).toBe(fallback);
    expect(
      crmError(new ApiClientError("Sua sessão expirou.", 401, "UNAUTHORIZED", false), fallback),
    ).toBe("Sua sessão expirou.");
    expect(crmFailureMessage("WHATSAPP_DELIVERY_UNCERTAIN", fallback)).toContain(
      "antes de reenviar",
    );
    expect(crmFailureMessage("UNKNOWN_CODE", fallback)).toBe(fallback);
    expect(whatsappStatusLabel("queued")).toBe("Na fila");
    expect(whatsappStatusLabel("suppressed")).toContain("regras de envio");
    expect(whatsappStatusLabel("unknown_internal_status")).toBe("Aguardando atualização");
  });

  it("não pede QR se a configuração falha", async () => {
    const failure = new ApiClientError("erro", 503, "EVOLUTION_HTTP_503", true);
    const configure = vi.fn().mockRejectedValue(failure);
    const load = vi.fn();
    await expect(requestEvolutionQr(false, configure, load)).rejects.toBe(failure);
    expect(load).not.toHaveBeenCalled();
  });
});

describe("triagem da inbox", () => {
  const conversation = {
    id: "conversation-1",
    customerId: "customer-1",
    customerName: "Ana",
    phone: "5511999999999",
    status: "open",
    priority: "normal" as const,
    assignedIdentityId: null,
    assignedIdentityName: null,
    slaDueAt: null,
    firstResponseAt: null,
    updatedAt: "2026-09-09T12:00:00.000Z",
    unreadCount: 1,
    lastMessageAt: "2026-09-09T12:00:00.000Z",
    lastInboundAt: "2026-09-09T12:00:00.000Z",
    lastOutboundAt: "2026-09-09T11:00:00.000Z",
  };

  it("marca apenas conversa operacional cuja última direção efetiva é entrada", () => {
    expect(conversationNeedsReply(conversation)).toBe(true);
    expect(
      conversationNeedsReply({
        ...conversation,
        lastOutboundAt: "2026-09-09T12:01:00.000Z",
      }),
    ).toBe(false);
    expect(conversationNeedsReply({ ...conversation, status: "closed" })).toBe(false);
  });
});
