# Microcosm runs

A Next.js application on Vercel displaying the actual Orrery React component.
It loads published graph JSON directly from Vercel Blob, or through its own
server from the collector's Orrery read service when a setting turns that on
("Reading graph documents from the collector"). It verifies each graph's
digest, shows where the graph came from, and keeps selection/filter state in
linkable URL fragments. It does not embed generated HTML or accept population
datasets.

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
| Collector reads (optional)  | Four settings, one table below       | Vercel project environment variables, per scope                        |
| Staff sign-in (optional)    | Three settings, one table below      | Vercel project environment variables, per scope; two are sensitive     |
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

## Reading graph documents from the collector

The collector builds an Orrery graph document from each build's submitted
inputs and serves it through its Orrery read service, a separate Cloud Run
service that only this app's own Google identity may call (the collector
README's "Serving Orrery graph files"). With `MICROCOSM_RUNS_GRAPH_SOURCE`
set to `collector`, this app reads from it first:

- **Which ID.** `/runs/{run_id}/` asks the read service for the run's
  documents. Run IDs follow the collector's rule, so they may also hold `.`
  and `:`. If the read service has no document for the ID, the publication
  store answers as it does without the setting, so older publications stay
  readable. If it has documents, it alone answers, even when none of them
  may be shown. If it answers with an error, the answer is a 503, never the
  publication store's. Next.js redirects `/runs/<id>/` to `/runs/<id>` when
  the ID ends like a file name (`.stage1`); the viewer puts the trailing
  slash back in the address, so the graph's relative links stay in the run.
- **Which document.** The run's newest document is shown;
  `?document=<submission_id>/<document_sha256>` shows another of the run's
  documents, and the provenance panel lists them all with their dates.
- **Provenance.** The panel above the graph shows the source, the run, the
  build (country code and build ID), whether the document is its build's
  current one, the submission, when it was recorded, its SHA-256 and size,
  the Orrery version that validated it, the Microcosm commit its projection
  was copied from, and the collector's version. A document the collector
  rebuilt from a past build's staged inputs (`reconstructed: true`) is marked
  "Reconstructed". For a publication store record, it shows the publication
  ID, when it was published, and its inventory and graph SHA-256.
- **Licensed runs.** Only signed-in staff see documents the read service
  marks `private` ("Staff sign-in for licensed runs"). Everyone else is sent
  only `public` ones: a run whose documents are all private, or a selection
  naming a private document, answers 401 `sign_in_required` (404 where this
  deployment offers no sign-in). Each served file's visibility is checked
  again when it is fetched: one the read service now marks `private` goes
  only to staff.
- **Checks.** The server reads each file whole, keeping the parts as they
  arrive and hashing them on the way, at most the listed size for a document
  and 64 MiB for an upstream file, and sends it only if the
  SHA-256 of the body equals both the `ETag` and the listed document SHA-256
  (or the SHA-256 in an upstream file's name). The read service sends its
  200 before its second read of the file, and a failed second read ends the
  body early, so nothing is trusted before the whole body has matched. The
  browser checks the graph's size and SHA-256 again.
- **Files and caching.** `/runs/{run_id}/graph.orrery.json?document=…` and
  `/runs/{run_id}/upstream-<sha256>.json` stream the checked parts: Vercel
  Functions refuse an unstreamed answer over 4.5 MB, but not a streamed one.
  Public files are sent with `Cache-Control: public, max-age=300` and no
  `s-maxage`, because the collector can later count a document private when
  a licensed submission with its run or build ID is recorded. Private files,
  and metadata for signed-in staff, are sent with
  `Cache-Control: private, no-store`, so no browser or shared cache keeps
  them. Other metadata is
  `no-store` while the setting is on. Without it, publication store metadata
  is sent with `public, max-age=300`, not as immutable for a year, because
  the same URL answers from the collector once the setting is on. Evidence
  files stay in the collector's private storage, and documents carry no
  links to them.

**How this app calls the read service, without a stored key.** On each
cold function instance, Google's Security Token Service exchanges the
deployment's Vercel OIDC token (read with `@vercel/oidc`, as the Blob SDK
does) for a federated access token, through a Workload Identity provider that
trusts only this project's production and preview deployments. The IAM
Credentials API's `generateIdToken` then issues an ID token of the reader
service account, with the read service's URL as its audience and the
account's email included. The instance keeps the ID token until five minutes
before it expires. No Google credential is stored in Vercel, and none reaches
the browser.

