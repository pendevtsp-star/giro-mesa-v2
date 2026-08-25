import type {
  BusinessHours,
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

export const BRAZILIAN_TIMEZONES = [
  "America/Noronha",
  "America/Belem",
  "America/Fortaleza",
  "America/Recife",
  "America/Araguaina",
  "America/Maceio",
  "America/Bahia",
  "America/Sao_Paulo",
  "America/Campo_Grande",
  "America/Cuiaba",
  "America/Santarem",
  "America/Porto_Velho",
  "America/Boa_Vista",
  "America/Manaus",
  "America/Eirunepe",
  "America/Rio_Branco",
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

export function normalizeInstagram(value: string): string | null {
  const normalized = value
    .trim()
    .replace(/^https?:\/\/(?:www\.)?instagram\.com\//i, "")
    .replace(/^@/, "")
    .replace(/\/$/, "")
    .slice(0, 120);
  return normalized || null;
}

export function formatPostalCode(value: string): string {
  const digits = value.replace(/\D/g, "").slice(0, 8);
  return digits.length > 5 ? `${digits.slice(0, 5)}-${digits.slice(5)}` : digits;
}

export function unitSettingsInput(settings: EstablishmentSettings): UpdateUnitSettingsInput {
  return {
    expectedRevision: settings.revision,
    name: settings.unit.name.trim(),
    timezone: settings.unit.timezone.trim(),
    presentation: {
      ...settings.presentation,
      phone: settings.presentation.phone ? formatBrazilianPhone(settings.presentation.phone) : null,
      instagram: settings.presentation.instagram
        ? normalizeInstagram(settings.presentation.instagram)
        : null,
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
      ...(exception.label ? { label: exception.label } : {}),
      mode,
      periods: [{ start: "09:00", end: "18:00", endsNextDay: false }],
    };
  }
  return { date: exception.date, ...(exception.label ? { label: exception.label } : {}), mode };
}

export function applyHoursTemplate(
  hours: BusinessHours,
  sourceWeekday: number,
  targetWeekdays: number[],
): BusinessHours {
  const source = hours.weekly.find((day) => day.weekday === sourceWeekday);
  if (!source) return hours;
  return {
    ...hours,
    weekly: hours.weekly.map((day) =>
      targetWeekdays.includes(day.weekday)
        ? ({ ...structuredClone(source), weekday: day.weekday } as BusinessHoursDay)
        : day,
    ),
  };
}

export function sortBusinessHoursExceptions(hours: BusinessHours): BusinessHours {
  return {
    ...hours,
    exceptions: [...hours.exceptions].sort((left, right) => left.date.localeCompare(right.date)),
  };
}

function linearChannel(hex: string) {
  const value = Number.parseInt(hex, 16) / 255;
  return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
}

export function contrastRatio(background: string, foreground: "#000000" | "#ffffff") {
  const channels = [1, 3, 5].map((index) => linearChannel(background.slice(index, index + 2)));
  const backgroundLuminance =
    0.2126 * (channels[0] ?? 0) + 0.7152 * (channels[1] ?? 0) + 0.0722 * (channels[2] ?? 0);
  const foregroundLuminance = foreground === "#ffffff" ? 1 : 0;
  const lighter = Math.max(backgroundLuminance, foregroundLuminance);
  const darker = Math.min(backgroundLuminance, foregroundLuminance);
  return (lighter + 0.05) / (darker + 0.05);
}

export function readableForeground(background: string): "#000000" | "#ffffff" {
  return contrastRatio(background, "#ffffff") >= contrastRatio(background, "#000000")
    ? "#ffffff"
    : "#000000";
}

function canvasBlob(canvas: HTMLCanvasElement, type: string, quality: number) {
  return new Promise<Blob>((resolve, reject) =>
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error("Não foi possível otimizar a imagem."))),
      type,
      quality,
    ),
  );
}

async function imageVariant(bitmap: ImageBitmap, maxSize: number, name: string, quality = 0.86) {
  const scale = Math.min(1, maxSize / Math.max(bitmap.width, bitmap.height));
  const width = Math.max(1, Math.round(bitmap.width * scale));
  const height = Math.max(1, Math.round(bitmap.height * scale));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Não foi possível processar a imagem.");
  context.drawImage(bitmap, 0, 0, width, height);
  const blob = await canvasBlob(canvas, "image/webp", quality);
  return new File([blob], name, { type: "image/webp" });
}

export async function prepareLogoVariants(file: File) {
  const bitmap = await createImageBitmap(file).catch(() => null);
  if (!bitmap) throw new Error("A imagem está corrompida ou não pôde ser lida.");
  try {
    if (bitmap.width < 64 || bitmap.height < 64) {
      throw new Error("A logo deve ter pelo menos 64 × 64 pixels.");
    }
    if (bitmap.width > 8_192 || bitmap.height > 8_192) {
      throw new Error("A logo não pode ultrapassar 8192 × 8192 pixels.");
    }
    return {
      main: await imageVariant(bitmap, 1_024, "establishment-logo.webp"),
      thumbnail: await imageVariant(bitmap, 192, "establishment-logo-thumbnail.webp"),
      width: bitmap.width,
      height: bitmap.height,
    };
  } finally {
    bitmap.close();
  }
}

