import { expect, test } from "bun:test";
import { write } from "../lib/http";
import { ApiError } from "@policyengine/microcosm-provider-orrery/contract";
import { objectPath } from "@policyengine/microcosm-provider-orrery/server";
import { syntheticPublication } from "../scripts/qualify";
import type { Storage } from "../lib/storage";

test("HTTP upload and publication handlers enforce authentication and immutable retry", async () => {
  const { bytes, value } = syntheticPublication(16);
  const data = new Map<string, Uint8Array>();
  const storage: Storage = {
    async read(path, maximum) {
      const bytes = data.get(path);
      if (!bytes) return null;
      if (bytes.length > maximum) throw new ApiError(400, "object_too_large");
      return {
        bytes,
        url: `https://fixture.public.blob.vercel-storage.com/${path}`,
      };
    },
    async sign(path) {
      return `https://fixture.blob.vercel-storage.com/${path}`;
    },
    async create(path, bytes) {
      if (data.has(path)) return false;
      data.set(path, bytes);
      return true;
    },
  };
  const request = (payload: unknown = value, token = "session") =>
    new Request("https://runs.example/api/uploads/", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(payload),
    });
  const dependencies = {
    storage,
    authenticate: async (headers: Headers) => {
      if (headers.get("authorization") !== "Bearer session")
        throw new ApiError(401, "unauthorized");
      return "fixture-owner";
    },
  };
  expect(
    (await write(request(value, "invalid"), "uploads", dependencies)).status,
  ).toBe(401);
  expect(data.size).toBe(0);
  expect((await write(request(), "uploads", dependencies)).status).toBe(200);
  expect((await write(request(), "publish", dependencies)).status).toBe(400);
  data.set(objectPath(value, "graph.orrery.json"), bytes);
  const first = await write(request(), "publish", dependencies);
  const retry = await write(request(), "publish", dependencies);
  expect(first.status).toBe(200);
  expect(await retry.json()).toEqual(await first.json());
  expect(first.headers.get("cache-control")).toBe("no-store");
  const changed = {
    ...value,
    files: [{ ...value.files[0], sha256: "b".repeat(64) }],
  };
  expect((await write(request(changed), "publish", dependencies)).status).toBe(
    409,
  );
});

test("HTTP inventory size and content type limits apply before authorization", async () => {
  const authenticate = async () => {
    throw new Error("must not reach authentication");
  };
  const wrongType = new Request("https://runs.example/", {
    method: "POST",
    body: "{}",
  });
  expect((await write(wrongType, "uploads", { authenticate })).status).toBe(
    415,
  );
  const oversized = new Request("https://runs.example/", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "x".repeat(256 * 1024 + 1),
  });
  expect((await write(oversized, "uploads", { authenticate })).status).toBe(
    413,
  );
});
