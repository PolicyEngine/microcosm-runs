import { expect, test } from "bun:test";
import { ApiError, sha256 } from "../lib/contract";
import {
  GRAPH_SOURCE_ENV,
  PROVIDER_ENV,
  READER_ACCOUNT_ENV,
  READ_URL_ENV,
  collectorReadConfig,
  createCollectorReader,
  isCollectorCursor,
} from "../lib/collector";
import type { Fetcher } from "../lib/net";
import { collectorDocument, documentBytes } from "./support/collector";

const settings = {
  [GRAPH_SOURCE_ENV]: "collector",
  [READ_URL_ENV]: "https://orrery-read.example.run.app",
  [READER_ACCOUNT_ENV]: "runs-reader@collector-project.iam.gserviceaccount.com",
  [PROVIDER_ENV]:
    "projects/123456/locations/global/workloadIdentityPools/runs-pool/providers/vercel",
};

test("collector reads are off unless the graph source setting says collector", () => {
  expect(collectorReadConfig({})).toBeNull();
  expect(collectorReadConfig({ [GRAPH_SOURCE_ENV]: "" })).toBeNull();
  expect(
    collectorReadConfig({ ...settings, [GRAPH_SOURCE_ENV]: "publications" }),
  ).toBeNull();
  expect(collectorReadConfig(settings)).toEqual({
    readUrl: "https://orrery-read.example.run.app",
    serviceAccount: "runs-reader@collector-project.iam.gserviceaccount.com",
    provider:
      "projects/123456/locations/global/workloadIdentityPools/runs-pool/providers/vercel",
  });
});

