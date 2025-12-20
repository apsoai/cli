# Core Workflows

## Overview

This document describes the primary user workflows for the CLI-Platform connection. Each workflow includes the user goal, step-by-step actions, system behavior, and error scenarios.

---

## Workflow 1: First-Time Authentication

### Goal
User authenticates with the Apso platform from the CLI.

### Preconditions
- CLI is installed
- User has an Apso platform account
- User is not currently logged in

### Flow

```
┌─────────────┐     ┌─────────────┐     ┌─────────────┐     ┌─────────────┐
│    User     │     │    CLI      │     │   Browser   │     │  Platform   │
└──────┬──────┘     └──────┬──────┘     └──────┬──────┘     └──────┬──────┘
       │                   │                   │                   │
       │ apso login        │                   │                   │
       │──────────────────▶│                   │                   │
       │                   │                   │                   │
       │                   │ Start local HTTP  │                   │
       │                   │ server on :8899   │                   │
       │                   │──────────┐        │                   │
       │                   │          │        │                   │
       │                   │◀─────────┘        │                   │
       │                   │                   │                   │
       │                   │ Open browser      │                   │
       │                   │──────────────────▶│                   │
       │                   │                   │                   │
       │                   │                   │ Navigate to       │
       │                   │                   │ /auth/cli-login   │
       │                   │                   │──────────────────▶│
       │                   │                   │                   │
       │                   │                   │ Login page        │
       │                   │                   │◀──────────────────│
       │                   │                   │                   │
       │ Enter credentials │                   │                   │
       │──────────────────────────────────────▶│                   │
       │                   │                   │                   │
       │                   │                   │ POST credentials  │
       │                   │                   │──────────────────▶│
       │                   │                   │                   │
       │                   │                   │ Redirect to       │
       │                   │                   │ localhost:8899    │
       │                   │                   │ with auth code    │
       │                   │                   │◀──────────────────│
       │                   │                   │                   │
       │                   │ Receive callback  │                   │
       │                   │◀──────────────────│                   │
       │                   │                   │                   │
       │                   │ Exchange code     │                   │
       │                   │ for tokens        │                   │
       │                   │──────────────────────────────────────▶│
       │                   │                   │                   │
       │                   │ Access + Refresh  │                   │
       │                   │ tokens            │                   │
       │                   │◀──────────────────────────────────────│
       │                   │                   │                   │
       │                   │ Store tokens in   │                   │
       │                   │ ~/.apso/creds     │                   │
       │                   │──────────┐        │                   │
       │                   │          │        │                   │
       │                   │◀─────────┘        │                   │
       │                   │                   │                   │
       │ Success message   │                   │                   │
       │◀──────────────────│                   │                   │
       │                   │                   │                   │
```

### CLI Output

```bash
$ apso login
Opening browser for authentication...
Waiting for login... (press Ctrl+C to cancel)

✓ Successfully logged in as matt@example.com
  Workspace: acme-corp (default)
  Token expires: in 7 days

Tip: Run 'apso whoami' to check your login status
```

### Error Scenarios

| Error | Handling |
|-------|----------|
| Browser fails to open | Display URL for manual copy/paste |
| User cancels login | Display "Login cancelled" message |
| Network error | Retry with exponential backoff, then fail |
| Token exchange fails | Display error, suggest retry |
| Already logged in | Prompt to re-authenticate or cancel |

---

## Workflow 2: Link Local Project to Platform Service

### Goal
Connect a local project directory to an existing platform service.

### Preconditions
- User is authenticated
- User has access to at least one workspace with services
- Current directory is a valid project (has `.apsorc` or is empty)

### Flow

```bash
$ apso link
? Select workspace:
  ❯ acme-corp (Company)
    personal (Personal)

? Select service:
  ❯ api-v1 (Active - Last updated: 2 days ago)
    auth-service (Active - Last updated: 1 week ago)
    legacy-api (Archived)

Linking to acme-corp/api-v1...

✓ Project linked successfully!
  Workspace: acme-corp
  Service: api-v1
  GitHub: acme-corp/api-v1

  Local: .apso/link.json created

Next steps:
  • Run 'apso pull' to download the schema
  • Run 'apso status' to check sync state
```

### Created Files

```json
// .apso/link.json
{
  "workspaceId": "ws_abc123",
  "workspaceSlug": "acme-corp",
  "serviceId": "svc_def456",
  "serviceSlug": "api-v1",
  "githubRepo": "acme-corp/api-v1",
  "githubBranch": "main",
  "linkedAt": "2024-12-06T10:30:00Z",
  "lastSyncedAt": null,
  "localSchemaHash": null,
  "remoteSchemaHash": null
}
```

---

## Workflow 3: Pull Schema from Platform

### Goal
Download the latest schema from the platform and update local `.apsorc`.

### Preconditions
- User is authenticated
- Project is linked to a service
- Network connection available

### Flow - No Conflicts

```bash
$ apso pull
Fetching schema from acme-corp/api-v1...

✓ Schema downloaded
  Entities: 5 (User, Post, Comment, Tag, Category)
  Fields: 23 total

Local .apsorc updated.

Next steps:
  • Run 'apso scaffold' to generate code
  • Run 'apso status' to see sync state
```

