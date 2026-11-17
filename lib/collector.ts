import { createHash } from "node:crypto";
import { ApiError, isRunId, MAX_FILE_BYTES } from "./contract";
import type { Fetcher } from "./net";

/**
 * Where graph documents come from: `collector` reads them from the
 * collector's Orrery read service first; unset or `publications` reads only
 * this app's publication store, as before.
 */
export const GRAPH_SOURCE_ENV = "MICROCOSM_RUNS_GRAPH_SOURCE";
/** The Orrery read service's own URL, which is also the ID token audience. */
export const READ_URL_ENV = "COLLECTOR_ORRERY_READ_URL";
/** The service account microcosm-runs reads as in this environment. */
export const READER_ACCOUNT_ENV = "COLLECTOR_ORRERY_READER_SERVICE_ACCOUNT";
/** The Workload Identity provider that trusts this app's Vercel tokens. */
export const PROVIDER_ENV = "GOOGLE_WORKLOAD_IDENTITY_PROVIDER";

export interface CollectorReadConfig {
  readUrl: string;
  serviceAccount: string;
  provider: string;
}
export type Visibility = "public" | "private";
/** One document of the read service's listing. */
export interface CollectorDocument {
  submission_id: string;
  document_sha256: string;
  document_bytes: number;
  run_id: string;
  build_id: string;
  country_code: string;
  orrery_version: string;
  projection_source: string;
  collector_version: string;
  reconstructed: boolean;
  created_at: string;
  visibility: Visibility;
  current: boolean;
  document_path: string;
  upstream_paths: string[];
}
/** One page of the read service's listing of every run's documents. */
export interface CollectorPage {
  /** Public and private, newest first. */
  documents: CollectorDocument[];
  /** The read service's cursor for the next page; null on the last one. */
  next_before: string | null;
}
export interface CollectorReader {
  /** Every recorded document of the run, public or private, newest first. */
  list(runId: string): Promise<CollectorDocument[]>;
  /**
   * One page of every run's documents, newest first, after the page whose
   * `next_before` is `before`, or the first page.
   */
  recent(before: string | null): Promise<CollectorPage>;
  /**
   * One served file whose body has the expected SHA-256 and matches the
   * `ETag`, or null when the read service has no such file.
   */
  file(
    path: string,
    expectedSha256: string,
    maximumBytes: number,
  ): Promise<{ parts: Uint8Array[]; visibility: Visibility } | null>;
}

const GRAPHS_PATH = "/v1/orrery-graphs";
const SHA256 = /^[0-9a-f]{64}$/;
const SUBMISSION_ID = /^sub-[0-9a-f]{32}$/;
const FILE_PATH =
  /^\/v1\/orrery-graphs\/sub-[0-9a-f]{32}\/[0-9a-f]{64}\/(?:graph\.orrery\.json|upstream-[0-9a-f]{64}\.json)$/;
/** The most documents one page of the read service's listing holds. */
export const RECENT_PAGE_DOCUMENTS = 50;
/**
 * Whether `value` has the shape of the read service's page cursors: unpadded
 * base64url, and no longer than the read service accepts.
 */
export function isCollectorCursor(value: string): boolean {
  return /^[A-Za-z0-9_-]{1,256}$/.test(value);
}
/** An upstream file's name; its capture is the file's SHA-256. */
export const UPSTREAM_FILE_NAME = /^upstream-([0-9a-f]{64})\.json$/;
const BUILD_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const COUNTRY_CODE = /^[A-Z]{2}$/;
const TIMESTAMP =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;
const SERVICE_ACCOUNT =
  /^[a-z][a-z0-9-]{4,28}[a-z0-9]@[a-z][a-z0-9-]{4,28}[a-z0-9]\.iam\.gserviceaccount\.com$/;
const PROVIDER =
  /^projects\/[0-9]+\/locations\/global\/workloadIdentityPools\/[a-z0-9-]{4,32}\/providers\/[a-z0-9-]{4,32}$/;
const MAX_LISTING_BYTES = 8 * 1024 * 1024;
const LIST_TIMEOUT_MS = 30_000;
/** Below the file route's 300-second limit, leaving time for the identity. */
const FILE_TIMEOUT_MS = 240_000;

function misconfigured(): never {
  throw new ApiError(503, "invalid_collector_configuration");
}

