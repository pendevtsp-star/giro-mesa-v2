import { Icon } from "@giromesa/ui";
import Link from "next/link";
import type { CommercialLanding } from "../lib/commercial";

export function TestimonialsSection({
  faq,
}: {
  testimonials: CommercialLanding["testimonials"];
  faq: CommercialLanding["faq"];
}) {
  return (
    <section className="section faq-section" id="duvidas" aria-labelledby="faq-title">
      <div className="container two-column">
        <div className="faq-intro">
          <div className="section-heading">
            <h2 id="faq-title">Dúvidas frequentes</h2>
            <p>Respostas para ajudar você a escolher o próximo passo da sua operação.</p>
          </div>
          <div className="faq-contact">
            <span className="faq-contact-icon">
              <Icon name="people" size={24} />
            </span>
            <h3>Ainda ficou alguma dúvida?</h3>
            <p>Converse com a nossa equipe sobre o GiroMesa e as necessidades do seu negócio.</p>
            <Link className="button button-primary" href="/contato">
              Falar com a equipe
            </Link>
          </div>
        </div>
        <div className="faq-list">
          {faq.items.map((item, index) => (
            <details key={item.question} name="landing-faq" open={index === 0}>
              <summary>
                <span>{item.question}</span>
                <span className="faq-chevron">
                  <Icon name="chevron-down" size={18} />
                </span>
              </summary>
              <div className="faq-answer">
                <p>{item.answer}</p>
              </div>
            </details>
          ))}
        </div>
      </div>
    </section>
  );
}
