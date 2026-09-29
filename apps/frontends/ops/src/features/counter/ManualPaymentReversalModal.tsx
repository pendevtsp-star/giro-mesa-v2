import { Button, Callout, Label, Modal, Textarea } from "@giromesa/ui";
import { useRef, useState } from "react";
import type { PilotScope } from "../../operations.shared";
import { formatMoney } from "../../rules";
import { paymentMethodLabel } from "../cash/cash";
import { posPayments } from "./pos-payments";

export function ManualPaymentReversalModal({
  scope,
  payment,
  onClose,
  onSaved,
  onBusy,
}: {
  scope: PilotScope;
  payment: { id: string; method: string; netAmountCents: number };
  onClose: () => void;
  onSaved: () => void;
  onBusy?: (busy: boolean) => void;
}) {
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const inFlight = useRef(false);
  const requestKeys = useRef(new Map<string, string>());
  const validReason = reason.trim().length >= 3 && reason.trim().length <= 500;
  const validAmount = Number.isSafeInteger(payment.netAmountCents) && payment.netAmountCents > 0;

  return (
    <Modal isOpen onClose={onClose} closeDisabled={busy} title="Corrigir pagamento" size="sm">
      <form
        className="gm-form-stack account-dialog-form"
        onSubmit={(event) => {
          event.preventDefault();
          if (inFlight.current || !validReason || !validAmount) return;
          inFlight.current = true;
          setBusy(true);
          onBusy?.(true);
          setError("");
          const trimmedReason = reason.trim();
          const requestIdentity = `${payment.id}:${trimmedReason}`;
          let key = requestKeys.current.get(requestIdentity);
          if (!key) {
            key = crypto.randomUUID();
            requestKeys.current.set(requestIdentity, key);
          }
          void posPayments
            .manualReversal(
              scope.organizationId,
              scope.unitId,
              payment.id,
              { reason: trimmedReason },
              key,
            )
            .then(() => onSaved())
            .catch((cause: unknown) =>
              setError(
                cause instanceof Error ? cause.message : "Não foi possível corrigir o pagamento.",
              ),
            )
            .finally(() => {
              inFlight.current = false;
              setBusy(false);
              onBusy?.(false);
            });
        }}
      >
        <p>
          {paymentMethodLabel(payment.method)} ·{" "}
          <strong>{formatMoney(payment.netAmountCents)}</strong>
        </p>
        <Callout tone="warning">
          Corrige o registro e libera o saldo para receber novamente. Não devolve dinheiro por Pix
          ou cartão externo; qualquer devolução deve ser feita separadamente.
        </Callout>
        <Label>
          Motivo da correção
          <Textarea
            required
            minLength={3}
            maxLength={500}
            rows={3}
            value={reason}
            disabled={busy}
            onChange={(event) => setReason(event.target.value)}
            placeholder="Ex.: pagamento confirmado por engano"
          />
        </Label>
        {error && <p role="alert">{error}</p>}
        <Button type="submit" disabled={busy || !validReason || !validAmount}>
          {busy ? "Corrigindo…" : "Confirmar correção"}
        </Button>
      </form>
    </Modal>
  );
}
