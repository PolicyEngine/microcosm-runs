/* eslint-disable @typescript-eslint/no-unused-vars -- red-phase stub */
import type { Fetcher } from "./net";

export const GOOGLE_STS_TOKEN_URL = "https://sts.googleapis.com/v1/token";
export const GOOGLE_IAM_CREDENTIALS_ORIGIN =
  "https://iamcredentials.googleapis.com";

// Red-phase stub: replaced by the implementation.
export function createIdentityTokenSource(_options: {
  provider: string;
  serviceAccount: string;
  audience: string;
  fetcher?: Fetcher;
  subjectToken?: () => string;
  now?: () => number;
}): () => Promise<string> {
  return async () => "";
}
