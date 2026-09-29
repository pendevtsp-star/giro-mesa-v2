import { Button, Icon, Input, Label, Modal } from "@giromesa/ui";
import { useState } from "react";
import { formatMoney } from "../../rules";

export function amountPerPerson(balanceCents: number, people: number) {
  if (
    !Number.isSafeInteger(balanceCents) ||
    balanceCents < 1 ||
    !Number.isSafeInteger(people) ||
    people < 1 ||
    people > balanceCents
  )
    return null;
  return {
    cents: Math.floor(balanceCents / people),
    extraPeople: balanceCents % people,
  };
}

export function AccountSplitModal({
  onClose,
  balanceCents,
}: {
  onClose: () => void;
  balanceCents: number;
}) {
  const [people, setPeople] = useState("2");
  const count = Number(people);
  const result = amountPerPerson(balanceCents, count);

  return (
    <Modal isOpen onClose={onClose} title="Quanto por pessoa?" size="sm">
      <div className="per-person-calculator">
        <div className="per-person-calculator__basis">
          <span>Saldo da conta</span>
          <strong>{formatMoney(balanceCents)}</strong>
        </div>
        <Label>
          Quantas pessoas?
          <Input
            type="number"
            inputMode="numeric"
            min={1}
            max={balanceCents}
            step={1}
            value={people}
            onChange={(event) => setPeople(event.target.value)}
            onFocus={(event) => event.currentTarget.select()}
          />
        </Label>
        <div
          className="per-person-calculator__result"
          role="status"
          aria-live="polite"
          aria-atomic="true"
        >
          <Icon name="people" aria-hidden="true" />
          {result ? (
            <>
              <span>{result.extraPeople ? "A partir de" : "Cada pessoa paga"}</span>
              <strong className="per-person-calculator__amount">{formatMoney(result.cents)}</strong>
              <span>
                {count} {count === 1 ? "pessoa" : "pessoas"}
              </span>
              {result.extraPeople > 0 && (
                <small>
                  {count - result.extraPeople}{" "}
                  {count - result.extraPeople === 1 ? "pessoa paga" : "pessoas pagam"}{" "}
                  {formatMoney(result.cents)} e {result.extraPeople}{" "}
                  {result.extraPeople === 1 ? "pessoa paga" : "pessoas pagam"}{" "}
                  {formatMoney(result.cents + 1)}.
                </small>
              )}
            </>
          ) : (
            <span>Informe uma quantidade válida de pessoas.</span>
          )}
        </div>
        <p className="per-person-calculator__notice">
          Só uma consulta. Cada pessoa pode pagar outro valor ou usar formas de pagamento
          diferentes.
        </p>
        <Button type="button" onClick={onClose}>
          Fechar consulta
        </Button>
      </div>
    </Modal>
  );
}
