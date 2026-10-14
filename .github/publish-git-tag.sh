#!/usr/bin/env bash
set -euo pipefail

# Tag the tested release commit with its bare version, as other PolicyEngine
# repositories do. Rerunning after a later deployment failure finds the same tag.
version="$(python3 -c 'import json; print(json.load(open("package.json"))["version"])')"
head_commit="$(git rev-parse HEAD)"
if git rev-parse --verify --quiet "refs/tags/$version" >/dev/null; then
  tag_commit="$(git rev-parse "refs/tags/$version^{commit}")"
  if [ "$tag_commit" != "$head_commit" ]; then
    echo "Tag $version identifies $tag_commit, not the release commit $head_commit." >&2
    exit 1
  fi
  echo "Tag $version already exists."
  exit 0
fi
git tag "$version"
git push origin "refs/tags/$version"
