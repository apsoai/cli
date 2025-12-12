/**
 * ProjectLink interface defines the structure of .apso/link.json
 * which links a local project directory to a platform service.
 */
export interface ProjectLink {
  // Platform identifiers
  workspaceId: string;
  workspaceSlug: string;
  serviceId: string;
  serviceSlug: string;

  // GitHub connection
  githubRepo: string | null; // e.g., "acme-corp/api-v1"
  githubBranch: string; // e.g., "main"

  // Sync state
  linkedAt: string; // ISO 8601
  lastSyncedAt: string | null; // ISO 8601
  lastSyncDirection: "pull" | "push" | "both" | null;

  // Hash tracking for conflict detection
  localSchemaHash: string | null;
  remoteSchemaHash: string | null;

  // Metadata
  createdBy: string; // User email
}