### Flow - With Conflicts

```bash
$ apso pull
Fetching schema from acme-corp/api-v1...

⚠ Conflict detected!
  Your local .apsorc differs from the platform version.

Remote changes:
  + Added entity: Notification
  ~ Modified User: added 'avatar' field

Local changes:
  + Added entity: Settings
  ~ Modified User: added 'preferences' field

? How would you like to resolve this?
  ❯ Use remote (overwrite local)
    Use local (keep local, skip pull)
    Merge manually (open diff editor)
    Cancel

[User selects "Merge manually"]

Opening diff in your editor...
  Left: Local version
  Right: Remote version

After editing, save and close the editor.

✓ Schema merged and saved
  Backup saved to: .apso/backups/apsorc-2024-12-06T10-30-00.json
```

---

## Workflow 4: Push Schema to Platform

### Goal
Upload local schema changes to the platform, triggering code generation.

### Preconditions
- User is authenticated
- Project is linked to a service with GitHub connection
- Local `.apsorc` has changes

### Flow

```bash
$ apso push
Validating local schema...
✓ Schema is valid

Pushing to acme-corp/api-v1...
✓ Schema uploaded

Platform is generating code...
  ├─ Creating entities... done
  ├─ Generating services... done
  ├─ Generating controllers... done
  └─ Pushing to GitHub... done

✓ Code pushed to github.com/acme-corp/api-v1

? Run 'git pull' to update local code? [Y/n] Y

Pulling latest code...
✓ Local code updated (3 files changed)

All done! Your schema and code are in sync.
```

### Validation Errors

```bash
$ apso push
Validating local schema...

✗ Schema validation failed:

  Entity 'User':
    • Field 'email': Invalid type 'string' - did you mean 'text'?
    • Field 'age': Missing required property 'type'

  Entity 'Post':
    • Relationship to 'Author': Entity 'Author' not found

Please fix these errors and try again.
```

---

## Workflow 5: Full Bidirectional Sync

### Goal
Synchronize local and platform schemas in both directions.

### Flow

```bash
$ apso sync

Checking sync status...
  Local hash:  abc123
  Remote hash: def456
  Last sync:   2 hours ago

Fetching remote changes...
  Remote has 2 new changes since last sync

Comparing with local...
  Local has 1 new change since last sync

⚠ Bidirectional changes detected!

Remote changes (from platform):
  + Entity: AuditLog (new)
  ~ User: added 'lastLoginAt' field

Local changes (your edits):
  ~ Post: added 'featured' field

? Sync strategy:
  ❯ Merge all changes (recommended)
    Pull remote only (discard local)
    Push local only (overwrite remote)
    Cancel

[User selects "Merge all changes"]

Merging schemas...
✓ No conflicts - changes are compatible

Pushing merged schema to platform...
✓ Schema synced

Waiting for code generation...
✓ Code pushed to GitHub

Pulling latest code...
✓ Local code updated

Sync complete!
  Entities: 6 (+1)
  Fields: 28 (+3)
```

---

## Workflow 6: Create New Service

### Goal
Create a new service on the platform with GitHub integration.

### Flow

```bash
$ apso create

? What would you like to create?
  ❯ Service
    Entity (add to current schema)
    Workspace

? Service name: my-new-api

? Connect a GitHub repository?
  ❯ Connect existing repository
    Create new repository
    Skip (connect later)

Checking GitHub connection...
✓ GitHub connected to acme-corp

? Select repository:
  ❯ acme-corp/my-new-api
    acme-corp/backend-services
    acme-corp/api-gateway
    [Create new repository...]

Creating service...
✓ Service 'my-new-api' created

Linking local project...
✓ Project linked

? Initialize with a starter schema? [Y/n] Y

? Starter template:
  ❯ Minimal (User entity only)
    SaaS (User, Organization, Subscription)
    Custom (empty schema)

Creating initial schema...
✓ .apsorc created with starter template

Generating code...
✓ Code pushed to GitHub

✓ Setup complete!

Your new service is ready:
  Platform: https://app.apso.ai/acme-corp/my-new-api
  GitHub: https://github.com/acme-corp/my-new-api

Next steps:
  • Run 'git clone https://github.com/acme-corp/my-new-api'
  • Edit .apsorc to add entities
  • Run 'apso push' to update
```

---

## Workflow 7: Offline Development

### Goal
Continue development without network, sync when reconnected.

### Flow

```bash
# Working offline...

$ apso status
⚠ OFFLINE - No network connection

Last sync: 2024-12-06T10:30:00Z (3 hours ago)
Local changes: 2 entities modified

Cached data available for:
  • Workspaces: 2
  • Services: 5

$ apso scaffold
Generating code from local .apsorc...
✓ Code generated (no network required)

$ apso push
⚠ No network connection

? Queue this push for when you're online? [Y/n] Y

✓ Push queued
  Queued operations: 1

Run 'apso sync' when online to process queue.

# Later, when back online...

$ apso sync
Processing queued operations...

  1/1: Push schema changes...
  ✓ Schema pushed to platform
  ✓ Code generated
  ✓ Pushed to GitHub

All queued operations complete!

Pulling any remote changes...
✓ No new remote changes

Everything is synced.
```

