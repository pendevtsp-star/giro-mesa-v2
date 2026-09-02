import { afterEach, describe, expect, it, vi } from "vitest";
import { api } from "../../api";
import { parsePeopleDirectory } from "../../management.shared";
import { accessRolesRequireStepUp, toggleAccessRole } from "./people-access";

function person(access: Record<string, unknown>) {
  return {
    id: "person-1",
    identityId: "identity-1",
    name: "Ana",
    roleLabel: "Atendimento",
    active: true,
    hourlyRateCents: null,
    access,
  };
}

describe("funções autorizadas em Pessoas", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("lê roles sem duplicar e mantém fallback para a resposta singular antiga", () => {
    const current = parsePeopleDirectory({
      items: [
        person({
          status: "active",
          email: "ana@example.com",
          roles: ["waiter", "cashier", "waiter"],
          role: "waiter",
          revision: 4,
        }),
      ],
      pagination: { page: 1, pageSize: 20, total: 1, pageCount: 1 },
    });
    const legacy = parsePeopleDirectory({
      items: [person({ status: "active", role: "inventory" })],
      pagination: { page: 1, pageSize: 20, total: 1, pageCount: 1 },
    });

    expect(current.items[0]?.access).toMatchObject({
      roles: ["waiter", "cashier"],
      role: "waiter",
      revision: 4,
    });
    expect(legacy.items[0]?.access).toMatchObject({ roles: ["inventory"], revision: null });
  });

  it("altera o conjunto local sem duplicar e exige step-up ao conceder ou remover função sensível", () => {
    expect(toggleAccessRole(["waiter"], "cashier", true)).toEqual(["waiter", "cashier"]);
    expect(toggleAccessRole(["waiter", "cashier"], "waiter", false)).toEqual(["cashier"]);
    expect(toggleAccessRole(["waiter"], "waiter", true)).toEqual(["waiter"]);

    const sensitive = new Set(["manager", "finance", "accountant"]);
    expect(accessRolesRequireStepUp(["manager"], ["waiter"], sensitive)).toBe(true);
    expect(accessRolesRequireStepUp(["waiter"], ["cashier"], sensitive)).toBe(false);
  });

  it("envia o conjunto inteiro com a revisão em uma única mutação", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ updated: true }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await api.management.updatePersonAccess("org-1", "unit-1", "person-1", {
      roles: ["waiter", "cashier"],
      reason: "Escopo operacional atualizado",
      expectedRevision: 7,
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("/management/people/person-1/access"),
      expect.objectContaining({
        method: "PATCH",
        body: JSON.stringify({
          roles: ["waiter", "cashier"],
          reason: "Escopo operacional atualizado",
          expectedRevision: 7,
        }),
      }),
    );
  });
});
