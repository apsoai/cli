# Telemetry & privacy

The Apso CLI collects anonymous usage data to help us understand which commands
are used and prioritize improvements. It is **opt-out** and contains **no
personal data, no code, and no schema contents**.

## What is collected

Each command run sends a small event:

| Field | Example | Why |
|-------|---------|-----|
| command name | `generate`, `init`, `deploy` | which features are used |
| CLI version | `0.28.0` | adoption of releases |
| OS / arch | `darwin` / `arm64` | platform support priorities |
| Node version | `v20.11.0` | runtime support priorities |
| duration + success | `duration_ms`, `success` | reliability / performance |
| anonymous install id | random UUID in your config | distinct-install counting |

Events: `cli_command_started`, `cli_command_completed`, `cli_command_failed`, and `$exception` for detailed error tracking.

The **install id** is a random UUID generated on first run and stored in your
CLI config (`installId`). It is not derived from your hostname, MAC, username,
or any machine identifier. If you are logged in (`apso login`), events attribute
to your Apso account id instead — the same identity the web app uses.

## What is never collected

- Your source code or generated code.
- Your `.apsorc` or any schema contents (entity names, fields, etc.).
- File paths, file contents, or environment variable values.
- Any personal data beyond your account email/name *if you are logged in*
  (never for anonymous use).

## How to opt out

Any one of these disables all telemetry:

```bash
apso config set telemetry off     # persisted in ~/.apso config
export APSO_TELEMETRY=0            # per shell/session
export DO_NOT_TRACK=1              # honors the consoledonottrack.com standard
```

`APSO_TELEMETRY_DISABLED=1` and `apso config set telemetryDisabled true` also
work (legacy aliases). Check the current state with `apso config get telemetry`.

When telemetry is disabled, nothing is sent and no install id is generated.

## Internal vs. external runs

Every telemetry event includes an `internal` boolean and optional `internal_reason` to distinguish **Apso team/system runs** from external anonymous users. This allows filtering internal development, testing, and CI from real user activity in both PostHog and Sentry.

### What counts as internal

A run is marked `internal: true` if **any** of these conditions match:

1. **Explicit env var**: `APSO_INTERNAL=1` or `APSO_INTERNAL=true`
   - Override with `APSO_INTERNAL=0` to force false (for testing external behavior internally)
   - Reason: `env`

2. **GitHub Actions auto-detection**: `GITHUB_ACTIONS=true` and the repository owner is `apsoai`
   - Covers all workflows in `apsoai/*` repos automatically, with no per-job setup needed
   - Checks `GITHUB_REPOSITORY_OWNER` or the owner prefix of `GITHUB_REPOSITORY`
   - Case-insensitive
   - Reason: `github_owner`

3. **Config flag**: `apso config set internal true` stored in `~/.apso/config.json`
   - For team laptops and persistent development machines
   - Reason: `config`

4. **Account-based** (after `apso login`):
   - User email domain is `apso.ai` or `mavrictech.com`
   - Workspace slug is `apso`, `apso-team`, or `mavric`
   - Reason: `account` or `workspace`

The first matching condition sets the reason. Never sends the email itself — only the boolean and reason.

### For CI and automation

**GitHub Actions** (apsoai repos): Automatic — no setup needed. The owner check covers it.

**Other CI** (Jenkins, GitLab CI, CircleCI, Buildkite, etc.): Set `APSO_INTERNAL=1` in your workflow/pipeline env vars:

```yaml
# .github/workflows/my-workflow.yml
env:
  APSO_INTERNAL: '1'

# .gitlab-ci.yml
variables:
  APSO_INTERNAL: '1'

# CircleCI config.yml
environment:
  APSO_INTERNAL: '1'
```

**Docker / scripts**: Pass the env var when running the CLI:

```bash
docker run -e APSO_INTERNAL=1 my-image apso generate
APSO_INTERNAL=1 apso migrate plan
```

### Retroactive identification (past events)

Past events before internal tagging can be approximated as internal by:
- `os: "linux"` and `node_version: "v24.22.x"` with short-lived install IDs
- Sentry events with runner paths (`/home/runner/work/`)
- Identified team persons in PostHog

These are heuristics, not exact matches.

### Privacy note

The `internal` flag respects all existing opt-out mechanisms (`APSO_TELEMETRY=0`, `DO_NOT_TRACK=1`, `apso config set telemetry off`). When telemetry is disabled, nothing is sent.

## First-run notice

On the first command run (when telemetry is enabled) the CLI prints a one-time
notice to **stderr** describing the above and how to opt out. It never prints to
stdout, so it will not interfere with piped or scripted output.

## Transport

Events go to Apso's PostHog project (the same project the web app and build
engine use, so CLI usage lands in the same funnels). Errors are reported to a
dedicated Sentry project. Both use public client-ingestion keys, the same class
of token a browser ships.

## Aggregate download stats (maintainers)

Separately from CLI telemetry, coarse public download counts are available with
no account or key:

```bash
node scripts/usage-stats.mjs            # last month
node scripts/usage-stats.mjs last-week
```

This pulls npm (`@apso/cli`, `@apso/domain-events`) and PyPI
(`apso-domain-events`) download counts. These are trend signals only — downloads
are not active users, and CI/mirrors inflate them.
