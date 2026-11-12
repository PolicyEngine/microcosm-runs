import { parseGraphDocument } from "@axiom-foundation/orrery";
import type { Fetcher } from "./net";
import type { RunMetadata } from "./run-metadata";

const invalidLocation = () => new Error("Invalid graph storage URL.");

/** A licensed run: only signed-in staff may view it. */
export class SignInRequired extends Error {
  // Red-phase stub: never thrown yet.
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
  if (!response.ok)
    throw new Error("Graph publication metadata is unavailable.");
  const metadata: RunMetadata = await response.json();
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
