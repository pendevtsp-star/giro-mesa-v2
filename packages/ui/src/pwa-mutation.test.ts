import { describe, expect, it, vi } from "vitest";
import {
  createPwaFetch,
  getPwaMutationCount,
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

  it("não conta duas vezes quando um wrapper chama o fetch instrumentado", async () => {
    let finish: ((response: Response) => void) | undefined;
    const trackedFetch = createPwaFetch(
      () =>
        new Promise<Response>((resolve) => {
          finish = resolve;
        }),
    );

    const mutation = withPwaMutation(() =>
      trackedFetch("https://example.test/orders", { method: "PATCH" }),
    );
    expect(getPwaMutationCount()).toBe(1);
    finish?.(new Response(null, { status: 204 }));
    await mutation;
    expect(getPwaMutationCount()).toBe(0);
  });
});
