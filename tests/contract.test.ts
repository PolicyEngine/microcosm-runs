import { describe, expect, test } from "bun:test";
import {
  inventory,
  inventoryDigest,
  objectPath,
  runIdFromPage,
  MAX_FILE_BYTES,
} from "../lib/contract";

const graph = {
  name: "graph.orrery.json",
  role: "graph",
  bytes: 100,
  sha256: "a".repeat(64),
};
const valid = { version: 1, publication_id: "uk-run-123", files: [graph] };
describe("publication inventory", () => {
  test("canonical order and content-addressed paths", () => {
    const evidence = {
      ...graph,
      name: "execution.evidence.json",
      role: "index",
    };
    const a = inventory({ ...valid, files: [graph, evidence] });
    const b = inventory({ ...valid, files: [evidence, graph] });
    expect(inventoryDigest(a)).toBe(inventoryDigest(b));
    expect(objectPath(a, graph.name)).toBe(
      `objects/uk-run-123/${inventoryDigest(a)}/graph.orrery.json`,
    );
  });
  for (const value of [
    { ...valid, version: 2 },
    { ...valid, publication_id: "../bad" },
    { ...valid, files: [graph, graph] },
    { ...valid, files: [{ ...graph, name: "../graph.orrery.json" }] },
    { ...valid, files: [{ ...graph, bytes: MAX_FILE_BYTES + 1 }] },
    { ...valid, files: [{ ...graph, bytes: -1 }] },
    { ...valid, files: [{ ...graph, sha256: "wrong" }] },
    { ...valid, files: [{ ...graph, name: "private.h5", role: "manifest" }] },
    {
      ...valid,
      files: [{ ...graph, name: "unreviewed.json", role: "manifest" }],
    },
    { ...valid, files: [] },
  ])
    test(`rejects ${JSON.stringify(value).slice(0, 100)}`, () =>
      expect(() => inventory(value)).toThrow());
});

test("the run page decodes the ID Next.js passes it, URL-encoded, before checking it", () => {
  // Next.js 16 applies encodeURIComponent to page params (getParamValue).
  expect(runIdFromPage(encodeURIComponent("uk-build.stage:1"), true)).toBe(
    "uk-build.stage:1",
  );
  expect(runIdFromPage("run-1", true)).toBe("run-1");
  expect(runIdFromPage("uk-build.stage:1", true)).toBe("uk-build.stage:1");
  for (const bad of ["%E0%A4%A", encodeURIComponent("../etc"), "a%2Fb", ""])
    expect(runIdFromPage(bad, true)).toBeNull();
});

test("without collector reads, the run page accepts only publication IDs, as before", () => {
  expect(runIdFromPage("run-1", false)).toBe("run-1");
  for (const id of ["uk-build.stage1", encodeURIComponent("uk-build:1")])
    expect(runIdFromPage(id, false)).toBeNull();
});
