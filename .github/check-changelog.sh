#!/usr/bin/env bash
set -euo pipefail

# Refuse a pull request whose merge could not be released: changelog.d must hold
# at least one typed fragment.
python3 .github/bump_version.py --check