/**
 * The collector read settings, or null when reads stay on the publication
 * store. A source other than `collector` or `publications`, or a missing or
 * malformed setting, refuses every read rather than quietly falling back.
 */
export function collectorReadConfig(
  environment: Record<string, string | undefined> = process.env,
): CollectorReadConfig | null {
  const source = environment[GRAPH_SOURCE_ENV]?.trim();
  if (!source || source === "publications") return null;
  if (source !== "collector") misconfigured();
  let url: URL;
  try {
    url = new URL(environment[READ_URL_ENV] ?? "");
  } catch {
    misconfigured();
  }
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    url.pathname !== "/"
  )
    misconfigured();
  const serviceAccount = environment[READER_ACCOUNT_ENV]?.trim() ?? "";
  const provider = environment[PROVIDER_ENV]?.trim() ?? "";
  if (!SERVICE_ACCOUNT.test(serviceAccount) || !PROVIDER.test(provider))
    misconfigured();
  return { readUrl: url.origin, serviceAccount, provider };
}

function unavailable(): ApiError {
  return new ApiError(503, "collector_unavailable");
}
function invalid(): ApiError {
  return new ApiError(503, "invalid_collector_response");
}

function text(value: unknown): string {
  if (typeof value !== "string" || !value || value.length > 256)
    throw invalid();
  return value;
}

/**
 * Check one listed document against the read service's contract: of run
 * `runId`, or of any run when it is null.
 */
function listedDocument(raw: unknown, runId: string | null): CollectorDocument {
  if (!raw || typeof raw !== "object") throw invalid();
  const entry = raw as Record<string, unknown>;
  const submission_id = text(entry.submission_id);
  const document_sha256 = text(entry.document_sha256);
  const build_id = text(entry.build_id);
  const country_code = text(entry.country_code);
  const created_at = text(entry.created_at);
  const folder = `${GRAPHS_PATH}/${submission_id}/${document_sha256}/`;
  if (
    !SUBMISSION_ID.test(submission_id) ||
    !SHA256.test(document_sha256) ||
    (runId === null
      ? typeof entry.run_id !== "string" || !isRunId(entry.run_id)
      : entry.run_id !== runId) ||
    !BUILD_ID.test(build_id) ||
    !COUNTRY_CODE.test(country_code) ||
    !TIMESTAMP.test(created_at) ||
    !Number.isFinite(Date.parse(created_at)) ||
    !Number.isSafeInteger(entry.document_bytes) ||
    (entry.document_bytes as number) <= 0 ||
    (entry.document_bytes as number) > MAX_FILE_BYTES ||
    typeof entry.reconstructed !== "boolean" ||
    typeof entry.current !== "boolean" ||
    (entry.visibility !== "public" && entry.visibility !== "private") ||
    entry.document_path !== `${folder}graph.orrery.json` ||
    !Array.isArray(entry.upstream_paths) ||
    !entry.upstream_paths.every(
      (path) =>
        typeof path === "string" &&
        path.startsWith(folder) &&
        UPSTREAM_FILE_NAME.test(path.slice(folder.length)),
    )
  )
    throw invalid();
  return {
    submission_id,
    document_sha256,
    document_bytes: entry.document_bytes as number,
    run_id: entry.run_id as string,
    build_id,
    country_code,
    orrery_version: text(entry.orrery_version),
    projection_source: text(entry.projection_source),
    collector_version: text(entry.collector_version),
    reconstructed: entry.reconstructed,
    created_at,
    visibility: entry.visibility,
    current: entry.current,
    document_path: entry.document_path,
    upstream_paths: [...entry.upstream_paths],
  };
}

/**
 * Read a body as the parts it arrives in, hashing them on the way, and refuse
 * it once it passes `maximum` bytes. The parts are kept as they are, so a
 * file is held once, not copied into a second whole buffer.
 */
async function bodyParts(
  response: Response,
  maximum: number,
): Promise<{ parts: Uint8Array[]; sha256: string }> {
  const digest = createHash("sha256");
  const reader = response.body?.getReader();
  if (!reader) return { parts: [], sha256: digest.digest("hex") };
  const parts: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      let part: Awaited<ReturnType<typeof reader.read>>;
      try {
        part = await reader.read();
      } catch {
        throw unavailable();
      }
      if (part.done) break;
      length += part.value.byteLength;
      if (length > maximum) throw invalid();
      digest.update(part.value);
      parts.push(part.value);
    }
  } finally {
    await reader.cancel().catch(() => undefined);
  }
  return { parts, sha256: digest.digest("hex") };
}

