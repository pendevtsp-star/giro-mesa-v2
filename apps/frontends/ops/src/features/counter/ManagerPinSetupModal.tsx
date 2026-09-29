import { Button, Input, Label, Modal } from "@giromesa/ui";
import { type FormEvent, useState } from "react";
import { api } from "../../api";
import type { PilotScope } from "../../operations.shared";

export function ManagerPinSetupModal({
  scope,
  onClose,
  onSaved,
}: {
  scope: Pick<PilotScope, "organizationId" | "unitId">;
  onClose: () => void;
  onSaved?: () => void;
}) {
  const [pin, setPin] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  function close(force = false) {
    if (busy && !force) return;
    setPin("");
    setConfirmation("");
    setError("");
    onClose();
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || !/^\d{4,8}$/.test(pin) || confirmation !== pin) return;
    setBusy(true);
    setError("");
    try {
      // The API derives and authorizes the membership from the authenticated identity.
      await api.pilot.setManagerPin(scope.organizationId, scope.unitId, pin);
      onSaved?.();
      close(true);
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Não foi possível salvar o código gerencial.",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      closeDisabled={busy}
      isOpen
      onClose={() => close()}
      size="sm"
      title="Cadastrar código gerencial"
    >
      <form className="gm-form-stack account-dialog-form" onSubmit={save}>
        <p>
          Código pessoal de 4 a 8 dígitos para autorizar ajustes e reaberturas. Não altera o PIN de
          terminal. Salvar substitui seu código gerencial anterior.
        </p>
        <Label>
          Novo código gerencial
          <Input
            autoComplete="new-password"
            disabled={busy}
            inputMode="numeric"
            maxLength={8}
            minLength={4}
            onChange={(event) => setPin(event.target.value.replace(/\D/g, "").slice(0, 8))}
            pattern="[0-9]{4,8}"
            required
            type="password"
            value={pin}
          />
        </Label>
        <Label>
          Confirme o código gerencial
          <Input
            autoComplete="new-password"
            disabled={busy}
            inputMode="numeric"
            maxLength={8}
            minLength={4}
            onChange={(event) => setConfirmation(event.target.value.replace(/\D/g, "").slice(0, 8))}
            pattern="[0-9]{4,8}"
            required
            type="password"
            value={confirmation}
          />
        </Label>
        {confirmation && confirmation !== pin && (
          <p className="auth-message auth-message--error" role="alert">
            Os códigos digitados não coincidem.
          </p>
        )}
        {error && (
          <p className="auth-message auth-message--error" role="alert">
            {error}
          </p>
        )}
        <div className="dialog-actions">
          <Button disabled={busy} onClick={() => close()} type="button" variant="ghost">
            Cancelar
          </Button>
          <Button disabled={busy || !/^\d{4,8}$/.test(pin) || confirmation !== pin} type="submit">
            {busy ? "Salvando…" : "Salvar código"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
