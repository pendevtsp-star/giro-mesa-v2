import { Badge, Button, Card, EmptyState, Input, Modal, NativeSelect } from "@giromesa/ui";
import { type FormEvent, useCallback, useEffect, useRef, useState } from "react";
import { api } from "./api";

const roles = ["viewer", "support", "finance", "fiscal", "engineering"] as const;
type TeamRole = (typeof roles)[number];

interface TeamMember {
  identityId: string;
  email: string;
  name: string;
  role: string;
  grantedAt: string;
  emailVerified: boolean;
  mfaEnabled: boolean;
}

interface TeamInvitation {
  id: string;
  email: string;
  role: string;
  status: "pending" | "expired";
  expiresAt: string;
  createdAt: string;
}

interface TeamDirectory {
  members: TeamMember[];
  invitations: TeamInvitation[];
}

type RemovalTarget =
  | { kind: "member"; id: string; label: string }
  | { kind: "invitation"; id: string; label: string };

const row = (value: unknown): Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
const requiredText = (value: unknown) => (typeof value === "string" ? value : "");

export function parsePlatformTeam(value: unknown): TeamDirectory {
  const root = row(value);
  const memberRows = Array.isArray(root.members) ? root.members.map(row) : [];
  const invitationRows = Array.isArray(root.invitations) ? root.invitations.map(row) : [];
  return {
    members: memberRows.flatMap((member) => {
      const identityId = requiredText(member.identityId);
      const email = requiredText(member.email);
      if (!identityId || !email) return [];
      return [
        {
          identityId,
          email,
          name: requiredText(member.name),
          role: requiredText(member.role),
          grantedAt: requiredText(member.grantedAt),
          emailVerified: member.emailVerified === true,
          mfaEnabled: member.mfaEnabled === true,
        },
      ];
    }),
    invitations: invitationRows.flatMap((invitation) => {
      const id = requiredText(invitation.id);
      const email = requiredText(invitation.email);
      if (!id || !email) return [];
      return [
        {
          id,
          email,
          role: requiredText(invitation.role),
          status: invitation.status === "expired" ? "expired" : "pending",
          expiresAt: requiredText(invitation.expiresAt),
          createdAt: requiredText(invitation.createdAt),
        },
      ];
    }),
  };
}

const dateTime = (value: string) =>
  value && !Number.isNaN(Date.parse(value)) ? new Date(value).toLocaleString("pt-BR") : "—";
const errorMessage = (error: unknown) =>
  error instanceof Error ? error.message : "A operação não pôde ser concluída.";

