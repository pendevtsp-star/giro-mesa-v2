export function toggleAccessRole<Role extends string>(
  current: readonly Role[],
  role: Role,
  selected: boolean,
): Role[] {
  if (!selected) return current.filter((item) => item !== role);
  return current.includes(role) ? [...current] : [...current, role];
}

export function accessRolesRequireStepUp(
  current: readonly string[],
  next: readonly string[],
  sensitive: ReadonlySet<string>,
): boolean {
  return [...current, ...next].some((role) => sensitive.has(role));
}
