export function normalizeCatalogStationIds(stationIds: readonly string[]): string[] {
  return [...new Set(stationIds.filter((stationId) => stationId.trim().length > 0))];
}

export function hasCatalogProductionStation(stationIds: readonly string[]): boolean {
  return normalizeCatalogStationIds(stationIds).length > 0;
}

export function toggleCatalogStationId(stationIds: readonly string[], stationId: string): string[] {
  const current = normalizeCatalogStationIds(stationIds);
  return current.includes(stationId)
    ? current.filter((candidate) => candidate !== stationId)
    : [...current, stationId];
}