| Setting                                   | Value                                                                                          | Where the value lives                                                                                                         |
| ----------------------------------------- | ---------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `MICROCOSM_RUNS_GRAPH_SOURCE`             | `collector` to read from the collector; unset or `publications` for the publication store      | Vercel project environment variable, per scope; any other value refuses every read                                            |
| `COLLECTOR_ORRERY_READ_URL`               | The read service's URL: `https://` and a host, no path                                         | The collector environment's `gcloud run services describe <service>-orrery --region <region> --format 'value(status.url)'`    |
| `COLLECTOR_ORRERY_READER_SERVICE_ACCOUNT` | The reader service account's address                                                           | The collector repository's GitHub environment variable `TELEMETRY_ORRERY_READER_SERVICE_ACCOUNT`, in the matching environment |
| `GOOGLE_WORKLOAD_IDENTITY_PROVIDER`       | `projects/<project number>/locations/global/workloadIdentityPools/<pool>/providers/<provider>` | The Workload Identity provider in the collector's Google Cloud project that trusts this app's Vercel tokens                   |

Production uses the collector's production environment and preview
deployments use staging: set each variable separately in Vercel's Production
and Preview scopes, with that environment's values. When the source is
`collector`, a missing or malformed setting refuses every read with
`invalid_collector_configuration` instead of falling back. Local development
keeps reading local build output ("Viewing local Microcosm output"); the
Workload Identity provider refuses development deployments' tokens.

## Staff sign-in for licensed runs

PolicyEngine staff sign in with their policyengine.org Google accounts to see
licensed runs' private graph documents, which this app's server reads from the
collector with its own identity, as above. Sign-in only decides what this app
sends to the browser: the collector never sees the person's identity.

- **Signing in.** "Staff sign-in" in the provenance panel, or the prompt on a
  licensed run, goes to `/api/auth/google/start/?next=<this page>`. That sends
  the person to Google with an authorization code request with PKCE (S256), a
  random state and nonce, the scopes `openid email`, and `hd=policyengine.org`
  as a hint. The state, nonce and PKCE verifier wait in a signed, ten-minute,
  host-only cookie named after the state
  (`__Host-microcosm-runs-sign-in-<state>`), so two sign-ins in one browser
  don't replace each other.
- **Coming back.** `/api/auth/google/callback/` requires the state to match
  that cookie, exchanges the code with the client secret and the PKCE
  verifier, and checks the ID token against Google's published keys. It must
  be issued by Google for this OAuth client, unexpired, carry the sign-in's
  nonce, and name a verified address on exactly `policyengine.org` (not a
  subdomain), with the `hd` claim saying `policyengine.org`. Tracker 4b · 2
  gives the OAuth client an internal consent screen, which limits sign-in to
  the organization's accounts; these checks don't rely on it. An ID token
  that can't be checked because Google's keys don't answer is a 502, not a
  refusal. The `hd` claim names the account's Google Workspace domain, so
  this assumes policyengine.org is that Workspace's primary domain; a real
  sign-in is the first check of it. The person then
  returns to the page they came from, which must be a path on this site.
- **The session.** An eight-hour `__Host-microcosm-runs-session` cookie
  (`HttpOnly`, `Secure`, `SameSite=Lax`, `Path=/`) holds the address,
  signed with HMAC-SHA-256 under `MICROCOSM_RUNS_SESSION_SECRET`. Nothing is
  stored on the server. "Sign out" posts to `/api/auth/sign-out/`, which
  refuses requests from other sites. Changing the session secret ends every
  session.
