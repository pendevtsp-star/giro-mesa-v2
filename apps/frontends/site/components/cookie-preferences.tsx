"use client";

import { useState } from "react";
import { updateVisitorConsent } from "../lib/visitor-consent";

export function CookiePreferences() {
  const [error, setError] = useState(false);

  async function resetConsent() {
    try {
      await updateVisitorConsent(null);
      window.location.reload();
    } catch {
      setError(true);
    }
  }

  return (
    <>
      <button className="footer-link-button" type="button" onClick={resetConsent}>
        Rever preferências de cookies
      </button>
      {error ? <span role="alert">Não foi possível abrir as preferências.</span> : null}
    </>
  );
}
