import { createHash, randomBytes } from "node:crypto";
import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from "jose";
import type { Fetcher } from "./net";
import {
  SESSION_COOKIE,
  SIGN_IN_COOKIE,
  STAFF_DOMAIN,
  clearedCookie,
  createSessionCookie,
  createSignInCookie,
  isStaffAddress,
  readSignInCookie,
  type SignInConfig,
} from "./staff-session";

export const GOOGLE_AUTHORIZATION_URL =
  "https://accounts.google.com/o/oauth2/v2/auth";
export const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
/** Google's public keys for its ID tokens. */
export const GOOGLE_KEYS_URL = "https://www.googleapis.com/oauth2/v3/certs";
const GOOGLE_ISSUERS = ["https://accounts.google.com", "accounts.google.com"];
/** The path Google returns to; registered on the OAuth client per origin. */
export const CALLBACK_PATH = "/api/auth/google/callback/";
const GOOGLE_TIMEOUT_MS = 10_000;

/** Fetched once per instance and refreshed as jose decides. */
const googleKeys = createRemoteJWKSet(new URL(GOOGLE_KEYS_URL));

const randomToken = () => randomBytes(32).toString("base64url");

/** A path on this site to return to; anything else becomes `/`. */
export function safeReturnPath(value: string | null): string {
  if (!value || value.length > 2048 || !value.startsWith("/")) return "/";
  const base = "https://runs.invalid";
  let parsed: URL;
  try {
    parsed = new URL(value, base);
  } catch {
    return "/";
  }
  // The URL parser drops tabs and line breaks and reads `\` as `/`, so
  // `/\evil.example` or `/<tab>/evil.example` reach another origin here.
  if (parsed.origin !== base) return "/";
  return `${parsed.pathname}${parsed.search}${parsed.hash}`;
}

function answer(
  status: number,
  body: unknown,
  cookies: string[] = [],
  location?: string,
): Response {
  const headers = new Headers({ "Cache-Control": "no-store" });
  for (const value of cookies) headers.append("Set-Cookie", value);
  if (location) headers.set("Location", location);
  else headers.set("Content-Type", "application/json");
  return new Response(location ? null : JSON.stringify(body), {
    status,
    headers,
  });
}

/**
 * `GET /api/auth/google/start/?next=<path>`: send the person to Google's
 * sign-in, as an authorization code request with PKCE (S256), a state and a
 * nonce, asking only for their identity and email, with the policyengine.org
 * domain as a hint. The secrets wait in a signed ten-minute cookie.
 */
export async function signInStart(
  request: Request,
  config: SignInConfig,
): Promise<Response> {
  const url = new URL(request.url);
  const state = randomToken();
  const nonce = randomToken();
  const verifier = randomToken();
  const query = new URLSearchParams({
    client_id: config.clientId,
    redirect_uri: `${url.origin}${CALLBACK_PATH}`,
    response_type: "code",
    scope: "openid email",
    state,
    nonce,
    code_challenge: createHash("sha256").update(verifier).digest("base64url"),
    code_challenge_method: "S256",
    hd: STAFF_DOMAIN,
    prompt: "select_account",
  });
  return answer(
    302,
    null,
    [
      await createSignInCookie(
        {
          state,
          nonce,
          verifier,
          next: safeReturnPath(url.searchParams.get("next")),
        },
        config,
      ),
    ],
    `${GOOGLE_AUTHORIZATION_URL}?${query}`,
  );
}

/**
 * `GET /api/auth/google/callback/`: Google's return. The state must match
 * the sign-in cookie. The code is exchanged with the PKCE verifier and the
 * client secret. The ID token must be signed by Google, issued by Google, for
 * this client, unexpired, carry the sign-in's nonce, and name a verified
 * address on exactly the policyengine.org domain, with `hd` saying so. Only
 * then does the person get an eight-hour session cookie.
 */
export async function signInCallback(
  request: Request,
  config: SignInConfig,
  dependencies: {
    fetcher?: Fetcher;
    keys?: JWTVerifyGetKey;
    now?: () => number;
  } = {},
): Promise<Response> {
  const fetcher = dependencies.fetcher ?? fetch;
  const keys = dependencies.keys ?? googleKeys;
  const now = dependencies.now ?? Date.now;
  const url = new URL(request.url);
  const cleared = clearedCookie(SIGN_IN_COOKIE);
  const pending = await readSignInCookie(request.headers, config, now());
  const state = url.searchParams.get("state");
  if (!pending || !state || state !== pending.state)
    return answer(400, { error: "invalid_sign_in_state" }, [cleared]);
  const back = `${url.origin}${safeReturnPath(pending.next)}`;
  // Cancelled or refused at Google: go back without a session.
  if (url.searchParams.has("error")) return answer(303, null, [cleared], back);
  const code = url.searchParams.get("code");
  if (!code) return answer(400, { error: "invalid_sign_in_state" }, [cleared]);

  let tokens: unknown;
  try {
    const response = await fetcher(GOOGLE_TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code,
        client_id: config.clientId,
        client_secret: config.clientSecret,
        redirect_uri: `${url.origin}${CALLBACK_PATH}`,
        code_verifier: pending.verifier,
      }).toString(),
      redirect: "error",
      cache: "no-store",
      signal: AbortSignal.timeout(GOOGLE_TIMEOUT_MS),
    });
    if (!response.ok) throw new Error("token exchange refused");
    tokens = await response.json();
  } catch {
    return answer(502, { error: "sign_in_unavailable" }, [cleared]);
  }
  const idToken = (tokens as { id_token?: unknown } | null)?.id_token;
  if (typeof idToken !== "string" || !idToken)
    return answer(502, { error: "sign_in_unavailable" }, [cleared]);

  const refused = () => answer(403, { error: "sign_in_refused" }, [cleared]);
  let claims;
  try {
    ({ payload: claims } = await jwtVerify(idToken, keys, {
      algorithms: ["RS256"],
      issuer: GOOGLE_ISSUERS,
      audience: config.clientId,
      currentDate: new Date(now()),
    }));
  } catch {
    return refused();
  }
  const email =
    typeof claims.email === "string" ? claims.email.toLowerCase() : null;
  if (
    claims.nonce !== pending.nonce ||
    claims.email_verified !== true ||
    claims.hd !== STAFF_DOMAIN ||
    !isStaffAddress(email)
  )
    return refused();
  return answer(
    303,
    null,
    [cleared, await createSessionCookie(email, config, now())],
    back,
  );
}

/**
 * `POST /api/auth/sign-out/`: end the session. A request another site's
 * page sent is refused.
 */
export function signOut(request: Request): Response {
  const url = new URL(request.url);
  const origin = request.headers.get("origin");
  const site = request.headers.get("sec-fetch-site");
  if (
    (origin !== null && origin !== url.origin) ||
    (site !== null && site !== "same-origin")
  )
    return answer(403, { error: "cross_site_request" });
  return answer(303, null, [clearedCookie(SESSION_COOKIE)], `${url.origin}/`);
}
