import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

const visitorCookie = "gm_visitor";
const visitorHeader = "x-giromesa-visitor-id";

function validVisitorId(value: string | undefined): value is string {
  return Boolean(value && /^[0-9a-f-]{36}$/i.test(value));
}

export function proxy(request: NextRequest) {
  const current = request.cookies.get(visitorCookie)?.value;
  const visitorId = validVisitorId(current) ? current : crypto.randomUUID();
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set(visitorHeader, visitorId);
  const response = NextResponse.next({ request: { headers: requestHeaders } });
  if (!validVisitorId(current)) {
    response.cookies.set(visitorCookie, visitorId, {
      httpOnly: true,
      maxAge: 60 * 60 * 24 * 365,
      path: "/",
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
    });
  }
  return response;
}

export const config = { matcher: ["/", "/teste-gratis", "/contato"] };
