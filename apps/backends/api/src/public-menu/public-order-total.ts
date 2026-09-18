import { ConflictException } from "@nestjs/common";

/** Compare inside the order transaction, after server pricing and before committing. */
export function requireConfirmedPublicTotal(
  expectedTotalCents: number | undefined,
  subtotalCents: number,
  deliveryFeeCents = 0,
) {
  const totalCents = subtotalCents + deliveryFeeCents;
  if (expectedTotalCents !== totalCents) {
    throw new ConflictException({
      code: "PUBLIC_ORDER_PRICE_CHANGED",
      message: "Os valores foram atualizados. Confira e confirme o novo total antes de enviar.",
      subtotalCents,
      deliveryFeeCents,
      totalCents,
    });
  }
}
