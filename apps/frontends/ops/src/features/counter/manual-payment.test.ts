import { describe, expect, it } from "vitest";
import { formatMoney } from "../../rules";
import { manualPaymentSuccessMessage, manualPaymentValues } from "./manual-payment";

describe("confirmação do pagamento manual", () => {
  it("recebe 20 em dinheiro e 30 no Pix sem exigir divisão", () => {
    const cash = manualPaymentValues("cash", 2000, 5000);
    expect(cash).toEqual({ valid: true, amountCents: 2000, changeCents: 0, remainingCents: 3000 });
    expect(manualPaymentValues("pix", 3000, cash.remainingCents)).toEqual({
      valid: true,
      amountCents: 3000,
      changeCents: 0,
      remainingCents: 0,
    });
  });
  it("limita o pagamento ao saldo e calcula automaticamente o troco em dinheiro", () => {
    expect(manualPaymentValues("cash", 7000, 5000)).toEqual({
      valid: true,
      amountCents: 5000,
      changeCents: 2000,
      remainingCents: 0,
    });
    expect(manualPaymentValues("cash", 5000, 5000)).toEqual({
      valid: true,
      amountCents: 5000,
      changeCents: 0,
      remainingCents: 0,
    });
    expect(manualPaymentValues("cash", 30000, 28740)).toEqual({
      valid: true,
      amountCents: 28740,
      changeCents: 1260,
      remainingCents: 0,
    });
    for (const method of ["pix", "credit_card", "debit_card", "other"] as const) {
      expect(manualPaymentValues(method, 7000, 5000).valid).toBe(false);
    }
  });
  it("rejeita valores vazios, inválidos e acima do saldo livre", () => {
    for (const amount of [
      null,
      0,
      -1,
      100.5,
      Number.NaN,
      Number.POSITIVE_INFINITY,
      Number.MAX_SAFE_INTEGER + 1,
    ]) {
      expect(manualPaymentValues("cash", amount, 5000).valid).toBe(false);
    }
    for (const available of [0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(manualPaymentValues("cash", 2000, available).valid).toBe(false);
    }
  });
  it("distingue quitação, parcela e troco", () => {
    expect(manualPaymentSuccessMessage("pix", 1_445, 1_445, 0)).toBe("Pagamento concluído.");
    expect(manualPaymentSuccessMessage("credit_card", 1_000, 2_000, 0)).toBe(
      "Pagamento parcial registrado.",
    );
    expect(manualPaymentSuccessMessage("cash", 1_445, 1_445, 555)).toBe(
      `Pagamento registrado · troco ${formatMoney(555)}.`,
    );
  });
});
