import {
  Entity,
  RelationshipMap,
  ResolvedApiKeyAuth,
  ScopeOptions,
} from "./types";
import pluralize from "pluralize";
import {
  getRelationshipIdField,
  getRelationshipName,
} from "./utils/relationships/parse";

/**
 * Represents a scope field configuration for template rendering
 */
export interface ScopeFieldConfig {
  field: string;
  contextKey: string;
  direct: boolean;
  path?: string;
  /**
   * Nested paths only, set when the relationship map is given: the entity's
   * foreign key to the first hop (taskId), the entity it points to (Task),
   * and the rest of the path on that entity (workspaceId).
   */
  fkField?: string;
  parentEntity?: string;
  parentPath?: string;
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
 * A nested path's first segment must be a ManyToOne relationship of the
 * entity: its foreign key is what list queries filter on.
 */
function resolveNestedScope(
  entityName: string,
  scope: ScopeFieldConfig,
  relationshipMap: RelationshipMap
): ScopeFieldConfig {
  if (scope.direct || !scope.path) return scope;
  const relation = (relationshipMap[entityName] ?? []).find(
    (r) => r.type === "ManyToOne" && getRelationshipName(r) === scope.field
  );
  if (!relation)
    throw new Error(
      `${entityName}.scopeBy "${scope.path}": "${scope.field}" must be a many-to-one relationship of ${entityName}`
    );
  return {
    ...scope,
    fkField: getRelationshipIdField(relation),
    parentEntity: relation.name,
    parentPath: scope.path.split(".").slice(1).join("."),
  };
}

/**
 * Extracts scoped entity configurations from all entities. Pass the
 * relationship map to resolve nested paths to their foreign keys.
 */
export function getScopedEntities(
  entities: Entity[],
  relationshipMap?: RelationshipMap
): ScopedEntityConfig[] {
  return entities
    .filter((entity) => entity.scopeBy)
    .map((entity) => {
      const options = { ...DEFAULT_SCOPE_OPTIONS, ...entity.scopeOptions };
      const scopes = parseScopeBy(entity.scopeBy!);

      return {
        name: entity.name,
        routeName: toRouteName(entity.name),
        repoName: toRepoName(entity.name),
        scopes: relationshipMap
          ? scopes.map((s) => resolveNestedScope(entity.name, s, relationshipMap))
          : scopes,
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

/** Follows a relationship from one entity to another; true if the join is safe. */
export type JoinHopCheck = (from: string, to: string) => boolean;

/**
 * Which joins stay inside the caller's tenant. The tenant filter only limits
 * the entity a request starts from; joined rows are not filtered. A hop is
 * safe when it lands on a shared entity (no scopeBy, readable by every caller
 * already) or goes from a scoped entity to one scoped by the same keys
 * (Project.tasks). A hop from a shared entity into a scoped one reads every
 * tenant's rows: from Task, `assignee.tasks` lists the assignee's tasks in
 * all workspaces. Undefined without auth, when nothing is scoped.
 *
 * An entity counts as scoped only when both find and get are filtered;
 * otherwise its rows are readable anyway and hops out of it are not safe.
 */
export function joinHopCheck(
  entities: Entity[],
  hasAuth: boolean
): JoinHopCheck | undefined {
  if (!hasAuth) return undefined;
  const keys = new Map<string, Set<string>>();
  for (const config of getScopedEntities(entities)) {
    if (!config.enforceOn.includes("find") || !config.enforceOn.includes("get"))
      continue;
    keys.set(config.name, new Set(config.scopes.map((s) => s.contextKey)));
  }
  return (from, to) => {
    const toKeys = keys.get(to);
    if (!toKeys) return true;
    const fromKeys = keys.get(from);
    return fromKeys !== undefined && [...toKeys].every((k) => fromKeys.has(k));
  };
}

/** Entities whose scopeBy uses a nested path, which Go and Python do not enforce. */
export function nestedScopeEntities(entities: Entity[]): string[] {
  return getScopedEntities(entities)
    .filter((e) => e.scopes.some((s) => !s.direct))
    .map((e) => e.name);
}
