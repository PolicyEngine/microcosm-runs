"use client";
import { useEffect, useState } from "react";
import { loadMoreRuns } from "@/lib/viewer";
import {
  runListDate,
  signInHref,
  type RunListEntry,
  type RunListPage,
  type ViewerAccess,
} from "@/lib/run-metadata";

interface Listed {
  viewer: ViewerAccess;
  runs: RunListEntry[];
  nextBefore: string | null;
}

/**
 * The homepage's list of runs with graph documents, newest first, shown page
 * by page as it loads. Without a run list (collector reads off), or when its
 * first page can't be loaded, the homepage shows only its heading and its
 * introductory sentence.
 */
export default function RunList() {
  const [listed, setListed] = useState<Listed | null>(null);
  const [loading, setLoading] = useState(true);
  const [moreFailed, setMoreFailed] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    const show = (page: RunListPage) => {
      if (!controller.signal.aborted)
        setListed({
          viewer: page.viewer,
          runs: page.runs,
          nextBefore: page.next_before,
        });
    };
    loadMoreRuns([], null, controller.signal, fetch, show)
      .catch(() => undefined)
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, []);
  if (!listed) return null;
  const { viewer, runs, nextBefore } = listed;
  function more() {
    if (!nextBefore) return;
    setLoading(true);
    setMoreFailed(false);
    const show = (page: RunListPage) =>
      setListed({
        viewer: page.viewer,
        runs: page.runs,
        nextBefore: page.next_before,
      });
    loadMoreRuns(runs, nextBefore, new AbortController().signal, fetch, show)
      .catch(() => setMoreFailed(true))
      .finally(() => setLoading(false));
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
          disabled={loading}
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
