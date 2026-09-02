import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { App } from "./App";
import type { Session } from "./app/types";
import { OperationalApp, resolveInitialOperationalRoute } from "./features/shell/OperationalApp";
import { profiles } from "./profiles";

function operationalSession(profileId: "owner" | "cashier" | "kitchen"): Session {
  const profile = profiles.find((candidate) => candidate.id === profileId);
  if (!profile) throw new Error(`Perfil operacional ausente: ${profileId}`);
  return {
    identityId: `identity-${profileId}`,
    membershipId: `membership-${profileId}`,
    organization: {
      document: "00.000.000/0001-00",
      id: "test-organization",
      name: "Grupo Aurora",
      units: [],
    },
    organizationId: "test-organization",
    platformAdmin: false,
    profile,
    terminalMode: false,
    unit: { id: "test-unit", name: "Unidade Centro", timezone: "America/Sao_Paulo" },
    unitId: "test-unit",
  };
}

describe("experiência operacional", () => {
  it("não exibe login ou dados antes de validar a sessão", () => {
    const html = renderToStaticMarkup(<App />);
    expect(html).toContain("Validando sua sessão");
    expect(html).not.toContain("dados operacionais");
  });

  it("organiza a navegação por operação, atendimento, gestão, financeiro e administração", () => {
    const ownerHtml = renderToStaticMarkup(
      <OperationalApp onLogout={() => {}} session={operationalSession("owner")} />,
    );
    const atendimentoStart = ownerHtml.indexOf(">Atendimento<");
    const atendimentoEnd = ownerHtml.indexOf("</details>", atendimentoStart);
    const atendimentoHtml = ownerHtml.slice(atendimentoStart, atendimentoEnd);
    expect(atendimentoStart).toBeGreaterThan(-1);
    expect(atendimentoEnd).toBeGreaterThan(atendimentoStart);
    expect(ownerHtml).not.toContain("Central Operacional");
    expect(atendimentoHtml).toContain('href="#/reservations"');
    expect(atendimentoHtml).toContain("Recepção e espera");
    expect(ownerHtml).toContain('href="#/salon"');
    expect(atendimentoHtml).toContain("Mesas e comandas");
    expect(atendimentoHtml).toContain('href="#/counter"');
    expect(atendimentoHtml).toContain("Balcão e retirada");
    expect(atendimentoHtml).toContain('href="#/delivery"');
    expect(atendimentoHtml).toContain("Delivery");
    expect(atendimentoHtml).not.toContain('href="#/cash"');

    const operacaoHtml = ownerHtml.slice(
      ownerHtml.indexOf(">Operação<"),
      ownerHtml.indexOf(">Gestão<"),
    );
    expect(operacaoHtml).toContain('href="#/cash"');
    expect(operacaoHtml).toContain("Contas e caixa");
    expect(ownerHtml).toContain('href="#/table-qrs"');
    expect(ownerHtml).toContain("QR das mesas");

    const financeiroStart = ownerHtml.indexOf(">Financeiro e fiscal<");
    const administracaoStart = ownerHtml.indexOf(">Administração<");
    const financeiroHtml = ownerHtml.slice(financeiroStart, administracaoStart);
    const administracaoHtml = ownerHtml.slice(
      administracaoStart,
      ownerHtml.indexOf("</nav>", administracaoStart),
    );
    expect(financeiroStart).toBeGreaterThan(-1);
    expect(administracaoStart).toBeGreaterThan(financeiroStart);
    expect(financeiroHtml).toContain('href="#/finance"');
    expect(financeiroHtml).not.toContain('href="#/billing"');
    expect(administracaoHtml).toContain('href="#/billing"');
    expect(administracaoHtml).toContain("Assinatura e cobrança");

    const cashierHtml = renderToStaticMarkup(
      <OperationalApp onLogout={() => {}} session={operationalSession("cashier")} />,
    );
    expect(cashierHtml).toContain('href="#/salon"');
    expect(cashierHtml).toContain('href="#/counter"');
    expect(cashierHtml).not.toContain('href="#/reservations"');
    expect(cashierHtml).toContain('href="#/cash"');
    expect(cashierHtml).not.toContain('href="#/table-qrs"');
  });

  it("restaura somente a última rota permitida quando não há hash explícito", () => {
    const owner = operationalSession("owner");
    const cashier = operationalSession("cashier");

    expect(resolveInitialOperationalRoute("", "cash", owner)).toBe("cash");
    expect(resolveInitialOperationalRoute("", "salon", cashier)).toBe("salon");
    expect(resolveInitialOperationalRoute("#/counter", "salon", cashier)).toBe("counter");
  });

  it("limita navegacao e links diretos no terminal sem restringir o navegador comum", () => {
    const owner = operationalSession("owner");
    const terminal: Session = {
      ...owner,
      terminalMode: true,
      profile: {
        ...owner.profile,
        permissions: ["dashboard.view", "salon.operate", "counter.operate", "kds.operate"],
      },
    };
    const terminalHtml = renderToStaticMarkup(
      <OperationalApp onLogout={() => {}} session={terminal} />,
    );

    expect(terminalHtml).toContain('href="#/salon"');
    expect(terminalHtml).toContain('href="#/counter"');
    expect(terminalHtml).toContain('href="#/kds/station"');
    expect(terminalHtml).not.toContain('href="#/inventory"');
    expect(terminalHtml).not.toContain('href="#/people"');
    expect(terminalHtml).not.toContain('href="#/settings"');
    expect(resolveInitialOperationalRoute("#/inventory", null, terminal)).toBe("dashboard");
    expect(resolveInitialOperationalRoute("#/inventory", null, owner)).toBe("inventory");
  });

  it("expõe configurações do KDS somente para perfis com gestão do Cardápio", () => {
    const ownerHtml = renderToStaticMarkup(
      <OperationalApp onLogout={() => {}} session={operationalSession("owner")} />,
    );
    expect(ownerHtml).toContain('href="#/kds/station"');
    expect(ownerHtml).toContain('href="#/kds/pass"');
    expect(ownerHtml).toContain('href="#/kds/settings"');

    const kitchenHtml = renderToStaticMarkup(
      <OperationalApp onLogout={() => {}} session={operationalSession("kitchen")} />,
    );
    expect(kitchenHtml).toContain('href="#/kds/station"');
    expect(kitchenHtml).toContain('href="#/kds/pass"');
    expect(kitchenHtml).not.toContain('href="#/kds/settings"');
  });
});
