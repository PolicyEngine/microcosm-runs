import { getVercelOidcTokenSync } from "@vercel/oidc";
import { ApiError } from "./contract";
import type { Fetcher } from "./net";

/** Google's Security Token Service, which exchanges the Vercel token. */
export const GOOGLE_STS_TOKEN_URL = "https://sts.googleapis.com/v1/token";
/** Google's IAM Credentials API, which issues the reader account's ID token. */
export const GOOGLE_IAM_CREDENTIALS_ORIGIN =
  "https://iamcredentials.googleapis.com";
/** An ID token is replaced this long before it expires. */
const EXPIRY_MARGIN_MS = 5 * 60 * 1000;
const GOOGLE_TIMEOUT_MS = 10_000;

export interface IdentityTokenOptions {
  /**
   * The Workload Identity provider's resource name,
   * `projects/<number>/locations/global/workloadIdentityPools/<pool>/providers/<provider>`.
   */
  provider: string;
  /** The reader service account's address. */
  serviceAccount: string;
  /** The ID token's audience: the Orrery read service's own URL. */
  audience: string;
  fetcher?: Fetcher;
  /** This deployment's Vercel OIDC token; read per request by default. */
  subjectToken?: () => string;
  now?: () => number;
}

function unavailable(): ApiError {
  // Never carries Google's answer or any token: both could hold credentials.
  return new ApiError(503, "collector_identity_unavailable");
}

async function postForJson(
  fetcher: Fetcher,
  url: string,
  init: RequestInit,
): Promise<Record<string, unknown>> {
  let response: Response;
  try {
    response = await fetcher(url, {
      ...init,
      method: "POST",
      redirect: "error",
      cache: "no-store",
      signal: AbortSignal.timeout(GOOGLE_TIMEOUT_MS),
    });
  } catch {
    throw unavailable();
  }
  if (!response.ok) throw unavailable();
  try {
    const data = await response.json();
    if (data && typeof data === "object") return data;
  } catch {
    // Not JSON.
  }
  throw unavailable();
}

/** The `exp` claim of a JWT, in milliseconds, without verifying it. */
function expiryOf(token: string): number {
  const parts = token.split(".");
  if (parts.length !== 3) throw unavailable();
  let payload: unknown;
  try {
    payload = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8"));
  } catch {
    throw unavailable();
  }
  const expiry = (payload as { exp?: unknown } | null)?.exp;
  if (typeof expiry !== "number" || !Number.isFinite(expiry))
    throw unavailable();
  return expiry * 1000;
}

/**
 * A source of Google-signed ID tokens for microcosm-runs' reader account,
 * made without a stored key:
 *
 * 1. Google's Security Token Service exchanges this deployment's Vercel OIDC
 *    token for a federated access token, through the Workload Identity
 *    provider that trusts only microcosm-runs' production and preview
 *    deployments.
 * 2. With that token, the IAM Credentials API's `generateIdToken` issues an ID
 *    token of the reader account for the read service's URL, with the
 *    account's email in it.
 *
 * The ID token is kept in memory until five minutes before it expires, and
 * concurrent callers share one exchange. A failure is never kept.
 */
export function createIdentityTokenSource(
  options: IdentityTokenOptions,
): () => Promise<string> {
  const fetcher = options.fetcher ?? fetch;
  const subjectToken = options.subjectToken ?? getVercelOidcTokenSync;
  const now = options.now ?? Date.now;
  let cached: { token: string; refreshAt: number } | null = null;
  let pending: Promise<string> | null = null;

  async function issue(): Promise<string> {
    let vercelToken: string;
    try {
      vercelToken = subjectToken();
    } catch {
      throw unavailable();
    }
    if (!vercelToken) throw unavailable();
    const exchanged = await postForJson(fetcher, GOOGLE_STS_TOKEN_URL, {
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "urn:ietf:params:oauth:grant-type:token-exchange",
        audience: `//iam.googleapis.com/${options.provider}`,
        scope: "https://www.googleapis.com/auth/cloud-platform",
        requested_token_type: "urn:ietf:params:oauth:token-type:access_token",
        subject_token_type: "urn:ietf:params:oauth:token-type:jwt",
        subject_token: vercelToken,
      }).toString(),
    });
    const accessToken = exchanged.access_token;
    if (typeof accessToken !== "string" || !accessToken) throw unavailable();
    const issued = await postForJson(
      fetcher,
      `${GOOGLE_IAM_CREDENTIALS_ORIGIN}/v1/projects/-/serviceAccounts/${encodeURIComponent(options.serviceAccount)}:generateIdToken`,
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          audience: options.audience,
          includeEmail: true,
        }),
      },
    );
    const token = issued.token;
    if (typeof token !== "string" || !token) throw unavailable();
    cached = { token, refreshAt: expiryOf(token) - EXPIRY_MARGIN_MS };
    return token;
  }

  return async () => {
    if (cached && now() < cached.refreshAt) return cached.token;
    cached = null;
    pending ??= issue().finally(() => {
      pending = null;
    });
    return pending;
  };
}
