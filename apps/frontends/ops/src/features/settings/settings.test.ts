import { describe, expect, it } from "vitest";
import { formatBrazilianPhone, hoursDayWithMode, logoFileError } from "./settings";

describe("configurações do estabelecimento", () => {
  it("cria um período editável ao trocar o modo do dia", () => {
    expect(hoursDayWithMode({ weekday: 1, mode: "closed" }, "periods")).toEqual({
      weekday: 1,
      mode: "periods",
      periods: [{ start: "09:00", end: "18:00", endsNextDay: false }],
    });
  });

  it("protege o upload da logo por formato e tamanho", () => {
    expect(logoFileError({ size: 2_000_000, type: "image/webp" })).toBeNull();
    expect(logoFileError({ size: 100, type: "image/svg+xml" })).toContain("JPG");
    expect(logoFileError({ size: 2 * 1024 * 1024 + 1, type: "image/png" })).toContain("2 MB");
  });

  it("formata telefone celular e fixo no padrÃ£o brasileiro", () => {
    expect(formatBrazilianPhone("82999999999")).toBe("(82) 99999-9999");
    expect(formatBrazilianPhone("+55 (82) 3333-4444")).toBe("(82) 3333-4444");
  });
});
