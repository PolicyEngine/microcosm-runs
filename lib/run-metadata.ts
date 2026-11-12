// Shared by the server routes and the browser viewer: types and pure helpers
// only, so the viewer's bundle never includes server code.
import type { Publication, RunFile } from "./contract";
import type { CollectorDocument } from "./collector";

/** What the viewer is told about a collector document; paths stay on the server. */
export type DocumentProvenance = Omit<
  CollectorDocument,
  "document_path" | "upstream_paths"
>;
/** Who is viewing, as far as licensed runs are concerned. */
export interface ViewerAccess {
  /** The signed-in policyengine.org account, if any. */
  signed_in_as: string | null;
  /** Whether this deployment offers staff sign-in at all. */
  sign_in_available: boolean;
}
export interface CollectorRunMetadata {
  source: "collector";
  viewer: ViewerAccess;
  /** The run ID the page was opened with. */
  publication_id: string;
  /** The document shown: the selected one, or the run's newest. */
  document: DocumentProvenance;
  /** The run's documents this viewer may show, newest first. */
  documents: DocumentProvenance[];
  files: (RunFile & { url: string })[];
}
export type RunMetadata =
  (Publication & { source: "publication" | "local" }) | CollectorRunMetadata;

/** The `document` query value that selects this document. */
export function documentSelection(
  document: Pick<CollectorDocument, "submission_id" | "document_sha256">,
): string {
  return `${document.submission_id}/${document.document_sha256}`;
}

/** Where staff start signing in, returning afterwards to `path` on this site. */
export function signInHref(path: string): string {
  return `/api/auth/google/start/?next=${encodeURIComponent(path)}`;
}
