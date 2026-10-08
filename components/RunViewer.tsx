"use client";
import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import {
  decodeLocation,
  encodeLocation,
  type GraphDocument,
} from "@axiom-foundation/orrery";
import { Orrery } from "@axiom-foundation/orrery/react";
import { loadDocument } from "@policyengine/microcosm-provider-orrery/browser";

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
  }>();
  const [error, setError] = useState<string>();
  const hash = useSyncExternalStore(
    subscribe,
    () => window.location.hash,
    () => "",
  );
  const location = useMemo(() => decodeLocation(hash), [hash]);
  useEffect(() => {
    const controller = new AbortController();
    loadDocument(id, controller.signal)
      .then(setResult)
      .catch((error) => {
        if (!controller.signal.aborted)
          setError(
            error instanceof Error ? error.message : "Unable to load graph.",
          );
      });
    return () => controller.abort();
  }, [id]);
  if (error)
    return (
      <main className="p-6 text-destructive" role="alert">
        {error}
      </main>
    );
  if (!result)
    return (
      <main className="p-6 text-muted-foreground" role="status">
        Loading graph…
      </main>
    );
  return (
    <div className="h-dvh w-full">
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
  );
}
