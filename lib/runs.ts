import {
  isPublicationId,
  MAX_FILE_BYTES,
  runId,
  type Publication,
} from "./contract";
import type { CollectorDocument, CollectorReader } from "./collector";
import { failure } from "./http";
import type { createLocalPublications } from "./local";
import {
  documentSelection,
  type CollectorRunMetadata,
  type DocumentProvenance,
} from "./run-metadata";

export type {
  CollectorRunMetadata,
  DocumentProvenance,
  RunMetadata,
} from "./run-metadata";
export interface PublicationReader {
  read(id: string): Promise<Publication | null>;
  evidence(id: string, name: string): Promise<string | null>;
}
export interface RunDependencies {
  /** A development directory of preserved publications, read instead of anything else. */
  local: ReturnType<typeof createLocalPublications> | null;
  /** The collector's read service, when collector reads are on. */
  collector: CollectorReader | null;
  /** This app's own publication store. */
  publications: PublicationReader;
}

const GRAPH_FILE_NAME = "graph.orrery.json";
const SELECTION = /^sub-[0-9a-f]{32}\/[0-9a-f]{64}$/;
const UPSTREAM_NAME = /^upstream-([0-9a-f]{64})\.json$/;
/** Publication store records never change. */
const IMMUTABLE = "public, max-age=31536000, immutable";
/**
 * A public collector file's bytes never change, but the collector can later
 * count it private (a licensed submission recorded afterwards), so browsers
 * keep it only briefly. There is no `s-maxage`: Vercel's CDN is not asked to
 * keep it.
 */
const COLLECTOR_FILE_CACHE = "public, max-age=300";
const SENT_PART_BYTES = 1024 * 1024;

function json(body: unknown, status: number, cacheControl: string): Response {
  return Response.json(body, {
    status,
    headers: { "Cache-Control": cacheControl },
  });
}
const notFound = () => json({ error: "not_found" }, 404, "no-store");

function provenance(document: CollectorDocument): DocumentProvenance {
  // Listed field by field so that nothing else the listing carries, such as
  // the read service's paths, reaches the browser.
  return {
    submission_id: document.submission_id,
    document_sha256: document.document_sha256,
    document_bytes: document.document_bytes,
    run_id: document.run_id,
    build_id: document.build_id,
    country_code: document.country_code,
    orrery_version: document.orrery_version,
    projection_source: document.projection_source,
    collector_version: document.collector_version,
    reconstructed: document.reconstructed,
    created_at: document.created_at,
    visibility: document.visibility,
    current: document.current,
  };
}

/**
 * The documents this viewer may show. Licensed runs' private documents wait
 * for staff sign-in (tracker 4b · 3), so none is shown yet.
 */
function viewable(documents: CollectorDocument[]): CollectorDocument[] {
  return documents.filter((document) => document.visibility === "public");
}

function chosen(
  documents: CollectorDocument[],
  selection: string | null,
): CollectorDocument | null {
  if (selection === null) return documents[0] ?? null;
  if (!SELECTION.test(selection)) return null;
  return (
    documents.find((document) => documentSelection(document) === selection) ??
    null
  );
}

/** Same-origin route of a collector document's graph file. */
function graphRoute(id: string, document: CollectorDocument): string {
  return `/runs/${encodeURIComponent(id)}/${GRAPH_FILE_NAME}?document=${encodeURIComponent(documentSelection(document))}`;
}

/** Send checked bytes in parts: Vercel limits unstreamed answers to 4.5 MB. */
function streamOf(bytes: Uint8Array): ReadableStream<Uint8Array> {
  let offset = 0;
  return new ReadableStream({
    pull(controller) {
      if (offset >= bytes.length) {
        controller.close();
        return;
      }
      const end = Math.min(offset + SENT_PART_BYTES, bytes.length);
      controller.enqueue(bytes.subarray(offset, end));
      offset = end;
    },
  });
}

/**
 * `GET /api/runs/{id}/`: a run's or publication's metadata.
 *
 * - A local development directory, when configured, answers alone.
 * - With collector reads off, the publication store answers as before.
 * - With them on, the collector answers for any run it has a document for;
 *   otherwise the publication store does, so older publications stay
 *   readable. Answers then change as the collector records documents, so
 *   none is cached.
 */
