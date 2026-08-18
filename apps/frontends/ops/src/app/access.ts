import { api } from "../api";
import {
  type AuthenticatedAccess,
  parseAuthenticatedAccess,
  profileIdForScope,
  profileIdsForScope,
} from "../auth";
import { profiles } from "../profiles";
import type { ScopeSource, Session } from "./types";

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
  const effectivePermissions = [
    ...new Set(
      profileIdsForScope(access, unitId).flatMap(
        (profileId) => profiles.find((profile) => profile.id === profileId)?.permissions ?? [],
      ),
    ),
  ];
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
  };
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
  };
}

export function initials(name: string): string {
  return name
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("");
}
