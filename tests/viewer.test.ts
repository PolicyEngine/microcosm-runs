import { expect, test } from "bun:test";
import { encodeLocation, decodeLocation } from "@axiom-foundation/orrery";
import { loadDocument } from "../lib/viewer";
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
  expect(loaded?.metadata).toEqual(metadata);
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
