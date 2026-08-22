import { useSyncExternalStore } from "react";

type InstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

export type PwaInstallState = "installed" | "installable" | "installing" | "manual" | "unsupported";
export type PwaUpdateState = "checking" | "current" | "available" | "applying" | "error";

export interface PwaSnapshot {
  install: PwaInstallState;
  update: PwaUpdateState;
  secureContext: boolean;
  serviceWorker: boolean;
  message: string | null;
}

const listeners = new Set<() => void>();
const updateCheckIntervalMs = 15 * 60 * 1_000;
let promptEvent: InstallPromptEvent | null = null;
let registration: ServiceWorkerRegistration | null = null;
let updateCheck: Promise<void> | null = null;
let applyingUpdate = false;
let initialized = false;
let snapshot: PwaSnapshot = {
  install: "unsupported",
  update: "checking",
  secureContext: false,
  serviceWorker: false,
  message: null,
};

function standalone() {
  return window.matchMedia("(display-mode: standalone)").matches;
}

function publish(patch: Partial<PwaSnapshot>) {
  snapshot = { ...snapshot, ...patch };
  for (const listener of listeners) listener();
}

function watchRegistration(next: ServiceWorkerRegistration) {
  registration = next;
  if (next.waiting) publish({ serviceWorker: true, update: "available" });
  else publish({ serviceWorker: true, update: "current" });
  next.addEventListener("updatefound", () => {
    const worker = next.installing;
    if (!worker) return;
    publish({ update: "checking" });
    worker.addEventListener("statechange", () => {
      if (worker.state === "installed") {
        publish({ update: navigator.serviceWorker.controller ? "available" : "current" });
      }
    });
  });
}

function checkForUpdate(reportFailure = false) {
  if (!registration || updateCheck) return updateCheck ?? Promise.resolve();
  publish({ update: registration.waiting ? "available" : "checking" });
  updateCheck = registration
    .update()
    .then(() => {
      if (!registration?.installing) {
        publish({ update: registration?.waiting ? "available" : "current" });
      }
    })
    .catch((error: unknown) => {
      if (reportFailure) {
        publish({
          update: "error",
          message:
            error instanceof Error ? error.message : "Não foi possível verificar atualizações.",
        });
      } else {
        publish({ update: registration?.waiting ? "available" : "current" });
      }
    })
    .finally(() => {
      updateCheck = null;
    });
  return updateCheck;
}

function registerUpdateChecks() {
  window.setInterval(() => void checkForUpdate(), updateCheckIntervalMs);
  window.addEventListener("online", () => void checkForUpdate());
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") void checkForUpdate();
  });
}

export function initializePwa() {
  if (initialized || typeof window === "undefined") return;
  initialized = true;
  const supported = "serviceWorker" in navigator;
  publish({
    install: standalone() ? "installed" : "manual",
    secureContext: window.isSecureContext,
    serviceWorker: false,
    update: supported ? "checking" : "error",
    message: supported ? null : "Este navegador não oferece instalação PWA.",
  });

  window.addEventListener("beforeinstallprompt", (event) => {
    event.preventDefault();
    promptEvent = event as InstallPromptEvent;
    publish({ install: "installable", message: null });
  });
  window.addEventListener("appinstalled", () => {
    promptEvent = null;
    publish({ install: "installed", message: "GiroMesa instalado neste dispositivo." });
  });
  navigator.serviceWorker?.addEventListener("controllerchange", () => {
    if (applyingUpdate) window.location.reload();
    else publish({ update: "current" });
  });

  if (!import.meta.env.PROD) {
    publish({
      update: "current",
      message: "A instalação PWA é validada no build publicado.",
    });
    return;
  }

  if (!supported || !window.isSecureContext) {
    publish({
      update: "error",
      message: !window.isSecureContext
        ? "A instalação exige HTTPS ou localhost."
        : "Service worker indisponível.",
    });
    return;
  }

  const register = () => {
    void navigator.serviceWorker
      .register(new URL("sw.js", document.baseURI), {
        scope: new URL("./", document.baseURI).pathname,
        updateViaCache: "none",
      })
      .then((next) => {
        watchRegistration(next);
        registerUpdateChecks();
        return checkForUpdate(true);
      })
      .catch((error: unknown) =>
        publish({
          update: "error",
          message: error instanceof Error ? error.message : "Não foi possível preparar o app.",
        }),
      );
  };

  if (document.readyState === "complete") register();
  else window.addEventListener("load", register, { once: true });
}

export async function requestPwaInstall() {
  if (!promptEvent) {
    publish({ install: standalone() ? "installed" : "manual" });
    return;
  }
  const current = promptEvent;
  publish({ install: "installing", message: null });
  await current.prompt();
  const choice = await current.userChoice;
  promptEvent = null;
  publish({
    install: choice.outcome === "accepted" ? "installed" : "manual",
    message: choice.outcome === "accepted" ? "Instalação aceita." : "Instalação cancelada.",
  });
}

export function applyPwaUpdate() {
  if (!registration?.waiting) return;
  applyingUpdate = true;
  publish({ update: "applying", message: "Aplicando atualização…" });
  registration.waiting.postMessage({ type: "SKIP_WAITING" });
}

export function getPwaSnapshot() {
  return snapshot;
}

const serverSnapshot: PwaSnapshot = {
  install: "unsupported",
  update: "checking",
  secureContext: false,
  serviceWorker: false,
  message: null,
};

export function usePwaSnapshot() {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    getPwaSnapshot,
    () => serverSnapshot,
  );
}
