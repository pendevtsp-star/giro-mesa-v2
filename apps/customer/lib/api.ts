import { demoMenu, MENU_ICON_NAMES, type MenuItem } from "./menu.ts";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

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
  return (
    typeof value.id === "string" &&
    typeof value.category === "string" &&
    typeof value.name === "string" &&
    typeof value.description === "string" &&
    Number.isInteger(value.priceCents) &&
    (value.priceCents as number) >= 0 &&
    (value.visual === undefined || typeof value.visual === "string") &&
    (value.icon === undefined || MENU_ICON_NAMES.some((icon) => icon === value.icon)) &&
    typeof value.available === "boolean" &&
    validTags &&
    validGroups
  );
}

export function normalizePublicMenu(payload: unknown): MenuItem[] | null {
  if (!isRecord(payload) || !Array.isArray(payload.items) || !payload.items.every(isMenuItem)) {
    return null;
  }
  return payload.items;
}

export function isDemoMenuSlug(slug: string, configuredQaSlug?: string): boolean {
  return slug === "demo" || Boolean(configuredQaSlug && slug === configuredQaSlug);
}

export async function getPublicMenu(
  slug: string,
): Promise<{ items: MenuItem[]; source: "api" | "demo" | "unavailable" }> {
  if (isDemoMenuSlug(slug, process.env.CUSTOMER_QA_DEMO_SLUG)) {
    return { items: demoMenu, source: "demo" };
  }
  const apiUrl = process.env.NEXT_PUBLIC_CUSTOMER_API_URL?.replace(/\/$/, "");
  if (!apiUrl || process.env.NEXT_PUBLIC_CUSTOMER_API_ENABLED !== "true") {
    return { items: [], source: "unavailable" };
  }
  try {
    const response = await fetch(`${apiUrl}/public/v1/menus/${encodeURIComponent(slug)}`, {
      next: { revalidate: 60 },
    });
    if (!response.ok) throw new Error("Menu indisponível");
    const items = normalizePublicMenu(await response.json());
    if (!items) throw new Error("Menu inválido");
    return { items, source: "api" };
  } catch {
    return { items: [], source: "unavailable" };
  }
}
