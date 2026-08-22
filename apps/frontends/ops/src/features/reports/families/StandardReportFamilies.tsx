// biome-ignore-all lint/a11y/noLabelWithoutControl: shadcn-compatible controls render native form elements nested by these labels
import { Button, Callout, Card, DataTable, EmptyState, SegmentedTabs } from "@giromesa/ui";
import { useState } from "react";
import {
  dateLabel,
  type ManagementScope,
  type ReportData,
  type ReportDrillDownDimension,
} from "../../../management.shared";
import { routeHref } from "../../../router";
import { formatMoney } from "../../../rules";
import { EnhancedReportFamilyView } from "../ReportEnhancements";
import { ManagementReportFamilyView } from "./ManagementReportFamilies";
import type { ReportFamilyId } from "./ReportFamilyNavigation";
import {
  type ReportAnalysisId,
  type ReportBreakdownOrder,
  reportAnalysisBreakdown,
} from "./report-analysis";

type BreakdownId = "products" | "categories" | "channels" | "paymentMethods";

export const breakdownTabs: Array<{ id: BreakdownId; label: string }> = [
  { id: "products", label: "Produtos" },
  { id: "categories", label: "Categorias" },
  { id: "channels", label: "Canais" },
  { id: "paymentMethods", label: "Pagamentos" },
];

export interface DrillDownTarget {
  dimension: ReportDrillDownDimension;
  key: string;
  title: string;
}

function moneyOrUnavailable(value: number | null): string {
  return value === null ? "Indisponível" : formatMoney(value);
}

function comparisonLabel(data: ReportData): string {
  const change = data.comparison?.changePercent;
  if (change === null || change === undefined) return "Sem base anterior comparável";
  const value = new Intl.NumberFormat("pt-BR", {
    maximumFractionDigits: 1,
    minimumFractionDigits: 1,
    signDisplay: "exceptZero",
  }).format(change);
  const baseline = data.comparison?.mode === "previous_year" ? "ano anterior" : "período anterior";
  return `${value}% vs. ${baseline}`;
}

function FamilyMetric({
  label,
  note,
  tone,
  value,
}: {
  label: string;
  note: string;
  tone?: "positive" | "negative";
  value: string;
}) {
  return (
    <Card className="metric-card">
      <p>{label}</p>
      <strong className={tone}>{value}</strong>
      <small>{note}</small>
    </Card>
  );
}

const familyMetricLabels: Record<string, string> = {
  revenueCents: "Receita",
  closedTabs: "Contas fechadas",
  averageTicketCents: "Ticket médio",
  canceledValueCents: "Valor cancelado",
  discountCents: "Descontos",
  lossQuantity: "Quantidade perdida",
  lossValueCents: "Valor das perdas",
  orderedCents: "Valor pedido",
  receivedCents: "Valor recebido",
  tableTurnovers: "Giros de mesa",
  averageServiceMinutes: "Tempo médio (min)",
  grossMarginCents: "Margem bruta",
};

function FamilyComparisonCard({
  comparison,
}: {
  comparison: ReportData["reportFamilies"]["sales"]["comparison"];
}) {
  const entries = Object.entries(comparison).filter(([, value]) => value.previous !== null);
  if (!entries.length) return null;
  return (
    <Card className="reports-section-card">
      <div className="reports-section-heading">
        <div>
          <p className="eyebrow">Comparação</p>
          <h2>Atual x referência</h2>
        </div>
      </div>
      <DataTable caption="Comparação dos indicadores com o período de referência">
        <thead>
          <tr>
            <th>Indicador</th>
            <th>Atual</th>
            <th>Referência</th>
            <th>Variação</th>
          </tr>
        </thead>
        <tbody>
          {entries.map(([key, value]) => {
            const currency = key.endsWith("Cents");
            const format = (amount: number | null) =>
              amount === null
                ? "Indisponível"
                : currency
                  ? formatMoney(amount)
                  : new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 1 }).format(amount);
            return (
              <tr key={key}>
                <th scope="row">{familyMetricLabels[key] ?? key}</th>
                <td>{format(value.current)}</td>
                <td>{format(value.previous)}</td>
                <td>
                  {value.changePercent === null
                    ? "Indisponível"
                    : `${new Intl.NumberFormat("pt-BR", {
                        maximumFractionDigits: 1,
                        signDisplay: "exceptZero",
                      }).format(value.changePercent)}%`}
                </td>
              </tr>
            );
          })}
        </tbody>
      </DataTable>
    </Card>
  );
}

