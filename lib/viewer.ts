import { parseGraphDocument } from "@axiom-foundation/orrery";
import type { Fetcher } from "./net";
import {
  signInHref,
  type RunListEntry,
  type RunListPage,
  type RunMetadata,
} from "./run-metadata";

const invalidLocation = () => new Error("Invalid graph storage URL.");

/** A licensed run: only signed-in staff may view it. */
export class SignInRequired extends Error {
  constructor(public signInHref: string) {
    super("Sign in with a policyengine.org Google account to view this run.");
  }
}

/**
 * Where the graph may be fetched from: this app's own route for the run
 * (a local development file, or a collector document named by its
 * `document` selection), or public Blob storage.
 */
function graphSource(id: string, url: string): string | URL {
  const route = `/runs/${encodeURIComponent(id)}/graph.orrery.json`;
  if (url.startsWith("/") && !url.startsWith("//")) {
    const base = "https://runs.invalid";
    const parsed = new URL(url, base);
    const keys = [...parsed.searchParams.keys()];
    if (
      parsed.origin !== base ||
      parsed.pathname !== route ||
      parsed.hash ||
      keys.length > 1 ||
      keys.some((key) => key !== "document")
    )
      throw invalidLocation();
    return url;
  }
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw invalidLocation();
  }
  if (
    parsed.protocol !== "https:" ||
    !parsed.hostname.endsWith(".public.blob.vercel-storage.com") ||
    parsed.username ||
    parsed.password
  )
    throw invalidLocation();
  return parsed;
}

/**
 * The run page's path with its trailing slash. Next.js redirects
 * `/runs/<id>/` to `/runs/<id>` when the ID ends like a file name (such as
 * `.stage1`), and Orrery's relative `upstream-<sha256>.json` links would then
 * resolve outside the run.
 */
export function runPagePath(pathname: string): string {
  return pathname.endsWith("/") ? pathname : `${pathname}/`;
}

/**
 * A page of the homepage's run list, or null when this deployment has none
 * (collector reads off).
 */
export async function loadRunList(
  before: string | null,
  signal: AbortSignal,
  fetcher: Fetcher = fetch,
): Promise<RunListPage | null> {
  const response = await fetcher(
    `/api/runs/${before === null ? "" : `?before=${encodeURIComponent(before)}`}`,
    { signal },
  );
  if (response.status === 404) return null;
  if (!response.ok) throw new Error("The run list is unavailable.");
  const page: unknown = await response.json().catch(() => null);
  if (!isRunListPage(page)) throw new Error("Invalid run list.");
  return page;
}

/**
 * The run list after more pages: `runs` with the next page's runs it doesn't
 * hold yet, or null when this deployment has no run list.
 */
export async function loadMoreRuns(
  runs: RunListEntry[],
  before: string | null,
  signal: AbortSignal,
  fetcher: Fetcher = fetch,
): Promise<RunListPage | null> {
  return null;
}

/** A run ID, as the collector accepts one (`runId` in `lib/contract.ts`). */
const RUN_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,191}$/;

function isRunListPage(value: unknown): value is RunListPage {
  if (!value || typeof value !== "object") return false;
  const { viewer, runs, next_before } = value as Record<string, unknown>;
  if (!viewer || typeof viewer !== "object") return false;
  const { signed_in_as, sign_in_available } = viewer as Record<string, unknown>;
  return (
    (signed_in_as === null || typeof signed_in_as === "string") &&
    typeof sign_in_available === "boolean" &&
    (next_before === null || typeof next_before === "string") &&
    Array.isArray(runs) &&
    runs.every((run) => {
      if (!run || typeof run !== "object") return false;
      const entry = run as Record<string, unknown>;
      return (
        typeof entry.run_id === "string" &&
        RUN_ID.test(entry.run_id) &&
        typeof entry.build_id === "string" &&
        typeof entry.country_code === "string" &&
        typeof entry.created_at === "string" &&
        typeof entry.reconstructed === "boolean"
      );
    })
  );
}

const SOURCES = new Set(["publication", "local", "collector"]);

export async function loadDocument(
  id: string,
  signal: AbortSignal,
  fetcher: Fetcher = fetch,
  /** The page's query string; its `document` selects a collector document. */
  search = "",
) {
  const selection = new URLSearchParams(search).get("document");
  const response = await fetcher(
    `/api/runs/${encodeURIComponent(id)}/${
      selection ? `?document=${encodeURIComponent(selection)}` : ""
    }`,
    { signal },
  );
  if (response.status === 404)
    throw new Error("This graph publication was not found.");
  if (response.status === 401) {
    const answer = await response.json().catch(() => null);
    if (answer?.error === "sign_in_required")
      throw new SignInRequired(
        signInHref(`/runs/${encodeURIComponent(id)}/${search}`),
      );
  }
  if (!response.ok)
    throw new Error("Graph publication metadata is unavailable.");
  const metadata: RunMetadata = await response.json();
  // Publication store metadata cached before sources were named has none.
  (metadata as { source?: string }).source ??= "publication";
  if (
    !SOURCES.has(metadata.source) ||
    (metadata.source === "collector" &&
      (typeof metadata.document !== "object" ||
        metadata.document === null ||
        !Array.isArray(metadata.documents)))
  )
    throw new Error("Invalid graph publication metadata.");
  const file = metadata.files?.find(
    (f) => f.role === "graph" && f.name === "graph.orrery.json",
  );
  if (!file || metadata.publication_id !== id || file.bytes > 64 * 1024 * 1024)
    throw new Error("Invalid graph publication metadata.");
  const source = graphSource(id, file.url);
  const graph = await fetcher(source, { signal });
  if (!graph.ok || !graph.body)
    throw new Error("The stored graph is unavailable.");
  const reader = graph.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      length += value.length;
      if (length > file.bytes)
        throw new Error("Graph size does not match its publication.");
      chunks.push(value);
    }
  } finally {
    await reader.cancel();
  }
  if (length !== file.bytes)
    throw new Error("Graph size does not match its publication.");
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  const digest = Array.from(
    new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)),
    (v) => v.toString(16).padStart(2, "0"),
  ).join("");
  if (digest !== file.sha256)
    throw new Error("Graph digest does not match its publication.");
  return {
    document: parseGraphDocument(
      JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)),
    ),
    digest,
    metadata,
  };
}
