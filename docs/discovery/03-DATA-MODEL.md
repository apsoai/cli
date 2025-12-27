# Data Model and Local State

## Overview

This document describes the local state management, file structures, and data models used by the CLI for platform connectivity, offline support, and synchronization.

---

## Directory Structure

### Global Configuration (`~/.apso/`)

```
~/.apso/
├── credentials.json      # OAuth tokens and refresh token
├── config.json           # User preferences and defaults
├── cache/
│   ├── workspaces.json   # Cached workspace list
│   ├── services/
│   │   ├── {serviceId}.json  # Cached service details
│   │   └── ...
│   └── schemas/
│       ├── {serviceId}.json  # Cached schemas
│       └── ...
└── logs/
    └── apso.log          # Debug logs (when enabled)
```

### Project Configuration (`.apso/`)

```
.apso/
├── link.json             # Links project to platform service
├── sync-queue.json       # Pending operations (offline support)
└── backups/
    └── apsorc-{timestamp}.json  # Schema backups before conflict resolution
```

---

## File Schemas

### credentials.json

Stores authentication tokens securely.

```typescript
interface Credentials {
  accessToken: string;
  refreshToken: string;
  expiresAt: string;  // ISO 8601 timestamp
  user: {
    id: string;
    email: string;
    firstName: string;
    lastName: string;
  };
  // Optional: encrypted at rest
  encryptedAt?: string;
}
```

**Example:**
```json
{
  "accessToken": "eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9...",
  "refreshToken": "dGhpcyBpcyBhIHJlZnJlc2ggdG9rZW4...",
  "expiresAt": "2024-12-13T10:30:00Z",
  "user": {
    "id": "user_abc123",
    "email": "matt@example.com",
    "firstName": "Matt",
    "lastName": "Developer"
  }
}
```

**Security Considerations:**
- File permissions: 0600 (read/write owner only)
- Consider encryption at rest for tokens
- Never log token values
- Rotate refresh tokens on use

---

### config.json

Stores user preferences and defaults.

```typescript
interface Config {
  defaultWorkspace?: string;  // Workspace slug
  defaultService?: string;    // Service slug
  editor?: string;            // Preferred editor for diffs
  colorScheme?: 'auto' | 'light' | 'dark';
  jsonOutput?: boolean;       // Default to JSON output
  telemetry?: boolean;        // Usage analytics opt-in
  logLevel?: 'debug' | 'info' | 'warn' | 'error';
}
```

**Example:**
```json
{
  "defaultWorkspace": "acme-corp",
  "defaultService": null,
  "editor": "code --wait",
  "colorScheme": "auto",
  "jsonOutput": false,
  "telemetry": true,
  "logLevel": "info"
}
```

---

### link.json

Links a local project directory to a platform service.

```typescript
interface ProjectLink {
  // Platform identifiers
  workspaceId: string;
  workspaceSlug: string;
  serviceId: string;
  serviceSlug: string;

  // GitHub connection
  githubRepo: string | null;     // e.g., "acme-corp/api-v1"
  githubBranch: string;          // e.g., "main"

  // Sync state
  linkedAt: string;              // ISO 8601
  lastSyncedAt: string | null;   // ISO 8601
  lastSyncDirection: 'pull' | 'push' | 'both' | null;

  // Hash tracking for conflict detection
  localSchemaHash: string | null;
  remoteSchemaHash: string | null;

  // Metadata
  createdBy: string;             // User email
}
```

**Example:**
```json
{
  "workspaceId": "ws_abc123",
  "workspaceSlug": "acme-corp",
  "serviceId": "svc_def456",
  "serviceSlug": "api-v1",
  "githubRepo": "acme-corp/api-v1",
  "githubBranch": "main",
  "linkedAt": "2024-12-06T10:30:00Z",
  "lastSyncedAt": "2024-12-06T14:45:00Z",
  "lastSyncDirection": "push",
  "localSchemaHash": "sha256:abc123...",
  "remoteSchemaHash": "sha256:abc123...",
  "createdBy": "matt@example.com"
}
```

---

### sync-queue.json

Queues operations when offline for later processing.

