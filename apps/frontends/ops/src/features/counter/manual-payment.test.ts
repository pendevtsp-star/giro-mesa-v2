import { describe, expect, it } from "vitest";
import { formatMoney } from "../../rules";
import { manualPaymentSuccessMessage } from "./manual-payment";

describe("confirmação do pagamento manual", () => {
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
