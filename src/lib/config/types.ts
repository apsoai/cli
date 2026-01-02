/**
 * Platform CLI Configuration Types
 *
 * These types define the structure of configuration and credentials
 * stored in ~/.apso/ for platform connectivity.
 */

/**
 * OAuth tokens received from the platform
 */
export interface PlatformTokens {
  /**
   * JWT access token for API calls
   */
  accessToken: string;

  /**
   * Refresh token for obtaining new access tokens
   */
  refreshToken: string;

  /**
   * When the access token expires (ISO timestamp)
   */
  expiresAt: string;

  /**
   * Token type, typically "Bearer"
   */
  tokenType: string;
}

/**
 * User information from the platform
 */
export interface PlatformUser {
  /**
   * Unique user ID
   */
  id: string;

  /**
   * User's email address
   */
  email: string;

  /**
   * User's display name
   */
  name?: string;

  /**
   * URL to user's avatar image
   */
  avatarUrl?: string;
}

/**
 * Workspace information from the platform
 */
export interface PlatformWorkspace {
  /**
   * Unique workspace ID
   */
  id: string;

  /**
   * URL-friendly slug
   */
  slug: string;

  /**
   * Display name
   */
  name: string;

  /**
   * Workspace type
   */
  type: "personal" | "company";
}

/**
 * Credentials stored in ~/.apso/credentials.json
 */
export interface CredentialsFile {
  /**
   * OAuth tokens
   */
  tokens: PlatformTokens;

  /**
   * Authenticated user information
   */
  user: PlatformUser;

  /**
   * When credentials were last updated (ISO timestamp)
   */
  updatedAt: string;

  /**
   * CLI version that wrote these credentials
   */
  cliVersion: string;
}

/**
 * Global CLI configuration stored in ~/.apso/config.json
 */
export interface GlobalConfigFile {
  /**
   * Default workspace slug to use
   */
  defaultWorkspace?: string;

  /**
   * Platform API base URL
   */
  apiUrl: string;

  /**
   * Enable verbose logging
   */
  verbose: boolean;

  /**
   * Disable colored output
   */
  noColor: boolean;

  /**
   * Disable telemetry
   */
  telemetryDisabled: boolean;
}

/**
 * Project link stored in .apso/link.json
 */
export interface ProjectLinkFile {
  /**
   * Linked workspace ID
   */
  workspaceId: string;

  /**
   * Linked workspace slug
   */
  workspaceSlug: string;

  /**
   * Linked service ID
   */
  serviceId: string;

  /**
   * Linked service slug
   */
  serviceSlug: string;

  /**
   * GitHub repository (if connected)
   */
  githubRepo?: string;

  /**
   * GitHub branch
   */
  githubBranch?: string;

  /**
   * When the link was created (ISO timestamp)
   */
  linkedAt: string;

  /**
   * Last successful sync (ISO timestamp)
   */
  lastSyncedAt?: string;

  /**
   * Hash of local schema at last sync
   */
  localSchemaHash?: string;

  /**
   * Hash of remote schema at last sync
   */
  remoteSchemaHash?: string;
}

/**
 * Sync queue item for offline operations
 */
export interface SyncQueueItem {
  /**
   * Unique operation ID
   */
  id: string;

  /**
   * Type of operation
   */
  type: "push" | "pull" | "sync";

  /**
   * When the operation was queued (ISO timestamp)
   */
  queuedAt: string;

  /**
   * Operation payload
   */
  payload: {
    /**
     * Schema snapshot at queue time
     */
    schemaSnapshot?: unknown;

    /**
     * Additional metadata
     */
    metadata?: Record<string, unknown>;
  };

  /**
   * Number of retry attempts
   */
  retryCount: number;

  /**
   * Last error message if retried
   */
  lastError?: string;
}

/**
 * Sync queue file stored in .apso/sync-queue.json
 */
export interface SyncQueueFile {
  /**
   * Schema version for migrations
   */
  version: number;

  /**
   * Queued operations
   */
  operations: SyncQueueItem[];
}

/**
 * Default values for global configuration
 */
export const DEFAULT_GLOBAL_CONFIG: GlobalConfigFile = {
  apiUrl: "https://api.apso.ai",
  verbose: false,
  noColor: false,
  telemetryDisabled: false,
};

/**
 * Environment variables that can override configuration
 */
export const CONFIG_ENV_VARS = {
  APSO_API_URL: "apiUrl",
  APSO_WEB_URL: "webUrl", // Note: webUrl is auto-detected, but can be overridden via env var
  APSO_DEBUG: "verbose",
  APSO_NO_COLOR: "noColor",
  APSO_PROFILE: "profile",
  APSO_CONFIG_DIR: "configDir",
} as const;
