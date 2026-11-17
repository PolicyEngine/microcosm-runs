import { expect, test } from "bun:test";
import { sha256, type Publication } from "../lib/contract";
import { ApiError } from "../lib/contract";
import type {
  CollectorDocument,
  CollectorPage,
  CollectorReader,
} from "../lib/collector";
import {
  runFileResponse,
  runListResponse,
  runMetadataResponse,
  type PublicationReader,
  type RunDependencies,
} from "../lib/runs";
import { collectorDocument, documentBytes } from "./support/collector";

const blobPublication: Publication = {
  version: 1,
  publication_id: "older-publication",
  files: [
    {
      name: "graph.orrery.json",
      role: "graph",
      bytes: 10,
      sha256: "b".repeat(64),
      url: "https://store.public.blob.vercel-storage.com/objects/graph.orrery.json",
    },
  ],
  inventory_sha256: "c".repeat(64),
  published_at: "2026-10-20T10:00:00.000Z",
};

const publications: PublicationReader = {
  async read(id) {
    return id === blobPublication.publication_id ? blobPublication : null;
  },
  async evidence(id, name) {
    return id === blobPublication.publication_id && name === "graph.orrery.json"
      ? blobPublication.files[0].url
      : null;
  },
};

interface FakeCollector extends CollectorReader {
  listed: string[];
  fetched: string[];
  /** The `before` of each page of every run's documents asked for. */
  pagesAsked: (string | null)[];
}

/**
 * A read service holding these documents and these file bytes by path. Its
 * listing of every run's documents gives `pages`, by the `before` that asks
 * for each (`""` for the first); by default, all the documents on one page.
 */
function fakeCollector(
  documents: CollectorDocument[],
  files: Record<string, Uint8Array> = {},
  visibility: (path: string) => "public" | "private" = () => "public",
  pages: Record<string, CollectorPage> = {
    "": { documents, next_before: null },
  },
): FakeCollector {
  const listed: string[] = [];
  const fetched: string[] = [];
  const pagesAsked: (string | null)[] = [];
  return {
    listed,
    fetched,
    pagesAsked,
    async recent(before) {
      pagesAsked.push(before);
      const page = pages[before ?? ""];
      if (!page) throw new ApiError(503, "invalid_collector_response");
      return page;
    },
    async list(runId) {
      listed.push(runId);
      return documents.filter((document) => document.run_id === runId);
    },
    async file(path, expectedSha256) {
      fetched.push(path);
      const bytes = files[path];
      if (!bytes) return null;
      expect(sha256(bytes)).toBe(expectedSha256);
      // Received in two parts, as a stream can arrive.
      const middle = Math.floor(bytes.length / 2);
      return {
        parts: [bytes.subarray(0, middle), bytes.subarray(middle)],
        visibility: visibility(path),
      };
    },
  };
}

const dependencies = (collector: CollectorReader | null): RunDependencies => ({
  local: null,
  collector,
  publications,
});

const search = (value = "") => new URLSearchParams(value);

test("with collector reads off, metadata and files come from the publication store as before", async () => {
  const metadata = await runMetadataResponse(
    "older-publication",
    search(),
    dependencies(null),
  );
  expect(metadata.status).toBe(200);
  // Not a year: the same URL answers from the collector once collector reads
  // are turned on, and a browser must ask again by then.
  expect(metadata.headers.get("cache-control")).toBe("public, max-age=300");
  expect(await metadata.json()).toEqual({
    ...blobPublication,
    source: "publication",
  });
  const missing = await runMetadataResponse(
    "absent",
    search(),
    dependencies(null),
  );
  expect(missing.status).toBe(404);
  const file = await runFileResponse(
    "older-publication",
    "graph.orrery.json",
    search(),
    dependencies(null),
  );
  expect(file.status).toBe(307);
  expect(file.headers.get("location")).toBe(blobPublication.files[0].url);
});

