# Implementation Roadmap

## Overview

This document outlines the phased implementation plan for connecting the Apso CLI to the platform. The approach follows progressive delivery principles, where each phase produces working, testable software.

---

## Phase Summary

| Phase | Name | Goal | Depends On |
|-------|------|------|------------|
| 1 | Foundation | Auth + API connectivity | - |
| 2 | Core Sync | Schema pull/push/sync | Phase 1 |
| 3 | Git Integration | GitHub code sync | Phase 2 |
| 4 | SDK Generation | Client SDK from OpenAPI | Phase 1 |
| 5 | Offline Mode | Queue + cache system | Phase 2 |
| 6 | TUI Mode | Interactive terminal UI | Phase 2 |
| 7 | Polish | Production readiness | All |

---

## Phase 1: Foundation

### Goal
Establish platform connectivity and authentication infrastructure.

### Why This Phase First
All platform features depend on authentication. This phase creates the foundation for every subsequent feature.

### Deliverables
- Users can authenticate via browser OAuth
- CLI can make authenticated API calls to platform
- Credentials are securely stored and refreshed

### Tasks

#### 1.1 Project Structure
- [ ] Create `src/lib/api/` directory for API client code
- [ ] Create `src/lib/auth/` directory for authentication code
- [ ] Create `src/lib/config/` directory for configuration management
- [ ] Add TypeScript interfaces for API responses
- [ ] Update package.json with new dependencies

#### 1.2 Configuration Management
- [ ] Implement `~/.apso/` directory initialization
- [ ] Create config.json read/write utilities
- [ ] Create credentials.json read/write utilities with encryption
- [ ] Implement file permission management (0600 for credentials)
- [ ] Add config schema validation

#### 1.3 API Client
- [ ] Create HTTP client wrapper with axios or fetch
- [ ] Implement request/response interceptors for auth
- [ ] Add automatic token refresh on 401
- [ ] Implement retry logic with exponential backoff
- [ ] Add request timeout handling
- [ ] Create platform API type definitions

#### 1.4 OAuth Flow
- [ ] Create local HTTP server for OAuth callback (port 8899)
- [ ] Implement browser launch for OAuth URL
- [ ] Handle OAuth callback with auth code
- [ ] Exchange auth code for tokens
- [ ] Store tokens securely

#### 1.5 Commands
- [ ] Implement `apso login` command
  - [ ] Open browser to platform OAuth page
  - [ ] Wait for callback
  - [ ] Store tokens
  - [ ] Display success message
- [ ] Implement `apso logout` command
  - [ ] Clear credentials file
  - [ ] Display confirmation
- [ ] Implement `apso whoami` command
  - [ ] Read stored credentials
  - [ ] Display user info and token status
  - [ ] Support --json flag

#### 1.6 Testing
- [ ] Unit tests for config utilities
- [ ] Unit tests for API client
- [ ] Integration tests for OAuth flow (mocked)
- [ ] Manual testing checklist

### Success Criteria
- [ ] `apso login` opens browser and completes OAuth
- [ ] Token stored in `~/.apso/credentials.json`
- [ ] `apso whoami` displays logged-in user
- [ ] Token refresh works automatically
- [ ] `apso logout` clears credentials

---

## Phase 2: Core Sync

### Goal
Enable bidirectional schema synchronization between local `.apsorc` and platform.

### Why This Phase
This is the core value proposition. Users need to sync schemas before any other features become useful.

### Deliverables
- Users can link local projects to platform services
- Users can pull schemas from platform
- Users can push schemas to platform
- Users can view diff between local and remote
- Conflict resolution works correctly

### Tasks

#### 2.1 Project Linking
- [ ] Create `.apso/` directory structure for project config
- [ ] Implement link.json schema and utilities
- [ ] Create workspace listing API call
- [ ] Create service listing API call
- [ ] Implement `apso link` command with wizard

#### 2.2 Schema Conversion
- [ ] Map platform ServiceSchema fields to .apsorc format
- [ ] Map .apsorc format to platform ServiceSchema
- [ ] Handle relationship conversion
- [ ] Implement schema normalization for comparison
- [ ] Create hash calculation for conflict detection

#### 2.3 Pull Implementation
- [ ] Fetch schema from platform API
- [ ] Convert to .apsorc format
- [ ] Check for local file existence
- [ ] Implement conflict detection
- [ ] Create backup before overwrite
- [ ] Implement `apso pull` command