/** The SHA-256 a strong or weak `ETag` of the read service carries. */
function etagSha256(value: string | null): string | null {
  return /^(?:W\/)?"([0-9a-f]{64})"$/.exec(value ?? "")?.[1] ?? null;
}

/**
 * A client of the collector's Orrery read service. Every call carries the
 * reader account's Google ID token; Cloud Run checks it before the service
 * answers. Nothing it answers is trusted unchecked.
 */
export function createCollectorReader(
  config: Pick<CollectorReadConfig, "readUrl">,
  dependencies: { idToken: () => Promise<string>; fetcher?: Fetcher },
): CollectorReader {
  const fetcher = dependencies.fetcher ?? fetch;
  async function get(path: string, timeout: number): Promise<Response> {
    const token = await dependencies.idToken();
    try {
      return await fetcher(`${config.readUrl}${path}`, {
        headers: { Authorization: `Bearer ${token}` },
        redirect: "error",
        cache: "no-store",
        signal: AbortSignal.timeout(timeout),
      });
    } catch {
      throw unavailable();
    }
  }
  /**
   * A listing's JSON body, or the reason there is none: `refused` names the
   * error for an answer other than 200, unavailable by default.
   */
  async function listing(
    path: string,
    refused: (status: number) => ApiError = unavailable,
  ): Promise<Record<string, unknown>> {
    const response = await get(path, LIST_TIMEOUT_MS);
    if (response.status !== 200) {
      await response.body?.cancel().catch(() => undefined);
      throw refused(response.status);
    }
    const { parts } = await bodyParts(response, MAX_LISTING_BYTES);
    let data: unknown;
    try {
      data = JSON.parse(
        new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(parts)),
      );
    } catch {
      throw invalid();
    }
    if (!data || typeof data !== "object") throw invalid();
    return data as Record<string, unknown>;
  }
  return {
    async recent(before) {
      const query = new URLSearchParams({
        limit: String(RECENT_PAGE_DOCUMENTS),
      });
      if (before !== null) query.set("before", before);
      // The read service answers 422 to a cursor it didn't give. Without a
      // cursor, a 422 means it has no listing without a run ID yet.
      const { documents, next_before } = await listing(
        `${GRAPHS_PATH}?${query}`,
        (status) =>
          before !== null && status === 422
            ? new ApiError(400, "invalid_cursor")
            : unavailable(),
      );
      if (
        !Array.isArray(documents) ||
        documents.length > RECENT_PAGE_DOCUMENTS ||
        !(
          next_before === null ||
          (typeof next_before === "string" && isCollectorCursor(next_before))
        )
      )
        throw invalid();
      return {
        documents: documents.map((entry) => listedDocument(entry, null)),
        next_before,
      };
    },
    async list(runId) {
      const { documents } = await listing(
        `${GRAPHS_PATH}?${new URLSearchParams({ run_id: runId })}`,
      );
      if (!Array.isArray(documents)) throw invalid();
      return documents.map((entry) => listedDocument(entry, runId));
    },
    async file(path, expectedSha256, maximumBytes) {
      if (
        !FILE_PATH.test(path) ||
        !SHA256.test(expectedSha256) ||
        !Number.isSafeInteger(maximumBytes) ||
        maximumBytes <= 0 ||
        maximumBytes > MAX_FILE_BYTES
      )
        throw invalid();
      const response = await get(path, FILE_TIMEOUT_MS);
      if (response.status === 404) {
        await response.body?.cancel().catch(() => undefined);
        return null;
      }
      if (response.status !== 200) {
        await response.body?.cancel().catch(() => undefined);
        throw unavailable();
      }
      const visibility = response.headers.get("x-orrery-visibility");
      if (
        etagSha256(response.headers.get("etag")) !== expectedSha256 ||
        (visibility !== "public" && visibility !== "private")
      ) {
        await response.body?.cancel().catch(() => undefined);
        throw invalid();
      }
      // A second read that fails after the read service has sent its 200
      // ends the body early, so the whole body is checked before use.
      const body = await bodyParts(response, maximumBytes);
      if (body.sha256 !== expectedSha256) throw invalid();
      return { parts: body.parts, visibility };
    },
  };
}
