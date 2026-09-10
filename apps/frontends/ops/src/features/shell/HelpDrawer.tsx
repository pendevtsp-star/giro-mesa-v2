import { Button, Icon } from "@giromesa/ui";
import { useEffect } from "react";
import type { RouteId } from "../../domain";

const helpTopics: Record<RouteId, { title: string; steps: string[]; warning?: string }> = {
  dashboard: {
    title: "Entender a visão geral",
    steps: [
      "Use os indicadores como atalhos para a área correspondente.",
      "Confira o horário da última atualização antes de tomar uma decisão.",
    ],
  },
  device: {
    title: "Configurar as maquininhas e o aplicativo",
    steps: [
      "O gerente conecta a maquininha por um código temporário e confere se ela está autorizada para pagamentos.",
      "O financeiro confere os recebimentos e as divergências de pagamento.",
      "No navegador, use a opção de instalar o aplicativo para acessar o atendimento com mais facilidade.",
    ],
    warning:
      "Instalar pelo navegador não habilita pagamentos integrados. A maquininha precisa do aplicativo e da integração aprovados pelo fornecedor.",
  },
  salon: {
    title: "Atender uma mesa",
    steps: [
      "Selecione uma mesa livre e informe o número de pessoas.",
      "Adicione produtos e complementos; o rascunho fica salvo neste dispositivo.",
      "Revise e envie à produção. Aguarde a confirmação de envio.",
      "Use Conta e pagamento para separar consumo, imprimir a pré-conta e receber sem sair do atendimento.",
    ],
    warning:
      "Se houver falha de conexão, confira os pedidos pendentes antes de tentar lançar os mesmos itens novamente.",
  },
  counter: {
    title: "Abrir pedido no balcão",
    steps: [
      "Informe uma identificação curta para retirada ou consumo local.",
      "Monte o pedido, revise e envie à produção.",
      "Confira a conta selecionada antes de imprimir ou receber.",
    ],
  },
  catalog: {
    title: "Consultar o cardápio operacional",
    steps: [
      "Confirme preço e disponibilidade antes de lançar o pedido.",
      "Produtos sem preço ou indisponíveis ficam bloqueados na operação.",
    ],
  },
  "table-qrs": {
    title: "Gerenciar QR das mesas",
    steps: [
      "Personalize a placa e salve antes de gerar novos arquivos.",
      "Selecione mesas reais, valide o QR e escolha o formato de saída.",
      "Marque o lote como impresso somente após confirmar a produção física.",
    ],
    warning: "Ao renovar o código de uma mesa, as placas antigas deixam de funcionar.",
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
      "Selecione o setor para conferir o saldo correto.",
      "Para mover itens, informe origem e destino; o recebimento deve ser conferido no setor de destino.",
    ],
  },
  purchases: {
    title: "Acompanhar compras",
    steps: ["Revise total e prazo.", "Confirme o recebimento após conferir as mercadorias."],
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
    steps: ["Confira pessoas ativas e ponto aberto.", "Registre a saída ao encerrar o expediente."],
  },
  "waiter-settlements": {
    title: "Fechar valores da equipe",
    steps: [
      "Pré-visualize o período antes de gerar o fechamento.",
      "Confira taxa de serviço e comissões por pessoa antes de aprovar.",
      "Perdas operacionais são informativas e não são descontadas do valor a pagar à equipe.",
    ],
    warning: "Aprovação, pagamento e reversões exigem justificativa e ficam auditados.",
  },
  delivery: {
    title: "Acompanhar entregas",
    steps: [
      "Confira zonas, taxas e pedido mínimo.",
      "Acompanhe os pedidos, confira o endereço e avance conforme a entrega acontecer.",
    ],
    warning: "Confirme a disponibilidade do serviço contratado antes de usar entregas integradas.",
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
      "Compare os resultados registrados em cada unidade.",
      "Use conciliação financeira para números contábeis.",
    ],
  },
  billing: {
    title: "Acompanhar assinatura e cobranças",
    steps: [
      "Confira o plano, o ciclo e a próxima renovação da organização.",
      "Use a página de pagamento para assinar, regularizar ou mudar de plano.",
      "Aguarde a confirmação do pagamento antes de considerar o plano atualizado.",
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
            <h2 id="help-title">{topic.title}</h2>
          </div>
          <Button
            aria-label="Fechar ajuda"
            className="dialog-close"
            onClick={onClose}
            size="sm"
            variant="ghost"
          >
            <Icon name="x" size={16} />
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
