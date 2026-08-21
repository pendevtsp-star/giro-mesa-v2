import type { TerminalProfile } from "../../api";

const storageKey = (unitId: string, installationId: string) =>
  `giromesa:terminal-profile:${unitId}:${installationId}`;
const activeStorageKey = (unitId: string) => `giromesa:terminal-profile:active:${unitId}`;

export function readTerminalProfile(
  unitId: string,
  installationId: string,
): TerminalProfile | null {
  try {
    const value = window.localStorage.getItem(storageKey(unitId, installationId));
    return value ? (JSON.parse(value) as TerminalProfile) : null;
  } catch {
    return null;
  }
}

export function saveTerminalProfile(profile: TerminalProfile) {
  try {
    window.localStorage.setItem(
      storageKey(profile.unitId, profile.installationId),
      JSON.stringify(profile),
    );
    window.localStorage.setItem(activeStorageKey(profile.unitId), JSON.stringify(profile));
  } catch {
    // Remote persistence remains authoritative when local storage is unavailable.
  }
}

export function currentTerminalPrinterId(unitId: string): string | undefined {
  try {
    const profile = JSON.parse(
      window.localStorage.getItem(activeStorageKey(unitId)) ?? "null",
    ) as TerminalProfile | null;
    return profile?.printerId ?? undefined;
  } catch {
    return undefined;
  }
}

export function readActiveTerminalProfile(unitId: string): TerminalProfile | null {
  try {
    const value = window.localStorage.getItem(activeStorageKey(unitId));
    return value ? (JSON.parse(value) as TerminalProfile) : null;
  } catch {
    return null;
  }
}