test("collector settings fail closed when a value is missing or malformed", () => {
  const broken: Record<string, string | undefined>[] = [
    { ...settings, [GRAPH_SOURCE_ENV]: "Collector-ish" },
    { ...settings, [READ_URL_ENV]: undefined },
    { ...settings, [READ_URL_ENV]: "http://orrery-read.example.run.app" },
    { ...settings, [READ_URL_ENV]: "https://orrery-read.example.run.app/v1" },
    { ...settings, [READ_URL_ENV]: "https://user:pw@orrery.example.run.app" },
    { ...settings, [READ_URL_ENV]: "https://orrery.example.run.app/?a=1" },
    { ...settings, [READER_ACCOUNT_ENV]: "" },
    { ...settings, [READER_ACCOUNT_ENV]: "someone@gmail.com" },
    { ...settings, [PROVIDER_ENV]: undefined },
    { ...settings, [PROVIDER_ENV]: "//iam.googleapis.com/projects/1/x" },
  ];
  for (const environment of broken) {
    let caught: unknown;
    try {
      collectorReadConfig(environment);
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(ApiError);
    expect(caught).toMatchObject({
      status: 503,
      code: "invalid_collector_configuration",
    });
  }
});

function recordingFetcher(
  answer: (url: string) => Response | Promise<Response>,
) {
  const calls: { url: string; init?: RequestInit }[] = [];
  const fetcher = (async (input, init) => {
    calls.push({ url: String(input), init });
    return answer(String(input));
  }) as Fetcher;
  return { calls, fetcher };
}

const reader = (fetcher: Fetcher) =>
  createCollectorReader(
    { readUrl: "https://orrery-read.example.run.app" },
    { fetcher, idToken: async () => "reader-id-token" },
  );

test("lists a run's documents with the reader's ID token", async () => {
  const document = collectorDocument({ run_id: "uk-build.stage:1" });
  const { calls, fetcher } = recordingFetcher(() =>
    Response.json({ documents: [document] }),
  );
  expect(await reader(fetcher).list("uk-build.stage:1")).toEqual([document]);
  expect(calls[0].url).toBe(
    "https://orrery-read.example.run.app/v1/orrery-graphs?run_id=uk-build.stage%3A1",
  );
  expect(new Headers(calls[0].init?.headers).get("authorization")).toBe(
    "Bearer reader-id-token",
  );
  expect(calls[0].init?.redirect).toBe("error");
  expect(calls[0].init?.cache).toBe("no-store");
});

test("a listing the contract does not allow is refused", async () => {
  const valid = collectorDocument();
  const bad: unknown[] = [
    { documents: [{ ...valid, visibility: "secret" }] },
    { documents: [{ ...valid, reconstructed: "yes" }] },
    { documents: [{ ...valid, document_sha256: "A".repeat(64) }] },
    { documents: [{ ...valid, submission_id: "../other" }] },
    { documents: [{ ...valid, document_path: "https://elsewhere/x" }] },
    {
      documents: [
        {
          ...valid,
          document_path: "/v1/orrery-graphs/sub-x/../graph.orrery.json",
        },
      ],
    },
    {
      documents: [
        { ...valid, upstream_paths: ["/v1/orrery-graphs/a/b/c.json"] },
      ],
    },
    { documents: [{ ...valid, run_id: "other-run" }] },
    { documents: [{ ...valid, created_at: "yesterday" }] },
    { documents: [{ ...valid, document_bytes: 0 }] },
    { documents: "none" },
  ];
  for (const listing of bad) {
    const { fetcher } = recordingFetcher(() => Response.json(listing));
    await expect(reader(fetcher).list("run-1")).rejects.toMatchObject({
      status: 503,
      code: "invalid_collector_response",
    });
  }
  for (const status of [401, 403, 422, 500, 503]) {
    const { fetcher } = recordingFetcher(() => new Response("{}", { status }));
    await expect(reader(fetcher).list("run-1")).rejects.toMatchObject({
      status: 503,
      code: "collector_unavailable",
    });
  }
  const { fetcher } = recordingFetcher(() => {
    throw new TypeError("connection reset");
  });
  await expect(reader(fetcher).list("run-1")).rejects.toMatchObject({
    status: 503,
    code: "collector_unavailable",
  });
});

test("a fetched file is returned only when its body matches the ETag and the expected SHA-256", async () => {
  const bytes = documentBytes();
  const digest = sha256(bytes);
  const path = `/v1/orrery-graphs/sub-${"1".repeat(32)}/${digest}/graph.orrery.json`;
  const served = (body: BodyInit, headers: Record<string, string> = {}) =>
    new Response(body, {
      headers: {
        "Content-Type": "application/json",
        ETag: `"${digest}"`,
        "X-Orrery-Visibility": "public",
        ...headers,
      },
    });
  const { calls, fetcher } = recordingFetcher(() => served(bytes));
  const result = await reader(fetcher).file(path, digest, bytes.length);
  // The parts as received, without a second whole copy.
  expect(result && Buffer.concat(result.parts).toString()).toBe(
    Buffer.from(bytes).toString(),
  );
  expect(result?.visibility).toBe("public");
  expect(calls[0].url).toBe(`https://orrery-read.example.run.app${path}`);
  expect(new Headers(calls[0].init?.headers).get("authorization")).toBe(
    "Bearer reader-id-token",
  );

  const refused: [string, Response][] = [
    ["body ends early", served(bytes.slice(0, bytes.length - 5))],
    ["other bytes", served(new TextEncoder().encode("x".repeat(bytes.length)))],
    ["ETag differs", served(bytes, { ETag: `"${"0".repeat(64)}"` })],
    ["no ETag", served(bytes, { ETag: "" })],
    ["unknown visibility", served(bytes, { "X-Orrery-Visibility": "maybe" })],
    ["longer than allowed", served(new Uint8Array(bytes.length + 1))],
  ];
  for (const [, response] of refused) {
    const { fetcher } = recordingFetcher(() => response);
    await expect(
      reader(fetcher).file(path, digest, bytes.length),
    ).rejects.toMatchObject({
      status: 503,
      code: "invalid_collector_response",
    });
  }
  // The expected digest is checked even when the collector's ETag agrees
  // with the body.
  const other = new TextEncoder().encode('{"other":true}');
  const { fetcher: mismatched } = recordingFetcher(() =>
    served(other, { ETag: `"${sha256(other)}"` }),
  );
  await expect(
    reader(mismatched).file(path, digest, bytes.length),
  ).rejects.toMatchObject({ status: 503, code: "invalid_collector_response" });
});

test("a missing file is null, other answers are a 503, and paths outside the contract are never fetched", async () => {
  const digest = "a".repeat(64);
  const path = `/v1/orrery-graphs/sub-${"1".repeat(32)}/${digest}/graph.orrery.json`;
  const { fetcher: missing } = recordingFetcher(
    () => new Response("{}", { status: 404 }),
  );
  expect(await reader(missing).file(path, digest, 10)).toBeNull();
  const { fetcher: failing } = recordingFetcher(
    () => new Response("{}", { status: 500 }),
  );
  await expect(reader(failing).file(path, digest, 10)).rejects.toMatchObject({
    status: 503,
    code: "collector_unavailable",
  });
  const { calls, fetcher } = recordingFetcher(() => new Response("{}"));
  for (const outside of [
    "https://elsewhere.example/graph.orrery.json",
    "/v1/orrery-graphs/../admin",
    `/v1/orrery-graphs/sub-${"1".repeat(32)}/${digest}/evidence-x-graph.json`,
  ])
    await expect(reader(fetcher).file(outside, digest, 10)).rejects.toThrow();
  expect(calls).toEqual([]);
});

test("lists every run's newest documents a page at a time, with the reader's ID token", async () => {
  const first = collectorDocument({ run_id: "uk-build.stage:1" });
  const second = collectorDocument({
    run_id: "run-2",
    submission_id: `sub-${"2".repeat(32)}`,
  });
  const { calls, fetcher } = recordingFetcher(() =>
    Response.json({ documents: [first, second], next_before: "eyJhIjoxfQ" }),
  );
  expect(await reader(fetcher).recent(null)).toEqual({
    documents: [first, second],
    next_before: "eyJhIjoxfQ",
  });
  expect(calls[0].url).toBe(
    "https://orrery-read.example.run.app/v1/orrery-graphs?limit=50",
  );
  expect(new Headers(calls[0].init?.headers).get("authorization")).toBe(
    "Bearer reader-id-token",
  );
  expect(calls[0].init?.redirect).toBe("error");
  expect(calls[0].init?.cache).toBe("no-store");

  const next = recordingFetcher(() =>
    Response.json({ documents: [], next_before: null }),
  );
  expect(await reader(next.fetcher).recent("eyJhIjoxfQ")).toEqual({
    documents: [],
    next_before: null,
  });
  expect(next.calls[0].url).toBe(
    "https://orrery-read.example.run.app/v1/orrery-graphs?limit=50&before=eyJhIjoxfQ",
  );
});

test("a page of every run's documents the contract does not allow is refused", async () => {
  const valid = collectorDocument();
  const bad: unknown[] = [
    { documents: [valid] },
    { documents: [valid], next_before: 5 },
    { documents: [valid], next_before: "" },
    { documents: [valid], next_before: "not/base64url" },
    { documents: [valid], next_before: "a".repeat(257) },
    {
      documents: [{ ...valid, run_id: "a run with spaces" }],
      next_before: null,
    },
    { documents: [{ ...valid, run_id: 7 }], next_before: null },
    { documents: [{ ...valid, visibility: "secret" }], next_before: null },
    { documents: Array.from({ length: 51 }, () => valid), next_before: null },
    { documents: "none", next_before: null },
  ];
  for (const page of bad) {
    const { fetcher } = recordingFetcher(() => Response.json(page));
    await expect(reader(fetcher).recent(null)).rejects.toMatchObject({
      status: 503,
      code: "invalid_collector_response",
    });
  }
  for (const status of [401, 403, 422, 500, 503]) {
    const { fetcher } = recordingFetcher(() => new Response("{}", { status }));
    await expect(reader(fetcher).recent(null)).rejects.toMatchObject({
      status: 503,
      code: "collector_unavailable",
    });
  }
});

test("a read service cursor is base64url of at most 256 characters", () => {
  expect(isCollectorCursor("eyJhIjoxfQ")).toBe(true);
  expect(isCollectorCursor("a-_Z9".repeat(51) + "a")).toBe(true);
  for (const cursor of ["", "a".repeat(257), "not/base64url", "a b", "a=", "é"])
    expect(isCollectorCursor(cursor)).toBe(false);
});

test("a cursor the read service refuses is a bad request, not an unavailable read service", async () => {
  const { fetcher } = recordingFetcher(() =>
    Response.json(
      {
        detail: "before is not a cursor this listing gave.",
        code: "orrery_graph_query_invalid",
      },
      { status: 422 },
    ),
  );

  await expect(reader(fetcher).recent("AAAA")).rejects.toMatchObject({
    status: 400,
    code: "invalid_cursor",
  });
  // Without a cursor, a 422 means the read service has no such listing yet.
  await expect(reader(fetcher).recent(null)).rejects.toMatchObject({
    status: 503,
    code: "collector_unavailable",
  });
});
