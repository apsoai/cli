# Edge Cases and Error Handling

## Overview

This document catalogs edge cases, error scenarios, and their handling strategies for the CLI-Platform connection. Proper handling of these scenarios is critical for a reliable user experience.

---

## Authentication Edge Cases

### EC-AUTH-001: Token Expired During Operation

**Scenario:** User's access token expires while a long-running operation (e.g., code generation) is in progress.

**Detection:**
- API returns 401 Unauthorized
- Token expiry time has passed

**Handling:**
1. Automatically attempt token refresh using refresh token
2. If refresh succeeds, retry the failed operation
3. If refresh fails, prompt user to re-authenticate
4. Preserve operation state for retry after re-auth

**User Experience:**
```
Pushing schema to platform...
⚠ Session expired, refreshing...
✓ Session refreshed
Continuing push...
✓ Schema pushed successfully
```

---

### EC-AUTH-002: Refresh Token Revoked

**Scenario:** User's refresh token has been revoked (e.g., password change, security event).

**Handling:**
1. Clear all stored credentials
2. Display clear message about why re-auth is needed
3. Prompt to re-authenticate

**User Experience:**
```
⚠ Your session has been invalidated.
  This can happen after a password change or security event.

Please log in again:
$ apso login
```

---

### EC-AUTH-003: Login on Headless Server

**Scenario:** User runs `apso login` on a CI server or SSH session without browser access.

**Handling:**
1. Detect headless environment (no $DISPLAY, no TTY)
2. Provide device code flow or manual URL copy
3. Support API key authentication as alternative

**User Experience:**
```
$ apso login
Cannot open browser in this environment.

Option 1: Copy this URL to a browser on another device:
  https://app.apso.ai/cli-auth?code=ABC123

Option 2: Use an API key:
  $ apso login --api-key YOUR_API_KEY
  (Generate at https://app.apso.ai/settings/api-keys)
```

---

### EC-AUTH-004: Multiple Accounts

**Scenario:** User has multiple Apso accounts (personal and work).

**Handling:**
1. Support named profiles in credentials
2. Allow switching between profiles
3. Show current profile in status commands

**User Experience:**
```
$ apso login --profile work
✓ Logged in as matt@company.com (profile: work)

$ apso login --profile personal
✓ Logged in as matt@gmail.com (profile: personal)

$ apso whoami
Logged in as matt@company.com (profile: work)

$ apso whoami --profile personal
Logged in as matt@gmail.com (profile: personal)
```

---

## Schema Sync Edge Cases

### EC-SYNC-001: Schema Deleted on Platform

**Scenario:** User tries to push/pull but the service's schema was deleted on the platform.

**Handling:**
1. Detect 404 response for schema
2. Offer to recreate schema from local .apsorc
3. Update link.json with new schema IDs

**User Experience:**
```
$ apso push
⚠ Schema not found on platform.
  The schema may have been deleted.

? What would you like to do?
  ❯ Create new schema from local .apsorc
    Unlink this project
    Cancel
```

---

### EC-SYNC-002: Service Deleted on Platform

**Scenario:** The linked service no longer exists on the platform.

**Handling:**
1. Detect 404 response for service
2. Clear link.json
3. Offer to re-link to existing service or create new

**User Experience:**
```
$ apso status
⚠ Service 'api-v1' not found on platform.
  The service may have been deleted or you may have lost access.

? What would you like to do?
  ❯ Link to a different service
    Create new service
    Remove link and work locally only
```

---

### EC-SYNC-003: Concurrent Edits by Team Members

**Scenario:** Two team members push schema changes at the same time.

**Handling:**
1. Platform uses optimistic locking (version field)
2. Second push fails with conflict
3. CLI pulls latest, shows diff, allows retry

**User Experience:**
```
$ apso push
✗ Conflict: Schema was modified by alice@company.com 30 seconds ago

Their changes:
  + Added field 'lastLogin' to User

Your changes:
  + Added field 'preferences' to User

? How would you like to resolve?
  ❯ Pull their changes, then re-apply yours
    Overwrite with your version (their changes will be lost)
    Cancel and resolve manually
```

---

### EC-SYNC-004: Large Schema (Timeout)

**Scenario:** Schema is very large, causing API timeout during push/pull.

**Handling:**
1. Implement chunked upload/download
2. Show progress indicator
3. Implement retry with exponential backoff

