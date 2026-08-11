export function isPlatformAdminEmail(
  email: string,
  configured = process.env.PLATFORM_ADMIN_EMAILS,
) {
  const normalized = email.trim().toLowerCase();
  return (configured ?? "")
    .split(",")
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean)
    .includes(normalized);
}

export const platformPermissions = [
  "platform.read",
  "platform.pii.read",
  "platform.action.propose",
  "platform.action.approve",
  "platform.action.reject",
  "platform.tenant.suspend",
  "platform.tenant.restore",
  "platform.membership.disable",
  "platform.membership.restore",
] as const;

export type PlatformPermission = (typeof platformPermissions)[number];
export type PlatformActionName =
  | "tenant.suspend"
  | "tenant.restore"
  | "membership.disable"
  | "membership.restore";
export type PlatformActionCommand = "propose" | "approve" | "reject";

export interface PlatformAccess {
  email: string;
  permissions: PlatformPermission[];
}

const permissionSet = new Set<string>(platformPermissions);

function configuredPermissions(configured: string | undefined) {
  const result = new Map<string, PlatformPermission[]>();
  if (!configured?.trim()) return result;
  try {
    for (const rawGrant of configured.split(";")) {
      const [rawEmail, rawPermissions, ...rest] = rawGrant.split("=");
      if (rest.length > 0 || !rawEmail?.trim() || !rawPermissions?.trim()) throw new Error();
      const email = rawEmail.trim().toLowerCase();
      const permissions = rawPermissions.split("|").map((value) => value.trim());
      if (
        permissions.length === 0 ||
        permissions.some((permission) => !permissionSet.has(permission))
      )
        throw new Error();
      result.set(email, [...new Set(permissions)] as PlatformPermission[]);
    }
    return result;
  } catch {
    return new Map<string, PlatformPermission[]>();
  }
}

export function platformAccessFor(
  email: string,
  configuredEmails = process.env.PLATFORM_ADMIN_EMAILS,
  configuredGrants = process.env.PLATFORM_ADMIN_GRANTS,
): PlatformAccess {
  const normalized = email.trim().toLowerCase();
  if (!isPlatformAdminEmail(normalized, configuredEmails))
    return { email: normalized, permissions: [] };
  const granted = configuredPermissions(configuredGrants).get(normalized) ?? [];
  return { email: normalized, permissions: ["platform.read", ...granted] };
}

const actionPermission: Record<PlatformActionName, PlatformPermission> = {
  "tenant.suspend": "platform.tenant.suspend",
  "tenant.restore": "platform.tenant.restore",
  "membership.disable": "platform.membership.disable",
  "membership.restore": "platform.membership.restore",
};

export function canPlatformMutate(
  access: PlatformAccess,
  action: PlatformActionName,
  command: PlatformActionCommand,
) {
  const commandPermission: PlatformPermission =
    command === "propose"
      ? "platform.action.propose"
      : command === "approve"
        ? "platform.action.approve"
        : "platform.action.reject";
  return (
    access.permissions.includes(commandPermission) &&
    access.permissions.includes(actionPermission[action])
  );
}

export function hasRecentPlatformStepUp(
  occurredAt: Date | null,
  now = new Date(),
  maximumAgeMs = 10 * 60 * 1000,
) {
  if (!occurredAt) return false;
  const age = now.getTime() - occurredAt.getTime();
  return age >= 0 && age < maximumAgeMs;
}
