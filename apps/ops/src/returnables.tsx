import { Badge, Card, EmptyState } from "@giromesa/ui";

export interface ReturnableMovementView {
  movementId: string;
  movementType: string;
  quantity: number;
  fromCustodyType: string | null;
  fromCustodyId: string | null;
  toCustodyType: string | null;
  toCustodyId: string | null;
  occurredAt: string;
}

export class InvalidReturnablesPayloadError extends Error {}

export function parseReturnableLedger(value: unknown): ReturnableMovementView[] {
  if (!Array.isArray(value))
    throw new InvalidReturnablesPayloadError("Ledger de retornáveis inválido.");
  return value.map((entry) => {
    if (!entry || typeof entry !== "object")
      throw new InvalidReturnablesPayloadError("Movimento de retornável inválido.");
    const row = entry as Record<string, unknown>;
    if (
      typeof row.movementId !== "string" ||
      typeof row.movementType !== "string" ||
      !Number.isSafeInteger(row.quantity) ||
      typeof row.occurredAt !== "string"
    )
      throw new InvalidReturnablesPayloadError("Movimento de retornável incompleto.");
    const optional = (field: string) => {
      const current = row[field];
      if (current !== null && typeof current !== "string")
        throw new InvalidReturnablesPayloadError(`Custódia ${field} inválida.`);
      return current as string | null;
    };
    return {
      movementId: row.movementId,
      movementType: row.movementType,
      quantity: row.quantity as number,
      fromCustodyType: optional("fromCustodyType"),
      fromCustodyId: optional("fromCustodyId"),
      toCustodyType: optional("toCustodyType"),
      toCustodyId: optional("toCustodyId"),
      occurredAt: row.occurredAt,
    };
  });
}

export function ReturnablesLedger({ movements }: { movements: ReturnableMovementView[] }) {
  if (movements.length === 0)
    return (
      <EmptyState
        title="Sem movimentos"
        description="Nenhuma custódia registrada para este ativo."
        icon="-"
      />
    );
  return (
    <Card>
      <h2>Custódia de retornáveis</h2>
      <ol aria-label="Trilha de custódia">
        {movements.map((movement) => (
          <li key={movement.movementId}>
            <Badge>{movement.movementType}</Badge> <strong>{movement.quantity}</strong> —{" "}
            {movement.fromCustodyType}:{movement.fromCustodyId} → {movement.toCustodyType}:
            {movement.toCustodyId}
          </li>
        ))}
      </ol>
    </Card>
  );
}
