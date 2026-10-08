import { expect, test } from "bun:test";
import { authorize, collectorOrigin } from "../lib/auth";
import type { Fetcher } from "../lib/net";
import { inventory } from "@policyengine/microcosm-provider-orrery/contract";
import { inventoryDigest } from "@policyengine/microcosm-provider-orrery/server";
const value = inventory({
  version: 1,
  publication_id: "standalone",
  files: [
    {
      name: "graph.orrery.json",
      role: "graph",
      bytes: 10,
      sha256: "a".repeat(64),
    },
  ],
});
test("authorization requires a collector credential and binds identity to inventory", async () => {
  await expect(authorize(new Headers(), value)).rejects.toThrow("unauthorized");
  const fake = (async (_url, options) => {
    expect(options?.headers).toMatchObject({ authorization: "Bearer session" });
    expect(options?.redirect).toBe("error");
    return Response.json({
      publication_id: value.publication_id,
      inventory_sha256: inventoryDigest(value),
      subject: "hf-user",
    });
  }) as Fetcher;
  expect(
    await authorize(
      new Headers({ authorization: "Bearer session" }),
      value,
      fake,
    ),
  ).toBe("hf-user");
});
test("collector denial, outages, and invalid replies fail closed", async () => {
  for (const status of [401, 403, 500]) {
    await expect(
      authorize(
        new Headers({ authorization: "Bearer session" }),
        value,
        (async () => new Response("", { status })) as Fetcher,
      ),
    ).rejects.toThrow();
  }
  await expect(
    authorize(
      new Headers({ authorization: "Bearer session" }),
      value,
      (async () =>
        Response.json({
          subject: "hf-user",
          inventory_sha256: "wrong",
        })) as Fetcher,
    ),
  ).rejects.toThrow("invalid_authorization_response");
});
test("collector defaults are tracked and development http is loopback-only", () => {
  expect(collectorOrigin({ NODE_ENV: "production" })).toStartWith("https://");
  expect(
    collectorOrigin({
      NODE_ENV: "development",
      ORRERY_COLLECTOR_ORIGIN: "http://127.0.0.1:8080",
    }),
  ).toBe("http://127.0.0.1:8080");
  expect(() =>
    collectorOrigin({
      NODE_ENV: "production",
      ORRERY_COLLECTOR_ORIGIN: "http://example.com",
    }),
  ).toThrow();
});
