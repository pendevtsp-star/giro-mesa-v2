import { type BusinessHours, businessHoursSchema, timezoneSchema } from "@giromesa/contracts";
import type { MenuItem } from "./menu.ts";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export type PublicMenuBranding = {
  displayName: string;
  slogan?: string;
  logoUrl?: string;
  coverImageUrl?: string;
  notice?: string;
  primaryColor?: string;
  accentColor?: string;
  address?: string;
  phone?: string;
  instagram?: string;
  openingHours?: string;
  businessHours?: BusinessHours;
  timezone?: string;
};

export type PublicMenuSnapshot = {
  items: MenuItem[];
  branding?: PublicMenuBranding;
  version?: number;
};

function isMenuItem(value: unknown): value is MenuItem {
  if (!isRecord(value)) return false;
  const groups = value.modifierGroups;
  const validGroups =
    groups === undefined ||
    (Array.isArray(groups) &&
      groups.every(
        (group) =>
          isRecord(group) &&
          typeof group.id === "string" &&
          typeof group.name === "string" &&
          typeof group.required === "boolean" &&
          Number.isInteger(group.maxSelections) &&
          Array.isArray(group.options) &&
          group.options.every(
            (option) =>
              isRecord(option) &&
              typeof option.id === "string" &&
              typeof option.name === "string" &&
              Number.isInteger(option.priceCents),
          ),
      ));
  const validTags =
    value.tags === undefined ||
    (Array.isArray(value.tags) && value.tags.every((tag) => typeof tag === "string"));
  const validDeliveryPrice =
    value.deliveryPriceCents === undefined ||
    (Number.isInteger(value.deliveryPriceCents) && (value.deliveryPriceCents as number) >= 0);
  const validImage =
    value.imageUrl === undefined ||
    (typeof value.imageUrl === "string" && /^https?:\/\//.test(value.imageUrl));
  return (
    typeof value.id === "string" &&
    typeof value.category === "string" &&
    typeof value.name === "string" &&
    typeof value.description === "string" &&
    Number.isInteger(value.priceCents) &&
    (value.priceCents as number) >= 0 &&
    typeof value.visual === "string" &&
    typeof value.available === "boolean" &&
    validDeliveryPrice &&
    validImage &&
    validTags &&
    validGroups
  );
}

function optionalText(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

export function normalizePublicMenu(payload: unknown): MenuItem[] | null {
  if (!isRecord(payload) || !Array.isArray(payload.items) || !payload.items.every(isMenuItem)) {
    return null;
  }
  return payload.items;
}

export function normalizePublicMenuSnapshot(payload: unknown): PublicMenuSnapshot | null {
  const items = normalizePublicMenu(payload);
  if (!items || !isRecord(payload)) return null;
  const metadata = isRecord(payload.metadata) ? payload.metadata : null;
  const branding = isRecord(metadata?.branding) ? metadata.branding : null;
  const normalizedBranding =
    branding && typeof branding.displayName === "string" && branding.displayName.trim()
      ? {
          displayName: branding.displayName.trim(),
          ...(optionalText(branding.slogan) ? { slogan: optionalText(branding.slogan) } : {}),
          ...(typeof branding.logoUrl === "string" && /^https?:\/\//.test(branding.logoUrl)
            ? { logoUrl: branding.logoUrl }
            : {}),
          ...(typeof branding.coverImageUrl === "string" &&
          /^https?:\/\//.test(branding.coverImageUrl)
            ? { coverImageUrl: branding.coverImageUrl }
            : {}),
          ...(optionalText(branding.notice) ? { notice: optionalText(branding.notice) } : {}),
          ...(typeof branding.primaryColor === "string" &&
          /^#[0-9a-f]{6}$/i.test(branding.primaryColor)
            ? { primaryColor: branding.primaryColor }
            : {}),
          ...(typeof branding.accentColor === "string" &&
          /^#[0-9a-f]{6}$/i.test(branding.accentColor)
            ? { accentColor: branding.accentColor }
            : {}),
          ...(optionalText(branding.address) ? { address: optionalText(branding.address) } : {}),
          ...(optionalText(branding.phone) ? { phone: optionalText(branding.phone) } : {}),
          ...(optionalText(branding.instagram)
            ? { instagram: optionalText(branding.instagram) }
            : {}),
          ...(optionalText(branding.openingHours)
            ? { openingHours: optionalText(branding.openingHours) }
            : {}),
          ...(businessHoursSchema.safeParse(branding.businessHours).success
            ? { businessHours: businessHoursSchema.parse(branding.businessHours) }
            : {}),
          ...(timezoneSchema.safeParse(branding.timezone).success
            ? { timezone: branding.timezone as string }
            : {}),
        }
      : undefined;
  const version =
    Number.isSafeInteger(payload.version) && (payload.version as number) > 0
      ? (payload.version as number)
      : undefined;
  return {
    items,
    ...(normalizedBranding ? { branding: normalizedBranding } : {}),
    ...(version ? { version } : {}),
  };
}

export async function getPublicMenu(
  slug: string,
): Promise<PublicMenuSnapshot & { source: "api" | "unavailable" }> {
  const apiUrl = process.env.NEXT_PUBLIC_CUSTOMER_API_URL?.replace(/\/$/, "");
  if (!apiUrl || process.env.NEXT_PUBLIC_CUSTOMER_API_ENABLED !== "true") {
    return { items: [], source: "unavailable" };
  }
  try {
    const response = await fetch(`${apiUrl}/public/v1/menus/${encodeURIComponent(slug)}`, {
      next: { revalidate: 60 },
    });
    if (!response.ok) throw new Error("Menu indisponível");
    const snapshot = normalizePublicMenuSnapshot(await response.json());
    if (!snapshot) throw new Error("Menu inválido");
    return { ...snapshot, source: "api" };
  } catch {
    return { items: [], source: "unavailable" };
  }
}
