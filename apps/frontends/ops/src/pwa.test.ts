import { describe, expect, it } from "vitest";
import {
  canShowOperationalNotification,
  decodeWebPushPublicKey,
  sameWebPushApplicationServerKey,
} from "./pwa";

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
});
