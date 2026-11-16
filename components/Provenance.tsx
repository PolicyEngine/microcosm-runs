import {
  documentChoices,
  isReconstructed,
  provenanceRows,
} from "@/lib/provenance";
import type { RunMetadata } from "@/lib/run-metadata";

/** Where the shown graph document came from, and the run's other documents. */
export default function Provenance({ metadata }: { metadata: RunMetadata }) {
  const rows = provenanceRows(metadata);
  const choices = documentChoices(metadata);
  const reconstructed = isReconstructed(metadata);
  return (
    <details className="border-b border-border bg-background px-4 py-2 text-sm text-foreground">
      <summary className="cursor-pointer select-none">
        <span className="font-medium">Provenance</span>
        <span className="ml-2 text-muted-foreground">
          {rows[0]?.value} · {metadata.publication_id}
        </span>
        {reconstructed && (
          <span
            className="ml-2 rounded border border-border px-1.5 py-0.5 text-xs font-medium"
            data-testid="reconstructed"
          >
            Reconstructed
          </span>
        )}
      </summary>
      <dl className="mt-2 grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1">
        {rows.map((row) => (
          <div key={row.label} className="contents">
            <dt className="text-muted-foreground">{row.label}</dt>
            <dd className="break-all font-mono text-xs leading-5">
              {row.value}
            </dd>
          </div>
        ))}
      </dl>
      {choices.length > 1 && (
        <div className="mt-2">
          <h2 className="font-medium">Documents of this run</h2>
          <ul className="mt-1 space-y-0.5">
            {choices.map((choice) => (
              <li key={choice.href}>
                {choice.selected ? (
                  <span aria-current="true" className="font-medium">
                    {choice.label}
                  </span>
                ) : (
                  <a className="underline" href={choice.href}>
                    {choice.label}
                  </a>
                )}
                {choice.current && (
                  <span className="ml-2 text-muted-foreground">current</span>
                )}
                {choice.reconstructed && (
                  <span className="ml-2 text-muted-foreground">
                    reconstructed
                  </span>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
    </details>
  );
}
