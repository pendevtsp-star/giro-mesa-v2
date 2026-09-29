import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { PilotScope, PosTab } from "../../operations.shared";
import { AccountChargesPanel } from "./AccountChargesPanel";

function render(profileId: PilotScope["profileId"], rate: number, suggested?: number) {
  return renderToStaticMarkup(
    <AccountChargesPanel
      scope={{ profileId, membershipId: "self" } as PilotScope}
      tab={
        {
          id: "tab",
          status: "open",
          serviceChargeBasisPoints: rate,
          suggestedServiceChargeBasisPoints: suggested,
          serviceChargeCents: 125,
          subtotalCents: 1000,
          discountCents: 200,
          tipCents: 350,
        } as PosTab
      }
      online
      busy={false}
      pendingDiscount={false}
      remainingCents={1000}
      onMutate={async () => true}
    />,
  );
}

describe("ajustes da conta", () => {
  it("usa a taxa real sem presumir dez por cento e preserva a gorjeta atual", () => {
    const html = render("owner", 1250, 1200);
    expect(html).toContain("Serviço 12,5%");
    expect(html).toContain("Retirar serviço");
    expect(html).toContain('value="3,50"');
    expect(html).not.toContain("Percentual");
    expect(render("owner", 0, 1200)).toContain("Taxa configurada: 12%");
    expect(render("owner", 0)).not.toContain("Aplicar serviço configurado");
  });
  it("solicita autorização na sessão do garçom sem coletar PIN de outro usuário", () => {
    const html = render("waiter", 0);
    expect(html).toContain("Solicitar desconto");
    expect(html).toContain("O gerente aprova no próprio dispositivo");
    expect(html).not.toContain('type="password"');
    expect(html).not.toContain("Salvar gorjeta");
    expect(render("manager", 0)).toContain('type="password"');
  });
});
