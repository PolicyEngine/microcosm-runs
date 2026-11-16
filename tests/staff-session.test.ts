import { expect, test } from "bun:test";
import { ApiError } from "../lib/contract";
import {
  CLIENT_ID_ENV,
  CLIENT_SECRET_ENV,
  SESSION_COOKIE,
  SESSION_SECRET_ENV,
  createSessionCookie,
  createSignInCookie,
  signInConfig,
  staffEmail,
} from "../lib/staff-session";

const sessionSecret = "s".repeat(48);
const settings = {
  [CLIENT_ID_ENV]: "1234567890-abcdefghijklmnop.apps.googleusercontent.com",
  [CLIENT_SECRET_ENV]: "client-secret-value",
  [SESSION_SECRET_ENV]: sessionSecret,
};
const config = signInConfigOrThrow();

function signInConfigOrThrow() {
  const value = signInConfig(settings);
  if (!value) throw new Error("expected a sign-in configuration");
  return value;
}

/** The cookie a browser sends back for a `Set-Cookie` value. */
function cookieHeader(setCookie: string): Headers {
  return new Headers({ cookie: setCookie.split(";", 1)[0] });
}

test("sign-in is off without settings, and refuses partial or malformed ones", () => {
  expect(signInConfig({})).toBeNull();
  expect(config.clientId).toBe(settings[CLIENT_ID_ENV]);
  expect(config.clientSecret).toBe("client-secret-value");
  for (const broken of [
    { ...settings, [CLIENT_ID_ENV]: undefined },
    { ...settings, [CLIENT_SECRET_ENV]: "" },
    { ...settings, [SESSION_SECRET_ENV]: undefined },
    { ...settings, [SESSION_SECRET_ENV]: "too-short" },
    { ...settings, [CLIENT_ID_ENV]: "not-a-client-id" },
  ]) {
    let caught: unknown;
    try {
      signInConfig(broken);
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(ApiError);
    expect(caught).toMatchObject({
      status: 503,
      code: "invalid_sign_in_configuration",
    });
  }
});

test("a session cookie is host-only, secure, HTTP-only and lasts eight hours", async () => {
  const now = Date.UTC(2026, 10, 12, 9, 0, 0);
  const cookie = await createSessionCookie(
    "Staff.Member@policyengine.org",
    config,
    now,
  );
  expect(cookie.startsWith(`${SESSION_COOKIE}=`)).toBe(true);
  expect(SESSION_COOKIE.startsWith("__Host-")).toBe(true);
  const attributes = cookie
    .split(";")
    .slice(1)
    .map((part) => part.trim());
  expect(attributes).toEqual(
    expect.arrayContaining([
      "Path=/",
      "HttpOnly",
      "Secure",
      "SameSite=Lax",
      `Max-Age=${8 * 3600}`,
    ]),
  );
  expect(attributes.some((part) => part.startsWith("Domain="))).toBe(false);
  expect(await staffEmail(cookieHeader(cookie), config, now + 1000)).toBe(
    "staff.member@policyengine.org",
  );
  expect(
    await staffEmail(
      cookieHeader(cookie),
      config,
      now + 8 * 3600 * 1000 + 1000,
    ),
  ).toBeNull();
});

test("only a policyengine.org address can hold a session", async () => {
  for (const email of [
    "someone@gmail.com",
    "someone@policyengine.org.evil.example",
    "someone@sub.policyengine.org",
    "policyengine.org@gmail.com",
  ])
    await expect(createSessionCookie(email, config)).rejects.toThrow();
});

test("a tampered, foreign or missing session cookie is no session", async () => {
  const cookie = await createSessionCookie("staff@policyengine.org", config);
  const value = cookie.split(";", 1)[0].slice(SESSION_COOKIE.length + 1);
  expect(value.split(".").length).toBe(3);
  const [header, payload, signature] = value.split(".");
  const forged = Buffer.from(
    JSON.stringify({
      ...JSON.parse(Buffer.from(payload, "base64url").toString()),
      sub: "intruder@policyengine.org",
    }),
  ).toString("base64url");
  const other = signInConfig({
    ...settings,
    [SESSION_SECRET_ENV]: "o".repeat(48),
  });
  if (!other) throw new Error("expected a sign-in configuration");
  for (const headers of [
    new Headers(),
    new Headers({
      cookie: `${SESSION_COOKIE}=${header}.${forged}.${signature}`,
    }),
    new Headers({ cookie: `${SESSION_COOKIE}=not-a-token` }),
    new Headers({ cookie: `microcosm-runs-session=${value}` }),
  ])
    expect(await staffEmail(headers, config)).toBeNull();
  expect(await staffEmail(cookieHeader(cookie), other)).toBeNull();
  expect(await staffEmail(cookieHeader(cookie), config)).toBe(
    "staff@policyengine.org",
  );
});

test("a sign-in cookie cannot stand in for a session", async () => {
  const pending = await createSignInCookie(
    { state: "s".repeat(43), nonce: "n", verifier: "v", next: "/" },
    config,
  );
  const value = pending.split(";", 1)[0].split("=").slice(1).join("=");
  expect(
    await staffEmail(
      new Headers({ cookie: `${SESSION_COOKIE}=${value}` }),
      config,
    ),
  ).toBeNull();
});