```typescript
interface SyncQueue {
  operations: QueuedOperation[];
  createdAt: string;
  lastProcessedAt: string | null;
}

interface QueuedOperation {
  id: string;                    // UUID
  type: 'push' | 'pull' | 'sync';
  payload: {
    schemaHash: string;
    schemaPath: string;          // Path to backed-up schema
  };
  queuedAt: string;              // ISO 8601
  status: 'pending' | 'processing' | 'failed';
  attempts: number;
  lastError?: string;
}
```

**Example:**
```json
{
  "operations": [
    {
      "id": "op_xyz789",
      "type": "push",
      "payload": {
        "schemaHash": "sha256:def456...",
        "schemaPath": ".apso/backups/apsorc-2024-12-06T10-30-00.json"
      },
      "queuedAt": "2024-12-06T16:00:00Z",
      "status": "pending",
      "attempts": 0
    }
  ],
  "createdAt": "2024-12-06T16:00:00Z",
  "lastProcessedAt": null
}
```

---

### Cache Files

#### workspaces.json

```typescript
interface WorkspacesCache {
  workspaces: CachedWorkspace[];
  cachedAt: string;
  expiresAt: string;
}

interface CachedWorkspace {
  id: string;
  slug: string;
  name: string;
  type: 'Personal' | 'Educational' | 'Startup' | 'Agency' | 'Company' | 'Other';
  role: 'Owner' | 'Admin' | 'User';
  serviceCount: number;
}
```

#### services/{serviceId}.json

```typescript
interface ServiceCache {
  service: CachedService;
  cachedAt: string;
  expiresAt: string;
}

interface CachedService {
  id: string;
  slug: string;
  name: string;
  status: 'Active' | 'Draft' | 'Archived';
  buildStatus: string;
  serviceType: 'Lambda' | 'Shared' | 'Standalone';
  githubRepo: string | null;
  entityCount: number;
  lastUpdatedAt: string;
}
```

---

## Schema Conversion

### Platform ServiceSchema → Local .apsorc

The CLI must convert between platform schema format and local `.apsorc` format.

#### Platform Schema (from API)

```typescript
interface PlatformSchema {
  id: string;
  workspaceServiceId: string;
  entityName: string;
  description: string;
  status: 'Deploy' | 'Draft' | 'Build';
  primaryKey: string;
  primaryKeyType: 'serial' | 'uuid';
  createdAt: string;
  updatedAt: string;
  fields: PlatformField[];
}

interface PlatformField {
  id: string;
  name: string;
  type: string;
  nullable: boolean;
  defaultValue?: string;
  constraints?: Record<string, any>;
}
```

#### Local .apsorc Format

```typescript
interface ApsoRc {
  version: 2;
  rootFolder: string;
  apiType: 'rest' | 'graphql';
  entities: Entity[];
  relationships: Relationship[];
  auth?: AuthConfig;
}

interface Entity {
  name: string;
  created_at?: boolean;
  updated_at?: boolean;
  primaryKeyType?: 'serial' | 'uuid';
  fields?: Field[];
  indexes?: Index[];
  uniques?: Unique[];
  scopeBy?: string | string[];
}
```

#### Conversion Logic

```typescript
// Platform → Local
function convertToApsorc(platformSchemas: PlatformSchema[]): ApsoRc {
  return {
    version: 2,
    rootFolder: 'src',
    apiType: 'rest',
    entities: platformSchemas.map(schema => ({
      name: schema.entityName,
      primaryKeyType: schema.primaryKeyType,
      created_at: true,
      updated_at: true,
      fields: schema.fields.map(field => ({
        name: field.name,
        type: field.type,
        nullable: field.nullable,
        default: field.defaultValue,
      })),
    })),
    relationships: extractRelationships(platformSchemas),
  };
}

// Local → Platform
function convertToPlatformSchema(apsorc: ApsoRc): PlatformSchemaCreate[] {
  return apsorc.entities.map(entity => ({
    entityName: entity.name,
    primaryKeyType: entity.primaryKeyType || 'serial',
    fields: entity.fields?.map(field => ({
      name: field.name,
      type: field.type,
      nullable: field.nullable ?? true,
      defaultValue: field.default,
    })) || [],
  }));
}
```