#### 2.4 Push Implementation
- [ ] Read local .apsorc file
- [ ] Validate schema structure
- [ ] Convert to platform format
- [ ] Push to platform API
- [ ] Handle validation errors
- [ ] Implement `apso push` command

#### 2.5 Diff Implementation
- [ ] Fetch remote schema
- [ ] Calculate diff against local
- [ ] Format diff output (colored, side-by-side)
- [ ] Implement `apso diff` command

#### 2.6 Sync Implementation
- [ ] Compare local and remote hashes
- [ ] Determine sync direction
- [ ] Implement merge strategies
- [ ] Handle bidirectional changes
- [ ] Implement `apso sync` command

#### 2.7 Conflict Resolution
- [ ] Display conflict diff to user
- [ ] Implement interactive prompt for resolution
- [ ] Support "use local", "use remote", "merge"
- [ ] Create backup before resolution
- [ ] Update hashes after resolution

#### 2.8 Status Command
- [ ] Show linked service info
- [ ] Show sync status
- [ ] Show local/remote hashes
- [ ] Implement `apso status` command

#### 2.9 Testing
- [ ] Unit tests for schema conversion
- [ ] Unit tests for hash calculation
- [ ] Unit tests for diff generation
- [ ] Integration tests for pull/push
- [ ] Manual testing for conflict scenarios

### Success Criteria
- [ ] `apso link` successfully links project
- [ ] `apso pull` downloads and converts schema
- [ ] `apso push` uploads and validates schema
- [ ] `apso diff` shows clear differences
- [ ] `apso sync` handles bidirectional changes
- [ ] Conflict resolution works correctly
- [ ] `apso status` shows accurate state

---

## Phase 3: Git Integration

### Goal
Integrate with GitHub for code synchronization after schema changes.

### Why This Phase
Users need their generated code to appear in their GitHub repositories. This completes the sync loop.

### Deliverables
- Platform code generation triggers after push
- Generated code appears in GitHub
- CLI assists with git pull after sync
- GitHub connection management from CLI

### Tasks

#### 3.1 GitHub Connection Check
- [ ] Check if service has GitHub connected
- [ ] Display GitHub repo info in status
- [ ] Detect missing GitHub connection

#### 3.2 Code Generation Polling
- [ ] Trigger platform code generation after push
- [ ] Poll for generation completion
- [ ] Show progress indicator
- [ ] Handle generation failures

#### 3.3 Git Integration
- [ ] Detect if in git repository
- [ ] Check for uncommitted changes before sync
- [ ] Offer to stash changes
- [ ] Run git pull after platform pushes
- [ ] Pop stash after pull

#### 3.4 GitHub Connection Management
- [ ] Implement `apso connect github` command
- [ ] Open browser for GitHub OAuth
- [ ] Implement `apso repos` command to list repos

#### 3.5 Create Service with GitHub
- [ ] Add GitHub connection step to `apso create`
- [ ] Allow selecting existing repo
- [ ] Allow creating new repo

#### 3.6 Testing
- [ ] Integration tests for git operations (mocked)
- [ ] Manual testing with real GitHub

### Success Criteria
- [ ] Push triggers code generation
- [ ] Generated code appears in GitHub
- [ ] `git pull` updates local code
- [ ] Uncommitted changes handled gracefully
- [ ] GitHub connection works from CLI

---

## Phase 4: SDK Generation

### Goal
Generate type-safe TypeScript client SDKs from deployed service OpenAPI specifications.

### Why This Phase
Completes the full-stack developer experience. After pushing backend changes, developers need updated client types.

### Deliverables
- Fetch OpenAPI spec from deployed service
- Generate TypeScript types from schemas
- Generate typed API client
- Watch mode for development workflow

### Tasks

#### 4.1 OpenAPI Fetching
- [ ] Resolve service endpoint from platform API
- [ ] Fetch OpenAPI JSON from service's `/_docs/json` endpoint
- [ ] Handle authentication for private endpoints
- [ ] Cache spec for comparison (watch mode)

#### 4.2 Type Generation
- [ ] Parse OpenAPI schemas
- [ ] Generate TypeScript interfaces for each schema
- [ ] Handle nested/referenced schemas
- [ ] Generate enum types
- [ ] Handle nullable and optional fields

