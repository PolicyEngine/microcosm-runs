import { afterEach, expect, test } from "bun:test";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { ApiError, sha256, type Inventory } from "../lib/contract";
import {
  INVENTORY_FILENAME,
  LOCAL_PUBLICATIONS_ENV,
  createLocalPublications,
  localFilePath,
  localPublicationsDirectory,
} from "../lib/local";

const graph = JSON.stringify({
  schemaVersion: "graph-explorer/v1",
  id: "local",
  title: "Local",
  nodes: [],
  edges: [],
});
const schema = JSON.stringify({ schema: true });
const roots: string[] = [];

afterEach(async () => {
  for (const root of roots.splice(0))
    await rm(root, { recursive: true, force: true });
});

async function bundle(
  directory: string,
  id = "local-run",
  files: Record<string, string> = {
    "graph.orrery.json": graph,
    "graph.schema.json": schema,
  },
) {
  await mkdir(directory, { recursive: true });
  const roles: Record<string, Inventory["files"][number]["role"]> = {
    "graph.orrery.json": "graph",
    "graph.schema.json": "schema",
  };
  for (const [name, text] of Object.entries(files))
    await writeFile(path.join(directory, name), text);
  const value: Inventory = {
    version: 1,
    publication_id: id,
    files: Object.entries(files).map(([name, text]) => ({
      name,
      role: roles[name],
      bytes: Buffer.byteLength(text),
      sha256: sha256(text),
    })),
  };
  await writeFile(
    path.join(directory, INVENTORY_FILENAME),
    JSON.stringify(value),
  );
}

async function root() {
  const directory = await mkdtemp(path.join(tmpdir(), "runs-local-"));
  roots.push(directory);
  return directory;
}

test("local mode is opt-in and refused by production servers", () => {
  expect(localPublicationsDirectory({})).toBeNull();
  expect(
    localPublicationsDirectory({ [LOCAL_PUBLICATIONS_ENV]: " " }),
  ).toBeNull();
  expect(
    localPublicationsDirectory({
      [LOCAL_PUBLICATIONS_ENV]: "relative/bundles",
      NODE_ENV: "development",
    }),
  ).toBe(path.resolve("relative/bundles"));
  expect(() =>
    localPublicationsDirectory({
      [LOCAL_PUBLICATIONS_ENV]: "/bundles",
      NODE_ENV: "production",
    }),
  ).toThrow(ApiError);
});

test("reads a preserved bundle from the root or one level below it", async () => {
  const directory = await root();
  await bundle(directory, "at-root");
  await bundle(path.join(directory, "nested"), "nested-run");
  const local = createLocalPublications(directory);

  const nested = await local.read("nested-run");
  expect(nested?.publication_id).toBe("nested-run");
  expect(nested?.files.map((f) => f.url)).toEqual([
    localFilePath("nested-run", "graph.orrery.json"),
    localFilePath("nested-run", "graph.schema.json"),
  ]);
  expect(nested?.inventory_sha256).toMatch(/^[a-f0-9]{64}$/);
  expect((await local.read("at-root"))?.publication_id).toBe("at-root");
  expect(await local.read("absent")).toBeNull();
  expect(
    new TextDecoder().decode(
      (await local.file("nested-run", "graph.orrery.json")) ?? undefined,
    ),
  ).toBe(graph);
  expect(await local.file("nested-run", "private.h5")).toBeNull();
});

test("changed bytes and invalid graphs are refused", async () => {
  const directory = await root();
  await bundle(directory);
  await writeFile(path.join(directory, "graph.schema.json"), '{"schema":0}');
  const local = createLocalPublications(directory);
  await expect(local.read("local-run")).rejects.toMatchObject({
    code: "digest_mismatch",
  });

  const invalid = await root();
  await bundle(invalid, "invalid-run", { "graph.orrery.json": "{}" });
  await expect(
    createLocalPublications(invalid).read("invalid-run"),
  ).rejects.toMatchObject({ code: "invalid_graph" });
});

test("a malformed inventory does not hide other bundles", async () => {
  const directory = await root();
  await mkdir(path.join(directory, "broken"));
  await writeFile(path.join(directory, "broken", INVENTORY_FILENAME), "{");
  await bundle(path.join(directory, "valid"), "valid-run");
  expect(
    (await createLocalPublications(directory).read("valid-run"))
      ?.publication_id,
  ).toBe("valid-run");
});
