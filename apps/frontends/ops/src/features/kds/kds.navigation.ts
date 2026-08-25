export type KdsArea = "station" | "pass" | "settings";
export type KdsOperationalArea = Exclude<KdsArea, "settings">;

export const KDS_NAVIGATION_EVENT = "giromesa:kds-navigation-changed";

export function kdsStoragePrefix(unitId: string): string {
  return `giromesa:kds:${unitId}`;
}

export function kdsAreaHref(area: KdsArea): string {
  return `#/kds/${area}`;
}

export function parseKdsArea(hash: string, fallback: KdsOperationalArea = "station"): KdsArea {
  const [route, area] = hash.replace(/^#\/?/, "").split(/[/?#]/);
  if (route !== "kds") return fallback;
  if (area === "pass" || area === "settings" || area === "station") return area;
  return fallback;
}

export function resolveKdsAreaPermission(
  area: KdsArea,
  canManageSettings: boolean,
  fallback: KdsOperationalArea,
): KdsArea {
  return area === "settings" && !canManageSettings ? fallback : area;
}

function readLocalValue(key: string): string | null {
  try {
    return globalThis.localStorage?.getItem(key) ?? null;
  } catch {
    return null;
  }
}

function saveLocalValue(key: string, value: string): void {
  try {
    globalThis.localStorage?.setItem(key, value);
  } catch {
    // A navegação continua válida em memória quando o armazenamento está indisponível.
  }
}

export function readKdsLastOperationalArea(unitId: string): KdsOperationalArea {
  return readLocalValue(`${kdsStoragePrefix(unitId)}:last-operational-area`) === "pass"
    ? "pass"
    : "station";
}

export function saveKdsLastOperationalArea(unitId: string, area: KdsOperationalArea): void {
  saveLocalValue(`${kdsStoragePrefix(unitId)}:last-operational-area`, area);
  dispatchKdsNavigationChange();
}

export function kdsStationMenuLabel(unitId: string): string {
  const prefix = kdsStoragePrefix(unitId);
  if (readLocalValue(`${prefix}:station-locked`) !== "true") return "Estação — não fixada";
  return `Estação — ${readLocalValue(`${prefix}:station-label`) ?? "não identificada"}`;
}

export function saveKdsStationLabel(unitId: string, stationLabel: string): void {
  saveLocalValue(`${kdsStoragePrefix(unitId)}:station-label`, stationLabel);
  dispatchKdsNavigationChange();
}

export function dispatchKdsNavigationChange(): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new Event(KDS_NAVIGATION_EVENT));
}
