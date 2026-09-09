import { describe, expect, it, vi } from "vitest";
import { ApiClientError } from "../../api";
import { conversationNeedsReply, requestEvolutionQr } from "./CrmWhatsappWorkspace";
import { crmError } from "./crm.ui";

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

  it("explica quando a licença do provedor ainda não foi ativada", () => {
    expect(crmError(new ApiClientError("erro", 503, "EVOLUTION_HTTP_503", true), "erro")).toBe(
      "A licença da Evolution Go ainda não foi ativada neste ambiente.",
    );
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
