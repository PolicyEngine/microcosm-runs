// Explicit, non-visual deployment qualification. Never imports Microcosm code.
import { randomUUID } from "node:crypto";
import { parseGraphDocument } from "@axiom-foundation/orrery";
import { inventory } from "@policyengine/microcosm-provider-orrery/contract";
import {
  inventoryDigest,
  sha256,
} from "@policyengine/microcosm-provider-orrery/server";
import { createService } from "../lib/service";
import { blobStorage } from "../lib/storage";

export function syntheticPublication(size = 21 * 1024 * 1024) {
  const bytes = new TextEncoder().encode(
    JSON.stringify({
      schemaVersion: "graph-explorer/v1",
      id: "qualification",
      title: "Synthetic storage qualification",
      nodes: [{ id: "one", kind: "operation", label: "Synthetic operation" }],
      edges: [],
      metadata: { synthetic: true, padding: "x".repeat(size) },
    }),
  );
  parseGraphDocument(JSON.parse(new TextDecoder().decode(bytes)));
  const value = inventory({
    version: 1,
    publication_id: `qualification-${randomUUID()}`,
    files: [
      {
        name: "graph.orrery.json",
        role: "graph",
        bytes: bytes.length,
        sha256: sha256(bytes),
      },
    ],
  });
  return { bytes, value };
}

async function checked(response: Response) {
  if (!response.ok) throw new Error(`Qualification HTTP ${response.status}`);
  return response.json();
}
export async function qualify(
  origin: string,
  session: string,
  storageOnly = false,
) {
  const { bytes, value } = syntheticPublication();
  const service = createService(blobStorage, "local-storage-qualification");
  const request = (operation: string, body = value) =>
    fetch(`${origin}/api/${operation}/`, {
      method: "POST",
      redirect: "error",
      headers: {
        Authorization: `Bearer ${session}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });
  console.info("Qualification: reserve publication and sign upload");
  const authorized = storageOnly
    ? await service.uploads(value)
    : await checked(await request("uploads"));
  const url = authorized.uploads[0].url;
  const target = new URL(url);
  if (
    target.protocol !== "https:" ||
    !(
      (target.hostname === "vercel.com" && target.pathname === "/api/blob/") ||
      target.hostname === "blob.vercel-storage.com" ||
      target.hostname.endsWith(".blob.vercel-storage.com")
    )
  )
    throw new Error("Qualification received an unexpected storage origin");
  const upload = () =>
    fetch(url, {
      method: "PUT",
      redirect: "error",
      headers: { "Content-Type": "application/json" },
      body: bytes,
    });
  console.info("Qualification: upload synthetic graph");
  await checked(await upload());
  console.info("Qualification: reject overwrite");
  const repeated = await upload();
  if (repeated.ok) throw new Error("Immutable storage allowed an overwrite");
  console.info("Qualification: finalize publication");
  const publication = storageOnly
    ? await service.publish(value)
    : await checked(await request("publications"));
  const retry = storageOnly
    ? await service.publish(value)
    : await checked(await request("publications"));
  if (
    JSON.stringify(publication) !== JSON.stringify(retry) ||
    publication.inventory_sha256 !== inventoryDigest(value)
  )
    throw new Error("Publication retry changed the immutable record");
  console.info("Qualification: verify published bytes");
  const downloaded = new Uint8Array(
    await (await fetch(publication.files[0].url)).arrayBuffer(),
  );
  if (sha256(downloaded) !== value.files[0].sha256)
    throw new Error("Published bytes changed");
  if (!storageOnly) {
    const publicRead = await checked(
      await fetch(`${origin}/api/runs/${value.publication_id}/`),
    );
    if (publicRead.inventory_sha256 !== inventoryDigest(value))
      throw new Error("Public read mismatch");
    const changed = {
      ...value,
      files: [{ ...value.files[0], sha256: "a".repeat(64) }],
    };
    if ((await request("publications", changed)).status !== 409)
      throw new Error("Changed inventory was not rejected");
  }
  return {
    mode: storageOnly ? "development-storage" : "deployed-api",
    bytes: bytes.length,
    publication_id: value.publication_id,
    overwrite_rejected: true,
    identical_retry: true,
    url: storageOnly ? null : `${origin}/runs/${value.publication_id}/`,
  };
}
if (import.meta.main) {
  const storageOnly = process.argv.includes("--storage-only");
  const origin =
    process.env.ORRERY_QUALIFICATION_ORIGIN ||
    "https://microcosm-runs.vercel.app";
  const session = process.env.MICROCOSM_SESSION_TOKEN || "";
  if (!storageOnly && !session)
    throw new Error(
      "Supply MICROCOSM_SESSION_TOKEN; credentials are never printed.",
    );
  try {
    console.log(
      JSON.stringify(await qualify(origin, session, storageOnly), null, 2),
    );
  } catch (error) {
    console.error(
      `Qualification failed (${error instanceof Error && /^[A-Za-z]+$/.test(error.name) ? error.name : "Error"}); no credentials or signed URLs were logged.`,
    );
    process.exitCode = 1;
  }
}
