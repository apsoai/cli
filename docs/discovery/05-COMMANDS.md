# Command Reference

## Overview

This document provides a complete reference for all CLI commands in the platform-connected CLI. Commands are organized by category and follow a consistent pattern.

---

## Command Design Principles

1. **Contextual Defaults**: Commands infer context from current directory, link status, and defaults
2. **Interactive by Default**: Use wizards for complex operations; flags for scripting
3. **Progressive Disclosure**: Show minimal output by default; verbosity flags for detail
4. **Graceful Degradation**: Work offline when possible; queue operations when not
5. **Consistent Flags**: Same flags mean the same thing across commands

---

## Global Flags

These flags are available on all commands:

| Flag | Short | Description |
|------|-------|-------------|
| `--help` | `-h` | Show help for command |
| `--version` | `-v` | Show CLI version |
| `--verbose` | | Enable verbose output |
| `--quiet` | `-q` | Suppress non-essential output |
| `--json` | | Output as JSON (for scripting) |
| `--no-color` | | Disable colored output |
| `--profile` | `-p` | Use named auth profile |

---

## Authentication Commands

### `apso login`

Authenticate with the Apso platform.

```bash
apso login [options]
```

**Options:**
| Option | Description |
|--------|-------------|
| `--api-key <key>` | Use API key instead of OAuth |
| `--profile <name>` | Save to named profile |
| `--no-browser` | Don't open browser automatically |

**Examples:**
```bash
# Standard browser-based login
apso login

# Use API key (for CI/CD)
apso login --api-key apso_live_abc123

# Create named profile
apso login --profile work
```

**Exit Codes:**
- `0`: Successfully authenticated
- `1`: Authentication failed
- `3`: User cancelled

---

### `apso logout`

Clear stored authentication credentials.

```bash
apso logout [options]
```

**Options:**
| Option | Description |
|--------|-------------|
| `--profile <name>` | Logout from specific profile |
| `--all` | Logout from all profiles |

**Examples:**
```bash
# Logout from current/default profile
apso logout

# Logout from specific profile
apso logout --profile work

# Logout from all profiles
apso logout --all
```

---

### `apso whoami`

Display current authentication status.

```bash
apso whoami [options]
```

**Options:**
| Option | Description |
|--------|-------------|
| `--profile <name>` | Check specific profile |

**Output:**
```
Logged in as matt@example.com
  Workspace: acme-corp (default)
  Token expires: in 6 days
  Profile: default
```

**JSON Output:**
```json
{
  "authenticated": true,
  "email": "matt@example.com",
  "defaultWorkspace": "acme-corp",
  "tokenExpiresAt": "2024-12-12T10:30:00Z",
  "profile": "default"
}
```

---

## Resource Commands

### `apso create`

Create a new resource using guided wizard.

```bash
apso create [type] [options]
```

**Types:**
- `service` - Create a new service
- `entity` - Add entity to current schema (TODO)
- `workspace` - Create a new workspace (TODO)

**Options:**
| Option | Description |
|--------|-------------|
| `--name <name>` | Resource name (skip prompt) |
| `--workspace <slug>` | Target workspace |
| `--no-github` | Skip GitHub connection |
| `--template <name>` | Use schema template |

**Examples:**
```bash
# Interactive wizard
apso create

# Create service directly
apso create service --name my-api

# Create with template
apso create service --name my-api --template minimal-saas
```

---

### `apso list`

List resources.

```bash
apso list [type] [options]
```

**Types:**
- `workspaces` - List user's workspaces
- `services` - List services in workspace
- `entities` - List entities in current schema

**Options:**
| Option | Description |
|--------|-------------|
| `--workspace <slug>` | Target workspace (for services) |
| `--format <fmt>` | Output format: table, json, plain |

**Examples:**
```bash
# Interactive selection
apso list

# List specific type
apso list services
apso list workspaces

# List services in specific workspace
apso list services --workspace acme-corp

# JSON output for scripting
apso list services --json
```

---

## Schema Commands

### `apso pull`

Download schema from platform.

```bash
apso pull [options]
```

**Options:**
| Option | Description |
|--------|-------------|
| `--force` | Overwrite local without prompting |
| `--backup` | Create backup before overwriting |
| `--dry-run` | Show what would change, don't write |

**Examples:**
```bash
# Standard pull
apso pull

# Pull without prompts (CI/CD)
apso pull --force

# Preview changes
apso pull --dry-run
```

---

