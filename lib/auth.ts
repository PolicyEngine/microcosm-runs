import {
  ApiError,
  type Inventory,
} from "@policyengine/microcosm-provider-orrery/contract";
import { inventoryDigest } from "@policyengine/microcosm-provider-orrery/server";
import type { Fetcher } from "./net";

export const PRODUCTION_COLLECTOR_ORIGIN =
  "https://microcosm-telemetry-389282473430.us-central1.run.app";
export function collectorOrigin(environment = process.env): string {
  const origin =
    environment.ORRERY_COLLECTOR_ORIGIN || PRODUCTION_COLLECTOR_ORIGIN;
  const url = new URL(origin);
  if (
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    url.pathname !== "/" ||
    (url.protocol !== "https:" &&
      !(
        environment.NODE_ENV !== "production" &&
        ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) &&
        url.protocol === "http:"
      ))
  )
    throw new ApiError(503, "invalid_collector_configuration");
  return url.origin;
}
export async function authorize(
  headers: Headers,
  value: Inventory,
  fetcher: Fetcher = fetch,
  origin = collectorOrigin(),
): Promise<string> {
  const authorization = headers.get("authorization");
  if (!authorization || !/^Bearer \S+$/i.test(authorization))
    throw new ApiError(401, "unauthorized");
  const request = {
    publication_id: value.publication_id,
    inventory_sha256: inventoryDigest(value),
  };
  let response: Response;
  try {
    response = await fetcher(`${origin}/v1/auth/graph-publication/authorize`, {
      method: "POST",
      headers: { authorization, "Content-Type": "application/json" },
      body: JSON.stringify(request),
      redirect: "error",
      signal: AbortSignal.timeout(10000),
      cache: "no-store",
    });
  } catch {
    throw new ApiError(503, "authorization_unavailable");
  }
  if (response.status === 401 || response.status === 403)
    throw new ApiError(response.status, "unauthorized");
  if (!response.ok) throw new ApiError(503, "authorization_unavailable");
  const text = await response.text();
  if (text.length > 16384)
    throw new ApiError(503, "invalid_authorization_response");
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new ApiError(503, "invalid_authorization_response");
  }
  if (
    data.publication_id !== request.publication_id ||
    data.inventory_sha256 !== request.inventory_sha256 ||
    typeof data.subject !== "string" ||
    !data.subject
  )
    throw new ApiError(503, "invalid_authorization_response");
  return data.subject;
}
