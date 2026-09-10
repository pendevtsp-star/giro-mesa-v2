import { Button, Callout, Input, Label, NativeSelect } from "@giromesa/ui";
import { useState } from "react";
import type { PosItem, RelatedServiceTab } from "../../operations.shared";
import { formatMoney } from "../../rules";

export function splitConsumptionPreview(items: PosItem[], quantities: Record<string, number>) {
  return items.reduce(
    (result, item) => {
      const quantity = quantities[item.id] ?? 0;
      if (!Number.isInteger(quantity) || quantity < 0 || quantity > item.quantity) {
        result.valid = false;
        return result;
      }
      const moved =
        Math.floor((item.grossCents * quantity) / item.quantity) -
        Math.floor((item.discountCents * quantity) / item.quantity);
      return {
        valid: result.valid,
        quantity: result.quantity + quantity,
        movedCents: result.movedCents + moved,
        remainingCents: result.remainingCents + item.netCents - moved,
      };
    },
    { valid: true, quantity: 0, movedCents: 0, remainingCents: 0 },
  );
}

export function SplitConsumptionPanel({
  items,
  accounts,
  currentId,
  busy,
  disabledReason,
  onConfirm,
  onClose,
}: {
  items: PosItem[];
  accounts: RelatedServiceTab[];
  currentId: string;
  busy: boolean;
  disabledReason?: string;
  onConfirm: (input: {
    label?: string;
    targetTabId?: string;
    items: Array<{ orderItemId: string; quantity: number }>;
  }) => Promise<boolean>;
  onClose: () => void;
}) {
  const [quantities, setQuantities] = useState<Record<string, number>>({});
  const [targetId, setTargetId] = useState("");
  const [label, setLabel] = useState("");
  const preview = splitConsumptionPreview(items, quantities);
  const selected = items.flatMap((item) => {
    const quantity = quantities[item.id] ?? 0;
    return quantity > 0 ? [{ orderItemId: item.id, quantity }] : [];
  });
  const targets = accounts.filter(
    (account) =>
      account.id !== currentId &&
      account.status === "open" &&
      account.paidCents === 0 &&
      account.reservedCents === 0 &&
      account.coveredLossCents === 0,
  );
  return (
    <form
      className="split-consumption"
      aria-label="Separar consumo"
      onSubmit={async (event) => {
        event.preventDefault();
        if (!preview.valid || !selected.length || busy || disabledReason) return;
        const confirmed = await onConfirm({
          ...(targetId
            ? { targetTabId: targetId }
            : { label: label.trim() || `Comanda ${accounts.length + 1}` }),
          items: selected,
        });
        if (confirmed) onClose();
      }}
    >
      <header>
        <div>
          <strong>Separar consumo</strong>
          <small>Escolha quanto vai para a outra comanda.</small>
        </div>
        <Button disabled={busy} onClick={onClose} size="sm" type="button" variant="ghost">
          Cancelar
        </Button>
      </header>
      {disabledReason && <Callout tone="warning">{disabledReason}</Callout>}
      <fieldset disabled={busy || Boolean(disabledReason)}>
        <legend className="gm-sr-only">Quantidades a separar</legend>
        {items.map((item) => (
          <Label className="split-consumption__item" key={item.id}>
            <span>
              <strong>{item.productName}</strong>
              <small>
                {item.quantity} na comanda · {formatMoney(item.netCents)}
              </small>
            </span>
            <Input
              aria-label={`Quantidade de ${item.productName} a separar`}
              inputMode="numeric"
              min={0}
              max={item.quantity}
              step={1}
              type="number"
              value={quantities[item.id] ?? 0}
              onChange={(event) =>
                setQuantities((current) => ({ ...current, [item.id]: Number(event.target.value) }))
              }
            />
          </Label>
        ))}
        <Label>
          Destino
          <NativeSelect value={targetId} onChange={(event) => setTargetId(event.target.value)}>
            <option value="">Nova comanda neste atendimento</option>
            {targets.map((account) => (
              <option value={account.id} key={account.id}>
                {account.label ?? "Principal"}
              </option>
            ))}
          </NativeSelect>
        </Label>
        {!targetId && (
          <Label>
            Nome da nova comanda
            <Input
              autoComplete="off"
              maxLength={120}
              placeholder="Ex.: João"
              value={label}
              onChange={(event) => setLabel(event.target.value)}
            />
          </Label>
        )}
      </fieldset>
      <div className="split-consumption__preview" aria-live="polite">
        <span>
          Consumo que permanece <strong>{formatMoney(preview.remainingCents)}</strong>
        </span>
        <span>
          Consumo a separar <strong>{formatMoney(preview.movedCents)}</strong>
        </span>
        <small>
          Valores dos itens com descontos. Serviço e gorjeta serão conferidos nas contas
          atualizadas.
        </small>
      </div>
      <Button
        disabled={busy || Boolean(disabledReason) || !preview.valid || !selected.length}
        type="submit"
      >
        {busy ? "Separando…" : `Confirmar separação de ${preview.quantity} item(ns)`}
      </Button>
    </form>
  );
}
