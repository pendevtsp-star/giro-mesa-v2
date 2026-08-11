import type { Organization, ProfileId, Unit } from "./domain";

const roleToProfile: Record<string, ProfileId> = {
  owner: "owner",
  manager: "manager",
  waiter: "waiter",
  cashier: "cashier",
  kds: "kitchen",
  inventory: "inventory",
  finance: "finance",
};

const rolePriority = ["owner", "manager", "cashier", "waiter", "kds", "inventory", "finance"];

export interface AccessRole {
  role: string;
  unitId: string | null;
}

export interface AccessOrganization {
  membershipId: string;
  organization: Organization;
  roles: AccessRole[];
}

export interface AuthenticatedAccess {
  identity: { id: string; email: string; displayName: string };
  organizations: AccessOrganization[];
  platformAdmin: boolean;
}

export class InvalidSessionPayloadError extends Error {
  constructor() {
    super("A API retornou uma sessão incompleta. Entre novamente ou contate o suporte.");
    this.name = "InvalidSessionPayloadError";
  }
}

export function parseAuthenticatedAccess(
  meValue: unknown,
  organizationsValue: unknown,
): AuthenticatedAccess {
  const me = record(meValue);
  const identity = record(me.identity);
  const memberships = array(me.memberships).map(record);
  const rows = array(organizationsValue).map(record);
  const identityId = text(identity.id);
  const email = text(identity.email);
  const displayName = text(identity.displayName);
  const platformAdmin = me.platformAdmin === true;
  if (!identityId || !email || !displayName) throw new InvalidSessionPayloadError();

  const activeOrganizationIds = new Set(
    memberships
      .filter((membership) => membership.status === "active")
      .map((membership) => text(membership.organizationId))
      .filter((id): id is string => Boolean(id)),
  );

  const organizations = rows.flatMap((row): AccessOrganization[] => {
    const organization = record(row.organization);
    const id = text(organization.id);
    const name = text(organization.tradeName) ?? text(organization.name);
    const document = text(organization.document);
    const membershipId =
      text(row.membershipId) ??
      memberships
        .filter((membership) => text(membership.organizationId) === id)
        .map((membership) => text(membership.membershipId))
        .find((value): value is string => Boolean(value));
    if (!id || !name || !membershipId || !activeOrganizationIds.has(id)) return [];

    const units = array(row.units).flatMap((unitValue): Unit[] => {
      const unit = record(unitValue);
      const unitId = text(unit.id);
      const unitName = text(unit.name);
      if (!unitId || !unitName || unit.active === false) return [];
      return [
        {
          id: unitId,
          name: unitName,
          city: text(unit.city) ?? undefined,
          timezone: text(unit.timezone) ?? "America/Sao_Paulo",
        },
      ];
    });
    const explicitScopes = optionalArray(row.scopes);
    const legacyRoleBindings = optionalArray(row.roles).filter(
      (roleValue) => typeof roleValue === "object" && roleValue !== null,
    );
    const globalRoles = optionalArray(row.roles)
      .filter((roleValue): roleValue is string => typeof roleValue === "string")
      .map((role) => ({ role, unitId: null }));
    const unitRoles = optionalArray(row.units).flatMap((unitValue) => {
      const unit = record(unitValue);
      const unitId = text(unit.id);
      return unitId
        ? optionalArray(unit.roles)
            .filter((role): role is string => typeof role === "string")
            .map((role) => ({ role, unitId }))
        : [];
    });
    const roles = [...explicitScopes, ...legacyRoleBindings, ...globalRoles, ...unitRoles].flatMap(
      (roleValue): AccessRole[] => {
        const role = record(roleValue);
        const name = text(role.role);
        const unitId = role.unitId === null ? null : text(role.unitId);
        return name && name in roleToProfile && (role.unitId === null || unitId)
          ? [{ role: name, unitId }]
          : [];
      },
    );
    if (!units.length || !roles.length) return [];
    return [
      {
        organization: { id, name, document: formatDocument(document ?? undefined), units },
        membershipId,
        roles,
      },
    ];
  });
  if (!organizations.length && !platformAdmin && (memberships.length > 0 || rows.length > 0)) {
    throw new InvalidSessionPayloadError();
  }
  return { identity: { id: identityId, email, displayName }, organizations, platformAdmin };
}

export function profileIdForScope(access: AccessOrganization, unitId: string): ProfileId | null {
  const role = rolePriority.find((candidate) =>
    access.roles.some(
      (binding) =>
        binding.role === candidate && (binding.unitId === null || binding.unitId === unitId),
    ),
  );
  return role ? (roleToProfile[role] ?? null) : null;
}

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new InvalidSessionPayloadError();
  }
  return value as Record<string, unknown>;
}

function array(value: unknown): unknown[] {
  if (!Array.isArray(value)) throw new InvalidSessionPayloadError();
  return value;
}

function optionalArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

function formatDocument(value?: string): string {
  if (!value) return "Documento não informado";
  const digits = value.replace(/\D/g, "");
  if (digits.length !== 14) return value;
  return digits.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, "$1.$2.$3/$4-$5");
}
