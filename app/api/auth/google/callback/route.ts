import { failure } from "@/lib/http";
import { signInCallback } from "@/lib/google-sign-in";
import { signInConfig } from "@/lib/staff-session";
export const runtime = "nodejs";
export async function GET(request: Request) {
  try {
    const config = signInConfig();
    if (!config)
      return Response.json(
        { error: "sign_in_unavailable" },
        { status: 404, headers: { "Cache-Control": "no-store" } },
      );
    return await signInCallback(request, config);
  } catch (error) {
    return failure(error);
  }
}