**User Experience:**
```
$ apso push
Pushing schema to platform...
  ├─ Uploading entities... ████████████████████░░░░ 80%
  └─ [Large schema detected - using chunked upload]

✓ Schema pushed (47 entities, 312 fields)
```

---

### EC-SYNC-005: Schema Validation Fails

**Scenario:** Local schema has validation errors the platform rejects.

**Handling:**
1. Perform client-side validation first
2. Display detailed error messages
3. Link to documentation for field types/constraints

**User Experience:**
```
$ apso push
Validating schema...

✗ Validation failed (3 errors):

  Entity 'User':
    Line 15: Field 'age' - Type 'string' is invalid. Did you mean 'text' or 'integer'?
    Line 23: Field 'email' - Missing required property 'type'

  Entity 'Post':
    Line 45: Relationship 'author' - References unknown entity 'Author'. Did you mean 'User'?

Fix these errors and try again.
See: https://docs.apso.ai/schema/field-types
```

---

## Git Integration Edge Cases

### EC-GIT-001: GitHub Not Connected

**Scenario:** User tries to push but workspace has no GitHub connection.

**Handling:**
1. Detect missing GitHub connection
2. Offer to connect GitHub or skip code push
3. Provide link to connect in browser

**User Experience:**
```
$ apso push
⚠ GitHub is not connected to workspace 'acme-corp'

? What would you like to do?
  ❯ Connect GitHub now (opens browser)
    Push schema only (skip code generation)
    Cancel

[User selects "Connect GitHub now"]
Opening browser to connect GitHub...
```

---

### EC-GIT-002: Repository Not Found

**Scenario:** The connected GitHub repository was deleted or renamed.

**Handling:**
1. Detect 404 from GitHub API
2. Offer to reconnect to different repo
3. Update link.json with new repo

**User Experience:**
```
$ apso push
✗ GitHub repository 'acme-corp/old-api' not found

The repository may have been deleted or renamed.

? What would you like to do?
  ❯ Connect to a different repository
    Create new repository
    Push schema only (skip code generation)
```

---

### EC-GIT-003: Push Conflicts with Local Git

**Scenario:** Platform pushes code to GitHub but user has uncommitted local changes.

**Handling:**
1. Check for uncommitted changes before sync
2. Offer to stash changes
3. Pop stash after sync completes

**User Experience:**
```
$ apso sync
⚠ You have uncommitted changes that may conflict:
  M src/entities/User.entity.ts
  M src/entities/Post.entity.ts

? What would you like to do?
  ❯ Stash changes, sync, then restore
    Commit changes first (abort sync)
    Continue anyway (may cause conflicts)

[User selects "Stash changes"]
Stashing local changes...
Syncing with platform...
✓ Sync complete
Restoring stashed changes...
✓ Changes restored

Note: You may need to resolve merge conflicts in your stashed changes.
```

---

### EC-GIT-004: Branch Mismatch

**Scenario:** Platform pushes to `main` but user is on a feature branch.

**Handling:**
1. Detect current branch vs linked branch
2. Warn user about potential issues
3. Offer options to handle

**User Experience:**
```
$ apso sync
⚠ Branch mismatch detected:
  Current branch: feature/new-auth
  Linked branch: main

Platform will push to 'main'. Options:

? How would you like to proceed?
  ❯ Checkout 'main' and sync
    Merge 'main' into current branch after sync
    Push to 'main' only (don't pull locally)
    Cancel
```

---

## Offline Edge Cases

### EC-OFF-001: Queue Overflow

**Scenario:** User makes many changes offline, queue becomes very large.

**Handling:**
1. Set reasonable queue limit (e.g., 50 operations)
2. Warn when approaching limit
3. Prevent data loss by refusing new queues when full

**User Experience:**
```
$ apso push
⚠ Offline queue is nearly full (48/50 operations)

Consider connecting to sync pending changes.

? Queue this push anyway? [y/N]
```

---

### EC-OFF-002: Queue Contains Conflicting Operations

**Scenario:** User queued a push, then made more changes and queued another push.

**Handling:**
1. Detect superseding operations
2. Consolidate queue (keep latest state)
3. Show user what will be synced

**User Experience:**
```
$ apso sync
Processing offline queue...

ℹ Consolidating 3 push operations into 1 (using latest state)

Pushing schema...
✓ Schema synced
```

---

### EC-OFF-003: Stale Cache Causes Confusion

**Scenario:** User views cached data that's very outdated.