- **What staff get.** Their metadata lists the run's private documents too,
  and private files are sent to them with
  `Cache-Control: private, no-store` and `Vary: Cookie`. Public files keep
  their public caching,
  since their bytes are the same for everyone.

| Setting                         | Value                                                            | Where the value lives                                                                                                  |
| ------------------------------- | ---------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| `GOOGLE_OAUTH_CLIENT_ID`        | `<number>-<id>.apps.googleusercontent.com`                       | The microcosm-runs OAuth client in the policyengine.org organization's Google Cloud project (tracker 4b · 2)           |
| `GOOGLE_OAUTH_CLIENT_SECRET`    | The OAuth client's secret                                        | The same OAuth client; a sensitive Vercel environment variable                                                         |
| `MICROCOSM_RUNS_SESSION_SECRET` | At least 32 random characters, such as `openssl rand -base64 48` | Generated by hand for each scope; a sensitive Vercel environment variable, never shared between Production and Preview |

Set all three in each Vercel scope, or none: some but not all, or a
malformed value, turns sign-in off (its routes answer 503
`invalid_sign_in_configuration`), and public runs stay readable. Google
returns only to redirect URIs registered on the OAuth client, so sign-in
works only on origins whose `https://<origin>/api/auth/google/callback/` is
registered there: production's own domain, and any fixed preview domain added
on purpose. A preview deployment's generated URL is not registered, so
sign-in fails there.

## Viewing local Microcosm output

To view graphs from a local Microcosm build without Blob storage or collector
authentication, point the development server at a directory of preserved
publications:

```sh
MICROCOSM_RUNS_LOCAL_DIR=/path/to/publications bun run dev
```

The directory, or any directory directly inside it, holds one publication: its
`orrery.upload.json` inventory and the files that inventory lists, as Microcosm
writes them to `orrery-publication/` in a build's attempt evidence. Open
`http://localhost:3014/runs/<publication_id>/`. The metadata and file routes
then read from disk and apply the same size, SHA-256, JSON, Orrery and source
reference checks as publication. Files the inventory does not list are never
served. Upload and publication requests still use Blob storage. A production
server refuses this setting.

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

Production deploys only from `main`, through the release workflow below. No
collector JWT signing key is copied to Vercel. The current production
collector origin is tracked in `lib/auth.ts`; authorization fails closed until
its new endpoint is deployed. The collector's existing main-only workflow owns
its rollout; this repository cannot deploy that service.

For visual verification, run the local preview at http://localhost:3014 and
inspect a published synthetic graph manually. Automated checks do not use a
browser, screenshots, or rendered-DOM inspection.

## Releases

Each pull request adds a changelog fragment named
`changelog.d/<name>.<type>.md`, where the type is `breaking`, `added`,
`changed`, `fixed` or `removed`. `.github/check-changelog.sh` refuses a pull
request without one.

`push.yaml` runs twice for each merge to `main`:

1. On the merge commit, it bumps the version in `package.json`: a major bump
   for a breaking fragment, a minor bump for an added or removed fragment, and a
   patch bump otherwise. It collects the fragments into `CHANGELOG.md` and
   commits the result as "Update microcosm-runs" using the PolicyEngine GitHub
   App, which may bypass the `main` ruleset.
2. On that commit, it runs every check, tags the commit with the bare version
   (for example `0.2.0`), then builds and deploys that commit to Vercel
   production and checks the public homepage. Each step starts only after the
   one before succeeds.

The deploy job uses `VERCEL_TOKEN` from the GitHub `Production` environment,
which only `main` can use. `vercel.json` turns off Vercel's own production
deploys from `main`, so production never skips the checks; pull request
previews still deploy.
