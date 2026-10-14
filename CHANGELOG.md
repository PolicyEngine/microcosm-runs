## [0.2.0] - 2026-10-14

### Added

- Publish immutable Orrery graphs and view run visualizations. Producers authenticate with short-lived collector sessions and upload graph files directly to Vercel Blob through exact, non-overwriting signed URLs; finalization verifies inventory digests, JSON, Orrery parsing and evidence references, and conflicting content or owners cannot overwrite a publication. The viewer at `/runs/<publication_id>/` renders the Orrery component with deep links.
- View graphs from a local Microcosm build during development: set `MICROCOSM_RUNS_LOCAL_DIR` to a directory of preserved publications, and the metadata and file routes read them from disk with the same size, digest, JSON, Orrery and source-reference checks as publication. Production servers refuse the setting.
- Release and deploy automatically on every merge to main: bump the version from the changelog fragment types, commit the changelog, run all checks, tag the commit with the bare version, then deploy that commit to Vercel production. Pull requests now require a typed changelog fragment, and Vercel no longer deploys main to production on its own.
