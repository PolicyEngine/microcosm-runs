import { expect, test } from "bun:test";
import { encodeLocation, decodeLocation } from "@axiom-foundation/orrery";
import {
  loadDocument,
  loadMoreRuns,
  loadRunList,
  runPagePath,
  SignInRequired,
} from "../lib/viewer";
import {
  appendRuns,
  runListDate,
  type RunListEntry,
} from "../lib/run-metadata";
import type { Fetcher } from "../lib/net";
import { sha256 } from "../lib/contract";
const document = {
  schemaVersion: "graph-explorer/v1",
  id: "fixture",
  title: "Fixture",
  nodes: [],
  edges: [],
};
test("viewer downloads exact graph bytes directly from Blob", async () => {
  const bytes = JSON.stringify(document);
  const calls: string[] = [];
  const fetcher = (async (url) => {
    calls.push(String(url));
    return calls.length === 1
      ? Response.json({
          publication_id: "graph",
          files: [
            {
              name: "graph.orrery.json",
              role: "graph",
              bytes: new TextEncoder().encode(bytes).length,
              sha256: sha256(bytes),
              url: "https://example.public.blob.vercel-storage.com/graph.json",
            },
          ],
        })
      : new Response(bytes);
  }) as Fetcher;
  expect(
    (await loadDocument("graph", new AbortController().signal, fetcher))
      .document.id,
  ).toBe("fixture");
  expect(calls[1]).toBe(
    "https://example.public.blob.vercel-storage.com/graph.json",
  );
});
test("viewer handles missing publications and rejects mismatched byte digests", async () => {
  await expect(
    loadDocument(
      "missing",
      new AbortController().signal,
      (async () => new Response("", { status: 404 })) as Fetcher,
    ),
  ).rejects.toThrow("not found");
  let call = 0;
  await expect(
    loadDocument("graph", new AbortController().signal, (async () =>
      ++call === 1
        ? Response.json({
            publication_id: "graph",
            files: [
              {
                name: "graph.orrery.json",
                role: "graph",
                bytes: 2,
                sha256: "a".repeat(64),
                url: "https://example.public.blob.vercel-storage.com/graph.json",
              },
            ],
          })
        : new Response("{}")) as Fetcher),
  ).rejects.toThrow("digest");
});
test("Orrery deep links preserve selections and filters", () => {
  const location = {
    selectedId: "node/1",
    query: "calibration",
    focusId: "one",
    direction: "upstream" as const,
  };
  expect(decodeLocation(encodeLocation(location))).toMatchObject(location);
});

test("viewer reads a local development graph from this app's own route", async () => {
  const bytes = JSON.stringify(document);
  const calls: string[] = [];
  const fetcher = (async (url) => {
    calls.push(String(url));
    return calls.length === 1
      ? Response.json({
          publication_id: "graph",
          files: [
            {
              name: "graph.orrery.json",
              role: "graph",
              bytes: new TextEncoder().encode(bytes).length,
              sha256: sha256(bytes),
              url: "/runs/graph/graph.orrery.json",
            },
          ],
        })
      : new Response(bytes);
  }) as Fetcher;
  await loadDocument("graph", new AbortController().signal, fetcher);
  expect(calls[1]).toBe("/runs/graph/graph.orrery.json");
});

test("viewer refuses other same-origin or non-Blob graph locations", async () => {
  for (const url of [
    "/runs/other/graph.orrery.json",
    "https://example.com/graph.json",
  ]) {
    const fetcher = (async () =>
      Response.json({
        publication_id: "graph",
        files: [
          {
            name: "graph.orrery.json",
            role: "graph",
            bytes: 1,
            sha256: "0".repeat(64),
            url,
          },
        ],
      })) as Fetcher;
    await expect(
      loadDocument("graph", new AbortController().signal, fetcher),
    ).rejects.toThrow();
  }
});

test("viewer asks for the page's selected document and reads the collector graph through this app", async () => {
  const bytes = JSON.stringify(document);
  const selection = `sub-${"1".repeat(32)}/${sha256(bytes)}`;
  const graphUrl = `/runs/run-1/graph.orrery.json?document=${encodeURIComponent(selection)}`;
  const metadata = {
    source: "collector",
    publication_id: "run-1",
    document: { submission_id: `sub-${"1".repeat(32)}`, reconstructed: true },
    documents: [],
    files: [
      {
        name: "graph.orrery.json",
        role: "graph",
        bytes: new TextEncoder().encode(bytes).length,
        sha256: sha256(bytes),
        url: graphUrl,
      },
    ],
  };
  const calls: string[] = [];
  const fetcher = (async (url) => {
    calls.push(String(url));
    return calls.length === 1 ? Response.json(metadata) : new Response(bytes);
  }) as Fetcher;
  const loaded = await loadDocument(
    "run-1",
    new AbortController().signal,
    fetcher,
    `?document=${encodeURIComponent(selection)}`,
  ).catch(() => undefined);
  expect(calls).toEqual([
    `/api/runs/run-1/?document=${encodeURIComponent(selection)}`,
    graphUrl,
  ]);
  expect(loaded?.document.id).toBe("fixture");
  expect(loaded?.metadata as unknown).toEqual(metadata);
});

