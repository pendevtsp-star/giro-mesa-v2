import { describe, expect, it } from "vitest";
import { buildCourierWhatsAppLink, buildDeliveryWhatsAppLink } from "./DeliveryPage";

describe("integração operacional de mensageria WhatsApp no Delivery", () => {
  it("monta o link direto do cliente com DDI 55 e mensagem amigável", () => {
    const link = buildDeliveryWhatsAppLink("11987654321", "Carlos Lima", "PED-8812");
    expect(link).not.toBeNull();
    expect(link).toContain("https://wa.me/5511987654321");
    expect(link).toContain(encodeURIComponent("Carlos Lima"));
    expect(link).toContain(encodeURIComponent("#PED-8812"));
  });

  it("retorna null para telefones inválidos ou com menos de 8 dígitos", () => {
    expect(buildDeliveryWhatsAppLink("123")).toBeNull();
    expect(buildDeliveryWhatsAppLink("")).toBeNull();
  });

  it("monta o link direto para acionar entregador na Central de Entregas", () => {
    const link = buildCourierWhatsAppLink("(11) 97777-6666", "Marcos Moto");
    expect(link).not.toBeNull();
    expect(link).toContain("https://wa.me/5511977776666");
    expect(link).toContain(encodeURIComponent("Marcos Moto"));
  });
});