export async function runMetadataResponse(
  id: string,
  search: URLSearchParams,
  dependencies: RunDependencies,
): Promise<Response> {
  try {
    if (dependencies.local) {
      const result = await dependencies.local.read(id);
      return result
        ? json({ ...result, source: "local" }, 200, "no-store")
        : notFound();
    }
    if (!dependencies.collector) {
      const result = await dependencies.publications.read(id);
      return result
        ? json({ ...result, source: "publication" }, 200, IMMUTABLE)
        : notFound();
    }
    const documents = await dependencies.collector.list(runId(id));
    if (documents.length === 0) {
      const result = isPublicationId(id)
        ? await dependencies.publications.read(id)
        : null;
      return result
        ? json({ ...result, source: "publication" }, 200, "no-store")
        : notFound();
    }
    const shown = viewable(documents);
    const document = chosen(shown, search.get("document"));
    if (!document) return notFound();
    const metadata: CollectorRunMetadata = {
      source: "collector",
      publication_id: id,
      document: provenance(document),
      documents: shown.map(provenance),
      files: [
        {
          name: GRAPH_FILE_NAME,
          role: "graph",
          bytes: document.document_bytes,
          sha256: document.document_sha256,
          url: graphRoute(id, document),
        },
      ],
    };
    return json(metadata, 200, "no-store");
  } catch (error) {
    return failure(error);
  }
}

/**
 * `GET /runs/{id}/{filename}`: one file of a run or publication.
 *
 * From the collector, `graph.orrery.json` is the selected document's (or the
 * newest one's), and `upstream-<sha256>.json` is found among the folders of
 * the run's documents that link to it; its name is its SHA-256, so any of
 * them holds the same bytes. Each file is read whole and checked before any
 * of it is sent.
 */
export async function runFileResponse(
  id: string,
  name: string,
  search: URLSearchParams,
  dependencies: RunDependencies,
): Promise<Response> {
  try {
    if (dependencies.local) {
      const bytes = await dependencies.local.file(id, name);
      return bytes
        ? new Response(Buffer.from(bytes), {
            headers: {
              "Content-Type": "application/json",
              "Cache-Control": "no-store",
            },
          })
        : notFound();
    }
    if (!dependencies.collector) {
      const url = await dependencies.publications.evidence(id, name);
      return url ? Response.redirect(url, 307) : notFound();
    }
    const documents = await dependencies.collector.list(runId(id));
    if (documents.length === 0) {
      const url = isPublicationId(id)
        ? await dependencies.publications.evidence(id, name)
        : null;
      return url ? Response.redirect(url, 307) : notFound();
    }
    const shown = viewable(documents);
    const selection = search.get("document");
    let target: { path: string; sha256: string; maximum: number } | null = null;
    if (name === GRAPH_FILE_NAME) {
      const document = chosen(shown, selection);
      if (document)
        target = {
          path: document.document_path,
          sha256: document.document_sha256,
          maximum: document.document_bytes,
        };
    } else {
      const upstreamSha256 = UPSTREAM_NAME.exec(name)?.[1];
      const selected = selection === null ? null : chosen(shown, selection);
      const ordered = selected
        ? [selected, ...shown.filter((document) => document !== selected)]
        : shown;
      for (const document of upstreamSha256 ? ordered : []) {
        const path = document.upstream_paths.find((candidate) =>
          candidate.endsWith(`/${name}`),
        );
        if (path && upstreamSha256) {
          target = { path, sha256: upstreamSha256, maximum: MAX_FILE_BYTES };
          break;
        }
      }
    }
    if (!target) return notFound();
    const file = await dependencies.collector.file(
      target.path,
      target.sha256,
      target.maximum,
    );
    // The read service computes visibility on every answer; a document that
    // has become private since it was listed is not served.
    if (!file || file.visibility !== "public") return notFound();
    return new Response(streamOf(Buffer.concat(file.parts)), {
      status: 200,
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": COLLECTOR_FILE_CACHE,
        ETag: `"${target.sha256}"`,
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    return failure(error);
  }
}