---

## Hash Calculation

For conflict detection, schemas are hashed deterministically.

```typescript
import { createHash } from 'crypto';

function calculateSchemaHash(schema: ApsoRc): string {
  // Normalize: sort entities and fields alphabetically
  const normalized = {
    entities: [...schema.entities]
      .sort((a, b) => a.name.localeCompare(b.name))
      .map(entity => ({
        ...entity,
        fields: [...(entity.fields || [])]
          .sort((a, b) => a.name.localeCompare(b.name)),
      })),
    relationships: [...(schema.relationships || [])]
      .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))),
  };

  const content = JSON.stringify(normalized);
  const hash = createHash('sha256').update(content).digest('hex');

  return `sha256:${hash.substring(0, 16)}`;
}
```

---

## Sync State Machine

```
                    ┌───────────────────┐
                    │                   │
                    │     SYNCED        │
                    │                   │
                    └─────────┬─────────┘
                              │
              ┌───────────────┼───────────────┐
              │               │               │
              ▼               ▼               ▼
    ┌─────────────────┐ ┌───────────┐ ┌─────────────────┐
    │                 │ │           │ │                 │
    │ LOCAL_MODIFIED  │ │  IN_SYNC  │ │ REMOTE_MODIFIED │
    │                 │ │           │ │                 │
    └────────┬────────┘ └───────────┘ └────────┬────────┘
             │                                  │
             │          ┌───────────┐          │
             └─────────▶│           │◀─────────┘
                        │ CONFLICT  │
                        │           │
                        └───────────┘
```

### State Definitions

| State | Local Hash | Remote Hash | Action |
|-------|------------|-------------|--------|
| `SYNCED` | matches | matches | No action needed |
| `LOCAL_MODIFIED` | changed | unchanged | Push recommended |
| `REMOTE_MODIFIED` | unchanged | changed | Pull recommended |
| `CONFLICT` | changed | changed | Manual resolution required |

---

## Offline Queue Processing

```typescript
async function processQueue(): Promise<void> {
  const queue = loadQueue();

  for (const operation of queue.operations) {
    if (operation.status !== 'pending') continue;

    operation.status = 'processing';
    operation.attempts++;
    saveQueue(queue);

    try {
      switch (operation.type) {
        case 'push':
          await pushSchema(operation.payload);
          break;
        case 'pull':
          await pullSchema(operation.payload);
          break;
        case 'sync':
          await syncSchema(operation.payload);
          break;
      }

      // Success: remove from queue
      queue.operations = queue.operations.filter(
        op => op.id !== operation.id
      );
    } catch (error) {
      operation.status = 'pending';
      operation.lastError = error.message;

      if (operation.attempts >= 3) {
        operation.status = 'failed';
      }
    }

    saveQueue(queue);
  }
}
```

---

## Cache Invalidation Strategy

| Cache Type | TTL | Invalidation Trigger |
|------------|-----|---------------------|
| Workspaces | 1 hour | Login, workspace create/delete |
| Services | 30 min | Sync, push, service create/delete |
| Schemas | 15 min | Sync, push, pull |

```typescript
function isCacheValid(cache: { expiresAt: string }): boolean {
  return new Date(cache.expiresAt) > new Date();
}

function invalidateCache(type: 'workspaces' | 'services' | 'schemas'): void {
  const cachePath = path.join(CACHE_DIR, type);
  if (fs.existsSync(cachePath)) {
    fs.rmSync(cachePath, { recursive: true });
  }
}
```

---

## Security Considerations

1. **Credential Storage**
   - Store tokens with file permissions 0600
   - Consider OS keychain integration (future)
   - Never log sensitive data

2. **Cache Security**
   - Cache files use 0644 permissions
   - No sensitive data in cache (only metadata)
   - Clear cache on logout

3. **Backup Security**
   - Backups may contain schema data
   - Use .gitignore to exclude `.apso/` from commits
   - Auto-cleanup old backups (keep last 10)

4. **Network Security**
   - All API calls over HTTPS
   - Validate SSL certificates
   - Implement request timeouts
