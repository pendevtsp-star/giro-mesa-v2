import { Button, Input, Label } from "@giromesa/ui";
import { type FormEvent, useState } from "react";
import { ApiClientError } from "../../api";

export type ConfigureTerminalPin = (input: {
  membershipId: string;
  currentPassword: string;
  pin: string;
}) => Promise<void>;

export function TerminalPinSetupForm({
  membershipId,
  onConfigure,
}: {
  membershipId: string;
  onConfigure: ConfigureTerminalPin;
}) {
  const [currentPassword, setCurrentPassword] = useState("");
  const [pin, setPin] = useState("");
  const [pinConfirmation, setPinConfirmation] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ error: boolean; text: string } | null>(null);

  async function configurePin(event: FormEvent) {
    event.preventDefault();
    if (!membershipId || !currentPassword || !/^\d{6}$/.test(pin) || pinConfirmation !== pin)
      return;
    setBusy(true);
    setMessage(null);
    try {
      await onConfigure({ membershipId, currentPassword, pin });
      setCurrentPassword("");
      setPin("");
      setPinConfirmation("");
      setMessage({
        error: false,
        text: "PIN configurado. Agora selecione seu nome e use este PIN no terminal compartilhado.",
      });
    } catch (cause) {
      setMessage({
        error: true,
        text:
          cause instanceof ApiClientError ? cause.message : "Não foi possível configurar o PIN.",
      });
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="terminal-pin-setup__form" onSubmit={configurePin}>
      <p className="muted">
        Use um PIN pessoal de 6 dígitos. Ele identifica você depois que seu nome for selecionado no
        terminal e não substitui sua senha.
      </p>
      <Label>
        Senha atual
        <Input
          autoComplete="current-password"
          disabled={busy}
          onChange={(event) => {
            setCurrentPassword(event.target.value);
            setMessage(null);
          }}
          required
          type="password"
          value={currentPassword}
        />
      </Label>
      <Label>
        Novo PIN de 6 dígitos
        <Input
          autoComplete="new-password"
          disabled={busy}
          inputMode="numeric"
          maxLength={6}
          onChange={(event) => {
            setPin(event.target.value.replace(/\D/g, "").slice(0, 6));
            setMessage(null);
          }}
          pattern="[0-9]{6}"
          required
          type="password"
          value={pin}
        />
      </Label>
      <Label>
        Confirme o novo PIN
        <Input
          autoComplete="new-password"
          disabled={busy}
          inputMode="numeric"
          maxLength={6}
          onChange={(event) => {
            setPinConfirmation(event.target.value.replace(/\D/g, "").slice(0, 6));
            setMessage(null);
          }}
          pattern="[0-9]{6}"
          required
          type="password"
          value={pinConfirmation}
        />
      </Label>
      {/^\d{6}$/.test(pinConfirmation) && pinConfirmation !== pin && (
        <p className="auth-message auth-message--error" role="alert">
          Os PINs digitados não coincidem.
        </p>
      )}
      {message && (
        <p
          className={`auth-message${message.error ? " auth-message--error" : ""}`}
          role={message.error ? "alert" : "status"}
        >
          {message.text}
        </p>
      )}
      <Button
        disabled={busy || !currentPassword || !/^\d{6}$/.test(pin) || pinConfirmation !== pin}
        type="submit"
      >
        {busy ? "Salvando..." : "Salvar meu PIN"}
      </Button>
    </form>
  );
}
