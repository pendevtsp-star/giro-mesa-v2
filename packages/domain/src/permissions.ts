export const SYSTEM_ROLES = [
  "owner",
  "manager",
  "waiter",
  "cashier",
  "kds",
  "inventory",
  "finance",
] as const;
export type SystemRole = (typeof SYSTEM_ROLES)[number];

export const rolePermissions: Record<SystemRole, readonly string[]> = {
  owner: ["*"],
  manager: ["operations:*", "catalog:write", "inventory:write", "team:read", "reports:read"],
  waiter: ["orders:write", "tables:write", "customer_calls:write"],
  cashier: ["cashier:write", "payments:write", "orders:read", "fiscal:write"],
  kds: ["kds:write", "orders:read", "availability:write"],
  inventory: ["inventory:write", "purchasing:write", "catalog:read"],
  finance: ["finance:write", "reconciliation:write", "reports:read"],
};

export function hasPermission(role: SystemRole, permission: string): boolean {
  return rolePermissions[role].some((granted) => {
    if (granted === "*") return true;
    if (granted === permission) return true;
    return granted.endsWith(":*") && permission.startsWith(granted.slice(0, -1));
  });
}
