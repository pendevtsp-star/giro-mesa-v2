export const SYSTEM_ROLES = [
  "owner",
  "manager",
  "waiter",
  "cashier",
  "receptionist",
  "busser",
  "kds",
  "delivery",
  "inventory",
  "finance",
  "accountant",
] as const;
export type SystemRole = (typeof SYSTEM_ROLES)[number];

export const OPERATIONAL_CAPABILITIES = [
  "operations:payments:record",
  "operations:tabs:close",
  "operations:charges:adjust",
  "operations:exceptions:request",
  "operations:exceptions:approve",
  "operations:tabs:open",
  "operations:reception:manage",
  "operations:reception:seat",
  "operations:tables:turnover",
  "operations:floor:manage",
  "operations:shift:manage",
  "operations:tables:reorganize",
  "operations:printing:request",
  "operations:printing:manage",
] as const;
export type OperationalCapability = (typeof OPERATIONAL_CAPABILITIES)[number];

export const operationalCapabilityAliases: Partial<
  Record<OperationalCapability, readonly string[]>
> = {
  "operations:payments:record": ["payments:write", "cashier:write"],
  "operations:tabs:close": ["cashier:write"],
  "operations:charges:adjust": ["cashier:write"],
  "operations:tabs:open": ["orders:write", "tables:write", "cashier:write"],
  "operations:reception:manage": ["reservations:write"],
  "operations:reception:seat": ["tables:write"],
  "operations:tables:turnover": ["tables:write"],
};

export const rolePermissions: Record<SystemRole, readonly string[]> = {
  owner: ["*"],
  manager: [
    "operations:*",
    "catalog:write",
    "settings.manage",
    "inventory:write",
    "inventory:nfe:import",
    "inventory:nfe:confirm",
    "inventory:returnables:confirm",
    "inventory:returnables:incidents:write",
    "inventory:returnables:incidents:approve",
    "team:read",
    "reports:read",
    "reports:costs:read",
    "reports:drilldown",
    "reports:export",
    "reports:views:manage",
    "reports:alerts:manage",
    "fiscal:dashboard:read",
    "fiscal:documents:read",
    "fiscal:periods:read",
    "accounting:exports:read",
    "accounting:requests:read",
    "accounting:requests:write",
  ],
  waiter: [
    "orders:write",
    "tables:write",
    "customer_calls:write",
    "operations:payments:record",
    "operations:tabs:close",
    "operations:exceptions:request",
    "operations:reception:manage",
    "operations:reception:seat",
    "operations:tables:reorganize",
    "operations:printing:request",
  ],
  cashier: [
    "cashier:write",
    "payments:write",
    "orders:read",
    "fiscal:documents:read",
    "fiscal:documents:write",
    "operations:exceptions:request",
    "operations:tables:reorganize",
    "operations:printing:request",
    "operations:printing:manage",
  ],
  receptionist: [
    "reservations:write",
    "tables:read",
    "operations:reception:manage",
    "operations:reception:seat",
  ],
  busser: ["tables:read", "customer_calls:write", "operations:tables:turnover"],
  kds: ["kds:write", "orders:read", "availability:write", "operations:printing:request"],
  delivery: ["orders:read", "orders:write"],
  inventory: [
    "inventory:write",
    "inventory:nfe:import",
    "inventory:nfe:confirm",
    "inventory:returnables:confirm",
    "inventory:returnables:incidents:write",
    "purchasing:write",
    "catalog:read",
  ],
  finance: [
    "finance:write",
    "reconciliation:write",
    "reports:read",
    "reports:costs:read",
    "reports:drilldown",
    "reports:export",
    "reports:budget:manage",
    "reports:schedule:manage",
    "reports:views:manage",
    "reports:alerts:manage",
    "reports:costs:backfill",
    "fiscal:dashboard:read",
    "fiscal:documents:read",
    "fiscal:periods:read",
    "fiscal:periods:write",
    "accounting:exports:read",
    "accounting:exports:write",
    "accounting:requests:read",
    "accounting:requests:write",
  ],
  accountant: [
    "fiscal:dashboard:read",
    "fiscal:documents:read",
    "fiscal:periods:read",
    "accounting:exports:read",
    "accounting:exports:write",
    "accounting:requests:read",
    "accounting:requests:write",
  ],
};

export function hasPermission(role: SystemRole, permission: string): boolean {
  const accepted = [
    permission,
    ...(operationalCapabilityAliases[permission as OperationalCapability] ?? []),
  ];
  return rolePermissions[role].some((granted) =>
    accepted.some(
      (candidate) =>
        granted === "*" ||
        granted === candidate ||
        (granted.endsWith(":*") && candidate.startsWith(granted.slice(0, -1))),
    ),
  );
}
