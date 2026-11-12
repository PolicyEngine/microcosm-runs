/* eslint-disable @typescript-eslint/no-unused-vars -- red-phase stub */
import type { RunMetadata } from "./runs";

export interface ProvenanceRow {
  label: string;
  value: string;
}
export interface DocumentChoice {
  href: string;
  label: string;
  selected: boolean;
  current: boolean;
  reconstructed: boolean;
}
// Red-phase stubs: replaced by the implementation.
export function provenanceRows(_metadata: RunMetadata): ProvenanceRow[] {
  return [];
}
export function isReconstructed(_metadata: RunMetadata): boolean {
  return false;
}
export function documentChoices(_metadata: RunMetadata): DocumentChoice[] {
  return [];
}
