const phoneCharacters = /^\+?[0-9 ()-]+$/;

export function isValidOperationalPhone(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return true;
  if (!phoneCharacters.test(trimmed)) return false;
  const digits = trimmed.replace(/\D/g, "");
  if (digits.length === 10 || digits.length === 11) return true;
  return (digits.length === 12 || digits.length === 13) && digits.startsWith("55");
}
