import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import {
  CAROUSEL_SLIDES,
  nextSlideIndex,
  ProductCarousel,
  shouldAutoplay,
} from "./product-carousel";

vi.mock("next/image", () => ({
  default: ({ preload, ...props }: { preload?: boolean; [key: string]: unknown }) =>
    createElement("img", { ...props, "data-preload": String(Boolean(preload)) }),
}));

describe("ProductCarousel", () => {
  it("publica controles explícitos, status e preload da primeira imagem", () => {
    const html = renderToStaticMarkup(createElement(ProductCarousel));

    expect(html).toContain('aria-roledescription="carrossel"');
    expect(html).toContain('aria-label="Demonstrações do produto"');
    expect(html).toContain('aria-label="Slide anterior"');
    expect(html).toContain('aria-label="Próximo slide"');
    expect(html).toContain('aria-label="Pausar carrossel"');
    expect(html).toContain('data-preload="true"');
    expect(html).toContain(CAROUSEL_SLIDES[0].alt);
  });

  it("navega circularmente em ambas as direções", () => {
    expect(nextSlideIndex(0, -1, 4)).toBe(3);
    expect(nextSlideIndex(3, 1, 4)).toBe(0);
    expect(nextSlideIndex(1, 1, 4)).toBe(2);
  });

  it("desativa autoplay em pausa, movimento reduzido ou lista unitária", () => {
    expect(shouldAutoplay({ paused: false, reducedMotion: false, slideCount: 4 })).toBe(true);
    expect(shouldAutoplay({ paused: true, reducedMotion: false, slideCount: 4 })).toBe(false);
    expect(shouldAutoplay({ paused: false, reducedMotion: true, slideCount: 4 })).toBe(false);
    expect(shouldAutoplay({ paused: false, reducedMotion: false, slideCount: 1 })).toBe(false);
  });
});
