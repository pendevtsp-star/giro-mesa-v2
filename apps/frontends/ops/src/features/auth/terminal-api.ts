import { apiRequest } from "../../api";

const terminalDeviceStorageKey = "giromesa.ops.device-id";

export function terminalDeviceId() {
  let deviceId = window.localStorage.getItem(terminalDeviceStorageKey);
  if (!deviceId) {
    deviceId = crypto.randomUUID();
    window.localStorage.setItem(terminalDeviceStorageKey, deviceId);
  }
  return deviceId;
}

export interface TerminalOperator {
  membershipId: string;
  identityId: string;
  displayName: string;
  roles: string[];
}

export interface TerminalSessionView {
  id: string;
  organization: { id: string; name: string; document: string };
  unit: { id: string; name: string; timezone: string };
  deviceId: string | null;
  expiresAt: string;
  idleTimeoutSeconds: number;
  actorEpoch: number;
  lockedUntil: string | null;
  operators: TerminalOperator[];
  actor: TerminalOperator | null;
}

export const terminalApi = {
  configurePin: (input: { membershipId: string; currentPassword: string; pin: string }) =>
    apiRequest<{ configured: true }>("/v1/auth/terminal-pin", {
      method: "PUT",
      body: JSON.stringify(input),
    }),
  create: (input: { organizationId: string; unitId: string; deviceId?: string }) =>
    apiRequest<TerminalSessionView>("/v1/auth/terminal-session", {
      method: "POST",
      body: JSON.stringify(input),
    }),
  status: () => apiRequest<TerminalSessionView>("/v1/auth/terminal-session"),
  unlock: (input: { membershipId: string; pin: string }) =>
    apiRequest<TerminalSessionView>("/v1/auth/terminal-session/unlock", {
      method: "POST",
      body: JSON.stringify(input),
    }),
  activity: (actorEpoch: number) =>
    apiRequest<{ active: true }>("/v1/auth/terminal-session/activity", {
      method: "POST",
      body: JSON.stringify({ actorEpoch }),
    }),
  lock: () => apiRequest<TerminalSessionView>("/v1/auth/terminal-session/lock", { method: "POST" }),
  close: () => apiRequest<void>("/v1/auth/terminal-session", { method: "DELETE" }),
};