### `apso push`

Upload schema to platform.

```bash
apso push [options]
```

**Options:**
| Option | Description |
|--------|-------------|
| `--force` | Push even with remote changes |
| `--no-generate` | Skip code generation |
| `--no-pull` | Don't offer to git pull after |
| `--dry-run` | Validate and show what would happen |

**Examples:**
```bash
# Standard push
apso push

# Push without code generation
apso push --no-generate

# CI/CD mode
apso push --force --no-pull
```

---

### `apso diff`

Compare local and remote schemas.

```bash
apso diff [options]
```

**Options:**
| Option | Description |
|--------|-------------|
| `--side-by-side` | Side-by-side view |
| `--unified` | Unified diff format |
| `--stat` | Summary statistics only |

**Examples:**
```bash
# Standard diff
apso diff

# Summary only
apso diff --stat
```

**Output:**
```
Schema Diff: local ↔ remote

Added locally:
  + Entity: Settings
  + User.preferences (json)

Removed locally:
  - Post.viewCount (integer)

Modified:
  ~ User.email: nullable changed (true → false)

Summary: +2 additions, -1 removal, 1 modification
```

---

### `apso sync`

Bidirectional schema synchronization.

```bash
apso sync [options]
```

**Options:**
| Option | Description |
|--------|-------------|
| `--strategy <s>` | `merge`, `pull-only`, `push-only` |
| `--auto-resolve <r>` | Auto-resolve: `local`, `remote`, `newest` |
| `--no-git` | Skip git operations |
| `--dry-run` | Preview sync without applying |

**Examples:**
```bash
# Interactive sync
apso sync

# Pull only (never push)
apso sync --strategy pull-only

# Auto-resolve to remote (CI/CD)
apso sync --auto-resolve remote
```

---

## Project Commands

### `apso link`

Link local project to platform service.

```bash
apso link [options]
```

**Options:**
| Option | Description |
|--------|-------------|
| `--workspace <slug>` | Target workspace |
| `--service <slug>` | Target service |
| `--create` | Create new service if not found |

**Examples:**
```bash
# Interactive linking
apso link

# Direct link
apso link --workspace acme-corp --service api-v1
```

---

### `apso unlink`

Remove link between local project and platform.

```bash
apso unlink [options]
```

**Options:**
| Option | Description |
|--------|-------------|
| `--keep-schema` | Don't delete local .apsorc |

**Examples:**
```bash
# Unlink project
apso unlink
```

---

### `apso status`

Show current project and sync status.

```bash
apso status [options]
```

**Options:**
| Option | Description |
|--------|-------------|
| `--check` | Exit with code 1 if out of sync |

**Output:**
```
Project Status
  Linked to: acme-corp/api-v1
  GitHub: acme-corp/api-v1 (main)

Sync Status: ✓ In sync
  Local hash:  sha256:abc123...
  Remote hash: sha256:abc123...
  Last sync: 2 hours ago

Offline Queue: Empty
```

**JSON Output:**
```json
{
  "linked": true,
  "workspace": "acme-corp",
  "service": "api-v1",
  "github": {
    "repo": "acme-corp/api-v1",
    "branch": "main"
  },
  "sync": {
    "status": "synced",
    "localHash": "sha256:abc123...",
    "remoteHash": "sha256:abc123...",
    "lastSyncedAt": "2024-12-06T08:30:00Z"
  },
  "queue": {
    "pending": 0
  }
}
```

---

## GitHub Commands

### `apso connect github`

Connect GitHub to workspace.

```bash
apso connect github [options]
```

**Options:**
| Option | Description |
|--------|-------------|
| `--workspace <slug>` | Target workspace |

---

### `apso repos`

List available GitHub repositories.

```bash
apso repos [options]
```

**Options:**
| Option | Description |
|--------|-------------|
| `--workspace <slug>` | Target workspace |
| `--filter <query>` | Filter by name |

---

## Code Generation Commands

### `apso init`

Initialize a new Apso project.

```bash
apso init [name] [options]
```

**Options:**
| Option | Description |
|--------|-------------|
| `--template <name>` | Project template |
| `--no-git` | Don't initialize git |
| `--no-install` | Skip npm install |

**Note:** This is a rename of the existing `apso server new` command.

---

### `apso scaffold`

Generate code from local schema.

```bash
apso scaffold [options]
```

**Options:**
| Option | Description |
|--------|-------------|
| `--sync` | Sync with platform after generating |
| `--watch` | Watch for schema changes |
| `--only <entities>` | Generate specific entities only |

