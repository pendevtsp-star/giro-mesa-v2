"use client";

import { Icon } from "@giromesa/ui";
import Image from "next/image";
import { type KeyboardEvent, useEffect, useState } from "react";

export const CAROUSEL_SLIDES = [
  {
    src: "/images/product/dashboard.png",
    title: "Visão operacional",
    description: "Alertas e indicadores demonstrativos organizados para a rotina da unidade.",
    alt: "Dashboard demonstrativo do GiroMesa com alertas e indicadores da unidade",
    height: 1054,
  },
  {
    src: "/images/product/salon.png",
    title: "Salão",
    description: "Mesas, comandas e prioridades reunidas na mesma visão operacional.",
    alt: "Tela demonstrativa do salão GiroMesa com mapa de mesas e estados de atendimento",
    height: 900,
  },
  {
    src: "/images/product/kds.png",
    title: "Produção",
    description: "Fila demonstrativa do KDS organizada por estação, tempo e prioridade.",
    alt: "Tela demonstrativa do KDS GiroMesa com pedidos distribuídos por etapa de produção",
    height: 900,
  },
  {
    src: "/images/product/inventory.png",
    title: "Estoque",
    description: "Itens críticos, reposição e contagens disponíveis para decisão da equipe.",
    alt: "Tela demonstrativa do estoque GiroMesa com itens, quantidades e alertas de reposição",
    height: 900,
  },
] as const;

const AUTOPLAY_INTERVAL_MS = 7_000;

export function nextSlideIndex(current: number, direction: -1 | 1, slideCount: number): number {
  if (slideCount <= 1) return 0;
  return (current + direction + slideCount) % slideCount;
}

export function shouldAutoplay({
  paused,
  reducedMotion,
  slideCount,
}: {
  paused: boolean;
  reducedMotion: boolean;
  slideCount: number;
}): boolean {
  return !paused && !reducedMotion && slideCount > 1;
}

export function ProductCarousel() {
  const [active, setActive] = useState(0);
  const [paused, setPaused] = useState(false);
  const [reducedMotion, setReducedMotion] = useState(false);
  const autoplay = shouldAutoplay({ paused, reducedMotion, slideCount: CAROUSEL_SLIDES.length });
  const slide = CAROUSEL_SLIDES[active] ?? CAROUSEL_SLIDES[0];

  useEffect(() => {
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    const updatePreference = () => setReducedMotion(media.matches);
    updatePreference();
    media.addEventListener("change", updatePreference);
    return () => media.removeEventListener("change", updatePreference);
  }, []);

  useEffect(() => {
    if (!autoplay) return;
    const interval = window.setInterval(() => {
      setActive((current) => nextSlideIndex(current, 1, CAROUSEL_SLIDES.length));
    }, AUTOPLAY_INTERVAL_MS);
    return () => window.clearInterval(interval);
  }, [autoplay]);

  function move(direction: -1 | 1) {
    setActive((current) => nextSlideIndex(current, direction, CAROUSEL_SLIDES.length));
  }

  function handleKeyboard(event: KeyboardEvent<HTMLElement>) {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    event.preventDefault();
    move(event.key === "ArrowLeft" ? -1 : 1);
  }

  return (
    <figure
      aria-label="Demonstrações do produto"
      aria-roledescription="carrossel"
      className="hero-product product-carousel"
    >
      <div className="hero-product-frame product-carousel-frame">
        <Image
          alt={slide.alt}
          height={slide.height}
          key={slide.src}
          preload={active === 0}
          quality={90}
          sizes="(max-width: 960px) calc(100vw - 40px), 56vw"
          src={slide.src}
          width={1440}
        />
        <span className="product-demo-badge product-carousel-badge">Ambiente demonstrativo</span>
      </div>
      <figcaption>
        <span aria-atomic="true" aria-live={autoplay ? "off" : "polite"} className="carousel-copy">
          <strong data-slide-title>{slide.title}</strong>
          <span>{slide.description}</span>
        </span>
        <span
          className="carousel-position"
          aria-label={`Slide ${active + 1} de ${CAROUSEL_SLIDES.length}`}
          role="img"
        >
          {String(active + 1).padStart(2, "0")} / {String(CAROUSEL_SLIDES.length).padStart(2, "0")}
        </span>
        <span className="carousel-controls">
          <button
            aria-label="Slide anterior"
            onClick={() => move(-1)}
            onKeyDown={handleKeyboard}
            type="button"
          >
            <Icon name="arrow-left" />
          </button>
          <button
            aria-label={
              reducedMotion
                ? "Avanço automático desativado pelo sistema"
                : paused
                  ? "Retomar carrossel"
                  : "Pausar carrossel"
            }
            aria-pressed={paused || reducedMotion}
            disabled={reducedMotion}
            onClick={() => setPaused((current) => !current)}
            onKeyDown={handleKeyboard}
            type="button"
          >
            <Icon name={paused || reducedMotion ? "play" : "pause"} />
          </button>
          <button
            aria-label="Próximo slide"
            onClick={() => move(1)}
            onKeyDown={handleKeyboard}
            type="button"
          >
            <Icon name="arrow-right" />
          </button>
        </span>
      </figcaption>
      {reducedMotion && (
        <span className="carousel-motion-note">
          Movimento reduzido: avanço automático desativado.
        </span>
      )}
    </figure>
  );
}
