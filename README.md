# Apso CLI

Define a schema. Get a production API. Keep the code.

Apso generates production-ready backend services from a JSON schema file. You get real framework code (NestJS, FastAPI, or Gin) that you own, run anywhere, and extend with standard patterns. For the complete documentation, see [Apso Docs](https://docs.apso.ai).

## Install

**Homebrew** (macOS / Linux)

```bash
brew tap apsoai/tap
brew install apso
```

**npm**

```bash
npm install -g @apso/cli
```

Requires Node.js 18.0 or higher.

## MCP Server (AI editor integration)

Apso works as an MCP server inside Claude Code, Cursor, Windsurf, and other MCP-compatible editors. Your AI assistant can design schemas, generate APIs, and deploy backends through conversation.

**Claude Code**

```bash
claude mcp add apso -- apso mcp serve
```

**Cursor / VS Code / Other editors**

Add to your MCP configuration:

```json
{
  "mcpServers": {
    "apso": {
      "command": "apso",
      "args": ["mcp", "serve"]
    }
  }
}
```

**Available tools:**

| Tool | Description |
|------|-------------|
| `design_schema` | Design a database schema from application requirements |
| `validate_schema` | Validate an `.apsorc` schema file |
| `scaffold_api` | Generate API code from schema (TypeScript, Python, or Go) |
| `setup_auth` | Configure authentication (BetterAuth, Auth0, Clerk, Cognito, API Keys) |
| `start_dev_server` | Start local dev environment via Docker Compose |
| `deploy_api` | Deploy to the Apso platform |

**Available resources:**

| Resource | URI | Description |
|----------|-----|-------------|
| Schema reference | `apso://schema-guide` | Schema design guidelines and examples |
| Current schema | `apso://current-schema` | Your project's current `.apsorc` |

## Connect

Authenticate with the Apso platform:

```bash
apso login
```

This opens a browser window for OAuth authentication. For CI/CD environments, use a token:

```bash
apso login --token <api-token>
```

## Quick start

```bash
# Create a new project
apso init --name my-app --language typescript

# Edit .apsorc to define your schema

# Generate code from schema
apso generate

# Start Postgres and run the API
apso dev
```

Your API is live at `http://localhost:3000` with Swagger docs at `/api`. The generated code lives in `src/autogen/` and is standard NestJS with TypeORM -- no Apso runtime dependency.

## Commands

| Command | Subcommands | Description |
|---------|------------|-------------|
| [init](#apso-init) | | Create a new project |
| [generate](#apso-generate) | | Generate code from `.apsorc` schema |
| [dev](#apso-dev) | | Start local dev server via Docker Compose |
| [migrate](#apso-migrate) | | Test schema migrations locally with PGlite |
| [deploy](#apso-deploy) | | Deploy to Apso platform |
| [login](#apso-login) | | Authenticate with Apso |
| [logout](#apso-logout) | | Clear stored credentials |
| [whoami](#apso-whoami) | | Show current user |
| [link](#apso-link) | | Link project to a platform service |
| [unlink](#apso-unlink) | | Remove platform link |
| [status](#apso-status) | | Show service and build status |
| [logs](#apso-logs) | | View build logs |
| [open](#apso-open) | | Open service dashboard in browser |
| [projects](#apso-projects) | | List services in a workspace |
| [config](#apso-config) | `get`, `set`, `reset` | View or modify CLI configuration |
| [schema](#apso-schema) | `diff`, `push`, `pull`, `validate` | Manage schema sync with platform |
| [mcp serve](#mcp-server-ai-editor-integration) | | Start MCP server for AI editors |

## Command reference

### `apso init`

Create a new Apso project from a language-specific template.

```bash
apso init
apso init --name my-app --language typescript
apso init --name my-app --language python --skip-platform
```

| Option | Description | Default |
|--------|-------------|---------|
| `-n, --name` | Project name | _(prompted)_ |
| `-l, --language` | Target language (`typescript`, `python`, `go`) | _(prompted)_ |
| `--skip-platform` | Skip platform linking (offline mode) | `false` |

When authenticated, `apso init` lets you create a new project or clone an existing one from the platform.

### `apso generate`

Generate backend code from the `.apsorc` schema file.

```bash
apso generate
apso generate --language python
apso generate --skip-format
```

| Option | Description | Default |
|--------|-------------|---------|
| `-l, --language` | Target language (`typescript`, `python`, `go`) | _(from .apsorc or prompted)_ |
| `--skip-format` | Skip Prettier formatting after generation | `false` |

Generated files are placed in `src/autogen/`. These files are overwritten on each run. Place custom code in `src/extensions/` to avoid losing changes.

### `apso dev`

Start the local development server using Docker Compose.

```bash
apso dev
apso dev --build
apso dev --detach
```

| Option | Description | Default |
|--------|-------------|---------|
| `--build` | Rebuild images before starting | `false` |
| `-d, --detach` | Run containers in the background | `false` |

Requires Docker and Docker Compose. Looks for `docker-compose.yml` in the current directory.

### `apso migrate`

Detect schema changes, generate migration SQL, and test against a local PGlite sandbox. No Docker or external database required.

```bash
apso migrate              # Detect changes, generate and test SQL
apso migrate --apply      # Update snapshot after successful test
apso migrate --reset      # Clear sandbox and start fresh
apso migrate --sql        # Output raw SQL only (for piping)
```

| Option | Description | Default |
|--------|-------------|---------|
| `--apply` | Update local schema snapshot after verified migration | `false` |
| `--reset` | Reset the sandbox (clear snapshot and PGlite data) | `false` |
| `--sql` | Output raw SQL statements only | `false` |

The sandbox works by comparing your current `.apsorc` against the last-known snapshot, generating the migration SQL, and executing it against an in-process Postgres instance (PGlite). If the migration fails locally, you know before it reaches any real database.

### `apso deploy`

Deploy the linked service to the Apso platform. Runs a local migration check before deploying.

```bash
apso deploy
apso deploy --yes
apso deploy --skip-migrate
apso deploy --no-wait
```

| Option | Description | Default |
|--------|-------------|---------|
| `-y, --yes` | Skip confirmation prompt | `false` |
| `--skip-migrate` | Skip local migration validation | `false` |
| `--no-wait` | Trigger deploy without waiting for completion | `false` |

If schema changes are detected, `apso deploy` shows the migration SQL and asks for confirmation before proceeding. If the migration fails locally, the deploy is blocked.

### `apso login`

Authenticate with the Apso platform via browser-based OAuth or API token.

```bash
apso login
apso login --token <api-token>
```

| Option | Description |
|--------|-------------|
| `-t, --token` | API token for non-interactive login (CI/CD) |

### `apso logout`

Clear stored credentials.

```bash
apso logout
```

### `apso whoami`

Display information about the current authenticated user and linked project.

```bash
apso whoami
```

### `apso link`

Link the current project to a platform service.

```bash
apso link
apso link --workspace my-team --service my-api
apso link --force
```

| Option | Description |
|--------|-------------|
| `-w, --workspace` | Workspace slug |
| `-s, --service` | Service slug |
| `-f, --force` | Overwrite existing link without confirmation |

### `apso unlink`

Remove the link between the current project and the platform.

```bash
apso unlink
```

### `apso status`

Show the current service and latest build status.

```bash
apso status
```

### `apso logs`

View build logs for the linked service.

```bash
apso logs
apso logs <build-id>
```

### `apso open`

Open the service dashboard or API endpoint in the browser.

```bash
apso open
```

### `apso projects`

List services in a workspace.

```bash
apso projects
```

### `apso config`

View or modify CLI configuration.

```bash
apso config                        # Show all settings
apso config get apiUrl             # Get a specific value
apso config set verbose true       # Set a value
apso config reset                  # Reset to defaults
```

**Configuration keys:**

| Key | Type | Description |
|-----|------|-------------|
| `apiUrl` | string | Platform API URL |
| `webUrl` | string | Platform web URL |
| `verbose` | boolean | Enable verbose output |
| `noColor` | boolean | Disable colored output |
| `telemetryDisabled` | boolean | Opt out of anonymous telemetry (or `apso config set telemetry off`) |
| `defaultWorkspace` | string | Default workspace slug |

Boolean values accept `true`/`false` or `1`/`0`.

Environment variables override config file values:

| Variable | Overrides |
|----------|-----------|
| `APSO_API_URL` | `apiUrl` |
| `APSO_WEB_URL` | `webUrl` |
| `APSO_DEBUG=true` | `verbose` |
| `NO_COLOR` or `APSO_NO_COLOR=true` | `noColor` |
| `APSO_TELEMETRY=0` / `DO_NOT_TRACK=1` | `telemetryDisabled` |

### `apso schema`

Manage schema synchronization between local `.apsorc` and the platform.

```bash
apso schema validate     # Validate local schema
apso schema diff         # Show diff between local and remote
apso schema push         # Push local schema to platform
apso schema pull         # Pull remote schema to local
```

## Global options

These options work with any command:

```bash
apso [command] --help       # Show command help
apso [command] --version    # Show CLI version
```

## Telemetry & privacy

The CLI sends anonymous usage data so we can see which commands are used and
prioritize accordingly. It is opt-out and carries no personal data.

**What is collected:** command name (`generate`, `init`, `deploy`, …), CLI
version, OS and architecture, Node version, command duration and success, and
an anonymous install id (a random UUID stored in your CLI config — not derived
from any machine identifier). If you are logged in, events attribute to your
Apso account, the same as the web app.

**What is never collected:** your source code, your `.apsorc` or schema
contents, file paths, environment variable values, or any other file contents.

**Opt out** any of these ways:

```bash
apso config set telemetry off     # persisted in your CLI config
export APSO_TELEMETRY=0            # per-shell
export DO_NOT_TRACK=1             # honors the consoledonottrack.com standard
```

On first run the CLI prints a one-time notice pointing at these opt-outs.
See [`docs/telemetry.md`](docs/telemetry.md) for full detail. Aggregate
public download stats (npm/PyPI) are available via `node scripts/usage-stats.mjs`.

## Supported languages

| Language | Framework | ORM | Status |
|----------|-----------|-----|--------|
| TypeScript | NestJS | TypeORM | Stable |
| Python | FastAPI | SQLAlchemy | In development |
| Go | Gin | GORM | In development |

## Contribute

```bash
git clone https://github.com/apsoai/cli.git
cd cli
npm install
npm run build
```

To run commands from the local build:

```bash
./bin/run generate
./bin/run migrate --sql
```

To develop continuously:

```bash
npm run build    # Rebuild after changes
npm link         # Make 'apso' command available globally
```

### Testing

```bash
npm run test             # Run all tests
npm run test:watch       # Watch mode
npm run test:cov         # Coverage report
```

### Debugging

```bash
env DEBUG=* ./bin/run generate
```

## License

MIT
