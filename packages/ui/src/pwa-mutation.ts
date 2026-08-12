type MutationListener = (count: number) => void;
type Fetcher = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
type WaitingWorker = { postMessage(message: { type: string }): void };
type ActivationResult = "activated" | "blocked" | "unavailable";

const mutationContextBrand = Symbol("giromesa.pwa-mutation-context");
export type PwaMutationContext = { readonly [mutationContextBrand]: true };
export type PwaFetch = (
  input: RequestInfo | URL,
  init?: RequestInit,
  context?: PwaMutationContext,
) => Promise<Response>;

const READ_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);
const listeners = new Set<MutationListener>();
const activeContexts = new Set<PwaMutationContext>();
let activeMutations = 0;
let activationPending = false;

export class PwaActivationInProgressError extends Error {
  constructor() {
    super("A atualização do aplicativo já está em andamento.");
    this.name = "PwaActivationInProgressError";
  }
}

export function beginPwaMutation() {
  if (activationPending) throw new PwaActivationInProgressError();
  activeMutations += 1;
  notifyMutationListeners();
}

export function endPwaMutation() {
  activeMutations = Math.max(0, activeMutations - 1);
  notifyMutationListeners();
}

export function getPwaMutationCount() {
  return activeMutations;
}

export function isPwaActivationPending() {
  return activationPending;
}

export function cancelPwaActivation() {
  activationPending = false;
}

export function subscribePwaMutations(listener: MutationListener) {
  listeners.add(listener);
  listener(activeMutations);
  return () => listeners.delete(listener);
}

export function withPwaMutation<T>(
  work: (context: PwaMutationContext) => Promise<T>,
  context?: PwaMutationContext,
): Promise<T> {
  if (context && activeContexts.has(context)) return work(context);

  const ownContext = Object.freeze({ [mutationContextBrand]: true }) as PwaMutationContext;
  beginPwaMutation();
  activeContexts.add(ownContext);
  let result: Promise<T>;
  try {
    result = work(ownContext);
  } catch (error) {
    activeContexts.delete(ownContext);
    endPwaMutation();
    throw error;
  }

  return result.finally(() => {
    activeContexts.delete(ownContext);
    endPwaMutation();
  });
}

export function createPwaFetch(
  fetcher: Fetcher = (input, init) => globalThis.fetch(input, init),
): PwaFetch {
  return (input, init, context) => {
    const method = (
      init?.method ?? (input instanceof Request ? input.method : "GET")
    ).toUpperCase();
    if (READ_METHODS.has(method)) return fetcher(input, init);
    return withPwaMutation(() => fetcher(input, init), context);
  };
}

export function requestPwaActivation(waiting?: WaitingWorker | null): ActivationResult {
  if (!waiting) return "unavailable";
  if (activationPending || getPwaMutationCount() > 0) return "blocked";
  activationPending = true;
  try {
    waiting.postMessage({ type: "SKIP_WAITING" });
  } catch {
    activationPending = false;
    return "unavailable";
  }
  return "activated";
}

function notifyMutationListeners() {
  for (const listener of listeners) listener(activeMutations);
}