**Handling:**
1. Show cache age prominently
2. Warn when cache is old
3. Offer to refresh when online

**User Experience:**
```
$ apso list services
⚠ OFFLINE - Showing cached data (5 days old)

Services in 'acme-corp':
  • api-v1 (cached status: Active)
  • auth-service (cached status: Active)

Run 'apso list services --refresh' when online to update.
```

---

## Network Edge Cases

### EC-NET-001: Intermittent Connection

**Scenario:** Network drops during an operation.

**Handling:**
1. Implement automatic retry with backoff
2. Show retry status to user
3. Queue operation if retries exhausted

**User Experience:**
```
$ apso push
Pushing schema...
⚠ Connection lost, retrying... (attempt 2/3)
⚠ Connection lost, retrying... (attempt 3/3)
✗ Network unavailable after 3 attempts

? Queue this push for later? [Y/n]
```

---

### EC-NET-002: API Rate Limiting

**Scenario:** User hits platform API rate limits.

**Handling:**
1. Detect 429 Too Many Requests
2. Show rate limit reset time
3. Wait and retry automatically

**User Experience:**
```
$ apso sync
⚠ Rate limit exceeded. Waiting 45 seconds...
  [████████████░░░░░░░░░░░░░░░░░░] 30s remaining

Retrying...
✓ Sync complete
```

---

### EC-NET-003: Platform Maintenance

**Scenario:** Platform is down for scheduled maintenance.

**Handling:**
1. Detect 503 Service Unavailable
2. Parse maintenance window from response
3. Queue operations for after maintenance

**User Experience:**
```
$ apso push
⚠ Platform is under maintenance

Scheduled maintenance: Dec 6, 2024 10:00-10:30 UTC
Estimated end: in 25 minutes

? Queue this push for later? [Y/n]
```

---

## Project Configuration Edge Cases

### EC-PROJ-001: Multiple .apsorc Files

**Scenario:** Project has multiple .apsorc files (e.g., monorepo).

**Handling:**
1. Detect multiple .apsorc files
2. Prompt user to select which to use
3. Store selection in link.json

**User Experience:**
```
$ apso link
Found multiple .apsorc files:
  1. ./services/api/.apsorc
  2. ./services/auth/.apsorc
  3. ./packages/shared/.apsorc

? Which schema file should be linked? [1]
```

---

### EC-PROJ-002: Corrupted .apsorc

**Scenario:** The .apsorc file is invalid JSON or has syntax errors.

**Handling:**
1. Validate JSON syntax before operations
2. Show clear error with line/column
3. Offer to restore from backup

**User Experience:**
```
$ apso push
✗ Invalid .apsorc file

Parse error at line 23, column 15:
  Unexpected token '}' - did you forget a comma?

  22 |     "type": "text"
  23 |   }
     |   ^

? Restore from last backup? (.apso/backups/apsorc-2024-12-05.json) [y/N]
```

---

### EC-PROJ-003: Version Mismatch

**Scenario:** .apsorc uses version 1 format, CLI expects version 2.

**Handling:**
1. Detect schema version
2. Offer to migrate to latest version
3. Create backup before migration

**User Experience:**
```
$ apso push
⚠ .apsorc uses legacy format (version 1)

? Would you like to migrate to version 2? [Y/n]

Backing up current file...
Migrating to version 2...
✓ Migration complete

Diff:
  - { "entities": [...] }
  + { "version": 2, "rootFolder": "src", "entities": [...] }

? Continue with push? [Y/n]
```

---

## Summary: Error Code Reference

| Code | Category | Description |
|------|----------|-------------|
| `E001` | Auth | Token expired |
| `E002` | Auth | Refresh token revoked |
| `E003` | Auth | Unauthorized access |
| `E010` | Sync | Schema not found |
| `E011` | Sync | Service not found |
| `E012` | Sync | Schema conflict |
| `E013` | Sync | Validation failed |
| `E020` | Git | GitHub not connected |
| `E021` | Git | Repository not found |
| `E022` | Git | Push failed |
| `E030` | Network | Connection timeout |
| `E031` | Network | Rate limited |
| `E032` | Network | Service unavailable |
| `E040` | Project | Invalid configuration |
| `E041` | Project | File not found |

**Exit Codes:**
- `0`: Success
- `1`: General error
- `2`: Conflict requiring resolution
- `3`: Authentication required
- `4`: Network error (retriable)
