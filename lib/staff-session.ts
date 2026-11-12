import { SignJWT, jwtVerify } from "jose";
import { ApiError } from "./contract";

/** The Google OAuth client's ID (tracker 4b · 2). */
export const CLIENT_ID_ENV = "GOOGLE_OAUTH_CLIENT_ID";
/** The Google OAuth client's secret (tracker 4b · 2). */
export const CLIENT_SECRET_ENV = "GOOGLE_OAUTH_CLIENT_SECRET";
/** At least 32 random characters that sign this deployment's session cookies. */
export const SESSION_SECRET_ENV = "MICROCOSM_RUNS_SESSION_SECRET";
/**
 * `__Host-` makes browsers accept the cookie only when it is `Secure`, has
 * `Path=/` and no `Domain`, so no other host can set or read it.
 */
export const SESSION_COOKIE = "__Host-microcosm-runs-session";
/**
 * The prefix of a sign-in's cookie, which holds its state, nonce and PKCE
 * verifier for ten minutes. Each sign-in's cookie is named after its state,
 * so two sign-ins in one browser don't replace each other's.
 */
export const SIGN_IN_COOKIE = "__Host-microcosm-runs-sign-in";
/** A state as `signInStart` makes one: 32 random bytes in base64url. */
export const SIGN_IN_STATE = /^[A-Za-z0-9_-]{43}$/;

/** The cookie of the sign-in with this state. */
export function signInCookieName(state: string): string {
  return `${SIGN_IN_COOKIE}-${state}`;
}
/** Only accounts of this Google Workspace domain are staff. */
export const STAFF_DOMAIN = "policyengine.org";

const ISSUER = "microcosm-runs";
const SESSION_AUDIENCE = "microcosm-runs/staff-session";
const SIGN_IN_AUDIENCE = "microcosm-runs/sign-in";
const SESSION_SECONDS = 8 * 60 * 60;
const SIGN_IN_SECONDS = 10 * 60;
const CLIENT_ID = /^[0-9]+-[0-9a-z]+\.apps\.googleusercontent\.com$/;
const STAFF_ADDRESS = /^[^@\s]+@policyengine\.org$/;

export interface SignInConfig {
  clientId: string;
  clientSecret: string;
  /** The session secret's bytes, the HMAC key for both cookies. */
  sessionKey: Uint8Array;
}

/**
 * The staff sign-in settings, or null when this deployment offers no
 * sign-in. Some but not all settings, or a malformed one, refuse sign-in.
 */
export function signInConfig(
  environment: Record<string, string | undefined> = process.env,
): SignInConfig | null {
  const clientId = environment[CLIENT_ID_ENV]?.trim() ?? "";
  const clientSecret = environment[CLIENT_SECRET_ENV]?.trim() ?? "";
  const sessionSecret = environment[SESSION_SECRET_ENV] ?? "";
  if (!clientId && !clientSecret && !sessionSecret) return null;
  if (
    !CLIENT_ID.test(clientId) ||
    !clientSecret ||
    clientSecret.length > 256 ||
    sessionSecret.length < 32
  )
    throw new ApiError(503, "invalid_sign_in_configuration");
  return {
    clientId,
    clientSecret,
    sessionKey: new TextEncoder().encode(sessionSecret),
  };
}

/** A lowercase address on exactly the staff domain, not a subdomain. */
export function isStaffAddress(value: unknown): value is string {
  return typeof value === "string" && STAFF_ADDRESS.test(value);
}

function cookie(name: string, value: string, maxAge: number): string {
  return `${name}=${value}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAge}`;
}
/** A `Set-Cookie` value that removes the cookie. */
export function clearedCookie(name: string): string {
  return cookie(name, "", 0);
}

/** One cookie's value from a request's `Cookie` header. */
export function cookieValue(headers: Headers, name: string): string | null {
  for (const part of (headers.get("cookie") ?? "").split(";")) {
    const pair = part.trim();
    if (pair.startsWith(`${name}=`)) return pair.slice(name.length + 1);
  }
  return null;
}

async function signed(
  claims: Record<string, string>,
  subject: string,
  audience: string,
  lifetime: number,
  config: SignInConfig,
  now: number,
): Promise<string> {
  const issuedAt = Math.floor(now / 1000);
  return new SignJWT(claims)
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setSubject(subject)
    .setIssuer(ISSUER)
    .setAudience(audience)
    .setIssuedAt(issuedAt)
    .setExpirationTime(issuedAt + lifetime)
    .sign(config.sessionKey);
}

async function verified(
  token: string | null,
  audience: string,
  config: SignInConfig,
  now: number,
) {
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, config.sessionKey, {
      algorithms: ["HS256"],
      issuer: ISSUER,
      audience,
      currentDate: new Date(now),
    });
    return payload;
  } catch {
    return null;
  }
}

/** The `Set-Cookie` value of an eight-hour staff session. */
export async function createSessionCookie(
  email: string,
  config: SignInConfig,
  now: number = Date.now(),
): Promise<string> {
  const address = email.toLowerCase();
  if (!isStaffAddress(address)) throw new ApiError(403, "not_staff");
  const token = await signed(
    {},
    address,
    SESSION_AUDIENCE,
    SESSION_SECONDS,
    config,
    now,
  );
  return cookie(SESSION_COOKIE, token, SESSION_SECONDS);
}

/** The signed-in staff address, or null for anyone else. */
export async function staffEmail(
  headers: Headers,
  config: SignInConfig,
  now: number = Date.now(),
): Promise<string | null> {
  const payload = await verified(
    cookieValue(headers, SESSION_COOKIE),
    SESSION_AUDIENCE,
    config,
    now,
  );
  return isStaffAddress(payload?.sub) ? payload.sub : null;
}

export interface PendingSignIn {
  state: string;
  nonce: string;
  verifier: string;
  next: string;
}

/** The `Set-Cookie` value that keeps one sign-in's secrets until Google returns. */
export async function createSignInCookie(
  pending: PendingSignIn,
  config: SignInConfig,
  now: number = Date.now(),
): Promise<string> {
  const { state, ...rest } = pending;
  const token = await signed(
    rest,
    state,
    SIGN_IN_AUDIENCE,
    SIGN_IN_SECONDS,
    config,
    now,
  );
  return cookie(signInCookieName(state), token, SIGN_IN_SECONDS);
}

/** The pending sign-in with this state, or null. */
export async function readSignInCookie(
  headers: Headers,
  state: string,
  config: SignInConfig,
  now: number = Date.now(),
): Promise<PendingSignIn | null> {
  if (!SIGN_IN_STATE.test(state)) return null;
  const payload = await verified(
    cookieValue(headers, signInCookieName(state)),
    SIGN_IN_AUDIENCE,
    config,
    now,
  );
  if (
    !payload ||
    payload.sub !== state ||
    typeof payload.nonce !== "string" ||
    typeof payload.verifier !== "string" ||
    typeof payload.next !== "string"
  )
    return null;
  return {
    state: payload.sub,
    nonce: payload.nonce,
    verifier: payload.verifier,
    next: payload.next,
  };
}
