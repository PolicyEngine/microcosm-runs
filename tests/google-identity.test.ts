import { expect, test } from "bun:test";
import { ApiError } from "../lib/contract";
import {
  GOOGLE_IAM_CREDENTIALS_ORIGIN,
  GOOGLE_STS_TOKEN_URL,
  createIdentityTokenSource,
} from "../lib/google-identity";
import type { Fetcher } from "../lib/net";

const provider =
  "projects/123456/locations/global/workloadIdentityPools/runs-pool/providers/vercel";
const serviceAccount = "runs-reader@collector-project.iam.gserviceaccount.com";
const audience = "https://orrery-read.example.run.app";

/** An unsigned JWT-shaped token whose payload carries `exp` in seconds. */
function idTokenExpiringAt(expirySeconds: number, marker = "id"): string {
  const encode = (value: unknown) =>
    Buffer.from(JSON.stringify(value)).toString("base64url");
  return `${encode({ alg: "RS256" })}.${encode({ exp: expirySeconds, marker })}.signature`;
}

interface RecordedCall {
  url: string;
  init?: RequestInit;
}

function googleFake(
  options: {
    idToken?: () => string;
    sts?: () => Response;
    iam?: () => Response;
  } = {},
) {
  const calls: RecordedCall[] = [];
  const fetcher = (async (input, init) => {
    const url = String(input);
    calls.push({ url, init });
    if (url === GOOGLE_STS_TOKEN_URL)
      return options.sts
        ? options.sts()
        : Response.json({
            access_token: "federated-access-token",
            issued_token_type: "urn:ietf:params:oauth:token-type:access_token",
            token_type: "Bearer",
            expires_in: 3600,
          });
    if (url.startsWith(GOOGLE_IAM_CREDENTIALS_ORIGIN))
      return options.iam
        ? options.iam()
        : Response.json({
            token: options.idToken
              ? options.idToken()
              : idTokenExpiringAt(2_000_000),
          });
    return new Response("unexpected", { status: 500 });
  }) as Fetcher;
  return { calls, fetcher };
}

test("exchanges the Vercel token at Google STS, then asks IAM Credentials for an ID token of the reader account", async () => {
  const { calls, fetcher } = googleFake();
  const source = createIdentityTokenSource({
    provider,
    serviceAccount,
    audience,
    fetcher,
    subjectToken: () => "vercel-oidc-token",
    now: () => 1_000_000_000,
  });
  expect(await source()).toBe(idTokenExpiringAt(2_000_000));
  expect(calls.map((call) => call.url)).toEqual([
    GOOGLE_STS_TOKEN_URL,
    `${GOOGLE_IAM_CREDENTIALS_ORIGIN}/v1/projects/-/serviceAccounts/${encodeURIComponent(serviceAccount)}:generateIdToken`,
  ]);
  const exchange = new URLSearchParams(String(calls[0].init?.body));
  expect(Object.fromEntries(exchange)).toEqual({
    grant_type: "urn:ietf:params:oauth:grant-type:token-exchange",
    audience: `//iam.googleapis.com/${provider}`,
    scope: "https://www.googleapis.com/auth/cloud-platform",
    requested_token_type: "urn:ietf:params:oauth:token-type:access_token",
    subject_token_type: "urn:ietf:params:oauth:token-type:jwt",
    subject_token: "vercel-oidc-token",
  });
  expect(calls[0].init?.method).toBe("POST");
  expect(calls[0].init?.redirect).toBe("error");
  const generate = calls[1].init;
  expect(generate?.method).toBe("POST");
  expect(generate?.redirect).toBe("error");
  expect(new Headers(generate?.headers).get("authorization")).toBe(
    "Bearer federated-access-token",
  );
  expect(JSON.parse(String(generate?.body))).toEqual({
    audience,
    includeEmail: true,
  });
});

test("reuses an ID token until five minutes before it expires, and shares one exchange between concurrent callers", async () => {
  let clock = 1_000_000_000;
  let issued = 0;
  const { calls, fetcher } = googleFake({
    idToken: () => idTokenExpiringAt(clock / 1000 + 3600, `token-${++issued}`),
  });
  const source = createIdentityTokenSource({
    provider,
    serviceAccount,
    audience,
    fetcher,
    subjectToken: () => "vercel-oidc-token",
    now: () => clock,
  });
  const [first, second] = await Promise.all([source(), source()]);
  expect(first).toBe(second);
  expect(calls.length).toBe(2);
  clock += (3600 - 301) * 1000;
  expect(await source()).toBe(first);
  expect(calls.length).toBe(2);
  clock += 2000;
  const refreshed = await source();
  expect(refreshed).not.toBe(first);
  expect(calls.length).toBe(4);
});

test("every failure is a 503 that names no token, and is not cached", async () => {
  const failures: Parameters<typeof googleFake>[0][] = [
    { sts: () => new Response("{}", { status: 400 }) },
    { sts: () => new Response("not json") },
    { sts: () => Response.json({ token_type: "Bearer" }) },
    { iam: () => new Response("{}", { status: 403 }) },
    { iam: () => Response.json({ token: 7 }) },
    { idToken: () => "not-a-jwt" },
    {
      sts: () => {
        throw new TypeError("network down");
      },
    },
  ];
  for (const failure of failures) {
    const { calls, fetcher } = googleFake(failure);
    const source = createIdentityTokenSource({
      provider,
      serviceAccount,
      audience,
      fetcher,
      subjectToken: () => "vercel-oidc-token",
      now: () => 1_000_000_000,
    });
    for (let attempt = 0; attempt < 2; attempt++) {
      const error = await source().then(
        () => null,
        (caught: unknown) => caught,
      );
      expect(error).toBeInstanceOf(ApiError);
      expect((error as ApiError).status).toBe(503);
      expect((error as ApiError).code).toBe("collector_identity_unavailable");
      expect(String((error as Error).message)).not.toContain(
        "vercel-oidc-token",
      );
      expect(String((error as Error).message)).not.toContain(
        "federated-access-token",
      );
    }
    // The second attempt asked Google again instead of reusing the failure.
    expect(calls.length).toBeGreaterThan(1);
  }
});

test("a missing Vercel token is a 503 before anything is sent to Google", async () => {
  const { calls, fetcher } = googleFake();
  const source = createIdentityTokenSource({
    provider,
    serviceAccount,
    audience,
    fetcher,
    subjectToken: () => {
      throw new Error("The 'x-vercel-oidc-token' header is missing");
    },
  });
  await expect(source()).rejects.toMatchObject({
    status: 503,
    code: "collector_identity_unavailable",
  });
  expect(calls).toEqual([]);
});
