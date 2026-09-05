import { describe, expect, it, vi } from "vitest";
import {
  buildCourierWhatsAppLink,
  buildDeliveryWhatsAppLink,
  refreshAuthoritativeDeliveryState,
  requiresDeliveryCoverageOverride,
  stableDeliveryDispatchAttempt,
} from "./DeliveryPage";

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

  it("exige confirmação manual somente quando a cobertura da entrega não foi validada", () => {
    expect(
      requiresDeliveryCoverageOverride({
        fulfillment: "delivery",
        addressValidationStatus: "unchecked",
      }),
    ).toBe(true);
    expect(
      requiresDeliveryCoverageOverride({
        fulfillment: "delivery",
        addressValidationStatus: "covered",
      }),
    ).toBe(false);
    expect(
      requiresDeliveryCoverageOverride({
        fulfillment: "pickup",
        addressValidationStatus: "unchecked",
      }),
    ).toBe(false);
  });

  it("reutiliza as chaves de atribuição e despacho durante o retry", () => {
    const attempts = new Map();
    let sequence = 0;
    const createKey = (prefix: string) => `${prefix}-${++sequence}`;
    const first = stableDeliveryDispatchAttempt(attempts, "delivery-1", "courier-1", createKey);

    expect(stableDeliveryDispatchAttempt(attempts, "delivery-1", "courier-1", createKey)).toEqual(
      first,
    );
    expect(
      stableDeliveryDispatchAttempt(attempts, "delivery-1", "courier-2", createKey),
    ).not.toEqual(first);
  });

  it("recarrega o estado autoritativo após o despacho", () => {
    const refreshOrders = vi.fn();
    const refreshFilteredOrders = vi.fn();
    const refreshCouriers = vi.fn();

    refreshAuthoritativeDeliveryState(refreshOrders, refreshCouriers, refreshFilteredOrders);

    expect(refreshOrders).toHaveBeenCalledOnce();
    expect(refreshFilteredOrders).toHaveBeenCalledOnce();
    expect(refreshCouriers).toHaveBeenCalledOnce();
  });
});
