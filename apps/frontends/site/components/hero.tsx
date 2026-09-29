import Link from "next/link";
import {
  type CommercialAttribution,
  type CommercialLanding,
  withCommercialAttribution,
} from "../lib/commercial";
import { HeroScenes } from "./hero-scenes";

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
    <>
      <section className="hero" aria-labelledby="hero-title">
        <HeroScenes />
        <div className="container hero-grid">
          <div className="hero-copy">
            <h1 id="hero-title">
              {hero.title.split(/(?<=\.)\s+/).map((line) => (
                <span key={line}>{line}</span>
              ))}
            </h1>
            <p className="hero-lead">{hero.description}</p>
            <div className="hero-actions">
              <Link
                className="button button-primary button-large"
                href={withCommercialAttribution(hero.primaryCtaHref, attribution)}
              >
                {hero.primaryCtaLabel}
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
        </div>
      </section>
      <div className="segment-band">
        <section className="container segment-strip" aria-label={socialProof.title}>
          {socialProof.items.map((item) => (
            <p className="social-proof-item" key={`${item.label}-${item.value}`}>
              <strong>{item.value}</strong>
            </p>
          ))}
        </section>
      </div>
    </>
  );
}
