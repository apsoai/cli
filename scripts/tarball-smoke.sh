#!/usr/bin/env bash
# Run the standalone tarball the way a Homebrew user gets it: the bundled Node
# must be the pinned version, and the CLI must start, validate a schema and
# run the PGlite migrate sandbox. Packs the tarball first unless one exists.
#
# Usage: scripts/tarball-smoke.sh [target]   (default: linux-x64)
set -euo pipefail

target="${1:-linux-x64}"
cd "$(dirname "$0")/.."
root="$PWD"
want="v$(node -p "require('./package.json').oclif.update.node.version")"

tarball="$(ls dist/apso-v*-"$target".tar.gz 2>/dev/null | head -1 || true)"
if [ -z "$tarball" ]; then
  npx oclif pack tarballs --targets "$target" --no-xz
  tarball="$(ls dist/apso-v*-"$target".tar.gz | head -1)"
fi

work="$(mktemp -d)"
tar -xzf "$tarball" -C "$work"
apso="$work/apso/bin/apso"
export APSO_TELEMETRY_DISABLED=1

got="$("$work/apso/bin/node" --version)"
if [ "$got" != "$want" ]; then
  echo "bundled node is $got, want $want" >&2
  exit 1
fi
"$apso" --version
"$apso" --help >/dev/null

proj="$(mktemp -d)"
cp "$root/test/fixtures/inventory-multi-fk.apsorc" "$proj/.apsorc"
cd "$proj"
"$apso" schema validate >/dev/null
"$apso" migrate

echo "tarball smoke passed: $(basename "$tarball") on node $got"