**Note:** This is the existing `apso server scaffold` command, with new options.

---

### `apso sdk`

Generate a type-safe client SDK from a service's OpenAPI specification.

```bash
apso sdk [options]
```

**Options:**
| Option | Description |
|--------|-------------|
| `--service <slug>` | Service to generate SDK from (uses linked service if omitted) |
| `--output <dir>` | Output directory for generated SDK (default: `./src/api`) |
| `--base-url <url>` | Override base URL in generated client |
| `--name <name>` | Name for the generated client (default: service name) |
| `--watch` | Regenerate when OpenAPI spec changes |

**What it generates:**
- TypeScript types for all request/response schemas
- Type-safe API client with methods for each endpoint
- Error types and response handling utilities

**Examples:**
```bash
# Generate SDK for linked service
apso sdk --output ./src/api

# Generate SDK for specific service
apso sdk --service api-v1 --output ./src/lib/api

# Generate with custom client name
apso sdk --name MyApiClient --output ./src/api

# Watch mode for development
apso sdk --watch --output ./src/api
```

**Output Structure:**
```
./src/api/
├── index.ts           # Main export (client + types)
├── client.ts          # API client with typed methods
├── types.ts           # TypeScript interfaces from OpenAPI schemas
├── endpoints/         # Individual endpoint modules
│   ├── users.ts
│   ├── posts.ts
│   └── ...
└── utils.ts           # Error handling, response utilities
```

**Usage in Client App:**
```typescript
import { ApiClient } from './src/api';

const api = new ApiClient({
  baseUrl: 'https://api.example.com',
  headers: { Authorization: `Bearer ${token}` }
});

// Fully typed - IDE autocomplete for all endpoints
const users = await api.users.list({ limit: 10 });
const user = await api.users.get({ id: '123' });
const newUser = await api.users.create({ email: 'test@example.com' });
```

**Prerequisites:**
- Service must be deployed (OpenAPI spec fetched from live endpoint)
- User must be authenticated (`apso login`)
- `@apso/sdk` package provides the generation templates

---

## TUI Mode

### `apso` (no arguments)

Launch interactive terminal UI. Running `apso` with no arguments enters TUI mode.

```bash
apso [options]
```

**Options:**
| Option | Description |
|--------|-------------|
| `--workspace <slug>` | Open specific workspace |
| `--service <slug>` | Open specific service |
| `--read-only` | Disable mutations |

**Note:** This is the default behavior when no subcommand is provided. If you're in a linked project, TUI opens to that service. Otherwise, it starts at the workspace list.

---

## Configuration Commands

### `apso config`

Manage CLI configuration.

```bash
apso config <action> [key] [value]
```

**Actions:**
- `get` - Get config value
- `set` - Set config value
- `list` - List all config
- `reset` - Reset to defaults

**Examples:**
```bash
# Set default workspace
apso config set defaultWorkspace acme-corp

# Get value
apso config get defaultWorkspace

# List all
apso config list

# Reset
apso config reset
```

---

## Utility Commands

### `apso doctor`

Diagnose CLI configuration and connectivity.

```bash
apso doctor
```

**Output:**
```
Apso CLI Health Check

✓ CLI version: 1.0.0 (latest)
✓ Node.js version: 18.17.0
✓ Authenticated: matt@example.com
✓ Platform API: Connected (latency: 45ms)
✓ GitHub: Connected
✓ Project linked: acme-corp/api-v1
⚠ Offline queue: 2 pending operations

All systems operational.
```

---

### `apso completion`

Generate shell completion scripts.

```bash
apso completion [shell]
```

**Shells:** bash, zsh, fish, powershell

**Example:**
```bash
# Add to ~/.zshrc
eval "$(apso completion zsh)"
```

---

## Command Aliases

For convenience, common operations have short aliases:

| Alias | Command |
|-------|---------|
| `apso in` | `apso init` |
| `apso s` | `apso status` |
| `apso ls` | `apso list` |
| `apso c` | `apso create` |

---

## Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `APSO_API_URL` | Platform API URL | `https://api.apso.ai` |
| `APSO_CONFIG_DIR` | Config directory | `~/.apso` |
| `APSO_DEBUG` | Enable debug logging | `false` |
| `APSO_NO_COLOR` | Disable colors | `false` |
| `APSO_PROFILE` | Default auth profile | `default` |
