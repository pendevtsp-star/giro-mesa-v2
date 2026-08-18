import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { createRemoteJWKSet, jwtVerify } from "jose";

export type GoogleAuthIntent = "login" | "signup";

export interface GoogleProfile {
  subject: string;
  email: string;
  displayName: string;
}

interface GoogleState {
  state: string;
  nonce: string;
  verifier: string;
  intent: GoogleAuthIntent;
  issuedAt: number;
  returnTo?: string;
}

interface GoogleConfiguration {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  sessionSecret: string;
}

const googleKeys = createRemoteJWKSet(new URL("https://www.googleapis.com/oauth2/v3/certs"));

function unsafeReturnTarget(value: string) {
  return (
    value.length > 1_024 ||
    !value.startsWith("/") ||
    value.startsWith("//") ||
    value.includes("\\") ||
    [...value].some((character) => character.charCodeAt(0) < 32)
  );
}

export function googleConfiguration(
  environment: NodeJS.ProcessEnv = process.env,
): GoogleConfiguration | null {
  const clientId = environment.GOOGLE_OAUTH_CLIENT_ID?.trim();
  const clientSecret = environment.GOOGLE_OAUTH_CLIENT_SECRET?.trim();
  const redirectUri = environment.GOOGLE_OAUTH_REDIRECT_URI?.trim();
  const sessionSecret = environment.SESSION_SECRET?.trim();
  return clientId && clientSecret && redirectUri && sessionSecret && sessionSecret.length >= 32
    ? { clientId, clientSecret, redirectUri, sessionSecret }
    : null;
}

export function beginGoogleOAuth(
  intent: GoogleAuthIntent,
  config: GoogleConfiguration,
  returnTo?: string,
) {
  if (returnTo && unsafeReturnTarget(returnTo)) {
    throw new Error("GOOGLE_RETURN_TARGET_INVALID");
  }
  const state: GoogleState = {
    state: randomBytes(24).toString("base64url"),
    nonce: randomBytes(24).toString("base64url"),
    verifier: randomBytes(48).toString("base64url"),
    intent,
    issuedAt: Date.now(),
    ...(returnTo ? { returnTo } : {}),
  };
  const authorization = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  authorization.search = new URLSearchParams({
    client_id: config.clientId,
    redirect_uri: config.redirectUri,
    response_type: "code",
    scope: "openid email profile",
    state: state.state,
    nonce: state.nonce,
    code_challenge: createHash("sha256").update(state.verifier).digest("base64url"),
    code_challenge_method: "S256",
    prompt: "select_account",
  }).toString();
  return { authorizationUrl: authorization.toString(), stateCookie: sealState(state, config) };
}

export function consumeGoogleState(
  cookie: string | undefined,
  returnedState: string | undefined,
  config: GoogleConfiguration,
  now = Date.now(),
): GoogleState | null {
  if (!cookie || !returnedState) return null;
  const [encoded, signature, extra] = cookie.split(".");
  if (!encoded || !signature || extra) return null;
  const expected = sign(encoded, config.sessionSecret);
  const suppliedBytes = Buffer.from(signature, "base64url");
  const expectedBytes = Buffer.from(expected, "base64url");
  if (
    suppliedBytes.length !== expectedBytes.length ||
    !timingSafeEqual(suppliedBytes, expectedBytes)
  ) {
    return null;
  }
  try {
    const value = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8")) as GoogleState;
    if (
      value.state !== returnedState ||
      (value.intent !== "login" && value.intent !== "signup") ||
      !/^[A-Za-z0-9_-]{32,128}$/.test(value.nonce) ||
      !/^[A-Za-z0-9_-]{43,128}$/.test(value.verifier) ||
      !Number.isSafeInteger(value.issuedAt) ||
      (value.returnTo !== undefined &&
        (typeof value.returnTo !== "string" || unsafeReturnTarget(value.returnTo))) ||
      value.issuedAt > now + 30_000 ||
      now - value.issuedAt > 10 * 60_000
    ) {
      return null;
    }
    return value;
  } catch {
    return null;
  }
}

export async function exchangeGoogleCode(
  code: string,
  state: GoogleState,
  config: GoogleConfiguration,
  fetcher: typeof fetch = fetch,
) {
  const response = await fetcher("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: config.clientId,
      client_secret: config.clientSecret,
      redirect_uri: config.redirectUri,
      grant_type: "authorization_code",
      code_verifier: state.verifier,
    }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) throw new Error("GOOGLE_CODE_EXCHANGE_FAILED");
  const token: unknown = await response.json();
  if (
    typeof token !== "object" ||
    token === null ||
    !("id_token" in token) ||
    typeof token.id_token !== "string"
  ) {
    throw new Error("GOOGLE_ID_TOKEN_MISSING");
  }
  return verifyGoogleIdToken(token.id_token, state.nonce, config);
}

export async function verifyGoogleIdToken(
  idToken: string,
  nonce: string,
  config: Pick<GoogleConfiguration, "clientId">,
): Promise<GoogleProfile> {
  const verified = await jwtVerify(idToken, googleKeys, {
    algorithms: ["RS256"],
    issuer: ["https://accounts.google.com", "accounts.google.com"],
    audience: config.clientId,
    clockTolerance: 5,
  });
  return validateGoogleClaims(verified.payload, nonce);
}

export function validateGoogleClaims(
  claims: Record<string, unknown>,
  nonce: string,
): GoogleProfile {
  if (
    typeof claims.sub !== "string" ||
    claims.sub.length < 1 ||
    claims.sub.length > 255 ||
    typeof claims.email !== "string" ||
    claims.email_verified !== true ||
    claims.nonce !== nonce
  ) {
    throw new Error("GOOGLE_IDENTITY_INVALID");
  }
  const email = claims.email.trim().toLowerCase();
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new Error("GOOGLE_EMAIL_INVALID");
  }
  const displayName = typeof claims.name === "string" ? claims.name.trim() : "";
  return {
    subject: claims.sub,
    email,
    displayName: displayName.slice(0, 120) || email.split("@")[0] || "Conta Google",
  };
}

function sealState(value: GoogleState, config: GoogleConfiguration) {
  const encoded = Buffer.from(JSON.stringify(value)).toString("base64url");
  return `${encoded}.${sign(encoded, config.sessionSecret)}`;
}

function sign(value: string, secret: string) {
  return createHmac("sha256", secret).update(value).digest("base64url");
}
