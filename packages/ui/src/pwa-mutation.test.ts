import { describe, expect, it, vi } from "vitest";
import {
  beginPwaMutation,
  cancelPwaActivation,
  createPwaFetch,
  endPwaMutation,
  getPwaMutationCount,
  isPwaActivationPending,
  PwaActivationInProgressError,
  requestPwaActivation,
  subscribePwaMutations,
  withPwaMutation,
} from "./pwa-mutation";

describe("fronteira compartilhada de mutações PWA", () => {
  it("mantém mutação atrasada ativa até o response e ignora leituras", async () => {
    let finish: ((response: Response) => void) | undefined;
    const rawFetch = vi.fn(
      () =>
        new Promise<Response>((resolve) => {
          finish = resolve;
        }),
    );
    const trackedFetch = createPwaFetch(rawFetch);
    const counts: number[] = [];
    const unsubscribe = subscribePwaMutations((count) => counts.push(count));

    const read = trackedFetch("https://example.test/health");
    expect(getPwaMutationCount()).toBe(0);
    finish?.(new Response(null, { status: 204 }));
    await read;

    const mutation = trackedFetch("https://example.test/orders", { method: "POST" });
    expect(getPwaMutationCount()).toBe(1);
    finish?.(new Response(null, { status: 204 }));
    await mutation;

    expect(getPwaMutationCount()).toBe(0);
    expect(counts).toEqual([0, 1, 0]);
    unsubscribe();
  });

  it("não conta duas vezes quando um wrapper atrasado propaga seu contexto ao fetch", async () => {
    let finish: ((response: Response) => void) | undefined;
    const trackedFetch = createPwaFetch(
      () =>
        new Promise<Response>((resolve) => {
          finish = resolve;
        }),
    );

    const counts: number[] = [];
    const unsubscribe = subscribePwaMutations((count) => counts.push(count));
    const mutation = withPwaMutation(async (context) => {
      await Promise.resolve();
      return trackedFetch("https://example.test/orders", { method: "PATCH" }, context);
    });
    await Promise.resolve();
    expect(getPwaMutationCount()).toBe(1);
    finish?.(new Response(null, { status: 204 }));
    await mutation;
    expect(getPwaMutationCount()).toBe(0);
    expect(counts).toEqual([0, 1, 0]);
    unsubscribe();
  });

  it("conta mutações paralelas independentes mesmo com outra boundary aguardando", async () => {
    let finishBoundary: (() => void) | undefined;
    let finishParallel: ((response: Response) => void) | undefined;
    const boundary = withPwaMutation(
      () =>
        new Promise<void>((resolve) => {
          finishBoundary = resolve;
        }),
    );
    const trackedFetch = createPwaFetch(
      () =>
        new Promise<Response>((resolve) => {
          finishParallel = resolve;
        }),
    );

    const parallel = trackedFetch("https://example.test/orders", { method: "POST" });
    expect(getPwaMutationCount()).toBe(2);
    finishParallel?.(new Response(null, { status: 204 }));
    await parallel;
    expect(getPwaMutationCount()).toBe(1);
    finishBoundary?.();
    await boundary;
    expect(getPwaMutationCount()).toBe(0);
  });

  it("reconsulta o contador autoritativo antes de ativar o worker", () => {
    const waiting = { postMessage: vi.fn() };
    beginPwaMutation();
    expect(requestPwaActivation(waiting)).toBe("blocked");
    expect(waiting.postMessage).not.toHaveBeenCalled();
    endPwaMutation();
    expect(requestPwaActivation(waiting)).toBe("activated");
    cancelPwaActivation();
  });

  it("fecha a janela entre SKIP_WAITING e o reload contra novas mutações", async () => {
    const waiting = { postMessage: vi.fn() };
    expect(requestPwaActivation(waiting)).toBe("activated");
    expect(isPwaActivationPending()).toBe(true);
    expect(() => beginPwaMutation()).toThrow(PwaActivationInProgressError);
    expect(() => withPwaMutation(async () => new Response(null, { status: 204 }))).toThrow(
      PwaActivationInProgressError,
    );
    expect(getPwaMutationCount()).toBe(0);

    cancelPwaActivation();
    await expect(
      withPwaMutation(async () => new Response(null, { status: 204 })),
    ).resolves.toBeInstanceOf(Response);
    expect(getPwaMutationCount()).toBe(0);
  });

  it("libera o latch quando o postMessage falha antes da ativação", () => {
    const waiting = {
      postMessage: vi.fn(() => {
        throw new Error("worker indisponível");
      }),
    };
    expect(requestPwaActivation(waiting)).toBe("unavailable");
    expect(isPwaActivationPending()).toBe(false);
  });
});
