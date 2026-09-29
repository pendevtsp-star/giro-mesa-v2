import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import { BillPrintingSettings } from "./BillPrintingSettings";

it("encerra o carregamento da impressão quando a consulta falha", () => {
  const render = (busy: boolean, error: string | null) =>
    renderToStaticMarkup(
      <BillPrintingSettings
        busy={busy}
        error={error}
        onSave={() => undefined}
        policy={null}
        printers={[]}
      />,
    );

  expect(render(true, null)).toContain("Carregando configuração de pré-conta");
  for (const busy of [true, false]) {
    const failed = render(busy, "Falha ao consultar impressão.");
    expect(failed).toContain("Falha ao consultar impressão.");
    expect(failed).toContain("Configuração de impressão indisponível.");
    expect(failed).not.toContain("Carregando configuração");
  }
});
