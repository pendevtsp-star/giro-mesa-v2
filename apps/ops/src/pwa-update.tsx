import {
  beginPwaMutation,
  endPwaMutation,
  getPwaMutationCount,
  requestPwaActivation,
  subscribePwaMutations,
  withPwaMutation,
} from "@giromesa/ui/pwa-mutation";
import { useEffect, useRef, useState } from "react";

export { beginPwaMutation, endPwaMutation, requestPwaActivation, withPwaMutation };

const DATABASE_NAME = "giromesa-ops-pwa";
const DATABASE_VERSION = 2;
const METADATA_STORE = "runtime-metadata";
const RECORD_SCHEMA_VERSION = 2;

type PwaRecord = { key: string; schemaVersion: number; expiresAt: number };

export function retainFreshPwaRecords<T extends PwaRecord>(records: T[], now = Date.now()): T[] {
  return records.filter(
    (record) => record.schemaVersion === RECORD_SCHEMA_VERSION && record.expiresAt > now,
  );
}

export async function clearPwaRuntimeState() {
  navigator.serviceWorker?.controller?.postMessage({ type: "CLEAR_RUNTIME_CACHE" });
  if (!("indexedDB" in window)) return;
  await new Promise<void>((resolve) => {
    const request = indexedDB.deleteDatabase(DATABASE_NAME);
    request.addEventListener("success", () => resolve(), { once: true });
    request.addEventListener("error", () => resolve(), { once: true });
    request.addEventListener("blocked", () => resolve(), { once: true });
  });
}

export function PwaUpdate() {
  const [online, setOnline] = useState(() => navigator.onLine);
  const [waiting, setWaiting] = useState<ServiceWorker | null>(null);
  const [mutationCount, setMutationCount] = useState(getPwaMutationCount);
  const [activationBlocked, setActivationBlocked] = useState(false);
  const activationRequested = useRef(false);

  useEffect(() => {
    const unsubscribeMutations = subscribePwaMutations(setMutationCount);
    const onOnline = () => setOnline(true);
    const onOffline = () => setOnline(false);
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);

    void preparePwaStorage();
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

  function activateUpdate() {
    const result = requestPwaActivation(waiting);
    setActivationBlocked(result === "blocked");
    if (result === "activated") activationRequested.current = true;
  }

  return (
    <>
      {!online && (
        <div aria-label="Conectividade PWA" className="pwa-connectivity" role="status">
          <strong>Offline.</strong> Consulte os estados locais; confirmações dependem da reconexão
          ou do Hub da unidade.
        </div>
      )}
      {waiting && (
        <section aria-label="Atualização do aplicativo" className="pwa-update" role="status">
          <div>
            <strong>Atualização pronta</strong>
            <span>
              {mutationCount > 0 || activationBlocked
                ? "Concluindo a ação em andamento antes de atualizar."
                : "A versão atual permanece ativa até você confirmar."}
            </span>
          </div>
          <button disabled={mutationCount > 0} onClick={activateUpdate} type="button">
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

async function preparePwaStorage() {
  if (!("indexedDB" in window)) return;
  await new Promise<void>((resolve) => {
    const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
    request.addEventListener("upgradeneeded", () => {
      const database = request.result;
      for (const legacyStore of ["session", "runtime-cache-v1"]) {
        if (database.objectStoreNames.contains(legacyStore))
          database.deleteObjectStore(legacyStore);
      }
      if (!database.objectStoreNames.contains(METADATA_STORE)) {
        database.createObjectStore(METADATA_STORE, { keyPath: "key" });
      }
    });
    request.addEventListener(
      "success",
      () => {
        const database = request.result;
        const transaction = database.transaction(METADATA_STORE, "readwrite");
        const store = transaction.objectStore(METADATA_STORE);
        const cursor = store.openCursor();
        cursor.addEventListener("success", () => {
          const current = cursor.result;
          if (!current) return;
          const record = current.value as PwaRecord;
          if (!retainFreshPwaRecords([record]).length) current.delete();
          current.continue();
        });
        transaction.addEventListener("complete", () => {
          database.close();
          resolve();
        });
        transaction.addEventListener("error", () => {
          database.close();
          resolve();
        });
      },
      { once: true },
    );
    request.addEventListener("error", () => resolve(), { once: true });
  });
}
