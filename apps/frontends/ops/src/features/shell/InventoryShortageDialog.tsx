import { Button, Modal } from "@giromesa/ui";
import { useEffect, useRef, useState } from "react";
import {
  type InventoryShortageConfirmation,
  registerInventoryShortageConfirmation,
} from "../../inventory-shortage-confirmation";

interface PendingConfirmation extends InventoryShortageConfirmation {
  resolve: (confirmed: boolean) => void;
}

export function InventoryShortageDialog({
  organizationId,
  unitId,
}: {
  organizationId: string;
  unitId: string;
}) {
  const [pending, setPending] = useState<PendingConfirmation | null>(null);
  const current = useRef<PendingConfirmation | null>(null);

  useEffect(() => {
    const unregister = registerInventoryShortageConfirmation((request) => {
      if (
        request.organizationId !== organizationId ||
        request.unitId !== unitId ||
        current.current
      ) {
        return Promise.resolve(false);
      }
      return new Promise<boolean>((resolve) => {
        current.current = { ...request, resolve };
        setPending(current.current);
      });
    });
    return () => {
      unregister();
      current.current?.resolve(false);
      current.current = null;
    };
  }, [organizationId, unitId]);

  function finish(confirmed: boolean) {
    current.current?.resolve(confirmed);
    current.current = null;
    setPending(null);
  }

  return (
    <Modal
      isOpen={pending !== null}
      onClose={() => finish(false)}
      size="sm"
      title="Conferir estoque"
    >
      <div className="gm-form-stack">
        <p>O estoque registrado não cobre este pedido. Ele pode estar desatualizado.</p>
        {pending && pending.products.length > 0 && (
          <ul>
            {pending.products.map((name) => (
              <li key={name}>{name}</li>
            ))}
          </ul>
        )}
        <p>
          Confirme a disponibilidade no local. Ao lançar mesmo assim, a divergência ficará
          registrada para conferência do responsável.
        </p>
        <div className="gm-toolbar">
          <Button onClick={() => finish(false)} variant="secondary">
            Voltar ao pedido
          </Button>
          <Button onClick={() => finish(true)}>Lançar mesmo assim</Button>
        </div>
      </div>
    </Modal>
  );
}
