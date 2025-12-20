# User Personas

## Overview

The CLI-Platform connection serves three primary user personas, each with distinct needs and workflows. The tool must accommodate all personas while prioritizing the most common use cases.

---

## Persona 1: Solo Developer

### Description
An individual developer building their own SaaS product or side project. Works primarily alone, often on a laptop, sometimes without reliable internet access.

### Demographics
- Experience: Junior to senior developer
- Team size: 1 (solo)
- Projects: 1-3 active projects
- Usage: Daily development work

### Pain Points
1. **Manual synchronization**: Copy/paste between platform UI and local `.apsorc` files
2. **No backup**: Local schema changes aren't saved anywhere if laptop fails
3. **Context switching**: Must switch between terminal and browser constantly
4. **Offline limitations**: Can't make progress without internet connection

### Goals
- Design schemas locally in their preferred editor
- Push work to platform for safekeeping and visualization
- Pull platform-designed schemas to scaffold locally
- Continue working during flights, cafes with poor WiFi
- Single source of truth they control

### Key Workflows
1. `apso push` - Backup local work to platform
2. `apso pull` - Get latest schema to scaffold
3. `apso scaffold` - Generate code locally (offline-capable)
4. `apso` (no args) - Visual exploration when learning the system

### Success Criteria
- Can work for 8+ hours offline, sync when connected
- Schema sync takes < 30 seconds
- Never loses work due to sync issues

---

## Persona 2: Team Developer

### Description
A developer working as part of a team on a shared project. Needs to collaborate on schemas and stay in sync with teammates' changes.

### Demographics
- Experience: Mid to senior developer
- Team size: 3-10 developers
- Projects: 1-2 shared projects
- Usage: Daily collaborative development

### Pain Points
1. **No shared schemas**: Team members maintain separate local copies
2. **Merge conflicts**: Schema changes collide without visibility
3. **Stale local copies**: Working on outdated schemas
4. **No review process**: Schema changes bypass team review

### Goals
- Pull latest team schemas before starting work
- Push schema updates for team review
- See when schemas have changed since last sync
- Resolve conflicts collaboratively
- Maintain consistent schemas across team

### Key Workflows
1. `apso pull` - Start day by pulling latest schemas
2. `apso status` - Check if local is out of sync
3. `apso diff` - See what changed before pulling
4. `apso push` - Share changes with team
5. `apso sync` - Full bidirectional sync with conflict resolution

### Success Criteria
- Can see teammate changes within 1 minute
- Conflict resolution is clear and actionable
- Never accidentally overwrites teammate work
- Can review schema diff before accepting changes

---

## Persona 3: DevOps / Platform Engineer

### Description
An engineer responsible for infrastructure, CI/CD, and deployment automation. Needs scriptable, non-interactive commands for automation pipelines.

### Demographics
- Experience: Senior engineer / DevOps specialist
- Team size: Part of larger engineering org
- Projects: Multiple services across teams
- Usage: CI/CD pipelines, automation scripts

### Pain Points
1. **No CLI automation**: Platform operations require manual UI interaction
2. **No scriptability**: Can't integrate schema deployment into CI/CD
3. **No programmatic access**: API exists but no CLI wrapper
4. **Manual deployments**: Schema changes require manual platform steps

### Goals
- Script schema deployment in CI/CD pipelines
- Automate workspace and service management
- Non-interactive commands with exit codes
- JSON output for parsing in scripts
- Idempotent operations for reliability

### Key Workflows
1. `apso push --non-interactive` - CI/CD schema deployment
2. `apso list services --json` - Scripted inventory
3. `apso sync --auto-resolve=remote` - Automated sync
4. `apso status --format=json` - Machine-readable status

### Success Criteria
- All commands have non-interactive mode
- JSON output available for all list/status commands
- Exit codes indicate success/failure clearly
- Commands are idempotent (safe to retry)
- Can run in headless CI environment

---

## Persona Priority Matrix

| Feature | Solo Dev | Team Dev | DevOps |
|---------|----------|----------|--------|
| `apso login` | High | High | High |
| `apso pull` | High | Critical | High |
| `apso push` | High | Critical | Critical |
| `apso sync` | Medium | High | Medium |
| `apso diff` | Medium | High | Low |
| `apso status` | Medium | High | Critical |
| `apso` (TUI) | High | Medium | Low |
| Offline mode | Critical | Medium | Low |
| JSON output | Low | Low | Critical |
| Non-interactive | Low | Medium | Critical |

---

## User Journey: New User Onboarding

```
1. Developer installs CLI
   $ npm install -g @apso/cli

2. Developer authenticates
   $ apso login
   → Browser opens, user logs in
   → Token stored locally

3. Developer links existing project
   $ apso link
   → Selects workspace and service
   → .apso/link.json created

4. Developer pulls schema
   $ apso pull
   → Downloads .apsorc from platform

5. Developer generates code
   $ apso scaffold
   → Local code generated

6. Developer makes local changes
   → Edits .apsorc

7. Developer syncs back
   $ apso push
   → Schema uploaded to platform
   → Platform generates code
   → Code pushed to GitHub

8. Developer updates local
   $ git pull
   → Gets platform-generated code
```

---

## Persona-Specific Requirements

### Solo Developer Requirements
- [ ] Offline-first architecture
- [ ] Automatic conflict backup before resolution
- [ ] TUI mode for visual navigation
- [ ] Clear sync status indicators
- [ ] Local caching of workspace data

### Team Developer Requirements
- [ ] Pull before push workflow guidance
- [ ] Conflict visualization with diff
- [ ] Last-synced-by information
- [ ] Team activity notifications (future)
- [ ] Branch-aware syncing (future)

### DevOps Requirements
- [ ] `--json` flag on all commands
- [ ] `--non-interactive` flag for CI
- [ ] `--auto-resolve` flag for conflicts
- [ ] Clear exit codes (0=success, 1=error, 2=conflict)
- [ ] Headless authentication (API key option)
- [ ] Dry-run mode for testing
