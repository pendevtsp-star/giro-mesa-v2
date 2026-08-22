import { Button } from "@giromesa/ui";
import { useEffect } from "react";
import type { RouteId } from "../../domain";

const helpTopics: Record<RouteId, { title: string; steps: string[]; warning?: string }> = {
  dashboard: {
    title: "Entender a visão geral",
    steps: [
      "Use os indicadores como atalhos para a área correspondente.",
      "Dados reais são atualizados por evento ou pela atualização periódica de segurança.",
    ],
  },
  device: {
    title: "Administrar SmartPOS e instalar a PWA",
    steps: [
      "Gerentes pareiam o APK por código temporário e acompanham saúde e certificação.",
      "O financeiro consulta conciliação; aprovação e kill switch permanecem no servidor.",
      "No navegador comum, instale a PWA somente para disponibilizar o atendimento.",
    ],
    warning: "A PWA isolada não acessa o SDK de pagamento da maquininha.",
  },
  salon: {
    title: "Atender uma mesa",
    steps: [
      "Selecione uma mesa livre e informe o número de pessoas.",
      "Adicione produtos e complementos; salve o pedido como rascunho.",
      "Revise o rascunho e envie à produção.",
    ],
    warning: "Transferências, divisões e cancelamentos só valem após confirmação do servidor.",
  },
  counter: {
    title: "Abrir pedido no balcão",
    steps: [
      "Informe uma identificação curta para retirada ou consumo local.",
      "Monte o pedido, salve e envie à produção.",
    ],
  },
  catalog: {
    title: "Consultar o cardápio operacional",
    steps: [
      "Confirme preço e disponibilidade antes de lançar o pedido.",
      "Produtos sem preço ou indisponíveis ficam bloqueados na operação.",
    ],
  },
  kds: {
    title: "Movimentar a produção",
    steps: [
      "Inicie apenas tickets realmente assumidos pela estação.",
      "Marque como pronto ao concluir e como retirado após a entrega.",
    ],
  },
  cash: {
    title: "Operar o caixa",
    steps: ["Confira o turno aberto.", "Registre valores somente após a confirmação física."],
  },
  inventory: {
    title: "Consultar estoque",
    steps: [
      "Priorize itens abaixo do mínimo.",
      "Use saldos persistidos como referência operacional.",
    ],
  },
  purchases: {
    title: "Acompanhar compras",
    steps: ["Revise total e prazo.", "Aprovações ficam registradas no servidor."],
  },
  finance: {
    title: "Ler o financeiro",
    steps: ["Separe contas a pagar e receber.", "Conciliação exige fonte bancária homologada."],
  },
  reports: {
    title: "Analisar os relatórios",
    steps: [
      "Escolha o período e atualize para consultar somente esta unidade.",
      "Compare o caixa realizado com o resultado por competência.",
      "Considere a margem apenas quando a cobertura de custos estiver completa.",
    ],
  },
  fiscal: {
    title: "Acompanhar a operação fiscal",
    steps: [
      "Trate rejeições e documentos pendentes antes de fechar a competência.",
      "Confira a conciliação e feche somente quando não houver bloqueios.",
    ],
    warning: "Reabrir uma competência exige justificativa e fica registrado na auditoria.",
  },
  accountant: {
    title: "Conferir a competência",
    steps: [
      "Escolha uma competência e confira o pacote disponível.",
      "Registre uma solicitação quando faltar documento ou houver divergência.",
    ],
  },
  people: {
    title: "Acompanhar equipe",
    steps: ["Confira pessoas ativas e ponto aberto.", "Saídas registram o horário no servidor."],
  },
  "waiter-settlements": {
    title: "Fechar valores da equipe",
    steps: [
      "Pré-visualize o período antes de gerar o fechamento.",
      "Confira serviço, partnership e perdas operacionais separadamente.",
    ],
    warning: "Aprovação, pagamento e reversões exigem justificativa e ficam auditados.",
  },
  delivery: {
    title: "Configurar delivery próprio",
    steps: [
      "Confira zonas, taxas e pedido mínimo.",
      "Use somente provedores explicitamente homologados.",
    ],
    warning: "Ainda não existe uma lista autenticada de pedidos de delivery nesta versão.",
  },
  reservations: {
    title: "Recepcionar clientes",
    steps: [
      "Confirme a reserva antes da chegada.",
      "Use notificar e sentar para manter a fila consistente.",
    ],
  },
  crm: {
    title: "Relacionamento responsável",
    steps: [
      "Consulte o consentimento antes de campanhas.",
      "Status bloqueado não significa mensagem enviada.",
    ],
  },
  multiunit: {
    title: "Interpretar o consolidado",
    steps: [
      "Compare unidades usando registros persistidos.",
      "Use conciliação financeira para números contábeis.",
    ],
  },
  settings: {
    title: "Configurar o estabelecimento",
    steps: [
      "Salve organização, unidade, marca e funcionamento nas respectivas seções.",
      "Publique o cardápio para levar alterações de marca e horários aos canais públicos.",
    ],
    warning: "O status aberto ou fechado é informativo e não bloqueia pedidos.",
  },
  platform: {
    title: "Administração da plataforma",
    steps: ["Use apenas ferramentas autenticadas e auditadas."],
  },
  alerts: {
    title: "Tratar alertas",
    steps: ["Priorize exceções críticas.", "Confirme a resolução na fonte operacional."],
  },
};

export function HelpDrawer({ route, onClose }: { route: RouteId; onClose: () => void }) {
  const topic = helpTopics[route];
  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => event.key === "Escape" && onClose();
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [onClose]);
  return (
    <div className="help-layer">
      <button aria-label="Fechar ajuda" className="help-backdrop" onClick={onClose} type="button" />
      <aside aria-labelledby="help-title" aria-modal="true" className="help-drawer" role="dialog">
        <div className="dialog-header">
          <div>
            <p className="eyebrow">Ajuda local</p>
            <h2 id="help-title">{topic.title}</h2>
          </div>
          <Button
            aria-label="Fechar ajuda"
            className="dialog-close"
            onClick={onClose}
            size="sm"
            variant="ghost"
          >
            ×
          </Button>
        </div>
        <p className="muted">
          Orientações determinísticas desta versão; nenhuma resposta é gerada por IA.
        </p>
        <ol className="help-steps">
          {topic.steps.map((step) => (
            <li key={step}>{step}</li>
          ))}
        </ol>
        {topic.warning && (
          <div className="help-warning" role="note">
            <strong>Atenção</strong>
            <p>{topic.warning}</p>
          </div>
        )}
        <Button onClick={onClose}>Entendi</Button>
      </aside>
    </div>
  );
}
