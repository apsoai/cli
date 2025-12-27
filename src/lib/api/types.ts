/**
 * Platform API Types
 *
 * TypeScript interfaces for platform API responses and requests.
 */

/**
 * API error response structure
 */
export interface ApiError {
  statusCode: number;
  message: string;
  error?: string;
  details?: Record<string, unknown>;
}

/**
 * Paginated response wrapper
 */
export interface PaginatedResponse<T> {
  data: T[];
  meta: {
    total: number;
    page: number;
    pageSize: number;
    totalPages: number;
  };
}

/**
 * Workspace from platform API
 */
export interface Workspace {
  id: string;
  slug: string;
  name: string;
  type: "personal" | "company";
  description?: string;
  avatarUrl?: string;
  createdAt: string;
  updatedAt: string;
  membersCount?: number;
  servicesCount?: number;
  githubConnected?: boolean;
}

/**
 * Service from platform API
 */
export interface Service {
  id: string;
  workspaceId: string;
  slug: string;
  name: string;
  description?: string;
  status: "active" | "building" | "error" | "archived";
  createdAt: string;
  updatedAt: string;
  lastDeployedAt?: string;
  githubRepo?: string;
  githubBranch?: string;
  endpoint?: string;
}

/**
 * Service schema from platform API
 * This represents the platform's ServiceSchema format
 */
export interface ServiceSchema {
  id: string;
  serviceId: string;
  version: number;
  entities: SchemaEntity[];
  createdAt: string;
  updatedAt: string;
  hash?: string;
}

/**
 * Entity in a service schema
 */
export interface SchemaEntity {
  name: string;
  tableName?: string;
  fields: SchemaField[];
  relationships?: SchemaRelationship[];
  auth?: EntityAuth;
  scopeBy?: string[];
}

/**
 * Field in a schema entity
 */
export interface SchemaField {
  name: string;
  type: string;
  nullable?: boolean;
  unique?: boolean;
  default?: unknown;
  primaryKey?: boolean;
  index?: boolean;
  constraints?: Record<string, unknown>;
}

/**
 * Relationship in a schema entity
 */
export interface SchemaRelationship {
  name: string;
  type: "one-to-one" | "one-to-many" | "many-to-one" | "many-to-many";
  target: string;
  inverseSide?: string;
  cascade?: boolean;
  nullable?: boolean;
}

/**
 * Authentication configuration for an entity
 */
export interface EntityAuth {
  protected?: boolean;
  roles?: string[];
  owner?: string;
}

/**
 * GitHub repository from platform API
 */
export interface GitHubRepo {
  id: number;
  fullName: string;
  name: string;
  owner: string;
  private: boolean;
  defaultBranch: string;
  url: string;
}

/**
 * GitHub connection status
 */
export interface GitHubConnection {
  connected: boolean;
  installationId?: number;
  login?: string;
  avatarUrl?: string;
}

/**
 * Build status from platform API
 */
export interface BuildStatus {
  id: string;
  serviceId: string;
  status: "pending" | "building" | "success" | "failed";
  startedAt: string;
  completedAt?: string;
  logs?: string;
  error?: string;
}

/**
 * User profile from platform API
 */
export interface UserProfile {
  id: string;
  email: string;
  name?: string;
  avatarUrl?: string;
  createdAt: string;
  defaultWorkspaceId?: string;
  workspaces: Workspace[];
}

/**
 * OAuth token exchange response
 */
export interface TokenExchangeResponse {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
  tokenType: string;
  user: {
    id: string;
    email: string;
    name?: string;
    avatarUrl?: string;
  };
}

/**
 * Token refresh response
 */
export interface TokenRefreshResponse {
  accessToken: string;
  expiresIn: number;
  tokenType: string;
}

/**
 * Request options for API calls
 */
export interface ApiRequestOptions {
  /**
   * HTTP method
   */
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

  /**
   * Request body (will be JSON stringified)
   */
  body?: unknown;

  /**
   * Query parameters
   */
  params?: Record<string, string | number | boolean | undefined>;

  /**
   * Additional headers
   */
  headers?: Record<string, string>;

  /**
   * Request timeout in milliseconds
   */
  timeout?: number;

  /**
   * Skip authentication (for public endpoints)
   */
  skipAuth?: boolean;
}