test("with collector reads on, a run's newest public document and its provenance are served", async () => {
  const older = collectorDocument({
    bytes: documentBytes("older"),
    submission_id: `sub-${"2".repeat(32)}`,
    created_at: "2026-11-01T09:00:00+00:00",
    current: false,
  });
  const newest = collectorDocument({
    bytes: documentBytes("newest"),
    reconstructed: true,
  });
  const collector = fakeCollector([newest, older]);
  const response = await runMetadataResponse(
    "run-1",
    search(),
    dependencies(collector),
  );
  expect(response.status).toBe(200);
  expect(response.headers.get("cache-control")).toBe("no-store");
  const body = await response.json();
  expect(body.source).toBe("collector");
  expect(body.publication_id).toBe("run-1");
  const provenance = {
    submission_id: newest.submission_id,
    document_sha256: newest.document_sha256,
    document_bytes: newest.document_bytes,
    run_id: "run-1",
    build_id: "build-1",
    country_code: "GB",
    orrery_version: "0.6.2",
    projection_source: "8d159a8c5653ad63affb1a5d2e39034f877db2ff",
    collector_version: "0.19.0",
    reconstructed: true,
    created_at: "2026-11-11T20:10:00+00:00",
    visibility: "public",
    current: true,
  };
  expect(body.document).toEqual(provenance);
  // Paths inside the collector stay on the server.
  expect(JSON.stringify(body)).not.toContain("/v1/orrery-graphs");
  expect(body.documents.map((d: CollectorDocument) => d.submission_id)).toEqual(
    [newest.submission_id, older.submission_id],
  );
  expect(body.files).toEqual([
    {
      name: "graph.orrery.json",
      role: "graph",
      bytes: newest.document_bytes,
      sha256: newest.document_sha256,
      url: `/runs/run-1/graph.orrery.json?document=${encodeURIComponent(
        `${newest.submission_id}/${newest.document_sha256}`,
      )}`,
    },
  ]);
  expect(collector.listed).toEqual(["run-1"]);
});

test("a document is selected by its submission and SHA-256; an unknown selection is not found", async () => {
  const older = collectorDocument({
    bytes: documentBytes("older"),
    submission_id: `sub-${"2".repeat(32)}`,
    created_at: "2026-11-01T09:00:00+00:00",
    current: false,
  });
  const newest = collectorDocument({ bytes: documentBytes("newest") });
  const run = dependencies(fakeCollector([newest, older]));
  const selected = await runMetadataResponse(
    "run-1",
    search(`document=${older.submission_id}/${older.document_sha256}`),
    run,
  );
  expect(selected.status).toBe(200);
  expect((await selected.json()).document?.submission_id).toBe(
    older.submission_id,
  );
  for (const selection of [
    `${older.submission_id}/${"f".repeat(64)}`,
    "not-a-document",
    `${older.submission_id}/${older.document_sha256}/extra`,
  ]) {
    const response = await runMetadataResponse(
      "run-1",
      search(`document=${encodeURIComponent(selection)}`),
      run,
    );
    expect(response.status).toBe(404);
    expect(response.headers.get("cache-control")).toBe("no-store");
  }
});

test("private documents are never listed or served before staff sign-in exists", async () => {
  const privateBytes = documentBytes("licensed");
  const licensed = collectorDocument({
    bytes: privateBytes,
    visibility: "private",
  });
  const collector = fakeCollector([licensed], {
    [licensed.document_path]: privateBytes,
  });
  const metadata = await runMetadataResponse(
    "run-1",
    search(),
    dependencies(collector),
  );
  expect(metadata.status).toBe(404);
  expect(metadata.headers.get("cache-control")).toBe("no-store");
  expect(JSON.stringify(await metadata.json())).not.toContain(
    licensed.submission_id,
  );
  const selected = await runFileResponse(
    "run-1",
    "graph.orrery.json",
    search(`document=${licensed.submission_id}/${licensed.document_sha256}`),
    dependencies(collector),
  );
  expect(selected.status).toBe(404);
  expect(collector.fetched).toEqual([]);

  const mixed = collectorDocument({
    bytes: documentBytes("public"),
    submission_id: `sub-${"3".repeat(32)}`,
    created_at: "2026-11-01T09:00:00+00:00",
  });
  const listing = await runMetadataResponse(
    "run-1",
    search(),
    dependencies(fakeCollector([licensed, mixed])),
  );
  const body = await listing.json();
  expect(body.document.submission_id).toBe(mixed.submission_id);
  expect(body.documents.length).toBe(1);
});

