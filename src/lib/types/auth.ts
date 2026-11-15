/**
 * Supported authentication provider types. The auth block is for user sign-in
 * only: the API key check is built into every generated service and is set
 * through its environment (APSO_API_KEY), not here.
 */
export type AuthProviderType =
  | "better-auth"
  | "auth0"
  | "clerk"
  | "cognito"
  | "jwt";

/**
 * Base configuration common to all auth providers
 */
export interface BaseAuthConfig {
  /**
   * The authentication provider type
   */
  provider: AuthProviderType;

  /**
   * Entity whose rows grant permissions to roles at runtime (fields `role`
   * and `permission`, e.g. "invoice:delete"). Used only when the entity
   * exists in .apsorc. Default: "RolePermission"
   */
  permissionEntity?: string;
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
   * Expected audience for the JWT. When omitted the audience is not checked
   * (Clerk session tokens and Cognito access tokens carry no `aud` claim).
   * For Cognito an access token's `client_id` is checked against it instead.
   */
  audience?: string;

  /**
   * JWKS URI for key rotation. If not provided, uses issuer + /.well-known/jwks.json
   */
  jwksUri?: string;

  /**
   * Algorithms to accept. Default: ["RS256"]. The better-auth provider
   * always accepts EdDSA (Better Auth's default) as well.
   */
  algorithms?: string[];

  /**
   * Origins allowed in the token's `azp` claim (Clerk recommends this). A
   * token whose azp is not listed is rejected; one without azp is accepted.
   */
  authorizedParties?: string[];
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

  /**
   * Claim holding permission strings ("invoice:delete"), for providers that
   * manage permissions themselves (Auth0 RBAC). Default: "permissions"
   */
  permissions?: string;
}

/**
 * Configuration for JWT-based providers (Auth0, Clerk, Cognito, or any issuer
 * that publishes a JWKS via the generic "jwt" provider)
 */
export interface JwtAuthConfig extends BaseAuthConfig {
  provider: "auth0" | "clerk" | "cognito" | "jwt";

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
 * Better Auth, verified by the JWTs it issues: the JWT plugin's token for the
 * app's own REST calls, and the OAuth access tokens (header type at+jwt) its
 * OAuth provider issues to MCP clients. The service does not look sessions up.
 *
 * The token's `iss` is `url`, or the origin of `url`: the OAuth provider signs
 * with the base URL, the JWT plugin with Better Auth's `baseURL` option, which
 * is normally the origin. Both are checked against the keys at `url`/jwks.
 */
export interface BetterAuthConfig extends BaseAuthConfig {
  provider: "better-auth";

  /**
   * Better Auth's base URL including its base path, e.g.
   * "https://app.example.com/api/auth". The issuer and the JWKS URL
   * (`url`/jwks) default from it.
   */
  url: string;

  /**
   * Overrides. `audience` defaults to the origin of `url`, which is what the
   * JWT plugin puts in `aud` unless its `jwt.audience` option is set.
   */
  jwt?: Partial<JwtConfig>;

  /**
   * Claim names. Defaults: userId "sub", email "email", tenant
   * "activeOrganizationId", roles "roles", permissions "permissions". Better
   * Auth puts only the user in the token by default; the tenant and roles are
   * added with the JWT plugin's `definePayload`.
   */
  claims?: JwtClaimsMapping;

