export function shouldShowRefreshProgress(
  hasConfirmedData: boolean,
  retryChanged: boolean,
  resourceChanged = false,
): boolean {
  return hasConfirmedData && (retryChanged || resourceChanged);
}

export function isCurrentRemoteRequest(
  requestId: number,
  currentRequestId: number,
  scopeKey: string,
  currentScopeKey: string,
): boolean {
  return requestId === currentRequestId && scopeKey === currentScopeKey;
}
