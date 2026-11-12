import { collectorReadConfig } from "@/lib/collector";
import { runIdFromPage } from "@/lib/contract";
import RunViewer from "@/components/RunViewer";
import { notFound } from "next/navigation";
export default async function Page({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  // With collector reads on, run IDs, which include every publication ID and
  // may also hold `.` and `:`; without them, publication IDs only, as before.
  let collectorReads: boolean;
  try {
    collectorReads = collectorReadConfig() !== null;
  } catch {
    // Broken collector settings: the routes answer 503 for any ID.
    collectorReads = true;
  }
  const id = runIdFromPage((await params).id, collectorReads);
  if (id === null) notFound();
  return <RunViewer key={id} id={id} />;
}
