import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ReportFamilyNavigation, reportFamily } from "./ReportFamilyNavigation";
import { reportAnalysis } from "./report-analysis";

describe("navegação das famílias de relatórios", () => {
  it("agrupa as análises e mantém a seleção acessível", () => {
    const html = renderToStaticMarkup(
      <ReportFamilyNavigation
        active="sales"
        activeAnalysis="sales-simple"
        onAnalysisChange={() => undefined}
        onChange={() => undefined}
        storageKey="test"
      />,
    );

    expect(html).toContain('<optgroup label="Financeiro">');
    expect(html).toContain('<optgroup label="Vendas">');
    expect(html).toContain('<optgroup label="Operação">');
    expect(html).toContain('<optgroup label="Gestão">');
    expect(html).toContain('<option value="sales" selected="">Vendas</option>');
    expect(html).toContain('<option value="sales-simple" selected="">Venda simples</option>');
    expect(html).toContain('aria-label="Escolher modelo do relatório"');
    expect(html).toContain('type="search"');
    expect(html).toContain("reports-family-navigation grid");
  });

  it("usa a visão geral quando a URL informa uma família desconhecida", () => {
    expect(reportFamily("unknown")).toBe("overview");
    expect(reportFamily("profitability")).toBe("profitability");
  });

  it("mantém a análise dentro da família selecionada", () => {
    expect(reportAnalysis("sales-products", "sales")).toBe("sales-products");
    expect(reportAnalysis("sales-products", "inventory")).toBe("inventory-analysis");
  });
});
