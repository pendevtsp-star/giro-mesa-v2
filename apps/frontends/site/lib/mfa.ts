type UnknownRecord = Record<string, unknown>;

export type MfaSetup = { secret: string; otpauthUri: string };

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null;
}

export function readMfaChallenge(payload: unknown): string | null {
  if (!isRecord(payload) || payload.mfaRequired !== true) return null;
  const token = payload.challengeToken;
  return typeof token === "string" && token.length >= 32 && token.length <= 128 ? token : null;
}

export function readMfaStatus(payload: unknown): boolean | null {
  if (!isRecord(payload) || typeof payload.enabled !== "boolean") return null;
  return payload.enabled;
}

export function readMfaSetup(payload: unknown): MfaSetup | null {
  if (!isRecord(payload)) return null;
  const { secret, otpauthUri } = payload;
  if (typeof secret !== "string" || secret.length < 16 || secret.length > 256) return null;
  if (typeof otpauthUri !== "string" || !otpauthUri.startsWith("otpauth://totp/")) return null;
  return { secret, otpauthUri };
}

export function readRecoveryCodes(payload: unknown): string[] | null {
  if (!isRecord(payload) || !Array.isArray(payload.recoveryCodes)) return null;
  const codes = payload.recoveryCodes;
  if (
    codes.length === 0 ||
    !codes.every((code) => typeof code === "string" && code.length >= 12 && code.length <= 64)
  ) {
    return null;
  }
  return codes;
}

export function buildMfaProof(value: string, useRecoveryCode: boolean) {
  const proof = value.trim();
  return useRecoveryCode ? { recoveryCode: proof } : { code: proof };
}
