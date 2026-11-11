import {
  AuthConfig,
  authProviders,
  resolveJwtProviders,
  DB_SESSION_AUTH_DEFAULTS,
  Entity,
  PERMISSION_OPERATIONS,
  PermissionOperation,
  RelationshipMap,
  ScopeOptions,
  isDbSessionAuth,
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

/**
 * Operations an entity exposes as MCP tools, from its `mcp` setting.
 * Empty when the entity has not opted in.
 */
export function mcpOperations(entity: Entity): PermissionOperation[] {
  if (!entity.mcp) return [];
  if (entity.mcp === true) return [...PERMISSION_OPERATIONS];
  const bad =
    !Array.isArray(entity.mcp) ||
    entity.mcp.find((op) => !PERMISSION_OPERATIONS.includes(op));
  if (bad)
    throw new Error(
      `${entity.name}.mcp must be true or a list of ${PERMISSION_OPERATIONS.join(", ")}`
    );
  return [...new Set(entity.mcp)];
}

/**
 * Better Auth's tables by entity name (any case) and the fields that mark
 * them, so a domain entity that shares a name (a billing Account) is not
 * taken for one. The OAuth provider's tables have names no domain entity
 * would use, so the name is enough.
 */
const BETTER_AUTH_TABLES: Record<string, string[]> = {
  session: ["token"],
  account: ["providerId", "accountId"],
  verification: ["identifier", "value"],
  // Organization plugin: who belongs to which tenant, with which role.
  member: ["role"],
  invitation: ["email", "status"],
  // JWT plugin: the signing keys.
  jwks: ["publicKey", "privateKey"],
  oauthclient: [],
  oauthresource: [],
  oauthclientresource: [],
  oauthrefreshtoken: [],
  oauthaccesstoken: [],
  oauthconsent: [],
  oauthclientassertion: [],
};

/**
 * The entities that store Better Auth's own rows when the better-auth
 * provider is listed: the auth block's session, user and membership
 * (accountUserEntity) entities, and Better Auth's other tables (account,
 * verification, the organization plugin's member and invitation, the JWT
 * plugin's jwks, the OAuth provider's tables). Only a service caller (API
 * key) reaches them: the key guard refuses a signed-in user on their routes,
 * no other entity's controller joins onto them, and they cannot be MCP tools.
 */
export function authEntityNames(entities: Entity[], auth?: AuthConfig): string[] {
  const betterAuth = authProviders(auth).find((a) => isDbSessionAuth(a));
  if (!betterAuth) return [];
  const { sessionEntity, userEntity, accountUserEntity } = {
    ...DB_SESSION_AUTH_DEFAULTS,
    ...betterAuth,
  };
  const named = new Set([sessionEntity, userEntity, accountUserEntity]);
  const found = entities.filter((entity) => {
    const fields = new Set((entity.fields ?? []).map((f) => f.name));
    return (
      named.has(entity.name) ||
      BETTER_AUTH_TABLES[entity.name.toLowerCase()]?.every((f) => fields.has(f))
    );
  });
  const tool = found.find((entity) => mcpOperations(entity).length > 0);
  if (tool)
    throw new Error(
      `${tool.name}.mcp: ${tool.name} is an auth entity, which only a service caller (API key) may call, so it cannot be exposed as MCP tools`
    );
  return found.map((entity) => entity.name);
}

/**
 * True for a relation that a response must not carry: one from another entity
 * onto an auth entity. Auth entities keep the relations between themselves.
 */
export function hidesRelation(
  entityName: string,
  relatedName: string,
  entities: Entity[],
  auth?: AuthConfig
): boolean {
  const names = authEntityNames(entities, auth);
  return !names.includes(entityName) && names.includes(relatedName);
}

/** The auth entities' route names (sessions), for the key guard. */
export const authEntityRoutes = (entities: Entity[], auth?: AuthConfig): string[] =>
  authEntityNames(entities, auth).map((name) => toRouteName(name));

export function hasPermissions(entities: Entity[]): boolean {
  return entities.some((entity) => entity.permissions);
}

/** One guarded operation: its permission name and the roles that have it by default. */
export interface PermissionRule {
  permission: string;
  roles: string[];
}

/** What the permission guard template needs. */
export interface PermissionConfig {
  /** Guarded operations by route name (projects). */
  routes: Record<string, Partial<Record<PermissionOperation, PermissionRule>>>;
  /**
   * Read rules a `?join` must satisfy, by relation name (singular and plural).
   * A name shared by relations to different entities must satisfy all of them.
   */
  joins: Record<string, PermissionRule[]>;
  /** The entity whose rows grant permissions to roles at runtime, if declared. */
  grants?: { entity: string; tenantField?: string };
}

const permissionKey = (entityName: string): string =>
  entityName.charAt(0).toLowerCase() + entityName.slice(1);

/**
 * The grants entity, checked so it cannot become an escalation path: its
 * writes must be role-guarded, and in a multi-tenant schema it must be
 * tenant-scoped so a grant made in one tenant does not apply in another.
 */
function resolveGrants(
  entities: Entity[],
  auth?: AuthConfig
): PermissionConfig["grants"] {
  // One grants entity per service, whichever provider signed the caller in.
  const named = [
    ...new Set(authProviders(auth).map((a) => a.permissionEntity).filter(Boolean)),
  ];
  if (named.length > 1)
    throw new Error(
      `auth providers name different permissionEntity values (${named.join(", ")}); a service has one`
    );
  const name = named[0] ?? "RolePermission";
  const entity = entities.find((e) => e.name === name);
  if (!entity) {
    if (named.length > 0)
      throw new Error(`auth.permissionEntity "${name}" is not an entity in .apsorc`);
    return undefined;
  }
  const fields = new Set((entity.fields ?? []).map((f) => f.name));
  for (const field of ["role", "permission"])
    if (!fields.has(field))
      throw new Error(`Entity ${name} needs a "${field}" text field to grant permissions`);
  const writes = entity.permissions ?? {};
  if (!writes.create || !writes.update || !writes.delete)
    throw new Error(
      `${name}.permissions must list roles for create, update and delete; otherwise any signed-in user can grant themselves any permission`
    );
  const scopes = entity.scopeBy ? [entity.scopeBy].flat() : [];
  const tenantField = scopes.find((s) => !s.includes("."));
  if (!tenantField && entities.some((e) => e !== entity && e.scopeBy))
    throw new Error(
      `${name} needs a direct scopeBy field: this schema is tenant-scoped, and an unscoped grant would apply in every tenant`
    );
  return { entity: name, tenantField };
}

/**
 * Validates every entity's permissions and resolves them to permission names
 * ("invoice:delete") by route and by join name, so a role that cannot read
 * Task cannot read it through /projects?join=tasks either. Undefined when no
 * entity has permissions.
 */
export function getPermissionConfig(
  entities: Entity[],
  relationshipMap?: RelationshipMap,
  auth?: AuthConfig
): PermissionConfig | undefined {
  if (!hasPermissions(entities)) return undefined;
  const byEntity: Record<string, Partial<Record<PermissionOperation, PermissionRule>>> = {};
  for (const entity of entities) {
    if (!entity.permissions) continue;
    const rules: Partial<Record<PermissionOperation, PermissionRule>> = {};
    for (const [op, roles] of Object.entries(entity.permissions)) {
      if (!(PERMISSION_OPERATIONS as readonly string[]).includes(op))
        throw new Error(
          `${entity.name}.permissions: unknown operation "${op}"; use ${PERMISSION_OPERATIONS.join(", ")}`
        );
      if (!Array.isArray(roles) || roles.some((r) => typeof r !== "string" || !r))
        throw new Error(`${entity.name}.permissions.${op} must be a list of role names`);
      rules[op as PermissionOperation] = {
        permission: `${permissionKey(entity.name)}:${op}`,
        roles,
      };
    }
    byEntity[entity.name] = rules;
  }

  const routes: PermissionConfig["routes"] = {};
  for (const [name, rules] of Object.entries(byEntity))
    routes[toRouteName(name)] = rules;

  const joins: PermissionConfig["joins"] = {};
  for (const relations of Object.values(relationshipMap ?? {})) {
    for (const relation of relations) {
      const read = byEntity[relation.name]?.read;
      if (!read) continue;
      const name = getRelationshipName(relation);
      for (const key of new Set([name, pluralize(name)])) {
        const list = joins[key] ?? [];
        if (!list.some((rule) => rule.permission === read.permission))
          list.push(read);
        joins[key] = list;
      }
    }
  }
  return { routes, joins, grants: resolveGrants(entities, auth) };
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

/**
 * A tenant scope needs a claim to read the caller's tenant from. Auth0 and
 * Cognito have no standard one, so without claims.workspaceId every token
 * from that provider would have no tenant and every scoped request would be
 * a 403. Checked for each listed provider.
 */
export function assertTenantClaim(entities: Entity[], auth?: AuthConfig): void {
  const missing = tenantClaimWarnings(entities, auth);
  if (missing.length > 0) throw new Error(missing.join("\n"));
}

/** One entity in the relation table every generated service checks. */
export interface RelationScope {
  /** Set when the entity's reads are tenant-scoped: the roles that skip its scope. */
  bypassRoles?: string[];
  /**
   * Each relation a request can load, by the name requests use: the entity it
   * loads, and whether a caller limited to its tenant on this entity stays in
   * that tenant on the related rows (the target is scoped by the same keys).
   */
  relations: Record<string, [entity: string, sameTenant: boolean]>;
}

/**
 * The relation table for the one rule on loading relations (R7): the tenant
 * filter limits only the entity a request starts from, so a user caller may
 * load a relation onto a tenant-scoped entity only when
 * - the caller holds a role that skips that entity's scope, or
 * - the caller is limited to its tenant on the entity the relation starts
 *   from, and the target is scoped by the same keys (Project.tasks).
 * Any other load is refused, for every query syntax and at every depth. A
 * service caller is not limited. Each language walks this table at run time.
 *
 * An entity counts as scoped only when both find and get are filtered;
 * otherwise its rows are readable anyway. Undefined without auth or when no
 * entity is scoped.
 */
export function relationScopes(
  entities: Entity[],
  relationshipMap: RelationshipMap | undefined,
  hasAuth: boolean
): Record<string, RelationScope> | undefined {
  if (!hasAuth) return undefined;
  const scoped = new Map<string, { keys: Set<string>; bypassRoles: string[] }>();
  for (const config of getScopedEntities(entities)) {
    if (!config.enforceOn.includes("find") || !config.enforceOn.includes("get"))
      continue;
    scoped.set(config.name, {
      keys: new Set(config.scopes.map((s) => s.contextKey)),
      bypassRoles: config.bypassRoles,
    });
  }
  if (scoped.size === 0) return undefined;
  const table: Record<string, RelationScope> = {};
  for (const entity of entities) {
    const from = scoped.get(entity.name);
    const relations: RelationScope["relations"] = {};
    for (const relation of relationshipMap?.[entity.name] ?? []) {
      const name = getRelationshipName(relation);
      const many = relation.type === "OneToMany" || relation.type === "ManyToMany";
      const to = scoped.get(relation.name);
      relations[many ? pluralize(name) : name] = [
        relation.name,
        Boolean(from && to && [...to.keys].every((key) => from.keys.has(key))),
      ];
    }
    table[entity.name] = { bypassRoles: from?.bypassRoles, relations };
  }
  return table;
}

/** Entities whose scopeBy uses a nested path, which Go and Python cannot enforce. */
export function nestedScopeEntities(entities: Entity[]): string[] {
  return getScopedEntities(entities)
    .filter((e) => e.scopes.some((s) => !s.direct))
    .map((e) => e.name);
}

/**
 * One warning per provider that maps no tenant claim while entities are
 * tenant-scoped: its users would get 403 on every one of those entities.
 */
export function tenantClaimWarnings(
  entities: Entity[],
  auth?: AuthConfig
): string[] {
  const scoped = getScopedEntities(entities)
    .filter((e) =>
      e.scopes.some((s) => s.contextKey !== "userId" && s.contextKey !== "email")
    )
    .map((e) => e.name);
  if (scoped.length === 0) return [];
  const names =
    scoped.length > 2
      ? `${scoped[0]}, ${scoped[1]} and ${scoped.length - 2} more are`
      : `${scoped.join(" and ")} ${scoped.length === 1 ? "is" : "are"}`;
  const listed = Array.isArray(auth) && auth.length > 1;
  return resolveJwtProviders(auth)
    .filter((p) => !p.claims.workspaceId && !p.claims.organizationId)
    .map(
      (p) =>
        `auth provider "${p.provider}" (${p.issuer}) has no tenant claim, but ${names} tenant-scoped. Tokens from this provider will get 403 "No tenant in the auth context" on ${scoped.length === 1 ? "that entity" : "those entities"}. Set ${listed ? "claims.organizationId on that provider" : "auth.claims.organizationId"} to the claim that holds the tenant.`
    );
}
