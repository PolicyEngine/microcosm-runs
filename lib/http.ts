import {
  ApiError,
  inventory,
} from "@policyengine/microcosm-provider-orrery/contract";
import { authorize } from "./auth";
import { createService } from "./service";
import { blobStorage, type Storage } from "./storage";

export async function requestJson(request: Request): Promise<unknown> {
  if (!request.headers.get("content-type")?.startsWith("application/json"))
    throw new ApiError(415, "json_required");
  const reader = request.body?.getReader();
  if (!reader) throw new ApiError(400, "invalid_json");
  let text = "";
  let length = 0;
  const decoder = new TextDecoder("utf-8", { fatal: true });
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      length += value.length;
      if (length > 256 * 1024) throw new ApiError(413, "inventory_too_large");
      text += decoder.decode(value, { stream: true });
    }
    return JSON.parse(text + decoder.decode());
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw new ApiError(400, "invalid_json");
  } finally {
    await reader.cancel();
  }
}
export function failure(error: unknown): Response {
  return Response.json(
    { error: error instanceof ApiError ? error.code : "service_unavailable" },
    {
      status: error instanceof ApiError ? error.status : 503,
      headers: { "Cache-Control": "no-store" },
    },
  );
}
export async function write(
  request: Request,
  operation: "uploads" | "publish",
  dependencies: { storage?: Storage; authenticate?: typeof authorize } = {},
): Promise<Response> {
  try {
    const value = inventory(await requestJson(request));
    const subject = await (dependencies.authenticate || authorize)(
      request.headers,
      value,
    );
    return Response.json(
      await createService(dependencies.storage || blobStorage, subject)[
        operation
      ](value),
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return failure(error);
  }
}
