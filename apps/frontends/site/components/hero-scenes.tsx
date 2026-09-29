"use client";

import Image from "next/image";
import { useEffect, useId, useRef, useState } from "react";

// Illustrative environments only. Product UI is shown separately using real captures.
const scenes = ["restaurante", "bar", "cafeteria"];

export function HeroScenes() {
  const ref = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);
  const [active, setActive] = useState(0);
  const photosId = useId();

  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    let inView = false;
    const update = () => setVisible(inView && !document.hidden);
    const observer = new IntersectionObserver(
      ([entry]) => {
        inView = (entry?.intersectionRatio ?? 0) >= 0.2;
        update();
      },
      { threshold: 0.2 },
    );
    observer.observe(element);
    document.addEventListener("visibilitychange", update);
    return () => {
      observer.disconnect();
      document.removeEventListener("visibilitychange", update);
    };
  }, []);

  return (
    <div ref={ref} className="hero-scenes" data-running={visible}>
      <div id={photosId} className="hero-scenes__photos" aria-hidden="true">
        {scenes.map((scene, index) => (
          <Image
            key={scene}
            src={`/hero/${scene}.png`}
            alt=""
            fill
            sizes="100vw"
            loading={index === 0 ? "eager" : "lazy"}
            fetchPriority={index === 0 ? "high" : undefined}
            className="hero-scenes__photo"
            data-active={active === index}
          />
        ))}
      </div>
      <div className="container hero-scenes__footer">
        <div className="hero-scenes__indicators">
          {scenes.map((scene, index) => (
            <button
              key={scene}
              type="button"
              className="hero-scenes__tab"
              aria-label={`Mostrar ${scene}`}
              aria-controls={photosId}
              aria-current={active === index ? "true" : undefined}
              onClick={() => setActive(index)}
            >
              <span className="hero-scenes__indicator" aria-hidden="true">
                {active === index ? (
                  <span
                    className="hero-scenes__progress"
                    onAnimationEnd={() => setActive((current) => (current + 1) % scenes.length)}
                  />
                ) : null}
              </span>
            </button>
          ))}
        </div>
        <span>Cenas ilustrativas</span>
      </div>
    </div>
  );
}
