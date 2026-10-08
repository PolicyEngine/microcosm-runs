import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

export const scopes = ["production", "preview", "development"] as const;
export function environmentPayload(scope: string, storeId: string) {
  return {
    key: "BLOB_STORE_ID",
    value: storeId,
    type: "plain",
    target: [scope],
  };
}
export function provision(
  run: (args: string[], input?: string) => string,
  projectId: string,
) {
  const call = (args: string[], input?: string) =>
    run([...args, "--scope", "policy-engine"], input);
  call(
    ["api", `/v9/projects/${projectId}`, "--method", "PATCH", "--input", "-"],
    JSON.stringify({
      framework: "nextjs",
      outputDirectory: null,
      ssoProtection: null,
    }),
  );
  const listed = JSON.parse(call(["blob", "list-stores", "--all", "--json"]));
  if (!Array.isArray(listed.stores) || listed.pagination?.next)
    throw new Error("Incomplete Blob store inventory");
  const result: Record<string, string> = {};
  for (const scope of scopes) {
    const name = `microcosm-runs-${scope}`;
    let store = listed.stores.find((s: { name: string }) => s.name === name);
    if (!store) {
      call([
        "blob",
        "create-store",
        name,
        "--access",
        "public",
        "--region",
        "iad1",
        "--environment",
        scope,
        "--yes",
      ]);
      const fresh = JSON.parse(
        call(["blob", "list-stores", "--all", "--json"]),
      );
      if (fresh.pagination?.next)
        throw new Error("Incomplete Blob store inventory");
      store = fresh.stores.find((s: { name: string }) => s.name === name);
    }
    if (
      !store ||
      !store.projects?.some((p: { id: string }) => p.id === projectId)
    )
      throw new Error(`Store ${name} is not connected to this project`);
    const envs = JSON.parse(
      call(["api", `/v9/projects/${projectId}/env`, "--raw"]),
    );
    if (!Array.isArray(envs.envs) || envs.pagination?.next)
      throw new Error("Incomplete environment inventory");
    const existing = envs.envs.find(
      (e: { key: string; target: string[] }) =>
        e.key === "BLOB_STORE_ID" && e.target.includes(scope),
    );
    if (existing) {
      // Exact lookup, including target; never silently replace another store connection.
      const current = JSON.parse(
        call(["api", `/v1/projects/${projectId}/env/${existing.id}`, "--raw"]),
      );
      if (current.value !== store.id)
        throw new Error(`BLOB_STORE_ID differs in ${scope}`);
    } else
      call(
        [
          "api",
          `/v10/projects/${projectId}/env`,
          "--method",
          "POST",
          "--input",
          "-",
        ],
        JSON.stringify(environmentPayload(scope, store.id)),
      );
    result[scope] = store.id;
  }
  return result;
}
if (import.meta.main) {
  const project = JSON.parse(readFileSync(".vercel/project.json", "utf8"));
  const result = provision(
    (args, input) =>
      execFileSync("vercel", args, {
        input,
        encoding: "utf8",
        stdio: ["pipe", "pipe", "inherit"],
      }),
    project.projectId,
  );
  console.log(
    JSON.stringify({ projectId: project.projectId, stores: result }, null, 2),
  );
  execFileSync("vercel", ["env", "pull", "--yes", "--scope", "policy-engine"], {
    stdio: "inherit",
  });
}