---

## Workflow 8: TUI Mode Navigation

### Goal
Explore workspaces, services, and schemas visually.

### Flow

```bash
$ apso

┌─ APSO ─────────────────────────────────────────────────────────────────────┐
│                                                                            │
│  ┌─ Workspaces ──────┐  ┌─ Service: api-v1 ─────────────────────────────┐ │
│  │                   │  │                                               │ │
│  │ ❯ acme-corp       │  │  Status: Active      Synced: 5 min ago       │ │
│  │   personal        │  │  GitHub: acme-corp/api-v1                     │ │
│  │                   │  │                                               │ │
│  ├─ Services ────────┤  │  ┌─ Entities ─────────────────────────────┐  │ │
│  │                   │  │  │                                        │  │ │
│  │ ❯ api-v1          │  │  │ ❯ User (8 fields)                     │  │ │
│  │   auth-service    │  │  │   Post (5 fields)                     │  │ │
│  │   legacy-api      │  │  │   Comment (4 fields)                  │  │ │
│  │                   │  │  │   Tag (2 fields)                      │  │ │
│  │                   │  │  │   Category (3 fields)                 │  │ │
│  │                   │  │  │                                        │  │ │
│  │                   │  │  └────────────────────────────────────────┘  │ │
│  │                   │  │                                               │ │
│  └───────────────────┘  └───────────────────────────────────────────────┘ │
│                                                                            │
│  [n] New  [e] Edit  [d] Delete  [s] Sync  [p] Pull  [u] Push  [q] Quit    │
│                                                                            │
└────────────────────────────────────────────────────────────────────────────┘
```

### Keyboard Shortcuts

| Key | Action |
|-----|--------|
| `↑/↓` or `j/k` | Navigate lists |
| `Enter` | Select / Expand |
| `n` | New (service, entity, field) |
| `e` | Edit selected |
| `d` | Delete selected |
| `s` | Sync with platform |
| `p` | Pull from platform |
| `u` | Push to platform |
| `r` | Refresh data |
| `?` | Show help |
| `q` or `Ctrl+C` | Quit TUI |

---

## Workflow 9: Generate Client SDK

### Goal
Generate a type-safe TypeScript SDK for consuming your service's API in client applications.

### Preconditions
- User is authenticated
- Service is deployed (has accessible OpenAPI endpoint)
- User is in their client application directory

### Flow

```bash
$ apso sdk --service api-v1 --output ./src/api
Fetching OpenAPI specification from api-v1...
  Endpoint: https://api-v1.acme-corp.apso.dev/_docs/json

Parsing specification...
  Found 5 endpoints across 3 resources
  Found 12 schema definitions

Generating TypeScript SDK...
  ├─ types.ts (12 interfaces)
  ├─ client.ts (ApiClient class)
  ├─ endpoints/users.ts (4 methods)
  ├─ endpoints/posts.ts (5 methods)
  ├─ endpoints/comments.ts (3 methods)
  └─ index.ts (exports)

✓ SDK generated successfully!
  Output: ./src/api/

Install the Apso SDK runtime:
  npm install @apso/sdk

Usage:
  import { ApiClient } from './src/api';
  const api = new ApiClient({ baseUrl: '...' });
```

### Watch Mode (Development)

```bash
$ apso sdk --watch --output ./src/api
Watching for OpenAPI changes on api-v1...
  Polling: https://api-v1.acme-corp.apso.dev/_docs/json

[10:30:15] OpenAPI spec unchanged
[10:32:45] ⚡ Spec changed! Regenerating...
           + Added endpoint: POST /users/invite
           + Added schema: InviteUserDto
           ✓ SDK updated

Press Ctrl+C to stop watching.
```

### Integration with Backend Development

```bash
# Typical full-stack workflow:

# 1. Update schema and push
$ apso push
✓ Schema pushed, code generated

# 2. Wait for deployment (or use local)
$ apso status
Service api-v1: Deployed at https://api-v1.acme-corp.apso.dev

# 3. Regenerate client SDK
$ cd ../frontend
$ apso sdk --service api-v1 --output ./src/api
✓ SDK updated with new endpoints

# 4. Use in React/Vue/etc
```

---

## Workflow Summary

| Workflow | Command | Network | Offline Capable |
|----------|---------|---------|-----------------|
| Login | `apso login` | Required | No |
| Link project | `apso link` | Required | No (cached list) |
| Pull schema | `apso pull` | Required | No |
| Push schema | `apso push` | Required | Queue for later |
| Sync | `apso sync` | Required | Queue for later |
| Scaffold | `apso scaffold` | Not needed | Yes |
| Status | `apso status` | Optional | Yes (shows cached) |
| TUI | `apso` (no args) | Optional | Yes (read-only) |
| Create | `apso create` | Required | No |
| SDK Generate | `apso sdk` | Required | No |