export function PlatformTeam() {
  const [directory, setDirectory] = useState<TeamDirectory | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<{ tone: "success" | "danger"; text: string } | null>(
    null,
  );
  const [target, setTarget] = useState<RemovalTarget | null>(null);
  const inviteKey = useRef(crypto.randomUUID());
  const actionKey = useRef(crypto.randomUUID());

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setDirectory(parsePlatformTeam(await api.platform.team()));
      setFeedback(null);
    } catch (error) {
      setFeedback({ tone: "danger", text: errorMessage(error) });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function invite(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    const form = event.currentTarget;
    const data = new FormData(form);
    setBusy(true);
    try {
      await api.platform.inviteTeamMember(
        {
          email: String(data.get("email") ?? "").trim(),
          role: String(data.get("role") ?? "viewer") as TeamRole,
          reason: String(data.get("reason") ?? "").trim(),
          reauth: { mfaCode: String(data.get("mfaCode") ?? "").trim() },
        },
        inviteKey.current,
      );
      form.reset();
      inviteKey.current = crypto.randomUUID();
      await load();
      setFeedback({ tone: "success", text: "Convite enviado. Ele expira em sete dias." });
    } catch (error) {
      setFeedback({ tone: "danger", text: errorMessage(error) });
    } finally {
      setBusy(false);
    }
  }

  async function remove(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!target || busy) return;
    const data = new FormData(event.currentTarget);
    const body = {
      reason: String(data.get("reason") ?? "").trim(),
      reauth: { mfaCode: String(data.get("mfaCode") ?? "").trim() },
    };
    setBusy(true);
    try {
      if (target.kind === "member")
        await api.platform.revokeTeamMember(target.id, body, actionKey.current);
      else await api.platform.cancelTeamInvitation(target.id, body, actionKey.current);
      actionKey.current = crypto.randomUUID();
      setTarget(null);
      await load();
      setFeedback({
        tone: "success",
        text: target.kind === "member" ? "Acesso revogado imediatamente." : "Convite cancelado.",
      });
    } catch (error) {
      setFeedback({ tone: "danger", text: errorMessage(error) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="platform-team" aria-labelledby="platform-team-title">
      <div className="platform-section-heading">
        <div>
          <p>ACESSO INTERNO</p>
          <h2 id="platform-team-title">Equipe de desenvolvimento</h2>
          <span>Convites pessoais, permissões mínimas e MFA obrigatório.</span>
        </div>
        <Button disabled={loading} onClick={() => void load()} size="sm" variant="secondary">
          {loading ? "Atualizando…" : "Atualizar"}
        </Button>
      </div>

      {feedback && (
        <p className="platform-team-feedback" data-tone={feedback.tone} role="status">
          {feedback.text}
        </p>
      )}

      <Card>
        <form className="platform-team-invite" onSubmit={invite}>
          <label htmlFor="platform-team-email">
            E-mail corporativo
            <Input
              autoComplete="email"
              id="platform-team-email"
              name="email"
              required
              type="email"
            />
          </label>
          <label htmlFor="platform-team-role">
            Perfil
            <NativeSelect defaultValue="viewer" id="platform-team-role" name="role" required>
              {roles.map((role) => (
                <option key={role} value={role}>
                  {role}
                </option>
              ))}
            </NativeSelect>
          </label>
          <label htmlFor="platform-team-reason">
            Motivo auditável
            <Input id="platform-team-reason" minLength={8} name="reason" required />
          </label>
          <label htmlFor="platform-team-mfa">
            Seu código MFA atual
            <Input
              autoComplete="one-time-code"
              id="platform-team-mfa"
              inputMode="numeric"
              maxLength={6}
              minLength={6}
              name="mfaCode"
              pattern="[0-9]{6}"
              required
            />
          </label>
          <Button disabled={busy} type="submit">
            {busy ? "Enviando…" : "Enviar convite"}
          </Button>
        </form>
      </Card>

      <div className="platform-team-grid">
        <Card>
          <h3>Membros ativos</h3>
          {directory?.members.length ? (
            <div className="platform-team-list">
              {directory.members.map((member) => (
                <article key={member.identityId}>
                  <div>
                    <strong>{member.name || member.email}</strong>
                    <small>{member.email}</small>
                    <small>Acesso concedido em {dateTime(member.grantedAt)}</small>
                  </div>
                  <div className="platform-team-actions">
                    <Badge tone="info">{member.role}</Badge>
                    <Badge tone={member.emailVerified && member.mfaEnabled ? "success" : "warning"}>
                      {member.emailVerified && member.mfaEnabled
                        ? "Conta protegida"
                        : "Revisar conta"}
                    </Badge>
                    <Button
                      onClick={() =>
                        setTarget({ kind: "member", id: member.identityId, label: member.email })
                      }
                      size="sm"
                      variant="secondary"
                    >
                      Revogar
                    </Button>
                  </div>
                </article>
              ))}
            </div>
          ) : (
            <EmptyState
              description="O administrador de contingência configurado no ambiente não aparece nesta lista."
              icon="◇"
              title="Nenhum membro persistido"
            />
          )}
        </Card>

        <Card>
          <h3>Convites</h3>
          {directory?.invitations.length ? (
            <div className="platform-team-list">
              {directory.invitations.map((invitation) => (
                <article key={invitation.id}>
                  <div>
                    <strong>{invitation.email}</strong>
                    <small>Expira em {dateTime(invitation.expiresAt)}</small>
                  </div>
                  <div className="platform-team-actions">
                    <Badge tone="info">{invitation.role}</Badge>
                    <Badge tone={invitation.status === "pending" ? "warning" : "danger"}>
                      {invitation.status === "pending" ? "Pendente" : "Expirado"}
                    </Badge>
                    <Button
                      onClick={() =>
                        setTarget({
                          kind: "invitation",
                          id: invitation.id,
                          label: invitation.email,
                        })
                      }
                      size="sm"
                      variant="secondary"
                    >
                      Cancelar
                    </Button>
                  </div>
                </article>
              ))}
            </div>
          ) : (
            <EmptyState
              description="Não há convites aguardando aceite."
              icon="✓"
              title="Fila vazia"
            />
          )}
        </Card>
      </div>

      <Modal
        description={`Confirme a remoção de ${target?.label ?? "este acesso"}. A ação é auditada.`}
        isOpen={target !== null}
        onClose={() => !busy && setTarget(null)}
        size="sm"
        title={target?.kind === "member" ? "Revogar acesso" : "Cancelar convite"}
      >
        <form className="platform-action-form" onSubmit={remove}>
          <label htmlFor="platform-team-action-reason">
            Motivo auditável
            <Input id="platform-team-action-reason" minLength={8} name="reason" required />
          </label>
          <label htmlFor="platform-team-action-mfa">
            Seu código MFA atual
            <Input
              autoComplete="one-time-code"
              id="platform-team-action-mfa"
              inputMode="numeric"
              maxLength={6}
              minLength={6}
              name="mfaCode"
              pattern="[0-9]{6}"
              required
            />
          </label>
          <label className="platform-confirmation">
            <input name="confirmed" required type="checkbox" />
            Confirmo que revisei o e-mail e o impacto desta ação.
          </label>
          <div className="platform-modal-actions">
            <Button disabled={busy} type="submit" variant="danger">
              {busy ? "Confirmando…" : "Confirmar"}
            </Button>
            <Button disabled={busy} onClick={() => setTarget(null)} type="button" variant="ghost">
              Voltar
            </Button>
          </div>
        </form>
      </Modal>
    </section>
  );
}
