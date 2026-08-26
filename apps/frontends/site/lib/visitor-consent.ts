export const visitorCookieName = "gm_visitor";
export const visitorConsentCookieName = "gm_cookie_consent";

export type VisitorConsent = "accepted" | "rejected";
export type VisitorTrackingDecision = "create" | "clear";

export function isVisitorConsent(value: unknown): value is VisitorConsent {
  return value === "accepted" || value === "rejected";
}

export function visitorTrackingDecision(consent: string | undefined): VisitorTrackingDecision {
  return consent === "accepted" ? "create" : "clear";
}

export async function updateVisitorConsent(consent: VisitorConsent | null) {
  const response = await fetch("/api/cookie-preferences", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ consent }),
  });
  if (!response.ok) throw new Error("Não foi possível registrar a preferência de cookies.");
}
