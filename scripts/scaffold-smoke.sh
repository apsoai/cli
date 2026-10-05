#!/usr/bin/env bash
#
# Scaffold-and-compile smoke test for the Apso CLI (apsoai/cli#101).
#
# Drives the CLI exactly as a new user would, then proves the scaffolded
# project actually compiles:
#   1. build the CLI from this checkout
#   2. `apso init` a fresh project (offline, --skip-platform)
#   3. `apso generate` from the scaffolded .apsorc (if present) — no
#      --language flag on purpose: this also regression-tests that a fresh
#      scaffold resolves its language headlessly instead of prompting
#   4. install the project's deps and compile/typecheck it (per language)
#
# Exit non-zero on the first failure so CI surfaces a broken scaffold.
# Run locally: bash scripts/scaffold-smoke.sh [typescript|python|go]
# Optional: APSORC_FIXTURE=test/fixtures/<file>.apsorc to generate from a fixture.
# Optional (go): SMOKE_DATABASE_URL=<empty Postgres> to also run `apso test smoke`.
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

if [ -n "${APSORC_FIXTURE:-}" ]; then
  # A real-world schema (e.g. test/fixtures/inventory-multi-fk.apsorc: 9
  # entities, 13 relationships, several FKs to the same entity) instead of
  # the one-entity seed below.
  echo "==> Using fixture schema $APSORC_FIXTURE"
  cp "$CLI_ROOT/$APSORC_FIXTURE" .apsorc
  "$CLI_ROOT/bin/run" generate --language "$LANGUAGE" || {
    echo "FAIL: apso generate errored on $APSORC_FIXTURE"
    exit 1
  }
elif [ -f .apsorc ]; then
  # Templates ship with "entities": [] and every generator rejects an empty
  # entity list, so seed one small entity. This also turns the run into a real
  # codegen check: the generated files must compile below.
  echo "==> Seeding a smoke entity into .apsorc"
  node -e '
    const fs = require("fs");
    const rc = JSON.parse(fs.readFileSync(".apsorc", "utf8"));
    rc.entities = [{
      name: "SmokeWidget",
      created_at: true,
      updated_at: true,
      fields: [
        { name: "label", type: "text" },
        { name: "count", type: "integer", nullable: true },
      ],
    }];
    fs.writeFileSync(".apsorc", JSON.stringify(rc, null, 2) + "\n");
  '

  echo "==> Generating code from .apsorc"
  "$CLI_ROOT/bin/run" generate || {
    echo "FAIL: apso generate errored on a fresh scaffold"
    exit 1
  }
fi

case "$LANGUAGE" in
  typescript)
    echo "==> Installing scaffolded project dependencies"
    npm install
    echo "==> Typechecking the scaffolded project"
    # --rootDir .: the v2.0.0 template's tsconfig includes test/**/* while
    # setting rootDir to src, which trips TS6059 under a bare tsc run. rootDir
    # only shapes emit layout and this is --noEmit, so widening it is safe.
    npx tsc --noEmit --rootDir .
    echo "==> Smoke testing the endpoints on PGlite"
    "$CLI_ROOT/bin/run" test smoke
    echo "==> Generating and verifying a migration for an added field"
    cp .apsorc "$WORKDIR/deployed.apsorc"
    node -e '
      const fs = require("fs");
      const rc = JSON.parse(fs.readFileSync(".apsorc", "utf8"));
      rc.entities[0].fields.push({ name: "note", type: "text", nullable: true });
      fs.writeFileSync(".apsorc", JSON.stringify(rc, null, 2) + "\n");
    '
    "$CLI_ROOT/bin/run" generate
    "$CLI_ROOT/bin/run" migrate generate --baseline "$WORKDIR/deployed.apsorc"
    MIGRATION="$(ls src/migrations/*-SchemaUpdate-migration.ts)"
    "$CLI_ROOT/bin/run" migrate verify --baseline "$WORKDIR/deployed.apsorc" --migration "$MIGRATION"
    ;;
  go)
    echo "==> Resolving scaffolded project dependencies"
    go mod tidy
    # cmd/main.go imports the swag-generated app/docs package; the template
    # README's setup runs swag init before the first build, so mirror that.
    echo "==> Generating Swagger docs (app/docs package)"
    go install github.com/swaggo/swag/cmd/swag@latest
    "$(go env GOPATH)/bin/swag" init -g cmd/main.go -o docs
    echo "==> Compiling the scaffolded project"
    go build ./...
    # Go services need a real Postgres. Opt in with an empty database, e.g.
    # SMOKE_DATABASE_URL=postgres://me@localhost:5432/apso_smoke?sslmode=disable
    # (DATABASE_SYNC lets the service create its tables there).
    if [ -n "${SMOKE_DATABASE_URL:-}" ]; then
      echo "==> Smoke testing the endpoints on SMOKE_DATABASE_URL"
      DATABASE_URL="$SMOKE_DATABASE_URL" DATABASE_SYNC=true "$CLI_ROOT/bin/run" test smoke
    fi
    ;;
  python)
    # The template requires Python >= 3.11; override with PYTHON=python3.12
    # if the default python3 is older.
    PYTHON_BIN="${PYTHON:-python3}"
    echo "==> Installing scaffolded project dependencies"
    "$PYTHON_BIN" -m venv .venv
    # shellcheck disable=SC1091
    . .venv/bin/activate
    pip install --quiet -e .
    echo "==> Byte-compiling the scaffolded project"
    python -m compileall -q app
    ;;
  *)
    echo "FAIL: unknown language '$LANGUAGE' (expected typescript, python, or go)"
    exit 1
    ;;
esac

echo "PASS: scaffolded $LANGUAGE project installs and compiles"
