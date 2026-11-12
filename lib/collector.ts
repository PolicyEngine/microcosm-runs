/* eslint-disable @typescript-eslint/no-unused-vars -- red-phase stub */
import type { Fetcher } from "./net";

export const GRAPH_SOURCE_ENV = "MICROCOSM_RUNS_GRAPH_SOURCE";
export const READ_URL_ENV = "COLLECTOR_ORRERY_READ_URL";
export const READER_ACCOUNT_ENV = "COLLECTOR_ORRERY_READER_SERVICE_ACCOUNT";
export const PROVIDER_ENV = "GOOGLE_WORKLOAD_IDENTITY_PROVIDER";

export interface CollectorReadConfig {
  readUrl: string;
  serviceAccount: string;
  provider: string;
}
export type Visibility = "public" | "private";
export interface CollectorDocument {
  submission_id: string;
  document_sha256: string;
  document_bytes: number;
  run_id: string;
  build_id: string;
  country_code: string;
  orrery_version: string;
  projection_source: string;
  collector_version: string;
  reconstructed: boolean;
  created_at: string;
  visibility: Visibility;
  current: boolean;
  document_path: string;
  upstream_paths: string[];
}
export interface CollectorReader {
  list(runId: string): Promise<CollectorDocument[]>;
  file(
    path: string,
    expectedSha256: string,
    maximumBytes: number,
  ): Promise<{ bytes: Uint8Array; visibility: Visibility } | null>;
}
// Red-phase stubs: replaced by the implementation.
export function collectorReadConfig(
  _environment: Record<string, string | undefined> = process.env,
): CollectorReadConfig | null {
  return null;
}
export function createCollectorReader(
  _config: Pick<CollectorReadConfig, "readUrl">,
  _dependencies: { idToken: () => Promise<string>; fetcher?: Fetcher },
): CollectorReader {
  return {
    async list() {
      return [];
    },
    async file() {
      return null;
    },
  };
}
