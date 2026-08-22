import { Card, DataTable, EmptyState, Input, NativeSelect } from "@giromesa/ui";
import { useMemo, useState } from "react";
import type { ReportData } from "../../../management.shared";
import { formatMoney } from "../../../rules";

type ManagementFamily = "multiunit" | "quality";
type MultiunitRow = ReportData["reportFamilies"]["multiunit"]["units"][number];

const number = (value: number) =>
  new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 3 }).format(value);

const moneyOrUnavailable = (value: number | null | undefined) =>
  value === null || value === undefined ? "Indisponível" : formatMoney(value);

export function ManagementReportFamilyView({
  data,
  family,
}: {
  data: ReportData;
  family: ManagementFamily;
}) {
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<"rank" | "revenue" | "unit">("rank");
  const report = data.reportFamilies;
  const units = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase("pt-BR");
    return [...(report.multiunit.units as MultiunitRow[])]
      .filter((row) => !normalized || row.label.toLocaleLowerCase("pt-BR").includes(normalized))
      .sort((left, right) => {
        if (sort === "unit") return left.label.localeCompare(right.label, "pt-BR");
        if (sort === "revenue") return right.revenueCents - left.revenueCents;
        return left.rank - right.rank;
      });
  }, [query, report.multiunit.units, sort]);

  if (family === "quality") {
    return (
      <div className="reports-family-view">
        <div className="reports-section-heading">
          <div>
            <p className="eyebrow">Qualidade dos dados</p>
            <h2>Confiabilidade do relatório</h2>
            <p>Pendências que reduzem a cobertura dos indicadores apresentados.</p>
          </div>
        </div>
        <Card className="metric-card">
          <p>Completude</p>
          <strong className={report.quality.scorePercent < 90 ? "negative" : "positive"}>
            {number(report.quality.scorePercent)}%
          </strong>
          <small>Registros válidos nas fontes consultadas</small>
        </Card>
        {report.quality.issues.length ? (
          <Card className="reports-section-card">
            <DataTable caption="Pendências de qualidade dos dados">
              <thead>
                <tr>
                  <th>Pendência</th>
                  <th>Ocorrências</th>
                  <th>Prioridade</th>
                </tr>
              </thead>
              <tbody>
                {report.quality.issues.map((issue) => (
                  <tr key={issue.key}>
                    <th scope="row">{issue.label}</th>
                    <td>{number(issue.count)}</td>
                    <td>
                      {issue.severity === "critical"
                        ? "Crítica"
                        : issue.severity === "warning"
                          ? "Atenção"
                          : "Informativa"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </DataTable>
          </Card>
        ) : (
          <EmptyState
            action={
              <span className="gm-pill" data-tone="positive">
                Cobertura verificada
              </span>
            }
            description="Continue registrando custos, pagamentos e documentos na origem para manter os indicadores confiáveis."
            icon="✓"
            title="Sem pendências detectadas"
          />
        )}
      </div>
    );
  }

  return (
    <div className="reports-family-view">
      <div className="reports-section-heading">
        <div>
          <p className="eyebrow">Multiunidade</p>
          <h2>Comparativo entre unidades</h2>
          <p>Ranking normalizado pelo período e pelo fuso de cada unidade.</p>
        </div>
      </div>
      {report.multiunit.units.length ? (
        <Card className="reports-section-card">
          <fieldset className="gm-toolbar">
            <legend className="gm-sr-only">Filtrar e ordenar unidades</legend>
            <label className="gm-field" htmlFor="reports-unit-search">
              Buscar unidade
              <Input
                id="reports-unit-search"
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Nome da unidade"
                type="search"
                value={query}
              />
            </label>
            <label className="gm-field" htmlFor="reports-unit-sort">
              Ordenar por
              <NativeSelect
                id="reports-unit-sort"
                onChange={(event) => setSort(event.target.value as typeof sort)}
                value={sort}
              >
                <option value="rank">Posição</option>
                <option value="revenue">Maior receita</option>
                <option value="unit">Nome da unidade</option>
              </NativeSelect>
            </label>
          </fieldset>
          {units.length ? (
            <DataTable
              caption="Ranking e desempenho comparável por unidade"
              className="reports-multiunit-table"
            >
              <thead>
                <tr>
                  <th>Posição</th>
                  <th>Unidade</th>
                  <th>Contas</th>
                  <th>Receita</th>
                  <th>Ticket médio</th>
                  <th>Receita/dia</th>
                  <th>Eficiência</th>
                  <th>Participação</th>
                  <th>Mesma loja</th>
                </tr>
              </thead>
              <tbody>
                {units.map((row) => (
                  <tr key={row.key}>
                    <td data-label="Posição">{row.rank > 0 ? `${row.rank}º` : "—"}</td>
                    <th data-label="Unidade" scope="row">
                      {row.label}
                    </th>
                    <td data-label="Contas">{number(row.closedTabs)}</td>
                    <td data-label="Receita">{formatMoney(row.revenueCents)}</td>
                    <td data-label="Ticket médio">{moneyOrUnavailable(row.averageTicketCents)}</td>
                    <td data-label="Receita/dia">
                      {moneyOrUnavailable(row.revenuePerOperatingDayCents)}
                    </td>
                    <td data-label="Eficiência">
                      <span
                        title={
                          row.seatCount ? `${row.seatCount} assentos` : "Assentos não informados"
                        }
                      >
                        Assento: {moneyOrUnavailable(row.revenuePerSeatCents)}
                      </span>
                      <br />
                      <span
                        title={
                          row.openHours
                            ? `${number(row.openHours)} horas abertas`
                            : "Horário não informado"
                        }
                      >
                        Hora: {moneyOrUnavailable(row.revenuePerOpenHourCents)}
                      </span>
                      <br />
                      <span
                        title={
                          row.activeEmployees
                            ? `${row.activeEmployees} pessoas ativas`
                            : "Equipe não informada"
                        }
                      >
                        Pessoa: {moneyOrUnavailable(row.revenuePerEmployeeCents)}
                      </span>
                    </td>
                    <td data-label="Participação">
                      {row.organizationRevenueSharePercent === null
                        ? "Indisponível"
                        : `${number(row.organizationRevenueSharePercent)}%`}
                    </td>
                    <td data-label="Mesma loja">
                      {row.sameStoreChangePercent === null
                        ? `Não comparável (mín. ${row.minimumComparableOperatingDays} dias)`
                        : `${number(row.sameStoreChangePercent)}%`}
                    </td>
                  </tr>
                ))}
              </tbody>
            </DataTable>
          ) : (
            <EmptyState
              description="Limpe a busca ou informe outro nome de unidade."
              icon="⌕"
              title="Nenhuma unidade encontrada"
            />
          )}
        </Card>
      ) : (
        <EmptyState
          description="Acesse com perfil proprietário e cadastre outra unidade para habilitar a comparação."
          icon="◇"
          title="Comparativo multiunidade indisponível"
        />
      )}
    </div>
  );
}
