import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { describe, expect, it } from "vitest";
import {
  canShowOperationalNotification,
  decodeWebPushPublicKey,
  sameWebPushApplicationServerKey,
} from "./pwa";

const serviceWorkerSource = readFileSync(new URL("../public/sw.js", import.meta.url), "utf8");

async function serviceWorkerPushUrl(payload: unknown) {
  type PushEvent = {
    data: { json: () => unknown };
    waitUntil: (work: Promise<unknown>) => void;
  };
  let pushHandler: ((event: PushEvent) => void) | undefined;
  let notificationOptions: { data?: { url?: string } } | undefined;
  const pending: Promise<unknown>[] = [];
  runInNewContext(serviceWorkerSource, {
    URL,
    self: {
      registration: {
        scope: "https://ops.example.test/app/",
        showNotification: (_title: string, options: typeof notificationOptions) => {
          notificationOptions = options;
          return Promise.resolve();
        },
      },
      addEventListener: (type: string, handler: (event: PushEvent) => void) => {
        if (type === "push") pushHandler = handler;
      },
    },
  });
  if (!pushHandler) throw new Error("Service worker não registrou o evento push.");
  pushHandler({
    data: { json: () => payload },
    waitUntil: (work) => pending.push(work),
  });
  await Promise.all(pending);
  return notificationOptions?.data?.url;
}

describe("notificações operacionais", () => {
  it("notifica somente com consentimento e app em segundo plano", () => {
    expect(canShowOperationalNotification("granted", true)).toBe(true);
    expect(canShowOperationalNotification("granted", false)).toBe(false);
    expect(canShowOperationalNotification("denied", true)).toBe(false);
  });

  it("converte e compara a chave VAPID base64url usada pelo PushManager", () => {
    const key = decodeWebPushPublicKey("AQID_v8");
    expect([...key]).toEqual([1, 2, 3, 254, 255]);
    expect(sameWebPushApplicationServerKey(key.buffer as ArrayBuffer, key)).toBe(true);
    expect(sameWebPushApplicationServerKey(new Uint8Array([1, 2]).buffer, key)).toBe(false);
  });

  it("mantém somente deep-links operacionais estritos recebidos por Web Push", async () => {
    const tableId = "11111111-1111-4111-8111-111111111111";
    const tabId = "22222222-2222-4222-8222-222222222222";
    expect(await serviceWorkerPushUrl({ route: `#/salon?table=${tableId}` })).toBe(
      `https://ops.example.test/app/#/salon?table=${tableId}`,
    );
    expect(await serviceWorkerPushUrl({ route: `#/counter?tab=${tabId}` })).toBe(
      `https://ops.example.test/app/#/counter?tab=${tabId}`,
    );
    expect(
      await serviceWorkerPushUrl({ route: `#/salon?table=${tableId}&redirect=https://evil.test` }),
    ).toBe("https://ops.example.test/app/#/salon");
  });
});
