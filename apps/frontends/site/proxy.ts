import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import {
  visitorConsentCookieName,
  visitorCookieName,
  visitorTrackingDecision,
} from "./lib/visitor-consent";

const visitorHeader = "x-giromesa-visitor-id";

function validVisitorId(value: string | undefined): value is string {
  return Boolean(value && /^[0-9a-f-]{36}$/i.test(value));
}

export function proxy(request: NextRequest) {
  const current = request.cookies.get(visitorCookieName)?.value;
  const consent = request.cookies.get(visitorConsentCookieName)?.value;
  const trackVisitor = visitorTrackingDecision(consent) === "create";
  const visitorId = trackVisitor ? (validVisitorId(current) ? current : crypto.randomUUID()) : null;
  const requestHeaders = new Headers(request.headers);
  requestHeaders.delete(visitorHeader);
  if (visitorId) requestHeaders.set(visitorHeader, visitorId);
  const response = NextResponse.next({ request: { headers: requestHeaders } });
  if (trackVisitor && visitorId && !validVisitorId(current)) {
    response.cookies.set(visitorCookieName, visitorId, {
      httpOnly: true,
      maxAge: 60 * 60 * 24 * 365,
      path: "/",
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
    });
  } else if (!trackVisitor && current) {
    response.cookies.delete(visitorCookieName);
  }
  return response;
}

export const config = { matcher: ["/", "/teste-gratis", "/contato"] };
