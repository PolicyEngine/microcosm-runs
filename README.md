# Microcosm runs

A Next.js application on Vercel displaying the actual Orrery React component.
It loads published graph JSON directly from Vercel Blob, verifies its digest,
and keeps selection/filter state in linkable URL fragments. It does not embed
generated HTML or accept population datasets.

The provider's `/browser` package owns bounded document downloads, metadata and
digest validation, and Orrery parsing. Its `/server` package reads completed
publication records and resolves only listed evidence through this app's storage
adapter. The app retains Next routes, the React component, URL state, collector
authorization, immutable writes and Vercel Blob credentials. It does not start a
Python service or move the calibration dashboard's telemetry.

## Deferred provider adoption

This migration is implemented in a draft PR stacked on #1. Do not merge or deploy
it until PolicyEngine/microcosm-local-provider#4 is merged and its reader package
is published. The draft pins provider commit
`b9e8b680feec9a6b4f7483d307bd96165c362087` for reproducible source-based tests.
Before merge, replace that Git dependency with registry version `0.1.0`, regenerate
`bun.lock`, remove the draft-only webpack extension alias and rerun every check
below. The registry artifact contains compiled JavaScript and declarations.

No new environment variables, secrets, stores or endpoints are introduced by this
migration. Existing provisioning remains unchanged. Provider contract and browser
reader tests live in the provider repository; this app retains its own HTTP,
write-service, authorization, URL-state and provisioning tests using synthetic
data and in-memory storage. Neither repository adds a test of a Microcosm build
against the runs app.

## Publication API

1. POST a version-1 file inventory to `/api/uploads/` with a short-lived collector
   session as the Bearer credential. The server verifies it through the
   collector's graph authorization endpoint, without requiring a telemetry run.
2. PUT each file's exact JSON bytes to the returned signed URL. No Bearer header
   goes to storage. The URL permits only that object, content type, and declared
   size, and cannot overwrite it.
3. POST the same inventory to `/api/publications/`. The service verifies sizes,
   SHA-256 digests, JSON, Orrery's parser, and local source references before
   creating the immutable publication record.

An inventory contains `version: 1`, an independent `publication_id`, and
`files: [{name, role, bytes, sha256}]`. IDs need not be telemetry run IDs.
Identical retries return the same publication. Different bytes under a reserved
ID return 409; another owner's credential returns 403. There is no edit/delete
endpoint. Storage administrators retain their normal administrative powers;
this is application-level immutability, not regulatory object-lock retention.

Public graph links are `/runs/{publication_id}/`. Metadata is available at
`/api/runs/{publication_id}/`, and source links resolve through
`/runs/{publication_id}/{filename}/`. The trailing slash preserves Orrery's
relative evidence references without changing the graph bytes. Metadata and
evidence reads expose only completed publications. Blob objects themselves are
public and can be read before finalization if their unlisted URLs are known.

Inventories are limited to 256 KiB, 256 files, 64 MiB per file, and 512 MiB total.
Direct uploads bypass Vercel Functions' request-body size limit. Only reviewed
graph/evidence filename roles are accepted; no H5 files or arbitrary file paths.
Claims, objects, and publication records use deterministic paths and atomic
create-without-overwrite operations. An invalid first upload cannot be repaired
under that ID: preserve the evidence, correct it, and use a new publication ID.

## Environment and provisioning

| Scope                       | Required configuration               | Source                                                                 |
| --------------------------- | ------------------------------------ | ---------------------------------------------------------------------- |
| Vercel production           | `BLOB_STORE_ID`                      | `bun run provision`, production-only store                             |
| Vercel preview              | `BLOB_STORE_ID`                      | Same command, separate preview store                                   |
| Local development           | `BLOB_STORE_ID`, `VERCEL_OIDC_TOKEN` | Same command plus `vercel env pull`                                    |
| All Vercel deployments      | `VERCEL_OIDC_TOKEN`                  | Vercel's enabled project OIDC integration                              |
| Optional collector override | `ORRERY_COLLECTOR_ORIGIN`            | Tracked production default in `lib/auth.ts`; no override required      |
| Producer                    | Existing HF login or `HF_TOKEN`      | Emitter exchanges it for a short-lived session; never sent to this app |

Vercel's Blob project connection also manages `BLOB_READ_WRITE_TOKEN` in each
scope. The SDK prefers OIDC with `BLOB_STORE_ID`; neither storage credential is
sent to Microcosm or the browser. Do not set `NEXT_PUBLIC_*` credentials.
Local OIDC credentials expire; refresh them with `vercel env pull --yes`.

The project is `policy-engine/microcosm-runs`
(`prj_RAM9oGKvN56ear62Y2kRTwVdh1Rs`). Its stores are:

| Environment | Store ID                 |
| ----------- | ------------------------ |
| production  | `store_MmdxZVGubpHWXFlT` |
| preview     | `store_dA9CSYdw5M8Qm8gD` |
| development | `store_5mjyRyCVXfgyW8J4` |

After linking the Vercel project, run:

```sh
bun install --frozen-lockfile
bun run provision
bun run dev
```

The provisioner verifies complete inventories, refuses mismatched existing
store connections, sets the Next.js framework, enables public application
access, installs non-secret store IDs in the three exact scopes, and refreshes
ignored local credentials. Public access is deliberate: writes still require
collector authentication.

## Validation and deployment

```sh
bun run format:check
bun run lint
bun run typecheck
bun test
bun run build
```

Tests use app-owned synthetic graphs, fake collector replies, and in-memory
storage. They include HTTP handler integration, competing immutable writes,
owner conflicts, digest/size checks, missing objects, source references,
authorization failures, deep links, and provisioning. They do not import or
test Microcosm.

`bun run qualify --storage-only` explicitly writes a synthetic graph larger
than 20 MiB to the isolated development store, verifies overwrite rejection,
idempotent finalization, and exact downloaded bytes. Synthetic qualification
objects are retained; the script never deletes published objects.

Once calibration-diagnostics PR #208 has deployed, obtain a short-lived
collector session using the existing HF exchange and run:

```sh
MICROCOSM_SESSION_TOKEN=... bun run qualify
```

This separately qualifies this app's deployed HTTP endpoints and storage using
only synthetic data. It does not run a Microcosm pipeline. Never log that token.

Deploy with `vercel --prod --yes --scope policy-engine` after the required
checks. No collector JWT signing key is copied to Vercel. The current production
collector origin is tracked in `lib/auth.ts`; authorization fails closed until
its new endpoint is deployed. The collector's existing main-only workflow owns
its rollout; this repository cannot deploy that service.

For visual verification, run the local preview at http://localhost:3014 and
inspect a published synthetic graph manually. Automated checks do not use a
browser, screenshots, or rendered-DOM inspection.
