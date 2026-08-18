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

  it("agrupa mesas e balcão na Central Operacional conforme as permissões", () => {
    const ownerHtml = renderToStaticMarkup(
      <OperationalApp onLogout={() => {}} session={operationalSession("owner")} />,
    );
    expect(ownerHtml).toContain("Central Operacional");
    expect(ownerHtml).toContain('href="#/salon"');
    expect(ownerHtml).toContain("Mesas e comandas");
    expect(ownerHtml).toContain('href="#/counter"');
    expect(ownerHtml).toContain("Balcão e retirada");
    expect(ownerHtml).toContain('href="#/reservations"');
    expect(ownerHtml).toContain("Recepção e espera");
    expect(ownerHtml).toContain('href="#/cash"');
    expect(ownerHtml).toContain("Contas e caixa");

    const cashierHtml = renderToStaticMarkup(
      <OperationalApp onLogout={() => {}} session={operationalSession("cashier")} />,
    );
    expect(cashierHtml).not.toContain('href="#/salon"');
    expect(cashierHtml).toContain('href="#/counter"');
    expect(cashierHtml).not.toContain('href="#/reservations"');
    expect(cashierHtml).toContain('href="#/cash"');
  });

  it("restaura somente a última rota permitida quando não há hash explícito", () => {
    const owner = operationalSession("owner");
    const cashier = operationalSession("cashier");

    expect(resolveInitialOperationalRoute("", "cash", owner)).toBe("cash");
    expect(resolveInitialOperationalRoute("", "salon", cashier)).toBe("dashboard");
    expect(resolveInitialOperationalRoute("#/counter", "salon", cashier)).toBe("counter");
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