test("viewer refuses collector graph routes of another run or with other query parameters", async () => {
  for (const url of [
    "/runs/run-2/graph.orrery.json?document=x",
    "/runs/run-1/graph.orrery.json?document=x&next=https://evil.example",
    "/runs/run-1/graph.orrery.json?other=x",
    "//evil.example/runs/run-1/graph.orrery.json?document=x",
  ]) {
    const fetcher = (async () =>
      Response.json({
        publication_id: "run-1",
        files: [
          {
            name: "graph.orrery.json",
            role: "graph",
            bytes: 1,
            sha256: "0".repeat(64),
            url,
          },
        ],
      })) as Fetcher;
    await expect(
      loadDocument("run-1", new AbortController().signal, fetcher),
    ).rejects.toThrow("Invalid graph storage URL.");
  }
});

test("a licensed run asks the person to sign in, and comes back to the same page", async () => {
  const fetcher = (async () =>
    Response.json({ error: "sign_in_required" }, { status: 401 })) as Fetcher;
  const failure = await loadDocument(
    "run-1",
    new AbortController().signal,
    fetcher,
    "?document=x",
  ).then(
    () => null,
    (error: unknown) => error,
  );
  expect(failure).toBeInstanceOf(SignInRequired);
  expect((failure as SignInRequired).signInHref).toBe(
    `/api/auth/google/start/?next=${encodeURIComponent("/runs/run-1/?document=x")}`,
  );
});

test("the run page keeps its trailing slash, so relative upstream links stay inside the run", () => {
  // Next.js redirects /runs/<id>/ to /runs/<id> when the ID ends like a file
  // name, such as `.stage1`.
  expect(runPagePath("/runs/uk-build.stage1")).toBe("/runs/uk-build.stage1/");
  expect(runPagePath("/runs/run-1/")).toBe("/runs/run-1/");
});

test("metadata without a source is a publication store record, and collector metadata must name its document", async () => {
  const bytes = JSON.stringify(document);
  const file = {
    name: "graph.orrery.json",
    role: "graph",
    bytes: new TextEncoder().encode(bytes).length,
    sha256: sha256(bytes),
    url: "https://example.public.blob.vercel-storage.com/graph.json",
  };
  let call = 0;
  const older = await loadDocument(
    "graph",
    new AbortController().signal,
    (async () =>
      ++call === 1
        ? Response.json({ publication_id: "graph", files: [file] })
        : new Response(bytes)) as Fetcher,
  );
  expect(older.metadata.source).toBe("publication");
  for (const metadata of [
    { source: "collector", publication_id: "graph", files: [file] },
    { source: "other", publication_id: "graph", files: [file] },
  ])
    await expect(
      loadDocument("graph", new AbortController().signal, (async () =>
        Response.json(metadata)) as Fetcher),
    ).rejects.toThrow("Invalid graph publication metadata.");
});

const runListPage = {
  viewer: { signed_in_as: null, sign_in_available: true },
  runs: [
    {
      run_id: "uk-run.stage:2",
      build_id: "build-b",
      country_code: "GB",
      created_at: "2026-11-11T09:00:00+00:00",
      reconstructed: false,
    },
  ],
  next_before: "abc_-1",
};

test("the run list loads a page of runs, and the next one from its cursor", async () => {
  const calls: string[] = [];
  const fetcher = (async (url) => {
    calls.push(String(url));
    return Response.json(runListPage);
  }) as Fetcher;
  const signal = new AbortController().signal;

  expect(await loadRunList(null, signal, fetcher)).toEqual(runListPage);
  expect(await loadRunList("abc_-1", signal, fetcher)).toEqual(runListPage);
  expect(calls).toEqual(["/api/runs/", "/api/runs/?before=abc_-1"]);
});

