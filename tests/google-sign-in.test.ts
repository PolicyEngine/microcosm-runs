import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
import {
  SignJWT,
  createLocalJWKSet,
  errors,
  exportJWK,
  generateKeyPair,
  type JWTPayload,
} from "jose";
import {
  GOOGLE_AUTHORIZATION_URL,
  GOOGLE_TOKEN_URL,
  signInCallback,
  signInStart,
  signOut,
} from "../lib/google-sign-in";
import type { Fetcher } from "../lib/net";
import {
  SESSION_COOKIE,
  SIGN_IN_COOKIE,
  signInConfig,
  staffEmail,
} from "../lib/staff-session";

const config = (() => {
  const value = signInConfig({
    GOOGLE_OAUTH_CLIENT_ID:
      "1234567890-abcdefghijklmnop.apps.googleusercontent.com",
    GOOGLE_OAUTH_CLIENT_SECRET: "client-secret-value",
    MICROCOSM_RUNS_SESSION_SECRET: "s".repeat(48),
  });
  if (!value) throw new Error("expected a sign-in configuration");
  return value;
})();
const origin = "https://runs.example.org";
const callbackUrl = `${origin}/api/auth/google/callback/`;

const googleKeys = await (async () => {
  const { privateKey, publicKey } = await generateKeyPair("RS256");
  const jwk = {
    ...(await exportJWK(publicKey)),
    kid: "google-key",
    alg: "RS256",
  };
  return { privateKey, keys: createLocalJWKSet({ keys: [jwk] }) };
})();

function cookiesOf(response: Response): Map<string, string> {
  const cookies = new Map<string, string>();
  for (const value of response.headers.getSetCookie()) {
    const [pair] = value.split(";", 1);
    const index = pair.indexOf("=");
    cookies.set(pair.slice(0, index), value);
  }
  return cookies;
}

async function started(next = "/runs/run-1/?document=x") {
  const response = await signInStart(
    new Request(
      `${origin}/api/auth/google/start/?next=${encodeURIComponent(next)}`,
    ),
    config,
  );
  expect(response.status).toBe(302);
  const location = new URL(response.headers.get("location") ?? "");
  // Each sign-in has its own cookie, named after its state.
  const state = location.searchParams.get("state") ?? "";
  const signInCookie =
    cookiesOf(response).get(`${SIGN_IN_COOKIE}-${state}`) ?? "";
  return { response, location, signInCookie };
}

async function idToken(
  claims: JWTPayload,
  options: { key?: CryptoKey; expiresIn?: string | null } = {},
) {
  const token = new SignJWT({
    iss: "https://accounts.google.com",
    aud: config.clientId,
    email: "staff@policyengine.org",
    email_verified: true,
    hd: "policyengine.org",
    ...claims,
  })
    .setProtectedHeader({ alg: "RS256", kid: "google-key" })
    .setIssuedAt();
  // `expiresIn: null` leaves the expiry out altogether.
  if (options.expiresIn !== null)
    token.setExpirationTime(options.expiresIn ?? "1h");
  return token.sign(options.key ?? googleKeys.privateKey);
}

function tokenEndpoint(answer: (body: URLSearchParams) => Response) {
  const calls: { url: string; body: URLSearchParams }[] = [];
  const fetcher = (async (input, init) => {
    const body = new URLSearchParams(String(init?.body));
    calls.push({ url: String(input), body });
    return answer(body);
  }) as Fetcher;
  return { calls, fetcher };
}

async function callback(
  signInCookie: string,
  state: string,
  fetcher: Fetcher,
  extra = "",
) {
  return signInCallback(
    new Request(
      `${callbackUrl}?code=auth-code&state=${encodeURIComponent(state)}${extra}`,
      {
        headers: { cookie: signInCookie.split(";", 1)[0] },
      },
    ),
    config,
    { fetcher, keys: googleKeys.keys },
  );
}

test("sign-in starts Google's authorization code flow with PKCE, a nonce and the policyengine.org domain hint", async () => {
  const { response, location, signInCookie } = await started();
  expect(response.status).toBe(302);
  expect(`${location.origin}${location.pathname}`).toBe(
    GOOGLE_AUTHORIZATION_URL,
  );
  const query = Object.fromEntries(location.searchParams);
  expect(query).toMatchObject({
    client_id: config.clientId,
    redirect_uri: callbackUrl,
    response_type: "code",
    scope: "openid email",
    code_challenge_method: "S256",
    hd: "policyengine.org",
  });
  expect(query.state.length).toBeGreaterThanOrEqual(32);
  expect(query.nonce.length).toBeGreaterThanOrEqual(32);
  expect(query.code_challenge).toMatch(/^[A-Za-z0-9_-]{43}$/);
  expect(signInCookie).toContain("HttpOnly");
  expect(signInCookie).toContain("Secure");
  expect(signInCookie).toContain("SameSite=Lax");
  expect(signInCookie).toContain("Path=/");
  expect(response.headers.get("cache-control")).toBe("no-store");
});

