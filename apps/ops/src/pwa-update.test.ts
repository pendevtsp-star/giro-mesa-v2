import { describe, expect, it, vi } from "vitest";
import {
  beginPwaMutation,
  cancelPwaActivation,
  endPwaMutation,
  requestPwaActivation,
  retainFreshPwaRecords,
  withPwaMutation,
} from "./pwa-update";

describe("coordenação de update da PWA operacional", () => {
  it("adiça a ativação enquanto um comando está em voo", async () => {
    let finish: (() => void) | undefined;
    const waiting = { postMessage: vi.fn() };
    const command = withPwaMutation(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );

    expect(requestPwaActivation(waiting)).toBe("blocked");
    expect(waiting.postMessage).not.toHaveBeenCalled();

    finish?.();
    await command;

    expect(requestPwaActivation(waiting)).toBe("activated");
    expect(waiting.postMessage).toHaveBeenCalledWith({ type: "SKIP_WAITING" });
    cancelPwaActivation();
  });

  it("mantém o contador consistente mesmo quando o comando falha", async () => {
    await expect(
      withPwaMutation(async () => {
        throw new Error("falha esperada");
      }),
    ).rejects.toThrow("falha esperada");

    const waiting = { postMessage: vi.fn() };
    expect(requestPwaActivation(waiting)).toBe("activated");
    cancelPwaActivation();
  });

  it("remove metadados expirados e de schema legado durante a migração", () => {
    const now = Date.parse("2026-08-11T12:00:00.000Z");
    expect(
      retainFreshPwaRecords(
        [
          { key: "current", schemaVersion: 2, expiresAt: now + 1_000 },
          { key: "expired", schemaVersion: 2, expiresAt: now - 1 },
          { key: "legacy", schemaVersion: 1, expiresAt: now + 1_000 },
        ],
        now,
      ),
    ).toEqual([{ key: "current", schemaVersion: 2, expiresAt: now + 1_000 }]);
  });

  it("bloqueia ativação com contador manual e libera após o ACK local", () => {
    const waiting = { postMessage: vi.fn() };
    beginPwaMutation();
    expect(requestPwaActivation(waiting)).toBe("blocked");
    endPwaMutation();
    expect(requestPwaActivation(waiting)).toBe("activated");
    cancelPwaActivation();
  });
});