test("a run the collector has no document for falls back to the publication store, uncached", async () => {
  const collector = fakeCollector([]);
  const metadata = await runMetadataResponse(
    "older-publication",
    search(),
    dependencies(collector),
  );
  expect(metadata.status).toBe(200);
  expect(metadata.headers.get("cache-control")).toBe("no-store");
  expect((await metadata.json()).source).toBe("publication");
  const file = await runFileResponse(
    "older-publication",
    "graph.orrery.json",
    search(),
    dependencies(collector),
  );
  expect(file.status).toBe(307);
  // A run ID that is not a publication ID is simply not found there.
  const dotted = await runMetadataResponse(
    "uk-build.stage:1",
    search(),
    dependencies(collector),
  );
  expect(dotted.status).toBe(404);
  expect(collector.listed).toContain("uk-build.stage:1");
});

test("an invalid run ID is refused before the collector is asked", async () => {
  const collector = fakeCollector([]);
  for (const id of ["../etc", "", ".hidden", "a".repeat(193)]) {
    const response = await runMetadataResponse(
      id,
      search(),
      dependencies(collector),
    );
    expect(response.status).toBe(400);
  }
  expect(collector.listed).toEqual([]);
});

test("graph and upstream files are fetched from the collector, checked, and sent as a stream", async () => {
  const upstream = new TextEncoder().encode('{"producing":"run"}');
  const upstreamName = `upstream-${sha256(upstream)}.json`;
  const bytes = documentBytes("with upstream", upstreamName);
  const document = collectorDocument({ bytes });
  const upstreamPath = `/v1/orrery-graphs/${document.submission_id}/${document.document_sha256}/${upstreamName}`;
  document.upstream_paths = [upstreamPath];
  const collector = fakeCollector([document], {
    [document.document_path]: bytes,
    [upstreamPath]: upstream,
  });
  const graph = await runFileResponse(
    "run-1",
    "graph.orrery.json",
    search(`document=${document.submission_id}/${document.document_sha256}`),
    dependencies(collector),
  );
  expect(graph.status).toBe(200);
  expect(graph.body).toBeInstanceOf(ReadableStream);
  expect(new Uint8Array(await graph.arrayBuffer())).toEqual(bytes);
  expect(graph.headers.get("content-type")).toBe("application/json");
  expect(graph.headers.get("etag")).toBe(`"${document.document_sha256}"`);
  expect(graph.headers.get("cache-control")).toBe("public, max-age=300");
  expect(graph.headers.get("x-content-type-options")).toBe("nosniff");

  const newest = await runFileResponse(
    "run-1",
    "graph.orrery.json",
    search(),
    dependencies(collector),
  );
  expect(new Uint8Array(await newest.arrayBuffer())).toEqual(bytes);

  const linked = await runFileResponse(
    "run-1",
    upstreamName,
    search(),
    dependencies(collector),
  );
  expect(linked.status).toBe(200);
  expect(new Uint8Array(await linked.arrayBuffer())).toEqual(upstream);
  expect(linked.headers.get("etag")).toBe(`"${sha256(upstream)}"`);
  expect(collector.fetched).toEqual([
    document.document_path,
    document.document_path,
    upstreamPath,
  ]);

  for (const name of [
    `upstream-${"9".repeat(64)}.json`,
    "execution.evidence.json",
    "evidence-x-graph.json",
  ]) {
    const response = await runFileResponse(
      "run-1",
      name,
      search(),
      dependencies(collector),
    );
    expect(response.status).toBe(404);
    expect(response.headers.get("cache-control")).toBe("no-store");
  }
});

