export type KdsBumpAction = "previous" | "next" | "bump" | "print" | "refresh";
export type KdsBumpBarMap = Record<KdsBumpAction, string>;

export const DEFAULT_KDS_BUMP_BAR_MAP: KdsBumpBarMap = {
  previous: "ArrowLeft",
  next: "ArrowRight",
  bump: "Enter",
  print: "p",
  refresh: "r",
};

export function normalizeKdsBumpKey(key: string) {
  return key.length === 1 ? key.toLocaleLowerCase("pt-BR") : key;
}

export function kdsBumpKeyLabel(key: string) {
  if (key === "ArrowLeft") return "← Esquerda";
  if (key === "ArrowRight") return "→ Direita";
  return key.length === 1 ? key.toLocaleUpperCase("pt-BR") : key;
}

export function readKdsBumpBarMap(storageKey: string): KdsBumpBarMap {
  try {
    const value = JSON.parse(localStorage.getItem(storageKey) ?? "null") as unknown;
    if (!value || typeof value !== "object" || Array.isArray(value))
      return DEFAULT_KDS_BUMP_BAR_MAP;
    const row = value as Record<string, unknown>;
    const result = { ...DEFAULT_KDS_BUMP_BAR_MAP };
    for (const action of Object.keys(result) as KdsBumpAction[]) {
      if (typeof row[action] === "string" && row[action].length > 0) {
        result[action] = normalizeKdsBumpKey(row[action]);
      }
    }
    return new Set(Object.values(result)).size === Object.keys(result).length
      ? result
      : DEFAULT_KDS_BUMP_BAR_MAP;
  } catch {
    return DEFAULT_KDS_BUMP_BAR_MAP;
  }
}

export function saveKdsBumpBarMap(storageKey: string, map: KdsBumpBarMap) {
  localStorage.setItem(storageKey, JSON.stringify(map));
}

export function kdsBumpActionForKey(map: KdsBumpBarMap, key: string): KdsBumpAction | null {
  const normalized = normalizeKdsBumpKey(key);
  return (
    (Object.entries(map).find(([, mappedKey]) => mappedKey === normalized)?.[0] as
      | KdsBumpAction
      | undefined) ?? null
  );
}
