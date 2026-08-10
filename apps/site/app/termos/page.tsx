import type { Metadata } from "next";

export const metadata: Metadata = { title: "Termos de Uso" };

export default function TermsPage() {
  return (
    <main id="conteudo" className="legal-page">
      <article className="container narrow">
        <p className="eyebrow">Documento preliminar</p>
        <h1>Termos de Uso</h1>
        <p className="legal-warning">
          Este texto é uma estrutura informativa e ainda depende de revisão jurídica antes da
          publicação comercial.
        </p>
        <h2>1. Objeto</h2>
        <p>
          O GiroMesa é uma plataforma de apoio à gestão de operações de food service.
          Funcionalidades contratadas, limites e serviços adicionais serão descritos na proposta e
          no catálogo comercial vigente.
        </p>
        <h2>2. Conta e responsabilidades</h2>
        <p>
          O responsável deve manter dados corretos, proteger credenciais, configurar permissões e
          usar o serviço conforme a legislação aplicável. Ações sensíveis podem exigir aprovação
          adicional e ficam sujeitas a auditoria.
        </p>
        <h2>3. Integrações</h2>
        <p>
          Serviços de pagamento, emissão fiscal, mensageria e terceiros dependem de contratos,
          credenciais, disponibilidade e homologação próprias. A contratação do GiroMesa não
          substitui obrigações com esses provedores.
        </p>
        <h2>4. Teste e cobrança</h2>
        <p>
          O teste assistido dura 14 dias após a ativação operacional e não exige cartão.
          Assinaturas, reajustes, cancelamento, retenção e exportação serão apresentados antes da
          contratação.
        </p>
        <h2>5. Continuidade e suporte</h2>
        <p>
          Metas de atendimento e disponibilidade serão as vigentes no plano contratado. Incidentes,
          manutenção e limitações externas serão comunicados pelos canais oficiais.
        </p>
        <h2>6. Cancelamento</h2>
        <p>
          O cancelamento não implica exclusão imediata. O cliente poderá solicitar exportação e
          eliminação conforme contrato, obrigações legais e política de retenção.
        </p>
        <p className="updated">Versão preliminar · agosto de 2026</p>
      </article>
    </main>
  );
}