test("a valid callback exchanges the code with the PKCE verifier, checks the ID token and starts a session", async () => {
  const { location, signInCookie } = await started();
  const state = location.searchParams.get("state") ?? "";
  const nonce = location.searchParams.get("nonce") ?? "";
  const challenge = location.searchParams.get("code_challenge") ?? "";
  const token = await idToken({ nonce });
  const { calls: exchange, fetcher } = tokenEndpoint(() =>
    Response.json({
      id_token: token,
      access_token: "unused",
      token_type: "Bearer",
    }),
  );
  const response = await callback(signInCookie, state, fetcher);
  expect(response.status).toBe(303);
  expect(response.headers.get("location")).toBe(
    `${origin}/runs/run-1/?document=x`,
  );
  expect(response.headers.get("cache-control")).toBe("no-store");
  expect(exchange.map((call) => call.url)).toEqual([GOOGLE_TOKEN_URL]);
  const sent = Object.fromEntries(exchange[0].body);
  expect(sent).toMatchObject({
    grant_type: "authorization_code",
    code: "auth-code",
    client_id: config.clientId,
    client_secret: "client-secret-value",
    redirect_uri: callbackUrl,
  });
  expect(
    createHash("sha256").update(sent.code_verifier).digest("base64url"),
  ).toBe(challenge);
  const cookies = cookiesOf(response);
  const session = cookies.get(SESSION_COOKIE) ?? "";
  expect(
    await staffEmail(new Headers({ cookie: session.split(";", 1)[0] }), config),
  ).toBe("staff@policyengine.org");
  // The one-time sign-in cookie is removed.
  expect(cookies.get(`${SIGN_IN_COOKIE}-${state}`)).toContain("Max-Age=0");
});

test("an ID token that is not a verified policyengine.org account for this client is refused", async () => {
  const other = await generateKeyPair("RS256");
  const cases: [string, (nonce: string) => Promise<string>][] = [
    [
      "another domain",
      (nonce) =>
        idToken({ nonce, hd: "gmail.com", email: "someone@gmail.com" }),
    ],
    [
      "no hosted domain",
      (nonce) => idToken({ nonce, hd: undefined, email: "someone@gmail.com" }),
    ],
    [
      "domain claim without matching email",
      (nonce) => idToken({ nonce, email: "someone@gmail.com" }),
    ],
    ["unverified email", (nonce) => idToken({ nonce, email_verified: false })],
    [
      "another client",
      (nonce) => idToken({ nonce, aud: "other.apps.googleusercontent.com" }),
    ],
    [
      "another issuer",
      (nonce) => idToken({ nonce, iss: "https://evil.example" }),
    ],
    ["wrong nonce", () => idToken({ nonce: "x".repeat(43) })],
    ["expired", (nonce) => idToken({ nonce }, { expiresIn: "-1m" })],
    ["no expiry", (nonce) => idToken({ nonce }, { expiresIn: null })],
    [
      "another signing key",
      (nonce) => idToken({ nonce }, { key: other.privateKey as CryptoKey }),
    ],
  ];
  for (const [, makeToken] of cases) {
    const { location, signInCookie } = await started();
    const state = location.searchParams.get("state") ?? "";
    const token = await makeToken(location.searchParams.get("nonce") ?? "");
    const { fetcher } = tokenEndpoint(() => Response.json({ id_token: token }));
    const response = await callback(signInCookie, state, fetcher);
    expect(response.status).toBe(403);
    expect(cookiesOf(response).has(SESSION_COOKIE)).toBe(false);
  }
});

test("a callback without the matching sign-in cookie and state never asks Google for tokens", async () => {
  const first = await started();
  const second = await started();
  const { calls, fetcher } = tokenEndpoint(() => Response.json({}));
  const mismatched = await callback(
    first.signInCookie,
    second.location.searchParams.get("state") ?? "",
    fetcher,
  );
  expect(mismatched.status).toBe(400);
  const missing = await signInCallback(
    new Request(`${callbackUrl}?code=auth-code&state=abc`),
    config,
    { fetcher, keys: googleKeys.keys },
  );
  expect(missing.status).toBe(400);
  expect(calls).toEqual([]);
  // A sign-in the person cancelled at Google goes back without a session.
  const cancelled = await callback(
    first.signInCookie,
    first.location.searchParams.get("state") ?? "",
    fetcher,
    "&error=access_denied",
  );
  expect(cancelled.status).toBe(303);
  expect(cookiesOf(cancelled).has(SESSION_COOKIE)).toBe(false);
  expect(calls).toEqual([]);
  // Google refusing the code is a 502, with no session.
  const { fetcher: refusing } = tokenEndpoint(
    () => new Response("{}", { status: 400 }),
  );
  const refused = await callback(
    first.signInCookie,
    first.location.searchParams.get("state") ?? "",
    refusing,
  );
  expect(refused.status).toBe(502);
  expect(cookiesOf(refused).has(SESSION_COOKIE)).toBe(false);
});