#### 4.3 Client Generation
- [ ] Generate API client class
- [ ] Create method for each endpoint
- [ ] Type request parameters and bodies
- [ ] Type response data
- [ ] Generate per-resource modules (users.ts, posts.ts, etc.)

#### 4.4 SDK Command
- [ ] Implement `apso sdk` command
- [ ] Add `--service` flag for service selection
- [ ] Add `--output` flag for target directory
- [ ] Add `--name` flag for client name
- [ ] Add `--base-url` flag for URL override

#### 4.5 Watch Mode
- [ ] Implement `--watch` flag
- [ ] Poll for OpenAPI spec changes
- [ ] Regenerate on spec change
- [ ] Show diff of what changed

#### 4.6 Integration with @apso/sdk
- [ ] Define interface with SDK package
- [ ] Use SDK templates for generation
- [ ] Ensure runtime compatibility

#### 4.7 Testing
- [ ] Unit tests for OpenAPI parsing
- [ ] Unit tests for type generation
- [ ] Integration tests with sample specs
- [ ] Manual testing with real services

### Success Criteria
- [ ] `apso sdk` generates valid TypeScript
- [ ] Generated client compiles without errors
- [ ] Types match actual API responses
- [ ] Watch mode detects and regenerates on changes
- [ ] Generated SDK is usable in React/Vue/etc projects

---

## Phase 5: Offline Mode

### Goal
Enable CLI to work without network, queuing operations for later sync.

### Why This Phase
Developers often work offline. This feature is marked as critical in discovery.

### Deliverables
- Scaffold works without network
- Push/sync queues when offline
- Queue processes when online
- Cache provides read access offline

### Tasks

#### 5.1 Network Detection
- [ ] Implement network connectivity check
- [ ] Create isOnline() utility
- [ ] Detect network state changes

#### 5.2 Cache Layer
- [ ] Create cache directory structure
- [ ] Implement workspace cache
- [ ] Implement service cache
- [ ] Implement cache TTL management
- [ ] Add cache invalidation logic

#### 5.3 Sync Queue
- [ ] Create sync-queue.json schema
- [ ] Implement queue operations (add, remove, list)
- [ ] Store operation payload with backup
- [ ] Implement queue consolidation

#### 5.4 Offline Commands
- [ ] Scaffold works offline (already does)
- [ ] Push adds to queue when offline
- [ ] Sync processes queue when online
- [ ] Status shows offline indicator
- [ ] List shows cached data when offline

#### 5.5 Queue Processing
- [ ] Process queue on `apso sync`
- [ ] Handle operation failures
- [ ] Implement retry logic
- [ ] Clean up successful operations

#### 5.6 Testing
- [ ] Unit tests for queue operations
- [ ] Unit tests for cache management
- [ ] Integration tests for offline scenarios

### Success Criteria
- [ ] Scaffold works without network
- [ ] Push queues when offline
- [ ] Queue processes correctly when online
- [ ] Cached data accessible offline
- [ ] Offline indicator shown appropriately

---

## Phase 6: TUI Mode

### Goal
Create interactive terminal UI for guided exploration and operations.

### Why This Phase
TUI provides a superior experience for exploration and complex operations.

### Deliverables
- Full-screen interactive mode
- Navigate workspaces and services
- View schemas visually
- Guided wizards for create/edit

### Tasks

#### 6.1 TUI Framework Setup
- [ ] Evaluate frameworks (ink, blessed)
- [ ] Set up chosen framework
- [ ] Create basic layout (sidebar + main)
- [ ] Implement keyboard navigation

#### 6.2 Workspace Browser
- [ ] Display workspace list in sidebar
- [ ] Navigate with arrow keys
- [ ] Show workspace details on select

#### 6.3 Service Browser
- [ ] Display services in workspace
- [ ] Navigate to service details
- [ ] Show service status and metadata

#### 6.4 Schema Viewer
- [ ] Display entities list
- [ ] Show fields in entity
- [ ] Color-code by type

#### 6.5 Create Service Wizard
- [ ] Multi-step wizard flow
- [ ] Name input
- [ ] Type selection
- [ ] GitHub connection step
- [ ] Confirmation and creation

#### 6.6 Schema Editor Wizard
- [ ] Add entity flow
- [ ] Add field flow
- [ ] Edit existing fields
- [ ] Delete with confirmation

#### 6.7 Sync Controls
- [ ] Show sync status in status bar
- [ ] Trigger sync with 's' key
- [ ] Show sync progress