export function ReportFamilyView({
  analysis,
  breakdownOrder = "revenue_desc",
  data,
  family,
  onDrillDown,
  onRefresh,
  scope,
}: {
  analysis?: ReportAnalysisId;
  breakdownOrder?: ReportBreakdownOrder;
  data: ReportData;
  family: Exclude<ReportFamilyId, "overview">;
  onDrillDown: (target: DrillDownTarget) => void;
  onRefresh?: () => void;
  scope?: ManagementScope;
}) {
  const report = data.reportFamilies;
  const number = (value: number) =>
    new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 3 }).format(value);

  if (family === "multiunit" || family === "quality") {
    return <ManagementReportFamilyView data={data} family={family} />;
  }

  if (family === "labor" || family === "reconciliation" || family === "forecast") {
    return (
      <EnhancedReportFamilyView data={data} family={family} onRefresh={onRefresh} scope={scope} />
    );
  }

  if (family === "sales") {
    const selected = analysis ?? "sales-managerial";
    const showSummary = selected === "sales-simple" || selected === "sales-managerial";
    const showHourly = selected === "sales-hourly" || selected === "sales-managerial";
    const showTrend = selected === "sales-trend" || selected === "sales-managerial";
    const breakdown = reportAnalysisBreakdown(selected);
    return (
      <div className="reports-family-view">
        <div className="reports-section-heading">
          <div>
            <p className="eyebrow">Vendas</p>
            <h2>Desempenho comercial</h2>
            <p>Contas fechadas, ticket médio e consumo por cliente no período.</p>
          </div>
        </div>
        {showSummary && (
          <div className="metrics-grid reports-metrics">
            <FamilyMetric
              label="Vendas líquidas"
              note="Total das contas, com taxas e gorjetas"
              value={formatMoney(report.sales.netRevenueCents)}
            />
            <FamilyMetric
              label="Ticket médio"
              note={`${report.sales.closedTabs} contas fechadas`}
              value={moneyOrUnavailable(report.sales.averageTicketCents)}
            />
            <FamilyMetric
              label="Consumo por cliente"
              note={`${report.sales.guests} clientes informados`}
              value={moneyOrUnavailable(report.sales.averageSpendPerGuestCents)}
            />
            <FamilyMetric
              label="Descontos"
              note="Consolidado nas contas fechadas"
              value={formatMoney(report.sales.discountsCents)}
            />
          </div>
        )}
        {showSummary && <FamilyComparisonCard comparison={report.sales.comparison} />}
        {showHourly && (
          <Card className="reports-section-card">
            <div className="reports-section-heading">
              <div>
                <p className="eyebrow">Faixa horária</p>
                <h2>Vendas por hora</h2>
              </div>
            </div>
            {report.sales.hourly.length ? (
              <DataTable caption="Contas e receita por hora de fechamento">
                <thead>
                  <tr>
                    <th>Hora</th>
                    <th>Contas</th>
                    <th>Receita</th>
                  </tr>
                </thead>
                <tbody>
                  {report.sales.hourly.map((row) => (
                    <tr key={row.hour}>
                      <th scope="row">{String(row.hour).padStart(2, "0")}:00</th>
                      <td>{number(row.closedTabs)}</td>
                      <td>{formatMoney(row.revenueCents)}</td>
                    </tr>
                  ))}
                </tbody>
              </DataTable>
            ) : (
              <EmptyState
                action={
                  scope ? (
                    <a
                      className="gm-button gm-button--secondary gm-button--sm"
                      href={routeHref("counter")}
                    >
                      Abrir atendimento
                    </a>
                  ) : undefined
                }
                description="Feche uma conta no atendimento para iniciar a leitura por faixa horária."
                icon="◷"
                title="Sem vendas por hora"
              />
            )}
          </Card>
        )}
        {showTrend && <DailyRevenueChart data={data} scope={scope} />}
        {(selected === "sales-managerial" || breakdown) && (
          <Breakdowns
            activeDimension={breakdown ?? undefined}
            data={data}
            onDrillDown={onDrillDown}
            order={breakdownOrder}
            scope={scope}
          />
        )}
      </div>
    );
  }

  if (family === "exceptions") {
    return (
      <div className="reports-family-view">
        <div className="reports-section-heading">
          <div>
            <p className="eyebrow">Exceções</p>
            <h2>Descontos e cancelamentos</h2>
            <p>Ocorrências registradas nos itens de contas fechadas.</p>
          </div>
        </div>
        <div className="metrics-grid reports-metrics">
          <FamilyMetric
            label="Itens cancelados"
            note="Quantidade retirada das contas"
            value={number(report.exceptions.canceledItems)}
          />
          <FamilyMetric
            label="Valor cancelado"
            note="Valor potencial dos itens cancelados"
            value={formatMoney(report.exceptions.canceledValueCents)}
          />
          <FamilyMetric
            label="Itens com desconto"
            note="Itens ativos que receberam desconto"
            value={number(report.exceptions.discountedItems)}
          />
          <FamilyMetric
            label="Descontos consolidados"
            note="Total refletido nas contas fechadas"
            value={formatMoney(report.exceptions.tabDiscountCents)}
          />
        </div>
        <FamilyComparisonCard comparison={report.exceptions.comparison} />
        {data.capabilities.drillDown && (
          <div className="gm-toolbar">
            <Button
              onClick={() =>
                onDrillDown({
                  dimension: "exception",
                  key: "canceled_items",
                  title: "Itens cancelados",
                })
              }
              size="sm"
              variant="secondary"
            >
              Ver cancelamentos
            </Button>
            <Button
              onClick={() =>
                onDrillDown({
                  dimension: "exception",
                  key: "discounted_items",
                  title: "Itens com desconto",
                })
              }
              size="sm"
              variant="ghost"
            >
              Ver descontos
            </Button>
          </div>
        )}
        <Card className="reports-section-card">
          <div className="reports-section-heading">
            <div>
              <p className="eyebrow">Auditoria</p>
              <h2>Motivos de cancelamento</h2>
            </div>
          </div>
          {report.exceptions.cancellationReasons.length ? (
            <DataTable caption="Cancelamentos agrupados por motivo">
              <thead>
                <tr>
                  <th scope="col">Motivo</th>
                  <th scope="col">Itens</th>
                  <th scope="col">Valor potencial</th>
                </tr>
              </thead>
              <tbody>
                {report.exceptions.cancellationReasons.map((row) => (
                  <tr key={row.label}>
                    <th scope="row">{row.label}</th>
                    <td>{number(row.quantity)}</td>
                    <td>{formatMoney(row.amountCents)}</td>
                  </tr>
                ))}
              </tbody>
            </DataTable>
          ) : (
            <EmptyState
              description="Nenhum item cancelado foi registrado no período."
              icon="✓"
              title="Sem cancelamentos"
            />
          )}
        </Card>
      </div>
    );
  }

  if (family === "inventory") {
    return (
      <div className="reports-family-view">
        <div className="reports-section-heading">
          <div>
            <p className="eyebrow">Estoque</p>
            <h2>Perdas e cobertura atual</h2>
            <p>Perdas do período e fotografia do saldo no momento da consulta.</p>
          </div>
          {scope && (
            <a
              className="gm-button gm-button--secondary gm-button--sm"
              href={routeHref("inventory")}
            >
              Abrir estoque
            </a>
          )}
        </div>
        <Callout tone="info">
          <strong>Dois recortes diferentes</strong>
          <span>
            Perdas respeitam o período; rupturas, baixo estoque e valor usam o saldo atual.
          </span>
        </Callout>
        <div className="metrics-grid reports-metrics">
          <FamilyMetric
            label="Eventos de perda"
            note={`${number(report.inventory.lossQuantity)} unidades registradas`}
            value={number(report.inventory.lossEvents)}
          />
          <FamilyMetric
            label="Itens em ruptura"
            note="Saldo atual igual ou inferior a zero"
            tone={report.inventory.stockoutItems > 0 ? "negative" : undefined}
            value={number(report.inventory.stockoutItems)}
          />
          <FamilyMetric
            label="Itens abaixo do mínimo"
            note="Saldo positivo até o estoque mínimo"
            value={number(report.inventory.lowStockItems)}
          />
          <FamilyMetric
            label="Valor do estoque"
            note="Exibido apenas com custo médio completo"
            value={moneyOrUnavailable(report.inventory.currentInventoryValueCents)}
          />
          <FamilyMetric
            label="Valor das perdas"
            note="Custo histórico das baixas por perda"
            value={moneyOrUnavailable(report.inventory.lossValueCents)}
          />
        </div>
        <FamilyComparisonCard comparison={report.inventory.comparison} />
        {data.capabilities.drillDown && (
          <div className="gm-toolbar">
            {(
              [
                ["loss", "Ver perdas"],
                ["stockout", "Ver rupturas"],
                ["low_stock", "Ver baixo estoque"],
              ] as const
            ).map(([key, label]) => (
              <Button
                key={key}
                onClick={() =>
                  onDrillDown({
                    dimension: "inventory",
                    key,
                    title: label,
                  })
                }
                size="sm"
                variant="ghost"
              >
                {label}
              </Button>
            ))}
          </div>
        )}
        <Card className="reports-section-card">
          <div className="reports-section-heading">
            <div>
              <p className="eyebrow">Curva ABC</p>
              <h2>Consumo e cobertura</h2>
              <p>Classificação pelo custo consumido e dias estimados com o saldo atual.</p>
            </div>
          </div>
          {report.inventory.analysis.length ? (
            <DataTable caption="Curva ABC e cobertura de estoque">
              <thead>
                <tr>
                  <th>Insumo</th>
                  <th>Classe</th>
                  <th>Consumo</th>
                  <th>Valor consumido</th>
                  <th>Cobertura</th>
                </tr>
              </thead>
              <tbody>
                {report.inventory.analysis.map((row) => (
                  <tr key={row.key}>
                    <th scope="row">{row.label}</th>
                    <td>{row.abcClass ?? "Indisponível"}</td>
                    <td>{number(row.consumedQuantity)}</td>
                    <td>{moneyOrUnavailable(row.consumedValueCents)}</td>
                    <td>
                      {row.coverageDays === null
                        ? "Indisponível"
                        : `${number(row.coverageDays)} dias`}
                    </td>
                  </tr>
                ))}
              </tbody>
            </DataTable>
          ) : (
            <EmptyState
              icon="◇"
              title="Sem consumo de estoque"
              description="A curva ABC aparecerá após consumos registrados no período."
            />
          )}
        </Card>
      </div>
    );
  }

  if (family === "purchasing") {
    return (
      <div className="reports-family-view">
        <div className="reports-section-heading">
          <div>
            <p className="eyebrow">Compras</p>
            <h2>Pedidos, recebimentos e fornecedores</h2>
            <p>Pedidos criados e recebimentos efetivados no período selecionado.</p>
          </div>
          {scope && (
            <a
              className="gm-button gm-button--secondary gm-button--sm"
              href={routeHref("purchases")}
            >
              Abrir compras
            </a>
          )}
        </div>
        <div className="metrics-grid reports-metrics">
          <FamilyMetric
            label="Pedidos criados"
            note={`${report.purchasing.canceledOrders} cancelados`}
            value={number(report.purchasing.orderCount)}
          />
          <FamilyMetric
            label="Valor pedido"
            note="Pedidos criados no período"
            value={moneyOrUnavailable(report.purchasing.orderedCents)}
          />
          <FamilyMetric
            label="Recebimentos"
            note="Recebimentos efetivados no período"
            value={number(report.purchasing.receiptCount)}
          />
          <FamilyMetric
            label="Valor recebido"
            note="Somente recebimentos não estornados"
            value={moneyOrUnavailable(report.purchasing.receivedCents)}
          />
        </div>
        <Card className="reports-section-card">
          <div className="reports-section-heading">
            <div>
              <p className="eyebrow">Fornecedores</p>
              <h2>Movimentação por parceiro</h2>
            </div>
          </div>
          {report.purchasing.suppliers.length ? (
            <DataTable caption="Pedidos e recebimentos por fornecedor">
              <thead>
                <tr>
                  <th scope="col">Fornecedor</th>
                  <th scope="col">Pedidos</th>
                  <th scope="col">Valor pedido</th>
                  <th scope="col">Recebimentos</th>
                  <th scope="col">Valor recebido</th>
                </tr>
              </thead>
              <tbody>
                {report.purchasing.suppliers.map((row) => (
                  <tr key={row.key}>
                    <th scope="row">{row.label}</th>
                    <td>{number(row.orderCount)}</td>
                    <td>{moneyOrUnavailable(row.orderedCents)}</td>
                    <td>{number(row.receiptCount)}</td>
                    <td>{moneyOrUnavailable(row.receivedCents)}</td>
                  </tr>
                ))}
              </tbody>
            </DataTable>
          ) : (
            <EmptyState
              action={
                scope ? (
                  <a
                    className="gm-button gm-button--secondary gm-button--sm"
                    href={routeHref("purchases")}
                  >
                    Abrir compras
                  </a>
                ) : undefined
              }
              description="Crie um pedido ou confirme um recebimento para iniciar este comparativo."
              icon="◇"
              title="Sem movimentação de compras"
            />
          )}
        </Card>
        <FamilyComparisonCard comparison={report.purchasing.comparison} />
        <Card className="reports-section-card">
          <div className="reports-section-heading">
            <div>
              <p className="eyebrow">Desempenho</p>
              <h2>Prazo e variação de preço por fornecedor</h2>
            </div>
          </div>
          {report.purchasing.supplierPerformance.length ? (
            <DataTable caption="Desempenho dos fornecedores">
              <thead>
                <tr>
                  <th>Fornecedor</th>
                  <th>Entregas no prazo</th>
                  <th>Prazo médio</th>
                  <th>Variação de preço</th>
                  <th>Detalhes</th>
                </tr>
              </thead>
              <tbody>
                {report.purchasing.supplierPerformance.map((row) => (
                  <tr key={row.key}>
                    <th scope="row">{row.label}</th>
                    <td>
                      {row.onTimeRatePercent === null
                        ? "Indisponível"
                        : `${number(row.onTimeRatePercent)}%`}
                    </td>
                    <td>
                      {row.averageLeadDays === null
                        ? "Indisponível"
                        : `${number(row.averageLeadDays)} dias`}
                    </td>
                    <td>
                      {row.priceVariancePercent === null
                        ? "Indisponível"
                        : `${number(row.priceVariancePercent)}%`}
                    </td>
                    <td>
                      {data.capabilities.drillDown && (
                        <Button
                          onClick={() =>
                            onDrillDown({
                              dimension: "purchase",
                              key: row.key,
                              title: `Compras de ${row.label}`,
                            })
                          }
                          size="sm"
                          variant="ghost"
                        >
                          Abrir
                        </Button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </DataTable>
          ) : (
            <EmptyState
              icon="◇"
              title="Sem desempenho calculável"
              description="Informe prazo esperado e registre recebimentos para comparar fornecedores."
            />
          )}
        </Card>
      </div>
    );
  }

  if (family === "operations") {
    return (
      <div className="reports-family-view">
        <div className="reports-section-heading">
          <div>
            <p className="eyebrow">Operação</p>
            <h2>Giro e atendimento das mesas</h2>
            <p>Indicadores calculados a partir das contas fechadas no período.</p>
          </div>
        </div>
        <div className="metrics-grid reports-metrics">
          <FamilyMetric
            label="Contas fechadas"
            note={`${report.operations.dineInTabs} contas de salão`}
            value={number(report.operations.closedTabs)}
          />
          <FamilyMetric
            label="Giros de mesa"
            note="Contas de salão vinculadas a uma mesa"
            value={number(report.operations.tableTurnovers)}
          />
          <FamilyMetric
            label="Clientes por conta"
            note={`${report.operations.guests} clientes informados`}
            value={
              report.operations.averageGuestsPerTab === null
                ? "Indisponível"
                : number(report.operations.averageGuestsPerTab)
            }
          />
          <FamilyMetric
            label="Tempo médio de atendimento"
            note="Da abertura ao fechamento da conta"
            value={
              report.operations.averageServiceMinutes === null
                ? "Indisponível"
                : `${number(report.operations.averageServiceMinutes)} min`
            }
          />
        </div>
        <FamilyComparisonCard comparison={report.operations.comparison} />
        {data.capabilities.drillDown && (
          <div className="gm-toolbar">
            <Button
              onClick={() =>
                onDrillDown({
                  dimension: "operation",
                  key: "closed_tabs",
                  title: "Contas fechadas",
                })
              }
              size="sm"
              variant="secondary"
            >
              Ver contas
            </Button>
            <Button
              onClick={() =>
                onDrillDown({
                  dimension: "operation",
                  key: "table_turnovers",
                  title: "Giros de mesa",
                })
              }
              size="sm"
              variant="ghost"
            >
              Ver giros
            </Button>
          </div>
        )}
        <Card className="reports-section-card">
          <div className="reports-section-heading">
            <div>
              <p className="eyebrow">Turnos</p>
              <h2>Resultado por turno operacional</h2>
            </div>
          </div>
          {report.operations.shifts.length ? (
            <DataTable caption="Contas, clientes, receita e tempo por turno">
              <thead>
                <tr>
                  <th>Turno</th>
                  <th>Contas</th>
                  <th>Clientes</th>
                  <th>Receita</th>
                  <th>Tempo médio</th>
                </tr>
              </thead>
              <tbody>
                {report.operations.shifts.map((row) => (
                  <tr key={row.key}>
                    <th scope="row">{row.label}</th>
                    <td>{number(row.closedTabs)}</td>
                    <td>{number(row.guests)}</td>
                    <td>{formatMoney(row.revenueCents)}</td>
                    <td>
                      {row.averageServiceMinutes === null
                        ? "Indisponível"
                        : `${number(row.averageServiceMinutes)} min`}
                    </td>
                  </tr>
                ))}
              </tbody>
            </DataTable>
          ) : (
            <EmptyState
              action={
                scope ? (
                  <a
                    className="gm-button gm-button--secondary gm-button--sm"
                    href={routeHref("counter")}
                  >
                    Abrir atendimento
                  </a>
                ) : undefined
              }
              description="Vincule as próximas contas ao turno operacional para comparar o serviço."
              icon="◷"
              title="Sem turnos no período"
            />
          )}
        </Card>
      </div>
    );
  }

  if (!data.capabilities.viewCosts) {
    return (
      <Callout tone="warning">
        <strong>Rentabilidade restrita</strong>
        <span>Seu perfil não possui permissão para visualizar custos e margens.</span>
      </Callout>
    );
  }

  return (
    <div className="reports-family-view">
      <div className="reports-section-heading">
        <div>
          <p className="eyebrow">Rentabilidade</p>
          <h2>Margem e resultado operacional</h2>
          <p>Leitura por competência, preservando valores quando os custos estão incompletos.</p>
        </div>
      </div>
      <div className="metrics-grid reports-metrics">
        <FamilyMetric
          label="Receita"
          note="Receita por competência"
          value={formatMoney(data.incomeStatement.revenueCents)}
        />
        <FamilyMetric
          label="Margem bruta"
          note="Receita menos CMV"
          value={moneyOrUnavailable(data.incomeStatement.grossMarginCents)}
        />
        <FamilyMetric
          label="Margem bruta percentual"
          note="Disponível somente com custos completos"
          value={
            report.profitability.grossMarginPercent === null
              ? "Indisponível"
              : `${number(report.profitability.grossMarginPercent)}%`
          }
        />
        <FamilyMetric
          label="Resultado operacional"
          note="Receita menos CMV e despesas"
          tone={
            data.incomeStatement.operatingResultCents !== null &&
            data.incomeStatement.operatingResultCents < 0
              ? "negative"
              : "positive"
          }
          value={moneyOrUnavailable(data.incomeStatement.operatingResultCents)}
        />
      </div>
      {!data.incomeStatement.costCoverage.completeForRevenue && (
        <Callout tone="warning">
          <strong>Custos incompletos</strong>
          <span>Margem e resultado permanecem indisponíveis para evitar lucro incorreto.</span>
        </Callout>
      )}
      <FamilyComparisonCard comparison={report.profitability.comparison} />
      <Card className="reports-section-card">
        <div className="reports-section-heading">
          <div>
            <p className="eyebrow">Produtos</p>
            <h2>Rentabilidade por item vendido</h2>
            <p>O custo é congelado no consumo de estoque para preservar o histórico.</p>
          </div>
        </div>
        {report.profitability.products.length ? (
          <DataTable caption="Receita, custo e margem por produto">
            <thead>
              <tr>
                <th>Produto</th>
                <th>Qtd.</th>
                <th>Receita</th>
                <th>Custo</th>
                <th>Margem</th>
                <th>Margem %</th>
              </tr>
            </thead>
            <tbody>
              {report.profitability.products.map((row) => (
                <tr key={row.key}>
                  <th scope="row">{row.label}</th>
                  <td>{number(row.quantity)}</td>
                  <td>{formatMoney(row.revenueCents)}</td>
                  <td>{moneyOrUnavailable(row.costCents)}</td>
                  <td>{moneyOrUnavailable(row.grossMarginCents)}</td>
                  <td>
                    {row.grossMarginPercent === null
                      ? "Indisponível"
                      : `${number(row.grossMarginPercent)}%`}
                  </td>
                </tr>
              ))}
            </tbody>
          </DataTable>
        ) : (
          <EmptyState
            action={
              scope ? (
                <a
                  className="gm-button gm-button--secondary gm-button--sm"
                  href={routeHref("purchases")}
                >
                  Revisar compras e custos
                </a>
              ) : undefined
            }
            description="Confirme os custos e processe o consumo de estoque das vendas para calcular a rentabilidade."
            icon="◇"
            title="Sem produtos vendidos"
          />
        )}
      </Card>
    </div>
  );
}

export function DailyRevenueChart({ data, scope }: { data: ReportData; scope?: ManagementScope }) {
  const series = data.dailySeries;
  if (!series.length) {
    return (
      <Card className="reports-section-card">
        <div className="reports-section-heading">
          <div>
            <p className="eyebrow">Comparação</p>
            <h2>Receita diária</h2>
          </div>
        </div>
        <EmptyState
          action={
            scope ? (
              <a
                className="gm-button gm-button--secondary gm-button--sm"
                href={routeHref("counter")}
              >
                Abrir atendimento
              </a>
            ) : undefined
          }
          description="A série diária será exibida quando houver vendas detalhadas neste período."
          icon="↗"
          title="Sem série diária"
        />
      </Card>
    );
  }

  const width = 900;
  const height = 240;
  const inset = 24;
  const maximum = Math.max(
    1,
    ...series.flatMap((item) => [item.revenueCents, item.previousRevenueCents ?? 0]),
  );
  const point = (value: number, index: number) => {
    const x =
      series.length === 1 ? width / 2 : inset + (index / (series.length - 1)) * (width - inset * 2);
    const y = height - inset - (value / maximum) * (height - inset * 2);
    return `${x},${y}`;
  };
  const currentPoints = series.map((item, index) => point(item.revenueCents, index)).join(" ");
  const previousPoints = series
    .flatMap((item, index) =>
      item.previousRevenueCents === null ? [] : [point(item.previousRevenueCents, index)],
    )
    .join(" ");

  return (
    <Card className="reports-section-card reports-chart-card">
      <div className="reports-section-heading">
        <div>
          <p className="eyebrow">Comparação</p>
          <h2>Receita diária</h2>
          <p>{comparisonLabel(data)}</p>
        </div>
        <div className="reports-chart-legend">
          <span data-series="current">Período atual</span>
          <span data-series="previous">Período anterior</span>
        </div>
      </div>
      <figure className="reports-chart">
        <svg
          aria-labelledby="reports-chart-title reports-chart-description"
          className="reports-chart__svg"
          preserveAspectRatio="none"
          role="img"
          viewBox={`0 0 ${width} ${height}`}
        >
          <title id="reports-chart-title">Receita diária comparada ao período anterior</title>
          <desc id="reports-chart-description">
            Série de {series.length} dias entre {dateLabel(data.period.from)} e{" "}
            {dateLabel(data.period.to)}.
          </desc>
          {[0.25, 0.5, 0.75].map((ratio) => (
            <line
              className="reports-chart__grid"
              key={ratio}
              x1={inset}
              x2={width - inset}
              y1={height * ratio}
              y2={height * ratio}
            />
          ))}
          {previousPoints && (
            <polyline
              className="reports-chart__line reports-chart__line--previous"
              points={previousPoints}
            />
          )}
          <polyline
            className="reports-chart__line reports-chart__line--current"
            points={currentPoints}
          />
        </svg>
        <figcaption className="reports-chart__axis">
          <span>{dateLabel(series[0]?.date ?? data.period.from)}</span>
          <strong>Pico {formatMoney(maximum)}</strong>
          <span>{dateLabel(series.at(-1)?.date ?? data.period.to)}</span>
        </figcaption>
      </figure>
      <table className="gm-sr-only">
        <caption>Dados diários de receita do gráfico</caption>
        <thead>
          <tr>
            <th>Data</th>
            <th>Receita atual</th>
            <th>Receita anterior</th>
          </tr>
        </thead>
        <tbody>
          {series.map((item) => (
            <tr key={item.date}>
              <td>{dateLabel(item.date)}</td>
              <td>{formatMoney(item.revenueCents)}</td>
              <td>{moneyOrUnavailable(item.previousRevenueCents)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </Card>
  );
}

const breakdownDimensions: Record<BreakdownId, ReportDrillDownDimension> = {
  products: "product",
  categories: "category",
  channels: "channel",
  paymentMethods: "payment_method",
};

export function Breakdowns({
  activeDimension,
  data,
  onDrillDown,
  order = "revenue_desc",
  scope,
}: {
  activeDimension?: BreakdownId;
  data: ReportData;
  onDrillDown: (target: DrillDownTarget) => void;
  order?: ReportBreakdownOrder;
  scope?: ManagementScope;
}) {
  const [active, setActive] = useState<BreakdownId>("products");
  const selected = activeDimension ?? active;
  const rows = [...data.breakdowns[selected]].sort((left, right) => {
    if (order === "revenue_asc") return left.revenueCents - right.revenueCents;
    if (order === "quantity_desc") return right.quantity - left.quantity;
    if (order === "quantity_asc") return left.quantity - right.quantity;
    if (order === "label_asc") return left.label.localeCompare(right.label, "pt-BR");
    if (order === "label_desc") return right.label.localeCompare(left.label, "pt-BR");
    return right.revenueCents - left.revenueCents;
  });
  const total = rows.reduce((sum, row) => sum + row.revenueCents, 0);
  const activeLabel = breakdownTabs.find((tab) => tab.id === selected)?.label ?? "Detalhamento";

  return (
    <Card className="reports-section-card reports-breakdowns">
      <div className="reports-section-heading">
        <div>
          <p className="eyebrow">Composição</p>
          <h2>Detalhamento de vendas</h2>
          <p>Receita e quantidade por origem no período selecionado.</p>
        </div>
      </div>
      {!activeDimension && (
        <SegmentedTabs
          active={active}
          items={breakdownTabs.map((tab) => ({
            ...tab,
            count: data.breakdowns[tab.id].length,
          }))}
          label="Escolher detalhamento do relatório"
          onChange={setActive}
        />
      )}
      {rows.length ? (
        <DataTable caption={`${activeLabel} por receita`}>
          <thead>
            <tr>
              <th scope="col">{activeLabel.slice(0, -1)}</th>
              <th scope="col">Quantidade</th>
              <th scope="col">Receita</th>
              <th scope="col">Participação</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.key}>
                <th scope="row">
                  {data.capabilities.drillDown ? (
                    <Button
                      className="reports-drilldown-link"
                      onClick={() =>
                        onDrillDown({
                          dimension: breakdownDimensions[selected],
                          key: row.key,
                          title: `${activeLabel}: ${row.label}`,
                        })
                      }
                      type="button"
                    >
                      {row.label}
                    </Button>
                  ) : (
                    row.label
                  )}
                </th>
                <td>{new Intl.NumberFormat("pt-BR").format(row.quantity)}</td>
                <td>{formatMoney(row.revenueCents)}</td>
                <td>
                  {total
                    ? `${((row.revenueCents / total) * 100).toFixed(1).replace(".", ",")}%`
                    : "0%"}
                </td>
              </tr>
            ))}
          </tbody>
        </DataTable>
      ) : (
        <EmptyState
          action={
            scope ? (
              <a
                className="gm-button gm-button--secondary gm-button--sm"
                href={routeHref("counter")}
              >
                Abrir atendimento
              </a>
            ) : undefined
          }
          description={`Não há dados de ${activeLabel.toLocaleLowerCase("pt-BR")} para este período.`}
          icon="◇"
          title="Sem detalhamento"
        />
      )}
    </Card>
  );
}
