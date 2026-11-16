import { expect, test } from "bun:test";
import { requestAccess } from "../lib/run-dependencies";
import { createSessionCookie, signInConfig } from "../lib/staff-session";

const settings = {
  GOOGLE_OAUTH_CLIENT_ID:
    "1234567890-abcdefghijklmnop.apps.googleusercontent.com",
  GOOGLE_OAUTH_CLIENT_SECRET: "client-secret-value",
  MICROCOSM_RUNS_SESSION_SECRET: "s".repeat(48),
};

test("a request is staff only with valid sign-in settings and a valid session", async () => {
  const config = signInConfig(settings);
  if (!config) throw new Error("expected a sign-in configuration");
  const cookie = (
    await createSessionCookie("staff@policyengine.org", config)
  ).split(";", 1)[0];
  const signedIn = new Request("https://runs.example.org/runs/run-1/", {
    headers: { cookie },
  });
  expect(await requestAccess(signedIn, settings)).toEqual({
    staffEmail: "staff@policyengine.org",
    signInAvailable: true,
  });
  expect(
    await requestAccess(new Request("https://runs.example.org/"), settings),
  ).toEqual({ staffEmail: null, signInAvailable: true });
  // No settings, or broken ones: nobody is staff, and nothing throws.
  for (const environment of [
    {},
    { ...settings, MICROCOSM_RUNS_SESSION_SECRET: "short" },
  ])
    expect(await requestAccess(signedIn, environment)).toEqual({
      staffEmail: null,
      signInAvailable: false,
    });
});
