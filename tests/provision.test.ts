import { expect, test } from "bun:test";
import { environmentPayload, provision, scopes } from "../scripts/provision";
test("provisioning scopes isolate stores and install OIDC store IDs without producer secrets", () => {
  const writes: unknown[] = [];
  const stores = scopes.map((scope) => ({
    name: `microcosm-runs-${scope}`,
    id: `store_${scope}`,
    projects: [{ id: "project" }],
  }));
  const result = provision((args, input) => {
    if (args.includes("list-stores")) return JSON.stringify({ stores });
    if (args.includes("--method")) {
      writes.push(JSON.parse(input!));
      return "{}";
    }
    return JSON.stringify({ envs: [] });
  }, "project");
  expect(new Set(Object.values(result)).size).toBe(3);
  for (const scope of scopes)
    expect(writes).toContainEqual(environmentPayload(scope, `store_${scope}`));
});
test("provisioning refuses incomplete inventories", () => {
  expect(() =>
    provision(
      (args) =>
        args.includes("list-stores")
          ? JSON.stringify({ stores: [], pagination: { next: "cursor" } })
          : "{}",
      "project",
    ),
  ).toThrow("Incomplete");
});
