"use client";

import Image from "next/image";
import { useEffect, useId, useRef, useState, useSyncExternalStore } from "react";
import { productSwipeStep } from "../lib/product-showcase";

export type ProductSlide = {
  src: string;
  alt: string;
  label: string;
  description?: string;
  width: number;
  height: number;
};

const motionQuery = "(prefers-reduced-motion: reduce)";
const serverReducedMotion = () => true;
const getReducedMotion = () => window.matchMedia(motionQuery).matches;
function subscribeReducedMotion(notify: () => void) {
  const query = window.matchMedia(motionQuery);
  query.addEventListener("change", notify);
  return () => query.removeEventListener("change", notify);
}
const serverHidden = () => true;
const getHidden = () => document.hidden;
function subscribeVisibility(notify: () => void) {
  document.addEventListener("visibilitychange", notify);
  return () => document.removeEventListener("visibilitychange", notify);
}

export function ProductShowcase({ slides }: { slides: ProductSlide[] }) {
  const [index, setIndex] = useState(0);
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [failedSource, setFailedSource] = useState<string | null>(null);
  const [inView, setInView] = useState(false);
  const container = useRef<HTMLElement>(null);
  const gesture = useRef<{ id: number; x: number; y: number } | null>(null);
  const viewportId = useId();
  const reduceMotion = useSyncExternalStore(
    subscribeReducedMotion,
    getReducedMotion,
    serverReducedMotion,
  );
  const hidden = useSyncExternalStore(subscribeVisibility, getHidden, serverHidden);
  const count = slides.length;
  const active = count ? index % count : 0;
  const slide = slides[active];
  const rotating =
    count > 1 && !hovered && !focused && !dragging && !reduceMotion && failedSource !== slide?.src;

  useEffect(() => {
    if (count === 0) return;
    const element = container.current;
    if (!element) return;
    const observer = new IntersectionObserver(
      ([entry]) => setInView(entry?.isIntersecting ?? false),
      {
        threshold: 0.2,
      },
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, [count]);

  function changeSlide(next: number) {
    setIndex((next + count) % count);
  }

  if (!slide) return null;

  return (
    <section
      className="product-showcase"
      data-running={rotating && !hidden && inView}
      ref={container}
      aria-roledescription="carrossel"
      aria-label="Conheça as telas do GiroMesa"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onFocusCapture={(event) => {
        setFocused(event.target.matches(":focus-visible"));
      }}
      onBlurCapture={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) setFocused(false);
      }}
    >
      <div className="product-showcase__copy" aria-live={rotating ? "off" : "polite"}>
        <h3>{slide.label}</h3>
        {slide.description ? <p>{slide.description}</p> : null}
      </div>
      <div
        id={viewportId}
        className="product-showcase__viewport"
        style={{
          touchAction: "pan-y pinch-zoom",
          userSelect: "none",
        }}
        onPointerDown={(event) => {
          if (!event.isPrimary || event.button !== 0 || count < 2) return;
          setDragging(true);
          gesture.current = { id: event.pointerId, x: event.clientX, y: event.clientY };
          event.currentTarget.setPointerCapture(event.pointerId);
        }}
        onPointerUp={(event) => {
          setDragging(false);
          const start = gesture.current;
          gesture.current = null;
          if (!start || start.id !== event.pointerId) return;
          const step = productSwipeStep(event.clientX - start.x, event.clientY - start.y);
          if (step) changeSlide(active + step);
        }}
        onPointerCancel={() => {
          setDragging(false);
          gesture.current = null;
        }}
        onLostPointerCapture={() => {
          setDragging(false);
          gesture.current = null;
        }}
      >
        {failedSource === slide.src ? (
          <p className="product-showcase__caption" role="status">
            Captura indisponível no momento.
          </p>
        ) : (
          <Image
            key={slide.src}
            className="product-showcase__image"
            data-active="true"
            src={slide.src}
            unoptimized={!slide.src.startsWith("/")}
            alt={slide.alt}
            width={slide.width}
            height={slide.height}
            sizes="(max-width: 1180px) 100vw, 1180px"
            loading="eager"
            draggable={false}
            onError={() => {
              setFailedSource(slide.src);
            }}
          />
        )}
      </div>
      {count > 1 ? (
        <div className="product-showcase__controls">
          <div className="product-showcase__indicators">
            {slides.map((item, position) => (
              <button
                key={item.src}
                type="button"
                className="product-showcase__tab"
                aria-label={`Mostrar ${item.label}`}
                title={item.label}
                aria-controls={viewportId}
                aria-current={position === active ? "true" : undefined}
                onClick={() => changeSlide(position)}
              >
                <span className="product-showcase__indicator" aria-hidden="true">
                  {position === active ? (
                    <span
                      className="product-showcase__progress"
                      onAnimationEnd={() => changeSlide(active + 1)}
                    />
                  ) : null}
                </span>
              </button>
            ))}
          </div>
          {[-1, 1].map((step) => (
            <button
              key={step}
              type="button"
              className="product-showcase__arrow"
              aria-label={step === -1 ? "Módulo anterior" : "Próximo módulo"}
              aria-controls={viewportId}
              onClick={() => changeSlide(active + step)}
            >
              <svg
                width="20"
                height="20"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
                focusable="false"
              >
                <path d={step === -1 ? "m14 6-6 6 6 6" : "m10 6 6 6-6 6"} />
              </svg>
            </button>
          ))}
        </div>
      ) : null}
    </section>
  );
}