  /**
   * The entities that store Better Auth's session, user and membership rows
   * in this service (written by @apso/better-auth-adapter with an API key).
   * They are not read to sign a caller in; naming them marks them as auth
   * entities, which only a service caller reaches. Defaults: "session",
   * "User", "AccountUser".
   */
  sessionEntity?: string;
  userEntity?: string;
  accountUserEntity?: string;
}

/** Kept under its old name for code that marks the auth entities. */
export type DbSessionAuthConfig = BetterAuthConfig;

/**
 * One sign-in provider
 */
export type AuthProviderConfig = BetterAuthConfig | JwtAuthConfig;

/**
 * The .apsorc auth block: one provider, or a list of providers when the
 * service trusts more than one issuer. A token is matched to its provider by
 * its `iss` claim and checked against that provider's keys, audience and
 * claim mapping only.
 */
export type AuthConfig = AuthProviderConfig | AuthProviderConfig[];

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
   * Set for a service caller (a valid API key): the key's identifier
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
 * Default names of the entities that store Better Auth's rows
 */
export const DB_SESSION_AUTH_DEFAULTS = {
  sessionEntity: "session",
  userEntity: "User",
  accountUserEntity: "AccountUser",
};

/**
 * Default values for JWT auth configuration
 */
export const JWT_AUTH_DEFAULTS: Required<
  Pick<JwtAuthConfig, "claims">
> & Partial<JwtConfig> = {
  claims: {
    userId: "sub",
    email: "email",
    roles: "roles",
  },
};

/**
 * True for the provider whose own tables (sessions, users, memberships) are
 * stored in this service: Better Auth. The name predates the removal of the
 * session lookup; every provider is verified as a JWT now.
 */
export function isDbSessionAuth(
  auth: AuthProviderConfig
): auth is BetterAuthConfig {
  return auth.provider === "better-auth";
}

/** A JWT auth config with every default filled in, as the templates use it. */
export interface ResolvedJwtAuth {
  provider: AuthProviderConfig["provider"];
  issuer: string;
  audience?: string;
  jwksUri: string;
  algorithms: string[];
  authorizedParties: string[];
  claims: Required<Pick<JwtClaimsMapping, "userId">> &
    Omit<JwtClaimsMapping, "userId">;
}

/**
 * Claim defaults per provider. Clerk's v2 session token nests the active
 * organization under `o`; Cognito puts group membership in `cognito:groups`.
 */
const PROVIDER_CLAIMS: Record<AuthProviderConfig["provider"], JwtClaimsMapping> = {
  // Names for the app's definePayload to use; Better Auth has no defaults for these.
  "better-auth": { userId: "sub", email: "email", workspaceId: "activeOrganizationId", roles: "roles", permissions: "permissions" },
  auth0: { userId: "sub", email: "email", permissions: "permissions" },
  clerk: { userId: "sub", email: "email", workspaceId: "o.id", roles: "o.rol" },
  cognito: { userId: "sub", email: "email", roles: "cognito:groups" },
  jwt: { userId: "sub", email: "email", roles: "roles", permissions: "permissions" },
};

const ALLOWED_ALGORITHMS = new Set([
  "RS256", "RS384", "RS512", "PS256", "PS384", "PS512", "ES256", "ES384",
  "EdDSA",
]);

/**
 * Fill JWT defaults and reject configs that would generate an unsafe check.
 * Only asymmetric algorithms are accepted: the key comes from the issuer's
 * JWKS, so there is no shared secret to configure or leak.
 */
export function resolveJwtAuth(auth: AuthProviderConfig): ResolvedJwtAuth {
  const betterAuth = auth.provider === "better-auth";
  const url = betterAuth ? auth.url?.trim().replace(/\/+$/, "") : undefined;
  if (betterAuth && !/^https?:\/\/[^/]/.test(url ?? ""))
    throw new Error(
      'auth.url is required for the "better-auth" provider: Better Auth\'s base URL starting with http:// or https://, for example "https://app.example.com/api/auth". The service no longer looks sessions up in its database. It verifies the JWTs Better Auth issues, so turn on Better Auth\'s JWT plugin and send its token in the Authorization: Bearer header.'
    );
  const issuer = auth.jwt?.issuer?.trim() || url;
  if (!issuer)
    throw new Error(
      `auth.jwt.issuer is required for the "${auth.provider}" provider`
    );
  const configured = auth.jwt?.algorithms ?? [];
  // EdDSA is Better Auth's default key type, so it is always accepted there.
  const algorithms = betterAuth
    ? [...new Set(["EdDSA", ...configured])]
    : configured.length > 0
    ? configured
    : ["RS256"];
  const bad = algorithms.filter((a) => !ALLOWED_ALGORITHMS.has(a));
  if (bad.length > 0)
    throw new Error(
      `auth.jwt.algorithms: ${bad.join(", ")} not supported; use ${[
        ...ALLOWED_ALGORITHMS,
      ].join(", ")}`
    );
  const claims = { ...PROVIDER_CLAIMS[auth.provider], ...auth.claims };
  return {
    provider: auth.provider,
    issuer,
    // Better Auth's default audience (the origin) is filled in by the service,
    // from the issuer it runs with.
    audience: auth.jwt?.audience?.trim() || undefined,
    jwksUri:
      auth.jwt?.jwksUri?.trim() ||
      (url
        ? `${url}/jwks`
        : `${issuer.replace(/\/+$/, "")}/.well-known/jwks.json`),
    algorithms,
    authorizedParties: auth.jwt?.authorizedParties ?? [],
    claims: { ...claims, userId: claims.userId || "sub" },
  };
}

/**
 * Reject the removed providers with what replaced them.
 */
export function assertSignInProvider(auth?: { provider?: string }): void {
  if (auth?.provider === "api-key")
    throw new Error(
      'auth.provider "api-key" was removed. The API key check is now built into every generated service: remove the auth block (or set it to your user sign-in provider), set APSO_API_KEY in the service\'s environment, and send the key in the x-api-key header. The ApiKey entity is no longer read.'
    );
  if (auth?.provider === "custom-db-session")
    throw new Error(
      'auth.provider "custom-db-session" was removed. Generated services no longer look sessions up in the database; they verify JWTs. Use "jwt" with the issuer that signs your users\' tokens (auth.jwt.issuer, and auth.jwt.jwksUri for its public keys), or "better-auth" with auth.url if the sessions come from Better Auth.'
    );
}

/**
 * The auth block as a list of providers, rejecting lists that cannot be
 * generated. Every provider is checked as a JWT: a token names its issuer, so
 * the guard can pick one provider before checking anything.
 */
export function authProviders(auth?: AuthConfig): AuthProviderConfig[] {
  if (!auth) return [];
  const list = Array.isArray(auth) ? auth : [auth];
  if (list.length === 0)
    throw new Error(
      "auth is an empty list. List at least one provider, or remove the auth block."
    );
  for (const provider of list) assertSignInProvider(provider);
  const seen = new Set<string>();
  for (const provider of list) {
    const { issuer } = resolveJwtAuth(provider);
    // Better Auth's JWT plugin signs with the origin of its URL.
    const issuers =
      provider.provider === "better-auth"
        ? new Set([issuer, new URL(issuer).origin])
        : [issuer];
    for (const name of issuers) {
      if (seen.has(name))
        throw new Error(
          `auth lists the issuer "${name}" twice. Each provider needs its own issuer: the token's iss claim is what picks the provider.`
        );
      seen.add(name);
    }
  }
  return list;
}

/**
 * The providers of the auth block with defaults filled in. Empty for no auth
 * block.
 */
export function resolveJwtProviders(auth?: AuthConfig): ResolvedJwtAuth[] {
  return authProviders(auth).map((provider) => resolveJwtAuth(provider));
}
