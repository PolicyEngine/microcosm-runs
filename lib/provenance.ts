import {
  documentSelection,
  signInHref,
  type RunMetadata,
} from "./run-metadata";

export interface ProvenanceRow {
  label: string;
  value: string;
}
/** One of the run's documents, as a link that selects it. */
export interface DocumentChoice {
  href: string;
  label: string;
  selected: boolean;
  current: boolean;
  reconstructed: boolean;
}

/** `YYYY-MM-DD HH:MM UTC`, the same in every browser and locale. */
export function formatTimestamp(value: string): string {
  const time = new Date(value);
  if (Number.isNaN(time.getTime())) return value;
  return `${time.toISOString().slice(0, 16).replace("T", " ")} UTC`;
}

const SOURCE_LABELS = {
  collector: "Collector",
  publication: "Publication store",
  local: "Local directory",
} as const;

/** What the viewer shows about where the displayed graph document came from. */
export function provenanceRows(metadata: RunMetadata): ProvenanceRow[] {
  if (metadata.source !== "collector") {
    const graph = metadata.files.find((file) => file.role === "graph");
    return [
      { label: "Source", value: SOURCE_LABELS[metadata.source] },
      { label: "Publication", value: metadata.publication_id },
      { label: "Published", value: formatTimestamp(metadata.published_at) },
      { label: "Inventory SHA-256", value: metadata.inventory_sha256 },
      { label: "Graph SHA-256", value: graph?.sha256 ?? "" },
    ];
  }
  const document = metadata.document;
  return [
    { label: "Source", value: SOURCE_LABELS.collector },
    {
      label: "Reconstructed",
      value: document.reconstructed
        ? "Yes: rebuilt from a past build's staged inputs"
        : "No",
    },
    { label: "Run", value: document.run_id },
    {
      label: "Build",
      value: `${document.country_code} · ${document.build_id}`,
    },
    {
      label: "Current for its build",
      value: document.current ? "Yes" : "No: a newer document exists",
    },
    {
      label: "Visibility",
      value:
        document.visibility === "public"
          ? "Public"
          : "Private: licensed data, shown only to signed-in staff",
    },
    { label: "Submission", value: document.submission_id },
    { label: "Recorded", value: formatTimestamp(document.created_at) },
    { label: "Document SHA-256", value: document.document_sha256 },
    {
      label: "Size",
      value: `${document.document_bytes.toLocaleString("en-US")} bytes`,
    },
    { label: "Orrery version", value: document.orrery_version },
    {
      label: "Projection source",
      value: `Microcosm ${document.projection_source}`,
    },
    { label: "Collector version", value: document.collector_version },
  ];
}

/** Whether the shown document was rebuilt from a past build's staged inputs. */
export function isReconstructed(metadata: RunMetadata): boolean {
  return metadata.source === "collector" && metadata.document.reconstructed;
}

/** The run's documents, newest first, each with a link that selects it. */
export function documentChoices(metadata: RunMetadata): DocumentChoice[] {
  if (metadata.source !== "collector") return [];
  const shown = documentSelection(metadata.document);
  return metadata.documents.map((document) => ({
    href: `?document=${encodeURIComponent(documentSelection(document))}`,
    label: formatTimestamp(document.created_at),
    selected: documentSelection(document) === shown,
    current: document.current,
    reconstructed: document.reconstructed,
  }));
}

/** The sign-in link or signed-in account the viewer shows, or null without sign-in. */
export function staffAccess(
  metadata: RunMetadata,
  path: string,
): { signedInAs: string | null; signInHref: string | null } | null {
  if (metadata.source !== "collector") return null;
  if (metadata.viewer.signed_in_as)
    return { signedInAs: metadata.viewer.signed_in_as, signInHref: null };
  if (!metadata.viewer.sign_in_available) return null;
  return { signedInAs: null, signInHref: signInHref(path) };
}
