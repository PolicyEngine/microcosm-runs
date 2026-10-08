import { failure } from "@/lib/http";
import { createService } from "@/lib/service";
import { blobStorage } from "@/lib/storage";
export const runtime = "nodejs";
export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await context.params;
    const result = await createService(blobStorage, "").read(id);
    return Response.json(result ?? { error: "not_found" }, {
      status: result ? 200 : 404,
      headers: {
        "Cache-Control": result
          ? "public, max-age=31536000, immutable"
          : "no-store",
      },
    });
  } catch (error) {
    return failure(error);
  }
}
