import { expect, test } from "bun:test";
import { createService } from "../lib/service";
import {
  ApiError,
  inventory,
  objectPath,
  publicationPath,
  sha256,
  type Inventory,
} from "../lib/contract";
import type { Storage } from "../lib/storage";

const encoder = new TextEncoder();
const graph = {
  schemaVersion: "graph-explorer/v1",
  id: "synthetic",
  title: "Synthetic run",
  nodes: [{ id: "one", kind: "operation", label: "One" }],
  edges: [],
};
function fixture(document: unknown = graph, id = "test-123") {
  const bytes = encoder.encode(JSON.stringify(document));
  const value = inventory({
    version: 1,
    publication_id: id,
    files: [
      {
        name: "graph.orrery.json",
        role: "graph",
        bytes: bytes.length,
        sha256: sha256(bytes),
      },
    ],
  });
  const data = new Map<string, Uint8Array>();
  const signed: string[] = [];
  const storage: Storage = {
    async read(path, max) {
      const bytes = data.get(path);
      if (!bytes) return null;
      if (bytes.length > max) throw new ApiError(400, "object_too_large");
      return {
        bytes,
        url: `https://example.public.blob.vercel-storage.com/${path}`,
      };
    },
    async sign(path, size) {
      signed.push(path);
      return `https://upload.example/${path}?size=${size}`;
    },
    async create(path, bytes) {
      if (data.has(path)) return false;
      data.set(path, bytes);
      return true;
    },
  };
  const service = createService(storage, "hf-owner");
  const upload = (v: Inventory = value, b = bytes) =>
    data.set(objectPath(v, v.files[0].name), b);
  return { value, bytes, data, signed, service, upload };
}
test("authorization signs only deterministic inventory objects; no publication yet", async () => {
  const f = fixture();
  const result = await f.service.uploads(f.value);
  expect(result.uploads).toHaveLength(1);
  expect(f.signed).toEqual([objectPath(f.value, "graph.orrery.json")]);
  expect(await f.service.read(f.value.publication_id)).toBeNull();
});
test("missing, wrong digest, oversized, and invalid graph bytes cannot publish", async () => {
  const f = fixture();
  await expect(f.service.publish(f.value)).rejects.toThrow("missing_object");
  f.upload(f.value, encoder.encode("wrong"));
  await expect(f.service.publish(f.value)).rejects.toThrow("digest_mismatch");
  f.upload(f.value, new Uint8Array(f.bytes.length + 1));
  await expect(f.service.publish(f.value)).rejects.toThrow("object_too_large");
  const bad = fixture({ bad: true });
  bad.upload();
  await expect(bad.service.publish(bad.value)).rejects.toThrow("invalid_graph");
  expect(f.data.has(publicationPath(f.value.publication_id))).toBe(false);
});
test("exact retries are idempotent and concurrent publication has one winner", async () => {
  const f = fixture();
  f.upload();
  const results = await Promise.all([
    f.service.publish(f.value),
    f.service.publish(f.value),
  ]);
  expect(results[0]).toEqual(results[1]);
  const changed = inventory({
    ...f.value,
    files: [{ ...f.value.files[0], sha256: "b".repeat(64) }],
  });
  await expect(f.service.publish(changed)).rejects.toThrow(
    "publication_conflict",
  );
  await expect(f.service.uploads(changed)).rejects.toThrow(
    "publication_conflict",
  );
});
test("source URLs must refer to published evidence or https, never local files", async () => {
  for (const url of [
    "secret.json",
    "../outside.json",
    "file:///private/run.json",
    "/private/run.json",
    "javascript:alert(1)",
  ]) {
    const f = fixture({
      ...graph,
      nodes: [{ ...graph.nodes[0], sources: [{ label: "Source", url }] }],
    });
    f.upload();
    await expect(f.service.publish(f.value)).rejects.toThrow("invalid_source");
  }
});
test("storage exceptions never become a published run", async () => {
  const f = fixture();
  f.upload();
  const service = createService(
    {
      read: async () => {
        throw new Error("unavailable");
      },
      sign: async () => "",
      create: async () => false,
    },
    "hf-owner",
  );
  await expect(service.publish(f.value)).rejects.toThrow("unavailable");
});

test("publications require no run id and reserved ids cannot change content", async () => {
  const f = fixture();
  await f.service.uploads(f.value);
  const changed = inventory({
    ...f.value,
    files: [{ ...f.value.files[0], sha256: "b".repeat(64) }],
  });
  await expect(f.service.uploads(changed)).rejects.toThrow(
    "publication_conflict",
  );
  expect(Object.hasOwn(f.value, "run_id")).toBe(false);
});
