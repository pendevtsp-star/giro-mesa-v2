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
