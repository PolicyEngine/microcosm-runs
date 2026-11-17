"use client";
import { useEffect, useState } from "react";
import { loadMoreRuns } from "@/lib/viewer";
import {
  runListDate,
  signInHref,
  type RunListEntry,
  type ViewerAccess,
} from "@/lib/run-metadata";

interface Listed {
  viewer: ViewerAccess;
  runs: RunListEntry[];
  nextBefore: string | null;
}

/**
 * The homepage's list of runs with graph documents, newest first. Without a
 * run list (collector reads off), or when it can't be loaded, the homepage
 * shows its heading alone.
 */
export default function RunList() {
  const [listed, setListed] = useState<Listed | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [moreFailed, setMoreFailed] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    loadMoreRuns([], null, controller.signal)
      .then((page) => {
        if (page)
          setListed({
            viewer: page.viewer,
            runs: page.runs,
            nextBefore: page.next_before,
          });
      })
      .catch(() => undefined);
    return () => controller.abort();
  }, []);
  if (!listed) return null;
  const { viewer, runs, nextBefore } = listed;
  function more() {
    if (!nextBefore) return;
    setLoadingMore(true);
    setMoreFailed(false);
    loadMoreRuns(runs, nextBefore, new AbortController().signal)
      .then((page) => {
        if (page)
          setListed({
            viewer: page.viewer,
            runs: page.runs,
            nextBefore: page.next_before,
          });
      })
      .catch(() => setMoreFailed(true))
      .finally(() => setLoadingMore(false));
  }
  return (
    <section aria-label="Runs" className="mt-6">
      {viewer.sign_in_available && !viewer.signed_in_as && (
        <a className="inline-block underline" href={signInHref("/")}>
          Sign in with Google
        </a>
      )}
      {runs.length > 0 && (
        <ul className="mt-4 space-y-2">
          {runs.map((run) => (
            <li
              key={run.run_id}
              className="flex flex-wrap items-baseline gap-x-3 gap-y-1"
            >
              <a
                className="break-all font-mono text-sm underline"
                href={`/runs/${encodeURIComponent(run.run_id)}/`}
              >
                {run.run_id}
              </a>
              <span className="text-sm text-muted-foreground">
                {run.build_id} · {run.country_code} ·{" "}
                {runListDate(run.created_at)}
              </span>
              {run.reconstructed && (
                <span className="rounded border border-border px-1.5 py-0.5 text-xs font-medium">
                  Reconstructed
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
      {nextBefore && (
        <button
          className="mt-4 underline disabled:opacity-50"
          disabled={loadingMore}
          onClick={more}
          type="button"
        >
          More runs
        </button>
      )}
      {moreFailed && (
        <p className="mt-2 text-destructive" role="alert">
          More runs are unavailable.
        </p>
      )}
    </section>
  );
}
