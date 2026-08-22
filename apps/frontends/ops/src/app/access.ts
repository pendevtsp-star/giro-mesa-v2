import { api } from "../api";
import {
  type AuthenticatedAccess,
  parseAuthenticatedAccess,
  profileIdForScope,
  profileIdsForScope,
} from "../auth";
import type { Permission } from "../domain";
import type { TerminalSessionView } from "../features/auth/terminal-api";
import { profiles } from "../profiles";
import type { ScopeSource, Session } from "./types";

const terminalPermissions = new Set<Permission>([
  "dashboard.view",
  "salon.operate",
  "counter.operate",
  "kds.operate",
]);

export async function loadAuthenticatedAccess(): Promise<AuthenticatedAccess> {
  const [me, scopedOrganizations] = await Promise.all([api.me(), api.organizations()]);
  return parseAuthenticatedAccess(me, scopedOrganizations);
}

export function toScopeSource(access: AuthenticatedAccess): ScopeSource {
  return {
    identityId: access.identity.id,
    identityName: access.identity.displayName,
    organizations: access.organizations,
    platformAdmin: access.platformAdmin,
  };
}

export function sessionForScope(
  source: ScopeSource,
  organizationId: string,
  unitId: string,
  terminalMode: boolean,
): Session | null {
  const access = source.organizations.find((item) => item.organization.id === organizationId);
  const unit = access?.organization.units.find((item) => item.id === unitId);
  const baseProfile = profiles.find(
    (item) => item.id === (access ? profileIdForScope(access, unitId) : null),
  );
  if (!access || !unit || !baseProfile) return null;
  const scopedPermissions = [
    ...new Set(
      profileIdsForScope(access, unitId).flatMap(
        (profileId) => profiles.find((profile) => profile.id === profileId)?.permissions ?? [],
      ),
    ),
  ];
  const effectivePermissions = terminalMode
    ? scopedPermissions.filter((permission) => terminalPermissions.has(permission))
    : scopedPermissions;
  const settingsRoles = access.roles.filter((binding) =>
    ["owner", "manager"].includes(binding.role),
  );
  const settingsManageUnitIds = settingsRoles.some((binding) => binding.unitId === null)
    ? access.organization.units.map((candidate) => candidate.id)
    : settingsRoles.flatMap((binding) => (binding.unitId ? [binding.unitId] : []));
  return {
    identityId: source.identityId,
    profile: {
      ...baseProfile,
      name: source.identityName,
      shortName: initials(source.identityName),
      permissions: effectivePermissions,
    },
    organization: access.organization,
    unit,
    membershipId: access.membershipId,
    organizationId: access.organization.id,
    unitId,
    terminalMode,
    platformAdmin: false,
    settingsManageUnitIds,
  };
}

export function terminalSessionForView(view: TerminalSessionView): Session | null {
  if (!view.actor) return null;
  const source: ScopeSource = {
    identityId: view.actor.identityId,
    identityName: view.actor.displayName,
    platformAdmin: false,
    organizations: [
      {
        membershipId: view.actor.membershipId,
        organization: {
          ...view.organization,
          units: [view.unit],
        },
        roles: view.actor.roles.map((role) => ({ role, unitId: view.unit.id })),
      },
    ],
  };
  const session = sessionForScope(source, view.organization.id, view.unit.id, true);
  return session ? { ...session, terminalSessionId: view.id, actorEpoch: view.actorEpoch } : null;
}

export function platformSession(access: AuthenticatedAccess): Session {
  const baseProfile = profiles.find((profile) => profile.id === "platform");
  if (!baseProfile) throw new Error("Perfil administrativo não configurado.");
  return {
    identityId: access.identity.id,
    profile: {
      ...baseProfile,
      name: access.identity.displayName,
      shortName: initials(access.identity.displayName),
      permissions: ["platform.manage"],
    },
    organization: {
      id: "",
      name: "Administração GiroMesa",
      document: "Escopo global",
      units: [],
    },
    unit: { id: "", name: "Visão global", timezone: "America/Sao_Paulo" },
    membershipId: "",
    organizationId: "",
    unitId: "",
    terminalMode: false,
    platformAdmin: true,
    settingsManageUnitIds: [],
  };
}

export function initials(name: string): string {
  return name
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("");
}
