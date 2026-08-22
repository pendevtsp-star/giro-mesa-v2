import type {
  BusinessHoursDay,
  BusinessHoursException,
  EstablishmentSettings,
  UpdateUnitSettingsInput,
} from "@giromesa/contracts";

export const WEEKDAYS = [
  { weekday: 1, label: "Segunda-feira" },
  { weekday: 2, label: "Terça-feira" },
  { weekday: 3, label: "Quarta-feira" },
  { weekday: 4, label: "Quinta-feira" },
  { weekday: 5, label: "Sexta-feira" },
  { weekday: 6, label: "Sábado" },
  { weekday: 7, label: "Domingo" },
] as const;

export function formatBrazilianPhone(value: string): string {
  let digits = value.replace(/\D/g, "");
  if (digits.length > 11 && digits.startsWith("55")) digits = digits.slice(2);
  digits = digits.slice(0, 11);
  if (!digits) return "";
  if (digits.length <= 2) return `(${digits}${digits.length === 2 ? ")" : ""}`;
  const local = digits.slice(2);
  if (local.length <= 4) return `(${digits.slice(0, 2)}) ${local}`;
  const prefixLength = local.length === 9 ? 5 : 4;
  return `(${digits.slice(0, 2)}) ${local.slice(0, prefixLength)}-${local.slice(prefixLength)}`;
}

export function unitSettingsInput(settings: EstablishmentSettings): UpdateUnitSettingsInput {
  return {
    name: settings.unit.name.trim(),
    timezone: settings.unit.timezone.trim(),
    presentation: {
      ...settings.presentation,
      phone: settings.presentation.phone ? formatBrazilianPhone(settings.presentation.phone) : null,
    },
    businessHours: settings.businessHours,
  };
}

export function hoursDayWithMode(
  day: BusinessHoursDay,
  mode: BusinessHoursDay["mode"],
): BusinessHoursDay {
  if (mode === "periods") {
    return {
      weekday: day.weekday,
      mode,
      periods: [{ start: "09:00", end: "18:00", endsNextDay: false }],
    };
  }
  return { weekday: day.weekday, mode };
}

export function hoursExceptionWithMode(
  exception: BusinessHoursException,
  mode: BusinessHoursException["mode"],
): BusinessHoursException {
  if (mode === "periods") {
    return {
      date: exception.date,
      mode,
      periods: [{ start: "09:00", end: "18:00", endsNextDay: false }],
    };
  }
  return { date: exception.date, mode };
}

export function logoFileError(file: Pick<File, "size" | "type">): string | null {
  if (!(["image/jpeg", "image/png", "image/webp"] as string[]).includes(file.type)) {
    return "Use uma imagem JPG, PNG ou WEBP.";
  }
  return file.size > 2 * 1024 * 1024 ? "A logo deve ter no máximo 2 MB." : null;
}
