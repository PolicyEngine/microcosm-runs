import {
  isPublicationId,
  MAX_FILE_BYTES,
  runId,
  type Publication,
} from "./contract";
import {
  UPSTREAM_FILE_NAME,
  type CollectorDocument,
  type CollectorReader,
} from "./collector";
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
/** Whether the request comes from signed-in staff, from the session cookie. */
export interface RequestAccess {
  staffEmail: string | null;
  signInAvailable: boolean;
}
const NO_ACCESS: RequestAccess = { staffEmail: null, signInAvailable: false };
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
/**
 * Publication store records never change, but once collector reads are on,
 * the same URL answers from the collector for a run it has documents for, so
 * browsers keep a record only briefly.
 */
const PUBLICATION_METADATA_CACHE = "public, max-age=300";
/**
 * A public collector file's bytes never change, but the collector can later
 * count it private (a licensed submission recorded afterwards), so browsers
 * keep it only briefly. There is no `s-maxage`: Vercel's CDN is not asked to
 * keep it.
 */
const COLLECTOR_FILE_CACHE = "public, max-age=300";
/** Anything licensed: never stored by a browser or any shared cache. */
const PRIVATE = "private, no-store";

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
 * The documents this request may see: all of them for signed-in staff, and
 * only public ones for everyone else.
 */
function viewable(
  documents: CollectorDocument[],
  access: RequestAccess,
): CollectorDocument[] {
  return access.staffEmail
    ? documents
    : documents.filter((document) => document.visibility === "public");
}

/**
 * Not found, or, when only signed-in staff could see what was asked for and
 * this deployment offers sign-in, a request to sign in. Either way nothing of
 * the private documents is sent.
 */
function hidden(access: RequestAccess, privateMatch: boolean): Response {
  return privateMatch && !access.staffEmail && access.signInAvailable
    ? json({ error: "sign_in_required" }, 401, "no-store")
    : notFound();
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

/**
 * Send checked parts as a stream, as they were received: Vercel limits
 * unstreamed answers to 4.5 MB.
 */
function streamOf(parts: Uint8Array[]): ReadableStream<Uint8Array> {
  let index = 0;
  return new ReadableStream({
    pull(controller) {
      if (index >= parts.length) controller.close();
      else controller.enqueue(parts[index++]);
    },
  });
}

/**
 * Which collector file `/runs/{id}/{name}` names among these documents:
 * `graph.orrery.json` of the selected (or newest) document, or an
 * `upstream-<sha256>.json` file one of them links to, the selected one's
 * first.
 */
function fileTarget(
  documents: CollectorDocument[],
  name: string,
  selection: string | null,
): { path: string; sha256: string; maximum: number } | null {
  if (name === GRAPH_FILE_NAME) {
    const document = chosen(documents, selection);
    return document
      ? {
          path: document.document_path,
          sha256: document.document_sha256,
          maximum: document.document_bytes,
        }
      : null;
  }
  const upstreamSha256 = UPSTREAM_FILE_NAME.exec(name)?.[1];
  if (!upstreamSha256) return null;
  const selected = selection === null ? null : chosen(documents, selection);
  const ordered = selected
    ? [selected, ...documents.filter((document) => document !== selected)]
    : documents;
  for (const document of ordered) {
    const path = document.upstream_paths.find((candidate) =>
      candidate.endsWith(`/${name}`),
    );
    if (path) return { path, sha256: upstreamSha256, maximum: MAX_FILE_BYTES };
  }
  return null;
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
  access: RequestAccess = NO_ACCESS,
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
        ? json(
            { ...result, source: "publication" },
            200,
            PUBLICATION_METADATA_CACHE,
          )
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
    const shown = viewable(documents, access);
    const selection = search.get("document");
    const document = chosen(shown, selection);
    if (!document)
      return hidden(
        access,
        selection === null
          ? shown.length === 0
          : chosen(documents, selection) !== null,
      );
    const metadata: CollectorRunMetadata = {
      source: "collector",
      viewer: {
        signed_in_as: access.staffEmail,
        sign_in_available: access.signInAvailable,
      },
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
    // Staff answers can list private documents.
    return json(metadata, 200, access.staffEmail ? PRIVATE : "no-store");
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
  access: RequestAccess = NO_ACCESS,
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
    const selection = search.get("document");
    const target = fileTarget(viewable(documents, access), name, selection);
    // Asked of a file only private documents hold: sign in, if offered.
    if (!target)
      return hidden(access, fileTarget(documents, name, selection) !== null);
    const file = await dependencies.collector.file(
      target.path,
      target.sha256,
      target.maximum,
    );
    if (!file) return notFound();
    // The read service computes visibility on every answer; a document that
    // has become private since it was listed goes only to staff, uncached.
    const licensed = file.visibility !== "public";
    if (licensed && !access.staffEmail) return notFound();
    const headers = new Headers({
      "Content-Type": "application/json",
      "Cache-Control": licensed ? PRIVATE : COLLECTOR_FILE_CACHE,
      ETag: `"${target.sha256}"`,
      "X-Content-Type-Options": "nosniff",
    });
    if (licensed) headers.set("Vary", "Cookie");
    return new Response(streamOf(file.parts), { status: 200, headers });
  } catch (error) {
    return failure(error);
  }
}
