import { expect, test } from "bun:test";
import {
  documentChoices,
  isReconstructed,
  provenanceRows,
} from "../lib/provenance";
import type { CollectorRunMetadata, RunMetadata } from "../lib/runs";

const newest = {
  submission_id: `sub-${"1".repeat(32)}`,
  document_sha256: "a".repeat(64),
  document_bytes: 123456,
  run_id: "run-1",
  build_id: "build-1",
  country_code: "GB",
  orrery_version: "0.6.2",
  projection_source: "8d159a8c5653ad63affb1a5d2e39034f877db2ff",
  collector_version: "0.19.0",
  reconstructed: true,
  created_at: "2026-11-11T20:10:00+00:00",
  visibility: "public" as const,
  current: false,
};
const older = {
  ...newest,
  submission_id: `sub-${"2".repeat(32)}`,
  document_sha256: "b".repeat(64),
  reconstructed: false,
  created_at: "2026-11-01T09:05:30+00:00",
};
const collectorRun: CollectorRunMetadata = {
  source: "collector",
  publication_id: "run-1",
  document: newest,
  documents: [newest, older],
  files: [
    {
      name: "graph.orrery.json",
      role: "graph",
      bytes: newest.document_bytes,
      sha256: newest.document_sha256,
      url: "/runs/run-1/graph.orrery.json?document=x",
    },
  ],
};

test("a collector document's provenance names its run, build, submission, versions and dates", () => {
  expect(provenanceRows(collectorRun)).toEqual([
    { label: "Source", value: "Collector" },
    {
      label: "Reconstructed",
      value: "Yes: rebuilt from a past build's staged inputs",
    },
    { label: "Run", value: "run-1" },
    { label: "Build", value: "GB · build-1" },
    { label: "Current for its build", value: "No: a newer document exists" },
    { label: "Submission", value: newest.submission_id },
    { label: "Recorded", value: "2026-11-11 20:10 UTC" },
    { label: "Document SHA-256", value: newest.document_sha256 },
    { label: "Size", value: "123,456 bytes" },
    { label: "Orrery version", value: "0.6.2" },
    {
      label: "Projection source",
      value: "Microcosm 8d159a8c5653ad63affb1a5d2e39034f877db2ff",
    },
    { label: "Collector version", value: "0.19.0" },
  ]);
  expect(isReconstructed(collectorRun)).toBe(true);
  const built = { ...collectorRun, document: { ...older, current: true } };
  expect(isReconstructed(built)).toBe(false);
  expect(provenanceRows(built)).toContainEqual({
    label: "Reconstructed",
    value: "No",
  });
  expect(provenanceRows(built)).toContainEqual({
    label: "Current for its build",
    value: "Yes",
  });
});

test("a publication store record's provenance names the publication and its digests", () => {
  const publication: RunMetadata = {
    source: "publication",
    version: 1,
    publication_id: "older-publication",
    files: [
      {
        name: "graph.orrery.json",
        role: "graph",
        bytes: 10,
        sha256: "d".repeat(64),
        url: "https://store.public.blob.vercel-storage.com/graph.orrery.json",
      },
    ],
    inventory_sha256: "c".repeat(64),
    published_at: "2026-10-20T10:00:00.000Z",
  };
  expect(provenanceRows(publication)).toEqual([
    { label: "Source", value: "Publication store" },
    { label: "Publication", value: "older-publication" },
    { label: "Published", value: "2026-10-20 10:00 UTC" },
    { label: "Inventory SHA-256", value: "c".repeat(64) },
    { label: "Graph SHA-256", value: "d".repeat(64) },
  ]);
  expect(isReconstructed(publication)).toBe(false);
  expect(documentChoices(publication)).toEqual([]);
});

test("the run's other documents are listed with their dates and links that select them", () => {
  expect(documentChoices(collectorRun)).toEqual([
    {
      href: `?document=${encodeURIComponent(`${newest.submission_id}/${newest.document_sha256}`)}`,
      label: "2026-11-11 20:10 UTC",
      selected: true,
      current: false,
      reconstructed: true,
    },
    {
      href: `?document=${encodeURIComponent(`${older.submission_id}/${older.document_sha256}`)}`,
      label: "2026-11-01 09:05 UTC",
      selected: false,
      current: false,
      reconstructed: false,
    },
  ]);
});
