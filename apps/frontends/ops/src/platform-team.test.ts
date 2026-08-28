import { describe, expect, it } from "vitest";
import { parsePlatformTeam } from "./platform-team";

describe("equipe interna do backoffice", () => {
  it("mantém somente membros e convites identificáveis", () => {
    expect(
      parsePlatformTeam({
        members: [
          {
            identityId: "identity-1",
            email: "dev@giromesa.com.br",
            name: "Dev",
            role: "engineering",
            grantedAt: "2026-08-27T12:00:00.000Z",
            emailVerified: true,
            mfaEnabled: true,
          },
          { role: "viewer" },
        ],
        invitations: [
          {
            id: "invite-1",
            email: "suporte@giromesa.com.br",
            role: "support",
            status: "expired",
            expiresAt: "2026-08-26T12:00:00.000Z",
            createdAt: "2026-08-19T12:00:00.000Z",
          },
          null,
        ],
      }),
    ).toEqual({
      members: [
        expect.objectContaining({
          identityId: "identity-1",
          email: "dev@giromesa.com.br",
          mfaEnabled: true,
        }),
      ],
      invitations: [expect.objectContaining({ id: "invite-1", status: "expired" })],
    });
  });
});
