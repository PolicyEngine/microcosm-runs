import { parseGraphDocument } from "@axiom-foundation/orrery";
import type { Publication } from "./contract";
import type { Fetcher } from "./net";

export async function loadDocument(
  id: string,
  signal: AbortSignal,
  fetcher: Fetcher = fetch,
) {
  const response = await fetcher(`/api/runs/${encodeURIComponent(id)}/`, {
    signal,
  });
  if (response.status === 404)
    throw new Error("This graph publication was not found.");
  if (!response.ok)
    throw new Error("Graph publication metadata is unavailable.");
  const publication: Publication = await response.json();
  const file = publication.files?.find(
    (f) => f.role === "graph" && f.name === "graph.orrery.json",
  );
  if (
    !file ||
    publication.publication_id !== id ||
    file.bytes > 64 * 1024 * 1024
  )
    throw new Error("Invalid graph publication metadata.");
  // A local development server serves the graph from this app's own route;
  // otherwise only public Blob storage is accepted.
  const local = `/runs/${encodeURIComponent(id)}/graph.orrery.json`;
  let source: string | URL = local;
  if (file.url !== local) {
    const url = new URL(file.url);
    if (
      url.protocol !== "https:" ||
      !url.hostname.endsWith(".public.blob.vercel-storage.com") ||
      url.username ||
      url.password
    )
      throw new Error("Invalid graph storage URL.");
    source = url;
  }
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
  };
}
