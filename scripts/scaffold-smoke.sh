#!/usr/bin/env bash
#
# Scaffold-and-compile smoke test for the Apso CLI (apsoai/cli#101).
#
# Drives the CLI exactly as a new user would, then proves the scaffolded
# project actually compiles:
#   1. build the CLI from this checkout
#   2. `apso init` a fresh TypeScript project (offline, --skip-platform)
#   3. `apso generate` from the scaffolded .apsorc (if present)
#   4. install the project's deps and typecheck it
#
# Exit non-zero on the first failure so CI surfaces a broken scaffold.
# Run locally: bash scripts/scaffold-smoke.sh
set -euo pipefail

LANGUAGE="${1:-typescript}"
CLI_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
WORKDIR="$(mktemp -d)"
cleanup() { rm -rf "$WORKDIR"; }
trap cleanup EXIT

echo "==> Building CLI from $CLI_ROOT"
cd "$CLI_ROOT"
npm ci
npm run build

echo "==> Scaffolding a fresh $LANGUAGE project"
cd "$WORKDIR"
"$CLI_ROOT/bin/run" init --name smoke-app --language "$LANGUAGE" --skip-platform
cd smoke-app

if [ -f .apsorc ]; then
  echo "==> Generating code from .apsorc"
  "$CLI_ROOT/bin/run" generate || {
    echo "FAIL: apso generate errored on a fresh scaffold"
    exit 1
  }
fi

echo "==> Installing scaffolded project dependencies"
npm install

echo "==> Typechecking the scaffolded project"
if [ "$LANGUAGE" = "typescript" ]; then
  npx tsc --noEmit
fi

echo "PASS: scaffolded $LANGUAGE project installs and compiles"
