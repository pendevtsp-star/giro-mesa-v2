import type { ReportFamilyId } from "./ReportFamilyNavigation";

export type ReportViewMode = "simple" | "analytical" | "managerial";
export type ReportBreakdownOrder =
  | "revenue_desc"
  | "revenue_asc"
  | "quantity_desc"
  | "quantity_asc"
  | "label_asc"
  | "label_desc";

export type ReportAnalysisId =
  | "overview-managerial"
  | "overview-cash"
  | "overview-income"
  | "overview-sales"
  | "sales-simple"
  | "sales-managerial"
  | "sales-hourly"
  | "sales-trend"
  | "sales-products"
  | "sales-categories"
  | "sales-channels"
  | "sales-payments"
  | "exceptions-audit"
  | "inventory-analysis"
  | "purchasing-analysis"
  | "operations-analysis"
  | "profitability-analysis"
  | "multiunit-analysis"
  | "quality-analysis"
  | "labor-analysis"
  | "reconciliation-analysis"
  | "forecast-analysis";

export interface ReportAnalysis {
  id: ReportAnalysisId;
  family: ReportFamilyId;
  label: string;
  description: string;
  mode: ReportViewMode;
}

export const reportAnalyses: ReportAnalysis[] = [
  {
    id: "overview-managerial",
    family: "overview",
    label: "Visão gerencial",
    description: "Indicadores, caixa, vendas e resultado em uma leitura completa.",
    mode: "managerial",
  },
  {
    id: "overview-cash",
    family: "overview",
    label: "Fluxo de caixa",
    description: "Entradas, saídas e saldo realizado.",
    mode: "analytical",
  },
  {
    id: "overview-income",
    family: "overview",
    label: "DRE gerencial",
    description: "Receita, custos, despesas e resultado por competência.",
    mode: "analytical",
  },
  {
    id: "overview-sales",
    family: "overview",
    label: "Composição das vendas",
    description: "Produtos, categorias, canais e pagamentos.",
    mode: "analytical",
  },
  {
    id: "sales-simple",
    family: "sales",
    label: "Venda simples",
    description: "Total, contas, ticket médio, clientes e descontos.",
    mode: "simple",
  },
  {
    id: "sales-managerial",
    family: "sales",
    label: "Vendas gerenciais",
    description: "Resumo, comparação, tendência e composição.",
    mode: "managerial",
  },
  {
    id: "sales-hourly",
    family: "sales",
    label: "Vendas por horário",
    description: "Contas e receita por hora de fechamento.",
    mode: "analytical",
  },
  {
    id: "sales-trend",
    family: "sales",
    label: "Evolução diária",
    description: "Receita diária comparada ao período de referência.",
    mode: "analytical",
  },
  {
    id: "sales-products",
    family: "sales",
    label: "Vendas por produto",
    description: "Quantidade, receita e participação por produto.",
    mode: "analytical",
  },
  {
    id: "sales-categories",
    family: "sales",
    label: "Vendas por categoria",
    description: "Quantidade, receita e participação por categoria.",
    mode: "analytical",
  },
  {
    id: "sales-channels",
    family: "sales",
    label: "Vendas por canal",
    description: "Salão, balcão, delivery e demais canais registrados.",
    mode: "analytical",
  },
  {
    id: "sales-payments",
    family: "sales",
    label: "Vendas por pagamento",
    description: "Receita e quantidade por forma de pagamento.",
    mode: "analytical",
  },
  {
    id: "exceptions-audit",
    family: "exceptions",
    label: "Descontos e cancelamentos",
    description: "Ocorrências, valores e motivos registrados.",
    mode: "analytical",
  },
  {
    id: "inventory-analysis",
    family: "inventory",
    label: "Estoque e curva ABC",
    description: "Perdas, rupturas, valor e cobertura atual.",
    mode: "managerial",
  },
  {
    id: "purchasing-analysis",
    family: "purchasing",
    label: "Compras e fornecedores",
    description: "Pedidos, recebimentos, prazos e variações.",
    mode: "managerial",
  },
  {
    id: "operations-analysis",
    family: "operations",
    label: "Operação e turnos",
    description: "Giro, atendimento e desempenho por turno.",
    mode: "managerial",
  },
  {
    id: "profitability-analysis",
    family: "profitability",
    label: "Rentabilidade",
    description: "Margem e resultado somente com custos completos.",
    mode: "managerial",
  },
  {
    id: "multiunit-analysis",
    family: "multiunit",
    label: "Comparação entre unidades",
    description: "Indicadores consolidados e por unidade.",
    mode: "managerial",
  },
  {
    id: "quality-analysis",
    family: "quality",
    label: "Qualidade dos dados",
    description: "Cobertura e pendências dos indicadores.",
    mode: "analytical",
  },
  {
    id: "labor-analysis",
    family: "labor",
    label: "Mão de obra",
    description: "Jornada, escala e custo de equipe disponível.",
    mode: "managerial",
  },
  {
    id: "reconciliation-analysis",
    family: "reconciliation",
    label: "Fiscal e pagamentos",
    description: "Conciliação de vendas, pagamentos e documentos fiscais.",
    mode: "managerial",
  },
  {
    id: "forecast-analysis",
    family: "forecast",
    label: "Previsão",
    description: "Projeção baseada no histórico operacional.",
    mode: "managerial",
  },
];

export function analysesForFamily(family: ReportFamilyId): ReportAnalysis[] {
  return reportAnalyses.filter((analysis) => analysis.family === family);
}

export function defaultReportAnalysis(family: ReportFamilyId): ReportAnalysisId {
  return analysesForFamily(family)[0]?.id ?? "overview-managerial";
}

export function reportAnalysis(value: string | null, family: ReportFamilyId): ReportAnalysisId {
  return (
    analysesForFamily(family).find((analysis) => analysis.id === value)?.id ??
    defaultReportAnalysis(family)
  );
}

export function reportAnalysisLabel(id: ReportAnalysisId): string {
  return reportAnalyses.find((analysis) => analysis.id === id)?.label ?? "Relatório";
}

export function reportAnalysisMode(id: ReportAnalysisId): ReportViewMode {
  return reportAnalyses.find((analysis) => analysis.id === id)?.mode ?? "managerial";
}

export function reportAnalysisFamily(id: ReportAnalysisId): ReportFamilyId {
  return reportAnalyses.find((analysis) => analysis.id === id)?.family ?? "overview";
}

export function reportAnalysisBreakdown(id: ReportAnalysisId) {
  if (id === "sales-products") return "products" as const;
  if (id === "sales-categories") return "categories" as const;
  if (id === "sales-channels") return "channels" as const;
  if (id === "sales-payments") return "paymentMethods" as const;
  return null;
}
