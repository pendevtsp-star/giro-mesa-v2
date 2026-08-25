import { ForbiddenException } from "@nestjs/common";

export const platformRoles = [
  "viewer",
  "support",
  "finance",
  "fiscal",
  "engineering",
  "admin",
] as const;
export type PlatformRole = (typeof platformRoles)[number];

const capabilitiesByRole = {
  viewer: ["tenants:read", "commercial:read"],
  support: [
    "tenants:read",
    "incidents:write",
    "commercial:read",
    "commercial:campaigns",
    "commercial:leads",
  ],
  finance: [
    "tenants:read",
    "billing:read",
    "commercial:read",
    "commercial:write",
    "commercial:campaigns",
    "commercial:metrics",
  ],
  fiscal: ["tenants:read", "fiscal:read", "fiscal:write", "commercial:read"],
  engineering: [
    "tenants:read",
    "incidents:write",
    "outbox:retry",
    "commercial:read",
    "commercial:media",
  ],
  admin: [
    "tenants:read",
    "billing:read",
    "fiscal:read",
    "fiscal:write",
    "incidents:write",
    "outbox:retry",
    "pii:read",
    "commercial:read",
    "commercial:write",
    "commercial:campaigns",
    "commercial:approve",
    "commercial:publish",
    "commercial:media",
    "commercial:metrics",
    "commercial:leads",
  ],
} as const satisfies Record<PlatformRole, readonly string[]>;

export type PlatformCapability = (typeof capabilitiesByRole)[PlatformRole][number];
export type PlatformAccess = {
  role: PlatformRole;
  capabilities: PlatformCapability[];
  mfaEnforced: true;
};

export function platformAccessForEmail(
  email: string,
  configuredRoles = process.env.PLATFORM_ADMIN_ROLES,
  legacyAllowlist = process.env.PLATFORM_ADMIN_EMAILS,
): PlatformAccess | null {
  const normalized = email.trim().toLowerCase();
  const configured = (configuredRoles ?? "")
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => {
      const separator =
        entry.lastIndexOf("=") >= 0 ? entry.lastIndexOf("=") : entry.lastIndexOf(":");
      if (separator < 1) return null;
      const candidateEmail = entry.slice(0, separator).trim().toLowerCase();
      const role = entry
        .slice(separator + 1)
        .trim()
        .toLowerCase();
      return platformRoles.includes(role as PlatformRole)
        ? { email: candidateEmail, role: role as PlatformRole }
        : null;
    })
    .find((entry) => entry?.email === normalized);
  const role =
    configured?.role ?? (legacyEmails(legacyAllowlist).includes(normalized) ? "admin" : null);
  return role ? { role, capabilities: [...capabilitiesByRole[role]], mfaEnforced: true } : null;
}

export function isPlatformAdminEmail(email: string, configured?: string) {
  return configured === undefined
    ? platformAccessForEmail(email) !== null
    : legacyEmails(configured).includes(email.trim().toLowerCase());
}

export function requirePlatformCapability(access: PlatformAccess, capability: PlatformCapability) {
  if (!access.capabilities.includes(capability)) {
    throw new ForbiddenException({ code: "PLATFORM_CAPABILITY_REQUIRED", capability });
  }
}

function legacyEmails(configured: string | undefined) {
  return (configured ?? "")
    .split(",")
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);
}
