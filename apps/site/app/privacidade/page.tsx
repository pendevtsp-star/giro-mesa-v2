import type { Metadata } from "next";

export const metadata: Metadata = { title: "Privacidade" };

export default function PrivacyPage() {
  return (
    <main id="conteudo" className="legal-page">
      <article className="container narrow">
        <p className="eyebrow">Privacidade por projeto</p>
        <h1>Política de Privacidade</h1>
        <p className="legal-warning">
          Documento preliminar sujeito a revisão jurídica e definição do controlador, operador,
          encarregado e prazos finais.
        </p>
        <h2>1. Dados tratados</h2>
        <p>
          Podemos tratar dados cadastrais, profissionais, de autenticação, dispositivos,
          atendimento, uso do produto e informações operacionais inseridas pelo cliente.
        </p>
        <h2>2. Finalidades</h2>
        <p>
          Usamos os dados para prestar e proteger o serviço, autenticar pessoas, oferecer suporte,
          cumprir obrigações, auditar ações e melhorar o produto dentro das bases legais aplicáveis.
        </p>
        <h2>3. Compartilhamento</h2>
        <p>
          Dados podem ser compartilhados com infraestrutura e provedores contratados na medida
          necessária. Integrações ativadas pelo cliente seguem também os termos dos respectivos
          terceiros.
        </p>
        <h2>4. Segurança e retenção</h2>
        <p>
          Aplicamos controle de acesso, segregação entre organizações, criptografia adequada,
          auditoria e rotinas de backup. Prazos de retenção considerarão contrato, finalidade e
          obrigações legais.
        </p>
        <h2>5. Direitos do titular</h2>
        <p>
          Solicitações de confirmação, acesso, correção, portabilidade, oposição ou eliminação terão
          canal específico antes do lançamento comercial.
        </p>
        <h2 id="cookies">6. Cookies</h2>
        <p>
          Usaremos cookies necessários para segurança e sessão. Métricas ou publicidade não
          essenciais dependerão de transparência e consentimento quando exigido.
        </p>
        <p className="updated">Versão preliminar · agosto de 2026</p>
      </article>
    </main>
  );
}
