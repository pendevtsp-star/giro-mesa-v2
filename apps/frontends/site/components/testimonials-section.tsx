export function TestimonialsSection() {
  return (
    <>
      <section className="section trust-section" aria-labelledby="trust-title">
        <div className="container trust-grid">
          <div>
            <p className="eyebrow">Integrações e confiança</p>
            <h2 id="trust-title">Promessas só depois de homologadas.</h2>
            <p>
              PayGo, Focus NFe, Asaas, WhatsApp e outros provedores aparecem como integrações
              planejadas até que contratos, credenciais e testes reais comprovem a disponibilidade.
            </p>
          </div>
          <div className="trust-cards">
            <article>
              <span>◈</span>
              <h3>Privacidade por projeto</h3>
              <p>Permissões, auditoria, retenção e exportação pensadas para a LGPD.</p>
            </article>
            <article>
              <span>⌁</span>
              <h3>Operação local planejada</h3>
              <p>
                Hub por unidade para manter pedidos, KDS e impressão durante quedas de internet.
              </p>
            </article>
          </div>
        </div>
      </section>
      <section className="section faq-section">
        <div className="container narrow">
          <div className="section-heading centered">
            <p className="eyebrow">Perguntas frequentes</p>
            <h2>Antes de começar</h2>
          </div>
          <div className="faq-list">
            <details>
              <summary>Preciso cadastrar cartão para testar?</summary>
              <p>
                Não. O teste assistido de 14 dias não exige cartão e só começa após a ativação da
                operação.
              </p>
            </details>
            <details>
              <summary>O GiroMesa funciona sem internet?</summary>
              <p>
                A continuidade offline depende do aplicativo e hub local. Ela será disponibilizada
                comercialmente somente após a homologação do piloto.
              </p>
            </details>
            <details>
              <summary>Emissão fiscal está incluída?</summary>
              <p>
                Não. O módulo fiscal é adicional por unidade, e a contratação exige configuração
                fiscal ou declaração de emissor externo.
              </p>
            </details>
            <details>
              <summary>Posso usar em várias unidades?</summary>
              <p>Sim. O plano Rede parte de até três unidades e oferece visão consolidada.</p>
            </details>
            <details>
              <summary>Vocês ajudam na configuração?</summary>
              <p>
                O onboarding e treinamento remoto fazem parte da ativação. Instalações presenciais,
                rede e equipamentos podem ser cobrados à parte.
              </p>
            </details>
          </div>
        </div>
      </section>
    </>
  );
}
