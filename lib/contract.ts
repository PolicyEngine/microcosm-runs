import { createHash } from "node:crypto";

export const MAX_FILE_BYTES = 64 * 1024 * 1024;
export const MAX_TOTAL_BYTES = 512 * 1024 * 1024;
export const MAX_FILES = 256;
export type FileRole =
  | "graph"
  | "schema"
  | "index"
  | "declaration"
  | "manifest"
  | "binding"
  | "summaries"
  | "upstream";
export interface RunFile {
  name: string;
  role: FileRole;
  bytes: number;
  sha256: string;
}
export interface Inventory {
  version: 1;
  publication_id: string;
  files: RunFile[];
}
export interface Publication extends Inventory {
  inventory_sha256: string;
  published_at: string;
  files: (RunFile & { url: string })[];
}
export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
  ) {
    super(code);
  }
}
export function publicationId(value: unknown): string {
  if (typeof value !== "string" || !isPublicationId(value))
    throw new ApiError(400, "invalid_publication_id");
  return value;
}
/** A publication ID is also a valid run ID; a run ID may hold `.` and `:`. */
export function isPublicationId(value: string): boolean {
  return /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(value);
}
/** A telemetry run ID, as the collector accepts one. */
export function runId(value: unknown): string {
  if (
    typeof value !== "string" ||
    !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,191}$/.test(value)
  )
    throw new ApiError(400, "invalid_run_id");
  return value;
}
/**
 * The run ID of a page's `[id]` param, or null for an invalid one. Next.js 16
 * passes page params URL-encoded (`getParamValue` applies
 * `encodeURIComponent`), unlike route handlers' params, so a run ID with `:`
 * arrives as `%3A`. Run IDs hold no `%`, so decoding an already decoded ID
 * changes nothing.
 */
export function runIdFromPage(
  value: string,
  /** Whether collector reads are on; without them only publication IDs open. */
  collectorReads: boolean,
): string | null {
  try {
    const id = decodeURIComponent(value);
    return collectorReads ? runId(id) : publicationId(id);
  } catch {
    return null;
  }
}
const roleNames: Record<FileRole, RegExp> = {
  graph: /^graph\.orrery\.json$/,
  schema: /^graph\.schema\.json$/,
  index: /^execution\.evidence\.json$/,
  declaration: /^evidence-[a-zA-Z0-9_-]+-graph\.json$/,
  manifest: /^evidence-[a-zA-Z0-9_-]+-manifest\.json$/,
  binding: /^evidence-[a-zA-Z0-9_-]+-binding\.json$/,
  summaries: /^evidence-[a-zA-Z0-9_-]+-summaries\.json$/,
  upstream: /^upstream-[a-f0-9]{64}\.json$/,
};
export function inventory(raw: unknown): Inventory {
  if (!raw || typeof raw !== "object")
    throw new ApiError(400, "invalid_inventory");
  const data = raw as Record<string, unknown>;
  const id = publicationId(data.publication_id);
  if (
    data.version !== 1 ||
    !Array.isArray(data.files) ||
    data.files.length === 0 ||
    data.files.length > MAX_FILES
  )
    throw new ApiError(400, "invalid_inventory");
  const names = new Set<string>();
  let total = 0;
  const files: RunFile[] = data.files.map((raw) => {
    if (!raw || typeof raw !== "object")
      throw new ApiError(400, "invalid_file");
    const f = raw as RunFile;
    if (
      !Object.hasOwn(roleNames, f.role) ||
      typeof f.name !== "string" ||
      !roleNames[f.role].test(f.name) ||
      names.has(f.name) ||
      !Number.isSafeInteger(f.bytes) ||
      f.bytes <= 0 ||
      f.bytes > MAX_FILE_BYTES ||
      typeof f.sha256 !== "string" ||
      !/^[a-f0-9]{64}$/.test(f.sha256)
    )
      throw new ApiError(400, "invalid_file");
    names.add(f.name);
    total += f.bytes;
    return { name: f.name, role: f.role, bytes: f.bytes, sha256: f.sha256 };
  });
  if (
    total > MAX_TOTAL_BYTES ||
    files.filter((f) => f.role === "graph").length !== 1
  )
    throw new ApiError(400, "invalid_inventory");
  return {
    version: 1,
    publication_id: id,
    files: files.sort((a, b) =>
      a.name < b.name ? -1 : a.name > b.name ? 1 : 0,
    ),
  };
}
export function sha256(bytes: string | Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}
export function inventoryDigest(value: Inventory): string {
  return sha256(JSON.stringify(inventory(value)));
}
export function objectPath(value: Inventory, name: string): string {
  return `objects/${value.publication_id}/${inventoryDigest(value)}/${name}`;
}
export function publicationPath(id: string): string {
  return `publications/${publicationId(id)}.json`;
}
