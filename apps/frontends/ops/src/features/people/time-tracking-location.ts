export type DeviceLocation = {
  latitude: number;
  longitude: number;
  accuracyMeters?: number;
};

export type LocationPermission = "granted" | "prompt" | "denied" | "unavailable";

export async function requestDeviceLocation(): Promise<DeviceLocation> {
  if (!navigator.geolocation) {
    throw new Error("Este dispositivo não disponibilizou a localização.");
  }
  return new Promise((resolve, reject) => {
    navigator.geolocation.getCurrentPosition(
      (position) =>
        resolve({
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
          accuracyMeters: Number.isFinite(position.coords.accuracy)
            ? Math.round(position.coords.accuracy)
            : undefined,
        }),
      () => reject(new Error("Autorize a localização para registrar o ponto.")),
      { enableHighAccuracy: true, maximumAge: 0, timeout: 10_000 },
    );
  });
}

export async function locationPermission(): Promise<LocationPermission> {
  if (!navigator.geolocation) return "unavailable";
  try {
    const state = await navigator.permissions?.query({ name: "geolocation" });
    if (state?.state === "granted" || state?.state === "prompt" || state?.state === "denied") {
      return state.state;
    }
  } catch {}
  return "prompt";
}

export function timeClockSessionId(scope: {
  organizationId: string;
  unitId: string;
  identityId: string;
}) {
  if (typeof sessionStorage === "undefined") return undefined;
  const key = `giromesa.time-clock.session.v1:${scope.organizationId}:${scope.unitId}:${scope.identityId}`;
  const current = sessionStorage.getItem(key);
  if (current) return current;
  const created = globalThis.crypto?.randomUUID?.() ?? `session-${Date.now()}`;
  sessionStorage.setItem(key, created);
  return created;
}

export function distanceMeters(
  latitudeA: number,
  longitudeA: number,
  latitudeB: number,
  longitudeB: number,
) {
  const earthRadius = 6_371_000;
  const toRadians = (value: number) => (value * Math.PI) / 180;
  const deltaLatitude = toRadians(latitudeB - latitudeA);
  const deltaLongitude = toRadians(longitudeB - longitudeA);
  const a =
    Math.sin(deltaLatitude / 2) ** 2 +
    Math.cos(toRadians(latitudeA)) *
      Math.cos(toRadians(latitudeB)) *
      Math.sin(deltaLongitude / 2) ** 2;
  return 2 * earthRadius * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export function openStreetMapSearchUrl(address: string) {
  return `https://www.openstreetmap.org/search?query=${encodeURIComponent(address)}`;
}

export function openStreetMapEmbedUrl(latitude: number, longitude: number, radiusMeters: number) {
  const latitudeDelta = Math.max(radiusMeters / 111_320, 0.0005) * 2;
  const longitudeDelta = latitudeDelta / Math.max(Math.cos((latitude * Math.PI) / 180), 0.2);
  const bbox = [
    longitude - longitudeDelta,
    latitude - latitudeDelta,
    longitude + longitudeDelta,
    latitude + latitudeDelta,
  ].join(",");
  return `https://www.openstreetmap.org/export/embed.html?bbox=${encodeURIComponent(bbox)}&layer=mapnik&marker=${encodeURIComponent(`${latitude},${longitude}`)}`;
}
