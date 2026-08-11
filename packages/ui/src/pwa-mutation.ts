type MutationListener = (count: number) => void;
type Fetcher = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

const READ_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);
const listeners = new Set<MutationListener>();
let activeMutations = 0;
let synchronousBoundaryDepth = 0;

export function beginPwaMutation() {
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

export function subscribePwaMutations(listener: MutationListener) {
  listeners.add(listener);
  listener(activeMutations);
  return () => listeners.delete(listener);
}

export function withPwaMutation<T>(work: () => Promise<T>): Promise<T> {
  if (synchronousBoundaryDepth > 0) return work();

  beginPwaMutation();
  synchronousBoundaryDepth += 1;
  let result: Promise<T>;
  try {
    result = work();
  } catch (error) {
    endPwaMutation();
    throw error;
  } finally {
    synchronousBoundaryDepth -= 1;
  }

  return result.finally(endPwaMutation);
}

export function createPwaFetch(
  fetcher: Fetcher = (input, init) => globalThis.fetch(input, init),
): Fetcher {
  return (input, init) => {
    const method = (
      init?.method ?? (input instanceof Request ? input.method : "GET")
    ).toUpperCase();
    if (READ_METHODS.has(method)) return fetcher(input, init);
    return withPwaMutation(() => fetcher(input, init));
  };
}

function notifyMutationListeners() {
  for (const listener of listeners) listener(activeMutations);
}
