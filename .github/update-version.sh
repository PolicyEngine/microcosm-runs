#!/usr/bin/env bash
set -euo pipefail

# Bump package.json from the pending fragment types and collect the fragments
# into CHANGELOG.md. bun.lock does not record the app's own version.
version="$(python3 .github/bump_version.py)"
uvx --from "towncrier==26.9.0" towncrier build --yes --version "$version"
