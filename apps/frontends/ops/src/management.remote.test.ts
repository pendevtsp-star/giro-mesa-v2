import { describe, expect, it, vi } from "vitest";
import { loadManagementRemote } from "./management.shared";

describe("loadManagementRemote", () => {
  it("deduplica chamadas em andamento e reutiliza o resultado por poucos segundos", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-21T12:00:00Z"));
    let resolveRequest: ((value: unknown) => void) | undefined;
    const loader = vi.fn(
      () =>
        new Promise<unknown>((resolve) => {
          resolveRequest = resolve;
        }),
    );
    const parser = (value: unknown) => String(value);

    const first = loadManagementRemote(loader, parser, "org-1", "unit-1");
    const duplicate = loadManagementRemote(loader, parser, "org-1", "unit-1");
    await Promise.resolve();

    expect(loader).toHaveBeenCalledTimes(1);
    resolveRequest?.("dados");
    await expect(Promise.all([first, duplicate])).resolves.toEqual(["dados", "dados"]);
    await expect(loadManagementRemote(loader, parser, "org-1", "unit-1")).resolves.toBe("dados");
    expect(loader).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(5_001);
    const expired = loadManagementRemote(loader, parser, "org-1", "unit-1");
    await Promise.resolve();
    expect(loader).toHaveBeenCalledTimes(2);
    resolveRequest?.("novos dados");
    await expect(expired).resolves.toBe("novos dados");
    vi.useRealTimers();
  });

  it("ignora o valor pronto no refresh, mas nao duplica um refresh em andamento", async () => {
    let resolveRefresh: ((value: unknown) => void) | undefined;
    const loader = vi
      .fn<() => Promise<unknown>>()
      .mockResolvedValueOnce("inicial")
      .mockImplementationOnce(
        () =>
          new Promise<unknown>((resolve) => {
            resolveRefresh = resolve;
          }),
      );
    const parser = (value: unknown) => String(value);

    await expect(loadManagementRemote(loader, parser, "org-2", "unit-2")).resolves.toBe("inicial");
    const refresh = loadManagementRemote(loader, parser, "org-2", "unit-2", true);
    const duplicate = loadManagementRemote(loader, parser, "org-2", "unit-2", true);
    await Promise.resolve();

    expect(loader).toHaveBeenCalledTimes(2);
    resolveRefresh?.("atualizado");
    await expect(Promise.all([refresh, duplicate])).resolves.toEqual(["atualizado", "atualizado"]);
  });
});
