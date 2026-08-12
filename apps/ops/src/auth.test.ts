import { describe, expect, it } from "vitest";
import { InvalidSessionPayloadError, parseAuthenticatedAccess, profileIdForScope } from "./auth";

const organizationId = "a1111111-1111-4111-8111-111111111111";
const unitId = "b1111111-1111-4111-8111-111111111111";

describe("inicialização autenticada", () => {
  it("combina identidade, membership, unidades e roles reais", () => {
    const access = parseAuthenticatedAccess(
      {
        identity: {
          id: "c1111111-1111-4111-8111-111111111111",
          email: "marina@example.com",
          displayName: "Marina Costa",
        },
        memberships: [
          { membershipId: "m1", organizationId, status: "active", role: "manager", unitId },
        ],
      },
      [
        {
          membershipId: "m1",
          status: "active",
          organization: {
            id: organizationId,
            tradeName: "Aurora Centro",
            document: "12345678000190",
          },
          units: [{ id: unitId, name: "Matriz", timezone: "America/Sao_Paulo", active: true }],
          roles: [{ role: "manager", unitId }],
        },
      ],
    );

    const firstOrganization = access.organizations[0];
    expect(firstOrganization).toBeDefined();
    expect(access.identity.displayName).toBe("Marina Costa");
    expect(firstOrganization?.organization.document).toBe("12.345.678/0001-90");
    expect(firstOrganization ? profileIdForScope(firstOrganization, unitId) : null).toBe("manager");
  });

  it("recusa resposta incompleta em vez de criar escopo demonstrativo", () => {
    expect(() =>
      parseAuthenticatedAccess(
        { identity: { id: "1", email: "a@b.com", displayName: "A" }, memberships: [] },
        [{ organization: {}, units: [], roles: [] }],
      ),
    ).toThrow(InvalidSessionPayloadError);
  });

  it("aceita o contrato atual com scopes, role global e documento ausente", () => {
    const access = parseAuthenticatedAccess(
      {
        identity: {
          id: "c1111111-1111-4111-8111-111111111111",
          email: "dono@example.com",
          displayName: "Dono Real",
        },
        memberships: [{ membershipId: "membership-real", organizationId, status: "active" }],
      },
      [
        {
          membershipId: "membership-real",
          status: "active",
          organization: { id: organizationId, tradeName: "Casa Real" },
          units: [
            {
              id: unitId,
              name: "Unidade Centro",
              timezone: "America/Sao_Paulo",
              active: true,
              roles: ["waiter"],
            },
          ],
          roles: ["owner"],
          scopes: [{ role: "manager", unitId }],
        },
      ],
    );

    expect(access.organizations[0]).toMatchObject({
      membershipId: "membership-real",
      organization: { document: "Documento não informado" },
    });
    const organization = access.organizations[0];
    expect(organization).toBeDefined();
    expect(organization ? profileIdForScope(organization, unitId) : null).toBe("owner");
  });

  it("permite administrador da plataforma sem membership de tenant", () => {
    const access = parseAuthenticatedAccess(
      {
        identity: {
          id: "platform-identity",
          email: "ops@giromesa.com.br",
          displayName: "Operação GiroMesa",
        },
        memberships: [],
        platformAdmin: true,
      },
      [],
    );

    expect(access.platformAdmin).toBe(true);
    expect(access.organizations).toEqual([]);
  });

  it("preserva primeiro acesso verificado sem organizacao para criacao real", () => {
    const access = parseAuthenticatedAccess(
      {
        identity: {
          id: "new-owner",
          email: "novo@example.com",
          displayName: "Novo Proprietario",
        },
        memberships: [],
      },
      [],
    );

    expect(access.platformAdmin).toBe(false);
    expect(access.organizations).toEqual([]);
  });
});