test("a file the read service now marks private, or that it no longer holds, is not served", async () => {
  const bytes = documentBytes("turned private");
  const document = collectorDocument({ bytes });
  const turnedPrivate = await runFileResponse(
    "run-1",
    "graph.orrery.json",
    search(),
    dependencies(
      fakeCollector(
        [document],
        { [document.document_path]: bytes },
        () => "private",
      ),
    ),
  );
  expect(turnedPrivate.status).toBe(404);
  expect(turnedPrivate.headers.get("cache-control")).toBe("no-store");
  const gone = await runFileResponse(
    "run-1",
    "graph.orrery.json",
    search(),
    dependencies(fakeCollector([document], {})),
  );
  expect(gone.status).toBe(404);
});

test("a collector that cannot be read is a 503, never a fallback to the publication store", async () => {
  const unavailable: CollectorReader = {
    async list() {
      const { ApiError } = await import("../lib/contract");
      throw new ApiError(503, "collector_unavailable");
    },
    async file() {
      return null;
    },
  };
  const metadata = await runMetadataResponse(
    "older-publication",
    search(),
    dependencies(unavailable),
  );
  expect(metadata.status).toBe(503);
  expect(await metadata.json()).toEqual({ error: "collector_unavailable" });
  expect(metadata.headers.get("cache-control")).toBe("no-store");
  const file = await runFileResponse(
    "older-publication",
    "graph.orrery.json",
    search(),
    dependencies(unavailable),
  );
  expect(file.status).toBe(503);
});

const staff = {
  staffEmail: "staff@policyengine.org",
  signInAvailable: true,
};
const anonymous = { staffEmail: null, signInAvailable: true };

test("signed-in staff see a licensed run's private documents, never cached", async () => {
  const upstream = new TextEncoder().encode('{"licensed":"producer"}');
  const upstreamName = `upstream-${sha256(upstream)}.json`;
  const bytes = documentBytes("licensed", upstreamName);
  const licensed = collectorDocument({ bytes, visibility: "private" });
  const upstreamPath = `/v1/orrery-graphs/${licensed.submission_id}/${licensed.document_sha256}/${upstreamName}`;
  licensed.upstream_paths = [upstreamPath];
  const collector = fakeCollector(
    [licensed],
    { [licensed.document_path]: bytes, [upstreamPath]: upstream },
    () => "private",
  );
  const metadata = await runMetadataResponse(
    "run-1",
    search(),
    dependencies(collector),
    staff,
  );
  expect(metadata.status).toBe(200);
  expect(metadata.headers.get("cache-control")).toBe("private, no-store");
  const body = await metadata.json();
  expect(body.document.visibility).toBe("private");
  expect(body.viewer).toEqual({
    signed_in_as: "staff@policyengine.org",
    sign_in_available: true,
  });
  for (const name of ["graph.orrery.json", upstreamName]) {
    const file = await runFileResponse(
      "run-1",
      name,
      search(),
      dependencies(collector),
      staff,
    );
    expect(file.status).toBe(200);
    expect(file.headers.get("cache-control")).toBe("private, no-store");
    expect(file.headers.get("vary")).toBe("Cookie");
    expect(new Uint8Array(await file.arrayBuffer())).toEqual(
      name === upstreamName ? upstream : bytes,
    );
  }
});

test("everyone else is asked to sign in for a licensed run, and is sent nothing of it", async () => {
  const bytes = documentBytes("licensed");
  const licensed = collectorDocument({ bytes, visibility: "private" });
  const collector = fakeCollector([licensed], {
    [licensed.document_path]: bytes,
  });
  const metadata = await runMetadataResponse(
    "run-1",
    search(),
    dependencies(collector),
    anonymous,
  );
  expect(metadata.status).toBe(401);
  expect(metadata.headers.get("cache-control")).toBe("no-store");
  expect(await metadata.json()).toEqual({ error: "sign_in_required" });
  // Without sign-in configured there is nothing to sign in to.
  const unconfigured = await runMetadataResponse(
    "run-1",
    search(),
    dependencies(collector),
    { staffEmail: null, signInAvailable: false },
  );
  expect(unconfigured.status).toBe(404);
  const file = await runFileResponse(
    "run-1",
    "graph.orrery.json",
    search(`document=${licensed.submission_id}/${licensed.document_sha256}`),
    dependencies(collector),
    anonymous,
  );
  // A direct link to a licensed file asks for sign-in too.
  expect(file.status).toBe(401);
  expect(await file.json()).toEqual({ error: "sign_in_required" });
  expect(file.headers.get("cache-control")).toBe("no-store");
  const newest = await runFileResponse(
    "run-1",
    "graph.orrery.json",
    search(),
    dependencies(collector),
    anonymous,
  );
  expect(newest.status).toBe(401);
  const withoutSignIn = await runFileResponse(
    "run-1",
    "graph.orrery.json",
    search(),
    dependencies(collector),
    { staffEmail: null, signInAvailable: false },
  );
  expect(withoutSignIn.status).toBe(404);
  expect(collector.fetched).toEqual([]);
});

