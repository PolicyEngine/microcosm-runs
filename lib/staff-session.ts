/* eslint-disable @typescript-eslint/no-unused-vars -- red-phase stub */
export const CLIENT_ID_ENV = "GOOGLE_OAUTH_CLIENT_ID";
export const CLIENT_SECRET_ENV = "GOOGLE_OAUTH_CLIENT_SECRET";
export const SESSION_SECRET_ENV = "MICROCOSM_RUNS_SESSION_SECRET";
export const SESSION_COOKIE = "__Host-microcosm-runs-session";
export const SIGN_IN_COOKIE = "__Host-microcosm-runs-sign-in";
export interface SignInConfig {
  clientId: string;
  clientSecret: string;
  sessionKey: Uint8Array;
}
// Red-phase stubs: replaced by the implementation.
export function signInConfig(
  _environment: Record<string, string | undefined> = process.env,
): SignInConfig | null {
  return {
    clientId: "",
    clientSecret: "",
    sessionKey: new Uint8Array(0),
  };
}
export async function createSessionCookie(
  _email: string,
  _config: SignInConfig,
  _now: number = Date.now(),
): Promise<string> {
  return "";
}
export async function staffEmail(
  _headers: Headers,
  _config: SignInConfig,
  _now: number = Date.now(),
): Promise<string | null> {
  return null;
}
