import type { OperationalPushSubscription } from "@giromesa/contracts";
import { useSyncExternalStore } from "react";

type InstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

export type PwaInstallState = "installed" | "installable" | "installing" | "manual" | "unsupported";
export type PwaUpdateState = "checking" | "current" | "available" | "applying" | "error";
export type NotificationState = NotificationPermission | "unsupported";

export interface PwaSnapshot {
  install: PwaInstallState;
  update: PwaUpdateState;
  secureContext: boolean;
  serviceWorker: boolean;
  notifications: NotificationState;
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
  notifications: "unsupported",
  message: null,
};

const browserInstallationStorageKey = "giromesa:browser-installation-id";

export function operationalPushInstallationId() {
  if (typeof window === "undefined") return "00000000-0000-4000-8000-000000000000";
  try {
    const stored = window.localStorage.getItem(browserInstallationStorageKey);
    if (
      stored &&
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(stored)
    ) {
      return stored;
    }
    const created = crypto.randomUUID();
    window.localStorage.setItem(browserInstallationStorageKey, created);
    return created;
  } catch {
    return crypto.randomUUID();
  }
}

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
  const notifications = "Notification" in window ? Notification.permission : "unsupported";
  publish({
    install: standalone() ? "installed" : "manual",
    secureContext: window.isSecureContext,
    serviceWorker: false,
    notifications,
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

export async function requestOperationalNotifications() {
  if (!("Notification" in window)) {
    publish({ notifications: "unsupported" });
    return "unsupported" as const;
  }
  const permission = await Notification.requestPermission();
  publish({ notifications: permission });
  return permission;
}

export function decodeWebPushPublicKey(value: string) {
  const padding = "=".repeat((4 - (value.length % 4)) % 4);
  return Uint8Array.from(
    atob(`${value.replaceAll("-", "+").replaceAll("_", "/")}${padding}`),
    (character) => character.charCodeAt(0),
  );
}

export function sameWebPushApplicationServerKey(left: ArrayBuffer | null, right: Uint8Array) {
  if (!left || left.byteLength !== right.byteLength) return false;
  const bytes = new Uint8Array(left);
  return bytes.every((value, index) => value === right[index]);
}

function pushSubscriptionPayload(subscription: PushSubscription): OperationalPushSubscription {
  const json = subscription.toJSON();
  if (!json.endpoint || !json.keys?.p256dh || !json.keys.auth) {
    throw new Error("WEB_PUSH_SUBSCRIPTION_INVALID");
  }
  return {
    endpoint: json.endpoint,
    expirationTime: json.expirationTime ?? null,
    keys: { p256dh: json.keys.p256dh, auth: json.keys.auth },
  };
}

async function pushRegistration() {
  if (
    !("serviceWorker" in navigator) ||
    !("PushManager" in window) ||
    !("Notification" in window) ||
    !window.isSecureContext
  ) {
    return null;
  }
  return registration ?? navigator.serviceWorker.getRegistration();
}

export async function currentOperationalPushSubscription() {
  const worker = await pushRegistration();
  const subscription = await worker?.pushManager.getSubscription();
  return subscription ? pushSubscriptionPayload(subscription) : null;
}

export async function requestOperationalPush(publicKey: string) {
  const worker = await pushRegistration();
  if (!worker) return { permission: "unsupported" as const, subscription: null };
  const permission = await Notification.requestPermission();
  publish({ notifications: permission });
  if (permission !== "granted") return { permission, subscription: null };
  const applicationServerKey = decodeWebPushPublicKey(publicKey);
  let subscription = await worker.pushManager.getSubscription();
  if (
    subscription &&
    !sameWebPushApplicationServerKey(
      subscription.options.applicationServerKey,
      applicationServerKey,
    )
  ) {
    await subscription.unsubscribe();
    subscription = null;
  }
  subscription ??= await worker.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey,
  });
  return { permission, subscription: pushSubscriptionPayload(subscription) };
}

export async function unsubscribeOperationalPush() {
  const worker = await pushRegistration();
  const subscription = await worker?.pushManager.getSubscription();
  return subscription ? subscription.unsubscribe() : true;
}

export function canShowOperationalNotification(
  permission: NotificationPermission | "unsupported",
  documentHidden: boolean,
) {
  return permission === "granted" && documentHidden;
}

export async function showOperationalNotification(input: {
  title: string;
  body: string;
  tag: string;
  route: string;
}) {
  if (
    !("Notification" in window) ||
    !canShowOperationalNotification(Notification.permission, document.hidden)
  ) {
    return false;
  }
  const options: NotificationOptions = {
    body: input.body,
    data: { url: new URL(input.route, window.location.href).toString() },
    icon: new URL("icons/giromesa-192.png", document.baseURI).toString(),
    tag: input.tag,
  };
  try {
    const worker = registration ?? (await navigator.serviceWorker?.getRegistration());
    if (worker) await worker.showNotification(input.title, options);
    else {
      const notification = new Notification(input.title, options);
      notification.onclick = () => {
        window.focus();
        window.location.href = input.route;
        notification.close();
      };
    }
    return true;
  } catch {
    return false;
  }
}

export function getPwaSnapshot() {
  return snapshot;
}

const serverSnapshot: PwaSnapshot = {
  install: "unsupported",
  update: "checking",
  secureContext: false,
  serviceWorker: false,
  notifications: "unsupported",
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
