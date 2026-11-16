import { sha256 } from "../../lib/contract";
import type { CollectorDocument } from "../../lib/collector";

/** A small Orrery graph document, as the collector's worker publishes one. */
export function graphDocument(
  title = "Collector fixture",
  upstreamName?: string,
) {
  return {
    schemaVersion: "graph-explorer/v1",
    id: "collector-fixture",
    title,
    nodes: upstreamName
      ? [
          {
            id: "node/1",
            label: "Upstream",
            kind: "artifact",
            sources: [{ label: "upstream", url: upstreamName }],
          },
        ]
      : [],
    edges: [],
  };
}

export function documentBytes(
  title?: string,
  upstreamName?: string,
): Uint8Array<ArrayBuffer> {
  return new TextEncoder().encode(
    JSON.stringify(graphDocument(title, upstreamName)),
  );
}

/** One entry of the read service's listing, as its contract describes it. */
export function collectorDocument(
  overrides: Partial<CollectorDocument> & { bytes?: Uint8Array } = {},
): CollectorDocument {
  const { bytes = documentBytes(), ...fields } = overrides;
  const submission_id = fields.submission_id ?? `sub-${"1".repeat(32)}`;
  const document_sha256 = fields.document_sha256 ?? sha256(bytes);
  return {
    submission_id,
    document_sha256,
    document_bytes: bytes.length,
    run_id: "run-1",
    build_id: "build-1",
    country_code: "GB",
    orrery_version: "0.6.2",
    projection_source: "8d159a8c5653ad63affb1a5d2e39034f877db2ff",
    collector_version: "0.19.0",
    reconstructed: false,
    created_at: "2026-11-11T20:10:00+00:00",
    visibility: "public",
    current: true,
    document_path: `/v1/orrery-graphs/${submission_id}/${document_sha256}/graph.orrery.json`,
    upstream_paths: [],
    ...fields,
  };
}
