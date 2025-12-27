# CLI-Platform Connection: Product Discovery

> **Discovery Date:** December 2024
> **Status:** Discovery Complete
> **Version:** 1.0

## Executive Summary

This document captures the complete product discovery for connecting the Apso CLI to the Apso Platform. Currently, the CLI and platform operate independently - the CLI only performs local operations (scaffolding code from `.apsorc` files) while the platform provides cloud-based service management, schema design, GitHub integration, and deployment capabilities.

The goal is to create a seamless bridge between local development and the cloud platform, enabling developers to:
- Authenticate with the platform from the CLI
- Sync schemas bidirectionally between local `.apsorc` files and platform services
- Leverage platform's GitHub integration for code synchronization
- Work offline with queued sync operations
- Use an interactive TUI for guided exploration and operations

## Problem Statement

Developers using Apso face a fragmented experience:

1. **Schema Design Friction**: Schemas designed in the platform UI must be manually exported to use locally. Changes made locally are not reflected in the platform.

2. **No Code Sync**: The platform generates code and pushes to GitHub, but there's no CLI workflow to trigger this or pull results.

3. **Offline Limitations**: Without platform connectivity, developers can only scaffold locally with no way to sync their work later.

4. **Context Switching**: Developers must switch between terminal and browser to perform related operations.

## Key Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| **Primary Users** | All personas (solo, team, devops) | Tool should serve multiple use cases |
| **Core Value (MVP)** | Schema synchronization | Most immediate pain point |
| **Authentication** | Browser OAuth flow | Like `gh auth login` - familiar UX |
| **Interaction Style** | Hybrid (CLI + TUI) | CLI for scripting, TUI for exploration |
| **Source of Truth** | Bidirectional | Either local or platform can be authoritative |
| **Conflict Resolution** | Manual resolution | Show diff, let user decide |
| **Offline Capability** | Critical | Must work fully offline, queue for sync |
| **Code Generation Flow** | Platform-centric | Local changes → Platform → GitHub → Local |

## Discovery Documents

| Document | Description |
|----------|-------------|
| [01-PERSONAS.md](./01-PERSONAS.md) | User personas and their goals |
| [02-WORKFLOWS.md](./02-WORKFLOWS.md) | Core user workflows and flows |
| [03-DATA-MODEL.md](./03-DATA-MODEL.md) | Local state management and data structures |
| [04-EDGE-CASES.md](./04-EDGE-CASES.md) | Edge cases and error handling |
| [05-COMMANDS.md](./05-COMMANDS.md) | Complete command reference |
| [06-TEST-SCENARIOS.md](./06-TEST-SCENARIOS.md) | Gherkin BDD test scenarios |
| [07-ROADMAP.md](./07-ROADMAP.md) | Implementation roadmap and phases |

## Current State vs. Future State

### Current CLI Commands

```
apso server new       # Clone service template from GitHub
apso server scaffold  # Generate code from local .apsorc
```

### Future CLI Commands

```
apso login           # Authenticate with platform
apso logout          # Clear credentials
apso whoami          # Show current user

apso create          # Guided wizard (service, entity, etc.)
apso list            # List resources (workspaces, services, etc.)

apso link            # Link local project to platform service
apso pull            # Download schema from platform
apso push            # Upload schema to platform
apso diff            # Compare local vs remote
apso sync            # Bidirectional sync
apso status          # Show sync state

apso connect github  # Connect GitHub to workspace
apso repos           # List GitHub repositories

apso init            # Initialize new project (renamed from server new)
apso scaffold        # Local code generation (existing)

apso sdk             # Generate TypeScript client SDK from OpenAPI spec

apso                 # Interactive full-screen mode (no arguments = TUI)
```

## Success Metrics

| Metric | Target |
|--------|--------|
| Schema sync round-trip time | < 30 seconds |
| Offline queue processing | 100% reliable |
| Conflict resolution accuracy | Users successfully resolve 95% of conflicts |
| TUI adoption | 30% of users try TUI mode |
| Overall satisfaction | NPS > 40 |

## Technical Architecture Overview

```
┌────────────────────────────────────────────────────────────────────┐
│                           LOCAL MACHINE                            │
├────────────────────────────────────────────────────────────────────┤
│                                                                    │
│  ┌─────────────┐     ┌─────────────┐     ┌─────────────┐          │
│  │   .apsorc   │     │  .apso/     │     │   Git Repo  │          │
│  │   (schema)  │     │  link.json  │     │  (code)     │          │
│  └──────┬──────┘     │  cache/     │     └──────┬──────┘          │
│         │            │  queue.json │            │                  │
│         │            └──────┬──────┘            │                  │
│         │                   │                   │                  │
│  ┌──────┴───────────────────┴───────────────────┴──────┐          │
│  │                    APSO CLI                          │          │
│  │  ┌─────────┐ ┌─────────┐ ┌─────────┐ ┌─────────┐   │          │
│  │  │  Auth   │ │  Sync   │ │ Offline │ │   TUI   │   │          │
│  │  │ Module  │ │ Engine  │ │  Queue  │ │  Mode   │   │          │
│  │  └────┬────┘ └────┬────┘ └────┬────┘ └────┬────┘   │          │
│  │       │           │           │           │         │          │
│  │  ┌────┴───────────┴───────────┴───────────┴────┐   │          │
│  │  │              API Client (HTTP)               │   │          │
│  │  └──────────────────────┬──────────────────────┘   │          │
│  └─────────────────────────┼──────────────────────────┘          │
│                            │                                      │
└────────────────────────────┼──────────────────────────────────────┘
                             │
                    ┌────────┴────────┐
                    │    INTERNET     │
                    └────────┬────────┘
                             │
┌────────────────────────────┼──────────────────────────────────────┐
│                            │         APSO PLATFORM                │
├────────────────────────────┼──────────────────────────────────────┤
│                            │                                      │
│  ┌─────────────────────────┴───────────────────────────────┐     │
│  │                       REST API                           │     │
│  └──────┬──────────────────┬───────────────────────┬───────┘     │
│         │                  │                       │              │
│  ┌──────┴──────┐   ┌───────┴───────┐   ┌──────────┴─────────┐   │
│  │ Workspaces  │   │   Services    │   │  GitHub Integration │   │
│  │   Users     │   │   Schemas     │   │    Code Push        │   │
│  │   Auth      │   │   Build       │   │    Webhooks         │   │
│  └─────────────┘   └───────────────┘   └──────────┬──────────┘   │
│                                                    │              │
└────────────────────────────────────────────────────┼──────────────┘
                                                     │
                                            ┌────────┴────────┐
                                            │     GITHUB      │
                                            │  (User's Repo)  │
                                            └─────────────────┘
```

## Next Steps

1. **Review this discovery** - Ensure all stakeholders agree on scope and approach
2. **Begin Phase 1 implementation** - Authentication and API client
3. **Validate with users** - Get feedback after each phase
4. **Iterate** - Adjust based on learnings

---

*This discovery document was created following the [Product Development Foundation](/.devenv/standards/foundations/product-development-foundation.md) methodology.*
