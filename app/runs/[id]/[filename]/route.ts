import { failure } from "@/lib/http";
import { runDependencies } from "@/lib/run-dependencies";
import { runFileResponse } from "@/lib/runs";
export const runtime = "nodejs";
// A collector file of up to 64 MiB is read whole and checked before it is sent.
export const maxDuration = 300;
export async function GET(
  request: Request,
  context: { params: Promise<{ id: string; filename: string }> },
) {
  try {
    const { id, filename } = await context.params;
    return await runFileResponse(
      id,
      filename,
      new URL(request.url).searchParams,
      runDependencies(),
    );
  } catch (error) {
    return failure(error);
  }
}
