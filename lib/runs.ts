/* eslint-disable @typescript-eslint/no-unused-vars -- red-phase stub */
import type { Publication, RunFile } from "./contract";
import type { CollectorDocument, CollectorReader } from "./collector";
import type { createLocalPublications } from "./local";

export type DocumentProvenance = Omit<
  CollectorDocument,
  "document_path" | "upstream_paths"
>;
export interface CollectorRunMetadata {
  source: "collector";
  publication_id: string;
  document: DocumentProvenance;
  documents: DocumentProvenance[];
  files: (RunFile & { url: string })[];
}
export type RunMetadata =
  (Publication & { source: "publication" }) | CollectorRunMetadata;
export interface PublicationReader {
  read(id: string): Promise<Publication | null>;
  evidence(id: string, name: string): Promise<string | null>;
}
export interface RunDependencies {
  local: ReturnType<typeof createLocalPublications> | null;
  collector: CollectorReader | null;
  publications: PublicationReader;
}
// Red-phase stubs: replaced by the implementation.
export async function runMetadataResponse(
  _id: string,
  _search: URLSearchParams,
  _dependencies: RunDependencies,
): Promise<Response> {
  return new Response(null, { status: 501 });
}
export async function runFileResponse(
  _id: string,
  _name: string,
  _search: URLSearchParams,
  _dependencies: RunDependencies,
): Promise<Response> {
  return new Response(null, { status: 501 });
}
