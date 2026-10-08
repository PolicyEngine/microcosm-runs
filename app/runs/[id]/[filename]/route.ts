import { failure } from "@/lib/http";
import { createService } from "@/lib/service";
import { blobStorage } from "@/lib/storage";
export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string; filename: string }> },
) {
  try {
    const { id, filename } = await context.params;
    const url = await createService(blobStorage, "").evidence(id, filename);
    return url
      ? Response.redirect(url, 307)
      : Response.json({ error: "not_found" }, { status: 404 });
  } catch (error) {
    return failure(error);
  }
}
