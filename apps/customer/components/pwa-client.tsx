"use client";

import {
  getPwaMutationCount,
  requestPwaActivation,
  subscribePwaMutations,
  withPwaMutation,
} from "@giromesa/ui/pwa-mutation";
import { useEffect, useRef, useState } from "react";

export { withPwaMutation as withCustomerPwaMutation };

export function PwaClient() {
  const [online, setOnline] = useState(true);
  const [waiting, setWaiting] = useState<ServiceWorker | null>(null);
  const [mutationCount, setMutationCount] = useState(getPwaMutationCount);
  const activationRequested = useRef(false);

  useEffect(() => {
    setOnline(navigator.onLine);
    const unsubscribeMutations = subscribePwaMutations(setMutationCount);
    const onOnline = () => setOnline(true);
    const onOffline = () => setOnline(false);
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);

    if (!("serviceWorker" in navigator)) {
      return () => {
        unsubscribeMutations();
        window.removeEventListener("online", onOnline);
        window.removeEventListener("offline", onOffline);
      };
    }

    const onControllerChange = () => {
      if (activationRequested.current) window.location.reload();
    };
    navigator.serviceWorker.addEventListener("controllerchange", onControllerChange);
    let disposed = false;
    void navigator.serviceWorker
      .register("/sw.js", { scope: "/", type: "module", updateViaCache: "none" })
      .then((registration) => {
        if (disposed) return;
        if (registration.waiting) setWaiting(registration.waiting);
        registration.addEventListener("updatefound", () => {
          const installing = registration.installing;
          installing?.addEventListener("statechange", () => {
            if (installing.state === "installed" && navigator.serviceWorker.controller) {
              setWaiting(registration.waiting ?? installing);
            }
          });
        });
        void registration.update();
      })
      .catch(() => undefined);

    return () => {
      disposed = true;
      unsubscribeMutations();
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
      navigator.serviceWorker.removeEventListener("controllerchange", onControllerChange);
    };
  }, []);

  function activate() {
    if (requestPwaActivation(waiting) !== "activated") return;
    activationRequested.current = true;
  }

  return (
    <>
      {!online && (
        <div aria-label="Conectividade PWA" className="pwa-connectivity" role="status">
          <strong>Offline.</strong> O conteúdo visível pode estar desatualizado; nenhuma confirmação
          nova será presumida.
        </div>
      )}
      {waiting && (
        <section aria-label="Atualização do aplicativo" className="pwa-update" role="status">
          <div>
            <strong>Atualização pronta</strong>
            <span>
              {mutationCount > 0
                ? "Concluindo a ação em andamento antes de atualizar."
                : "A versão atual permanece ativa até você confirmar."}
            </span>
          </div>
          <button disabled={mutationCount > 0} onClick={activate} type="button">
            Atualizar agora
          </button>
          <button onClick={() => setWaiting(null)} type="button">
            Mais tarde
          </button>
        </section>
      )}
    </>
  );
}
