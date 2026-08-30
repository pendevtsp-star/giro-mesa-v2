import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = { title: "Suporte" };

export default function SupportPage() {
  return (
    <main id="conteudo" className="inner-page support-page">
      <section className="simple-hero">
        <div className="container narrow">
          <p className="eyebrow">Central de ajuda</p>
          <h1>Encontre o caminho mais rápido.</h1>
          <p>
            Os artigos e canais autenticados serão publicados junto com o piloto. Enquanto isso, use
            o contato comercial para dúvidas sobre o produto.
          </p>
          <label className="support-search">
            Buscar na ajuda
            <input type="search" placeholder="Ex.: fechar caixa, configurar cardápio" disabled />
            <small>
              A pesquisa será habilitada quando a base de conhecimento estiver publicada.
            </small>
          </label>
        </div>
      </section>
      <section className="section container support-grid">
        <article id="senha">
          <span>↗</span>
          <h2>Acesso e senha</h2>
          <p>Recuperação de senha, MFA, convites e dispositivos.</p>
          <Link href="/login">Ir para o login</Link>
        </article>
        <article>
          <span>◎</span>
          <h2>Implantação</h2>
          <p>Checklist, cardápio, equipe, mesas e simulação.</p>
          <Link href="/criar-conta">Criar conta grátis</Link>
        </article>
        <article id="status">
          <span>◌</span>
          <h2>Status dos serviços</h2>
          <p>Nenhuma página pública de disponibilidade foi configurada ainda.</p>
          <span className="status-chip">Status não publicado</span>
        </article>
        <article>
          <span>◇</span>
          <h2>Atendimento</h2>
          <p>Horários e canais críticos serão publicados por plano antes do lançamento.</p>
          <Link href="/contato">Falar conosco</Link>
        </article>
      </section>
    </main>
  );
}
