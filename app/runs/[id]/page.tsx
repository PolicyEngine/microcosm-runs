import { runIdFromPage } from "@/lib/contract";
import RunViewer from "@/components/RunViewer";
import { notFound } from "next/navigation";
export default async function Page({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  // Run IDs include every publication ID, and may also hold `.` and `:`.
  const id = runIdFromPage((await params).id);
  if (id === null) notFound();
  return <RunViewer key={id} id={id} />;
}
