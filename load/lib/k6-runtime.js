import { check } from "k6";
import http from "k6/http";

const expectedCallbacks = new Map();

export function runRequests(baseUrl, requestHeaders, requests, isolationBreach) {
  for (const request of requests) {
    const hasBody = request.body !== undefined;
    const headers = {
      ...requestHeaders,
      ...(hasBody
        ? {
            "content-type": "application/json",
            "idempotency-key": `load-${__VU}-${__ITER}-${request.name}`,
          }
        : {}),
    };
    const response = http.request(
      request.method,
      `${baseUrl}${request.path}`,
      hasBody ? JSON.stringify(request.body) : null,
      {
        headers,
        tags: { name: request.name, kind: request.kind },
        responseCallback: expectedResponseCallback(request.expectedStatuses),
      },
    );
    check(
      response,
      { [`${request.name}.status`]: (result) => request.expectedStatuses.includes(result.status) },
      { name: request.name, kind: request.kind },
    );
    if (request.isolationProbe && isolationBreach) {
      isolationBreach.add(response.status === 200, { name: request.name });
    }
  }
}

function expectedResponseCallback(statuses) {
  const key = statuses.join(",");
  const existing = expectedCallbacks.get(key);
  if (existing) return existing;
  const callback = http.expectedStatuses(...statuses);
  expectedCallbacks.set(key, callback);
  return callback;
}
