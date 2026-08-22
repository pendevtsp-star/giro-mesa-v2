import { describe, expect, it } from "vitest";
import { terminalSessionForView } from "../../app/access";
import type { TerminalSessionView } from "./terminal-api";

const view: TerminalSessionView = {
  id: "terminal-1",
  organization: { id: "org-1", name: "Restaurante", document: "123" },
  unit: { id: "unit-1", name: "Centro", timezone: "America/Sao_Paulo" },
  deviceId: "device-1",
  expiresAt: "2026-08-22T00:00:00.000Z",
  idleTimeoutSeconds: 300,
  actorEpoch: 7,
  lockedUntil: null,
  operators: [],
  actor: {
    membershipId: "membership-1",
    identityId: "identity-1",
    displayName: "Gerente",
    roles: ["manager"],
  },
};

describe("terminal session projection", () => {
  it("keeps the actor and strips sensitive management permissions", () => {
    const session = terminalSessionForView(view);
    expect(session).toMatchObject({
      terminalMode: true,
      terminalSessionId: "terminal-1",
      actorEpoch: 7,
      identityId: "identity-1",
      organizationId: "org-1",
      unitId: "unit-1",
    });
    expect(session?.profile.permissions).toContain("salon.operate");
    expect(session?.profile.permissions).not.toContain("people.manage");
    expect(session?.profile.permissions).not.toContain("finance.manage");
    expect(session?.profile.permissions).not.toContain("catalog.manage");
  });

  it("does not create an operational session while the terminal is locked", () => {
    expect(terminalSessionForView({ ...view, actor: null })).toBeNull();
  });
});
