import "@giromesa/ui/styles.css";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { ErrorBoundary } from "./ErrorBoundary";
import { initializePwa } from "./pwa";
import "./styles.css";

const root = document.getElementById("root");
if (!root) throw new Error("Elemento #root não encontrado");

initializePwa();

createRoot(root).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>,
);