#### 6.8 Testing
- [ ] Component tests for TUI elements
- [ ] Manual testing for flows

### Success Criteria
- [ ] TUI launches full-screen
- [ ] Navigation works smoothly
- [ ] Wizards complete successfully
- [ ] Sync works from TUI
- [ ] Exit returns to terminal

---

## Phase 7: Polish

### Goal
Production-ready CLI with excellent UX.

### Deliverables
- Comprehensive error handling
- Complete help system
- Shell completion
- Performance optimization
- Documentation

### Tasks

#### 7.1 Error Handling
- [ ] Consistent error message format
- [ ] Actionable error suggestions
- [ ] Error codes for scripting
- [ ] Stack traces in debug mode

#### 7.2 Help System
- [ ] Complete --help for all commands
- [ ] Examples in help text
- [ ] `apso help <command>` support

#### 7.3 Shell Completion
- [ ] Bash completion script
- [ ] Zsh completion script
- [ ] Fish completion script

#### 7.4 Progress Indicators
- [ ] Spinners for async operations
- [ ] Progress bars for long operations
- [ ] Clear success/failure states

#### 7.5 Performance
- [ ] Profile slow operations
- [ ] Optimize API calls
- [ ] Lazy load modules
- [ ] Cache API responses

#### 7.6 Doctor Command
- [ ] Check CLI version
- [ ] Check Node version
- [ ] Check auth status
- [ ] Check network connectivity
- [ ] Check project configuration

#### 7.7 Documentation
- [ ] Update README
- [ ] Command reference docs
- [ ] Troubleshooting guide
- [ ] Migration guide from old commands

#### 7.8 Testing
- [ ] End-to-end test suite
- [ ] CI/CD pipeline setup
- [ ] Cross-platform testing

### Success Criteria
- [ ] All commands have comprehensive help
- [ ] Errors are clear and actionable
- [ ] Shell completion works
- [ ] Doctor command passes
- [ ] Documentation complete

---

## Validation Checkpoints

### After Phase 1
- Can a user login and see their account info?
- Does token refresh work?
- Is the API client reliable?

### After Phase 2
- Can a user link a project?
- Does pull/push work reliably?
- Is conflict resolution clear?

### After Phase 3
- Does code appear in GitHub after push?
- Is the git integration smooth?
- Can a user complete a full cycle?

### After Phase 4
- Does SDK generation produce valid TypeScript?
- Do generated types match the API?
- Does watch mode detect changes?

### After Phase 5
- Can a user work on an airplane?
- Does the queue process correctly?
- Is cached data helpful?

### After Phase 6
- Is the TUI intuitive?
- Do wizards guide effectively?
- Is navigation smooth?

### After Phase 7
- Is the CLI polished?
- Are errors helpful?
- Is documentation complete?

---

## Risk Assessment

| Risk | Impact | Likelihood | Mitigation |
|------|--------|------------|------------|
| OAuth complexity | High | Medium | Use proven libraries, test thoroughly |
| Schema format differences | High | Medium | Define clear mapping, version format |
| Git conflicts | Medium | High | Clear user guidance, safe defaults |
| OpenAPI spec variations | Medium | Medium | Test with multiple real services, handle edge cases |
| Offline queue corruption | High | Low | Backup queue, atomic operations |
| TUI framework issues | Low | Medium | Prototype early, have backup plan |

---

## Dependencies

### External Dependencies
- Platform API must support CLI operations
- Platform OAuth must support CLI callback
- GitHub integration must be stable

### Internal Dependencies
- Phase 2 depends on Phase 1 (auth)
- Phase 3 depends on Phase 2 (schema sync)
- Phase 4 depends on Phase 1 (auth, deployed service)
- Phase 5 depends on Phase 2 (basic sync)
- Phase 6 depends on Phase 2 (data layer)
- Phase 7 depends on all phases

---

## Success Metrics

| Metric | Target | Phase |
|--------|--------|-------|
| Login success rate | > 99% | 1 |
| Schema sync round-trip | < 30s | 2 |
| Conflict resolution success | > 95% | 2 |
| GitHub sync success | > 98% | 3 |
| SDK type accuracy | 100% | 4 |
| Offline queue reliability | 100% | 5 |
| TUI user satisfaction | > 80% | 6 |
| Error clarity rating | > 4/5 | 7 |
