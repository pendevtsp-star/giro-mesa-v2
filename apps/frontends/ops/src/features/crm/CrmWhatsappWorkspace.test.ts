import { describe, expect, it, vi } from "vitest";
import { ApiClientError } from "../../api";
import { requestEvolutionQr } from "./CrmWhatsappWorkspace";
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
