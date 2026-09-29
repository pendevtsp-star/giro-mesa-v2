import { Button, Input, Label, Modal } from "@giromesa/ui";
import { useRef, useState } from "react";
import { api } from "../../api";
import { type PilotScope, type PosTab, record, text } from "../../operations.shared";

export function CounterCustomerSave({
  scope,
  tab,
  disabled,
  onSaved,
  onBusy,
  isOpen,
  onClose,
}: {
  scope: PilotScope;
  tab: PosTab;
  disabled: boolean;
  onSaved: () => void;
  onBusy: (busy: boolean) => void;
  isOpen: boolean;
  onClose: () => void;
}) {
  const [name, setName] = useState(tab.customerName ?? "");
  const [phone, setPhone] = useState(tab.customerPhone ?? "");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const savedId = useRef<string | null>(null);
  const requestKey = useRef(crypto.randomUUID());
  if (tab.customerId) return null;
  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Cadastrar cliente" size="sm">
      <form
        className="gm-form-grid"
        onSubmit={(event) => {
          event.preventDefault();
          if (busy || disabled) return;
          setBusy(true);
          onBusy(true);
          setMessage("");
          void (async () => {
            if (!savedId.current) {
              const result = record(
                await api.growth.createOperationalCustomer(scope.organizationId, scope.unitId, {
                  name: name.trim(),
                  phone: phone.trim() || undefined,
                  defaultDeliveryAddress: tab.deliveryAddressDetails ?? undefined,
                  idempotencyKey: requestKey.current,
                }),
              );
              savedId.current = text(record(result.customer).id);
            }
            await api.pilot.updateTab(scope.organizationId, scope.unitId, tab.id, {
              expectedVersion: tab.version,
              customerId: savedId.current,
              customerName: name.trim(),
              customerPhone: phone.trim() || null,
            });
            onSaved();
          })()
            .catch((error: unknown) =>
              setMessage(
                error instanceof Error ? error.message : "Não foi possível cadastrar o cliente.",
              ),
            )
            .finally(() => {
              setBusy(false);
              onBusy(false);
            });
        }}
      >
        <Label>
          Nome
          <Input
            required
            minLength={2}
            maxLength={180}
            value={name}
            disabled={busy || Boolean(savedId.current)}
            onChange={(event) => setName(event.target.value)}
          />
        </Label>
        <Label>
          Telefone
          <Input
            type="tel"
            maxLength={30}
            value={phone}
            disabled={busy || Boolean(savedId.current)}
            onChange={(event) => setPhone(event.target.value)}
          />
        </Label>
        <Button type="submit" size="sm" variant="secondary" disabled={disabled || busy}>
          {busy ? "Salvando…" : "Cadastrar e vincular ao pedido"}
        </Button>
        {message && <p role="alert">{message}</p>}
      </form>
    </Modal>
  );
}
