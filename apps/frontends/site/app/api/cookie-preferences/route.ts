import { NextResponse } from "next/server";
import {
  isVisitorConsent,
  type VisitorConsent,
  visitorConsentCookieName,
  visitorCookieName,
} from "../../../lib/visitor-consent";

export async function POST(request: Request) {
  const payload: unknown = await request.json().catch(() => null);
  const consent =
    typeof payload === "object" && payload !== null && "consent" in payload
      ? payload.consent
      : undefined;
  if (consent !== null && !isVisitorConsent(consent)) {
    return NextResponse.json({ ok: false }, { status: 400 });
  }

  const response = NextResponse.json({ ok: true });
  if (consent === null) {
    response.cookies.delete(visitorConsentCookieName);
  } else {
    response.cookies.set(visitorConsentCookieName, consent as VisitorConsent, {
      httpOnly: false,
      maxAge: 60 * 60 * 24 * 365,
      path: "/",
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
    });
  }
  if (consent !== "accepted") response.cookies.delete(visitorCookieName);
  return response;
}
