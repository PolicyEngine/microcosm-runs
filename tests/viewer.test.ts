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
