import Image from "next/image";
import Link from "next/link";
import {
  type CommercialAttribution,
  type CommercialLanding,
  withCommercialAttribution,
} from "../lib/commercial";

export function Hero({
  hero,
  socialProof,
  attribution,
}: {
  hero: CommercialLanding["hero"];
  socialProof: CommercialLanding["socialProof"];
  attribution?: CommercialAttribution;
}) {
  return (
    <section className="hero">
      <div className="hero-glow" aria-hidden="true" />
      <div className="container hero-grid">
        <div className="hero-copy">
          <p className="eyebrow">
            <span aria-hidden="true" /> {hero.eyebrow}
          </p>
          <h1>{hero.title}</h1>
          <p className="hero-lead">{hero.description}</p>
          <div className="hero-actions">
            <Link
              className="button button-primary button-large"
              href={withCommercialAttribution(hero.primaryCtaHref, attribution)}
            >
              {hero.primaryCtaLabel} <span aria-hidden="true">→</span>
            </Link>
            {hero.secondaryCtaHref && hero.secondaryCtaLabel ? (
              <Link
                className="button button-outline button-large"
                href={withCommercialAttribution(hero.secondaryCtaHref, attribution)}
              >
                {hero.secondaryCtaLabel}
              </Link>
            ) : null}
          </div>
        </div>
        {hero.media ? (
          <figure className="hero-product">
            <div
              className="hero-product-frame media-frame"
              style={
                hero.media.width && hero.media.height
                  ? { aspectRatio: `${hero.media.width} / ${hero.media.height}` }
                  : undefined
              }
            >
              <Image
                alt={hero.media.alt}
                fill
                sizes="(max-width: 960px) 100vw, 55vw"
                src={hero.media.url}
                unoptimized
              />
            </div>
          </figure>
        ) : null}
      </div>
      <section className="container segment-strip" aria-label={socialProof.title}>
        <span>{socialProof.title}</span>
        {socialProof.items.map((item) => (
          <p className="social-proof-item" key={`${item.label}-${item.value}`}>
            <strong>{item.value}</strong>
            <small>{item.label}</small>
          </p>
        ))}
      </section>
    </section>
  );
}
