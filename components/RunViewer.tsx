"use client";
import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import {
  decodeLocation,
  encodeLocation,
  type GraphDocument,
} from "@axiom-foundation/orrery";
import { Orrery } from "@axiom-foundation/orrery/react";
import { loadDocument, SignInRequired } from "@/lib/viewer";
import type { RunMetadata } from "@/lib/run-metadata";
import Provenance from "./Provenance";

function subscribe(callback: () => void) {
  window.addEventListener("hashchange", callback);
  window.addEventListener("popstate", callback);
  return () => {
    window.removeEventListener("hashchange", callback);
    window.removeEventListener("popstate", callback);
  };
}
export default function RunViewer({ id }: { id: string }) {
  const [result, setResult] = useState<{
    document: GraphDocument;
    digest: string;
    metadata: RunMetadata;
  }>();
  const [error, setError] = useState<{
    message: string;
    signInHref?: string;
  }>();
  const hash = useSyncExternalStore(
    subscribe,
    () => window.location.hash,
    () => "",
  );
  const location = useMemo(() => decodeLocation(hash), [hash]);
  useEffect(() => {
    const controller = new AbortController();
    loadDocument(id, controller.signal, fetch, window.location.search)
      .then(setResult)
      .catch((error) => {
        if (!controller.signal.aborted)
          setError({
            message:
              error instanceof Error ? error.message : "Unable to load graph.",
            signInHref:
              error instanceof SignInRequired ? error.signInHref : undefined,
          });
      });
    return () => controller.abort();
  }, [id]);
  if (error)
    return (
      <main className="p-6" role="alert">
        <p className={error.signInHref ? "" : "text-destructive"}>
          {error.message}
        </p>
        {error.signInHref && (
          <a className="mt-4 inline-block underline" href={error.signInHref}>
            Sign in with Google
          </a>
        )}
      </main>
    );
  if (!result)
    return (
      <main className="p-6 text-muted-foreground" role="status">
        Loading graph…
      </main>
    );
  return (
    <div className="flex h-dvh w-full flex-col">
      <Provenance
        metadata={result.metadata}
        path={`${window.location.pathname}${window.location.search}`}
      />
      <div className="min-h-0 w-full flex-1">
        <Orrery
          document={result.document}
          documentSha256={result.digest}
          location={location}
          onLocationChange={(next, change) => {
            const hash = encodeLocation(next);
            if (hash !== window.location.hash) {
              window.history[
                change.reason === "view" ? "replaceState" : "pushState"
              ](
                null,
                "",
                `${window.location.pathname}${window.location.search}${hash}`,
              );
              window.dispatchEvent(new HashChangeEvent("hashchange"));
            }
          }}
        />
      </div>
    </div>
  );
}
