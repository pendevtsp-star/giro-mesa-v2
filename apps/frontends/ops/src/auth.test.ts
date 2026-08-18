import { describe, expect, it } from "vitest";
import { sessionForScope, toScopeSource } from "./app/access";
import {
  InvalidSessionPayloadError,
  parseAuthenticatedAccess,
  profileIdForScope,
  profileIdsForScope,
} from "./auth";
import { profiles } from "./profiles";
import { canAccess } from "./rules";

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

  it("recusa resposta incompleta em vez de criar um escopo local", () => {
    expect(() =>
      parseAuthenticatedAccess(
        { identity: { id: "1", email: "a@b.com", displayName: "A" }, memberships: [] },
        [{ organization: {}, units: [], roles: [] }],
      ),
    ).toThrow(InvalidSessionPayloadError);
  });

  it("mantém o perfil delivery na sessão autenticada", () => {
    const access = parseAuthenticatedAccess(
      {
        identity: {
          id: "delivery-identity",
          email: "entrega@example.com",
          displayName: "Entrega Real",
        },
        memberships: [{ membershipId: "delivery-membership", organizationId, status: "active" }],
      },
      [
        {
          membershipId: "delivery-membership",
          organization: { id: organizationId, tradeName: "Casa Entrega" },
          units: [{ id: unitId, name: "Centro", timezone: "America/Sao_Paulo", active: true }],
          roles: [{ role: "delivery", unitId }],
        },
      ],
    );

    const organization = access.organizations[0];
    expect(organization ? profileIdForScope(organization, unitId) : null).toBe("delivery");
    const profile = profiles.find((item) => item.id === "delivery");
    expect(profile && canAccess(profile, "delivery")).toBe(true);
  });

  it("reconhece o papel externo de contador sem ampliar suas permissões", () => {
    const access = parseAuthenticatedAccess(
      {
        identity: { id: "accountant-id", email: "contador@example.com", displayName: "Contador" },
        memberships: [{ membershipId: "accountant-membership", organizationId, status: "active" }],
      },
      [
        {
          membershipId: "accountant-membership",
          organization: { id: organizationId, tradeName: "Casa Real" },
          units: [{ id: unitId, name: "Centro", active: true }],
          roles: [{ role: "accountant", unitId: null }],
        },
      ],
    );
    const organization = access.organizations[0];
    expect(organization ? profileIdForScope(organization, unitId) : null).toBe("accountant");
    const accountant = profiles.find((profile) => profile.id === "accountant");
    expect(accountant && canAccess(accountant, "accountant")).toBe(true);
    expect(accountant && canAccess(accountant, "fiscal")).toBe(false);
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
    expect(organization ? profileIdsForScope(organization, unitId) : []).toEqual([
      "owner",
      "manager",
      "waiter",
    ]);
  });

  it("combina as capacidades de vários postos na mesma unidade", () => {
    const access = parseAuthenticatedAccess(
      {
        identity: {
          id: "multi-role",
          email: "multi@example.com",
          displayName: "Operação Compacta",
        },
        memberships: [{ membershipId: "multi-membership", organizationId, status: "active" }],
      },
      [
        {
          membershipId: "multi-membership",
          organization: { id: organizationId, tradeName: "Casa Compacta" },
          units: [{ id: unitId, name: "Única", active: true }],
          scopes: [
            { role: "cashier", unitId },
            { role: "waiter", unitId },
          ],
        },
      ],
    );

    const session = sessionForScope(toScopeSource(access), organizationId, unitId, false);
    expect(session?.profile.id).toBe("cashier");
    expect(session?.profile.permissions).toEqual(
      expect.arrayContaining(["cash.operate", "salon.operate", "counter.operate"]),
    );
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
});
