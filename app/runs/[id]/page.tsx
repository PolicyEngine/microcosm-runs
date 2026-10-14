import { publicationId } from "@/lib/contract";
import RunViewer from "@/components/RunViewer";
import { notFound } from "next/navigation";
export default async function Page({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  try {
    publicationId(id);
  } catch {
    notFound();
  }
  return <RunViewer key={id} id={id} />;
}
