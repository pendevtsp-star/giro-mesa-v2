import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { type DeliveryOrder, parseDeliveryOrders } from "../../growth.shared";
import { type PilotScope, type PosTab, useRemote } from "../../operations.shared";
import { CounterDeliveryPanel, counterDeliveryDispatchInput } from "./CounterDeliveryPanel";

vi.mock("../../operations.shared", () => ({ useRemote: vi.fn() }));
vi.mock("../../api", () => ({ api: { growth: {} } }));

const order = {
  id: "delivery-1",
  orderRef: "tab-1",
  status: "ready",
  fulfillment: "delivery",
  addressValidationStatus: "unchecked",
  courierId: null,
  courierReference: null,
} as DeliveryOrder;

function markup(delivery = order) {
  vi.mocked(useRemote).mockImplementation(
    (_scope, _loader, parser) =>
      ({
        state: { status: "ready", data: parser === parseDeliveryOrders ? [delivery] : [] },
        refresh: vi.fn(),
      }) as unknown as ReturnType<typeof useRemote>,
  );
  return renderToStaticMarkup(
    <CounterDeliveryPanel
      scope={{} as PilotScope}
      tab={
        {
          id: "tab-1",
          version: 1,
          status: "open",
          customerName: "Cliente",
          deliveryAddress: "Rua A",
        } as PosTab
      }
      courierId=""
      onCourierChange={vi.fn()}
      onChanged={vi.fn()}
      onEdit={vi.fn()}
      onPrint={vi.fn()}
    />,
  );
}

describe("CounterDeliveryPanel dispatch", () => {
  beforeEach(() => vi.clearAllMocks());

  it("mantém a seleção opcional e permite responsável avulso com cobertura explícita", () => {
    const html = markup();
    expect(html).toContain("Entregador · opcional");
    expect(html).toContain("Definir depois");
    expect(html).toContain("Responsável avulso pela entrega");
    expect(html).toContain("Motivo da confirmação manual de cobertura");
    expect(html).toContain("não foi validada automaticamente");
    expect(html).toContain("Saiu para entrega");
    expect(html).toContain('minLength="10"');
  });

  it("reutiliza o responsável cadastrado e a cobertura já validada", () => {
    const html = markup({
      ...order,
      courierId: "courier-1",
      courierReference: "Ana",
      addressValidationStatus: "covered",
    });
    expect(html).not.toContain("Responsável avulso pela entrega");
    expect(html).not.toContain("Motivo da confirmação manual de cobertura");
    expect(html).toContain("Ana");
    expect(html).toContain("Saiu para entrega");
  });

  it.each([
    "unchecked",
    "unavailable",
  ] as const)("envia o motivo para cobertura %s e preserva o nome informado", (addressValidationStatus) => {
    expect(
      counterDeliveryDispatchInput(
        { ...order, addressValidationStatus },
        "  João da entrega  ",
        "  Cliente confirmou o endereço por telefone.  ",
      ),
    ).toEqual({
      courierReference: "João da entrega",
      coverageOverrideReason: "Cliente confirmou o endereço por telefone.",
    });
  });

  it("não inventa responsável nem libera cobertura sem justificativa suficiente", () => {
    expect(() =>
      counterDeliveryDispatchInput(order, " ", "Endereço confirmado pelo cliente"),
    ).toThrow("responsável");
    expect(() => counterDeliveryDispatchInput(order, "João", "ok")).toThrow("cobertura");
    expect(() => counterDeliveryDispatchInput(order, "João", "a".repeat(501))).toThrow("cobertura");
    expect(() =>
      counterDeliveryDispatchInput(order, "a".repeat(161), "Motivo com dez caracteres"),
    ).toThrow("responsável");
  });

  it("omite override desnecessário em endereço coberto", () => {
    expect(
      counterDeliveryDispatchInput({ ...order, addressValidationStatus: "covered" }, "Ana", ""),
    ).toEqual({ courierReference: "Ana" });
  });
});
