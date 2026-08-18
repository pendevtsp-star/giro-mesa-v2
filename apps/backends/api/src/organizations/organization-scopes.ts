import type { BillingState, SystemRole } from "@giromesa/domain";

export interface OrganizationMembershipRow {
  membershipId: string;
  status: "invited" | "active" | "disabled";
  organization: {
    id: string;
    legalName: string;
    tradeName: string;
    billingState: BillingState;
  };
}

export interface RoleBindingRow {
  membershipId: string;
  unitId: string | null;
  role: SystemRole;
}

export interface OrganizationUnitRow {
  id: string;
  organizationId: string;
  name: string;
  timezone: string;
  active: boolean;
}

export function shapeOrganizationScopes(
  membershipRows: OrganizationMembershipRow[],
  bindingRows: RoleBindingRow[],
  unitRows: OrganizationUnitRow[],
) {
  return membershipRows.map((membership) => {
    const bindings = bindingRows.filter(
      (binding) => binding.membershipId === membership.membershipId,
    );
    const globalRoles = bindings
      .filter((binding) => binding.unitId === null)
      .map((binding) => binding.role);
    const organizationUnits = unitRows.filter(
      (unit) => unit.organizationId === membership.organization.id,
    );
    const accessibleUnits = organizationUnits
      .filter(
        (unit) => globalRoles.length > 0 || bindings.some((binding) => binding.unitId === unit.id),
      )
      .map((unit) => ({
        ...unit,
        roles: [
          ...new Set([
            ...globalRoles,
            ...bindings
              .filter((binding) => binding.unitId === unit.id)
              .map((binding) => binding.role),
          ]),
        ],
      }));
    return {
      membershipId: membership.membershipId,
      status: membership.status,
      organization: membership.organization,
      roles: [...new Set(bindings.map((binding) => binding.role))],
      scopes: bindings.map(({ role, unitId }) => ({ role, unitId })),
      units: accessibleUnits,
    };
  });
}