test("a run with public and private documents lists only the public ones to everyone else", async () => {
  const licensed = collectorDocument({
    bytes: documentBytes("licensed"),
    visibility: "private",
  });
  const open = collectorDocument({
    bytes: documentBytes("public"),
    submission_id: `sub-${"4".repeat(32)}`,
    created_at: "2026-11-01T09:00:00+00:00",
  });
  const collector = fakeCollector([licensed, open]);
  const anonymousBody = await (
    await runMetadataResponse(
      "run-1",
      search(),
      dependencies(collector),
      anonymous,
    )
  ).json();
  expect(
    anonymousBody.documents.map((d: CollectorDocument) => d.submission_id),
  ).toEqual([open.submission_id]);
  expect(anonymousBody.viewer).toEqual({
    signed_in_as: null,
    sign_in_available: true,
  });
  const staffBody = await (
    await runMetadataResponse("run-1", search(), dependencies(collector), staff)
  ).json();
  expect(
    staffBody.documents.map((d: CollectorDocument) => d.submission_id),
  ).toEqual([licensed.submission_id, open.submission_id]);
});

test("a public document stays publicly cacheable when staff fetch it, and one turned private is staff-only", async () => {
  const bytes = documentBytes("public");
  const document = collectorDocument({ bytes });
  const open = await runFileResponse(
    "run-1",
    "graph.orrery.json",
    search(),
    dependencies(
      fakeCollector([document], { [document.document_path]: bytes }),
    ),
    staff,
  );
  expect(open.headers.get("cache-control")).toBe("public, max-age=300");
  const turned = fakeCollector(
    [document],
    { [document.document_path]: bytes },
    () => "private",
  );
  const forStaff = await runFileResponse(
    "run-1",
    "graph.orrery.json",
    search(),
    dependencies(turned),
    staff,
  );
  expect(forStaff.status).toBe(200);
  expect(forStaff.headers.get("cache-control")).toBe("private, no-store");
  const forOthers = await runFileResponse(
    "run-1",
    "graph.orrery.json",
    search(),
    dependencies(turned),
    anonymous,
  );
  expect(forOthers.status).toBe(404);
});

// The homepage's run list.

const runListDocuments = {
  newest: collectorDocument({
    bytes: documentBytes("run-a newest"),
    submission_id: `sub-${"3".repeat(32)}`,
    run_id: "run-a",
    build_id: "build-a",
    created_at: "2026-11-12T09:00:00+00:00",
    reconstructed: true,
  }),
  otherRun: collectorDocument({
    bytes: documentBytes("other run"),
    submission_id: `sub-${"2".repeat(32)}`,
    run_id: "uk-run.stage:2",
    build_id: "build-b",
    country_code: "US",
    created_at: "2026-11-11T09:00:00+00:00",
  }),
  older: collectorDocument({
    bytes: documentBytes("run-a older"),
    submission_id: `sub-${"1".repeat(32)}`,
    run_id: "run-a",
    build_id: "build-a",
    created_at: "2026-11-10T09:00:00+00:00",
    current: false,
  }),
};

