/**
 * Supported authentication provider types
 */
export type AuthProviderType =
  | "better-auth"
  | "custom-db-session"
  | "auth0"
  | "clerk"
  | "cognito"
  | "api-key";

/**
 * Base configuration common to all auth providers
 */
export interface BaseAuthConfig {
  /**
   * The authentication provider type
   */
  provider: AuthProviderType;
}

/**
 * Configuration for DB-backed session providers (Better Auth, custom-db-session)
 */
export interface DbSessionAuthConfig extends BaseAuthConfig {
  provider: "better-auth" | "custom-db-session";

  /**
   * Entity name for sessions. Default: "session"
   */
  sessionEntity?: string;

  /**
   * Entity name for users. Default: "User"
   */
  userEntity?: string;

  /**
   * Junction entity for user-organization mapping. Default: "AccountUser"
   */
  accountUserEntity?: string;

  /**
   * Cookie name prefix for session tokens. Default: service name
   */
  cookiePrefix?: string;

  /**
   * Field name on accountUserEntity for organization ID. Default: "organizationId"
   */
  organizationField?: string;

  /**
   * Field name on accountUserEntity for user's role. Default: "role"
   */
  roleField?: string;
}

/**
 * JWT configuration for token-based providers
 */
export interface JwtConfig {
  /**
   * The JWT issuer URL (e.g., "https://your-tenant.auth0.com/")
   */
  issuer: string;

  /**
   * Expected audience for the JWT
   */
  audience: string;

  /**
   * JWKS URI for key rotation. If not provided, uses issuer + /.well-known/jwks.json
   */
  jwksUri?: string;

  /**
   * Algorithms to accept. Default: ["RS256"]
   */
  algorithms?: string[];
}

/**
 * Claim mapping for JWT providers
 */
export interface JwtClaimsMapping {
  /**
   * Claim for user ID. Default: "sub"
   */
  userId?: string;

  /**
   * Claim for workspace/organization ID
   */
  workspaceId?: string;

  /**
   * Claim for organization ID (alias for workspaceId)
   */
  organizationId?: string;

  /**
   * Claim for user roles array
   */
  roles?: string;

  /**
   * Claim for user email
   */
  email?: string;
}

/**
 * Configuration for JWT-based providers (Auth0, Cognito, Clerk)
 */
export interface JwtAuthConfig extends BaseAuthConfig {
  provider: "auth0" | "clerk" | "cognito";

  /**
   * JWT verification configuration
   */
  jwt: JwtConfig;

  /**
   * Mapping of JWT claims to AuthContext fields
   */
  claims?: JwtClaimsMapping;

  /**
   * Optional: If you want to sync/verify users against a local User entity
   */
  userEntity?: string;
}

/**
 * Configuration for API key authentication
 */
export interface ApiKeyAuthConfig extends BaseAuthConfig {
  provider: "api-key";

  /**
   * Header name for API key. Default: "x-api-key"
   */
  apiKeyHeader?: string;

  /**
   * Entity name for API keys. Default: "ApiKey"
   */
  apiKeyEntity?: string;

  /**
   * Field name on apiKeyEntity for workspace/organization ID
   */
  workspaceField?: string;

  /**
   * Field name on apiKeyEntity for role/permissions
   */
  roleField?: string;
}

/**
 * Union type of all auth configurations
 */
export type AuthConfig = DbSessionAuthConfig | JwtAuthConfig | ApiKeyAuthConfig;

/**
 * The normalized AuthContext that all providers produce.
 * This is what scopeBy and RBAC consume.
 */
export interface AuthContext {
  /**
   * The authenticated user's ID
   */
  userId?: string;

  /**
   * The user's email (if available)
   */
  email?: string;

  /**
   * The workspace/tenant ID (generic term)
   */
  workspaceId?: string;

  /**
   * The organization ID (alias for workspaceId in multi-tenant contexts)
   */
  organizationId?: string;

  /**
   * Array of roles/permissions the user has
   */
  roles: string[];

  /**
   * For API key auth: the service/key identifier
   */
  serviceId?: string;

  /**
   * Raw user object (provider-specific, for advanced use cases)
   */
  user?: unknown;

  /**
   * Raw session object (provider-specific, for advanced use cases)
   */
  session?: unknown;
}

/**
 * Default values for DB session auth configuration
 */
export const DB_SESSION_AUTH_DEFAULTS: Required<
  Omit<DbSessionAuthConfig, "provider" | "cookiePrefix">
> & { cookiePrefix?: string } = {
  sessionEntity: "session",
  userEntity: "User",
  accountUserEntity: "AccountUser",
  organizationField: "organizationId",
  roleField: "role",
  cookiePrefix: undefined, // Will use service name if not specified
};

/**
 * Default values for JWT auth configuration
 */
export const JWT_AUTH_DEFAULTS: Required<Pick<JwtAuthConfig, "claims">> &
  Partial<JwtConfig> = {
  claims: {
    userId: "sub",
    email: "email",
    roles: "roles",
  },
};

/**
 * Default values for API key auth configuration
 */
export const API_KEY_AUTH_DEFAULTS: Required<
  Omit<ApiKeyAuthConfig, "provider" | "workspaceField" | "roleField">
> = {
  apiKeyHeader: "x-api-key",
  apiKeyEntity: "ApiKey",
};

/**
 * Type guard: Check if auth config is DB session based
 * @param {AuthConfig} auth - The auth configuration to check
 * @returns {boolean} True if the auth config is DB session based
 */
export function isDbSessionAuth(auth: AuthConfig): auth is DbSessionAuthConfig {
  return (
    auth.provider === "better-auth" || auth.provider === "custom-db-session"
  );
}

/**
 * Type guard: Check if auth config is JWT based
 * @param {AuthConfig} auth - The auth configuration to check
 * @returns {boolean} True if the auth config is JWT based
 */
export function isJwtAuth(auth: AuthConfig): auth is JwtAuthConfig {
  return (
    auth.provider === "auth0" ||
    auth.provider === "clerk" ||
    auth.provider === "cognito"
  );
}

/**
 * Type guard: Check if auth config is API key based
 * @param {AuthConfig} auth - The auth configuration to check
 * @returns {boolean} True if the auth config is API key based
 */
export function isApiKeyAuth(auth: AuthConfig): auth is ApiKeyAuthConfig {
  return auth.provider === "api-key";
}
