import type { EstablishmentSpecializedSettingsSummary } from "@giromesa/contracts";
import { Badge, Button, Icon } from "@giromesa/ui";
import { routeHref } from "../../router";
import { kdsAreaHref } from "../kds/kds.navigation";

export function SetupChecklist({
  summary,
  status,
  onRefresh,
}: {
  summary: EstablishmentSpecializedSettingsSummary | null;
  status: "loading" | "ready" | "error";
  onRefresh: () => void;
}) {
  const setup = summary?.setup;
  const steps = setup
    ? [
        {
          id: "products",
          label: "Produtos e adicionais",
          done: setup.activeProducts > 0,
          detail: `${setup.activeProducts} produtos ativos. Importe seu cardápio por planilha e confira preços e adicionais.`,
          href: routeHref("catalog"),
          action: "Abrir cardápio",
        },
        {
          id: "people",
          label: "Acessos da equipe",
          done: setup.activePeople > 0,
          detail: `${setup.activePeople} pessoas com acesso. Confira as funções de cada colaborador e o acesso ao terminal.`,
          href: routeHref("people"),
          action: "Conferir equipe",
        },
        {
          id: "production",
          label: "Praça de produção criada",
          done: summary.kds.activeStations > 0,
          detail: `${summary.kds.activeStations} praças ativas. Confira também o vínculo de cada produto à cozinha, bar ou outro destino.`,
          href: kdsAreaHref("settings"),
          action: "Configurar produção",
        },
        {
          id: "service",
          label: "Percorrer um atendimento",
          done: setup.completedService,
          detail: setup.completedService
            ? "Há pedido servido com conta encerrada nesta unidade. Confira também divisão, cancelamento e fechamento de caixa."
            : "Lance um pedido, acompanhe a produção, marque como servido e encerre a conta no fluxo real.",
          href: routeHref("salon"),
          action: "Abrir atendimento",
        },
      ]
    : [];
  const completed = steps.filter((step) => step.done).length;
  return (
    <section
      aria-labelledby="setup-checklist-title"
      className="setup-checklist"
      id="settings-setup"
    >
      <header>
        <div>
          <h2 id="setup-checklist-title">Prepare o primeiro turno</h2>
          <p>Uma sequência curta, conferida pelos dados da unidade.</p>
        </div>
        <Button
          aria-busy={status === "loading"}
          disabled={status === "loading"}
          onClick={onRefresh}
          size="sm"
          type="button"
          variant="secondary"
        >
          <Icon name="refresh" size={14} />{" "}
          {status === "loading" ? "Conferindo…" : "Conferir novamente"}
        </Button>
      </header>
      {status === "error" ? (
        <p role="alert">
          Não foi possível conferir a preparação. Tente novamente; nenhum item foi considerado
          concluído.
        </p>
      ) : status === "loading" ? (
        <p role="status">Consultando cardápio, equipe, produção e atendimentos…</p>
      ) : !setup ? (
        <p role="status">
          O servidor ainda não fornece a conferência inicial. As configurações abaixo continuam
          disponíveis.
        </p>
      ) : (
        <>
          <p className="setup-checklist__summary">
            <strong>
              {completed} de {steps.length}
            </strong>{" "}
            etapas com registro no sistema
          </p>
          <ol className="setup-checklist__steps">
            {steps.map((step) => (
              <li key={step.id}>
                <Icon name={step.done ? "check" : "chevron-right"} size={18} />
                <div>
                  <h3>{step.label}</h3>
                  <p>{step.detail}</p>
                </div>
                <Badge tone={step.done ? "success" : "warning"}>
                  {step.done ? "Registrado" : "A preparar"}
                </Badge>
                <a className="gm-button gm-button--secondary gm-button--sm" href={step.href}>
                  {step.action}
                </a>
              </li>
            ))}
          </ol>
          <details className="gm-disclosure">
            <summary>Mesas, equipamentos e canais de venda</summary>
            <ul className="setup-checklist__extras">
              <li>
                <div>
                  <strong>Mesas e ambientes</strong>
                  <p>
                    {setup.activeTables} mesas ativas. Configure se a casa trabalha com atendimento
                    à mesa.
                  </p>
                </div>
                <a href={routeHref("salon")}>Organizar salão</a>
              </li>
              <li>
                <div>
                  <strong>Impressão e continuidade local</strong>
                  <p>
                    {setup.activePrinters} impressoras configuradas. Teste o papel e a operação sem
                    internet no equipamento da casa.
                  </p>
                </div>
                <a href={routeHref("device")}>Conferir dispositivos</a>
              </li>
              <li>
                <div>
                  <strong>Cardápio público e QR</strong>
                  <p>
                    {summary.catalog.active
                      ? "Cardápio publicado. Confira no celular do cliente."
                      : "Publique após conferir produtos, preços e disponibilidade."}
                  </p>
                </div>
                <a href={routeHref("table-qrs")}>Conferir QR das mesas</a>
              </li>
            </ul>
          </details>
          <p className="setup-checklist__note">
            Cadastro não é homologação: pagamentos, emissão fiscal, impressoras e operação sem
            internet precisam de teste real e das liberações dos fornecedores.
          </p>
        </>
      )}
    </section>
  );
}
