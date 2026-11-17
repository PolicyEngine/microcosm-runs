import { failure } from "@/lib/http";
import { requestAccess, runDependencies } from "@/lib/run-dependencies";
import { runListResponse } from "@/lib/runs";
export const runtime = "nodejs";
export async function GET(request: Request) {
  try {
    return await runListResponse(
      new URL(request.url).searchParams,
      runDependencies(),
      await requestAccess(request),
    );
  } catch (error) {
    return failure(error);
  }
}
