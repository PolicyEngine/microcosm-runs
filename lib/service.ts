import { parseGraphDocument } from "@axiom-foundation/orrery";
import {
  ApiError,
  inventory,
  type Inventory,
  type Publication,
} from "@policyengine/microcosm-provider-orrery/contract";
import {
  inventoryDigest,
  objectPath,
  publicationPath,
  sha256,
} from "@policyengine/microcosm-provider-orrery/server";
import type { Storage } from "./storage";
import { createPublicationReader } from "@policyengine/microcosm-provider-orrery/server";

const encode = (value: unknown) =>
  new TextEncoder().encode(JSON.stringify(value));
const decode = (value: Uint8Array) =>
  JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(value));
export function checkSources(value: unknown, names: Set<string>): void {
  const pending: unknown[] = [value];
  while (pending.length) {
    const current = pending.pop();
    if (!current || typeof current !== "object") continue;
    for (const [key, item] of Object.entries(current)) {
      if (key === "url" && typeof item === "string") {
        if (item.startsWith("https://")) {
          const url = new URL(item);
          if (url.username || url.password)
            throw new ApiError(400, "invalid_source");
        } else if (!names.has(item.split("#", 1)[0]))
          throw new ApiError(400, "invalid_source");
      }
      if (item && typeof item === "object") pending.push(item);
    }
  }
}
export function createService(storage: Storage, subject: string) {
  const { read, evidence } = createPublicationReader(storage);
  async function reserve(value: Inventory) {
    if (!subject) throw new ApiError(401, "unauthorized");
    const claim = { subject, inventory_sha256: inventoryDigest(value) };
    const path = `claims/${value.publication_id}.json`;
    await storage.create(path, encode(claim));
    const existing = await storage.read(path, 256 * 1024);
    if (!existing) throw new ApiError(503, "storage_unavailable");
    const saved = decode(existing.bytes);
    if (saved.subject !== subject)
      throw new ApiError(403, "publication_owner_conflict");
    if (saved.inventory_sha256 !== claim.inventory_sha256)
      throw new ApiError(409, "publication_conflict");
  }
  return {
    read,
    async uploads(raw: unknown) {
      const value = inventory(raw);
      await reserve(value);
      const published = await read(value.publication_id);
      if (published) return { publication: published, uploads: [] };
      const uploads = [];
      for (const file of value.files) {
        const path = objectPath(value, file.name);
        const existing = await storage.read(path, file.bytes);
        if (existing) {
          if (
            existing.bytes.length !== file.bytes ||
            sha256(existing.bytes) !== file.sha256
          )
            throw new ApiError(409, "digest_mismatch");
          uploads.push({ name: file.name, already_uploaded: true });
        } else
          uploads.push({
            name: file.name,
            url: await storage.sign(path, file.bytes),
            already_uploaded: false,
          });
      }
      return { uploads };
    },
    async publish(raw: unknown): Promise<Publication> {
      const value = inventory(raw);
      await reserve(value);
      const published = await read(value.publication_id);
      if (published) return published;
      const files = [];
      const names = new Set(value.files.map((f) => f.name));
      for (const file of value.files) {
        const object = await storage.read(
          objectPath(value, file.name),
          file.bytes,
        );
        if (!object) throw new ApiError(400, "missing_object");
        if (
          object.bytes.length !== file.bytes ||
          sha256(object.bytes) !== file.sha256
        )
          throw new ApiError(400, "digest_mismatch");
        let document: unknown;
        try {
          document = decode(object.bytes);
        } catch {
          throw new ApiError(400, "invalid_json");
        }
        if (file.role === "graph") {
          try {
            parseGraphDocument(document);
          } catch {
            throw new ApiError(400, "invalid_graph");
          }
          checkSources(document, names);
        }
        files.push({ ...file, url: object.url });
      }
      const result: Publication = {
        ...value,
        files,
        inventory_sha256: inventoryDigest(value),
        published_at: new Date().toISOString(),
      };
      if (
        await storage.create(
          publicationPath(value.publication_id),
          encode(result),
        )
      )
        return result;
      const winner = await read(value.publication_id);
      if (!winner) throw new ApiError(503, "storage_unavailable");
      if (winner.inventory_sha256 !== result.inventory_sha256)
        throw new ApiError(409, "publication_conflict");
      return winner;
    },
    evidence,
  };
}
