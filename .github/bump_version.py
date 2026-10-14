"""Choose the next release version from pending changelog fragments.

A breaking fragment bumps the major version, an added or removed fragment the
minor version, and any other fragment the patch version.

Prints the next version. With --check, writes nothing.
"""

import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
FRAGMENT_TYPES = ("breaking", "added", "changed", "fixed", "removed")
FRAGMENT_HELP = (
    "Name each fragment changelog.d/<name>.<type>.md, where <type> is one of: "
    + ", ".join(FRAGMENT_TYPES)
)
PACKAGE_VERSION = re.compile(r'^  "version": "(\d+\.\d+\.\d+)",$', re.MULTILINE)


def fragment_types(changelog_dir: Path) -> set[str]:
    types = set()
    for fragment in changelog_dir.iterdir():
        if fragment.name == ".gitkeep":
            continue
        parts = fragment.name.split(".")
        if (
            not fragment.is_file()
            or len(parts) < 3
            or parts[-1] != "md"
            or parts[-2] not in FRAGMENT_TYPES
        ):
            raise ValueError(
                f"Unrecognised changelog fragment {fragment.name}. {FRAGMENT_HELP}."
            )
        types.add(parts[-2])
    if not types:
        raise ValueError(f"No changelog fragment to release. {FRAGMENT_HELP}.")
    return types


def next_version(version: str, types: set[str]) -> str:
    major, minor, patch = (int(part) for part in version.split("."))
    if "breaking" in types:
        return f"{major + 1}.0.0"
    if types & {"added", "removed"}:
        return f"{major}.{minor + 1}.0"
    return f"{major}.{minor}.{patch + 1}"


def main(arguments: list[str]) -> None:
    if arguments not in ([], ["--check"]):
        sys.exit("Usage: bump_version.py [--check]")
    package = ROOT / "package.json"
    text = package.read_text()
    found = PACKAGE_VERSION.findall(text)
    if len(found) != 1:
        sys.exit(f"Expected one version in package.json, found {found}.")
    current = found[0]
    try:
        upcoming = next_version(current, fragment_types(ROOT / "changelog.d"))
    except ValueError as error:
        sys.exit(str(error))
    if not arguments:
        package.write_text(
            PACKAGE_VERSION.sub(f'  "version": "{upcoming}",', text, count=1)
        )
    print(f"Version: {current} -> {upcoming}", file=sys.stderr)
    print(upcoming)


if __name__ == "__main__":
    main(sys.argv[1:])
