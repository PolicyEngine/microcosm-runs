#!/usr/bin/env bash
set -euo pipefail

# Build the tagged release commit on this runner with the project's production
# settings, deploy exactly that build to production, then check the public
# route. VERCEL_ORG_ID and VERCEL_PROJECT_ID select the project.
: "${VERCEL_TOKEN:?Set VERCEL_TOKEN in the Production environment.}"
: "${VERCEL_ORG_ID:?}" "${VERCEL_PROJECT_ID:?}"
# Run the CLI under Node, not Bun. Under Bun, with no node_modules yet, the
# Next.js builder resolved `next` through Bun's auto-install cache instead of
# the project's locked copy, and Vercel could not read the cached files the
# build output then referenced.
vercel=(npx --yes "vercel@58.8.0")
"${vercel[@]}" pull --yes --environment=production --token "$VERCEL_TOKEN"
"${vercel[@]}" build --prod --token "$VERCEL_TOKEN"
"${vercel[@]}" deploy --prebuilt --prod --token "$VERCEL_TOKEN"
homepage="$(curl --fail --silent --show-error --retry 5 --retry-all-errors \
  --retry-delay 10 https://microcosm-runs.vercel.app/)"
grep --quiet "Microcosm runs</h1>" <<<"$homepage"
