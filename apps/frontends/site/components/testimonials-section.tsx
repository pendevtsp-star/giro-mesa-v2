import type { CommercialLanding } from "../lib/commercial";

export function TestimonialsSection({
  testimonials,
  faq,
}: {
  testimonials: CommercialLanding["testimonials"];
  faq: CommercialLanding["faq"];
}) {
  return (
    <>
      <section className="section trust-section" aria-labelledby="testimonials-title">
        <div className="container">
          <div className="section-heading centered">
            <p className="eyebrow">Experiências publicadas</p>
            <h2 id="testimonials-title">{testimonials.title}</h2>
          </div>
          <div className="testimonial-grid">
            {testimonials.items.map((item) => (
              <figure className="testimonial-card" key={`${item.name}-${item.quote}`}>
                <blockquote>“{item.quote}”</blockquote>
                <figcaption>
                  <strong>{item.name}</strong>
                  <span>{item.role}</span>
                </figcaption>
              </figure>
            ))}
          </div>
        </div>
      </section>
      <section className="section faq-section">
        <div className="container narrow">
          <div className="section-heading centered">
            <p className="eyebrow">Perguntas frequentes</p>
            <h2>{faq.title}</h2>
          </div>
          <div className="faq-list">
            {faq.items.map((item) => (
              <details key={item.question}>
                <summary>{item.question}</summary>
                <p>{item.answer}</p>
              </details>
            ))}
          </div>
        </div>
      </section>
    </>
  );
}