test("the page to return to is always a path on this site", async () => {
  for (const next of [
    "https://evil.example/",
    "//evil.example/",
    "/\\evil.example/",
    "javascript:alert(1)",
    "/.//evil.example/",
    "/\t/evil.example/",
    "/\n/evil.example/",
    "",
  ]) {
    const { location, signInCookie } = await started(next);
    const nonce = location.searchParams.get("nonce") ?? "";
    const token = await idToken({ nonce });
    const { fetcher } = tokenEndpoint(() => Response.json({ id_token: token }));
    const response = await callback(
      signInCookie,
      location.searchParams.get("state") ?? "",
      fetcher,
    );
    expect(response.headers.get("location")).toBe(`${origin}/`);
  }
});

test("signing out removes the session; a cross-site request cannot", async () => {
  const response = signOut(
    new Request(`${origin}/api/auth/sign-out/`, {
      method: "POST",
      headers: { origin },
    }),
  );
  expect(response.status).toBe(303);
  expect(cookiesOf(response).get(SESSION_COOKIE)).toContain("Max-Age=0");
  const crossSite = signOut(
    new Request(`${origin}/api/auth/sign-out/`, {
      method: "POST",
      headers: { origin: "https://evil.example" },
    }),
  );
  expect(crossSite.status).toBe(403);
  expect(cookiesOf(crossSite).has(SESSION_COOKIE)).toBe(false);
});

test("two sign-ins started in one browser both complete", async () => {
  const first = await started("/runs/first/");
  const second = await started("/runs/second/");
  // The browser keeps both cookies: they have different names.
  const jar = [first.signInCookie, second.signInCookie]
    .map((value) => value.split(";", 1)[0])
    .join("; ");
  for (const [sign, back] of [
    [first, "/runs/first/"],
    [second, "/runs/second/"],
  ] as const) {
    const token = await idToken({
      nonce: sign.location.searchParams.get("nonce") ?? "",
    });
    const { fetcher } = tokenEndpoint(() => Response.json({ id_token: token }));
    const response = await signInCallback(
      new Request(
        `${callbackUrl}?code=auth-code&state=${sign.location.searchParams.get("state")}`,
        { headers: { cookie: jar } },
      ),
      config,
      { fetcher, keys: googleKeys.keys },
    );
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe(`${origin}${back}`);
    expect(cookiesOf(response).has(SESSION_COOKIE)).toBe(true);
  }
});

test("Google's keys being unreachable is an outage, not a refusal", async () => {
  for (const failure of [
    new errors.JWKSTimeout(),
    new TypeError("fetch failed"),
  ]) {
    const { location, signInCookie } = await started();
    const token = await idToken({
      nonce: location.searchParams.get("nonce") ?? "",
    });
    const { fetcher } = tokenEndpoint(() => Response.json({ id_token: token }));
    const response = await signInCallback(
      new Request(
        `${callbackUrl}?code=auth-code&state=${location.searchParams.get("state")}`,
        { headers: { cookie: signInCookie.split(";", 1)[0] } },
      ),
      config,
      {
        fetcher,
        keys: async () => {
          throw failure;
        },
      },
    );
    expect(response.status).toBe(502);
    expect(await response.json()).toEqual({ error: "sign_in_unavailable" });
  }
});

test("a mixed-case policyengine.org address signs in as its lowercase form", async () => {
  const { location, signInCookie } = await started();
  const token = await idToken({
    nonce: location.searchParams.get("nonce") ?? "",
    email: "Staff.Member@PolicyEngine.org",
  });
  const { fetcher } = tokenEndpoint(() => Response.json({ id_token: token }));
  const response = await callback(
    signInCookie,
    location.searchParams.get("state") ?? "",
    fetcher,
  );
  expect(response.status).toBe(303);
  const session = cookiesOf(response).get(SESSION_COOKIE) ?? "";
  expect(
    await staffEmail(new Headers({ cookie: session.split(";", 1)[0] }), config),
  ).toBe("staff.member@policyengine.org");
});
