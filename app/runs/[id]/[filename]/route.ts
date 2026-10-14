import { failure } from "@/lib/http";
import {
  createLocalPublications,
  localPublicationsDirectory,
} from "@/lib/local";
import { createService } from "@/lib/service";
import { blobStorage } from "@/lib/storage";
export const runtime = "nodejs";
export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string; filename: string }> },
) {
  try {
    const { id, filename } = await context.params;
    const local = localPublicationsDirectory();
    if (local) {
      const bytes = await createLocalPublications(local).file(id, filename);
      return bytes
        ? new Response(Buffer.from(bytes), {
            headers: {
              "Content-Type": "application/json",
              "Cache-Control": "no-store",
            },
          })
        : Response.json({ error: "not_found" }, { status: 404 });
    }
    const url = await createService(blobStorage, "").evidence(id, filename);
    return url
      ? Response.redirect(url, 307)
      : Response.json({ error: "not_found" }, { status: 404 });
  } catch (error) {
    return failure(error);
  }
}
