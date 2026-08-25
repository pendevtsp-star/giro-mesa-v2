import type { CommercialLegalDocument } from "../lib/commercial";

export function LegalDocument({ document }: { document: CommercialLegalDocument | null }) {
  if (!document)
    return (
      <main id="conteudo" className="legal-page">
        <article className="container narrow">
          <p className="eyebrow">Documento indisponível</p>
          <h1>Conteúdo legal temporariamente indisponível</h1>
          <p className="legal-warning" role="status">
            Não exibimos versões preliminares ou desatualizadas. Tente novamente mais tarde.
          </p>
        </article>
      </main>
    );

  return (
    <main id="conteudo" className="legal-page">
      <article className="container narrow">
        <p className="eyebrow">Documento publicado</p>
        <h1>{document.title}</h1>
        {document.sections.map((section) => (
          <section key={section.heading}>
            <h2>{section.heading}</h2>
            <p className="legal-body">{section.body}</p>
          </section>
        ))}
        <p className="updated">
          Versão {document.version} · vigente desde{" "}
          <time dateTime={document.effectiveAt}>
            {new Intl.DateTimeFormat("pt-BR", { dateStyle: "long", timeZone: "UTC" }).format(
              new Date(document.effectiveAt),
            )}
          </time>
        </p>
      </article>
    </main>
  );
}
