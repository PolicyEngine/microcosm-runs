/* eslint-disable @typescript-eslint/no-unused-vars -- red-phase stub */
import type { JWTVerifyGetKey } from "jose";
import type { Fetcher } from "./net";
import type { SignInConfig } from "./staff-session";

export const GOOGLE_AUTHORIZATION_URL =
  "https://accounts.google.com/o/oauth2/v2/auth";
export const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
// Red-phase stubs: replaced by the implementation.
export async function signInStart(
  _request: Request,
  _config: SignInConfig,
): Promise<Response> {
  return new Response(null, { status: 501 });
}
export async function signInCallback(
  _request: Request,
  _config: SignInConfig,
  _dependencies: { fetcher?: Fetcher; keys?: JWTVerifyGetKey } = {},
): Promise<Response> {
  return new Response(null, { status: 501 });
}
export function signOut(_request: Request): Response {
  return new Response(null, { status: 501 });
}
