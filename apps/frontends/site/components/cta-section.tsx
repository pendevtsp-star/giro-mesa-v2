import Link from "next/link";

export function CtaSection() {
  return (
    <section className="final-cta">
      <div className="container">
        <p className="eyebrow">Seu próximo turno começa aqui</p>
        <h2>
          Uma operação que gira
          <br />
          sem perder o controle.
        </h2>
        <div>
          <Link className="button button-light button-large" href="/teste-gratis">
            Solicitar teste assistido →
          </Link>
          <Link className="button button-dark button-large" href="/contato">
            Falar com especialista
          </Link>
        </div>
      </div>
    </section>
  );
}
