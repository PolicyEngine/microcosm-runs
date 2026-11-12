import { runId } from "@/lib/contract";
import RunViewer from "@/components/RunViewer";
import { notFound } from "next/navigation";
export default async function Page({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  try {
    // Run IDs include every publication ID, and may also hold `.` and `:`.
    runId(id);
  } catch {
    notFound();
  }
  return <RunViewer key={id} id={id} />;
}
