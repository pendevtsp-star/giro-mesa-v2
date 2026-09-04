import { Badge, Button, Card, Input, Label, NativeSelect } from "@giromesa/ui";
import { type FormEvent, useEffect, useMemo, useState } from "react";
import { ApiClientError } from "../../api";
import { profiles } from "../../profiles";
import { Brand } from "./Brand";
import type { TerminalSessionView } from "./terminal-api";

const terminalRoleLabels = new Map<string, string>(
  profiles.map((profile) => [profile.id, profile.role]),
);

export function TerminalLockScreen({
  view,
  onUnlock,
  onClose,
}: {
  view: TerminalSessionView;
  onUnlock: (membershipId: string, pin: string) => Promise<void>;
  onClose: () => Promise<void>;
}) {
  const [membershipId, setMembershipId] = useState("");
  const [pin, setPin] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [clock, setClock] = useState(() => Date.now());
  const [online, setOnline] = useState(() =>
    typeof navigator === "undefined" ? true : navigator.onLine,
  );

  useEffect(() => {
    const update = () => setOnline(navigator.onLine);
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    return () => {
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
    };
  }, []);

  useEffect(() => {
    if (!view.lockedUntil) return;
    const interval = globalThis.setInterval(() => setClock(Date.now()), 1_000);
    return () => globalThis.clearInterval(interval);
  }, [view.lockedUntil]);

  const locked = useMemo(
    () => Boolean(view.lockedUntil && new Date(view.lockedUntil).getTime() > clock),
    [clock, view.lockedUntil],
  );
  const lockedUntilLabel = view.lockedUntil
    ? new Date(view.lockedUntil).toLocaleTimeString("pt-BR", {
        hour: "2-digit",
        minute: "2-digit",
      })
    : "";

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!online || locked || !membershipId || !/^\d{6}$/.test(pin)) return;
    setBusy(true);
    setError("");
    try {
      await onUnlock(membershipId, pin);
      setPin("");
    } catch (cause) {
      setPin("");
      setError(
        cause instanceof ApiClientError ? cause.message : "Não foi possível liberar o terminal.",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="terminal-lock">
      <div className="terminal-lock__header">
        <Brand />
        <Button disabled={busy} onClick={() => void onClose()} variant="ghost">
          Encerrar terminal
        </Button>
      </div>
      <Card className="terminal-lock__card">
        <Badge tone={online ? "success" : "warning"}>
          {online ? "Terminal online" : "Sem conexão"}
        </Badge>
        <h1>Quem vai operar agora?</h1>
        <p className="muted">
          {view.organization.name} · {view.unit.name}. Selecione seu nome e digite seu PIN; a
          identificação usa os dois dados. O terminal bloqueia após 5 minutos sem atividade.
        </p>

        {view.operators.length > 0 ? (
          <form className="form-stack" onSubmit={submit}>
            <Label>
              Colaborador
              <NativeSelect
                autoFocus
                disabled={busy}
                onChange={(event) => setMembershipId(event.target.value)}
                value={membershipId}
              >
                <option disabled value="">
                  Selecione seu nome
                </option>
                {view.operators.map((operator) => (
                  <option key={operator.membershipId} value={operator.membershipId}>
                    {operator.displayName}
                    {operator.roles.length > 0
                      ? ` · ${operator.roles
                          .map((role) => terminalRoleLabels.get(role) ?? role)
                          .join(" + ")}`
                      : ""}
                  </option>
                ))}
              </NativeSelect>
            </Label>
            <Label>
              PIN de 6 dígitos
              <Input
                autoComplete="one-time-code"
                disabled={busy || !online || locked}
                inputMode="numeric"
                maxLength={6}
                onChange={(event) => setPin(event.target.value.replace(/\D/g, "").slice(0, 6))}
                pattern="[0-9]{6}"
                required
                type="password"
                value={pin}
              />
            </Label>
            {!online && (
              <p className="auth-message auth-message--error" role="status">
                A troca por PIN é somente online. Reconecte para identificar o operador.
              </p>
            )}
            {locked && (
              <p className="auth-message auth-message--error" role="alert">
                Muitas tentativas inválidas. Tente novamente após {lockedUntilLabel}.
              </p>
            )}
            {error && (
              <p className="auth-message auth-message--error" role="alert">
                {error}
              </p>
            )}
            <Button disabled={busy || !online || locked || !/^\d{6}$/.test(pin)} type="submit">
              {busy ? "Validando..." : "Entrar na operação"}
            </Button>
          </form>
        ) : (
          <p className="auth-message auth-message--error" role="status">
            Nenhum colaborador configurou um PIN para esta empresa. Cada pessoa deve entrar com sua
            conta uma vez e cadastrar o próprio PIN.
          </p>
        )}
      </Card>
    </main>
  );
}
