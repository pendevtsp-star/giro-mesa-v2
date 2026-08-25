"use client";

import { useEffect } from "react";
import type { CommercialExperiment } from "../lib/commercial";

async function idempotencyKey(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function ExperimentImpression({
  catalogVersion,
  experiments,
  visitorId,
}: {
  catalogVersion: number;
  experiments: CommercialExperiment[];
  visitorId: string;
}) {
  useEffect(() => {
    const apiUrl = process.env.NEXT_PUBLIC_API_URL?.replace(/\/$/, "");
    if (!apiUrl) return;
    for (const experiment of experiments) {
      const variant = experiment.variant;
      if (!variant) continue;
      const assignment = `${catalogVersion}:${experiment.slug}:${variant.key}:${visitorId}`;
      void idempotencyKey(assignment)
        .then(async (key) => {
          const storageKey = `gm-exp:${key}`;
          if (sessionStorage.getItem(storageKey)) return;
          const response = await fetch(`${apiUrl}/public/v1/commercial-experiment-impressions`, {
            method: "POST",
            headers: { "Content-Type": "application/json", "Idempotency-Key": key },
            body: JSON.stringify({
              catalogVersion,
              experimentSlug: experiment.slug,
              variantKey: variant.key,
              visitorId,
            }),
            keepalive: true,
          });
          if (response.ok) sessionStorage.setItem(storageKey, "1");
        })
        .catch(() => {
          // Impressão é observabilidade auxiliar e nunca bloqueia a landing.
        });
    }
  }, [catalogVersion, experiments, visitorId]);

  return null;
}
