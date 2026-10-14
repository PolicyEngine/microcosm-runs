import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { parseGraphDocument } from "@axiom-foundation/orrery";
import {
  ApiError,
  inventory,
  inventoryDigest,
  publicationId,
  sha256,
  type Inventory,
  type Publication,
} from "./contract";
import { checkSources } from "./service";

/** Server-only directory of preserved Microcosm publications to read instead of Blob. */
export const LOCAL_PUBLICATIONS_ENV = "MICROCOSM_RUNS_LOCAL_DIR";
/** The inventory Microcosm writes beside every preserved publication. */
export const INVENTORY_FILENAME = "orrery.upload.json";

/**
 * The configured local directory, or null when publications come from Blob.
 *
 * Local reads are a development aid: a production server refuses them rather
 * than silently serving files from its own disk.
 */
export function localPublicationsDirectory(
  env: Record<string, string | undefined> = process.env,
): string | null {
  const value = env[LOCAL_PUBLICATIONS_ENV]?.trim();
  if (!value) return null;
  if (env.NODE_ENV === "production")
    throw new ApiError(503, "local_publications_disabled");
  return path.resolve(value);
}

interface LocalBundle {
  directory: string;
  value: Inventory;
  modified: Date;
}

async function readInventory(directory: string): Promise<LocalBundle | null> {
  const file = path.join(directory, INVENTORY_FILENAME);
  let bytes: Buffer;
  try {
    bytes = await readFile(file);
  } catch {
    return null;
  }
  try {
    return {
      directory,
      value: inventory(JSON.parse(bytes.toString("utf8"))),
      modified: (await stat(file)).mtime,
    };
  } catch {
    // A malformed inventory is not a publication; other bundles stay readable.
    return null;
  }
}

/** Find the bundle with this publication ID in the root or one level below it. */
async function findBundle(
  root: string,
  id: string,
): Promise<LocalBundle | null> {
  const directories = [root];
  try {
    for (const entry of await readdir(root, { withFileTypes: true }))
      if (entry.isDirectory()) directories.push(path.join(root, entry.name));
  } catch {
    throw new ApiError(503, "local_publications_unavailable");
  }
  for (const directory of directories.sort()) {
    const bundle = await readInventory(directory);
    if (bundle?.value.publication_id === id) return bundle;
  }
  return null;
}

/**
 * Same-origin path that serves one file of a local publication. Filenames end
 * in an extension, so the path has no trailing slash to avoid a redirect.
 */
export function localFilePath(id: string, name: string): string {
  return `/runs/${encodeURIComponent(id)}/${encodeURIComponent(name)}`;
}

/**
 * Read preserved publications from a local directory with the same checks the
 * publication API applies before finalizing: inventory shape, exact sizes and
 * SHA-256 digests, JSON, Orrery parsing and resolvable source references.
 */
export function createLocalPublications(root: string) {
  async function verifiedFile(bundle: LocalBundle, name: string) {
    const file = bundle.value.files.find((f) => f.name === name);
    if (!file) return null;
    let bytes: Buffer;
    try {
      bytes = await readFile(path.join(bundle.directory, file.name));
    } catch {
      throw new ApiError(404, "missing_object");
    }
    if (bytes.length !== file.bytes || sha256(bytes) !== file.sha256)
      throw new ApiError(409, "digest_mismatch");
    return { file, bytes };
  }
  return {
    async read(raw: string): Promise<Publication | null> {
      const id = publicationId(raw);
      const bundle = await findBundle(root, id);
      if (!bundle) return null;
      const names = new Set(bundle.value.files.map((f) => f.name));
      const files = [];
      for (const { name } of bundle.value.files) {
        const verified = await verifiedFile(bundle, name);
        if (!verified) throw new ApiError(404, "missing_object");
        let document: unknown;
        try {
          document = JSON.parse(
            new TextDecoder("utf-8", { fatal: true }).decode(verified.bytes),
          );
        } catch {
          throw new ApiError(400, "invalid_json");
        }
        if (verified.file.role === "graph") {
          try {
            parseGraphDocument(document);
          } catch {
            throw new ApiError(400, "invalid_graph");
          }
          checkSources(document, names);
        }
        files.push({ ...verified.file, url: localFilePath(id, name) });
      }
      return {
        ...bundle.value,
        files,
        inventory_sha256: inventoryDigest(bundle.value),
        published_at: bundle.modified.toISOString(),
      };
    },
    async file(raw: string, name: string): Promise<Uint8Array | null> {
      const bundle = await findBundle(root, publicationId(raw));
      if (!bundle) return null;
      return (await verifiedFile(bundle, name))?.bytes ?? null;
    },
  };
}