test("the run list shows each run once, with its newest document's build, country and date", async () => {
  const { newest, otherRun, older } = runListDocuments;
  const collector = fakeCollector([newest, otherRun, older]);

  const response = await runListResponse(
    search(),
    dependencies(collector),
    anonymous,
  );

  expect(response.status).toBe(200);
  expect(response.headers.get("cache-control")).toBe("no-store");
  expect(await response.json()).toEqual({
    viewer: { signed_in_as: null, sign_in_available: true },
    runs: [
      {
        run_id: "run-a",
        build_id: "build-a",
        country_code: "GB",
        created_at: "2026-11-12T09:00:00+00:00",
        reconstructed: true,
      },
      {
        run_id: "uk-run.stage:2",
        build_id: "build-b",
        country_code: "US",
        created_at: "2026-11-11T09:00:00+00:00",
        reconstructed: false,
      },
    ],
    next_before: null,
  });
  expect(collector.pagesAsked).toEqual([null]);
});

test("signed-out visitors see only runs with public documents; staff see every run, never cached", async () => {
  const { newest, otherRun, older } = runListDocuments;
  const privateNewest = { ...newest, visibility: "private" as const };
  const privateRun = { ...otherRun, visibility: "private" as const };
  const collector = fakeCollector([privateNewest, privateRun, older]);

  const signedOut = await runListResponse(
    search(),
    dependencies(collector),
    anonymous,
  );
  const signedIn = await runListResponse(
    search(),
    dependencies(collector),
    staff,
  );

  expect(signedOut.headers.get("cache-control")).toBe("no-store");
  // Run A appears with its older public document, and nothing of the private
  // newest one.
  expect((await signedOut.json()).runs).toEqual([
    {
      run_id: "run-a",
      build_id: "build-a",
      country_code: "GB",
      created_at: "2026-11-10T09:00:00+00:00",
      reconstructed: false,
    },
  ]);
  expect(signedIn.headers.get("cache-control")).toBe("private, no-store");
  const staffPage = await signedIn.json();
  expect(staffPage.viewer).toEqual({
    signed_in_as: "staff@policyengine.org",
    sign_in_available: true,
  });
  expect(
    staffPage.runs.map(
      (run: { run_id: string; created_at: string }) =>
        `${run.run_id} ${run.created_at}`,
    ),
  ).toEqual([
    "run-a 2026-11-12T09:00:00+00:00",
    "uk-run.stage:2 2026-11-11T09:00:00+00:00",
  ]);
});

test("the run list's next page starts at the read service's cursor", async () => {
  const { newest, otherRun } = runListDocuments;
  const collector = fakeCollector([newest, otherRun], {}, () => "public", {
    "": { documents: [newest], next_before: "cursor-1" },
    "cursor-1": { documents: [otherRun], next_before: null },
  });

  const first = await (
    await runListResponse(search(), dependencies(collector), anonymous)
  ).json();
  const second = await (
    await runListResponse(
      search("before=cursor-1"),
      dependencies(collector),
      anonymous,
    )
  ).json();

  expect(first.runs.map((run: { run_id: string }) => run.run_id)).toEqual([
    "run-a",
  ]);
  expect(first.next_before).toBe("cursor-1");
  expect(second.runs.map((run: { run_id: string }) => run.run_id)).toEqual([
    "uk-run.stage:2",
  ]);
  expect(second.next_before).toBeNull();
  expect(collector.pagesAsked).toEqual([null, "cursor-1"]);
});

test("a malformed run list cursor is refused, and without collector reads there is no run list", async () => {
  const collector = fakeCollector([runListDocuments.newest]);

  const malformed = await runListResponse(
    search("before=not%2Fa%20cursor"),
    dependencies(collector),
  );
  const collectorOff = await runListResponse(search(), dependencies(null));
  const local = await runListResponse(search(), {
    ...dependencies(collector),
    local: { read: async () => null } as unknown as RunDependencies["local"],
  });

  expect(malformed.status).toBe(400);
  expect(await malformed.json()).toEqual({ error: "invalid_cursor" });
  expect(collector.pagesAsked).toEqual([]);
  expect(collectorOff.status).toBe(404);
  expect(local.status).toBe(404);
});

test("a run list the read service can't give answers 503", async () => {
  const collector = fakeCollector([], {}, () => "public", {});

  const response = await runListResponse(
    search(),
    dependencies(collector),
    anonymous,
  );

  expect(response.status).toBe(503);
  expect(await response.json()).toEqual({
    error: "invalid_collector_response",
  });
});
