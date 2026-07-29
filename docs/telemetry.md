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

Events: `cli_command_started`, `cli_command_completed`, `cli_command_failed`.

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
