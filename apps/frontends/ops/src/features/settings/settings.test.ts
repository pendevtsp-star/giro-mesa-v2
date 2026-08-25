import { describe, expect, it } from "vitest";
import {
  applyHoursTemplate,
  coverFileError,
  formatBrazilianPhone,
  formatPostalCode,
  hoursDayWithMode,
  logoFileError,
  normalizeInstagram,
  readableForeground,
  sortBusinessHoursExceptions,
} from "./settings";

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
    expect(coverFileError({ size: 2_000_000, type: "image/jpeg" })).toBeNull();
    expect(coverFileError({ size: 100, type: "image/svg+xml" })).toContain("JPG");
  });

  it("formata telefone celular e fixo no padrão brasileiro", () => {
    expect(formatBrazilianPhone("82999999999")).toBe("(82) 99999-9999");
    expect(formatBrazilianPhone("+55 (82) 3333-4444")).toBe("(82) 3333-4444");
  });

  it("normaliza contatos e escolhe contraste legível sem dependências externas", () => {
    expect(formatPostalCode("57000-000")).toBe("57000-000");
    expect(normalizeInstagram("https://instagram.com/@casa/ ")).toBe("casa");
    expect(normalizeInstagram("  ")).toBeNull();
    expect(readableForeground("#ffffff")).toBe("#000000");
    expect(readableForeground("#000000")).toBe("#ffffff");
  });

  it("replica o modelo semanal e ordena exceções antes de salvar", () => {
    const hours = {
      weekly: Array.from({ length: 7 }, (_, index) =>
        index === 0
          ? {
              weekday: 1,
              mode: "periods" as const,
              periods: [{ start: "18:00", end: "02:00", endsNextDay: true }],
            }
          : { weekday: index + 1, mode: "closed" as const },
      ),
      exceptions: [
        { date: "2027-12-31", mode: "closed" as const },
        { date: "2027-01-01", label: "Ano-novo", mode: "open24h" as const },
      ],
    };
    const applied = applyHoursTemplate(hours, 1, [1, 2, 3, 4, 5]);
    expect(applied.weekly[1]).toEqual({ ...applied.weekly[0], weekday: 2 });
    expect(sortBusinessHoursExceptions(applied).exceptions.map((item) => item.date)).toEqual([
      "2027-01-01",
      "2027-12-31",
    ]);
  });
});
