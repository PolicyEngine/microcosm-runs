import { failure } from "@/lib/http";
import { requestAccess, runDependencies } from "@/lib/run-dependencies";
import { runMetadataResponse } from "@/lib/runs";
export const runtime = "nodejs";
export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await context.params;
    return await runMetadataResponse(
      id,
      new URL(request.url).searchParams,
      runDependencies(),
      await requestAccess(request),
    );
  } catch (error) {
    return failure(error);
  }
}