test("a deployment without a run list gives none, and a bad run list answer is refused", async () => {
  const answering = (response: Response) =>
    (async () => response.clone()) as unknown as Fetcher;
  const signal = new AbortController().signal;

  expect(
    await loadRunList(
      null,
      signal,
      answering(Response.json({ error: "not_found" }, { status: 404 })),
    ),
  ).toBeNull();
  const bad: unknown[] = [
    { ...runListPage, runs: "none" },
    { ...runListPage, next_before: 5 },
    { ...runListPage, viewer: null },
    { ...runListPage, runs: [{ ...runListPage.runs[0], run_id: "a b" }] },
    { ...runListPage, runs: [{ ...runListPage.runs[0], reconstructed: "no" }] },
    { ...runListPage, runs: [{ ...runListPage.runs[0], build_id: 1 }] },
  ];
  for (const answer of bad)
    await expect(
      loadRunList(null, signal, answering(Response.json(answer))),
    ).rejects.toThrow("Invalid run list.");
  await expect(
    loadRunList(
      null,
      signal,
      answering(Response.json({ error: "x" }, { status: 503 })),
    ),
  ).rejects.toThrow("The run list is unavailable.");
});

test("more runs add only those not already listed, and dates show to the minute in UTC", () => {
  const run = (run_id: string): RunListEntry => ({
    run_id,
    build_id: "build",
    country_code: "GB",
    created_at: "2026-11-11T09:00:00+00:00",
    reconstructed: false,
  });

  expect(
    appendRuns([run("a"), run("b")], [run("b"), run("c")]).map(
      (entry) => entry.run_id,
    ),
  ).toEqual(["a", "b", "c"]);
  expect(runListDate("2026-11-12T09:05:59.999+00:00")).toBe(
    "2026-11-12 09:05 UTC",
  );
  expect(runListDate("2026-11-12T10:05:00+01:00")).toBe("2026-11-12 09:05 UTC");
});

function runListEntry(run_id: string): RunListEntry {
  return {
    run_id,
    build_id: "build",
    country_code: "GB",
    created_at: "2026-11-11T09:00:00+00:00",
    reconstructed: false,
  };
}

/** A run list route that answers these pages by their `before`. */
function runListRoute(pages: Record<string, unknown>) {
  const asked: (string | null)[] = [];
  const fetcher = (async (url) => {
    const before = new URL(
      String(url),
      "https://runs.invalid",
    ).searchParams.get("before");
    asked.push(before);
    return Response.json(pages[before ?? ""]);
  }) as Fetcher;
  return { asked, fetcher };
}

const viewer = { signed_in_as: null, sign_in_available: true };

test("more runs read on until a page adds a run not already listed", async () => {
  const { asked, fetcher } = runListRoute({
    "cursor-0": {
      viewer,
      runs: [runListEntry("run-a")],
      next_before: "cursor-1",
    },
    "cursor-1": {
      viewer,
      runs: [runListEntry("run-b")],
      next_before: "cursor-2",
    },
  });

  const more = await loadMoreRuns(
    [runListEntry("run-a")],
    "cursor-0",
    new AbortController().signal,
    fetcher,
  );

  expect(more?.runs.map((run) => run.run_id)).toEqual(["run-a", "run-b"]);
  expect(more?.next_before).toBe("cursor-2");
  expect(asked).toEqual(["cursor-0", "cursor-1"]);
});

test("more runs make at most three requests, and stop at the last page", async () => {
  const repeating = (next_before: string | null) => ({
    viewer,
    runs: [runListEntry("run-a")],
    next_before,
  });
  const endless = runListRoute({
    "": repeating("cursor-1"),
    "cursor-1": repeating("cursor-2"),
    "cursor-2": repeating("cursor-3"),
    "cursor-3": repeating("cursor-4"),
  });
  const ending = runListRoute({ "": repeating(null) });
  const signal = new AbortController().signal;

  const capped = await loadMoreRuns(
    [runListEntry("run-a")],
    null,
    signal,
    endless.fetcher,
  );
  const ended = await loadMoreRuns(
    [runListEntry("run-a")],
    null,
    signal,
    ending.fetcher,
  );

  expect(capped?.runs.map((run) => run.run_id)).toEqual(["run-a"]);
  expect(capped?.next_before).toBe("cursor-3");
  expect(endless.asked).toEqual([null, "cursor-1", "cursor-2"]);
  expect(ended?.next_before).toBeNull();
  expect(ending.asked).toEqual([null]);
  expect(
    await loadMoreRuns([], null, signal, (async () =>
      Response.json({}, { status: 404 })) as unknown as Fetcher),
  ).toBeNull();
});
