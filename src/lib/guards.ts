import { Entity, ResolvedApiKeyAuth, ScopeOptions } from "./types";
import pluralize from "pluralize";

/**
 * Represents a scope field configuration for template rendering
 */
export interface ScopeFieldConfig {
  field: string;
  contextKey: string;
  direct: boolean;
  path?: string;
}

/**
 * Represents a scoped entity configuration for template rendering
 */
export interface ScopedEntityConfig {
  name: string;
  routeName: string;
  repoName: string;
  scopes: ScopeFieldConfig[];
  injectOnCreate: boolean;
  enforceOn: string[];
  bypassRoles: string[];
}

/**
 * Default scope options when not specified
 */
const DEFAULT_SCOPE_OPTIONS: Required<ScopeOptions> = {
  injectOnCreate: true,
  enforceOn: ["find", "get", "create", "update", "delete"],
  bypassRoles: [],
};

/**
 * Parses scopeBy configuration and returns structured scope fields.
 */
function parseScopeBy(scopeBy: string | string[]): ScopeFieldConfig[] {
  const scopes = Array.isArray(scopeBy) ? scopeBy : [scopeBy];

  return scopes.map((scope) => {
    const isDirect = !scope.includes(".");
    const field = isDirect ? scope : scope.split(".")[0];
    const contextKey = isDirect ? scope : scope.split(".").pop()!;

    return {
      field,
      contextKey,
      direct: isDirect,
      path: isDirect ? undefined : scope,
    };
  });
}

function toRouteName(entityName: string): string {
  return pluralize(entityName).toLowerCase();
}

function toRepoName(entityName: string): string {
  const camelCase = entityName.charAt(0).toLowerCase() + entityName.slice(1);
  return `${camelCase}Repository`;
}

/**
 * Extracts scoped entity configurations from all entities.
 */
export function getScopedEntities(entities: Entity[]): ScopedEntityConfig[] {
  return entities
    .filter((entity) => entity.scopeBy)
    .map((entity) => {
      const options = { ...DEFAULT_SCOPE_OPTIONS, ...entity.scopeOptions };

      return {
        name: entity.name,
        routeName: toRouteName(entity.name),
        repoName: toRepoName(entity.name),
        scopes: parseScopeBy(entity.scopeBy!),
        injectOnCreate: options.injectOnCreate,
        enforceOn: options.enforceOn,
        bypassRoles: options.bypassRoles,
      };
    });
}

/**
 * Checks if any entities have scopeBy configured.
 */
export function hasScopedEntities(entities: Entity[]): boolean {
  return entities.some((entity) => entity.scopeBy);
}

/** API key settings plus what the key entity offers, as the guard templates use them. */
export interface ApiKeyTemplateData extends ResolvedApiKeyAuth {
  hasStatus: boolean;
  hasExpiresAt: boolean;
}

/**
 * Check the API key entity exists and has the hash field, and note whether it
 * has `status` and `expiresAt`, which the guard then enforces.
 */
export function apiKeyTemplateData(
  apiKey: ResolvedApiKeyAuth,
  entities: Entity[]
): ApiKeyTemplateData {
  const entity = entities.find((e) => e.name === apiKey.apiKeyEntity);
  if (!entity)
    throw new Error(
      `auth.apiKeyEntity "${apiKey.apiKeyEntity}" is not an entity in .apsorc; add it with a "${apiKey.keyField}" text field`
    );
  const fields = new Set((entity.fields ?? []).map((f) => f.name));
  if (!fields.has(apiKey.keyField))
    throw new Error(
      `Entity ${apiKey.apiKeyEntity} needs a "${apiKey.keyField}" text field holding each key's hex SHA-256 (auth.keyField)`
    );
  return {
    ...apiKey,
    hasStatus: fields.has("status"),
    hasExpiresAt: fields.has("expiresAt"),
  };
}

/** A direct scopeBy field and the auth context value that fills it. */
export interface DirectScopeField {
  field: string;
  /** userId and email map to the caller's own; anything else is the tenant. */
  source: "userId" | "email" | "tenant";
}

/** What Go and Python services need to scope one entity. */
export interface EntityScopeData {
  fields: DirectScopeField[];
  enforceOn: string[];
  bypassRoles: string[];
  injectOnCreate: boolean;
}

/**
 * The direct scopeBy fields of an entity, for services that filter in their
 * own queries (Go, Python). Undefined without auth: with no caller identity
 * there is no tenant to scope by. Nested paths (task.workspaceId) are not
 * included; see hasNestedScopes.
 */
export function entityScope(
  entity: Entity,
  hasAuth: boolean
): EntityScopeData | undefined {
  if (!hasAuth || !entity.scopeBy) return undefined;
  const [config] = getScopedEntities([entity]);
  const fields = config.scopes
    .filter((s) => s.direct)
    .map((s) => ({
      field: s.field,
      source:
        s.contextKey === "userId" || s.contextKey === "email"
          ? (s.contextKey as "userId" | "email")
          : ("tenant" as const),
    }));
  if (fields.length === 0 || config.enforceOn.length === 0) return undefined;
  return {
    fields,
    enforceOn: config.enforceOn,
    bypassRoles: config.bypassRoles,
    injectOnCreate: config.injectOnCreate,
  };
}

/** Entities whose scopeBy uses a nested path, which Go and Python do not enforce. */
export function nestedScopeEntities(entities: Entity[]): string[] {
  return getScopedEntities(entities)
    .filter((e) => e.scopes.some((s) => !s.direct))
    .map((e) => e.name);
}