export async function prepareCoverImage(file: File) {
  const bitmap = await createImageBitmap(file).catch(() => null);
  if (!bitmap) throw new Error("A imagem está corrompida ou não pôde ser lida.");
  try {
    if (bitmap.width < 640 || bitmap.height < 240) {
      throw new Error("A foto de capa deve ter pelo menos 640 × 240 pixels.");
    }
    if (bitmap.width > 8_192 || bitmap.height > 8_192) {
      throw new Error("A foto de capa não pode ultrapassar 8192 × 8192 pixels.");
    }
    return imageVariant(bitmap, 1_600, "establishment-cover.webp", 0.82);
  } finally {
    bitmap.close();
  }
}

export function mediaKeyFromUrl(value: string | null | undefined): string | null {
  if (!value) return null;
  try {
    const key = new URL(value).pathname.split("/").pop() ?? "";
    return /^[a-f0-9]{32}\.(jpg|png|webp)$/.test(key) ? key : null;
  } catch {
    return null;
  }
}

export type EditableSettingsSection = "organization" | "unit" | "brand" | "hours";

function sectionValue(settings: EstablishmentSettings, section: EditableSettingsSection) {
  if (section === "organization") return settings.organization.tradeName;
  if (section === "unit") {
    return {
      unit: settings.unit,
      address: settings.presentation.address,
      addressDetails: settings.presentation.addressDetails,
      phone: settings.presentation.phone,
      instagram: settings.presentation.instagram,
    };
  }
  if (section === "brand") {
    const { presentation } = settings;
    return {
      displayName: presentation.displayName,
      slogan: presentation.slogan,
      logoUrl: presentation.logoUrl,
      logoThumbnailUrl: presentation.logoThumbnailUrl,
      coverImageUrl: presentation.coverImageUrl,
      primaryColor: presentation.primaryColor,
      accentColor: presentation.accentColor,
    };
  }
  return settings.businessHours;
}

export function dirtySettingsSections(
  current: EstablishmentSettings,
  persisted: EstablishmentSettings,
  hasPendingBrandMedia: boolean,
): EditableSettingsSection[] {
  return (["organization", "unit", "brand", "hours"] as const).filter(
    (section) =>
      (section === "brand" && hasPendingBrandMedia) ||
      JSON.stringify(sectionValue(current, section)) !==
        JSON.stringify(sectionValue(persisted, section)),
  );
}

export function mergeSavedSection(
  current: EstablishmentSettings,
  persisted: EstablishmentSettings,
  section: Exclude<EditableSettingsSection, "organization">,
): EstablishmentSettings {
  const next = {
    ...current,
    revision: persisted.revision,
    publication: persisted.publication,
  };
  if (section === "hours") return { ...next, businessHours: persisted.businessHours };
  if (section === "brand") {
    return {
      ...next,
      presentation: {
        ...current.presentation,
        displayName: persisted.presentation.displayName,
        slogan: persisted.presentation.slogan,
        logoUrl: persisted.presentation.logoUrl,
        logoThumbnailUrl: persisted.presentation.logoThumbnailUrl,
        coverImageUrl: persisted.presentation.coverImageUrl,
        primaryColor: persisted.presentation.primaryColor,
        accentColor: persisted.presentation.accentColor,
      },
    };
  }
  return {
    ...next,
    unit: persisted.unit,
    presentation: {
      ...current.presentation,
      address: persisted.presentation.address,
      addressDetails: persisted.presentation.addressDetails,
      phone: persisted.presentation.phone,
      instagram: persisted.presentation.instagram,
    },
  };
}

function imageFileError(file: Pick<File, "size" | "type">, label: string): string | null {
  if (!(["image/jpeg", "image/png", "image/webp"] as string[]).includes(file.type)) {
    return "Use uma imagem JPG, PNG ou WEBP.";
  }
  return file.size > 2 * 1024 * 1024 ? `${label} deve ter no máximo 2 MB.` : null;
}

export const logoFileError = (file: Pick<File, "size" | "type">) => imageFileError(file, "A logo");
export const coverFileError = (file: Pick<File, "size" | "type">) =>
  imageFileError(file, "A foto de capa");

export async function mediaPayload(file: File) {
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Não foi possível ler a imagem."));
    reader.onload = () =>
      typeof reader.result === "string"
        ? resolve(reader.result)
        : reject(new Error("Não foi possível ler a imagem."));
    reader.readAsDataURL(file);
  });
  const match = /^data:(image\/(?:jpeg|png|webp));base64,(.+)$/s.exec(dataUrl);
  if (!match?.[1] || !match[2]) throw new Error("Formato de imagem não suportado.");
  return {
    fileName: file.name,
    mimeType: match[1] as "image/jpeg" | "image/png" | "image/webp",
    base64: match[2],
  };
}
