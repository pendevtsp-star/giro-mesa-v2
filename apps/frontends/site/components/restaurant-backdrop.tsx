"use client";

import { useEffect, useId, useRef } from "react";

export function RestaurantBackdrop() {
  const ref = useRef<HTMLDivElement>(null);
  const patternId = useId();

  useEffect(() => {
    const element = ref.current;
    const surface = element?.parentElement;
    if (!element || !surface) return;
    const motion = window.matchMedia("(prefers-reduced-motion: reduce)");
    let frame = 0;

    const move = (event: PointerEvent) => {
      if (motion.matches) return;
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const bounds = surface.getBoundingClientRect();
        element.style.setProperty("--pointer-x", `${event.clientX - bounds.left}px`);
        element.style.setProperty("--pointer-y", `${event.clientY - bounds.top}px`);
        element.style.setProperty("--pointer-active", "1");
      });
    };
    const reset = () => {
      cancelAnimationFrame(frame);
      element.style.setProperty("--pointer-active", "0");
    };
    surface.addEventListener("pointermove", move, { passive: true });
    surface.addEventListener("pointerleave", reset);
    surface.addEventListener("pointercancel", reset);
    motion.addEventListener("change", reset);
    return () => {
      reset();
      surface.removeEventListener("pointermove", move);
      surface.removeEventListener("pointerleave", reset);
      surface.removeEventListener("pointercancel", reset);
      motion.removeEventListener("change", reset);
    };
  }, []);

  return (
    <div ref={ref} className="restaurant-backdrop" aria-hidden="true">
      <svg width="100%" height="100%" focusable="false" aria-hidden="true">
        <defs>
          <pattern id={patternId} width="440" height="380" patternUnits="userSpaceOnUse">
            <g fill="none" stroke="currentColor" strokeWidth="1.2">
              <circle cx="320" cy="96" r="34" />
              <path d="M306 49h28M306 143h28M273 82v28M367 82v28" strokeLinecap="round" />
              <rect x="74" y="245" width="108" height="58" rx="16" />
              <path
                d="M90 232h24m28 0h24M90 316h24m28 0h24M61 262v24m134-24v24"
                strokeLinecap="round"
              />
            </g>
          </pattern>
        </defs>
        <rect width="100%" height="100%" fill={`url(#${patternId})`} />
      </svg>
    </div>
  );
}
